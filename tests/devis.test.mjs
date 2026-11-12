/* Tests de la fonction serveur devis-dijon (et du champ Google de lieux-dijon), réponses Google/IGN simulées.
   node tests/devis.test.mjs */
import assert from "node:assert/strict";
import fn, { deps, _reset, verifierDevis, instantParis } from "../netlify/functions/devis-dijon.mjs";
import lieuxFn, { deps as lieuxDeps } from "../netlify/functions/lieux-dijon.mjs";
import { signerLieu, verifierLieu, outils, _resetSecurite, jetonAcces, quotaGlobal, VARIABLES } from "../netlify/lib/securite.mjs";
/* Comme pendant un build Netlify : de vraies valeurs traînent dans process.env avant les tests.
   setEnv() efface TOUTES les variables lues par le code avant chaque scénario. */
for (const k of VARIABLES) process.env[k] = "valeur-reelle-du-build-netlify";

/* Compteur global simulé : même contrat que Netlify Blobs (ETag + écriture conditionnelle),
   partagé entre « instances » ; conflits d'écriture injectables. */
const blobs = new Map(); let conflits = 0, blobsEnPanne = false;
outils.compteur = {
  async reserver(cle, bloc, max) {
    if (blobsEnPanne) throw new Error("stockage indisponible");
    for (let essai = 0; essai < 6; essai++) {
      const e = blobs.get(cle), n = e ? e.n : 0;
      if (n >= max) return 0;
      const g = Math.min(bloc, max - n);
      if (conflits > 0) { conflits--; blobs.set(cle, { n: n + 1, etag: Math.random() }); continue; }   // une autre instance a écrit entre-temps
      blobs.set(cle, { n: n + g, etag: Math.random() }); return g;
    }
    return 0;
  },
  async lire(cle) { return (blobs.get(cle) || {}).n || 0; }
};
const SECRET = "secret-de-test-0123456789-abcdefghij", MDP = "motdepasse-test-123";
const AUTH = "Basic " + Buffer.from("elev8:" + MDP).toString("base64");

let n = 0; const ok = (c, m) => { assert.ok(c, m); n++; };
const eq = (a, b, m) => { assert.deepEqual(a, b, m); n++; };

/* Lieux (coordonnées publiques approximatives) */
const P = {
  gare: { id: "g:ChIJgareDijonVille0001", t: "Gare de Dijon-Ville", lat: 47.3233, lon: 5.0273 },
  darcy: { id: "g:ChIJplaceDarcy00000001", t: "Place Darcy", lat: 47.3225, lon: 5.0343 },
  republique: { id: "ign:republique", t: "Place de la République", lat: 47.3268, lon: 5.0447 },
  mama: { id: "g:ChIJmamaShelterDijon01", t: "Mama Shelter Dijon", lat: 47.3132, lon: 5.0359 },
  toison: { id: "g:ChIJtoisonDorDijon0001", t: "Toison d'Or", lat: 47.3527, lon: 5.0616 },
  dijon: { id: "g:ChIJdijonVille00000001", t: "Dijon", lat: 47.3220, lon: 5.0415 },
  beaune: { id: "g:ChIJbeauneVille0000001", t: "Beaune", lat: 47.0260, lon: 4.8400 }
};
/* Distances « routières » simulées (mètres, secondes) par paire d'identifiants */
const ROUTES = {
  "ChIJgareDijonVille0001>ChIJplaceDarcy00000001": [1300, 300],
  "ChIJgareDijonVille0001>ChIJtoisonDorDijon0001": [6900, 840],
  "ChIJtoisonDorDijon0001>ChIJgareDijonVille0001": [7100, 860],
  "ChIJdijonVille00000001>ChIJbeauneVille0000001": [45900, 2160]
};
const byId = Object.fromEntries(Object.values(P).map((p) => [p.id.replace(/^g:/, ""), p]));

let calls = [], googleMode = "ok", ignMode = "ok";
const resp = (status, body) => ({ ok: status < 300, status, json: async () => body });
function fakeFetch(url, init = {}) {
  calls.push({ url, init });
  if (url.startsWith("https://routes.googleapis.com/")) {
    if (googleMode === "500") return Promise.resolve(resp(500, {}));
    if (googleMode === "vide") return Promise.resolve(resp(200, {}));
    const b = JSON.parse(init.body);
    const k = (w) => w.placeId || w.location.latLng.latitude.toFixed(4) + "," + w.location.latLng.longitude.toFixed(4);
    const r = ROUTES[k(b.origin) + ">" + k(b.destination)] || [3100, 600];
    const loc = (w) => { const p = w.placeId ? byId[w.placeId] : { lat: w.location.latLng.latitude, lon: w.location.latLng.longitude }; return { latLng: { latitude: p.lat, longitude: p.lon } }; };
    return Promise.resolve(resp(200, { routes: [{ distanceMeters: r[0], duration: r[1] + "s", legs: [{ startLocation: loc(b.origin), endLocation: loc(b.destination) }] }] }));
  }
  if (url.startsWith("https://data.geopf.fr/navigation/itineraire")) {
    if (ignMode === "500") return Promise.resolve(resp(500, {}));
    if (ignMode === "vide") return Promise.resolve(resp(200, { distance: 0 }));
    return Promise.resolve(resp(200, { distance: 3.2, duration: 9.4 }));
  }
  if (url.startsWith("https://places.googleapis.com/v1/places:autocomplete")) {
    return Promise.resolve(resp(200, { suggestions: [{ placePrediction: { placeId: "ChIJmamaShelterDijon01", text: { text: "Mama Shelter Dijon, Dijon, France" }, structuredFormat: { mainText: { text: "Mama Shelter Dijon" }, secondaryText: { text: "Dijon, France" } }, types: ["lodging"] } }] }));
  }
  if (url.startsWith("https://places.googleapis.com/v1/places/")) {
    return Promise.resolve(resp(200, { id: "ChIJmamaShelterDijon01", formattedAddress: "12 Parvis de l'Unesco, 21000 Dijon, France", location: { latitude: 47.3132, longitude: 5.0359 }, types: ["lodging", "establishment"] }));
  }
  return Promise.reject(new Error("réseau interdit : " + url));
}
const NOW = Date.parse("2026-11-12T09:00:00Z");
deps.fetch = fakeFetch; deps.now = () => NOW;
lieuxDeps.fetch = fakeFetch; lieuxDeps.now = () => NOW;
const ENV = { GOOGLE_MAPS_API_KEY: "cle-test", DEVIS_SECRET: SECRET };
function setEnv(o) { for (const k of VARIABLES) delete process.env[k]; Object.assign(process.env, { PREPROD_MOT_DE_PASSE: MDP }, o); }
const toutReinitialiser = () => { _reset(); _resetSecurite(); blobs.clear(); };

let ipN = 0;
async function call(body, { ip, origin, method = "POST", url = "https://preprod.example/devis-dijon", auth = null, cookie } = {}) {   // public : aucun identifiant par défaut
  const headers = { "content-type": "application/json" }; if (origin) headers.origin = origin; if (auth) headers.authorization = auth; if (cookie) headers.cookie = cookie;
  const req = new Request(url, { method, headers, body: method === "POST" ? JSON.stringify(body) : undefined });
  const r = await fn(req, { ip: ip || "10.0.0." + (++ipN) });
  return { status: r.status, body: await r.json() };
}
const trip = (a, b, date = "2026-11-17", heure = "10:00", extra = {}) => ({ type: "simple", depart: a, arrivee: b, date, heure, ...extra });

setEnv(ENV); toutReinitialiser();
for (const k of Object.keys(P)) P[k] = signerLieu(P[k]);   // jetons délivrés par /lieux-dijon
ok(Object.values(P).every((p) => p.jeton && verifierLieu(p)), "jetons de lieu valides");

/* 1. Requête Google Routes : niveau Essentials, champs limités, identifiant de lieu */
calls = [];
let r = await call(trip(P.gare, P.darcy));
eq(r.status, 200, "statut 200");
const g = calls.find((c) => c.url.includes("computeRoutes"));
ok(g, "Google Routes appelé");
eq(g.init.headers["X-Goog-FieldMask"], "routes.distanceMeters,routes.duration,routes.legs.startLocation,routes.legs.endLocation", "FieldMask minimal");
eq(g.init.headers["X-Goog-Api-Key"], "cle-test", "clé côté serveur");
const gb = JSON.parse(g.init.body);
eq(gb.routingPreference, "TRAFFIC_UNAWARE", "sans trafic (Essentials)");
eq(gb.travelMode, "DRIVE", "voiture");
eq(gb.origin, { placeId: "ChIJgareDijonVille0001" }, "départ par placeId");

/* 2. Gare → Place Darcy : 1,3 km → minimums */
let d = r.body.devis;
eq(d.legs[0].distance_en_charge_km, 1.3, "distance 1,3 km");
eq(d.legs[0].dureeMin, 5, "durée 5 min");
eq([d.categories.confort.total, d.categories.van.total], [25, 40], "minimums 25 / 40");
eq([d.categories.confort.acompte, d.categories.van.acompte], [10, 10], "acomptes 10 / 10");
ok(d.reservable && !d.partiel, "réservable");
eq(d.itineraire.source, "google", "source Google");
ok(/^PRE-[0-9A-F]{10}$/.test(d.devisId), "identifiant de devis");
eq(d.expire - NOW, 15 * 60_000, "validité 15 min");

/* 3. Signature */
ok(verifierDevis(d, SECRET, NOW), "signature valide");
ok(!verifierDevis({ ...d, categories: { ...d.categories, confort: { ...d.categories.confort, total: 1 } } }, SECRET, NOW), "montant modifié refusé");
ok(!verifierDevis(d, "autre", NOW), "mauvais secret refusé");
ok(!verifierDevis(d, SECRET, d.expire + 1), "devis expiré refusé");

/* 4. Lieu non Google (IGN) envoyé par coordonnées ; montant envoyé par le navigateur ignoré */
calls = [];
r = await call({ ...trip(P.republique, P.mama), prix: 1, total: 1, distanceKm: 0.1 });
const gb2 = JSON.parse(calls.find((c) => c.url.includes("computeRoutes")).init.body);
eq(gb2.origin, { location: { latLng: { latitude: 47.3268, longitude: 5.0447 } } }, "départ par coordonnées");
eq(gb2.destination, { placeId: "ChIJmamaShelterDijon01" }, "arrivée par placeId");
eq(r.body.devis.legs[0].distance_en_charge_km, 3.1, "3,1 km");
eq(r.body.devis.categories.confort.total, 25, "prix client ignoré");

/* 5. Gare → Toison d'Or, jour et nuit (cache : un seul appel Google) */
calls = [];
r = await call(trip(P.gare, P.toison));
const rn = await call(trip(P.gare, P.toison, "2026-11-17", "21:00"));
eq(calls.filter((c) => c.url.includes("computeRoutes")).length, 1, "itinéraire mis en cache");
eq([r.body.devis.categories.confort.total, r.body.devis.categories.van.total], [25, 40], "6,9 km jour : minimums");
eq(rn.body.devis.legs[0].periode, "nuit", "21 h : majoré");
eq([rn.body.devis.categories.confort.total, rn.body.devis.categories.van.total], [25, 40], "6,9 km nuit : 23,60 < 25 et 28,98 < 40");

/* 6. Dijon → Beaune : longue distance, sur devis */
r = await call(trip(P.dijon, P.beaune));
d = r.body.devis;
eq(d.legs[0].distance_en_charge_km, 45.9, "45,9 km");
eq([d.categories.confort.total, d.categories.van.total], [104.65, 131.27], "grille jour");
ok(d.partiel && !d.reservable, "sur devis, pas de paiement");
ok(d.legs[0].distance_retour_vide_km > 30 && d.legs[0].distance_approche_km === 0, "retour à vide mesuré, non facturé");
eq(d.categories.confort.lignes.length, 1, "aucune ligne de supplément");
r = await call(trip(P.dijon, P.beaune, "2026-11-22", "10:00"));
eq(r.body.devis.legs[0].periode, "dimanche", "dimanche majoré");
eq([r.body.devis.categories.confort.total, r.body.devis.categories.van.total], [156.98, 192.78], "grille majorée");

/* 7. Le navigateur ne peut pas « rapprocher » Beaune : la zone se vérifie sur les coordonnées Google */
r = await call(trip(P.dijon, { ...P.beaune, lat: 47.33, lon: 5.05 }));
eq([r.status, r.body.code], [400, "lieu"], "coordonnées modifiées dans le navigateur : refusées");

/* 7 bis. Validation des lieux côté serveur */
r = await call(trip({ id: "ign:x", lat: 47.3233, lon: 5.0273 }, P.darcy));
eq([r.status, r.body.code], [400, "lieu"], "lieu sans jeton refusé");
r = await call(trip({ ...P.gare, id: "g:ChIJtoisonDorDijon0001" }, P.darcy));
eq(r.status, 400, "identifiant échangé refusé");
r = await call(trip({ ...P.republique, lat: P.republique.lat + 0.000002 }, P.mama));
eq(r.status, 400, "décalage de 20 cm refusé");
r = await call(trip({ ...P.gare, jeton: P.darcy.jeton }, P.darcy));
eq(r.status, 400, "jeton d'un autre lieu refusé");
const vieux = (() => { const n0 = outils.now; outils.now = () => NOW - 13 * 3600_000; const l = signerLieu({ id: "ign:v", lat: 47.30, lon: 5.0 }); outils.now = n0; return l; })();
r = await call(trip(vieux, P.darcy));
eq(r.status, 400, "jeton expiré (12 h) refusé");
r = await call(trip(P.gare, P.darcy));
eq(r.body.devis.lieux.depart, ["g:ChIJgareDijonVille0001", 47.3233, 5.0273], "lieux vérifiés inscrits dans le devis signé");
ok(!verifierDevis({ ...r.body.devis, lieux: { ...r.body.devis.lieux, arrivee: ["g:x", 1, 1] } }, SECRET, NOW), "lieux modifiés après coup : signature invalide");

/* 8. Aller-retour : deux trajets, retour de nuit, contrôle d'ordre */
r = await call(trip(P.gare, P.toison, "2026-11-17", "17:30", { type: "ar", dateRetour: "2026-11-17", heureRetour: "23:00" }));
d = r.body.devis;
eq(d.legs.length, 2, "deux trajets");
eq([d.legs[0].periode, d.legs[1].periode], ["jour", "nuit"], "jour puis nuit");
eq(d.legs[1].distance_en_charge_km, 7.1, "retour mesuré dans le sens retour");
eq(d.categories.confort.total, 50, "25 + 25");
r = await call(trip(P.gare, P.toison, "2026-11-17", "17:30", { type: "ar", dateRetour: "2026-11-17", heureRetour: "17:35" }));
eq([r.status, r.body.code], [422, "retour"], "retour avant l'arrivée refusé");

/* 9. Jour férié (25 décembre, vendredi 10 h) */
r = await call(trip(P.dijon, P.beaune, "2026-12-25", "10:00"));
eq(r.body.devis.legs[0].periode, "ferie", "Noël majoré");

/* 10. Mise à disposition (aucun itinéraire, aucun appel Google) */
calls = [];
r = await call({ type: "mad", priseEnCharge: P.mama, heures: 3, kmEstimes: 80, date: "2026-11-17", heure: "21:00" });
eq(calls.length, 0, "aucun appel externe");
eq([r.body.devis.categories.confort.total, r.body.devis.categories.van.total], [200, 275], "3 h + 20 km sup. (50 €), sans majoration de nuit");
r = await call({ type: "mad", heures: 1, kmEstimes: 10, date: "2026-11-17", heure: "10:00" });
eq([r.status, r.body.code], [400, "duree"], "durée minimum");

/* 11. Validations */
r = await call(trip(P.gare, P.darcy, "2026-11-12", "10:30"));
eq([r.status, r.body.code], [422, "delai"], "délai de 2 h");
r = await call(trip(P.gare, P.darcy, "2027-12-01", "10:00"));
eq(r.status, 422, "plus d'un an refusé");
r = await call(trip(P.gare, P.gare));
eq([r.status, r.body.code], [422, "lieu"], "départ = arrivée");
r = await call(trip({ lat: 999, lon: 5 }, P.darcy));
eq(r.status, 400, "coordonnées invalides");
r = await call({ type: "x" });
eq(r.status, 400, "type inconnu");
r = await call(trip(P.gare, P.darcy), { origin: "https://pirate.example" });
eq([r.status, r.body.code], [403, "origine"], "origine étrangère refusée");
r = await call(trip(P.gare, P.darcy), { origin: "https://preprod.example" });
eq(r.status, 200, "même origine acceptée");
const big = await fn(new Request("https://preprod.example/devis-dijon", { method: "POST", headers: { authorization: AUTH }, body: "x".repeat(5000) }), { ip: "9.9.9.9" });
eq(big.status, 413, "corps trop gros");

/* 12. Limite par visiteur : 20 par minute */
let last;
for (let i = 0; i < 21; i++) last = await call(trip(P.gare, P.darcy), { ip: "7.7.7.7" });
eq([last.status, last.body.code], [429, "limite"], "21e demande en une minute bloquée");

/* 13. Relais IGN : Google en erreur, plafond Google atteint, sans clé */
_reset(); googleMode = "500"; calls = [];
r = await call(trip(P.republique, P.mama));
eq([r.status, r.body.devis.itineraire.source], [200, "ign"], "Google en panne → IGN");
ok(calls.some((c) => c.url.includes("data.geopf.fr") && c.url.includes("start=5.0447%2C47.3268")), "IGN appelé (lon,lat)");
googleMode = "ok"; toutReinitialiser(); setEnv({ ...ENV, ROUTES_GOOGLE_MAX_JOUR: "1" });
await call(trip(P.gare, P.darcy));
_reset(); _resetSecurite();          // autre instance serverless : mémoire vide, compteur global partagé
r = await call(trip(P.republique, P.mama));
eq(r.body.devis.itineraire.source, "ign", "plafond Google GLOBAL atteint, même sur une nouvelle instance → IGN");
eq(blobs.get([...blobs.keys()].find((k) => k.startsWith("quota:google-routes")) ).n, 1, "compteur global : 1 appel Google");
toutReinitialiser(); setEnv(ENV); blobsEnPanne = true;
r = await call(trip(P.republique, P.mama));
eq(r.body.devis.itineraire.source, "ign", "stockage des quotas indisponible → aucun appel payant (IGN)");
blobsEnPanne = false;
toutReinitialiser(); setEnv({ ...ENV, ROUTES_GOOGLE_MAX_JOUR: "10" }); conflits = 3;
eq(await quotaGlobal("essai", 10, 5), true, "écritures concurrentes : réessai puis réservation");
eq(blobs.get([...blobs.keys()].find((k) => k.startsWith("quota:essai"))).n, 8, "3 écritures concurrentes + 1 bloc de 5");
let accordes = 0; toutReinitialiser();
for (let inst = 0; inst < 7; inst++) { _resetSecurite(); for (let i = 0; i < 3; i++) if (await quotaGlobal("multi", 10, 2)) accordes++; }
ok(accordes <= 10 && accordes >= 7, "7 instances × 3 appels, plafond global 10 : jamais dépassé (" + accordes + " accordés)");
eq(blobs.get([...blobs.keys()].find((k) => k.startsWith("quota:multi"))).n, 10, "compteur global arrêté au plafond");
toutReinitialiser(); setEnv({ DEVIS_SECRET: SECRET });
r = await call(trip(P.republique, P.mama));
eq(r.body.devis.itineraire.source, "ign", "sans clé Google → IGN");

/* 14. Pannes */
toutReinitialiser(); setEnv({ DEVIS_SECRET: SECRET, ITINERAIRE_SECOURS: "aucun" });
r = await call(trip(P.gare, P.darcy));
eq([r.status, r.body.code], [503, "configuration"], "aucun service configuré");
_reset(); setEnv(ENV); googleMode = "500"; ignMode = "500";
r = await call(trip(P.gare, P.darcy));
eq([r.status, r.body.code], [502, "itineraire"], "tous les services en panne");
ok(/Réessayez/.test(r.body.message), "message clair");
_reset(); googleMode = "vide"; ignMode = "vide";
r = await call(trip(P.gare, P.darcy));
eq([r.status, r.body.code], [422, "itineraire"], "aucun itinéraire");
googleMode = "ok"; ignMode = "ok";

/* 15. Sans DEVIS_SECRET (ou trop court) : service fermé */
toutReinitialiser(); setEnv({ GOOGLE_MAPS_API_KEY: "k" });
r = await call(trip(P.gare, P.darcy));
eq([r.status, r.body.code], [503, "configuration"], "sans secret : aucun devis");
setEnv({ GOOGLE_MAPS_API_KEY: "k", DEVIS_SECRET: "court" });
r = await call(trip(P.gare, P.darcy));
eq(r.status, 503, "secret de moins de 32 caractères refusé");

/* 15 bis. Préproduction publique : devis sans identifiant ni cookie ; seul l'état reste réservé */
setEnv(ENV); toutReinitialiser();
r = await call(trip(P.gare, P.darcy));
eq([r.status, r.body.devis.categories.confort.total], [200, 25], "devis public sans cookie ni identifiants");
ok(r.body.devis.signature && verifierDevis(r.body.devis, SECRET, NOW), "devis public toujours signé");
r = await call(trip(P.gare, P.darcy), { auth: "Basic " + Buffer.from("elev8:mauvais-mot-de-passe").toString("base64") });
eq(r.status, 200, "identifiants faux ignorés (plus de protection sur le devis)");
r = await call(trip({ ...P.gare, lat: 47.3 }, P.darcy));
eq([r.status, r.body.code], [400, "lieu"], "public : coordonnées modifiées toujours refusées");
setEnv({ ...ENV, PREPROD_MOT_DE_PASSE: "" });
r = await call(trip(P.gare, P.darcy));
eq(r.status, 200, "sans mot de passe configuré : le devis reste disponible");
r = await call(null, { method: "GET", url: "https://preprod.example/devis-dijon?etat=1" });
eq(r.status, 503, "sans mot de passe : état fermé (diagnostic désactivé)");
setEnv(ENV);
r = await call(null, { method: "GET", url: "https://preprod.example/devis-dijon?etat=1" });
eq([r.status, r.body.code], [401, "acces"], "état réservé : 401 sans cookie");
r = await call(null, { method: "GET", url: "https://preprod.example/devis-dijon?etat=1", cookie: "elev8_preprod=" + jetonAcces(MDP, NOW + 3600_000) });
eq(r.status, 200, "état : cookie du diagnostic accepté");
r = await call(null, { method: "GET", url: "https://preprod.example/devis-dijon?etat=1", cookie: "elev8_preprod=" + (NOW + 3600_000) + ".falsifie" });
eq(r.status, 401, "état : cookie falsifié refusé");
setEnv({ DEVIS_SECRET: SECRET, PREPROD_MOT_DE_PASSE: MDP });
r = await call(trip(P.gare, P.darcy));
eq(r.status, 200, "public, sans clé Google : relais IGN");

/* 15 ter. Mise à disposition : kilométrage déclaré, borné, non contractuel */
setEnv(ENV);
r = await call({ type: "mad", heures: 2, kmEstimes: 261, date: "2026-11-17", heure: "10:00" });
eq([r.status, r.body.code], [400, "km"], "plus de 130 km par heure : refusé");
r = await call({ type: "mad", heures: 2, kmEstimes: 60, date: "2026-11-17", heure: "10:00" });
eq([r.body.devis.kilometrage.statut, r.body.devis.kilometrage.contractuel, r.body.devis.kilometrage.km_inclus_forfait], ["declare_par_le_client", false, 40], "kilométrage marqué déclaratif");

/* 16. État : oui / non, jamais de valeur secrète (réservé au diagnostic) */
setEnv(ENV);
r = await call(null, { method: "GET", url: "https://preprod.example/devis-dijon?etat=1", auth: AUTH });
eq([r.body.etat.google, r.body.etat.signature, r.body.etat.paiementReel], [true, true, false], "état");
ok(!JSON.stringify(r.body).includes("cle-test") && !JSON.stringify(r.body).includes(SECRET), "aucune clé exposée");

/* 17. Heure de Paris (heure d'hiver / d'été) */
eq(new Date(instantParis("2026-11-17", "10:00")).toISOString(), "2026-11-17T09:00:00.000Z", "hiver UTC+1");
eq(new Date(instantParis("2026-07-14", "10:00")).toISOString(), "2026-07-14T08:00:00.000Z", "été UTC+2");

/* 18. lieux-dijon : coordonnées Google sans champ « Pro » */
calls = [];
const lr = await lieuxFn(new Request("https://preprod.example/lieux-dijon", { method: "POST", headers: { authorization: AUTH }, body: JSON.stringify({ action: "details", id: "g:ChIJmamaShelterDijon01", s: "session1234", t: "Mama Shelter Dijon" }) }), { ip: "5.5.5.5" });
const lb = await lr.json();
const det = calls.find((c) => c.url.includes("places.googleapis.com/v1/places/"));
eq(det.init.headers["X-Goog-FieldMask"], "id,formattedAddress,location,types", "Place Details : Essentials uniquement");
ok(!det.init.headers["X-Goog-FieldMask"].includes("displayName"), "pas de displayName");
eq([lb.lieu.t, lb.lieu.lat, lb.lieu.lon], ["Mama Shelter Dijon", 47.3132, 5.0359], "nom de la suggestion + coordonnées exactes");
ok(det.url.includes("sessionToken=session1234"), "jeton de session transmis");
ok(verifierLieu(lb.lieu), "lieu Google renvoyé avec un jeton signé");
const lr2 = await lieuxFn(new Request("https://preprod.example/lieux-dijon", { method: "POST", body: JSON.stringify({ action: "suggest", q: "mama", s: "session1234" }) }), { ip: "5.5.5.6" });
eq(lr2.status, 200, "lieux-dijon public : recherche sans cookie ni identifiants");
const lb2 = await lr2.json();
eq([lb2.p, lb2.s[0].t], ["google", "Mama Shelter Dijon"], "suggestion Google renvoyée en accès public");

console.log("✓ " + n + " vérifications passées (devis-dijon, lieux-dijon)");
