/* ==========================================================================
   ELEV8 Private Driver — Compteur ELEV8 (prix au temps et à la distance)
   --------------------------------------------------------------------------
   Course VTC dont le prix est calculé APRÈS la prestation, selon la distance parcourue
   et le temps passé à l'arrêt ou au ralenti (comme un taxi : soit la distance, soit le
   temps, jamais les deux en même temps). Autorisé pour les VTC depuis la décision du
   Conseil constitutionnel n° 2015-468/469/472 QPC du 22 mai 2015 ; la réservation
   préalable reste obligatoire : elle est enregistrée (horodatée) au moment du « Départ »,
   tarifs affichés au client.

   Déroulé (page /chauffeur, onglet « Compteur ») :
     1. Départ  : réservation E8-… enregistrée (client, lieu de prise en charge, tarifs) ;
     2. pendant : le téléphone / la tablette mesure les km (GPS) et le temps au ralenti ;
     3. Arrivée : prix final calculé ici (jamais repris tel quel du navigateur),
                  dossier de paiement créé → QR code / SMS Stripe ou TPE / espèces.
   ========================================================================== */
import { magasin, creer, parRef, deps as P } from "./paiements.mjs";
import { magasin as magasinDemandes, enregistrer, mettreAJour, supprimer, chargerParId } from "./demandes.mjs";
import { ignRoute } from "./estimation.mjs";
import { nouvelleRef, telephone, maintenantParis, adresseDePosition, fiche, CHAUFFEUR } from "./sur-place.mjs";

/* Tarifs ELEV8 — à modifier ici (le prix affiché et le prix final utilisent les mêmes valeurs) */
export const TARIFS = {
  priseEnCharge: 4.50,   // € TTC
  km: 1.90,              // € TTC par kilomètre parcouru (au-dessus de la vitesse seuil)
  heure: 45,             // € TTC par heure d'attente ou de marche lente (sous la vitesse seuil)
  seuilKmh: 20,          // sous cette vitesse, c'est le temps qui compte (et non plus la distance)
  minimum: 20            // € TTC, course minimum (hors péages et parkings)
};
export const deps = { route: (a, b) => ignRoute(a, b), adresse: (lat, lon) => adresseDePosition(lat, lon) };

const s = (v, max) => (typeof v === "string" ? v.replace(/[\u0000-\u001F\u007F]/g, " ").replace(/\s+/g, " ").trim().slice(0, max) : "");
const arr = (n) => Math.round(n * 100) / 100;
const eur = (n) => n.toFixed(2).replace(".", ",") + " €";
const coord = (p) => (p && Number.isFinite(+p.lat) && Number.isFinite(+p.lon) && Math.abs(+p.lat) <= 90 && Math.abs(+p.lon) <= 180 ? { lat: +p.lat, lon: +p.lon } : null);

/* Calcul du prix (même formule que l'affichage en direct du navigateur) */
export function calculer({ km = 0, lentSec = 0, peages = 0 }, T = TARIFS) {
  km = Math.max(0, +km || 0); lentSec = Math.max(0, +lentSec || 0); peages = Math.max(0, +peages || 0);
  const pKm = arr(km * T.km), minutes = lentSec / 60, pTemps = arr(minutes * T.heure / 60);
  const brut = arr(T.priseEnCharge + pKm + pTemps);
  const course = Math.max(T.minimum, brut);
  const lignes = [
    { libelle: "Prise en charge", montant: T.priseEnCharge },
    { libelle: `Distance : ${km.toFixed(1).replace(".", ",")} km × ${eur(T.km)}`, montant: pKm },
    { libelle: `Attente / marche lente : ${Math.round(minutes)} min × ${eur(T.heure / 60)}`, montant: pTemps }
  ];
  if (course > brut) lignes.push({ libelle: `Minimum de course (${eur(T.minimum)})`, montant: arr(course - brut) });
  if (peages > 0) lignes.push({ libelle: "Péages et stationnement", montant: arr(peages) });
  return { km: arr(km), minutes: Math.round(minutes), brut, total: arr(course + peages), lignes };
}

/* ---------- Départ : réservation horodatée, compteur lancé ---------- */
export async function demarrer(b, { now = P.now() } = {}) {
  const c = b && b.client || {};
  const client = { prenom: s(c.prenom, 60), nom: s(c.nom, 80), telephone: telephone(c.telephone), email: s(c.email, 120).toLowerCase() };
  const depart = s(b && b.depart, 200), pos = coord(b && b.position);
  const bad = [];
  if (depart.length < 3) bad.push("depart");
  if (client.nom.length < 2) bad.push("nom");
  if (client.telephone === null) bad.push("telephone");
  if (client.email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(client.email)) bad.push("email");
  if (bad.length) return { erreur: [422, "Champs à vérifier : " + bad.join(", ") + "."], champs: bad };
  const vehicule = b && b.vehicule === "van" ? "Van Premium — Mercedes Classe V" : "Berline Confort — Tesla Model Y";
  const apporteur = s(b && b.apporteur, 80);
  const m = maintenantParis(now), ref = nouvelleRef(now);
  const surPlace = { mode: "compteur", apporteur, saisieLe: new Date(now).toISOString(), tarifs: { ...TARIFS } };
  const d = { prestation: "Course au compteur", date: m.date, heure: m.heure, depart, destination: "(au compteur — connue à l'arrivée)", vehicule,
    passagers: Math.max(1, Math.min(8, parseInt(b && b.passagers, 10) || 1)), prenom: client.prenom, nom: client.nom, email: client.email, telephone: client.telephone || "",
    precisions: (apporteur ? "Apporteur : " + apporteur + ". " : "") + `Prix au temps et à la distance : prise en charge ${eur(TARIFS.priseEnCharge)}, ${eur(TARIFS.km)}/km, ${eur(TARIFS.heure)}/h d'attente ou de marche lente (sous ${TARIFS.seuilKmh} km/h), minimum ${eur(TARIFS.minimum)}, péages et parkings en sus.`,
    origine: { libelle: "Course au compteur (saisie chauffeur)" }, surPlace };
  const idDemande = await enregistrer(magasinDemandes(), { ref, d, est: { statut: "compteur", lignes: [] }, now });
  const etat = { ref, idDemande, debut: new Date(now).toISOString(), depart: { adresse: depart, ...(pos || {}) }, vehicule, apporteur, tarifs: { ...TARIFS }, statut: "en_cours" };
  await magasin().setJSON("compteur/" + ref, etat);
  return { compteur: etat };
}

/* ---------- Arrivée : prix final, dossier de paiement ---------- */
export async function arreter(b, { origine, now = P.now() } = {}) {
  const st = magasin(), ref = String(b && b.ref || "").toUpperCase();
  const etat = await st.get("compteur/" + ref, { type: "json" });
  if (!etat) return { erreur: [404, "Course au compteur introuvable."] };
  if (etat.statut !== "en_cours") {
    const p = await parRef(st, ref);
    return p ? { course: await fiche(p, now) } : { erreur: [409, "Course déjà terminée."] };
  }
  let km = Math.max(0, Math.min(2000, +b.km || 0));
  const lentSec = Math.max(0, Math.min(86400, +b.lentSec || 0));
  const peages = Math.max(0, Math.min(500, Math.round((+String(b.peages ?? 0).replace(",", ".") || 0) * 100) / 100));
  const fin = coord(b.position), debut = coord(etat.depart);
  // Contrôle GPS : si le signal a décroché (tunnel, parking), on retient au moins la distance de l'itinéraire le plus court
  let controle = null;
  if (debut && fin) {
    try { const r = await deps.route(debut, fin); controle = r && r.distanceKm > 0 ? Math.round(r.distanceKm * 10) / 10 : null; } catch { controle = null; }
    if (controle && km < controle * 0.9) km = controle;
  }
  const destination = s(b.destination, 200) || (fin ? await deps.adresse(fin.lat, fin.lon) : null) || "Position GPS d'arrivée";
  const T = etat.tarifs || TARIFS, prix = calculer({ km, lentSec, peages }, T);
  const dureeMin = Math.max(1, Math.round((now - Date.parse(etat.debut)) / 60000));
  const D = await mettreAJour(magasinDemandes(), etat.idDemande, (r) => {
    r.prestation.destination = destination;
    r.estimation = { statut: "estimation", motif: "compteur", montant: prix.total, distanceKm: prix.km, dureeMin, lignes: prix.lignes };
    r.surPlace = { ...(r.surPlace || {}), arriveeLe: new Date(now).toISOString(), compteur: { km: prix.km, kmGps: arr(Math.max(0, +b.km || 0)), kmItineraire: controle, minutesLentes: prix.minutes, peages } };
    return r;
  });
  if (!D) return { erreur: [404, "Réservation introuvable."] };
  const vehiculeCourt = etat.vehicule.split(" — ")[1] || etat.vehicule;
  const p = await creer(st, { ref, idDemande: etat.idDemande, montant: prix.total,
    libelle: `Course ELEV8 du ${D.prestation.date.split("-").reverse().join("/")} — ${D.prestation.heure}`,
    description: `${etat.depart.adresse} → ${destination} · ${prix.km.toString().replace(".", ",")} km · prix au compteur`,
    priseEnCharge: Date.parse(etat.debut), origine,
    surPlace: { apporteur: etat.apporteur, chauffeur: { prenom: CHAUFFEUR.prenom, vehicule: vehiculeCourt, plaque: "", confirmeLe: etat.debut, par: "chauffeur" } }, now });
  await st.setJSON("compteur/" + ref, { ...etat, statut: "termine", fin: new Date(now).toISOString(), prix });
  await st.setJSON("surplace/" + D.prestation.date.replace(/-/g, "") + "/" + ref, { jeton: p.jeton, le: etat.debut });
  return { course: await fiche(await parRef(st, ref), now), prix };
}

/* ---------- Abandon avant l'arrivée (erreur de saisie, client qui renonce) ---------- */
export async function abandonner(b, { now = P.now() } = {}) {
  const st = magasin(), ref = String(b && b.ref || "").toUpperCase();
  const etat = await st.get("compteur/" + ref, { type: "json" });
  if (!etat || etat.statut !== "en_cours") return { erreur: [409, "Aucune course au compteur en cours avec cette référence."] };
  await st.setJSON("compteur/" + ref, { ...etat, statut: "abandonne", fin: new Date(now).toISOString() });
  const r = await chargerParId(magasinDemandes(), etat.idDemande, now);
  if (r.record) await supprimer(magasinDemandes(), r.record);
  return { ok: true };
}

/* Course au compteur en cours (pour reprendre après un rechargement de la page) */
export async function enCours(ref) {
  const e = ref ? await magasin().get("compteur/" + String(ref).toUpperCase(), { type: "json" }) : null;
  return e && e.statut === "en_cours" ? e : null;
}
