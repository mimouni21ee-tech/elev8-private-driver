/* ==========================================================================
   ELEV8 Private Driver — réception des demandes de réservation (Netlify)
   --------------------------------------------------------------------------
   Exécuté sur les serveurs de Netlify : les clés ci-dessous ne sont JAMAIS
   envoyées au navigateur. Elles se règlent dans Netlify :
   Site configuration → Environment variables.

   Obligatoires
     EMAIL_PROVIDER        "brevo" (recommandé, hébergement UE) ou "resend"
     EMAIL_API_KEY         clé API du prestataire choisi
     MAIL_TO               adresse qui reçoit les demandes
     MAIL_FROM             expéditeur vérifié chez le prestataire
                           (ex. reservations@elevateprivatedriver.com)
   Facultatives
     MAIL_FROM_NAME        nom d'expéditeur (défaut : ELEV8 Private Driver)
     TURNSTILE_SECRET_KEY  clé secrète Cloudflare Turnstile (si activé dans config.js)
     ALLOWED_ORIGINS       domaines autorisés, séparés par des virgules
                           (défaut : le domaine du site lui-même)
     RATE_LIMIT_SECRET     sel servant à rendre les adresses IP non identifiables
                           (défaut : dérivé de EMAIL_API_KEY)
     RATE_GLOBAL_PER_HOUR  nombre maximal d'e-mails envoyés par heure (défaut : 30)

   Protection contre les abus, en trois couches :
     1. Limitation Netlify en périphérie (config.rateLimit ci-dessous),
        appliquée avant même l'exécution de la fonction.
     2. Compteurs partagés dans Netlify Blobs (netlify/lib/ratelimit.mjs),
        exacts quel que soit le nombre d'instances.
     3. Champ piège, durée minimale, origine, validation, Turnstile.

   Aucune donnée personnelle n'est écrite dans les journaux (logs).
   ========================================================================== */

const MIN_FILL_MS = 3000;          // un humain met plus de 3 s à remplir le formulaire
const MAX_BODY = 12_000;           // octets

import { RULES, openStore, keyFor, ipFingerprint, consume } from "../lib/ratelimit.mjs";

/* Point d'accès public de la fonction + limitation Netlify en périphérie
   (6 requêtes / 3 min par visiteur ; disponible sur toutes les offres Netlify). */
export const config = {
  path: "/envoi-reservation",
  rateLimit: { windowLimit: 6, windowSize: 180, aggregateBy: ["ip", "domain"] }
};

/* Dépendances remplaçables pour les tests automatisés */
export const deps = { store: null };
function rateStore() {
  if (deps.store) return deps.store;
  try { return openStore(); } catch { return null; }
}

const json = (status, body) => new Response(JSON.stringify(body), {
  status,
  headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }
});

const env = (k) => (process.env[k] || "").trim();

/* ---------- Validation ---------- */
const PHONE_RULES = [
  ["+377", /^\+377\d{8,9}$/], ["+352", /^\+352\d{6,11}$/],
  ["+33", /^\+33[1-9]\d{8}$/], ["+41", /^\+41[1-9]\d{8}$/], ["+32", /^\+32\d{8,9}$/],
  ["+39", /^\+39\d{6,11}$/], ["+49", /^\+49\d{6,13}$/], ["+34", /^\+34[6-9]\d{8}$/],
  ["+44", /^\+44\d{9,10}$/], ["+31", /^\+31\d{9}$/], ["+1", /^\+1[2-9]\d{9}$/]
];
export function validPhone(p) {
  if (typeof p !== "string" || !/^\+[1-9]\d{7,14}$/.test(p)) return false;
  const rule = PHONE_RULES.find(([cc]) => p.startsWith(cc));
  return rule ? rule[1].test(p) : true;
}

const str = (v, max) => (typeof v === "string" ? v.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").trim().slice(0, max) : "");

export function validate(b) {
  const d = {
    prestation: str(b.prestation, 80),
    reference: str(b.reference, 20).toUpperCase(),
    typeReference: ["vol", "train", "vol-train"].includes(b.typeReference) ? b.typeReference : "",
    date: str(b.date, 10),
    heure: str(b.heure, 5),
    depart: str(b.depart, 200),
    destination: str(b.destination, 200),
    passagers: Number.parseInt(b.passagers, 10),
    vehicule: str(b.vehicule, 60),
    nom: str(b.nom, 80),
    prenom: str(b.prenom, 80),
    telephone: str(b.telephone, 20),
    email: str(b.email, 120),
    precisions: str(b.precisions, 1500),
    origine: {
      code: str(b.origine && b.origine.code, 60).replace(/[^a-z0-9._-]/gi, ""),
      libelle: str(b.origine && b.origine.libelle, 120),
      utm: {}
    }
  };
  const utm = (b.origine && b.origine.utm) || {};
  for (const k of ["utm_source", "utm_medium", "utm_campaign", "utm_content"]) {
    const v = str(utm[k], 60).replace(/[^a-z0-9._-]/gi, "");
    if (v) d.origine.utm[k] = v;
  }

  const bad = [];
  const yesterday = new Date(Date.now() - 36 * 3600 * 1000).toISOString().slice(0, 10); // tolère les fuseaux horaires
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d.date) || Number.isNaN(Date.parse(d.date)) || d.date < yesterday) bad.push("date");
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(d.heure)) bad.push("heure");
  if (d.depart.length < 3) bad.push("depart");
  if (d.destination.length < 3) bad.push("destination");
  if (!d.nom) bad.push("nom");
  if (!d.prenom) bad.push("prenom");
  if (!validPhone(d.telephone)) bad.push("telephone");
  if (d.email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(d.email)) bad.push("email");
  if (!Number.isInteger(d.passagers) || d.passagers < 1 || d.passagers > 8) bad.push("passagers");
  if (d.reference && !/^[A-Z0-9 \-]{2,20}$/.test(d.reference)) bad.push("reference");
  return { data: d, bad };
}

/* ---------- Mise en forme de l'e-mail ---------- */
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const REF_LABELS = { vol: "N° de vol", train: "N° de train", "vol-train": "N° de vol / train" };

function frDate(iso) {
  const [y, m, j] = iso.split("-").map(Number);
  const s = new Date(Date.UTC(y, m - 1, j)).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function buildEmail(d, ref, brand) {
  const rows = [
    ["Référence", ref],
    ["Prestation", d.prestation || "À préciser"],
    ...(d.reference ? [[REF_LABELS[d.typeReference] || "N° de vol / train", d.reference]] : []),
    ["Date", frDate(d.date)],
    ["Heure", d.heure.replace(":", "h")],
    ["Départ", d.depart],
    ["Destination", d.destination],
    ["Passagers", String(d.passagers)],
    ["Véhicule", d.vehicule || "Pas de préférence"],
    ["Client", `${d.prenom} ${d.nom}`],
    ["Téléphone", d.telephone],
    ["E-mail", d.email || "Non renseigné"],
    ...(d.precisions ? [["Précisions", d.precisions]] : []),
    ["Origine", d.origine.libelle || d.origine.code || "Accès direct"],
    ...(Object.keys(d.origine.utm).length ? [["UTM", Object.entries(d.origine.utm).map(([k, v]) => `${k}=${v}`).join(" · ")]] : [])
  ];
  const subject = `Demande de réservation ${ref} — ${d.date.split("-").reverse().join("/")} ${d.heure.replace(":", "h")} — ${d.prenom} ${d.nom}`;
  const text = `Nouvelle demande de réservation reçue depuis le site ${brand}.\n\n` +
    rows.map(([k, v]) => `${k} : ${v}`).join("\n") +
    `\n\nAppeler : ${d.telephone}\nWhatsApp : https://wa.me/${d.telephone.replace(/\D/g, "")}\n`;
  const html = `<!doctype html><html lang="fr"><body style="margin:0;background:#f4f1ec;font-family:Helvetica,Arial,sans-serif;color:#1b1814">
<div style="max-width:560px;margin:0 auto;padding:28px 20px">
<p style="margin:0 0 4px;font-size:11px;letter-spacing:.2em;text-transform:uppercase;color:#8a7650">${esc(brand)}</p>
<h1 style="margin:0 0 20px;font:400 24px Georgia,serif">Nouvelle demande de réservation</h1>
<table role="presentation" style="width:100%;border-collapse:collapse;background:#fff">
${rows.map(([k, v]) => `<tr><td style="padding:10px 14px;border-bottom:1px solid #eee;font-size:12px;color:#7a7266;width:34%;vertical-align:top">${esc(k)}</td><td style="padding:10px 14px;border-bottom:1px solid #eee;font-size:15px;white-space:pre-wrap">${esc(v)}</td></tr>`).join("\n")}
</table>
<p style="margin:22px 0 0">
<a href="tel:${esc(d.telephone)}" style="display:inline-block;padding:12px 18px;background:#1b1814;color:#e4d6b8;text-decoration:none;font-size:13px;letter-spacing:.1em">Appeler ${esc(d.telephone)}</a>
<a href="https://wa.me/${esc(d.telephone.replace(/\D/g, ""))}" style="display:inline-block;padding:12px 18px;margin-left:6px;border:1px solid #1b1814;color:#1b1814;text-decoration:none;font-size:13px;letter-spacing:.1em">WhatsApp</a>
</p></div></body></html>`;
  return { subject, text, html };
}

/* ---------- Envoi via le prestataire e-mail ---------- */
async function sendEmail({ subject, text, html, replyTo }) {
  const provider = env("EMAIL_PROVIDER").toLowerCase() || "brevo";
  const key = env("EMAIL_API_KEY");
  const to = env("MAIL_TO");
  const from = env("MAIL_FROM");
  const fromName = env("MAIL_FROM_NAME") || "ELEV8 Private Driver";
  if (!key || !to || !from) throw new Error("config");

  let res;
  if (provider === "resend") {
    res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: `${fromName} <${from}>`, to: [to], subject, text, html, ...(replyTo ? { reply_to: replyTo } : {}) })
    });
  } else {
    res = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: { "api-key": key, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        sender: { name: fromName, email: from }, to: [{ email: to }], subject,
        textContent: text, htmlContent: html, ...(replyTo ? { replyTo: { email: replyTo } } : {})
      })
    });
  }
  if (!res.ok) throw new Error(`provider:${res.status}`);
}

/* Cloudflare Turnstile : jeton valide, émis pour ce site et pour l'action « reservation » */
const TURNSTILE_TEST_SECRETS = /^[123]x0+AA$/;
async function verifyTurnstile(token, ip, siteHost) {
  const secret = env("TURNSTILE_SECRET_KEY");
  if (!secret) {
    if (token) console.warn("Turnstile : jeton reçu mais TURNSTILE_SECRET_KEY absente — vérification ignorée");
    return { ok: true, skipped: true };
  }
  if (typeof token !== "string" || !token || token.length > 2048) return { ok: false, code: "missing" };
  const body = new URLSearchParams({ secret, response: token, idempotency_key: crypto.randomUUID() });
  if (ip && ip !== "inconnue") body.set("remoteip", ip);
  const r = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body });
  if (!r.ok) throw new Error(`turnstile:${r.status}`);
  const j = await r.json().catch(() => ({}));
  if (j.success !== true) return { ok: false, code: (j["error-codes"] || []).join(",") || "invalid" };
  if (!TURNSTILE_TEST_SECRETS.test(secret)) {          // les clés de test renvoient des valeurs fictives
    const hosts = [siteHost, ...env("ALLOWED_ORIGINS").split(",").map((o) => { try { return new URL(o.trim()).hostname; } catch { return ""; } })].filter(Boolean);
    if (j.hostname && !hosts.includes(j.hostname)) return { ok: false, code: "hostname" };
    if (j.action && j.action !== "reservation") return { ok: false, code: "action" };
  }
  return { ok: true };
}

export function makeRef(now = new Date()) {
  const p = (n) => String(n).padStart(2, "0");
  const rand = Array.from(crypto.getRandomValues(new Uint8Array(3)), (b) => "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"[b % 32]).join("");
  return `E8-${p(now.getUTCFullYear() % 100)}${p(now.getUTCMonth() + 1)}${p(now.getUTCDate())}-${rand}`;
}

/* ---------- Point d'entrée ---------- */
export default async (req, context) => {
  if (req.method !== "POST") return json(405, { ok: false, error: "method" });

  // Même origine uniquement (ou domaines listés dans ALLOWED_ORIGINS)
  const origin = req.headers.get("origin");
  if (origin) {
    const allowed = env("ALLOWED_ORIGINS").split(",").map((s) => s.trim()).filter(Boolean);
    const self = new URL(req.url).origin;
    if (origin !== self && !allowed.includes(origin)) return json(403, { ok: false, error: "origin" });
  }
  if (!(req.headers.get("content-type") || "").includes("application/json")) return json(415, { ok: false, error: "type" });

  const raw = await req.text();
  if (raw.length > MAX_BODY) return json(413, { ok: false, error: "size" });
  let body;
  try { body = JSON.parse(raw); } catch { return json(400, { ok: false, error: "json" }); }

  const ip = (context && context.ip) || req.headers.get("x-nf-client-connection-ip") || "inconnue";

  // Limitation par visiteur, partagée entre toutes les instances (chaque tentative compte)
  const store = rateStore();
  if (store) {
    try {
      const fp = await ipFingerprint(ip, env("RATE_LIMIT_SECRET") || env("EMAIL_API_KEY"));
      const ok = (await consume(store, keyFor("ip10m", fp), RULES.ip10m.limit)) &&
                 (await consume(store, keyFor("ip24h", fp), RULES.ip24h.limit));
      if (!ok) return json(429, { ok: false, error: "rate" });
    } catch (e) {
      // Stockage indisponible : la limitation Netlify en périphérie reste active
      console.error("Limitation partagée indisponible :", String(e && e.message).slice(0, 60));
    }
  }

  // Anti-spam : champ piège rempli ou formulaire envoyé trop vite → refusé (aucune confirmation)
  if (body.website) return json(400, { ok: false, error: "spam" });
  if (!(Number(body.duree) >= MIN_FILL_MS)) return json(400, { ok: false, error: "spam" });

  try {
    const t = await verifyTurnstile(body.turnstile, ip, new URL(req.url).hostname);
    if (!t.ok) return json(400, { ok: false, error: "captcha", code: t.code });
  } catch {
    return json(502, { ok: false, error: "captcha" });
  }

  const { data, bad } = validate(body);
  if (bad.length) return json(422, { ok: false, error: "validation", fields: bad });

  // Plafond global d'e-mails par heure (protège la boîte de réception contre un envoi massif réparti)
  if (store) {
    try {
      const max = Number.parseInt(env("RATE_GLOBAL_PER_HOUR"), 10) || RULES.global.limit;
      if (!(await consume(store, keyFor("global", "all"), max))) return json(429, { ok: false, error: "busy" });
    } catch (e) {
      console.error("Plafond global indisponible :", String(e && e.message).slice(0, 60));
    }
  }

  const ref = makeRef();
  try {
    await sendEmail({ ...buildEmail(data, ref, env("MAIL_FROM_NAME") || "ELEV8 Private Driver"), replyTo: data.email || "" });
  } catch (e) {
    console.error("Envoi impossible :", String(e && e.message).slice(0, 80)); // aucune donnée client
    return json(502, { ok: false, error: "send" });
  }
  return json(200, { ok: true, ref });
};
