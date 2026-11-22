/* ==========================================================================
   ELEV8 Private Driver — notifications de Stripe : POST /stripe-webhook
   --------------------------------------------------------------------------
   SEULE source qui peut faire passer une réservation à « Payée ». La page de retour de
   Stripe (/paiement/?etat=merci) n'a aucun effet.
   Contrôles, dans l'ordre :
     1. signature Stripe (STRIPE_WEBHOOK_SECRET, tolérance 5 min) sur le corps brut ;
     2. mode de l'événement identique au contexte Stripe (test ou live) ;
     3. anti-rejeu : chaque événement n'est traité qu'une fois (evt/<id>) ;
     4. état RELU auprès de Stripe (session, charge) : montant, devise, référence, jeton ;
     5. statuts qui n'avancent que dans un sens (un événement en retard ne fait pas reculer).
   Événements à cocher dans Stripe : checkout.session.completed,
     checkout.session.async_payment_succeeded, checkout.session.async_payment_failed,
     checkout.session.expired, charge.refunded, charge.dispute.created
   Réponse 200 si traité ou ignoré ; 400 si signature invalide ; 500 en cas d'erreur
   passagère (Stripe renverra l'événement plus tard).
   ========================================================================== */
import { stripeActif, verifierSignature, lireSession, lireCharge } from "../lib/stripe.mjs";
import { retenirContexte } from "../lib/environnement.mjs";
import { magasin, parCle, lire, modifier, appliquerSession, appliquerEchecDiffere, appliquerCharge, deps as P } from "../lib/paiements.mjs";
import { mailPaiementRecu, alerteElev8 } from "../lib/courriels.mjs";
import { envoyerUneFois, demandeDe, lienDocuments } from "../lib/notifications.mjs";
import { facturerPaiement, facturerRemboursement } from "../lib/facturation.mjs";

export const config = { path: "/stripe-webhook" };
const rep = (status, body) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

export default async (req, context) => {
  retenirContexte(context);
  if (req.method !== "POST") return rep(405, { ok: false });
  const c = stripeActif();
  if (!c) return rep(503, { ok: false, erreur: "inactif" });
  const brut = await req.text();
  if (brut.length > 200_000 || !verifierSignature(brut, req.headers.get("stripe-signature"), c.secret, P.now())) return rep(400, { ok: false, erreur: "signature" });
  let ev;
  try { ev = JSON.parse(brut); } catch { return rep(400, { ok: false, erreur: "format" }); }
  if (!ev || typeof ev.id !== "string" || !ev.type) return rep(400, { ok: false, erreur: "format" });
  if (ev.livemode !== (c.mode === "live")) return rep(400, { ok: false, erreur: "mode_incorrect" });

  const st = magasin(), now = P.now();
  // Anti-rejeu
  const cle = "evt/" + ev.id.replace(/[^A-Za-z0-9_]/g, "").slice(0, 80);
  const pose = await st.setJSON(cle, { etat: "traitement", t: now, type: ev.type }, { onlyIfNew: true });
  if (!pose || pose.modified === false) {
    const deja = await st.get(cle, { type: "json" });
    if (deja && deja.etat === "fait") return rep(200, { ok: true, deja: true });
    if (deja && now - deja.t < 120_000) return rep(409, { ok: false, erreur: "en_cours" });   // traitement simultané : Stripe réessaiera
    await st.setJSON(cle, { etat: "traitement", t: now, type: ev.type });
  }
  try {
    const resultat = await traiter(st, ev, now);
    await st.setJSON(cle, { etat: "fait", t: now, type: ev.type, resultat });
    return rep(200, { ok: true, resultat });
  } catch (e) {
    console.error("Webhook Stripe (" + ev.type + ") :", String(e && e.message).slice(0, 80));
    await st.delete(cle).catch(() => {});
    return rep(500, { ok: false, erreur: "temporaire" });
  }
};

async function traiter(st, ev, now) {
  const o = (ev.data && ev.data.object) || {};
  if (ev.type.startsWith("checkout.session.")) {
    if (typeof o.id !== "string" || !o.id.startsWith("cs_")) return "ignore";
    const s = await lireSession(o.id);                                       // état réel, relu chez Stripe
    let p = await parCle(st, "session", s.id);
    if (!p && s.metadata && s.metadata.paiement) p = await lire(st, s.metadata.paiement);
    if (!p) return "inconnu";
    let r;
    if (ev.type === "checkout.session.async_payment_failed") r = await modifier(st, p.jeton, (x) => appliquerEchecDiffere(x, now));
    else r = await modifier(st, p.jeton, (x) => appliquerSession(x, s, now));
    const n = r.p;
    if (!n) return "inconnu";
    if (n.paymentIntent) await st.setJSON("pi/" + n.paymentIntent, { jeton: n.jeton });
    const D = await demandeDe(n, now);
    if (n.statut === "paye" && r.change && r.avant && r.avant.statut !== "paye") {
      if (D && D.client && D.client.email) await envoyerUneFois(st, n, "client_paiement_recu", mailPaiementRecu(D, n), D.client.email, now);
      await envoyerUneFois(st, n, "elev8_paiement_recu", alerteElev8(D, n, "Paiement reçu — course à attribuer",
        ["Le paiement est confirmé par Stripe.", "Statut : Payée — en attente d'attribution.", "HUBER : transmission automatique dès que son API sera disponible ; d'ici là, confirmez le chauffeur dans /documents."], lienDocuments(n)), "elev8", now);
      // Facture d'acompte (100 %) : isolée, elle ne peut pas faire échouer la confirmation du paiement ; reprise par la tâche horaire
      try { await facturerPaiement(st, n, { now }); }
      catch (e) { console.error("Facture d'acompte différée :", String(e && e.message).slice(0, 60)); }
      return "paye";
    }
    if (n.statut === "a_verifier" && r.change)
      await envoyerUneFois(st, n, "elev8_a_verifier", alerteElev8(D, n, "Paiement reçu à vérifier", ["Un paiement a été reçu sur un lien retiré ou pour un montant inattendu (" + n.motifVerification + ").", "Vérifiez dans Stripe et remboursez si nécessaire."], lienDocuments(n)), "elev8", now);
    if (ev.type === "checkout.session.async_payment_failed" && r.change)
      await envoyerUneFois(st, n, "elev8_echec_" + s.id, alerteElev8(D, n, "Paiement refusé", ["Le paiement différé a été refusé. Le client peut réessayer avec le même lien."], lienDocuments(n)), "elev8", now);
    return n.statut;
  }
  if (ev.type === "charge.refunded") {
    if (typeof o.id !== "string") return "ignore";
    const ch = await lireCharge(o.id);
    const pi = typeof ch.payment_intent === "string" ? ch.payment_intent : ch.payment_intent && ch.payment_intent.id;
    const p = await parCle(st, "pi", pi);
    if (!p) return "inconnu";
    const r = await modifier(st, p.jeton, (x) => {
      const y = appliquerCharge(x, ch, now);
      if (y.statut === "rembourse" && ["attente_paiement", "payee_attente_attribution", "chauffeur_confirme"].includes(y.etape)) y.etape = y.etapeAnnulation || "annulee";
      return y;
    });
    if (r.change) await envoyerUneFois(st, r.p, "elev8_rembourse_" + ch.amount_refunded, alerteElev8(await demandeDe(r.p, now), r.p, "Remboursement enregistré", [r.p.statut === "rembourse" ? "Remboursement intégral." : "Remboursement partiel : " + (ch.amount_refunded / 100).toFixed(2) + " €."], lienDocuments(r.p)), "elev8", now);
    // Avoir rattaché à la facture émise : isolé, il ne peut pas faire échouer l'enregistrement du remboursement ; reprise horaire
    try { await facturerRemboursement(st, r.p, { charge: ch.id, now }); }
    catch (e) { console.error("Avoir différé :", String(e && e.message).slice(0, 60)); }
    return r.p.statut;
  }
  if (ev.type === "charge.dispute.created") {
    const p = await parCle(st, "pi", typeof o.payment_intent === "string" ? o.payment_intent : "");
    if (!p) return "inconnu";
    const r = await modifier(st, p.jeton, (x) => (x.litige ? null : { ...x, litige: true, historique: (x.historique || []).concat([{ le: new Date(now).toISOString(), quoi: "litige ouvert par le client (Stripe)" }]) }));
    if (r.change) await envoyerUneFois(st, r.p, "elev8_litige", alerteElev8(await demandeDe(r.p, now), r.p, "Litige Stripe ouvert", ["Le client conteste le paiement auprès de sa banque. Répondez dans le tableau de bord Stripe."], lienDocuments(r.p)), "elev8", now);
    return "litige";
  }
  return "ignore";
}
