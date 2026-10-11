/* ==========================================================================
   Limitation des envois partagée entre toutes les instances Netlify
   --------------------------------------------------------------------------
   Les compteurs sont stockés dans Netlify Blobs (stockage du site, cohérence
   forte). Chaque incrément est une écriture conditionnelle (etag) : si deux
   instances écrivent en même temps, l'une échoue et recommence, ce qui rend
   le compteur exact même sous forte concurrence.

   Aucune adresse IP n'est stockée en clair : seule une empreinte HMAC-SHA256
   tronquée est utilisée. Les compteurs expirés sont supprimés chaque heure
   par la fonction planifiée « rl-cleanup ».
   ========================================================================== */
import { getStore } from "@netlify/blobs";

export const STORE_NAME = "elev8-rate-limit";

/* Règles : nombre maximal d'événements par fenêtre (en secondes) */
export const RULES = {
  ip10m:  { limit: 5,  window: 600 },     // 5 tentatives / 10 min / visiteur
  ip24h:  { limit: 15, window: 86400 },   // 15 tentatives / 24 h / visiteur
  global: { limit: 30, window: 3600 }     // 30 e-mails envoyés / heure au total (modifiable : RATE_GLOBAL_PER_HOUR)
};

export function openStore() {
  return getStore({ name: STORE_NAME, consistency: "strong" });
}

/* Clé : <règle>/<début de fenêtre en secondes>/<empreinte> */
export function keyFor(rule, subject, nowMs = Date.now()) {
  const w = RULES[rule].window;
  const start = Math.floor(nowMs / 1000 / w) * w;
  return `${rule}/${start}/${subject}`;
}

export async function ipFingerprint(ip, secret) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(secret || "elev8-default-salt"), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(String(ip))));
  return Array.from(sig.slice(0, 12), (b) => b.toString(16).padStart(2, "0")).join("");
}

/* Incrémente le compteur si la limite n'est pas atteinte.
   Renvoie true si l'événement est autorisé, false sinon. */
export async function consume(store, key, limit, attempts = 8) {
  for (let i = 0; i < attempts; i++) {
    const cur = await store.getWithMetadata(key, { type: "json" });
    const n = cur && cur.data && Number.isInteger(cur.data.n) ? cur.data.n : 0;
    if (n >= limit) return false;
    const res = cur
      ? await store.setJSON(key, { n: n + 1 }, { onlyIfMatch: cur.etag })
      : await store.setJSON(key, { n: 1 }, { onlyIfNew: true });
    if (res && res.modified) return true;
    await new Promise((r) => setTimeout(r, 15 + Math.random() * 40 * (i + 1)));
  }
  return false; // contention persistante : on refuse plutôt que de dépasser la limite
}

/* Supprime les compteurs dont la fenêtre est terminée */
export async function cleanup(store, nowMs = Date.now()) {
  let deleted = 0;
  for (const rule of Object.keys(RULES)) {
    const { blobs } = await store.list({ prefix: `${rule}/` });
    for (const b of blobs) {
      const start = Number(b.key.split("/")[1]);
      if (Number.isFinite(start) && (start + RULES[rule].window) * 1000 < nowMs) {
        await store.delete(b.key);
        deleted++;
      }
    }
  }
  return deleted;
}
