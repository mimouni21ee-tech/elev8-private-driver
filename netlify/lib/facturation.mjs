/* ==========================================================================
   ELEV8 Private Driver — facturation automatique (étape 2 : facture d'acompte au paiement)
   --------------------------------------------------------------------------
   Déclencheur UNIQUE : la confirmation du paiement par Stripe (webhook signé, état relu chez
   Stripe → dossier de paiement au statut « paye »). Jamais le retour du navigateur.

   Schéma (à valider par le comptable avant toute émission réelle, réglable) :
     paiement confirmé → facture d'acompte de 100 % (série F-AAAA-0001, commune avec les
     factures déjà émises) ; après « Course réalisée » → facture finale (étape 3) ;
     remboursement → avoir (étape 3, série AV-AAAA-0001).
   FACTURATION_AUTOMATIQUE=non (variable Netlify) désactive l'émission automatique ;
   legal.facturation = "indy" (config.js) aussi : une seule source de factures.

   Garanties :
     - un paiement (PaymentIntent Stripe) ne produit qu'UNE facture d'acompte, même si Stripe
       répète la notification ou si deux traitements arrivent en même temps (verrou acompte-pi/<pi>) ;
     - le document facturé est celui du devis accepté : montant TTC = devis = paiement, au centime ;
     - une facture émise n'est jamais modifiée ni supprimée (écriture « onlyIfNew ») ;
     - si l'e-mail échoue, la facture reste émise et l'envoi est relancé par la tâche horaire.
   Site de test : magasin séparé, numéros « TEST-F-… », mention « DOCUMENT DE TEST ».
   ========================================================================== */
import { magasinDevis, chargerConfig, documentDevis } from "./devis-auto.mjs";
import { emetteur, manquants, pdf, montants, aujourdhuiParis, designationAuto } from "./documents.mjs";
import { numeroSuivant } from "./numerotation.mjs";
import { estSiteDeTest } from "./environnement.mjs";
import { modifier } from "./paiements.mjs";
import { demandeDe, envoyerUneFois } from "./notifications.mjs";
import { mailFactureAcompte } from "./courriels.mjs";

const env = (k) => (process.env[k] || "").trim();
export const facturationAutomatique = () => env("FACTURATION_AUTOMATIQUE").toLowerCase() !== "non";
export const MODE_STRIPE_CARTE = "carte bancaire via Stripe";

/* Émission (ou relecture) de la facture d'acompte d'un paiement confirmé */
export async function emettreAcompte(p, { now = Date.now() } = {}) {
  if (!facturationAutomatique()) return { ignore: "desactivee" };
  if (!p || p.statut !== "paye" || !p.paymentIntent || !p.payeLe) return { ignore: "non_paye" };
  const st = magasinDevis();
  const cle = "acompte-pi/" + p.paymentIntent;
  const deja = await st.get(cle, { type: "json" });
  if (deja && deja.numero) return { record: await st.get("facture/" + deja.numero, { type: "json" }), nouvelle: false };

  const E = emetteur(await chargerConfig(p.origine));
  if (E.facturation === "indy") return { ignore: "indy" };
  if (manquants(E).length) throw new Error("emetteur");
  const final = await st.get("ref/" + p.ref, { type: "json" });
  if (final && final.numero) return { ignore: "facture_existante" };          // facture déjà établie à la main : pas d'acompte en plus
  const D = await demandeDe(p, now);
  if (!D) throw new Error("demande");

  // Document facturé = devis accepté (mêmes lignes) ; sinon reconstruit depuis la réservation
  let doc = null;
  if (p.devis && p.devis.numero) {
    const dv = await st.get("devis/" + p.devis.numero, { type: "json" });
    if (dv && dv.montantCents === p.montantCents) doc = structuredClone(dv.doc);
  }
  if (!doc) doc = documentDevis(D, p, null, p.valableJusqu, aujourdhuiParis(now));
  const mt = montants(doc.montant, E, doc.supplements);
  if (Math.round(mt.ttc * 100) !== p.montantCents) throw new Error("montant");   // jamais de facture différente du paiement

  // Verrou : un seul traitement émet la facture de ce paiement
  const verrou = await st.setJSON(cle, { numero: null, t: now }, { onlyIfNew: true });
  if (verrou && verrou.modified === false) {
    const l = await st.get(cle, { type: "json" });
    if (l && l.numero) return { record: await st.get("facture/" + l.numero, { type: "json" }), nouvelle: false };
    if (l && now - (l.t || 0) > 120_000) await st.delete(cle);                  // émission interrompue : la tâche horaire reprendra
    return { occupe: true };
  }
  const dateEmission = aujourdhuiParis(now);
  const numero = await numeroSuivant(st, dateEmission.slice(0, 4), "F");
  if (!doc.prestation.designation) doc.prestation.designation = designationAuto(doc.prestation);
  const record = {
    numero, type: "acompte", ref: p.ref, dateEmission, horodatage: new Date(now).toISOString(), emetteur: E, doc, montants: mt,
    acompte: { pourcentage: 100, montantCents: p.montantCents, dateEncaissement: aujourdhuiParis(Date.parse(p.payeLe)),
      mode: MODE_STRIPE_CARTE, reference: p.paymentIntent, devis: p.devis ? p.devis.numero : "" },
    test: estSiteDeTest()
  };
  await st.setJSON("facture/" + numero, record, { onlyIfNew: true });
  await st.setJSON(cle, { numero, t: now });
  await st.setJSON("acompte-ref/" + p.ref, { numero });
  return { record, nouvelle: true };
}

/* PDF d'une facture enregistrée (identique à chaque relecture) */
export function pdfFacture(rec) {
  return pdf(rec.type === "acompte" ? "acompte" : "facture", rec.doc, rec.emetteur,
    { numero: rec.numero, dateEmission: rec.dateEmission, horodatage: rec.horodatage, acompte: rec.acompte, iban: rec.iban, test: !!rec.test });
}

/* Paiement confirmé : facture d'acompte émise, rattachée au dossier, envoyée au client (copie ELEV8).
   Rejouable : appelée par le webhook puis, en cas d'échec, par la tâche horaire. */
export async function facturerPaiement(stPaiements, p, { now = Date.now() } = {}) {
  if (!facturationAutomatique() || !p || p.statut !== "paye") return { ignore: "non_applicable" };
  // Marque « facture attendue » posée au paiement : la tâche horaire ne reprend que ces paiements-là
  // (activer la facturation automatique ne facture jamais rétroactivement des paiements plus anciens).
  if (!(p.factures && p.factures.attendue)) await modifier(stPaiements, p.jeton, (x) => (x.factures && x.factures.attendue ? null : { ...x, factures: { ...(x.factures || {}), attendue: new Date(now).toISOString() } }));
  const r = await emettreAcompte(p, { now });
  if (!r.record) return r;
  const rec = r.record;
  await modifier(stPaiements, p.jeton, (x) => (x.factures && x.factures.acompte === rec.numero ? null
    : { ...x, factures: { ...(x.factures || {}), acompte: rec.numero },
        historique: (x.historique || []).concat([{ le: new Date(now).toISOString(), quoi: "facture d'acompte " + rec.numero + " émise" }]).slice(-40) }));
  const D = await demandeDe(p, now);
  const m = mailFactureAcompte(D || { ref: p.ref, client: {} }, rec);
  m.pieces = [{ nom: rec.numero + ".pdf", contenu: await pdfFacture(rec) }];
  m.copieElev8 = true;
  const email = D && D.client && D.client.email;
  const envoye = email
    ? await envoyerUneFois(stPaiements, p, "client_facture_acompte", m, email, now)
    : await envoyerUneFois(stPaiements, p, "elev8_facture_acompte", { ...m, subject: "[Client sans e-mail — à transmettre] " + m.subject }, "elev8", now);
  return { numero: rec.numero, nouvelle: r.nouvelle, envoye };
}

/* La facture d'acompte de ce paiement reste-t-elle à émettre ou à envoyer ? (tâche horaire) */
export function acompteEnAttente(p) {
  if (!facturationAutomatique() || !p || p.statut !== "paye" || !p.paymentIntent || !(p.factures && p.factures.attendue)) return false;
  const n = p.notifications || {};
  return !(p.factures && p.factures.acompte) || !(n.client_facture_acompte || n.elev8_facture_acompte);
}
