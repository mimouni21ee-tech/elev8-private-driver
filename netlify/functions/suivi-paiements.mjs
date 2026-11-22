/* ==========================================================================
   ELEV8 Private Driver — suivi horaire des réservations payées en ligne (fonction planifiée)
     - liens non payés après leur date limite → « expiré » (session Stripe fermée) ;
     - course payée sans chauffeur confirmé à 12 h puis à 3 h de la prise en charge
       → alerte e-mail à ELEV8 (une seule fois par seuil) ;
     - facultatif : PAIEMENT_REMBOURSEMENT_AUTO_H (ex. « 1 ») → remboursement intégral
       automatique si toujours aucun chauffeur à 1 h de la prise en charge. Absent = jamais.
   Inactif tant que le paiement en ligne n'est pas activé (PAIEMENT_STRIPE=test).
   ========================================================================== */
import { stripeActif, expirerSession } from "../lib/stripe.mjs";
import { retenirContexte } from "../lib/environnement.mjs";
import { magasin, modifier, REGLES, deps as P } from "../lib/paiements.mjs";
import { alerteElev8 } from "../lib/courriels.mjs";
import { envoyerUneFois, demandeDe, lienDocuments } from "../lib/notifications.mjs";
import { annulerEtRembourser } from "../lib/actions-paiement.mjs";
import { acompteEnAttente, facturerPaiement, finaleEnAttente, facturerRealisation, avoirEnAttente, facturerRemboursement, relancerAvoirs } from "../lib/facturation.mjs";

export async function suivre(now = P.now()) {
  const st = magasin(), bilan = { expires: 0, alertes: 0, rembourses: 0, factures: 0 };
  const { blobs } = await st.list({ prefix: "paiement/" });
  for (const b of blobs) {
    const p = await st.get(b.key, { type: "json" });
    if (!p) continue;
    const avant = (Date.parse(p.priseEnCharge) - now) / 3600_000;
    if (p.statut === "en_attente" && now > Date.parse(p.valableJusqu)) {
      if (p.sessionActive) { try { await expirerSession(p.sessionActive); } catch { /* déjà fermée */ } }
      const r = await modifier(st, p.jeton, (x) => (x.statut === "en_attente" ? { ...x, statut: "expire", sessionActive: null, historique: (x.historique || []).concat([{ le: new Date(now).toISOString(), quoi: "lien expiré (date limite)" }]) } : null));
      if (r.change) bilan.expires++;
      continue;
    }
    // Facture d'acompte non émise ou e-mail non parti (échec passager) : nouvelle tentative, sans doublon
    if (acompteEnAttente(p)) {
      try { const f = await facturerPaiement(st, p, { now }); if (f && f.numero) bilan.factures++; }
      catch (e) { console.error("Facture d'acompte (relance) :", String(e && e.message).slice(0, 60)); }
    }
    // Facture finale et avoirs non émis ou non envoyés : nouvelle tentative, sans doublon
    if (finaleEnAttente(p)) {
      try { const f = await facturerRealisation(st, (await st.get(b.key, { type: "json" })) || p, { now }); if (f && f.numero) bilan.factures++; }
      catch (e) { console.error("Facture finale (relance) :", String(e && e.message).slice(0, 60)); }
    }
    if (avoirEnAttente(p)) {
      try {
        const q = (await st.get(b.key, { type: "json" })) || p;
        const f = await facturerRemboursement(st, q, { now }); if (f && f.numero) bilan.factures++;
        await relancerAvoirs(st, (await st.get(b.key, { type: "json" })) || q, { now });
      } catch (e) { console.error("Avoir (relance) :", String(e && e.message).slice(0, 60)); }
    }
    if (p.statut === "paye" && p.etape === "payee_attente_attribution" && avant > -1) {
      for (const seuil of REGLES.alertesH) {
        if (avant <= seuil && await envoyerUneFois(st, p, "elev8_sans_chauffeur_" + seuil, alerteElev8(await demandeDe(p, now), p, "Course payée SANS chauffeur à moins de " + seuil + " h",
          ["Aucun chauffeur n'est confirmé.", "Dans /documents : « Chauffeur confirmé » si un chauffeur est trouvé, sinon « Aucun chauffeur — rembourser »."], lienDocuments(p)), "elev8", now)) bilan.alertes++;
      }
      const auto = REGLES.remboursementAutoH();
      if (auto > 0 && avant <= auto) {
        const r = await annulerEtRembourser({ ref: p.ref, motif: "sans_chauffeur", now, automatique: true });
        if (r.rembourse) bilan.rembourses++;
      }
    }
  }
  return bilan;
}

export default async (req, context) => {
  retenirContexte(context);
  if (!stripeActif()) return;
  try { const b = await suivre(); console.log(`Suivi des paiements : ${b.expires} lien(s) expiré(s), ${b.alertes} alerte(s), ${b.rembourses} remboursement(s) automatique(s), ${b.factures} facture(s) d'acompte traitée(s)`); }
  catch (e) { console.error("Suivi des paiements impossible :", String(e && e.message).slice(0, 80)); }
};
export const config = { schedule: "@hourly" };
