/* ==========================================================================
   ELEV8 Private Driver — actions sur une réservation payée en ligne
   Appelées par /documents-api (session ELEV8 obligatoire) et par la fonction planifiée
   « suivi-paiements ». Toutes sont rejouables sans effet double (remboursement avec clé
   d'idempotence Stripe, e-mails marqués comme envoyés).
   ========================================================================== */
import { stripeActif, expirerSession, rembourser } from "./stripe.mjs";
import { magasin, parRef, creer, modifier, resume, instantParis, deps as P } from "./paiements.mjs";
import { magasin as magasinDemandes, chargerParRef } from "./demandes.mjs";
import { mailChauffeurConfirme, mailAnnulation, alerteElev8 } from "./courriels.mjs";
import { envoyerDevis } from "./devis-auto.mjs";
import { envoyerUneFois, demandeDe, lienDocuments } from "./notifications.mjs";

const note = (x, quoi, now) => { x.historique = (x.historique || []).concat([{ le: new Date(now).toISOString(), quoi }]).slice(-40); return x; };
export const libelleCourse = (D) => "Trajet ELEV8 Private Driver — " + D.ref;
export const descriptionCourse = (D) => {
  const p = D.prestation || {};
  return [p.date ? p.date.split("-").reverse().join("/") : "", p.heure ? p.heure.replace(":", "h") : "", p.vehicule || ""].filter(Boolean).join(" · ") + (p.allerRetour ? " · aller-retour" : "");
};

/* Création du lien (paiement automatique, ou après validation manuelle du montant) + e-mail au client */
/* envoyerMail : envoie le devis PDF + bouton « Accepter le devis et payer en ligne » (copie à ELEV8).
   detail : { montant, supplements } du tarif validé, pour détailler le devis (total = montant du lien). */
export async function preparerPaiement(D, { idDemande, montant, origine, envoyerMail = true, detail = null, now = P.now() }) {
  const st = magasin();
  const p = await creer(st, { ref: D.ref, idDemande, montant, libelle: libelleCourse(D), description: descriptionCourse(D),
    priseEnCharge: instantParis(D.prestation.date, D.prestation.heure), origine, now });
  let mail = false, devis = null;
  if (envoyerMail) ({ envoye: mail, devis } = await envoyerDevis(st, D, p, { origine, detail, now }));
  return { p, mail, devis };
}

export async function creerLienManuel({ ref, montant, detail = null, origine, envoyerMail, now = P.now() }) {
  if (!stripeActif()) return { erreur: [503, "Paiement en ligne non activé (variables Stripe de test absentes)."] };
  const r = await chargerParRef(magasinDemandes(), ref, now);
  if (r.erreur) return { erreur: [404, "Demande introuvable : le lien Stripe ne peut être créé que pour une demande enregistrée."] };
  try {
    const { p, mail, devis } = await preparerPaiement(r.record, { idDemande: r.record.id, montant, origine, envoyerMail: !!envoyerMail, detail, now });
    return { paiement: resume(await parRef(magasin(), ref) || p), mail, devis, sansEmailClient: !(r.record.client && r.record.client.email) };
  } catch (e) {
    const m = String(e && e.message);
    if (m === "deja_paye") return { erreur: [409, "Cette réservation est déjà payée : aucun nouveau lien n'est créé."] };
    if (m === "delai") return { erreur: [422, "Prise en charge trop proche : le lien serait valable moins de 35 minutes."] };
    if (m === "montant") return { erreur: [422, "Montant invalide (1 € à 5 000 €)."] };
    throw e;
  }
}

/* Chauffeur réellement confirmé (par ELEV8 aujourd'hui ; par HUBER quand son API existera) */
export async function confirmerChauffeur({ ref, chauffeur, now = P.now() }) {
  const st = magasin();
  const p = await parRef(st, ref);
  if (!p) return { erreur: [404, "Aucun paiement en ligne pour cette référence."] };
  if (p.statut !== "paye") return { erreur: [409, "La confirmation du chauffeur n'est possible qu'une fois le paiement confirmé par Stripe (statut actuel : " + p.statut + ")."] };
  const c = { prenom: String(chauffeur && chauffeur.prenom || "").trim().slice(0, 40), vehicule: String(chauffeur && chauffeur.vehicule || "").trim().slice(0, 80), plaque: String(chauffeur && chauffeur.plaque || "").trim().slice(0, 20) };
  if (!c.prenom || !c.vehicule) return { erreur: [422, "Indiquez au moins le prénom du chauffeur et le véhicule."] };
  const r = await modifier(st, p.jeton, (x) => (x.etape === "payee_attente_attribution" ? note({ ...x, etape: "chauffeur_confirme", chauffeur: { ...c, confirmeLe: new Date(now).toISOString(), par: "elev8" } }, "chauffeur confirmé : " + c.prenom, now) : null));
  const n = r.p;
  if (!r.change) return { erreur: [409, n.etape === "chauffeur_confirme" && n.chauffeur ? "Chauffeur déjà confirmé (" + n.chauffeur.prenom + ") : le client a déjà été prévenu." : "Réservation déjà traitée (étape : " + n.etape + ")."] };
  const D = await demandeDe(n, now);
  const mail = D && D.client && D.client.email ? await envoyerUneFois(st, n, "client_chauffeur_confirme", mailChauffeurConfirme(D, n.chauffeur), D.client.email, now) : false;
  return { paiement: resume(n), mail };
}

/* Indisponibilité ou aucun chauffeur : lien désactivé (non payé) ou remboursement intégral (payé) */
export async function annulerEtRembourser({ ref, motif, now = P.now(), automatique = false }) {
  if (!["indisponible", "sans_chauffeur"].includes(motif)) return { erreur: [400, "Motif inconnu."] };
  const st = magasin();
  const p = await parRef(st, ref);
  if (!p) return { erreur: [404, "Aucun paiement en ligne pour cette référence."] };
  const etape = motif === "sans_chauffeur" ? "sans_chauffeur" : "annulee_indisponible";
  if (p.statut === "en_cours") return { erreur: [409, "Paiement en cours de validation par la banque : attendez son résultat avant d'annuler."] };
  if (["rembourse"].includes(p.statut) || (p.remboursementDemande && p.statut !== "en_attente")) return { paiement: resume(p), dejaFait: true };
  let rembourse = false;
  if (["en_attente", "expire", "annule", "remplace"].includes(p.statut)) {
    if (p.sessionActive) { try { await expirerSession(p.sessionActive); } catch { /* déjà expirée */ } }
    await modifier(st, p.jeton, (x) => (["en_attente", "expire"].includes(x.statut) ? note({ ...x, statut: "annule", etape, sessionActive: null }, "annulé avant paiement (" + motif + ")", now) : null));
  } else if (["paye", "a_verifier", "rembourse_partiel"].includes(p.statut) && p.paymentIntent) {
    await rembourser(p.paymentIntent, "elev8-remboursement-" + p.jeton, motif);           // idempotent : un seul remboursement
    rembourse = true;
    await modifier(st, p.jeton, (x) => note({ ...x, etape, etapeAnnulation: etape, remboursementDemande: new Date(now).toISOString() }, "remboursement intégral demandé (" + motif + (automatique ? ", automatique" : "") + ")", now));
  } else return { erreur: [409, "Annulation impossible dans l'état actuel (" + p.statut + ")."] };
  const n = await parRef(st, ref);
  const D = await demandeDe(n, now);
  const mail = D && D.client && D.client.email ? await envoyerUneFois(st, n, "client_annulation", mailAnnulation(D, n, { rembourse, motif }), D.client.email, now) : false;
  await envoyerUneFois(st, n, "elev8_annulation", alerteElev8(D, n, rembourse ? "Course annulée et remboursée" : "Lien de paiement annulé", ["Motif : " + motif + (automatique ? " (automatique)" : ""), rembourse ? "Remboursement intégral demandé à Stripe ; il sera confirmé par notification." : "Aucun paiement n'avait été reçu."], lienDocuments(n)), "elev8", now);
  return { paiement: resume(n), mail, rembourse };
}
