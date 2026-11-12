/* ==========================================================================
   ELEV8 — sécurité commune des fonctions de préproduction (lieux-dijon, devis-dijon)
   --------------------------------------------------------------------------
   1. Accès réservé (verifierAcces) : depuis que la préproduction est publique (12 nov. 2026),
      il ne protège plus que l'état de configuration (/devis-dijon?etat=1), utilisé par la page
      de diagnostic. Cookie posé par la fonction de bord preprod-acces, ou identifiants.
   2. Jetons de lieu : chaque lieu renvoyé par /lieux-dijon porte un jeton signé qui lie
      son identifiant à ses coordonnées. /devis-dijon refuse un lieu sans jeton valide :
      des coordonnées modifiées dans le navigateur sont rejetées.
   3. Quotas GLOBAUX des appels payants (Google), partagés par toutes les instances
      serverless, dans Netlify Blobs (cohérence forte + écriture conditionnelle par ETag).
      Chaque instance réserve un petit bloc d'appels à la fois (moins d'allers-retours).
      En cas d'erreur du stockage : refus (« fermé par défaut »), le relais gratuit IGN prend le relais.
   ========================================================================== */
import { createHmac, timingSafeEqual } from "node:crypto";

/* UNE SEULE source de configuration, comme la fonction de bord preprod-acces :
   - sur Netlify (et dans les tests qui le simulent), Netlify.env exclusivement ;
   - sinon (Node seul, tests du serveur), process.env.
   Avant le 12 nov. 2026 (15 h 45), une variable absente de Netlify.env était cherchée en plus
   dans process.env : la fonction de bord pouvait juger le diagnostic « désactivé » pendant que
   les fonctions trouvaient encore un mot de passe ailleurs (cause de l'échec du build 59bb7d7,
   où les variables Netlify du build se mêlaient aux valeurs des tests). */
export const env = (k) => {
  const N = globalThis.Netlify;
  const v = N && N.env && typeof N.env.get === "function" ? N.env.get(k)
    : (typeof process !== "undefined" && process.env ? process.env[k] : "");
  return (typeof v === "string" ? v : "").trim().normalize("NFC");   // même lecture que preprod-acces
};
/* Toutes les variables lues par le code (tests : isolement complet de l'environnement). */
export const VARIABLES = ["PREPROD_MOT_DE_PASSE", "PREPROD_IDENTIFIANT", "PREPROD_DIAGNOSTIC", "DEVIS_SECRET",
  "GOOGLE_MAPS_API_KEY", "ITINERAIRE_SECOURS", "ROUTES_GOOGLE_MAX_JOUR", "LIEUX_GOOGLE_MAX_JOUR", "LIEUX_PROVIDER", "ALLOWED_ORIGINS"];
export const outils = { now: () => Date.now(), compteur: null };

const hmac = (cle, msg) => createHmac("sha256", cle).update(msg).digest("base64url");
const egal = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && timingSafeEqual(x, y); };

/* ---------- 1. Accès à la préproduction ---------- */
export const COOKIE_ACCES = "elev8_preprod";
export function jetonAcces(motDePasse, expire) { return expire + "." + hmac(motDePasse, "acces|" + expire); }
function lireCookie(req, nom) {
  const c = req.headers.get("cookie") || "";
  for (const p of c.split(/;\s*/)) { const i = p.indexOf("="); if (i > 0 && p.slice(0, i) === nom) return p.slice(i + 1); }
  return "";
}
/* Renvoie null si l'accès est autorisé, sinon la réponse de refus. */
export function verifierAcces(req) {
  const mdp = env("PREPROD_MOT_DE_PASSE"), id = env("PREPROD_IDENTIFIANT") || "elev8";
  const refus = (status, message) => new Response(JSON.stringify({ ok: false, code: "acces", message }),
    { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Robots-Tag": "noindex" } });
  if (mdp.length < 10) return refus(503, "Préproduction fermée : mot de passe non configuré.");
  const c = lireCookie(req, COOKIE_ACCES), i = c.indexOf(".");
  if (i > 0) { const exp = +c.slice(0, i); if (exp > outils.now() && egal(c, jetonAcces(mdp, exp))) return null; }
  const h = req.headers.get("authorization") || "";
  if (/^basic /i.test(h)) {
    const octets = Buffer.from(h.slice(6).trim(), "base64"), u = octets.toString("utf8");
    const brut = u.includes("\uFFFD") ? octets.toString("latin1") : u, j = brut.indexOf(":");
    const norm = (x) => x.trim().normalize("NFC").toLowerCase();   // identifiant : sans casse ni espaces de bord
    if (j > 0 && egal(norm(brut.slice(0, j)), norm(id)) & egal(brut.slice(j + 1).normalize("NFC"), mdp)) return null;
  }
  return refus(401, "Accès réservé à la préproduction.");
}

/* ---------- 2. Jetons de lieu ---------- */
const DUREE_JETON_LIEU = 12 * 3600_000;
const cleLieux = () => { const s = env("DEVIS_SECRET"); return s.length >= 32 ? hmac(s, "elev8-lieux-v1") : ""; };
const messageLieu = (id, lat, lon, exp) => [id, Number(lat).toFixed(6), Number(lon).toFixed(6), exp].join("|");
/* Ajoute { jeton } à un lieu qui a des coordonnées (sans jeton si DEVIS_SECRET manque). */
export function signerLieu(l) {
  const k = cleLieux();
  if (!l || !k || !isFinite(l.lat) || !isFinite(l.lon) || l.lat == null || l.lon == null) return l;
  const exp = outils.now() + DUREE_JETON_LIEU;
  return { ...l, jeton: exp + "." + hmac(k, messageLieu(l.id || "", l.lat, l.lon, exp)) };
}
/* Vrai si id + coordonnées sont exactement ceux signés par le serveur, et non expirés. */
export function verifierLieu(l) {
  const k = cleLieux();
  if (!k || !l || typeof l.jeton !== "string") return false;
  const i = l.jeton.indexOf("."), exp = +l.jeton.slice(0, i);
  if (i <= 0 || !(exp > outils.now()) || exp > outils.now() + DUREE_JETON_LIEU + 60_000) return false;
  if (!isFinite(+l.lat) || !isFinite(+l.lon)) return false;
  return egal(l.jeton.slice(i + 1), hmac(k, messageLieu(typeof l.id === "string" ? l.id : "", +l.lat, +l.lon, exp)));
}

/* ---------- 3. Quotas globaux (Netlify Blobs) ---------- */
const jourParis = () => new Intl.DateTimeFormat("fr-CA", { timeZone: "Europe/Paris" }).format(new Date(outils.now()));
const reserves = new Map();
let compteurBlobs = null;
async function compteurParDefaut() {
  if (compteurBlobs) return compteurBlobs;
  const { getStore } = await import("@netlify/blobs");
  const store = getStore({ name: "elev8-preprod-quotas", consistency: "strong" });
  compteurBlobs = {
    /* Réserve jusqu'à `bloc` unités sans dépasser `max` ; renvoie le nombre obtenu. */
    async reserver(cle, bloc, max) {
      for (let essai = 0; essai < 6; essai++) {
        const e = await store.getWithMetadata(cle, { type: "json" });
        const n = e && e.data && +e.data.n || 0;
        if (n >= max) return 0;
        const g = Math.min(bloc, max - n);
        const w = e ? await store.setJSON(cle, { n: n + g }, { onlyIfMatch: e.etag }) : await store.setJSON(cle, { n: g }, { onlyIfNew: true });
        if (w && w.modified) return g;
      }
      return 0;   // trop de concurrence : refus prudent
    },
    async lire(cle) { const e = await store.get(cle, { type: "json" }); return e && +e.n || 0; }
  };
  return compteurBlobs;
}
/* Vrai si un appel payant de la famille `nom` est permis aujourd'hui (heure de Paris), tous serveurs confondus. */
export async function quotaGlobal(nom, maxJour, bloc = 10) {
  const jour = jourParis(), r = reserves.get(nom);
  if (r && r.jour === jour && r.restant > 0) { r.restant--; return true; }
  try {
    const c = outils.compteur || await compteurParDefaut();
    const g = await c.reserver("quota:" + nom + ":" + jour, Math.max(1, Math.min(bloc, maxJour)), maxJour);
    reserves.set(nom, { jour, restant: Math.max(0, g - 1) });
    return g > 0;
  } catch {
    return false;   // stockage indisponible : aucun appel payant
  }
}
export async function lireQuota(nom) {
  try { const c = outils.compteur || await compteurParDefaut(); return await c.lire("quota:" + nom + ":" + jourParis()); } catch { return null; }
}
export function _resetSecurite() { reserves.clear(); }

/* ---------- Limite locale (première barrière, par instance) ---------- */
export function limiteur(parMinute, parHeure) {
  const hits = new Map();
  return (ip) => {
    const now = outils.now(), list = (hits.get(ip) || []).filter((t) => now - t < 3600_000);
    if (list.filter((t) => now - t < 60_000).length >= parMinute || list.length >= parHeure) { hits.set(ip, list); return false; }
    list.push(now); hits.set(ip, list);
    if (hits.size > 5000) hits.delete(hits.keys().next().value);
    return true;
  };
}
