/* ==========================================================================
   ELEV8 Private Driver — actions sur une réservation payée en ligne
   Appelées par /documents-api (session ELEV8 obligatoire) et par la fonction planifiée
   « suivi-paiements ». Toutes sont rejouables sans effet double (remboursement avec clé
   d'idempotence Stripe, e-mails marqués comme envoyés).
   ========================================================================== */
import { stripeActif, expirerSession, rembourser } from "./stripe.mjs";
import { magasin, parRef, creer, modifier, resume, instantParis, controleRealisation, deps as P } from "./paiements.mjs";
import { magasin as magasinDemandes, chargerParRef } from "./demandes.mjs";
import { mailChauffeurConfirme, mailAnnulation, alerteElev8 } from "./courriels.mjs";
import { envoyerDevis } from "./devis-auto.mjs";
import { facturerRealisation } from "./facturation.mjs";
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
  if (!["paye", "rembourse_partiel"].includes(p.statut)) return { erreur: [409, "La confirmation du chauffeur n'est possible qu'une fois le paiement confirmé par Stripe (statut actuel : " + p.statut + ")."] };
  const c = { prenom: String(chauffeur && chauffeur.prenom || "").trim().slice(0, 40), vehicule: String(chauffeur && chauffeur.vehicule || "").trim().slice(0, 80), plaque: String(chauffeur && chauffeur.plaque || "").trim().slice(0, 20) };
  if (!c.prenom || !c.vehicule) return { erreur: [422, "Indiquez au moins le prénom du chauffeur et le véhicule."] };
  const r = await modifier(st, p.jeton, (x) => (x.etape === "payee_attente_attribution" ? note({ ...x, etape: "chauffeur_confirme", chauffeur: { ...c, confirmeLe: new Date(now).toISOString(), par: "elev8" } }, "chauffeur confirmé : " + c.prenom, now) : null));
  const n = r.p;
  if (!r.change) return { erreur: [409, n.etape === "chauffeur_confirme" && n.chauffeur ? "Chauffeur déjà confirmé (" + n.chauffeur.prenom + ") : le client a déjà été prévenu." : "Réservation déjà traitée (étape : " + n.etape + ")."] };
  const D = await demandeDe(n, now);
  const mail = D && D.client && D.client.email ? await envoyerUneFois(st, n, "client_chauffeur_confirme", mailChauffeurConfirme(D, n.chauffeur), D.client.email, now) : false;
  return { paiement: resume(n), mail };
}

/* « Course réalisée » : validation explicite par ELEV8 (jamais déduite de l'heure prévue).
   Conditions : paiement confirmé (éventuellement remboursé en partie), chauffeur confirmé, aucune
   annulation. Enregistre la date et l'heure réelles ; une seconde validation est refusée.
   Déclenche la facture finale (acompte déduit). realiseeLe : « AAAA-MM-JJTHH:MM » (heure de Paris), facultatif. */
export async function confirmerRealisation({ ref, realiseeLe = "", now = P.now() }) {
  const st = magasin();
  const p = await parRef(st, ref);
  if (!p) return { erreur: [404, "Aucun paiement en ligne pour cette référence."] };
  if (p.etape === "realisee") return { erreur: [409, "Course déjà déclarée réalisée le " + new Date(p.realisation.le).toLocaleString("fr-FR", { timeZone: "Europe/Paris", dateStyle: "long", timeStyle: "short" }) + "."] };
  if (!["paye", "rembourse_partiel"].includes(p.statut)) return { erreur: [409, "Paiement non confirmé ou remboursé intégralement (statut : " + p.statut + ") : la course ne peut pas être déclarée réalisée."] };
  if (p.etape !== "chauffeur_confirme") return { erreur: [409, p.etape === "payee_attente_attribution" ? "Confirmez d'abord le chauffeur." : "Réservation annulée ou déjà traitée (étape : " + p.etape + ")."] };
  // Date de réalisation : celle indiquée, sinon l'heure de la validation — contrôlée dans les deux cas
  let le = now;
  if (realiseeLe) {
    const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})$/.exec(String(realiseeLe));
    le = m ? instantParis(m[1], m[2]) : NaN;
  }
  const fin = await finPrevue(p, now);
  const refus = controleRealisation(p, le, { now, fin });
  if (refus) return { erreur: [422, refus] };
  const reference = { priseEnCharge: p.priseEnCharge, fin: new Date(Math.max(fin || 0, Date.parse(p.priseEnCharge))).toISOString() };
  const r = await modifier(st, p.jeton, (x) => (x.etape === "chauffeur_confirme" && ["paye", "rembourse_partiel"].includes(x.statut) && x.priseEnCharge === p.priseEnCharge
    ? note({ ...x, etape: "realisee", realisation: { le: new Date(le).toISOString(), declareLe: new Date(now).toISOString(), par: "elev8", reference } }, "course réalisée (" + new Date(le).toLocaleString("fr-FR", { timeZone: "Europe/Paris" }) + ")", now) : null));
  if (!r.change) return { erreur: [409, "Course déjà déclarée réalisée (validation simultanée)."] };
  let facture = null;
  try { facture = await facturerRealisation(st, r.p, { now }); }
  catch (e) { console.error("Facture finale différée :", String(e && e.message).slice(0, 60)); facture = { differee: true }; }
  return { paiement: resume(await parRef(st, ref)), facture };
}

/* Fin prévue de la prestation : retour d'un aller-retour (demande enregistrée), sinon la prise en charge */
async function finPrevue(p, now) {
  const D = await demandeDe(p, now);
  const x = D && D.prestation;
  if (x && x.allerRetour && x.dateRetour) {
    const t = instantParis(x.dateRetour, x.heureRetour || "23:59");
    if (Number.isFinite(t)) return t + (p.decalagePrestation || 0);   // suit une modification officielle de date
  }
  return Date.parse(p.priseEnCharge);
}

/* Modification OFFICIELLE de la date de la prestation (seule exception à la fenêtre de réalisation).
   Réservée à ELEV8 connecté, motif obligatoire, historique conservé ; impossible une fois la course
   réalisée, annulée ou remboursée. Les documents déjà émis (devis, facture d'acompte) ne changent pas ;
   la facture finale indique la date réelle de réalisation. */
export async function modifierDatePrestation({ ref, date, heure, motif, now = P.now() }) {
  const st = magasin();
  const p = await parRef(st, ref);
  if (!p) return { erreur: [404, "Aucun paiement en ligne pour cette référence."] };
  if (!["paye", "rembourse_partiel"].includes(p.statut) || !["payee_attente_attribution", "chauffeur_confirme"].includes(p.etape))
    return { erreur: [409, "La date ne peut être modifiée que pour une réservation payée, ni réalisée ni annulée (étape : " + p.etape + ", paiement : " + p.statut + ")."] };
  const m = String(motif || "").trim();
  if (m.length < 5) return { erreur: [422, "Indiquez le motif de la modification (par exemple : « avancée à la demande du client »)."] };
  const t = /^\d{4}-\d{2}-\d{2}$/.test(date || "") && /^\d{2}:\d{2}$/.test(heure || "") ? instantParis(date, heure) : NaN;
  if (!Number.isFinite(t)) return { erreur: [422, "Nouvelle date ou heure invalide."] };
  if (Math.abs(t - now) > 366 * 86400_000) return { erreur: [422, "Nouvelle date hors limites."] };
  const ancienne = p.priseEnCharge, nouvelle = new Date(t).toISOString();
  if (ancienne === nouvelle) return { erreur: [409, "La date indiquée est déjà la date enregistrée."] };
  const r = await modifier(st, p.jeton, (x) => {
    if (x.priseEnCharge !== ancienne || !["payee_attente_attribution", "chauffeur_confirme"].includes(x.etape)) return null;
    const n = { ...(x.notifications || {}) };
    for (const k of Object.keys(n)) if (k.startsWith("elev8_sans_chauffeur_")) delete n[k];     // alertes recalées sur la nouvelle date
    return note({ ...x, priseEnCharge: nouvelle, decalagePrestation: (x.decalagePrestation || 0) + (t - Date.parse(ancienne)), notifications: n,
      modificationsDate: (x.modificationsDate || []).concat([{ ancienne, nouvelle, motif: m.slice(0, 200), le: new Date(now).toISOString(), par: "elev8" }]) },
      "date de la prestation modifiée : " + new Date(t).toLocaleString("fr-FR", { timeZone: "Europe/Paris" }) + " (" + m.slice(0, 80) + ")", now);
  });
  if (!r.change) return { erreur: [409, "La réservation a changé entre-temps : rechargez-la."] };
  return { paiement: resume(r.p) };
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
