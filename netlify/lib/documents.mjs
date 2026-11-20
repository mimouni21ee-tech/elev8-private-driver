/* ==========================================================================
   ELEV8 Private Driver — devis et factures PDF
   --------------------------------------------------------------------------
   Utilisé par netlify/functions/documents.mjs (page /documents, réservée à ELEV8).

   - Devis : établi à partir d'une demande. « DEVIS PROVISOIRE » tant que le tarif
     n'est pas validé par ELEV8 ; « DEVIS » (avec « Bon pour accord ») une fois validé.
     Non numéroté séparément : D-<référence de la demande>. Rien n'est conservé.
   - Facture : établie APRÈS la prestation, avec le montant définitif. Numéro unique,
     chronologique et sans trou (F-AAAA-0001, F-AAAA-0002…), attribué par le serveur.
     Une facture émise est conservée (Netlify Blobs, obligation comptable de 10 ans)
     et n'est plus modifiable : la redemander renvoie exactement la même facture.
   - Identité de l'émetteur : rubrique « legal » de public/config.js (la même que les
     mentions légales). Tant qu'elle contient des valeurs « [À compléter] », aucun
     document n'est produit.
   Montants : le montant saisi est le prix payé par le client (TTC). Si ELEV8 est
   assujetti à la TVA, le PDF détaille HT, TVA et TTC ; en franchise en base, il
   porte la mention « TVA non applicable, art. 293 B du CGI ».
   ========================================================================== */
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

/* ---------- Émetteur ---------- */
const vide = (v) => v == null || String(v).trim() === "" || /^\s*\[/.test(String(v));
export function emetteur(C) {
  const L = (C && C.legal) || {}, K = (C && C.contact) || {}, S = (C && C.site) || {};
  return {
    nom: String(L.raisonSociale || "").trim(),
    nomCommercial: String(L.nomCommercial || "").trim(),
    modesPaiement: String(L.modesPaiement || "").trim(),
    facturation: String(L.facturation || "site").trim().toLowerCase(),   // "site" ou "indy"
    forme: String(L.formeJuridique || "").trim(),
    adresse: String(L.adresse || "").trim(),
    siret: String(L.siret || "").trim(),
    tva: String(L.tva || "").trim(),
    regimeTVA: String(L.regimeTVA || "").trim(),               // "franchise" ou "assujetti"
    tauxTVA: Number(L.tauxTVA),                                 // ex. 10 (transport de personnes)
    capital: String(L.capital || "").trim(),
    rcs: String(L.immatriculation || "").trim(),                // RCS / RNE, le cas échéant
    registreVTC: String(L.registreVTC || "").trim(),
    penalites: String(L.penalitesRetard || "").trim(),
    telephone: String(K.telephoneAffiche || K.telephone || "").trim(),
    email: String(K.email || "").trim(),
    site: String(S.url || "").replace(/^https?:\/\//, "").replace(/\/$/, "")
  };
}
/* Informations obligatoires manquantes (libellés compréhensibles) */
export function manquants(e) {
  const m = [];
  if (vide(e.nom)) m.push("raison sociale ou nom de l'entrepreneur (legal.raisonSociale)");
  if (vide(e.forme)) m.push("forme juridique (legal.formeJuridique)");
  if (vide(e.adresse)) m.push("adresse du siège (legal.adresse)");
  if (vide(e.siret)) m.push("numéro SIRET (legal.siret)");
  if (/\b(SAS|SASU|SARL|EURL|SA|SNC|SCA|SELARL|SELAS)\b/i.test(e.forme)) {
    if (vide(e.capital)) m.push("capital social, obligatoire pour une société (legal.capital)");
    if (vide(e.rcs)) m.push("immatriculation RCS (legal.immatriculation)");
  }
  if (e.regimeTVA !== "franchise" && e.regimeTVA !== "assujetti") m.push("régime de TVA (legal.regimeTVA : \"franchise\" ou \"assujetti\")");
  if (e.regimeTVA === "assujetti") {
    if (!(e.tauxTVA > 0 && e.tauxTVA < 30)) m.push("taux de TVA (legal.tauxTVA, ex. 10)");
    if (vide(e.tva)) m.push("numéro de TVA intracommunautaire (legal.tva)");
  }
  return m;
}

/* ---------- Montants (centimes exacts) ----------
   Les prix saisis sont ceux payés par le client (TTC). Avec TVA : HT de chaque ligne arrondi
   au centime, total HT = somme des lignes, TVA = TTC − HT (le total TTC reste exact). */
export function montants(prixClient, e, supplements = []) {
  const lignes = [+prixClient, ...supplements.map((x) => +x.montant)].map((v) => Math.round(v * 100));
  const ttc = lignes.reduce((a, b) => a + b, 0);
  if (e.regimeTVA === "assujetti") {
    const ht = lignes.map((v) => Math.round(v / (1 + e.tauxTVA / 100)));
    const totalHt = ht.reduce((a, b) => a + b, 0);
    return { ht: totalHt / 100, tva: (ttc - totalHt) / 100, ttc: ttc / 100, taux: e.tauxTVA, franchise: false, lignesHt: ht.map((v) => v / 100) };
  }
  return { ht: ttc / 100, tva: 0, ttc: ttc / 100, taux: 0, franchise: true, lignesHt: lignes.map((v) => v / 100) };
}
export const euros = (n) => {
  const [e, c] = (Math.round(n * 100) / 100).toFixed(2).split(".");
  return e.replace(/\B(?=(\d{3})+(?!\d))/g, " ") + "," + c + " €";
};
const MOIS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
const JOURS = ["dimanche", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi"];
export function dateFr(iso, avecJour) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ""));
  if (!m) return "";
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return (avecJour ? JOURS[d.getUTCDay()] + " " : "") + (+m[3] === 1 ? "1er" : +m[3]) + " " + MOIS[+m[2] - 1] + " " + m[1];
}
export function aujourdhuiParis(now = Date.now()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit" })
    .formatToParts(new Date(now)).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}`;
}
const ajouterJours = (iso, n) => { const d = new Date(iso + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

/* ---------- Données d'un document (nettoyées, bornées) ---------- */
const s = (v, n = 200) => (typeof v === "string" ? v.replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, " ").trim().slice(0, n) : "");
const reDate = /^\d{4}-\d{2}-\d{2}$/, reHeure = /^([01]\d|2[0-3]):[0-5]\d$/;
/* Mode de règlement indiqué sur le devis : « auto » = déterminé par le serveur (paiement en ligne si un
   lien Stripe existe pour la réservation, sinon règlement après la prestation). */
export const REGLEMENTS = ["auto", "en_ligne", "apres", "virement_avant"];

/* Textes du devis selon le règlement réellement prévu (meta.reglement, établi par le serveur) :
   { mode: "en_ligne" | "apres" | "virement_avant", etat: "a_payer" | "paye" | "rembourse",
     montant, payeLe, reference, valableJusqu, chauffeur } */
export function textesDevis(doc, e, meta, totalTtc) {
  const provisoire = !doc.devis.valide, r = meta.reglement || { mode: "apres" };
  const validite = "Devis valable jusqu'au " + dateFr(ajouterJours(meta.dateEmission, doc.devis.validiteJours)) + ".";
  const verif = "ELEV8 vérifie la disponibilité du chauffeur et du véhicule, puis vous confirme le tarif définitif.";
  const attribution = "La réservation n'est définitivement confirmée qu'après l'acceptation de la course par un chauffeur ; vous en êtes informé par e-mail.";
  const rembourse = "si aucun chauffeur n'est disponible, le montant réglé vous est intégralement remboursé.";
  const Rembourse = "S" + rembourse.slice(1);
  const lienJusqu = r.valableJusqu ? " (lien valable jusqu'au " + dateFr(r.valableJusqu) + ")" : "";
  if (r.mode === "en_ligne") {
    if (provisoire) return { titre: "Étapes suivantes", signature: false, paragraphes: [verif + " Vous recevrez alors un lien de paiement sécurisé : le règlement s'effectue en ligne, par carte bancaire, avant l'attribution du chauffeur. " + attribution + " " + Rembourse] };
    if (r.etat === "rembourse") return { bandeau: "Réservation annulée : le montant réglé de " + euros(r.montant) + " vous a été intégralement remboursé.", titre: "Règlement", signature: false,
      paragraphes: ["Le règlement effectué en ligne a été intégralement remboursé sur le moyen de paiement utilisé. Aucun montant ne reste dû."] };
    if (r.etat === "paye") {
      const recu = "Règlement de " + euros(r.montant) + " reçu en ligne le " + dateFr(r.payeLe) + (r.reference ? " (référence : " + r.reference + ")" : "") + ".";
      return r.chauffeur
        ? { bandeau: recu + " Réservation confirmée : un chauffeur a accepté votre course.", titre: "Réservation confirmée", signature: false,
            paragraphes: [recu + " Un chauffeur a accepté votre course : votre réservation est définitivement confirmée.", "En cas d'empêchement de dernière minute et sans chauffeur de remplacement, le montant réglé vous serait intégralement remboursé."] }
        : { bandeau: recu + " Votre course est en cours d'attribution à un chauffeur.", titre: "Étapes suivantes", signature: false,
            paragraphes: ["1. Règlement : " + euros(r.montant) + " reçus en ligne le " + dateFr(r.payeLe) + (r.reference ? " (référence : " + r.reference + ")" : "") + ", valant acceptation du présent devis.",
              "2. Attribution : votre course est proposée à nos chauffeurs. " + attribution, "3. Indisponibilité : " + rembourse] };
    }
    return { bandeau: validite + " Le règlement s'effectue en ligne, avant l'attribution du chauffeur, avec le lien de paiement sécurisé transmis par ELEV8.", titre: "Étapes suivantes", signature: false,
      paragraphes: ["1. Règlement : réglez " + euros(totalTtc) + " TTC en ligne, par carte bancaire, avec le lien de paiement sécurisé transmis par ELEV8" + lienJusqu + ". Le paiement vaut acceptation du présent devis.",
        "2. Attribution : votre course est ensuite proposée à nos chauffeurs. " + attribution, "3. Indisponibilité : " + rembourse] };
  }
  if (r.mode === "virement_avant") {
    const virement = "Règlement par virement bancaire avant la prestation, selon les modalités convenues avec ELEV8 ; la réservation est confirmée à réception du règlement.";
    if (provisoire) return { titre: "Étapes suivantes", signature: false, paragraphes: [verif + " Votre réservation est définitive uniquement après cette confirmation et votre accord. " + virement] };
    return { bandeau: validite + " Après votre accord, le règlement s'effectue par virement bancaire avant la prestation.", titre: "Bon pour accord", signature: true,
      paragraphes: ["Pour accepter ce devis, répondez simplement « J'accepte » par e-mail ou par WhatsApp, ou retournez-le daté et signé avec la mention « Bon pour accord ». " + virement] };
  }
  // Règlement après la prestation (fonctionnement d'origine, inchangé)
  const apres = e.modesPaiement ? " Règlement après la prestation, par " + e.modesPaiement + "." : "";
  if (provisoire) return { titre: "Étapes suivantes", signature: false, paragraphes: [verif + " Votre réservation est définitive uniquement après cette confirmation et votre accord." + apres] };
  return { bandeau: validite + " Aucun paiement n'est demandé à cette étape : la réservation est confirmée par ELEV8 après votre accord.", titre: "Bon pour accord", signature: true,
    paragraphes: ["Pour accepter ce devis, répondez simplement « J'accepte » par e-mail ou par WhatsApp, ou retournez-le daté et signé avec la mention « Bon pour accord »." + apres] };
}

export function nettoyer(d) {
  d = d || {};
  const c = d.client || {}, p = d.prestation || {}, f = d.facture || {}, v = d.devis || {};
  const date = (x) => (reDate.test(s(x, 10)) ? s(x, 10) : "");
  return {
    ref: s(d.ref, 40).replace(/[^A-Z0-9-]/gi, "").toUpperCase(),
    client: { prenom: s(c.prenom, 60), nom: s(c.nom, 60), societe: s(c.societe, 120), adresse: s(c.adresse, 300),
      siren: s(c.siren, 40), tvaIntra: s(c.tvaIntra, 40), email: s(c.email, 120), telephone: s(c.telephone, 30) },
    prestation: {
      designation: s(p.designation, 300), date: date(p.date), heure: reHeure.test(s(p.heure, 5)) ? s(p.heure, 5) : "",
      depart: s(p.depart, 200), destination: s(p.destination, 200), allerRetour: p.allerRetour === true,
      dateRetour: date(p.dateRetour), heureRetour: reHeure.test(s(p.heureRetour, 5)) ? s(p.heureRetour, 5) : "",
      vehicule: s(p.vehicule, 100), passagers: Math.max(0, Math.min(20, parseInt(p.passagers, 10) || 0)),
      bagages: p.bagages === "" || p.bagages == null ? null : Math.max(0, Math.min(30, parseInt(p.bagages, 10) || 0)),
      precisions: s(p.precisions, 600), reference: s(p.reference, 30), distanceKm: +p.distanceKm > 0 ? Math.round(+p.distanceKm * 10) / 10 : null
    },
    montant: Math.round((+String(d.montant).replace(",", ".") || 0) * 100) / 100,
    supplements: (Array.isArray(d.supplements) ? d.supplements : []).slice(0, 5)
      .map((x) => ({ libelle: s(x && x.libelle, 120), montant: Math.round((+String(x && x.montant).replace(",", ".") || 0) * 100) / 100 }))
      .filter((x) => x.libelle && x.montant > 0 && x.montant <= 10000),
    devis: { valide: v.valide === true, validiteJours: Math.max(1, Math.min(90, parseInt(v.validiteJours, 10) || 15)),
      reglement: REGLEMENTS.includes(v.reglement) ? v.reglement : "auto" },
    facture: { datePrestation: date(f.datePrestation), paye: f.paye === true, datePaiement: date(f.datePaiement),
      modePaiement: s(f.modePaiement, 40), referencePaiement: s(f.referencePaiement, 60), echeanceJours: Math.max(0, Math.min(60, parseInt(f.echeanceJours, 10) || 0)) }
  };
}
/* Contrôles avant production (renvoie la liste des champs à compléter) */
export function aCompleter(doc, type) {
  const m = [], c = doc.client, p = doc.prestation;
  if (!doc.ref) m.push("ref");
  if (!c.nom && !c.societe) m.push("client.nom");
  if (!p.designation && !(p.depart && p.destination)) m.push("prestation.designation");
  if (!(doc.montant > 0) || doc.montant > 100000) m.push("montant");
  if (type === "facture") {
    if (c.adresse.length < 8) m.push("client.adresse");
    if (!doc.facture.datePrestation) m.push("facture.datePrestation");
    if (doc.facture.paye && (!doc.facture.datePaiement || !doc.facture.modePaiement)) m.push("facture.paiement");
  }
  return m;
}
export function designationAuto(p) {
  if (p.designation) return p.designation;
  return "Transport de personnes avec chauffeur (VTC)" + (p.allerRetour ? " — aller-retour" : "");
}

/* ---------- PDF ---------- */
const NOIR = rgb(0.043, 0.039, 0.035), OR = rgb(0.737, 0.655, 0.514), OR_FONCE = rgb(0.545, 0.463, 0.314),
  IVOIRE = rgb(0.957, 0.937, 0.902), GRIS = rgb(0.42, 0.40, 0.37), FILET = rgb(0.86, 0.83, 0.78), TEXTE = rgb(0.11, 0.10, 0.09),
  FOND_DOUX = rgb(0.985, 0.972, 0.945);

export async function pdf(type, doc, e, meta = {}) {
  const P = await PDFDocument.create();
  P.setTitle((type === "facture" ? "Facture " + meta.numero : "Devis " + meta.numero) + " — ELEV8 Private Driver");
  P.setAuthor(e.nom || "ELEV8 Private Driver"); P.setCreator("ELEV8 Private Driver"); P.setProducer("ELEV8 Private Driver");
  const horodatage = new Date(meta.horodatage || Date.now());
  P.setCreationDate(horodatage); P.setModificationDate(horodatage);   // facture redemandée : fichier identique à l'octet près
  const F = { r: await P.embedFont(StandardFonts.Helvetica), b: await P.embedFont(StandardFonts.HelveticaBold),
    t: await P.embedFont(StandardFonts.TimesRoman), ti: await P.embedFont(StandardFonts.TimesRomanItalic) };
  const cache = new Map();
  const w = (txt) => {                                   // caractères hors de l'encodage PDF standard remplacés
    let out = "";
    for (const ch of String(txt == null ? "" : txt).normalize("NFC").replace(/[   ]/g, " ").replace(/[‘’]/g, "'").replace(/[“”]/g, '"')) {
      if (!cache.has(ch)) { try { F.r.encodeText(ch); cache.set(ch, ch); } catch { cache.set(ch, ch === "\n" ? "\n" : "?"); } }
      out += cache.get(ch);
    }
    return out;
  };
  const W = 595.28, H = 841.89, M = 48;
  let page = P.addPage([W, H]), y = 0;
  const txt = (t, x, yy, o = {}) => page.drawText(w(t), { x, y: yy, size: o.size || 9.5, font: o.font || F.r, color: o.color || TEXTE, ...(o.cs ? { characterSpacing: o.cs } : {}) });
  const largeur = (t, font = F.r, size = 9.5, cs = 0) => font.widthOfTextAtSize(w(t), size) + cs * Math.max(0, w(t).length - 1);
  const couper = (t, maxW, font = F.r, size = 9.5) => {
    const lignes = [];
    for (const par of w(t).split("\n")) {
      let cur = "";
      for (const mot of par.split(/\s+/)) {
        const essai = cur ? cur + " " + mot : mot;
        if (font.widthOfTextAtSize(essai, size) <= maxW) cur = essai;
        else { if (cur) lignes.push(cur); cur = mot; while (font.widthOfTextAtSize(cur, size) > maxW) { let k = cur.length - 1; while (k > 1 && font.widthOfTextAtSize(cur.slice(0, k), size) > maxW) k--; lignes.push(cur.slice(0, k)); cur = cur.slice(k); } }
      }
      lignes.push(cur);
    }
    return lignes;
  };
  const bloc = (t, x, maxW, o = {}) => { for (const l of couper(t, maxW, o.font || F.r, o.size || 9.5)) { besoin(14); txt(l, x, y, o); y -= o.lh || 13; } };
  const piedHauteur = 92;
  const nouvellePage = () => { page = P.addPage([W, H]); y = H - M; };
  const besoin = (h) => { if (y - h < M + piedHauteur) nouvellePage(); };
  const filet = (yy, x1 = M, x2 = W - M, c = FILET, t = 0.6) => page.drawLine({ start: { x: x1, y: yy }, end: { x: x2, y: yy }, thickness: t, color: c });
  const etiquette = (t, x, yy) => txt(t.toUpperCase(), x, yy, { size: 6.8, font: F.b, color: OR_FONCE, cs: 1.4 });

  /* En-tête noir et or */
  const provisoire = type === "devis" && !doc.devis.valide;
  const titre = type === "facture" ? "Facture" : provisoire ? "Devis provisoire" : "Devis";
  page.drawRectangle({ x: 0, y: H - 118, width: W, height: 118, color: NOIR });
  page.drawRectangle({ x: 0, y: H - 120, width: W, height: 2, color: OR });
  txt("ELEV8", M, H - 64, { font: F.t, size: 30, color: OR, cs: 5 });
  txt("PRIVATE DRIVER", M + 1, H - 82, { size: 7.2, color: rgb(0.85, 0.80, 0.70), cs: 3.2 });
  const tW = largeur(titre, F.ti, 24);
  txt(titre, W - M - tW, H - 60, { font: F.ti, size: 24, color: IVOIRE });
  const sous = (type === "facture" ? "N° " : "Réf. ") + meta.numero + "  ·  " + dateFr(meta.dateEmission);
  txt(sous, W - M - largeur(sous, F.r, 8.5), H - 82, { size: 8.5, color: rgb(0.85, 0.80, 0.70) });
  y = H - 150;

  /* Émetteur / client */
  const col2 = W / 2 + 10, cw = W / 2 - M - 20;
  etiquette("Émetteur", M, y); etiquette(type === "facture" ? "Facturé à" : "Client", col2, y);
  y -= 16;
  const yDebut = y;
  const identite = e.nom + (e.forme ? ", " + e.forme : "") + (e.capital && !vide(e.capital) ? " au capital de " + e.capital : "");
  const lignesEmetteur = [
    ...(e.nomCommercial && e.nomCommercial.toLowerCase() !== e.nom.toLowerCase() ? [[e.nomCommercial, F.b], [identite, F.r]] : [[identite, F.b]]),
    [e.adresse, F.r],
    ["SIRET " + e.siret + (e.rcs ? "  ·  " + e.rcs : ""), F.r],
    ...(e.regimeTVA === "assujetti" && e.tva ? [["TVA intracommunautaire : " + e.tva, F.r]] : []),
    ...(e.registreVTC && !vide(e.registreVTC) ? [["Registre VTC : " + e.registreVTC, F.r]] : []),
    [[e.telephone, e.email].filter(Boolean).join("  ·  "), F.r]
  ];
  for (const [l, f] of lignesEmetteur) for (const x of couper(l, cw, f, 9)) { txt(x, M, y, { font: f, size: 9 }); y -= 12.5; }
  const yGauche = y; y = yDebut;
  const c = doc.client, nomClient = [c.prenom, c.nom].filter(Boolean).join(" ");
  const lignesClient = [
    ...(c.societe ? [[c.societe, F.b], ...(nomClient ? [["À l'attention de " + nomClient, F.r]] : [])] : [[nomClient, F.b]]),
    ...(c.adresse ? [[c.adresse, F.r]] : type === "devis" ? [] : []),
    ...(c.siren ? [["SIREN / SIRET : " + c.siren, F.r]] : []),
    ...(c.tvaIntra ? [["TVA intracommunautaire : " + c.tvaIntra, F.r]] : []),
    ...([c.telephone, c.email].filter(Boolean).length ? [[[c.telephone, c.email].filter(Boolean).join("  ·  "), F.r]] : [])
  ];
  for (const [l, f] of lignesClient) for (const x of couper(l, cw, f, 9)) { txt(x, col2, y, { font: f, size: 9 }); y -= 12.5; }
  y = Math.min(y, yGauche) - 14;

  /* Bandeau d'état */
  const TD = type === "devis" ? textesDevis(doc, e, meta, montants(doc.montant, e, doc.supplements).ttc) : null;
  if (provisoire || type === "devis") {
    const msg = provisoire
      ? "DEVIS PROVISOIRE — Tarif indicatif, sous réserve de validation de la disponibilité et des conditions du trajet par ELEV8 Private Driver. Aucun paiement n'est demandé à cette étape."
      : TD.bandeau;
    const l = couper(msg, W - 2 * M - 24, provisoire ? F.b : F.r, 8.8), h = l.length * 12 + 14;
    page.drawRectangle({ x: M, y: y - h + 4, width: W - 2 * M, height: h, color: FOND_DOUX, borderColor: OR, borderWidth: provisoire ? 1.2 : 0.6 });
    let yy = y - 9;
    for (const x of l) { txt(x, M + 12, yy, { font: provisoire ? F.b : F.r, size: 8.8, color: provisoire ? OR_FONCE : TEXTE }); yy -= 12; }
    y -= h + 12;
  }

  /* Prestation */
  const p = doc.prestation;
  etiquette("Prestation", M, y); y -= 6; filet(y); y -= 15;
  const quand = (d, h) => [dateFr(d, true), h ? "à " + h.replace(":", "h") : ""].filter(Boolean).join(" ");
  const lignesP = [
    ["Date", type === "facture" ? dateFr(doc.facture.datePrestation, true) + (p.heure && doc.facture.datePrestation === p.date ? " à " + p.heure.replace(":", "h") : "") : quand(p.date, p.heure)],
    ["Départ", p.depart], ["Destination", p.destination],
    ...(p.allerRetour ? [["Retour", quand(p.dateRetour, p.heureRetour) || "Aller-retour"]] : []),
    ["Véhicule", p.vehicule],
    ["Passagers", p.passagers ? String(p.passagers) + (p.bagages != null ? "  ·  bagages : " + p.bagages : "") : ""],
    ...(p.distanceKm ? [["Distance", String(p.distanceKm).replace(".", ",") + " km" + (p.allerRetour ? " (aller-retour)" : "")]] : []),
    ...(p.reference ? [["Vol / train", p.reference]] : []),
    ...(p.precisions ? [["Informations", p.precisions]] : [])
  ].filter((r) => r[1]);
  for (const [k, v] of lignesP) {
    const l = couper(v, W - 2 * M - 110, F.r, 9.5);
    besoin(l.length * 13 + 4);
    txt(k, M, y, { size: 8.5, color: GRIS });
    for (const x of l) { txt(x, M + 110, y); y -= 13; }
    y -= 3;
  }
  y -= 8;

  /* Tableau des montants */
  const sup = doc.supplements || [];
  const mt = montants(doc.montant, e, sup);
  besoin(120);
  page.drawRectangle({ x: M, y: y - 18, width: W - 2 * M, height: 22, color: NOIR });
  const cols = [M + 10, W - M - 250, W - M - 175, W - M - 10];
  txt("DÉSIGNATION", cols[0], y - 10, { size: 7, font: F.b, color: OR, cs: 1.2 });
  txt("QTÉ", cols[1], y - 10, { size: 7, font: F.b, color: OR, cs: 1.2 });
  txt(mt.franchise ? "PRIX UNITAIRE" : "PRIX UNIT. HT", cols[2], y - 10, { size: 7, font: F.b, color: OR, cs: 1.2 });
  const th = mt.franchise ? "MONTANT" : "TOTAL HT";
  txt(th, cols[3] - largeur(th, F.b, 7, 1.2), y - 10, { size: 7, font: F.b, color: OR, cs: 1.2 });
  y -= 36;
  const des = couper(designationAuto(p) + (p.depart && p.destination ? ", de " + p.depart + " à " + p.destination : ""), cols[1] - cols[0] - 16, F.r, 9.5);
  const yLigne = y;
  for (const x of des) { besoin(14); txt(x, cols[0], y); y -= 13; }
  const base = mt.lignesHt[0];
  txt("1", cols[1], yLigne); txt(euros(base), cols[2], yLigne);
  txt(euros(base), cols[3] - largeur(euros(base)), yLigne);
  sup.forEach((x, i) => {
    y -= 6; besoin(16);
    const l = couper("Supplément : " + x.libelle, cols[1] - cols[0] - 16, F.r, 9.5), y0 = y, v = mt.lignesHt[i + 1];
    for (const t of l) { txt(t, cols[0], y); y -= 13; }
    txt("1", cols[1], y0); txt(euros(v), cols[2], y0); txt(euros(v), cols[3] - largeur(euros(v)), y0);
  });
  y -= 4; filet(y); y -= 18;
  const total = (lib, val, fort) => {
    const f = fort ? F.b : F.r, size = fort ? 11 : 9.5;
    txt(lib, W - M - 230, y, { font: f, size, color: fort ? TEXTE : GRIS });
    txt(val, W - M - 10 - largeur(val, f, size), y, { font: f, size });
    y -= fort ? 18 : 14;
  };
  if (mt.franchise) {
    total(type === "facture" ? "Total à payer" : "Total", euros(mt.ttc), true);
  } else {
    total("Total HT", euros(mt.ht)); total("TVA " + String(mt.taux).replace(".", ",") + " %", euros(mt.tva));
    y -= 6;
    page.drawRectangle({ x: W - M - 240, y: y - 6, width: 240, height: 20, color: FOND_DOUX });
    total("Total TTC", euros(mt.ttc), true);
  }
  if (mt.franchise) { txt("TVA non applicable, art. 293 B du CGI", W - M - 230, y, { size: 8, font: F.ti, color: GRIS }); y -= 14; }
  y -= 10;

  /* Paiement / validation */
  if (type === "facture") {
    besoin(60); etiquette("Paiement", M, y); y -= 6; filet(y); y -= 15;
    const fa = doc.facture;
    if (fa.paye) bloc("Facture acquittée le " + dateFr(fa.datePaiement) + " — règlement par " + fa.modePaiement + (fa.referencePaiement ? " (référence : " + fa.referencePaiement + ")" : "") + ".", M, W - 2 * M, { font: F.b });
    else {
      const ech = ajouterJours(meta.dateEmission, fa.echeanceJours);
      bloc("Date d'échéance : " + dateFr(ech) + (fa.echeanceJours === 0 ? " (paiement à réception)" : "") + "." + (e.modesPaiement ? " Règlement par " + e.modesPaiement + "." : fa.modePaiement ? " Mode de règlement : " + fa.modePaiement + "." : ""), M, W - 2 * M);
      if (meta.iban) bloc("Virement : " + meta.iban, M, W - 2 * M);
    }
    y -= 4;
    const mentions = [
      "Prestation de services. Date de la prestation : " + dateFr(doc.facture.datePrestation) + ".",
      "Pas d'escompte pour paiement anticipé.",
      "En cas de retard de paiement : pénalités au taux " + (e.penalites || "égal à trois fois le taux d'intérêt légal") + ", et, pour les clients professionnels, indemnité forfaitaire pour frais de recouvrement de 40 € (articles L441-10 et D441-5 du Code de commerce)."
    ];
    for (const x of mentions) bloc(x, M, W - 2 * M, { size: 7.8, color: GRIS, lh: 11 });
  } else {
    besoin(70);
    etiquette(TD.titre, M, y); y -= 6; filet(y); y -= 15;
    TD.paragraphes.forEach((p, i) => { if (i) y -= 4; bloc(p, M, W - 2 * M); });
    if (TD.signature) {
      y -= 6;
      page.drawRectangle({ x: W - M - 220, y: y - 52, width: 220, height: 56, borderColor: FILET, borderWidth: 0.8 });
      txt("Date et signature du client", W - M - 210, y - 8, { size: 7.5, color: GRIS });
      y -= 64;
    }
  }

  /* Pied de page sur chaque page */
  const pages = P.getPages();
  pages.forEach((pg, i) => {
    page = pg;
    filet(M + 44, M, W - M, OR, 0.8);
    const l1 = [identite, "siège social : " + e.adresse].filter(Boolean).join("  ·  ");
    const l2 = ["SIRET " + e.siret, e.rcs, e.regimeTVA === "assujetti" && e.tva ? "TVA " + e.tva : "TVA non applicable, art. 293 B du CGI", e.site].filter(Boolean).join("  ·  ");
    for (const [k, l] of [[0, l1], [1, l2]]) {
      const t = couper(l, W - 2 * M, F.r, 7)[0];
      txt(t, (W - largeur(t, F.r, 7)) / 2, M + 30 - k * 11, { size: 7, color: GRIS });
    }
    if (pages.length > 1) { const n = (i + 1) + " / " + pages.length; txt(n, W - M - largeur(n, F.r, 7), M + 8, { size: 7, color: GRIS }); }
  });
  return await P.save();
}
