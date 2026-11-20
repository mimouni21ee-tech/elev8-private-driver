/* ==========================================================================
   ELEV8 Private Driver — facturation automatique
   --------------------------------------------------------------------------
   Étape 2 : paiement confirmé par Stripe          → facture d'acompte de 100 %   (série F)
   Étape 3 : « Course réalisée » validée par ELEV8 → facture finale, acompte déduit (série F)
             remboursement Stripe (total/partiel)  → avoir rattaché à la facture  (série AV)

   Schéma à valider par le comptable avant toute émission réelle (réglable) :
   FACTURATION_AUTOMATIQUE=non (variable Netlify) ou legal.facturation = "indy" (config.js)
   désactivent toute émission automatique.

   Garanties communes (emettreUnique) :
     - une clé d'émission par document (acompte-pi/<pi>, finale-ref/<réf>, avoir-pi/<pi>/<cumul>) :
       aucun double clic, aucune notification répétée, aucun traitement simultané ne produit
       un second document ;
     - le numéro est pris dans la série (unique, chronologique, sans réutilisation) en mémorisant
       quelle émission l'a pris : une émission interrompue reprend SON numéro (pas de trou) ;
     - un document émis n'est jamais modifié ni supprimé (écriture « onlyIfNew ») ;
     - l'e-mail est séparé de l'émission : en cas d'échec, la tâche horaire le renvoie, une fois.
   Site de test : magasin séparé, numéros « TEST-F-… » / « TEST-AV-… », mention « DOCUMENT DE TEST ».
   ========================================================================== */
import { magasinDevis, chargerConfig, documentDevis } from "./devis-auto.mjs";
import { emetteur, manquants, pdf, montants, aujourdhuiParis, designationAuto } from "./documents.mjs";
import { numeroSuivant, numeroAttribue } from "./numerotation.mjs";
import { estSiteDeTest } from "./environnement.mjs";
import { modifier } from "./paiements.mjs";
import { demandeDe, envoyerUneFois } from "./notifications.mjs";
import { mailFactureAcompte, mailFactureFinale, mailAvoir } from "./courriels.mjs";

const env = (k) => (process.env[k] || "").trim();
export const facturationAutomatique = () => env("FACTURATION_AUTOMATIQUE").toLowerCase() !== "non";
export const MODE_STRIPE_CARTE = "carte bancaire via Stripe";
const cleDoc = (numero) => (/(^|-)AV-/.test(numero) ? "avoir/" : "facture/") + numero;
const histo = (x, quoi, now) => (x.historique || []).concat([{ le: new Date(now).toISOString(), quoi }]).slice(-40);

/* ---------- Émission unique d'un document numéroté ---------- */
async function emettreUnique(st, cle, serie, now, fabriquer) {
  const lire = async (l) => (l && l.numero ? st.get(cleDoc(l.numero), { type: "json" }) : null);
  let l = await st.get(cle, { type: "json" });
  if (l && l.numero) return { record: await lire(l), nouvelle: false };
  const annee = aujourdhuiParis(now).slice(0, 4);
  let reprise = null;
  const pose = await st.setJSON(cle, { numero: null, t: now }, { onlyIfNew: true });
  if (pose && pose.modified === false) {
    const cur = await st.getWithMetadata(cle, { type: "json" });
    l = cur && cur.data;
    if (l && l.numero) return { record: await lire(l), nouvelle: false };
    if (l && now - (l.t || 0) < 120_000) return { occupe: true };                  // émission en cours ailleurs
    // Émission interrompue : on reprend le verrou, et le numéro qu'elle avait déjà pris s'il est libre
    const r = await st.setJSON(cle, { numero: null, t: now }, { onlyIfMatch: cur.etag });
    if (!r || !r.modified) return { occupe: true };
    reprise = await numeroAttribue(st, annee, serie, cle, async (n) => !!(await st.get(cleDoc(n), { type: "json" })));
  }
  const numero = reprise || await numeroSuivant(st, annee, serie, cle);
  const record = fabriquer(numero, aujourdhuiParis(now));
  await st.setJSON(cleDoc(numero), record, { onlyIfNew: true });
  await st.setJSON(cle, { numero, t: now });
  return { record: (await st.get(cleDoc(numero), { type: "json" })) || record, nouvelle: true };
}

async function contexte(p, now) {
  const E = emetteur(await chargerConfig(p.origine));
  if (E.facturation === "indy") return { ignore: "indy" };
  if (manquants(E).length) throw new Error("emetteur");
  return { E, D: await demandeDe(p, now) };
}

/* ======================= Facture d'acompte (étape 2) ======================= */
export async function emettreAcompte(p, { now = Date.now() } = {}) {
  if (!facturationAutomatique()) return { ignore: "desactivee" };
  if (!p || p.statut !== "paye" || !p.paymentIntent || !p.payeLe) return { ignore: "non_paye" };
  const st = magasinDevis();
  const cle = "acompte-pi/" + p.paymentIntent;
  const deja = await st.get(cle, { type: "json" });
  if (deja && deja.numero) return { record: await st.get("facture/" + deja.numero, { type: "json" }), nouvelle: false };
  const c = await contexte(p, now);
  if (c.ignore) return c;
  const final = await st.get("ref/" + p.ref, { type: "json" });
  if (final && final.numero) return { ignore: "facture_existante" };          // facture déjà établie à la main : pas d'acompte en plus
  if (!c.D) throw new Error("demande");
  let doc = null;                                                              // document facturé = devis accepté (mêmes lignes)
  if (p.devis && p.devis.numero) {
    const dv = await st.get("devis/" + p.devis.numero, { type: "json" });
    if (dv && dv.montantCents === p.montantCents) doc = structuredClone(dv.doc);
  }
  if (!doc) doc = documentDevis(c.D, p, null, p.valableJusqu, aujourdhuiParis(now));
  const mt = montants(doc.montant, c.E, doc.supplements);
  if (Math.round(mt.ttc * 100) !== p.montantCents) throw new Error("montant");   // jamais de facture différente du paiement
  if (!doc.prestation.designation) doc.prestation.designation = designationAuto(doc.prestation);
  const r = await emettreUnique(st, cle, "F", now, (numero, dateEmission) => ({
    numero, type: "acompte", ref: p.ref, dateEmission, horodatage: new Date(now).toISOString(), emetteur: c.E, doc, montants: mt,
    acompte: { pourcentage: 100, montantCents: p.montantCents, dateEncaissement: aujourdhuiParis(Date.parse(p.payeLe)),
      mode: MODE_STRIPE_CARTE, reference: p.paymentIntent, devis: p.devis ? p.devis.numero : "" },
    test: estSiteDeTest() }));
  if (r.nouvelle) await st.setJSON("acompte-ref/" + p.ref, { numero: r.record.numero });
  return r;
}

/* ======================= Facture finale (étape 3) =======================
   Après « Course réalisée » : prestation complète, acompte déduit avec son numéro, solde 0,00 €.
   Remboursement partiel AVANT la facture finale : il a déjà fait l'objet d'un avoir sur l'acompte ;
   la facture finale porte alors sur le montant réellement dû (prix − remboursements), et déduit
   l'acompte net de ces avoirs. */
export async function emettreFinale(p, { now = Date.now() } = {}) {
  if (!facturationAutomatique()) return { ignore: "desactivee" };
  if (!p || p.etape !== "realisee" || !["paye", "rembourse_partiel"].includes(p.statut)) return { ignore: "non_realisee" };
  const st = magasinDevis();
  const l = await st.get("acompte-ref/" + p.ref, { type: "json" });
  const acompte = l && l.numero ? await st.get("facture/" + l.numero, { type: "json" }) : null;
  if (!acompte) return { ignore: "acompte_absent" };
  const deja = await st.get("finale-ref/" + p.ref, { type: "json" });
  if (deja && deja.numero) return { record: await st.get("facture/" + deja.numero, { type: "json" }), nouvelle: false };
  const c = await contexte(p, now);
  if (c.ignore) return c;
  const avoirs = await avoirsDe(st, p);
  const rembourse = avoirs.reduce((a, x) => a + x.avoir.montantCents, 0);
  const doc = structuredClone(acompte.doc);
  if (rembourse > 0) doc.supplements = (doc.supplements || []).concat(avoirs.map((x) => ({ libelle: "Remboursement accordé (avoir " + x.numero + ")", montant: -x.avoir.montantCents / 100 })));
  const mt = montants(doc.montant, acompte.emetteur, doc.supplements);
  const netAcompte = acompte.acompte.montantCents - rembourse;
  if (Math.round(mt.ttc * 100) !== netAcompte) throw new Error("montant");
  const dateReal = aujourdhuiParis(Date.parse(p.realisation.le));
  doc.facture = { datePrestation: dateReal, paye: true, datePaiement: acompte.acompte.dateEncaissement, modePaiement: MODE_STRIPE_CARTE, referencePaiement: p.paymentIntent, echeanceJours: 0 };
  return emettreUnique(st, "finale-ref/" + p.ref, "F", now, (numero, dateEmission) => ({
    numero, type: "finale", ref: p.ref, dateEmission, horodatage: new Date(now).toISOString(), emetteur: acompte.emetteur, doc, montants: mt,
    finale: { realisation: p.realisation.le, heureRealisation: new Date(p.realisation.le).toLocaleTimeString("fr-FR", { timeZone: "Europe/Paris", hour: "2-digit", minute: "2-digit" }).replace(":", "h"),
      acompte: { numero: acompte.numero, date: acompte.dateEmission, montantCents: acompte.acompte.montantCents },
      avoirs: avoirs.map((x) => ({ numero: x.numero, date: x.dateEmission, montantCents: x.avoir.montantCents })),
      deductionCents: netAcompte, soldeCents: 0, reference: p.paymentIntent, mode: MODE_STRIPE_CARTE },
    test: estSiteDeTest() }));
}

/* ======================= Avoirs (étape 3) =======================
   Un avoir par tranche de remboursement : clé avoir-pi/<pi>/<cumul remboursé>. Rattaché à la
   facture finale si elle existe, sinon à la facture d'acompte. Sans facture émise : aucun avoir
   (rien n'a été facturé). */
async function avoirsDe(st, p) {
  const nums = (p.factures && p.factures.avoirs) || [];
  const out = [];
  for (const a of nums) { const r = await st.get("avoir/" + a.numero, { type: "json" }); if (r) out.push(r); }
  return out;
}
export async function emettreAvoir(p, { cumulCents, charge = "", now = Date.now() } = {}) {
  if (!facturationAutomatique()) return { ignore: "desactivee" };
  if (!p || !p.paymentIntent || !(cumulCents > 0)) return { ignore: "aucun" };
  const st = magasinDevis();
  const cle = "avoir-pi/" + p.paymentIntent + "/" + cumulCents;
  const deja = await st.get(cle, { type: "json" });
  if (deja && deja.numero) return { record: await st.get("avoir/" + deja.numero, { type: "json" }), nouvelle: false };
  const lF = await st.get("finale-ref/" + p.ref, { type: "json" }), lA = await st.get("acompte-ref/" + p.ref, { type: "json" });
  const origine = lF && lF.numero ? await st.get("facture/" + lF.numero, { type: "json" }) : lA && lA.numero ? await st.get("facture/" + lA.numero, { type: "json" }) : null;
  if (!origine) return { ignore: "aucune_facture" };
  const dejaAvoirs = (p.factures && p.factures.avoirs) || [];
  const precedent = dejaAvoirs.reduce((a, x) => Math.max(a, x.cumulCents || 0), 0);
  const montant = cumulCents - precedent;
  if (montant <= 0) return { ignore: "deja_couvert" };
  const E = origine.emetteur;
  const doc = structuredClone(origine.doc);
  doc.montant = montant / 100; doc.supplements = [];
  doc.prestation.designation = "Remboursement — " + designationAuto(origine.doc.prestation) + " (facture " + origine.numero + ")";
  const mt = montants(doc.montant, E, []);
  const total = cumulCents >= p.montantCents;
  return emettreUnique(st, cle, "AV", now, (numero, dateEmission) => ({
    numero, type: "avoir", ref: p.ref, dateEmission, horodatage: new Date(now).toISOString(), emetteur: E, doc, montants: mt,
    avoir: { montantCents: montant, cumulCents, total, dateRemboursement: aujourdhuiParis(now), facture: { numero: origine.numero, date: origine.dateEmission, type: origine.type },
      reference: p.paymentIntent, charge, mode: MODE_STRIPE_CARTE },
    test: estSiteDeTest() }));
}

/* ---------- PDF d'un document enregistré (identique à chaque relecture) ---------- */
export function pdfFacture(rec) {
  return pdf(rec.type === "acompte" || rec.type === "finale" || rec.type === "avoir" ? rec.type : "facture", rec.doc, rec.emetteur,
    { numero: rec.numero, dateEmission: rec.dateEmission, horodatage: rec.horodatage, acompte: rec.acompte, finale: rec.finale, avoir: rec.avoir, iban: rec.iban, test: !!rec.test });
}

/* ---------- Envoi (client + copie ELEV8), séparé de l'émission ---------- */
async function envoyerDocument(stP, p, rec, cleNotif, message, now) {
  const D = await demandeDe(p, now);
  const m = message(D || { ref: p.ref, client: {} }, rec);
  m.pieces = [{ nom: rec.numero + ".pdf", contenu: await pdfFacture(rec) }];
  m.copieElev8 = true;
  const email = D && D.client && D.client.email;
  return email
    ? envoyerUneFois(stP, p, "client_" + cleNotif, m, email, now)
    : envoyerUneFois(stP, p, "elev8_" + cleNotif, { ...m, subject: "[Client sans e-mail — à transmettre] " + m.subject }, "elev8", now);
}

/* Paiement confirmé → facture d'acompte (webhook, puis relance horaire) */
export async function facturerPaiement(stPaiements, p, { now = Date.now() } = {}) {
  if (!facturationAutomatique() || !p || p.statut !== "paye") return { ignore: "non_applicable" };
  // Marque « facture attendue » posée au paiement : la tâche horaire ne reprend que ces paiements-là
  if (!(p.factures && p.factures.attendue)) await modifier(stPaiements, p.jeton, (x) => (x.factures && x.factures.attendue ? null : { ...x, factures: { ...(x.factures || {}), attendue: new Date(now).toISOString() } }));
  const r = await emettreAcompte(p, { now });
  if (!r.record) return r;
  const rec = r.record;
  await modifier(stPaiements, p.jeton, (x) => (x.factures && x.factures.acompte === rec.numero ? null
    : { ...x, factures: { ...(x.factures || {}), acompte: rec.numero }, historique: histo(x, "facture d'acompte " + rec.numero + " émise", now) }));
  const envoye = await envoyerDocument(stPaiements, p, rec, "facture_acompte", mailFactureAcompte, now);
  return { numero: rec.numero, nouvelle: r.nouvelle, envoye };
}

/* Course réalisée → facture finale */
export async function facturerRealisation(stPaiements, p, { now = Date.now() } = {}) {
  const r = await emettreFinale(p, { now });
  if (!r.record) return r;
  const rec = r.record;
  await modifier(stPaiements, p.jeton, (x) => (x.factures && x.factures.finale === rec.numero ? null
    : { ...x, factures: { ...(x.factures || {}), finale: rec.numero }, historique: histo(x, "facture finale " + rec.numero + " émise", now) }));
  const envoye = await envoyerDocument(stPaiements, p, rec, "facture_finale", mailFactureFinale, now);
  return { numero: rec.numero, nouvelle: r.nouvelle, envoye };
}

/* Remboursement Stripe → avoir(s) jusqu'à couvrir le montant remboursé */
export async function facturerRemboursement(stPaiements, p, { charge = "", now = Date.now() } = {}) {
  if (!p || !(p.rembourseCents > 0)) return { ignore: "aucun" };
  const r = await emettreAvoir(p, { cumulCents: p.rembourseCents, charge, now });
  if (!r.record) return r;
  const rec = r.record;
  await modifier(stPaiements, p.jeton, (x) => {
    const av = (x.factures && x.factures.avoirs) || [];
    if (av.some((a) => a.numero === rec.numero)) return null;
    return { ...x, factures: { ...(x.factures || {}), avoirs: av.concat([{ numero: rec.numero, cumulCents: rec.avoir.cumulCents }]) }, historique: histo(x, "avoir " + rec.numero + " émis (" + (rec.avoir.montantCents / 100).toFixed(2) + " €)", now) };
  });
  const envoye = await envoyerDocument(stPaiements, p, rec, "avoir_" + rec.numero, mailAvoir, now);
  return { numero: rec.numero, nouvelle: r.nouvelle, envoye };
}

/* Renvoi des avoirs déjà émis dont l'e-mail n'est pas parti (tâche horaire) */
export async function relancerAvoirs(stPaiements, p, { now = Date.now() } = {}) {
  const st = magasinDevis();
  let n = 0;
  for (const a of (p.factures && p.factures.avoirs) || []) {
    const notif = p.notifications || {};
    if (notif["client_avoir_" + a.numero] || notif["elev8_avoir_" + a.numero]) continue;
    const rec = await st.get("avoir/" + a.numero, { type: "json" });
    if (rec && await envoyerDocument(stPaiements, p, rec, "avoir_" + rec.numero, mailAvoir, now)) n++;
  }
  return n;
}

/* ---------- Tâche horaire : documents restant à émettre ou à envoyer ---------- */
const envoye = (p, cle) => { const n = p.notifications || {}; return !!(n["client_" + cle] || n["elev8_" + cle]); };
export function acompteEnAttente(p) {
  if (!facturationAutomatique() || !p || p.statut !== "paye" || !p.paymentIntent || !(p.factures && p.factures.attendue)) return false;
  return !(p.factures && p.factures.acompte) || !envoye(p, "facture_acompte");
}
export function finaleEnAttente(p) {
  if (!facturationAutomatique() || !p || p.etape !== "realisee" || !(p.factures && p.factures.acompte)) return false;
  return !p.factures.finale || !envoye(p, "facture_finale");
}
export function avoirEnAttente(p) {
  if (!facturationAutomatique() || !p || !(p.rembourseCents > 0) || !(p.factures && p.factures.acompte)) return false;
  const av = p.factures.avoirs || [];
  const couvert = av.reduce((a, x) => Math.max(a, x.cumulCents || 0), 0);
  return couvert < p.rembourseCents || av.some((a) => !envoye(p, "avoir_" + a.numero));
}
