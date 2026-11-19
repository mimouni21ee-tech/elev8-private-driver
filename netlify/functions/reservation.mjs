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

   Parcours (17 nov. 2026) : demande GRATUITE, sans paiement ni acompte.
   L'estimation affichée au client est reprise grâce à son jeton signé, ou
   recalculée ici (netlify/lib/estimation.mjs) : un montant modifié dans le
   navigateur n'est jamais pris en compte. La demande arrive chez ELEV8 avec le
   statut « Demande reçue — en attente de validation » : seule ELEV8 confirme
   le tarif final et la réservation. Un même envoi répété (double clic, réseau)
   ne produit qu'un seul e-mail (identifiant de demande conservé 24 h, sans
   aucune donnée personnelle).

   Aucune donnée personnelle n'est écrite dans les journaux (logs).
   ========================================================================== */

const MIN_FILL_MS = 3000;          // un humain met plus de 3 s à remplir le formulaire
const MAX_BODY = 12_000;           // octets

import { RULES, openStore, keyFor, ipFingerprint, consume } from "../lib/ratelimit.mjs";
import { estimer, verifier, deps as estDeps, ZONE_ESTIMATION } from "../lib/estimation.mjs";
import { magasin as magasinDemandes, enregistrer as enregistrerDemande, supprimer as supprimerDemande, chargerParId } from "../lib/demandes.mjs";
import { stripeActif } from "../lib/stripe.mjs";
import { eligibleAuto, magasin as magasinPaiements, modifier as modifierPaiement } from "../lib/paiements.mjs";
import { preparerPaiement } from "../lib/actions-paiement.mjs";
import { mailLienPaiement } from "../lib/courriels.mjs";
import { envoyerUneFois } from "../lib/notifications.mjs";

const ESTIMATION_MAX_MS = 6000;    // recalcul de l'estimation : au-delà, la demande part « tarif à établir »

/* Point d'accès public de la fonction + limitation Netlify en périphérie
   (6 requêtes / 3 min par visiteur ; disponible sur toutes les offres Netlify). */
export const config = {
  path: "/envoi-reservation",
  rateLimit: { windowLimit: 6, windowSize: 180, aggregateBy: ["ip", "domain"] }
};

/* Dépendances remplaçables pour les tests automatisés */
export const deps = { store: null, send: null };
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
    allerRetour: b.allerRetour === true,
    dateRetour: b.allerRetour === true ? str(b.dateRetour, 10) : "",
    heureRetour: b.allerRetour === true ? str(b.heureRetour, 5) : "",
    passagers: Number.parseInt(b.passagers, 10),
    bagages: b.bagages === "" || b.bagages == null ? null : Number.parseInt(b.bagages, 10),
    vehicule: str(b.vehicule, 100),
    nom: str(b.nom, 80),
    prenom: str(b.prenom, 80),
    telephone: str(b.telephone, 20),
    email: str(b.email, 120),
    societe: str(b.societe, 120),
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
  if (d.bagages !== null && (!Number.isInteger(d.bagages) || d.bagages < 0 || d.bagages > 20)) bad.push("bagages");
  if (d.allerRetour) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d.dateRetour) || Number.isNaN(Date.parse(d.dateRetour)) || d.dateRetour < d.date) bad.push("dateRetour");
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(d.heureRetour)) bad.push("heureRetour");
    else if (d.dateRetour === d.date && d.heureRetour <= d.heure) bad.push("heureRetour");
  }
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

export const euros = (n) => (Math.round(n * 100) / 100).toFixed(2).replace(".", ",").replace(",00", "") + " €";
const MOTIFS_DEVIS = {
  hors_zone: `trajet hors de la zone d'estimation automatique (${ZONE_ESTIMATION.rayonKm} km autour de ${ZONE_ESTIMATION.nom})`,
  mise_a_disposition: "mise à disposition",
  lieu_inconnu: "adresse non localisée automatiquement",
  itineraire: "itinéraire non calculable automatiquement",
  indisponible: "service de calcul momentanément indisponible"
};
/* Ligne « Estimation » de l'e-mail, telle qu'établie par le serveur (jamais par le navigateur) */
export function texteEstimation(est) {
  if (est && est.statut === "estimation" && est.montant > 0) {
    return `${euros(est.montant)} — ${est.vehicule}${est.allerRetour ? " · aller-retour" : ""} · ${String(est.distanceKm).replace(".", ",")} km` +
      (est.lignes && est.lignes.length ? "\n" + est.lignes.map((l) => `${l.libelle} : ${euros(l.montant)} (${l.detail})`).join("\n") : "");
  }
  return `Tarif à établir par ELEV8 — ${MOTIFS_DEVIS[(est && est.motif) || "indisponible"] || MOTIFS_DEVIS.indisponible}`;
}

/* Lien vers la page /documents (réservée à ELEV8). Il ne contient qu'un identifiant opaque :
   la demande est enregistrée côté serveur (netlify/lib/demandes.mjs) et n'est lisible
   qu'après authentification. Aucune donnée personnelle dans l'adresse. */
export function lienDocuments(idDemande, origin, etape = "") {
  if (!idDemande) return "";
  return `${origin}/documents/?r=${encodeURIComponent(idDemande)}${etape ? "&etape=" + etape : ""}`;
}

/* Paiement en ligne (mode test Stripe) : { auto: true, montant, valableJusqu } si le lien a été envoyé
   automatiquement au client ; { auto: false, motif } si la demande exige une validation manuelle. */
const MOTIFS_MANUEL = { sur_devis: "tarif sur devis", demande_particuliere: "informations complémentaires à examiner", delai_court: "prise en charge trop proche", erreur: "création du lien impossible" };
export function buildEmail(d, ref, brand, est = null, origin = "https://elev8privatedriver.com", idDemande = "", paiement = null) {
  const auto = !!(paiement && paiement.auto);
  const rows = [
    ["Référence", ref],
    ["Statut", auto ? "Tarif calculé automatiquement — lien de paiement envoyé au client (Stripe, MODE TEST)" : "Demande reçue — en attente de validation par ELEV8"],
    ...(paiement && !paiement.auto ? [["Paiement en ligne", "Validation manuelle requise : " + (MOTIFS_MANUEL[paiement.motif] || paiement.motif)]] : []),
    ["Reçue le", new Date().toLocaleString("fr-FR", { timeZone: "Europe/Paris", dateStyle: "full", timeStyle: "short" })],
    ["Estimation", texteEstimation(est)],
    ["Prestation", d.prestation || "À préciser"],
    ...(d.reference ? [[REF_LABELS[d.typeReference] || "N° de vol / train", d.reference]] : []),
    ["Trajet", d.allerRetour ? "Aller-retour" : "Aller simple"],
    ["Date", frDate(d.date)],
    ["Heure", d.heure.replace(":", "h")],
    ["Départ", d.depart],
    ["Destination", d.destination],
    ...(d.allerRetour ? [["Retour", `${frDate(d.dateRetour)} à ${d.heureRetour.replace(":", "h")}`]] : []),
    ["Passagers", String(d.passagers)],
    ["Bagages", d.bagages === null ? "Non précisé" : String(d.bagages)],
    ["Véhicule", d.vehicule || "Pas de préférence"],
    ["Informations complémentaires", d.precisions || "Aucune"],
    ["Client", `${d.prenom} ${d.nom}`],
    ["Société", d.societe || "Particulier (non renseignée)"],
    ["Téléphone", d.telephone],
    ["E-mail", d.email || "Non renseigné"],
    ["Origine", d.origine.libelle || d.origine.code || "Accès direct"],
    ...(Object.keys(d.origine.utm).length ? [["UTM", Object.entries(d.origine.utm).map(([k, v]) => `${k}=${v}`).join(" · ")]] : [])
  ];
  /* Validation du tarif : page protégée /documents (rubrique 4), préremplie avec cette demande.
     ELEV8 y saisit le tarif DÉFINITIF (pas l'estimation), coche la disponibilité vérifiée, ajoute
     éventuellement un lien de paiement Indy vérifié, puis ouvre l'e-mail ou le WhatsApp du client. */
  const lienValidation = lienDocuments(idDemande, origin, "validation");
  const lienDocs = lienDocuments(idDemande, origin);
  const sansLien = "Ouvrez " + origin + "/documents/ et saisissez la référence " + ref + " (enregistrement momentanément indisponible : si elle est introuvable, saisissez la demande manuellement).";
  const montantSujet = est && est.statut === "estimation" && est.montant > 0 ? euros(est.montant) : "tarif à établir";
  const subject = `${auto ? "[Paiement en ligne envoyé]" : "[À valider]"} Demande ${ref} — ${d.date.split("-").reverse().join("/")} ${d.heure.replace(":", "h")} — ${d.prenom} ${d.nom}${d.societe ? ` (${d.societe})` : ""} — ${montantSujet}`;
  const etapes = auto ? "AUCUNE ACTION REQUISE POUR L'INSTANT : le tarif a été calculé par le site et le client a reçu son lien de paiement sécurisé (" + euros(paiement.montant) + " TTC). " +
    "Vous serez prévenu dès que Stripe confirme réellement le paiement ; la course passera alors à « Payée — en attente d'attribution ». " +
    "En cas d'indisponibilité, ouvrez la réservation et cliquez sur « Indisponible — annuler »." : "À FAIRE : vérifier la disponibilité et les informations complémentaires, puis « Valider le tarif » : " +
    "vous saisissez le tarif définitif (et, si vous le souhaitez, un lien de paiement Indy) et le message au client est préparé. " +
    "La réservation n'est confirmée qu'après l'accord ou le règlement du client et votre confirmation. Le client n'a rien payé.";
  const text = `Nouvelle demande de réservation reçue depuis le site ${brand}.\n${etapes}\n\n` +
    rows.map(([k, v]) => `${k} : ${v}`).join("\n") +
    `\n\nAppeler : ${d.telephone}\nWhatsApp : https://wa.me/${d.telephone.replace(/\D/g, "")}\n` +
    `\n--- Valider le tarif et préparer le message au client (e-mail ou WhatsApp) ---\n${lienValidation || sansLien}\n` +
    `\n--- Devis et facture PDF (préremplis avec cette demande, après connexion) ---\n${lienDocs || sansLien}\n`;
  const lien = (href, label, plein) => `<a href="${esc(href)}" style="display:inline-block;margin:0 6px 8px 0;padding:11px 16px;${plein ? "background:#1b1814;color:#e4d6b8" : "border:1px solid #1b1814;color:#1b1814"};text-decoration:none;font-size:13px;letter-spacing:.06em">${esc(label)}</a>`;

  const html = `<!doctype html><html lang="fr"><body style="margin:0;background:#f4f1ec;font-family:Helvetica,Arial,sans-serif;color:#1b1814">
<div style="max-width:560px;margin:0 auto;padding:28px 20px">
<p style="margin:0 0 4px;font-size:11px;letter-spacing:.2em;text-transform:uppercase;color:#8a7650">${esc(brand)}</p>
<h1 style="margin:0 0 12px;font:400 24px Georgia,serif">Nouvelle demande de réservation</h1>
<p style="margin:0 0 18px;padding:12px 14px;background:#fff7e6;border-left:3px solid #b8955a;font-size:13px;line-height:1.5">${esc(etapes)}</p>
<table role="presentation" style="width:100%;border-collapse:collapse;background:#fff">
${rows.map(([k, v]) => { const fort = k === "Estimation" || (k === "Informations complémentaires" && d.precisions); return `<tr><td style="padding:10px 14px;border-bottom:1px solid #eee;font-size:12px;color:#7a7266;width:34%;vertical-align:top">${esc(k)}</td><td style="padding:10px 14px;border-bottom:1px solid #eee;font-size:15px;white-space:pre-wrap${fort ? ";background:#fbf6ec;font-weight:600" : ""}">${esc(v)}</td></tr>`; }).join("\n")}
</table>
<p style="margin:22px 0 0">
<a href="tel:${esc(d.telephone)}" style="display:inline-block;padding:12px 18px;background:#1b1814;color:#e4d6b8;text-decoration:none;font-size:13px;letter-spacing:.1em">Appeler ${esc(d.telephone)}</a>
<a href="https://wa.me/${esc(d.telephone.replace(/\D/g, ""))}" style="display:inline-block;padding:12px 18px;margin-left:6px;border:1px solid #1b1814;color:#1b1814;text-decoration:none;font-size:13px;letter-spacing:.1em">WhatsApp</a>
</p>
<p style="margin:22px 0 8px;font-size:11px;letter-spacing:.2em;text-transform:uppercase;color:#8a7650">Valider le tarif et répondre au client</p>
<p style="margin:0 0 6px">${lienValidation ? lien(lienValidation, "Valider le tarif (e-mail ou WhatsApp au client)", true) : esc(sansLien)}</p>
<p style="margin:0;font-size:12px;color:#7a7266">Vous saisissez le tarif définitif, et si vous le souhaitez un lien de paiement Indy. Le message au client (e-mail ou WhatsApp) est préparé, à relire et modifier avant l'envoi.</p>
<p style="margin:22px 0 8px;font-size:11px;letter-spacing:.2em;text-transform:uppercase;color:#8a7650">Devis et facture PDF</p>
<p style="margin:0 0 6px">${lienDocs ? lien(lienDocs, "Préparer le devis ou la facture", false) : ""}</p>
<p style="margin:0;font-size:12px;color:#7a7266">Toutes les informations de cette demande sont reprises : complétez seulement l'adresse de facturation et le tarif validé. La facture s'établit après la prestation.</p>
</div></body></html>`;
  return { subject, text, html };
}

/* ---------- Envoi via le prestataire e-mail ---------- */
async function sendEmail({ subject, text, html, replyTo }) {
  if (deps.send) return deps.send({ subject, text, html, replyTo });
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

  /* Anti-doublon : un même identifiant de demande n'envoie qu'un seul e-mail (24 h).
     Seuls l'identifiant aléatoire et la référence sont conservés, jamais les données du client. */
  const idem = idemKey(body.demandeId);
  if (idem && store) {
    try {
      const prev = await store.get(idem, { type: "json" });
      if (prev && prev.ref && prev.etat === "envoye") return json(200, { ok: true, ref: prev.ref, deja: true, estimation: prev.estimation || null, paiement: prev.paiement || null });
      if (prev && prev.etat === "envoi") {
        if (Date.now() - (prev.t || 0) < 60_000) return json(409, { ok: false, error: "pending" });
        await store.delete(idem);                                  // tentative interrompue : on peut renvoyer
      }
    } catch (e) { console.error("Anti-doublon indisponible :", String(e && e.message).slice(0, 60)); }
  }

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

  // Estimation : jeton signé de /estimation pour ces mêmes trajet, horaire et véhicule ; sinon recalcul serveur
  let est = verifier(body.estimation, data);
  if (!est) {
    if (store && !estDeps.store) estDeps.store = store;
    est = await Promise.race([
      estimer(data).catch((e) => ({ statut: "sur_devis", motif: (e && e.code) || "indisponible" })),
      new Promise((r) => setTimeout(() => r({ statut: "sur_devis", motif: "indisponible" }), ESTIMATION_MAX_MS))
    ]);
  }
  const estPublic = { statut: est.statut, montant: est.statut === "estimation" ? est.montant : null, motif: est.motif || null };

  const ref = makeRef();
  if (idem && store) {
    try {
      const r = await store.setJSON(idem, { etat: "envoi", ref, t: Date.now() }, { onlyIfNew: true });
      if (r && r.modified === false) return json(409, { ok: false, error: "pending" });   // envoi simultané du même formulaire
    } catch { /* stockage indisponible : envoi sans anti-doublon */ }
  }
  /* Enregistrement sécurisé de la demande (préremplissage du devis, de la validation et de la facture).
     En cas d'indisponibilité, la demande part quand même par e-mail (sans lien de préremplissage). */
  let idDemande = "", stDemandes = null;
  try { stDemandes = magasinDemandes(); idDemande = await enregistrerDemande(stDemandes, { ref, d: data, est }); }
  catch (e) { console.error("Enregistrement de la demande impossible :", String(e && e.message).slice(0, 60)); idDemande = ""; }
  /* Paiement en ligne automatique (mode test Stripe) : seulement si le prix est calculé par le serveur,
     sans demande particulière et avec un délai suffisant. Sinon : validation manuelle dans /documents. */
  const origine = new URL(req.url).origin;
  let paiement = null, dossier = null, D = null;
  if (idDemande && stripeActif()) {
    const el = eligibleAuto(data, est);
    paiement = { auto: false, motif: el.motif || "" };
    if (el.ok) {
      try {
        const r = await chargerParId(stDemandes, idDemande);
        D = r && r.record;
        if (D) { dossier = (await preparerPaiement(D, { idDemande, montant: est.montant, origine, envoyerMail: false })).p; paiement = { auto: true, montant: est.montant, valableJusqu: dossier.valableJusqu }; }
      } catch (e) { console.error("Lien de paiement non créé :", String(e && e.message).slice(0, 60)); paiement = { auto: false, motif: "erreur" }; }
    }
  }
  try {
    await sendEmail({ ...buildEmail(data, ref, env("MAIL_FROM_NAME") || "ELEV8 Private Driver", est, origine, idDemande, paiement), replyTo: data.email || "" });
  } catch (e) {
    console.error("Envoi impossible :", String(e && e.message).slice(0, 80)); // aucune donnée client
    if (dossier) await modifierPaiement(magasinPaiements(), dossier.jeton, (x) => ({ ...x, statut: "annule", etape: "annulee" })).catch(() => {});
    if (idDemande && stDemandes) await supprimerDemande(stDemandes, { id: idDemande, ref });
    if (idem && store) { try { await store.delete(idem); } catch { /* ignoré */ } }
    return json(502, { ok: false, error: "send" });
  }
  if (idem && store) {
    try { await store.setJSON(idem, { etat: "envoye", ref, t: Date.now(), estimation: estPublic }); } catch { /* ignoré */ }
  }
  // Lien de paiement envoyé au client APRÈS la notification d'ELEV8 (jamais de lien pour une demande non enregistrée)
  let lienPaiement = null;
  if (dossier) {
    lienPaiement = { url: "/payer/" + dossier.jeton, montant: dossier.montantCents / 100, valableJusqu: dossier.valableJusqu, email: false, mode: "test" };
    if (D && D.client.email) lienPaiement.email = await envoyerUneFois(magasinPaiements(), dossier, "client_lien", mailLienPaiement(D, dossier, origine + "/payer/" + dossier.jeton), D.client.email);
    if (idem && store) { try { await store.setJSON(idem, { etat: "envoye", ref, t: Date.now(), estimation: estPublic, paiement: lienPaiement }); } catch { /* ignoré */ } }
  }
  return json(200, { ok: true, ref, statut: dossier ? "attente_paiement" : "demande_recue", estimation: estPublic, paiement: lienPaiement });
};

/* Identifiant de demande créé par le navigateur : « <secondes>-<aléa> », valable 24 h */
export function idemKey(id, now = Date.now()) {
  const m = typeof id === "string" && /^(\d{10})-([a-z0-9]{12,32})$/.exec(id);
  if (!m) return "";
  const t = +m[1] * 1000;
  if (Math.abs(now - t) > 24 * 3600_000) return "";
  return `idem/${m[1]}-${m[2]}`;
}
