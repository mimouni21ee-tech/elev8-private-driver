/* ==========================================================================
   ELEV8 Private Driver — courses saisies par le chauffeur (« sur place »)
   --------------------------------------------------------------------------
   Utilisé par /chauffeur-api (page /chauffeur, réservée à ELEV8).
   Une course sur place est une RÉSERVATION comme les autres, simplement saisie par le
   chauffeur depuis son téléphone (demande au téléphone, à l'hôtel, par le voiturier…) :
     1. prix calculé avec la grille du site (même calcul que /estimation), ajustable avec motif ;
     2. accord du client → « Valider » : réservation horodatée (référence E8-…), qui sert de
        justificatif de réservation préalable, et dossier de paiement créé ;
     3. paiement par lien Stripe (QR code ou SMS), à tout moment jusqu'à 24 h après la
        prise en charge, OU marqué payé hors Stripe (TPE / Tap to Pay Indy / espèces) ;
     4. « Course terminée » → même validation que dans /documents (facture finale si activée).
   Le chauffeur (ELEV8) est confirmé dès la saisie : aucune alerte « sans chauffeur ».
   Index : magasin des paiements, clé surplace/<AAAAMMJJ>/<référence> → { jeton }.
   ========================================================================== */
import { stripeActif, expirerSession, lireSession } from "./stripe.mjs";
import { magasin, parRef, creer, modifier, resume, appliquerSession, instantParis, deps as P } from "./paiements.mjs";
import { magasin as magasinDemandes, enregistrer, chargerParId } from "./demandes.mjs";
import { estimer as estimerGrille, LIBELLE_CATEGORIE } from "./estimation.mjs";
import { libelleCourse, descriptionCourse, confirmerRealisation } from "./actions-paiement.mjs";

export const deps = { fetch: (...a) => fetch(...a), reverse: null };
export const MOYENS = ["carte bancaire (Tap to Pay Indy)", "carte bancaire (TPE)", "espèces"];
export const CHAUFFEUR = { prenom: "David" };

const s = (v, max) => (typeof v === "string" ? v.replace(/[\u0000-\u001F\u007F]/g, " ").replace(/\s+/g, " ").trim().slice(0, max) : "");
const note = (x, quoi, now) => { x.historique = (x.historique || []).concat([{ le: new Date(now).toISOString(), quoi }]).slice(-40); return x; };

/* Date et heure de Paris (AAAA-MM-JJ, HH:MM) */
export function maintenantParis(now = P.now()) {
  const o = {};
  new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
    .formatToParts(new Date(now)).forEach((x) => { o[x.type] = x.value; });
  return { date: `${o.year}-${o.month}-${o.day}`, heure: `${o.hour}:${o.minute}` };
}
/* Téléphone : « 06 12 34 56 78 » → « +33612345678 » ; vide accepté */
export function telephone(v) {
  let t = String(v || "").replace(/[\s.\-()]/g, "");
  if (!t) return "";
  if (/^00[1-9]/.test(t)) t = "+" + t.slice(2);
  if (/^0[1-9]\d{8}$/.test(t)) t = "+33" + t.slice(1);
  return /^\+[1-9]\d{7,14}$/.test(t) ? t : null;
}
const vehiculeDe = (v) => LIBELLE_CATEGORIE[v === "van" ? "van" : "confort"];

/* Entrée commune (estimation et création) */
export function lireCourse(b, now = P.now()) {
  const m = maintenantParis(now);
  const plusTard = b && b.quand === "plus_tard";
  return {
    depart: s(b && b.depart, 200), destination: s(b && b.destination, 200),
    vehicule: vehiculeDe(b && b.vehicule), passagers: Math.max(1, Math.min(8, parseInt(b && b.passagers, 10) || 1)),
    date: plusTard ? s(b.date, 10) : m.date, heure: plusTard ? s(b.heure, 5) : m.heure
  };
}

/* Prix de la grille (le même que sur le site). Ne lève pas : renvoie { erreur } si impossible. */
export async function prixGrille(e) {
  try {
    const r = await estimerGrille({ prestation: "Course sur place", depart: e.depart, destination: e.destination, date: e.date, heure: e.heure, vehicule: e.vehicule, passagers: e.passagers });
    return { statut: r.statut, motif: r.motif || null, montant: r.statut === "estimation" ? r.montant : null, distanceKm: r.distanceKm ?? null, dureeMin: r.dureeMin ?? null, lignes: r.lignes || [], categorie: r.categorie, vehicule: r.vehicule };
  } catch (x) {
    return { erreur: (x && x.code) || "indisponible" };
  }
}
export const MESSAGES_ESTIMATION = {
  lieu: "Indiquez le départ et la destination.", horaire: "Date ou heure invalide.", passe: "Cette heure est déjà passée.",
  identiques: "Le départ et la destination sont identiques.", lieu_inconnu: "Adresse introuvable : précisez la ville.",
  itineraire: "Itinéraire impossible à calculer.", indisponible: "Calcul momentanément indisponible : saisissez le prix vous-même."
};

/* Adresse de la position GPS du téléphone (géocodage inverse IGN, gratuit et sans clé) */
export async function adresseDePosition(lat, lon) {
  lat = Number(lat); lon = Number(lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  if (deps.reverse) return deps.reverse(lat, lon);
  const u = "https://data.geopf.fr/geocodage/reverse?index=address&limit=1&lon=" + lon.toFixed(6) + "&lat=" + lat.toFixed(6);
  const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 5000);
  try {
    const r = await deps.fetch(u, { signal: ctrl.signal, headers: { Accept: "application/json" } });
    if (!r.ok) return null;
    const j = await r.json();
    const f = j && j.features && j.features[0];
    return f && f.properties && f.properties.label ? String(f.properties.label).slice(0, 200) : null;
  } catch { return null; } finally { clearTimeout(t); }
}

/* Référence E8-AAMMJJ-XXX (même format que les demandes du site) */
export function nouvelleRef(now = P.now()) {
  const m = maintenantParis(now).date.replace(/-/g, "").slice(2);
  const rand = Array.from(crypto.getRandomValues(new Uint8Array(3)), (b) => "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"[b % 32]).join("");
  return `E8-${m}-${rand}`;
}

/* ---------- Validation de la course (accord du client) ---------- */
export async function creerCourse(b, { origine, now = P.now() } = {}) {
  const e = lireCourse(b, now);
  const c = b && b.client || {};
  const client = { prenom: s(c.prenom, 60), nom: s(c.nom, 80), telephone: telephone(c.telephone), email: s(c.email, 120).toLowerCase() };
  const bad = [];
  if (e.depart.length < 3) bad.push("depart");
  if (e.destination.length < 3) bad.push("destination");
  if (client.nom.length < 2) bad.push("nom");
  if (client.telephone === null) bad.push("telephone");
  if (client.email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(client.email)) bad.push("email");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(e.date) || !/^\d{2}:\d{2}$/.test(e.heure)) bad.push("horaire");
  const montant = Math.round(Number(String(b && b.montant != null ? b.montant : "").replace(",", ".")) * 100) / 100;
  if (!(montant >= 1 && montant <= 5000)) bad.push("montant");
  if (bad.length) return { erreur: [422, "Champs à vérifier : " + bad.join(", ") + "."], champs: bad };

  // Prix de la grille recalculé par le serveur (jamais repris du téléphone) : sert de référence à l'ajustement
  const g = await prixGrille(e);
  if (g.erreur === "passe" || g.erreur === "horaire") return { erreur: [422, MESSAGES_ESTIMATION[g.erreur]], champs: ["horaire"] };
  const grille = g.montant || null;
  const motif = s(b && b.motif, 160);
  if (grille != null && Math.abs(grille - montant) >= 0.005 && motif.length < 3)
    return { erreur: [422, "Prix différent de la grille (" + grille.toFixed(2).replace(".", ",") + " €) : indiquez le motif de l'ajustement."], champs: ["motif"] };

  const apporteur = s(b && b.apporteur, 80);
  const ref = nouvelleRef(now);
  const surPlace = { apporteur, saisieLe: new Date(now).toISOString(), prixGrille: grille, statutGrille: g.erreur ? "indisponible" : g.statut, motifGrille: g.motif || g.erreur || null,
    ajustement: grille != null && Math.abs(grille - montant) >= 0.005 ? { de: grille, a: montant, motif } : (grille == null && motif ? { de: null, a: montant, motif } : null) };
  const d = { prestation: "Course sur place", date: e.date, heure: e.heure, depart: e.depart, destination: e.destination, vehicule: e.vehicule,
    passagers: e.passagers, prenom: client.prenom, nom: client.nom, email: client.email, telephone: client.telephone || "",
    precisions: apporteur ? "Apporteur : " + apporteur : "", origine: { libelle: "Course sur place (saisie chauffeur)" }, surPlace };
  const est = { statut: "estimation", montant, distanceKm: g.distanceKm ?? null, dureeMin: g.dureeMin ?? null, vehicule: e.vehicule,
    lignes: [{ libelle: "Course " + (e.vehicule.split(" — ")[0]) + (g.distanceKm ? " (" + String(g.distanceKm).replace(".", ",") + " km)" : ""), montant, detail: surPlace.ajustement ? "prix convenu avec le client" : "" }] };
  const idDemande = await enregistrer(magasinDemandes(), { ref, d, est, now });
  const D = { ref, prestation: { date: e.date, heure: e.heure, vehicule: e.vehicule } };
  const st = magasin();
  const p = await creer(st, { ref, idDemande, montant, libelle: libelleCourse(D), description: descriptionCourse(D), priseEnCharge: instantParis(e.date, e.heure), origine,
    surPlace: { apporteur, chauffeur: { prenom: CHAUFFEUR.prenom, vehicule: e.vehicule.split(" — ")[0].replace("Berline Confort", "Tesla Model Y").replace("Van Premium", "Mercedes Classe V"), plaque: "", confirmeLe: new Date(now).toISOString(), par: "chauffeur" } }, now });
  await modifier(st, p.jeton, (x) => (x.etape === "attente_paiement" && x.surPlace && !x.surPlace.indexe ? note({ ...x, surPlace: { ...x.surPlace, indexe: true } }, "course saisie sur place" + (apporteur ? " (apporteur : " + apporteur + ")" : ""), now) : null));
  await st.setJSON("surplace/" + e.date.replace(/-/g, "") + "/" + ref, { jeton: p.jeton, le: new Date(now).toISOString() });
  return { course: await fiche(await parRef(st, ref), now), stripe: !!stripeActif() };
}

/* ---------- Paiement reçu hors Stripe (TPE Indy, Tap to Pay Indy, espèces) ---------- */
export async function marquerPaye({ ref, moyen, reference, now = P.now() }) {
  if (!MOYENS.includes(moyen)) return { erreur: [422, "Moyen de paiement inconnu."] };
  const st = magasin();
  const p = await parRef(st, ref);
  if (!p || !p.surPlace) return { erreur: [404, "Course introuvable."] };
  if (["paye", "a_verifier", "rembourse_partiel"].includes(p.statut)) return { erreur: [409, "Course déjà payée" + (p.horsStripe ? " (" + p.horsStripe.moyen + ")" : " en ligne") + "."], course: await fiche(p, now) };
  if (p.statut === "en_cours") return { erreur: [409, "Un paiement en ligne est en cours de validation par la banque : attendez son résultat."] };
  if (!["en_attente", "expire"].includes(p.statut)) return { erreur: [409, "Course annulée ou remboursée : impossible de la marquer payée."] };
  // Ferme d'abord le lien Stripe ouvert : le client ne peut plus payer une seconde fois en ligne
  if (p.sessionActive && stripeActif()) {
    try { await expirerSession(p.sessionActive); }
    catch {
      try {                                                            // déjà payé en ligne à l'instant ?
        const sess = await lireSession(p.sessionActive);
        const r = await modifier(st, p.jeton, (x) => appliquerSession(x, sess, now));
        if (r.p && ["paye", "en_cours", "a_verifier"].includes(r.p.statut)) return { erreur: [409, "Le client vient de payer en ligne : rien à encaisser."], course: await fiche(r.p, now) };
      } catch { /* session introuvable : on continue */ }
    }
  }
  const hs = { moyen, reference: s(reference, 60), le: new Date(now).toISOString() };
  const r = await modifier(st, p.jeton, (x) => (["en_attente", "expire"].includes(x.statut)
    ? note({ ...x, statut: "paye", payeLe: hs.le, horsStripe: hs, sessionActive: null, etape: x.etape === "attente_paiement" ? "chauffeur_confirme" : x.etape }, "payé hors Stripe : " + moyen + (hs.reference ? " (" + hs.reference + ")" : ""), now) : null));
  if (!r.change) return { erreur: [409, "La course a changé entre-temps (" + (r.p && r.p.statut) + ")."], course: await fiche(r.p, now) };
  return { course: await fiche(r.p, now) };
}

/* ---------- Course terminée (même contrôle que /documents) ---------- */
export async function terminer({ ref, now = P.now() }) {
  const p = await parRef(magasin(), ref);
  if (!p || !p.surPlace) return { erreur: [404, "Course introuvable."] };
  const r = await confirmerRealisation({ ref, now });
  if (r.erreur) return r;
  return { course: await fiche(await parRef(magasin(), ref), now), facture: r.facture || null };
}

/* ---------- Annulation d'une course non payée (le client renonce) ---------- */
export async function annuler({ ref, now = P.now() }) {
  const st = magasin();
  const p = await parRef(st, ref);
  if (!p || !p.surPlace) return { erreur: [404, "Course introuvable."] };
  if (!["en_attente", "expire"].includes(p.statut)) return { erreur: [409, p.statut === "paye" || p.statut === "rembourse_partiel" ? "Course payée : pour rembourser, passez par /documents (paiement en ligne) ou par le même moyen (TPE, espèces)." : "Course déjà annulée ou en cours de paiement."] };
  if (p.sessionActive && stripeActif()) { try { await expirerSession(p.sessionActive); } catch { /* déjà fermée */ } }
  const r = await modifier(st, p.jeton, (x) => (["en_attente", "expire"].includes(x.statut) ? note({ ...x, statut: "annule", etape: "annulee", sessionActive: null }, "course sur place annulée avant paiement", now) : null));
  if (!r.change) return { erreur: [409, "La course a changé entre-temps."] };
  return { course: await fiche(r.p, now) };
}

/* ---------- Lecture ---------- */
export async function fiche(p, now = P.now()) {
  if (!p) return null;
  const R = resume(p);
  let D = null;
  try {
    const r = p.idDemande ? await chargerParId(magasinDemandes(), p.idDemande, now) : null;
    D = r && r.record;
  } catch { D = null; }
  return { ref: p.ref, lien: R.lien, montant: R.montant, statut: p.statut, statutLibelle: R.statutLibelle, etape: p.etape, etapeLibelle: R.etapeLibelle,
    payeLe: p.payeLe, horsStripe: p.horsStripe || null, enLigne: !!p.paymentIntent, valableJusqu: p.valableJusqu, priseEnCharge: p.priseEnCharge,
    reservationLe: (p.surPlace && p.surPlace.saisieLe) || p.cree, realiseeLe: p.realisation ? p.realisation.le : null, apporteur: (p.surPlace && p.surPlace.apporteur) || "",
    client: D ? { prenom: D.client.prenom, nom: D.client.nom, telephone: D.client.telephone, email: D.client.email } : null,
    trajet: D ? { depart: D.prestation.depart, destination: D.prestation.destination, vehicule: D.prestation.vehicule, passagers: D.prestation.passagers,
      distanceKm: D.estimation && D.estimation.distanceKm } : null,
    ajustement: D && D.surPlace ? D.surPlace.ajustement : null, prixGrille: D && D.surPlace ? D.surPlace.prixGrille : null };
}
export async function lire({ ref, now = P.now() }) {
  const p = await parRef(magasin(), ref);
  if (!p || !p.surPlace) return { erreur: [404, "Course introuvable."] };
  return { course: await fiche(p, now) };
}
/* Courses saisies aujourd'hui et hier (heure de Paris), les plus récentes d'abord */
export async function listerJour({ now = P.now() } = {}) {
  const st = magasin();
  const jours = [maintenantParis(now).date, maintenantParis(now - 86400_000).date].map((d) => d.replace(/-/g, ""));
  const out = [];
  for (const j of jours) {
    const { blobs } = await st.list({ prefix: "surplace/" + j + "/" });
    for (const b of blobs) {
      const l = await st.get(b.key, { type: "json" });
      const p = l && l.jeton ? await st.get("paiement/" + l.jeton, { type: "json" }) : null;
      if (p) out.push(await fiche(p, now));
    }
  }
  return out.sort((a, b) => String(b.reservationLe).localeCompare(String(a.reservationLe))).slice(0, 40);
}
