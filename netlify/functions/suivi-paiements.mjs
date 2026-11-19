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
import { magasin, modifier, REGLES, deps as P } from "../lib/paiements.mjs";
import { alerteElev8 } from "../lib/courriels.mjs";
import { envoyerUneFois, demandeDe, lienDocuments } from "../lib/notifications.mjs";
import { annulerEtRembourser } from "../lib/actions-paiement.mjs";

export async function suivre(now = P.now()) {
  const st = magasin(), bilan = { expires: 0, alertes: 0, rembourses: 0 };
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

export default async () => {
  if (!stripeActif()) return;
  try { const b = await suivre(); console.log(`Suivi des paiements : ${b.expires} lien(s) expiré(s), ${b.alertes} alerte(s), ${b.rembourses} remboursement(s) automatique(s)`); }
  catch (e) { console.error("Suivi des paiements impossible :", String(e && e.message).slice(0, 80)); }
};
export const config = { schedule: "@hourly" };
