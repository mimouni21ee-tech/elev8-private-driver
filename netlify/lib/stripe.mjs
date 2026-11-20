/* ==========================================================================
   ELEV8 — Stripe: TEST uniquement hors production, LIVE uniquement en production.
   Activer explicitement PAIEMENT_STRIPE=test / live dans le contexte Netlify adéquat.
   Clés secrètes uniquement dans les variables d'environnement Netlify.
   Jamais de repli implicite d'un mode vers l'autre.
   ========================================================================== */
import { createHmac, timingSafeEqual } from "node:crypto";
import { estProduction, contexteDeploiement } from "./environnement.mjs";

export const deps = { fetch: (...a) => fetch(...a), now: () => Date.now() };
const env = (k) => (process.env[k] || "").trim();
const API = "https://api.stripe.com";

/* Configuration active, ou null (paiement en ligne désactivé) */
export function stripeActif() {
  const contexte = contexteDeploiement();
  const mode = env("PAIEMENT_STRIPE").toLowerCase();
  const cle = env("STRIPE_SECRET_KEY"), secret = env("STRIPE_WEBHOOK_SECRET");
  // Contexte de production explicite obligatoire pour encaisser réellement.
  // Une prévisualisation ou un déploiement de branche n'accepte jamais de clé live.
  // Hors Netlify, seul le mode test peut être actif (tests locaux).
  if (estProduction() ? mode !== "live" : mode !== "test") return null;
  if (!contexte && mode === "live") return null;
  if (!new RegExp("^(sk|rk)_" + mode + "_[A-Za-z0-9]{10,}$").test(cle)) return null;
  if (!/^whsec_[A-Za-z0-9+/=]{10,}$/.test(secret)) return null;
  return { cle, secret, mode };
}

/* Encodage « application/x-www-form-urlencoded » imbriqué, au format attendu par Stripe */
export function encoder(obj, prefixe = "", out = new URLSearchParams()) {
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null || v === "") continue;
    const cle = prefixe ? `${prefixe}[${k}]` : k;
    if (Array.isArray(v)) v.forEach((x, i) => (typeof x === "object" ? encoder(x, `${cle}[${i}]`, out) : out.append(`${cle}[${i}]`, String(x))));
    else if (typeof v === "object") encoder(v, cle, out);
    else out.append(cle, String(v));
  }
  return out;
}

export class ErreurStripe extends Error {
  constructor(statut, type, code) { super(`stripe:${statut}:${type || ""}:${code || ""}`); this.statut = statut; this.type = type; this.code = code; }
}
async function appel(methode, chemin, params, idempotence) {
  const c = stripeActif();
  if (!c) throw new ErreurStripe(0, "configuration", "inactif");
  const h = { Authorization: `Bearer ${c.cle}`, "Stripe-Version": "2024-06-20" };
  let corps;
  if (methode === "POST") { h["Content-Type"] = "application/x-www-form-urlencoded"; corps = encoder(params || {}).toString(); if (idempotence) h["Idempotency-Key"] = idempotence; }
  const url = API + chemin + (methode === "GET" && params ? "?" + encoder(params).toString() : "");
  const r = await deps.fetch(url, { method: methode, headers: h, body: corps });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { const e = j && j.error || {}; throw new ErreurStripe(r.status, e.type, e.code); }   // message d'erreur Stripe non journalisé (peut contenir des données)
  if (j && typeof j.livemode === "boolean" && j.livemode !== (c.mode === "live")) throw new ErreurStripe(0, "configuration", "mode_incorrect");
  return j;
}

/* Session Stripe Checkout (page hébergée par Stripe, « pleine page ») */
export function creerSession(o) {
  return appel("POST", "/v1/checkout/sessions", {
    mode: "payment",
    client_reference_id: o.ref,
    customer_email: o.email || undefined,
    locale: "fr",
    payment_method_types: ["card"],                       // carte (Apple Pay / Google Pay inclus) : pas de paiement différé
    line_items: [{ quantity: 1, price_data: { currency: "eur", unit_amount: o.montantCents, product_data: { name: o.libelle, description: o.description || undefined } } }],
    metadata: { ref: o.ref, paiement: o.jeton, version: o.version },
    payment_intent_data: { description: o.libelle, metadata: { ref: o.ref, paiement: o.jeton, version: o.version } },
    expires_at: Math.floor(o.expireA / 1000),
    success_url: o.origine + "/paiement/?etat=merci&ref=" + encodeURIComponent(o.ref),
    cancel_url: o.origine + "/paiement/?etat=annule&j=" + encodeURIComponent(o.jeton)
  }, `elev8-session-${o.jeton}-${o.version}-${o.tentative}`);
}
export const lireSession = (id) => appel("GET", "/v1/checkout/sessions/" + encodeURIComponent(id));
export const expirerSession = (id) => appel("POST", "/v1/checkout/sessions/" + encodeURIComponent(id) + "/expire", {});
export const lireCharge = (id) => appel("GET", "/v1/charges/" + encodeURIComponent(id));
/* Remboursement intégral (ou du reste à rembourser), une seule fois par clé */
export const rembourser = (paymentIntent, cle, motif) => appel("POST", "/v1/refunds", { payment_intent: paymentIntent, reason: motif === "doublon" ? "duplicate" : "requested_by_customer", metadata: { motif } }, cle);

/* Vérification de la signature d'un webhook (en-tête Stripe-Signature : t=…,v1=…,v1=…) */
export function verifierSignature(corps, entete, secret, now = deps.now(), toleranceS = 300) {
  if (typeof entete !== "string" || !secret) return false;
  let t = null; const sigs = [];
  for (const p of entete.split(",")) { const [k, v] = p.split("="); if (k === "t") t = Number(v); else if (k === "v1" && v) sigs.push(v); }
  if (!Number.isFinite(t) || !sigs.length || Math.abs(now / 1000 - t) > toleranceS) return false;
  const attendu = Buffer.from(createHmac("sha256", secret).update(`${t}.${corps}`).digest("hex"));
  return sigs.some((s) => { const b = Buffer.from(s); return b.length === attendu.length && timingSafeEqual(b, attendu); });
}
