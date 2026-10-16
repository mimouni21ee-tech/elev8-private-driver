/* ==========================================================================
   ELEV8 Private Driver — suggestions d'adresses (champs « Départ » et « Destination »)
   --------------------------------------------------------------------------
   Adresse : /adresses   (appelée par public/assets/js/adresses.js)
   Exécutée en priorité sur le serveur Netlify le plus proche du client
   (netlify/edge-functions/adresses.js réutilise ce même code) ; cette
   fonction classique reste en secours.

   Le navigateur n'appelle jamais directement Google ni aucun autre service :
   il interroge cette fonction, exécutée sur les serveurs de Netlify, qui
   transmet UNIQUEMENT le texte saisi (ni adresse IP, ni autre information).
   La clé Google reste donc secrète, côté serveur.

   Deux modes, choisis automatiquement :
     1. Google Places (recommandé) — si la variable GOOGLE_MAPS_API_KEY existe
        dans Netlify (Site configuration → Environment variables).
        Adresses, numéros, hôtels, gares, aéroports, établissements, monde entier.
     2. Mode gratuit, sans clé — Géoplateforme de l'IGN (adresses françaises,
        très précise sur les numéros) + Photon (données OpenStreetMap :
        lieux, gares, aéroports, hôtels, international).
   Si Google ne répond pas (panne, quota du jour atteint…), le mode gratuit
   prend le relais automatiquement. Si tout échoue, le champ reste un champ
   texte normal : la réservation n'est jamais bloquée.

   Variables Netlify (facultatives)
     GOOGLE_MAPS_API_KEY   clé Google « Places API (New) » (secrète, jamais dans config.js)
     ADRESSES_PROVIDER     "google" ou "gratuit" pour forcer un mode (défaut : automatique)
     ALLOWED_ORIGINS       mêmes domaines autorisés que pour l'envoi des réservations

   Aucune donnée n'est enregistrée ni écrite dans les journaux (logs).
   ========================================================================== */

export const config = { path: "/adresses" };

const MIN_LEN = 3, MAX_LEN = 120, MAX_RESULTS = 6, TIMEOUT_MS = 2500;
const GRACE_MS = 250;   // mode gratuit : attente maximale du 2e service une fois le 1er arrivé

/* Zone favorisée (sans exclure le reste du monde) : France, Suisse et pays voisins */
const BIAS_RECT = { low: { latitude: 41.3, longitude: -5.2 }, high: { latitude: 51.2, longitude: 10.6 } };
const BIAS_POINT = { lat: 46.6, lon: 5.6 }; // entre Dijon, Genève et la Côte d'Azur

/* Dépendances remplaçables pour les tests automatisés */
export const deps = { fetch: (...a) => fetch(...a), now: () => Date.now() };

const env = (k) => {
  const N = globalThis.Netlify;
  const v = (N && N.env && N.env.get(k)) || (typeof process !== "undefined" && process.env ? process.env[k] : "");
  return (v || "").trim();
};
const json = (status, body) => new Response(JSON.stringify(body), {
  status,
  headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }
});
const clean = (v) => (typeof v === "string" ? v.replace(/[\u0000-\u001F\u007F<>]/g, " ").replace(/\s+/g, " ").trim() : "");

/* ---------- Protection simple contre les abus (par instance) ----------
   La vraie limite de coût se règle dans Google Cloud (quota quotidien) :
   une fois le quota atteint, Google refuse et le mode gratuit prend le relais. */
const hits = new Map();          // empreinte visiteur → horodatages récents
const PER_MIN = 40, PER_HOUR = 300;
function allow(ip) {
  const now = deps.now();
  const list = (hits.get(ip) || []).filter((t) => now - t < 3600_000);
  const lastMin = list.filter((t) => now - t < 60_000).length;
  if (lastMin >= PER_MIN || list.length >= PER_HOUR) { hits.set(ip, list); return false; }
  list.push(now); hits.set(ip, list);
  if (hits.size > 5000) hits.delete(hits.keys().next().value);
  return true;
}

/* ---------- Petit cache (mêmes saisies = réponse immédiate, moins d'appels payants) ---------- */
const cache = new Map();
const CACHE_TTL = 15 * 60_000, CACHE_MAX = 600;
function cacheGet(k) {
  const e = cache.get(k);
  if (!e) return null;
  if (deps.now() - e.t > CACHE_TTL) { cache.delete(k); return null; }
  return e.v;
}
function cacheSet(k, v) {
  cache.set(k, { t: deps.now(), v });
  if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
}

async function getJSON(url, init = {}, timeout = TIMEOUT_MS) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    const r = await deps.fetch(url, { ...init, signal: ctrl.signal });
    if (!r.ok) { const e = new Error("http " + r.status); e.status = r.status; throw e; }
    return await r.json();
  } finally { clearTimeout(timer); }
}

/* ---------- Mode 1 : Google Places API (New) — Autocomplete ---------- */
function googleKind(types = []) {
  const t = new Set(types);
  if (t.has("airport")) return "avion";
  if (t.has("train_station") || t.has("transit_station") || t.has("subway_station") || t.has("light_rail_station")) return "train";
  if (t.has("lodging") || t.has("hotel")) return "hotel";
  if (t.has("street_address") || t.has("premise") || t.has("subpremise") || t.has("route") || t.has("geocode") && !t.has("establishment")) return "adresse";
  if (t.has("locality") || t.has("administrative_area_level_1") || t.has("country") || t.has("postal_code")) return "ville";
  return "lieu";
}

export async function searchGoogle(q, session, key) {
  const body = {
    input: q,
    languageCode: "fr",
    regionCode: "fr",
    locationBias: { rectangle: BIAS_RECT }
  };
  if (session) body.sessionToken = session;
  const data = await getJSON("https://places.googleapis.com/v1/places:autocomplete", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": key,
      "X-Goog-FieldMask": "suggestions.placePrediction.text.text,suggestions.placePrediction.structuredFormat,suggestions.placePrediction.types"
    },
    body: JSON.stringify(body)
  });
  return (data.suggestions || [])
    .map((s) => s.placePrediction)
    .filter(Boolean)
    .map((p) => {
      const full = clean(p.text && p.text.text);
      const sf = p.structuredFormat || {};
      return {
        t: clean(sf.mainText && sf.mainText.text) || full,
        d: clean(sf.secondaryText && sf.secondaryText.text),
        v: full,
        k: googleKind(p.types)
      };
    })
    .filter((s) => s.v)
    .slice(0, MAX_RESULTS);
}

/* ---------- Mode 2 (gratuit) : IGN pour les adresses françaises ---------- */
export async function searchIGN(q) {
  const url = "https://data.geopf.fr/geocodage/search?" + new URLSearchParams({
    q, index: "address", limit: "5", autocomplete: "1"
  });
  const data = await getJSON(url, { headers: { Accept: "application/json" } });
  return (data.features || [])
    .map((f) => f.properties || {})
    .filter((p) => (p.score == null || p.score >= 0.35) && p.name && p.city)
    .map((p) => {
      const isTown = p.type === "municipality";
      const place = [p.postcode, p.city].filter(Boolean).join(" ");
      return {
        t: clean(isTown ? p.city : p.name),
        d: clean(isTown ? [p.postcode, p.context].filter(Boolean).join(" · ") : place + ", France"),
        v: clean(isTown ? place + ", France" : p.name + ", " + place + ", France"),
        k: isTown ? "ville" : "adresse"
      };
    });
}

/* ---------- Mode 2 (gratuit) : Photon / OpenStreetMap pour les lieux et l'international ---------- */
function photonKind(p) {
  const k = p.osm_key, v = p.osm_value;
  if (k === "aeroway" && /aerodrome|terminal|airport/.test(v)) return "avion";
  if ((k === "railway" && /station|halt/.test(v)) || (k === "public_transport" && v === "station") || (k === "building" && v === "train_station")) return "train";
  if (k === "tourism" && /hotel|guest_house|motel|chalet|apartment/.test(v)) return "hotel";
  if (k === "place" || p.type === "city" || p.type === "district" || p.type === "county" || p.type === "state" || p.type === "country") return "ville";
  if (p.type === "house" || p.type === "street" || k === "highway" || (k === "building" && !p.name)) return "adresse";
  return "lieu";
}
export async function searchPhoton(q) {
  const url = "https://photon.komoot.io/api/?" + new URLSearchParams({
    q, lang: "fr", limit: "8", lat: String(BIAS_POINT.lat), lon: String(BIAS_POINT.lon), location_bias_scale: "0.3"
  });
  const data = await getJSON(url, { headers: { Accept: "application/json", "User-Agent": "ELEV8-Private-Driver/1.0 (suggestions d'adresses)" } });
  return (data.features || []).map((f) => {
    const p = f.properties || {};
    const street = [p.housenumber, p.street].filter(Boolean).join(" ");
    const town = [p.postcode, p.city || (p.name !== p.county ? p.county : "")].filter(Boolean).join(" ");
    const kind = photonKind(p);
    const main = p.name || street || p.city || "";
    const parts = [];
    if (p.name && street) parts.push(street);
    if (town && town !== main) parts.push(town);
    if (p.country && p.country !== main) parts.push(p.country);
    return { t: clean(main), d: clean(parts.join(", ")), v: clean([main].concat(parts).join(", ")), k: kind };
  }).filter((s) => s.t);
}

export async function searchFree(q) {
  /* Les deux services sont interrogés en même temps. Dès que l'un répond, on n'attend
     l'autre que GRACE_MS au maximum : la liste s'affiche à la vitesse du plus rapide. */
  const res = { ign: null, photon: null, failed: 0 };
  const pIGN = searchIGN(q).then((v) => { res.ign = v; }, () => { res.ign = []; res.failed++; });
  const pPh = searchPhoton(q).then((v) => { res.photon = v; }, () => { res.photon = []; res.failed++; });
  await Promise.race([pIGN, pPh]);
  const firstEmpty = (res.ign && !res.ign.length) || (res.photon && !res.photon.length);
  await Promise.race([
    Promise.all([pIGN, pPh]),
    new Promise((r) => setTimeout(r, firstEmpty ? TIMEOUT_MS : GRACE_MS))   // 1er service sans résultat : on attend l'autre
  ]);
  const a = res.ign || [], b = res.photon || [];
  if (res.failed === 2) throw new Error("aucun service disponible");
  // Saisie commençant par un numéro (« 17 rue Ferdinand ») : les adresses françaises d'abord
  const ordered = /^\s*\d/.test(q) ? a.concat(b) : b.slice(0, 3).concat(a, b.slice(3));
  const seen = new Set(), out = [];
  for (const s of ordered) {
    const key = s.v.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (!key || seen.has(key)) continue;
    seen.add(key); out.push(s);
    if (out.length >= MAX_RESULTS) break;
  }
  return out;
}

/* ---------- Point d'entrée ---------- */
export default async (req, context) => {
  if (req.method !== "POST") return json(405, { ok: false });

  // Même origine uniquement (ou domaines listés dans ALLOWED_ORIGINS), comme l'envoi des réservations
  const origin = req.headers.get("origin");
  if (origin) {
    const allowed = env("ALLOWED_ORIGINS").split(",").map((s) => s.trim()).filter(Boolean);
    if (origin !== new URL(req.url).origin && !allowed.includes(origin)) return json(403, { ok: false });
  }

  let b;
  try {
    const raw = await req.text();
    if (raw.length > 1000) return json(413, { ok: false });
    b = JSON.parse(raw);
  } catch { return json(400, { ok: false }); }

  const q = clean(b && b.q).slice(0, MAX_LEN);
  const session = typeof (b && b.s) === "string" && /^[A-Za-z0-9_-]{8,36}$/.test(b.s) ? b.s : "";
  if (q.length < MIN_LEN) return json(200, { ok: true, s: [] });

  const ip = (context && context.ip) || req.headers.get("x-nf-client-connection-ip") || "inconnue";
  if (!allow(ip)) return json(429, { ok: false });

  const key = env("GOOGLE_MAPS_API_KEY");
  const mode = env("ADRESSES_PROVIDER").toLowerCase();
  const useGoogle = key && mode !== "gratuit";

  const ck = (useGoogle ? "g:" : "f:") + q.toLowerCase();
  const hit = cacheGet(ck);
  if (hit) return json(200, hit);

  let res = null;
  if (useGoogle) {
    try { res = { ok: true, p: "google", s: await searchGoogle(q, session, key) }; }
    catch { res = null; } // panne, clé refusée ou quota du jour atteint → mode gratuit
  }
  if (!res && mode !== "google") {
    try { res = { ok: true, p: "libre", s: await searchFree(q) }; }
    catch { res = null; }
  }
  if (!res) return json(502, { ok: false });
  cacheSet(ck, res);
  return json(200, res);
};
