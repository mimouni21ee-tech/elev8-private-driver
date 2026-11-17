/* ==========================================================================
   ELEV8 Private Driver — estimation du tarif (formulaire de réservation)
   --------------------------------------------------------------------------
   Adresse : POST /estimation   (appelée par public/assets/js/main.js)

   Reçoit : départ, destination, date, heure, aller-retour éventuel, véhicule,
   passagers, prestation. Aucune donnée personnelle (ni nom, ni téléphone).
   Renvoie : une ESTIMATION (montant indicatif), ou « sur devis » (hors zone de
   Dijon, mise à disposition), avec un jeton signé repris lors de l'envoi.
   Le calcul est dans netlify/lib/estimation.mjs (grille de la préproduction, inchangée).

   Aucun paiement, aucun enregistrement. Variables Netlify facultatives :
     GOOGLE_MAPS_API_KEY     itinéraire Google (API « Routes » à activer) ; sinon relais gratuit IGN
     ROUTES_GOOGLE_MAX_JOUR  plafond journalier d'itinéraires Google (défaut 800)
     ESTIMATION_ITINERAIRE   "gratuit" pour ne jamais utiliser Google
     ESTIMATION_SECRET       clé de signature (sinon dérivée de EMAIL_API_KEY)
   ========================================================================== */
import { estimer, signer, deps as estDeps } from "../lib/estimation.mjs";
import { openStore } from "../lib/ratelimit.mjs";

export const config = {
  path: "/estimation",
  rateLimit: { windowLimit: 30, windowSize: 60, aggregateBy: ["ip", "domain"] }
};

const MAX_BODY = 2000;
const env = (k) => (process.env[k] || "").trim();
const json = (status, body) => new Response(JSON.stringify(body), {
  status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Robots-Tag": "noindex" }
});

/* Limite locale par instance, en plus de la limite Netlify ci-dessus */
const hits = new Map();
function allow(ip, now = Date.now()) {
  const list = (hits.get(ip) || []).filter((t) => now - t < 600_000);
  if (list.length >= 60) { hits.set(ip, list); return false; }
  list.push(now); hits.set(ip, list);
  if (hits.size > 5000) hits.delete(hits.keys().next().value);
  return true;
}

const MESSAGES = {
  lieu: "Indiquez le départ et la destination.",
  horaire: "Indiquez une date et une heure valides.",
  passe: "La date et l'heure indiquées sont déjà passées.",
  retour: "Le retour doit être prévu après l'aller.",
  identiques: "Le départ et la destination sont identiques.",
  lieu_inconnu: "Nous n'avons pas pu localiser l'une des adresses. Choisissez-la dans les suggestions, ou envoyez votre demande : nous vous communiquerons le tarif.",
  itineraire: "Aucun itinéraire routier trouvé entre ces deux lieux. Envoyez votre demande : nous vous communiquerons le tarif.",
  indisponible: "Estimation momentanément indisponible. Vous pouvez tout de même envoyer votre demande : nous vous communiquerons le tarif."
};

export default async (req, context) => {
  if (req.method !== "POST") return json(405, { ok: false, code: "methode" });
  const origin = req.headers.get("origin");
  if (origin) {
    const allowed = env("ALLOWED_ORIGINS").split(",").map((s) => s.trim()).filter(Boolean);
    if (origin !== new URL(req.url).origin && !allowed.includes(origin)) return json(403, { ok: false, code: "origine" });
  }
  let b;
  try {
    const raw = await req.text();
    if (raw.length > MAX_BODY) return json(413, { ok: false, code: "taille" });
    b = JSON.parse(raw);
  } catch { return json(400, { ok: false, code: "format" }); }
  if (!b || typeof b !== "object") return json(400, { ok: false, code: "format" });

  const ip = (context && context.ip) || req.headers.get("x-nf-client-connection-ip") || "inconnue";
  if (!allow(ip)) return json(429, { ok: false, code: "limite", message: "Trop de calculs demandés. Patientez quelques minutes." });

  if (!estDeps.store) { try { estDeps.store = openStore(); } catch { estDeps.store = null; } }

  try {
    const r = await estimer(b);
    return json(200, { ok: true, estimation: { ...r, jeton: signer(r) } });
  } catch (e) {
    const code = (e && e.code) || "indisponible";
    if (!e || !e.code) console.error("Estimation impossible :", String(e && e.message).slice(0, 80));
    return json(code === "indisponible" ? 502 : 422, { ok: false, code, message: MESSAGES[code] || MESSAGES.indisponible });
  }
};
