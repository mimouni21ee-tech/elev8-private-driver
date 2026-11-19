/* ==========================================================================
   ELEV8 Private Driver — envois liés au suivi d'une réservation payée en ligne
   Chaque envoi est marqué dans le dossier AVANT d'être fait (écriture conditionnelle) :
   une notification Stripe répétée ou deux traitements simultanés n'envoient jamais
   deux fois le même e-mail. En cas d'échec, la marque est retirée pour un nouvel essai.
   ========================================================================== */
import { modifier } from "./paiements.mjs";
import { magasin as magasinDemandes, chargerParId } from "./demandes.mjs";
import { envoyer } from "./courriels.mjs";

export async function demandeDe(p, now) {
  if (!p || !p.idDemande) return null;
  try { const r = await chargerParId(magasinDemandes(), p.idDemande, now); return r && r.record ? r.record : null; } catch { return null; }
}
export const lienDocuments = (p) => (p && p.origine && p.idDemande ? p.origine + "/documents/?r=" + p.idDemande : "");

/* Envoi unique : cle = nom de la notification (ex. "client_paiement_recu") */
export async function envoyerUneFois(st, p, cle, message, destinataire, now = Date.now()) {
  if (!message || (destinataire !== "elev8" && !destinataire)) return false;
  const r = await modifier(st, p.jeton, (x) => ((x.notifications || {})[cle] ? null : { ...x, notifications: { ...(x.notifications || {}), [cle]: new Date(now).toISOString() } }));
  if (!r.change) return false;
  try {
    await envoyer({ ...message, to: destinataire === "elev8" ? "" : destinataire });
    return true;
  } catch (e) {
    console.error("Notification « " + cle + " » non envoyée :", String(e && e.message).slice(0, 60));
    await modifier(st, p.jeton, (x) => { const n = { ...(x.notifications || {}) }; delete n[cle]; return { ...x, notifications: n }; }).catch(() => {});
    return false;
  }
}
