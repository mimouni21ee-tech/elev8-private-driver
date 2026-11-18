/* ==========================================================================
   ELEV8 Private Driver — estimation tarifaire (commune à /estimation et /envoi-reservation)
   --------------------------------------------------------------------------
   Exécutée uniquement sur les serveurs de Netlify : le navigateur n'envoie jamais
   une distance ni un montant qui serait pris en compte.

   Grille : netlify/lib/grille/dijon-tarif.cjs (moteur de calcul, copie conforme de la
   préproduction) et dijon-config.cjs (grille ELEV8). Seul changement par rapport à la
   préproduction (17 nov. 2026) : Tesla Model Y de jour 1,90 €/km, minimum 20 € ;
   nuit, dimanche, jours fériés et Classe V inchangés :
     prix = max(minimum de la catégorie et de la période, km routiers × tarif au km),
     tarif de jour / majoré (nuit, dimanche, jours fériés) à l'heure de Paris,
     chaque trajet d'un aller-retour calculé séparément.
   Périmètre : trajets (aller simple, aller-retour) dont le départ ET l'arrivée sont
   dans la zone de référence (50 km autour de Dijon : Nuits-Saint-Georges, Beaune…). Sinon, ou pour une mise à disposition :
   « tarif sur devis », aucun montant affiché.

   Le résultat est TOUJOURS une estimation : seule ELEV8 confirme le prix final.

   Itinéraire :
     1. Google Routes API (si GOOGLE_MAPS_API_KEY existe et que l'API Routes est activée),
        adresses envoyées telles que saisies, sans trafic en temps réel (le moins cher) ;
        plafond journalier partagé : ROUTES_GOOGLE_MAX_JOUR (défaut 800).
     2. Relais gratuit : géocodage IGN / Photon (OpenStreetMap) puis itinéraire IGN.
   Aucune donnée personnelle n'est transmise : seulement les deux adresses.
   ========================================================================== */
import { createHmac, timingSafeEqual } from "node:crypto";
import TARIF from "./grille/dijon-tarif.cjs";
import CONFIG from "./grille/dijon-config.cjs";

const G = CONFIG.tarifs, ZONE = G.trajets.horsCharge.zoneReference;
const TIMEOUT_MS = 4000, CACHE_MS = 6 * 3600_000, VALIDITE_JETON_MS = 24 * 3600_000;

/* Dépendances remplaçables pour les tests automatisés */
export const deps = { fetch: (...a) => fetch(...a), now: () => Date.now(), store: null };

const env = (k) => (typeof process !== "undefined" && process.env && process.env[k] ? String(process.env[k]) : "").trim();
const clean = (v, n = 200) => (typeof v === "string" ? v.replace(/[\u0000-\u001F\u007F<>]/g, " ").replace(/\s+/g, " ").trim().slice(0, n) : "");
const reDate = /^\d{4}-\d{2}-\d{2}$/, reHeure = /^([01]\d|2[0-3]):[0-5]\d$/;

/* ---------- Catégorie tarifaire selon le véhicule choisi ----------
   Tesla Model Y → Confort ; Mercedes-Benz Classe V → Van ;
   « Pas de préférence » → Confort jusqu'à 4 passagers, Van au-delà. */
export function categorie(vehicule, passagers) {
  const v = String(vehicule || "");
  if (/classe\s*v|viano|\bvan\b/i.test(v)) return "van";            // « Van Premium — Mercedes Classe V… »
  if (/tesla|model\s*y|berline/i.test(v)) return "confort";           // « Berline Confort — Tesla Model Y… »
  return (+passagers || 1) > 4 ? "van" : "confort";
}
export const LIBELLE_CATEGORIE = {
  confort: "Berline Confort — Tesla Model Y ou véhicule de catégorie équivalente",
  van: "Van Premium — Mercedes Classe V ou véhicule de catégorie équivalente"
};

/* ---------- Heure de Paris → instant (heures d'été et d'hiver) ---------- */
export function instantParis(date, heure) {
  const [y, mo, d] = date.split("-").map(Number), [h, mi] = heure.split(":").map(Number);
  const mur = Date.UTC(y, mo - 1, d, h, mi);
  let t = mur;
  for (let i = 0; i < 2; i++) {
    const p = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Paris", hourCycle: "h23",
      year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).formatToParts(new Date(t)).map((x) => [x.type, x.value]));
    t = mur - (Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute) - t);
  }
  return t;
}

function volOiseau(a, b) {
  const R = 6371, r = Math.PI / 180, dLat = (b.lat - a.lat) * r, dLon = (b.lon - a.lon) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
export const dansZone = (p) => !!p && isFinite(p.lat) && isFinite(p.lon) && volOiseau(ZONE, p) <= ZONE.rayonKm;

async function getJSON(url, init = {}) {
  const ctrl = new AbortController(), timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const r = await deps.fetch(url, { ...init, signal: ctrl.signal });
    if (!r.ok) { const e = new Error("http " + r.status); e.status = r.status; throw e; }
    return await r.json();
  } finally { clearTimeout(timer); }
}

/* ---------- Plafond Google journalier, partagé par toutes les instances (Netlify Blobs) ---------- */
async function budgetGoogle() {
  const max = Number.parseInt(env("ROUTES_GOOGLE_MAX_JOUR"), 10) || 800;
  const store = deps.store;
  if (!store) return true;                                     // stockage indisponible : quotas Google Cloud seuls
  const key = "quota-routes/" + new Date(deps.now()).toISOString().slice(0, 10);
  try {
    for (let i = 0; i < 6; i++) {
      const cur = await store.getWithMetadata(key, { type: "json" });
      const n = cur && cur.data && Number.isInteger(cur.data.n) ? cur.data.n : 0;
      if (n >= max) return false;
      const res = cur ? await store.setJSON(key, { n: n + 1 }, { onlyIfMatch: cur.etag }) : await store.setJSON(key, { n: 1 }, { onlyIfNew: true });
      if (res && res.modified) return true;
    }
    return false;
  } catch { return true; }
}

/* ---------- Itinéraire Google (adresses en texte) ---------- */
export async function googleRoute(a, b, key) {
  const data = await getJSON("https://routes.googleapis.com/directions/v2:computeRoutes", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Goog-Api-Key": key,
      "X-Goog-FieldMask": "routes.distanceMeters,routes.duration,routes.legs.startLocation,routes.legs.endLocation" },
    body: JSON.stringify({ origin: { address: a }, destination: { address: b }, travelMode: "DRIVE",
      routingPreference: "TRAFFIC_UNAWARE", computeAlternativeRoutes: false, languageCode: "fr-FR", regionCode: "fr", units: "METRIC" })
  });
  const r = data && data.routes && data.routes[0];
  if (!r || !(r.distanceMeters > 0)) { const e = new Error("aucun itinéraire"); e.noRoute = true; throw e; }
  const leg = (r.legs && r.legs[0]) || {};
  const ll = (o) => (o && o.latLng && isFinite(o.latLng.latitude) ? { lat: o.latLng.latitude, lon: o.latLng.longitude } : null);
  const debut = ll(leg.startLocation), fin = ll(leg.endLocation);
  if (!debut || !fin) { const e = new Error("lieux non localisés"); e.noRoute = true; throw e; }
  return { distanceKm: r.distanceMeters / 1000, dureeMin: Math.max(1, Math.ceil(parseFloat(r.duration || "0") / 60)), source: "google", debut, fin };
}

/* ---------- Relais gratuit : géocodage IGN (adresses) ou Photon (lieux), puis itinéraire IGN ---------- */
export async function ignGeocode(q) {
  const d = await getJSON("https://data.geopf.fr/geocodage/search?" + new URLSearchParams({ q, index: "address", limit: "1" }), { headers: { Accept: "application/json" } });
  const f = d && d.features && d.features[0];
  if (!f || !f.geometry || (f.properties && f.properties.score != null && f.properties.score < 0.5)) return null;
  const [lon, lat] = f.geometry.coordinates || [];
  return isFinite(lat) && isFinite(lon) ? { lat: +lat, lon: +lon } : null;
}
export async function photonGeocode(q) {
  const d = await getJSON("https://photon.komoot.io/api/?" + new URLSearchParams({ q, lang: "fr", limit: "1", lat: String(ZONE.lat), lon: String(ZONE.lon), location_bias_scale: "0.3" }),
    { headers: { Accept: "application/json", "User-Agent": "ELEV8-Private-Driver/1.0 (estimation)" } });
  const f = d && d.features && d.features[0];
  const c = f && f.geometry && f.geometry.coordinates;
  return c && isFinite(c[1]) && isFinite(c[0]) ? { lat: +c[1], lon: +c[0] } : null;
}
export async function geocodeLibre(q) {
  // Saisie commençant par un numéro : adresse postale (IGN d'abord) ; sinon lieu nommé (Photon d'abord)
  const ordre = /^\s*\d/.test(q) ? [ignGeocode, photonGeocode] : [photonGeocode, ignGeocode];
  for (const f of ordre) { try { const p = await f(q); if (p) return p; } catch { /* service suivant */ } }
  return null;
}
export async function ignRoute(a, b) {
  const q = new URLSearchParams({ resource: "bdtopo-osrm", profile: "car", optimization: "fastest",
    start: a.lon + "," + a.lat, end: b.lon + "," + b.lat, distanceUnit: "kilometer", timeUnit: "minute", getSteps: "false", getBbox: "false" });
  const d = await getJSON("https://data.geopf.fr/navigation/itineraire?" + q, { headers: { Accept: "application/json" } });
  if (!d || !(+d.distance > 0)) { const e = new Error("aucun itinéraire"); e.noRoute = true; throw e; }
  return { distanceKm: +d.distance, dureeMin: Math.max(1, Math.ceil(+d.duration)), source: "ign" };
}

const routeCache = new Map();
export function _reset() { routeCache.clear(); }
async function itineraire(a, b) {
  const ck = a.toLowerCase() + ">" + b.toLowerCase(), hit = routeCache.get(ck);
  if (hit && deps.now() - hit.t < CACHE_MS) return hit.v;
  const key = env("GOOGLE_MAPS_API_KEY");
  let v = null;
  if (key && env("ESTIMATION_ITINERAIRE").toLowerCase() !== "gratuit" && await budgetGoogle()) {
    try { v = await googleRoute(a, b, key); } catch { v = null; }       // API non activée, quota, panne → relais gratuit
  }
  if (!v) {
    const [pa, pb] = await Promise.all([geocodeLibre(a), geocodeLibre(b)]);
    if (!pa || !pb) { const e = new Error("lieu non localisé"); e.noPlace = true; throw e; }
    // Hors zone : inutile de calculer l'itinéraire, le tarif sera « sur devis »
    if (!dansZone(pa) || !dansZone(pb)) v = { distanceKm: 0, dureeMin: 0, source: "libre", debut: pa, fin: pb, horsZone: true };
    else v = { ...(await ignRoute(pa, pb)), debut: pa, fin: pb };
  }
  routeCache.set(ck, { t: deps.now(), v });
  if (routeCache.size > 500) routeCache.delete(routeCache.keys().next().value);
  return v;
}

/* ---------- Données d'entrée (même format pour l'estimation et pour la demande) ---------- */
export function entree(b) {
  b = b || {};
  return {
    prestation: clean(b.prestation, 80),
    depart: clean(b.depart, 200),
    destination: clean(b.destination, 200),
    date: clean(b.date, 10),
    heure: clean(b.heure, 5),
    allerRetour: b.allerRetour === true,
    dateRetour: b.allerRetour === true ? clean(b.dateRetour, 10) : "",
    heureRetour: b.allerRetour === true ? clean(b.heureRetour, 5) : "",
    vehicule: clean(b.vehicule, 100),
    passagers: Number.parseInt(b.passagers, 10) || 1
  };
}
/* Empreinte des éléments qui déterminent le prix */
const empreinte = (e) => JSON.stringify([e.prestation, e.depart.toLowerCase(), e.destination.toLowerCase(), e.date, e.heure,
  e.allerRetour, e.dateRetour, e.heureRetour, categorie(e.vehicule, e.passagers)]);

/* ---------- Calcul ----------
   Renvoie { statut: "estimation" | "sur_devis", motif, montant, categorie, ... }
   ou lève une erreur { code } si les informations sont incomplètes ou si le calcul est impossible. */
export async function estimer(b) {
  const e = entree(b);
  const err = (code) => { const x = new Error(code); x.code = code; return x; };
  if (e.depart.length < 3 || e.destination.length < 3) throw err("lieu");
  if (!reDate.test(e.date) || !reHeure.test(e.heure)) throw err("horaire");
  const t0 = instantParis(e.date, e.heure), now = deps.now();
  if (t0 < now - 3600_000) throw err("passe");
  if (t0 > now + 366 * 86400_000) throw err("horaire");
  if (e.allerRetour) {
    if (!reDate.test(e.dateRetour) || !reHeure.test(e.heureRetour)) throw err("retour");
    if (instantParis(e.dateRetour, e.heureRetour) <= t0) throw err("retour");
  }
  const cat = categorie(e.vehicule, e.passagers);
  const base = { categorie: cat, vehicule: LIBELLE_CATEGORIE[cat], allerRetour: e.allerRetour, empreinte: empreinte(e) };

  if (/mise\s+à\s+disposition/i.test(e.prestation)) return { ...base, statut: "sur_devis", motif: "mise_a_disposition" };
  if (e.depart.toLowerCase() === e.destination.toLowerCase()) throw err("identiques");

  let aller;
  try { aller = await itineraire(e.depart, e.destination); }
  catch (x) { throw err(x && x.noPlace ? "lieu_inconnu" : x && x.noRoute ? "itineraire" : "indisponible"); }
  if (aller.horsZone || !dansZone(aller.debut) || !dansZone(aller.fin)) return { ...base, statut: "sur_devis", motif: "hors_zone" };

  const trajets = [{ distanceKm: aller.distanceKm, dureeMin: aller.dureeMin, depart: e.date + "T" + e.heure }];
  const sources = [aller.source];
  if (e.allerRetour) {
    if (instantParis(e.dateRetour, e.heureRetour) < t0 + aller.dureeMin * 60_000) throw err("retour");
    let retour;
    try { retour = await itineraire(e.destination, e.depart); }
    catch (x) { throw err(x && x.noRoute ? "itineraire" : "indisponible"); }
    trajets.push({ distanceKm: retour.distanceKm, dureeMin: retour.dureeMin, depart: e.dateRetour + "T" + e.heureRetour });
    sources.push(retour.source);
  }
  const q = TARIF.calculer({ type: e.allerRetour ? "ar" : "simple", trajets }, G);
  if (q.partiel) return { ...base, statut: "sur_devis", motif: "hors_zone" };
  const c = q.categories[cat];
  return {
    ...base,
    statut: "estimation",
    montant: c.total,
    distanceKm: Math.round(q.distanceKm * 10) / 10,
    dureeMin: q.dureeMin,
    lignes: c.lignes.map((l) => ({ libelle: l.libelle, montant: l.montant, detail: l.detail || "" })),
    source: [...new Set(sources)].join("+")
  };
}

/* ---------- Jeton signé : permet à /envoi-reservation de reprendre l'estimation sans la recalculer ----------
   Clé : ESTIMATION_SECRET si elle existe (32 caractères minimum), sinon dérivée de EMAIL_API_KEY
   (déjà présente dans Netlify) : aucune nouvelle variable n'est nécessaire. */
function cle() {
  const s = env("ESTIMATION_SECRET");
  if (s.length >= 32) return s;
  const k = env("EMAIL_API_KEY");
  return k ? createHmac("sha256", k).update("elev8-estimation-v1").digest("hex") : "";
}
const corpsJeton = (r, exp) => JSON.stringify([r.empreinte, r.statut, r.motif || "", r.montant ?? null, r.distanceKm ?? null,
  r.dureeMin ?? null, r.categorie, r.source || "", (r.lignes || []).map((l) => [l.libelle, l.montant, l.detail]), exp]);
export function signer(r) {
  const k = cle(); if (!k) return null;
  const exp = deps.now() + VALIDITE_JETON_MS;
  return { exp, sig: createHmac("sha256", k).update(corpsJeton(r, exp)).digest("base64url") };
}
/* Vérifie un résultat renvoyé par le navigateur : signature valide, non expiré, et calculé
   pour EXACTEMENT les mêmes adresses, horaires et véhicule que la demande envoyée. */
export function verifier(r, demande) {
  try {
    if (!r || typeof r !== "object" || !r.jeton || typeof r.jeton.sig !== "string") return null;
    const k = cle(); if (!k) return null;
    const exp = +r.jeton.exp;
    if (!(exp > deps.now()) || exp > deps.now() + VALIDITE_JETON_MS + 60_000) return null;
    if (r.empreinte !== empreinte(entree(demande))) return null;
    const a = Buffer.from(r.jeton.sig), b = Buffer.from(createHmac("sha256", k).update(corpsJeton(r, exp)).digest("base64url"));
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
    const lignes = Array.isArray(r.lignes) ? r.lignes.slice(0, 4).map((l) => ({ libelle: clean(l.libelle, 60), montant: +l.montant, detail: clean(l.detail, 160) })) : [];
    return { statut: r.statut, motif: r.motif || null, montant: r.montant == null ? null : +r.montant, distanceKm: r.distanceKm ?? null,
      dureeMin: r.dureeMin ?? null, categorie: r.categorie, vehicule: LIBELLE_CATEGORIE[r.categorie], allerRetour: !!r.allerRetour,
      lignes, source: clean(r.source, 20), empreinte: r.empreinte };
  } catch { return null; }
}

export const ZONE_ESTIMATION = { nom: ZONE.nom, rayonKm: ZONE.rayonKm };
