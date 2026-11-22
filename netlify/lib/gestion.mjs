/* ==========================================================================
   ELEV8 Private Driver — tableau de gestion, documents d'une réservation, export comptable
   --------------------------------------------------------------------------
   Lecture seule : aucune de ces fonctions ne modifie un dossier, une facture ou un avoir.
   Appelées uniquement par /documents-api, après contrôle de la session ELEV8 (côté serveur).
   Les données viennent des magasins de l'environnement courant (« -test » hors production).

   Tableau : une ligne par réservation payable en ligne (dossier de paiement en vigueur),
   filtres et pagination côté serveur.
   Export comptable (CSV, séparateur « ; », virgule décimale, UTF-8 avec BOM pour Excel) :
   chaque document émis sur la période, avec, pour éviter toute double comptabilisation :
     - « Avance client HT » : la facture d'acompte n'est PAS du chiffre d'affaires ; elle est
       reprise (montant négatif) par la facture finale ;
     - « CA HT » : porté par la facture finale (ou une facture établie à la main) ;
     - « TVA collectée » : exigible à l'encaissement de l'acompte ; la facture finale ne porte
       que l'écart éventuel ; les avoirs la diminuent.
   La somme de chaque colonne sur une période donne donc le CA, la TVA et les avances réels.
   ========================================================================== */
import { magasin, LIBELLES } from "./paiements.mjs";
import { magasinDevis, chargerConfig, pdfDevis } from "./devis-auto.mjs";
import { demandeDe } from "./notifications.mjs";
import { estSiteDeTest } from "./environnement.mjs";
import { facturationAutomatique, pdfFacture } from "./facturation.mjs";
import { creerZip } from "./zip.mjs";
import { aujourdhuiParis, emetteur } from "./documents.mjs";

export const FILTRES = ["tous", "payees", "a_attribuer", "realisees", "a_facturer", "annulees", "remboursees", "attente_paiement"];
const ANNULEES = ["annulee", "annulee_indisponible", "sans_chauffeur"];
function correspond(p, filtre) {
  switch (filtre) {
    case "payees": return ["paye", "rembourse_partiel"].includes(p.statut);
    case "a_attribuer": return p.etape === "payee_attente_attribution" && ["paye", "rembourse_partiel"].includes(p.statut);
    case "realisees": return p.etape === "realisee";
    case "a_facturer": return p.etape === "realisee" && !(p.factures && p.factures.finale);   // + aucune facture manuelle (vérifié ensuite)
    case "annulees": return ANNULEES.includes(p.etape) || ["annule", "expire"].includes(p.statut);
    case "remboursees": return (p.rembourseCents || 0) > 0;
    case "attente_paiement": return p.statut === "en_attente" || p.statut === "en_cours";
    default: return true;
  }
}
const nomClient = (c) => (c ? [[c.prenom, c.nom].filter(Boolean).join(" "), c.societe].filter(Boolean).join(" — ") : "");
const reDate = /^\d{4}-\d{2}-\d{2}$/;

/* Versions du devis envoyées pour une réservation (D-réf, D-réf-2…) */
async function devisDe(st, ref) {
  const cpt = await st.get("devis-compteur/" + ref, { type: "json" });
  const out = [];
  for (let i = 1; i <= ((cpt && cpt.n) || 0); i++) {
    const numero = (estSiteDeTest() ? "TEST-" : "") + "D-" + ref + (i > 1 ? "-" + i : "");
    const r = await st.get("devis/" + numero, { type: "json" });
    if (r) out.push({ numero, version: i, date: r.dateEmission, montant: r.montantCents / 100 });
  }
  return out;
}

/* Facture établie manuellement dans /documents (facturation automatique désactivée) : lien « ref/<réf> » */
async function factureManuelle(stF, ref) {
  const l = await stF.get("ref/" + ref, { type: "json" });
  if (!l || !l.numero) return null;
  const r = await stF.get("facture/" + l.numero, { type: "json" });
  return r ? { numero: r.numero, date: r.dateEmission, montant: r.montants.ttc } : null;
}
/* Course réalisée et payée, sans facture finale ni facture manuelle : facture à établir */
const aEtablir = (p, manuelle) => p.etape === "realisee" && ["paye", "rembourse_partiel"].includes(p.statut) && !(p.factures && p.factures.finale) && !manuelle;

/* ---------- Tableau de gestion (filtres, période de prise en charge, pagination) ---------- */
export async function listerReservations({ filtre = "tous", du = "", au = "", recherche = "", page = 1, parPage = 20 } = {}) {
  if (!FILTRES.includes(filtre)) filtre = "tous";
  page = Math.max(1, Math.min(10_000, parseInt(page, 10) || 1));
  parPage = Math.max(5, Math.min(50, parseInt(parPage, 10) || 20));
  if (du && !reDate.test(du)) du = ""; if (au && !reDate.test(au)) au = "";
  const q = String(recherche || "").trim().toUpperCase().slice(0, 40);
  const st = magasin(), stF = magasinDevis();
  const { blobs } = await st.list({ prefix: "ref/" });
  const refs = blobs.map((b) => b.key.slice(4)).filter((r) => !q || r.includes(q)).sort().reverse();   // E8-AAMMJJ-… : plus récentes d'abord
  const lignes = [];
  let total = 0;
  for (const ref of refs) {
    const l = await st.get("ref/" + ref, { type: "json" });
    const p = l && l.jeton ? await st.get("paiement/" + l.jeton, { type: "json" }) : null;
    if (!p || !correspond(p, filtre)) continue;
    if (filtre === "a_facturer" && await factureManuelle(stF, p.ref)) continue;
    const jour = p.priseEnCharge ? aujourdhuiParis(Date.parse(p.priseEnCharge)) : "";
    if ((du && jour < du) || (au && jour > au)) continue;
    total++;
    if (total <= (page - 1) * parPage || total > page * parPage) continue;           // seules les lignes de la page sont détaillées
    lignes.push(await ligne(st, stF, p));
  }
  return { lignes, total, page, parPage, pages: Math.max(1, Math.ceil(total / parPage)), filtre };
}
async function ligne(st, stF, p) {
  const D = await demandeDe(p, Date.now());
  const F = p.factures || {};
  const paye = ["paye", "rembourse_partiel", "rembourse"].includes(p.statut);
  const rembourse = (p.rembourseCents || 0) / 100;
  const avoirs = [], manuelle = await factureManuelle(stF, p.ref);
  for (const a of F.avoirs || []) { const r = await stF.get("avoir/" + a.numero, { type: "json" }); avoirs.push({ numero: a.numero, montant: r ? r.avoir.montantCents / 100 : null }); }
  return {
    ref: p.ref, client: D ? nomClient(D.client) : "", priseEnCharge: p.priseEnCharge,
    trajet: D && D.prestation ? D.prestation.depart + " → " + D.prestation.destination : "",
    prixTTC: p.montantCents / 100, encaisse: paye ? Math.round(p.montantCents - (p.rembourseCents || 0)) / 100 : 0, rembourse,
    solde: paye || ["annule", "expire", "remplace"].includes(p.statut) ? 0 : p.montantCents / 100,
    paiement: LIBELLES[p.statut] || p.statut, statut: p.statut, etape: p.etape, etapeLibelle: LIBELLES[p.etape] || p.etape,
    chauffeur: p.chauffeur ? p.chauffeur.prenom : "", realisee: p.realisation ? p.realisation.le : null,
    devis: await devisDe(stF, p.ref), acompte: F.acompte || null, finale: F.finale || null, factureManuelle: manuelle ? manuelle.numero : null,
    aFacturer: aEtablir(p, manuelle), avoirs, litige: !!p.litige
  };
}

/* ---------- Documents d'une réservation (une seule rubrique) ---------- */
export async function documentsReservation(ref) {
  const st = magasin(), stF = magasinDevis();
  const l = await st.get("ref/" + ref, { type: "json" });
  const p = l && l.jeton ? await st.get("paiement/" + l.jeton, { type: "json" }) : null;
  if (!p) return null;
  const docs = [];
  for (const d of await devisDe(stF, ref)) docs.push({ type: "devis", libelle: "Devis" + (d.version > 1 ? " (version " + d.version + ")" : ""), numero: d.numero, date: d.date, montant: d.montant });
  const F = p.factures || {};
  for (const [cle, libelle] of [["acompte", "Facture d'acompte"], ["finale", "Facture finale"]]) {
    if (!F[cle]) continue;
    const r = await stF.get("facture/" + F[cle], { type: "json" });
    if (r) docs.push({ type: cle, libelle, numero: r.numero, date: r.dateEmission, montant: r.montants.ttc });
  }
  const manuelle = await factureManuelle(stF, ref);
  if (manuelle) docs.push({ type: "facture", libelle: "Facture (établie manuellement)", numero: manuelle.numero, date: manuelle.date, montant: manuelle.montant });
  const operations = [];
  for (const a of F.avoirs || []) {
    const r = await stF.get("avoir/" + a.numero, { type: "json" });
    if (!r) continue;
    docs.push({ type: "avoir", libelle: "Avoir" + (r.avoir.total ? " (remboursement intégral)" : ""), numero: r.numero, date: r.dateEmission, montant: r.avoir.montantCents / 100, facture: r.avoir.facture.numero });
    if (r.avoir.charge && !operations.includes(r.avoir.charge)) operations.push(r.avoir.charge);
  }
  const stripe = { paiement: p.paymentIntent || null, payeLe: p.payeLe || null, montant: p.montantCents / 100, rembourse: (p.rembourseCents || 0) / 100,
    sessions: (p.sessions || []).map((x) => x.id), operations };
  return { ref, docs, stripe, aFacturer: aEtablir(p, manuelle), facturationAutomatique: facturationAutomatique() };
}

/* Document archivé appartenant à cette réservation (devis, facture, avoir) */
export async function documentArchive(ref, numero) {
  const stF = magasinDevis();
  const cle = /(^|-)AV-/.test(numero) ? "avoir/" : /(^|-)D-/.test(numero) ? "devis/" : "facture/";
  const rec = await stF.get(cle + numero, { type: "json" });
  return rec && (rec.ref || (rec.doc && rec.doc.ref)) === ref ? { rec, devis: cle === "devis/" } : null;   // facture manuelle : référence dans doc
}

/* ---------- Export comptable ---------- */
const eur = (c) => (Math.round(c) / 100).toFixed(2).replace(".", ",");
const cents = (x) => Math.round((x || 0) * 100);
const csvCase = (v) => { const s = String(v == null ? "" : v); return /[";\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
export const COLONNES = ["Environnement", "Date d'émission", "Type de document", "Numéro", "Référence réservation", "Client",
  "Montant HT", "TVA", "Montant TTC", "Acompte déduit TTC", "CA HT", "TVA collectée", "Avance client HT", "Montant encaissé", "Montant remboursé",
  "Référence Stripe", "Mode de paiement", "Document lié", "Identifiant archivé"];

export async function exportComptable({ du, au }) {
  if (!reDate.test(du || "") || !reDate.test(au || "") || du > au) throw new Error("periode");
  if ((Date.parse(au) - Date.parse(du)) / 86400_000 > 366) throw new Error("periode_longue");
  const stF = magasinDevis();
  const recs = [];
  for (const prefixe of ["facture/", "avoir/"]) {
    const { blobs } = await stF.list({ prefix: prefixe });
    for (const b of blobs) {
      const r = await stF.get(b.key, { type: "json" });
      if (r && r.numero && r.dateEmission >= du && r.dateEmission <= au) recs.push({ cle: b.key, r });
    }
  }
  recs.sort((a, b) => (a.r.dateEmission + a.r.numero).localeCompare(b.r.dateEmission + b.r.numero));
  const cache = new Map();
  const lire = async (cle) => { if (!cache.has(cle)) cache.set(cle, await stF.get(cle, { type: "json" })); return cache.get(cle); };
  const env = estSiteDeTest() ? "TEST" : "PRODUCTION";
  const totaux = { ca: 0, tva: 0, avance: 0, enc: 0, remb: 0 };
  const lignes = [];
  for (const { cle, r } of recs) {
    const m = r.montants || {}, ht = cents(m.ht), tva = cents(m.tva), ttc = cents(m.ttc);
    const client = nomClient(r.doc && r.doc.client);
    let type, ca = 0, tvaC = 0, avance = 0, enc = 0, remb = 0, deduit = 0, ref = "", mode = "", lie = "";
    if (r.type === "acompte") {
      type = "Facture d'acompte"; avance = ht; tvaC = tva; enc = ttc; ref = r.acompte.reference; mode = r.acompte.mode; lie = r.acompte.devis ? "Devis " + r.acompte.devis : "";
    } else if (r.type === "finale") {
      type = "Facture finale";
      const ac = await lire("facture/" + r.finale.acompte.numero);
      let acHt = cents(ac.montants.ht), acTva = cents(ac.montants.tva);
      for (const a of r.finale.avoirs || []) { const av = await lire("avoir/" + a.numero); if (av) { acHt -= cents(av.montants.ht); acTva -= cents(av.montants.tva); } }
      ca = ht; tvaC = tva - acTva; avance = -acHt; deduit = r.finale.deductionCents; ref = r.finale.reference; mode = r.finale.mode;
      lie = "Acompte " + r.finale.acompte.numero + ((r.finale.avoirs || []).length ? " ; avoirs " + r.finale.avoirs.map((a) => a.numero).join(", ") : "");
    } else if (r.type === "avoir") {
      type = "Avoir"; remb = ttc; tvaC = -tva; ref = r.avoir.reference + (r.avoir.charge ? " / " + r.avoir.charge : ""); mode = r.avoir.mode;
      if (r.avoir.facture.type === "acompte") avance = -ht; else ca = -ht;       // avoir sur acompte : réduit l'avance ; sur facture finale : réduit le CA
      lie = "Facture " + r.avoir.facture.numero;
    } else {
      type = "Facture"; ca = ht; tvaC = tva; const f = (r.doc && r.doc.facture) || {};
      enc = f.paye ? ttc : 0; ref = f.referencePaiement || ""; mode = f.modePaiement || "";
    }
    totaux.ca += ca; totaux.tva += tvaC; totaux.avance += avance; totaux.enc += enc; totaux.remb += remb;
    lignes.push([env, r.dateEmission, type, r.numero, r.ref || (r.doc && r.doc.ref) || "", client, eur(ht), eur(tva), eur(ttc), deduit ? eur(deduit) : "",
      eur(ca), eur(tvaC), eur(avance), eur(enc), eur(remb), ref, mode, lie, cle]);
  }
  lignes.push(["", "", "TOTAL DE LA PÉRIODE", "", "", "", "", "", "", "", eur(totaux.ca), eur(totaux.tva), eur(totaux.avance), eur(totaux.enc), eur(totaux.remb), "", "", "", ""]);
  const csv = "﻿" + [COLONNES, ...lignes].map((l) => l.map(csvCase).join(";")).join("\r\n") + "\r\n";
  return { csv, documents: recs.length, fichier: "elev8-comptabilite-" + (env === "TEST" ? "TEST-" : "") + du + "_" + au + ".csv", totaux };
}

/* ---------- Journal des encaissements Stripe (rapprochement, TVA sur encaissements) ----------
   Une ligne par paiement reçu et par remboursement, à sa date (heure de Paris), avec la facture
   correspondante si elle existe. Indispensable tant que la facturation automatique est désactivée :
   un paiement reçu avant la course n'apparaît sinon dans aucun document. Lecture seule. */
export const COLONNES_ENCAISSEMENTS = ["Environnement", "Date", "Opération", "Référence réservation", "Client", "Prise en charge",
  "Montant TTC", "dont TVA", "Taux TVA", "Statut du paiement", "Étape", "PaymentIntent Stripe", "Opération Stripe", "Facture(s)"];
export async function exportEncaissements({ du, au, origine = "" }) {
  if (!reDate.test(du || "") || !reDate.test(au || "") || du > au) throw new Error("periode");
  if ((Date.parse(au) - Date.parse(du)) / 86400_000 > 366) throw new Error("periode_longue");
  const st = magasin(), stF = magasinDevis();
  const E = emetteur(await chargerConfig(origine));
  const tvaDe = (c) => (E.regimeTVA === "assujetti" ? c - Math.round(c / (1 + E.tauxTVA / 100)) : 0);
  const env = estSiteDeTest() ? "TEST" : "PRODUCTION";
  const ops = [];
  const { blobs } = await st.list({ prefix: "paiement/" });
  for (const b of blobs) {
    const p = await st.get(b.key, { type: "json" });
    if (!p || !p.payeLe) continue;
    const evts = [{ le: p.payeLe, op: "Paiement reçu", c: p.montantCents, id: p.paymentIntent || "" }]
      .concat((p.remboursements || []).map((r) => ({ le: r.le, op: "Remboursement", c: -r.montantCents, id: r.charge || "" })));
    // remboursement antérieur à ce journal (sans date enregistrée) : signalé à la date du paiement
    const dates = (p.remboursements || []).reduce((a, r) => a + r.montantCents, 0);
    if ((p.rembourseCents || 0) > dates) evts.push({ le: p.payeLe, op: "Remboursement (date à vérifier dans Stripe)", c: -((p.rembourseCents || 0) - dates), id: p.charge || "" });
    const garde = evts.filter((e) => { const j = aujourdhuiParis(Date.parse(e.le)); return j >= du && j <= au; });
    if (!garde.length) continue;
    const D = await demandeDe(p, Date.now());
    const F = p.factures || {}, man = await factureManuelle(stF, p.ref);
    const facts = [F.acompte, F.finale, man && man.numero, ...(F.avoirs || []).map((a) => a.numero)].filter(Boolean).join(", ");
    for (const e of garde) ops.push({ tri: e.le + p.ref, l: [env, new Date(e.le).toLocaleString("fr-FR", { timeZone: "Europe/Paris" }), e.op, p.ref, D ? nomClient(D.client) : "",
      p.priseEnCharge ? new Date(p.priseEnCharge).toLocaleString("fr-FR", { timeZone: "Europe/Paris", dateStyle: "short", timeStyle: "short" }) : "",
      eur(e.c), eur(Math.sign(e.c) * tvaDe(Math.abs(e.c))), E.regimeTVA === "assujetti" ? E.tauxTVA + " %" : "franchise", LIBELLES[p.statut] || p.statut, LIBELLES[p.etape] || p.etape,
      p.paymentIntent || "", e.id, facts || "aucune (à établir)"], c: e.c, tva: Math.sign(e.c) * tvaDe(Math.abs(e.c)) });
  }
  ops.sort((a, b) => a.tri.localeCompare(b.tri));
  const tot = ops.reduce((a, o) => ({ c: a.c + o.c, tva: a.tva + o.tva }), { c: 0, tva: 0 });
  const lignes = ops.map((o) => o.l).concat([["", "", "TOTAL NET DE LA PÉRIODE", "", "", "", eur(tot.c), eur(tot.tva), "", "", "", "", "", ""]]);
  const csv = "\uFEFF" + [COLONNES_ENCAISSEMENTS, ...lignes].map((l) => l.map(csvCase).join(";")).join("\r\n") + "\r\n";
  return { csv, operations: ops.length, fichier: "elev8-encaissements-" + (env === "TEST" ? "TEST-" : "") + du + "_" + au + ".csv", totalCents: tot.c, tvaCents: tot.tva };
}

/* ---------- Archive de sauvegarde (conservation 10 ans) ----------
   ZIP d'une période (31 jours au plus) : PDF de chaque devis, facture et avoir émis, données
   d'origine (JSON, permettent de régénérer chaque PDF à l'identique), export comptable et journal
   des encaissements. À télécharger chaque mois et à conserver hors de Netlify (disque, cloud). */
export const ARCHIVE_MAX_OCTETS = 4_200_000;          // réponse d'une fonction Netlify : 6 Mo au plus en base64
export async function archiveDocuments({ du, au, origine = "", now = Date.now() }) {
  if (!reDate.test(du || "") || !reDate.test(au || "") || du > au) throw new Error("periode");
  if ((Date.parse(au) - Date.parse(du)) / 86400_000 > 31) throw new Error("periode_archive");
  const stF = magasinDevis();
  const fichiers = [], index = [];
  for (const [prefixe, dossier] of [["facture/", "factures"], ["avoir/", "avoirs"], ["devis/", "devis"]]) {
    const { blobs } = await stF.list({ prefix: prefixe });
    for (const b of blobs) {
      const r = await stF.get(b.key, { type: "json" });
      if (!r || !r.numero || !(r.dateEmission >= du && r.dateEmission <= au)) continue;
      const bytes = dossier === "devis" ? await pdfDevis(r) : await pdfFacture(r);
      fichiers.push({ nom: dossier + "/" + r.numero + ".pdf", contenu: Buffer.from(bytes) });
      index.push({ cle: b.key, numero: r.numero, dateEmission: r.dateEmission, ref: r.ref || (r.doc && r.doc.ref) || "", donnees: r });
    }
  }
  index.sort((a, b) => (a.dateEmission + a.numero).localeCompare(b.dateEmission + b.numero));
  const compta = await exportComptable({ du, au });
  const enc = await exportEncaissements({ du, au, origine });
  const env = estSiteDeTest() ? "TEST" : "PRODUCTION";
  fichiers.push({ nom: compta.fichier, contenu: compta.csv }, { nom: enc.fichier, contenu: enc.csv },
    { nom: "donnees-documents.json", contenu: JSON.stringify({ environnement: env, periode: { du, au }, creeLe: new Date(now).toISOString(), documents: index }, null, 1) },
    { nom: "LISEZMOI.txt", contenu: [
      "Archive ELEV8 Private Driver (" + env + ") — documents émis du " + du + " au " + au + ".",
      "Créée le " + new Date(now).toLocaleString("fr-FR", { timeZone: "Europe/Paris" }) + ".", "",
      "factures/, avoirs/, devis/ : PDF des documents émis sur la période (" + index.length + ").",
      compta.fichier + " : export comptable (documents émis).",
      enc.fichier + " : journal des paiements et remboursements Stripe de la période.",
      "donnees-documents.json : données d'origine de chaque document (permettent de régénérer les PDF à l'identique).", "",
      "Pièces comptables : à conserver 10 ans, hors du site (disque, cloud), sans les modifier."].join("\r\n") });
  const zip = creerZip(fichiers, now);
  if (zip.length > ARCHIVE_MAX_OCTETS) throw new Error("archive_volumineuse");
  return { zip, documents: index.length, fichier: "elev8-archive-" + (env === "TEST" ? "TEST-" : "") + du + "_" + au + ".zip" };
}
