/* ==========================================================================
   ELEV8 Private Driver — espace chauffeur : courses saisies sur place
   --------------------------------------------------------------------------
   Adresse : POST /chauffeur-api   (appelée par la page /chauffeur)
   Accès : même mot de passe que /documents (DOCUMENTS_MOT_DE_PASSE), échangé contre une
           session signée propre au chauffeur (clé distincte : elle n'ouvre PAS /documents).
           Durée 1 an, prolongée automatiquement à chaque utilisation : pas de reconnexion.
           Changer DOCUMENTS_MOT_DE_PASSE dans Netlify déconnecte immédiatement le téléphone.

   Actions : connexion · verifier · position · estimer · creer · etat · encaisser · terminer · annuler · jour
   La logique (réservation, paiement, encaissement hors Stripe) est dans netlify/lib/sur-place.mjs.
   ========================================================================== */
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { retenirContexte, estSiteDeTest } from "../lib/environnement.mjs";
import { stripeActif } from "../lib/stripe.mjs";
import { lireCourse, prixGrille, MESSAGES_ESTIMATION, adresseDePosition, creerCourse, marquerPaye, terminer, annuler, lire, listerJour, MOYENS } from "../lib/sur-place.mjs";

export const config = { path: "/chauffeur-api", rateLimit: { windowLimit: 90, windowSize: 60, aggregateBy: ["ip", "domain"] } };
export const deps = { now: () => Date.now() };

const env = (k) => (process.env[k] || "").trim();
const json = (status, body) => new Response(JSON.stringify(body), {
  status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Robots-Tag": "noindex" }
});

/* Mot de passe : 8 erreurs par quart d'heure et par adresse */
const echecs = new Map();
const bloque = (ip, now) => (echecs.get(ip) || []).filter((t) => now - t < 900_000).length >= 8;
const noterEchec = (ip, now) => { const l = (echecs.get(ip) || []).filter((t) => now - t < 900_000); l.push(now); echecs.set(ip, l); if (echecs.size > 2000) echecs.delete(echecs.keys().next().value); };
function motDePasseOk(saisi) {
  const attendu = env("DOCUMENTS_MOT_DE_PASSE");
  if (attendu.length < 10 || typeof saisi !== "string") return false;
  const h = (x) => createHash("sha256").update("elev8-documents\u0000" + x).digest();
  return timingSafeEqual(h(saisi), h(attendu));
}

/* Session chauffeur : « c1.<expiration>.<aléa>.<signature> », 1 an, renouvelée quand il reste moins de 300 jours */
export const DUREE = 365 * 86400_000, RENOUVELER = 300 * 86400_000;
const cle = () => createHmac("sha256", env("DOCUMENTS_MOT_DE_PASSE")).update("elev8-chauffeur-v1").digest();
export function creerSession(now) {
  const corps = `c1.${now + DUREE}.${randomBytes(12).toString("base64url")}`;
  return { jeton: `${corps}.${createHmac("sha256", cle()).update(corps).digest("base64url")}`, expire: now + DUREE };
}
export function sessionOk(jeton, now) {
  if (typeof jeton !== "string" || jeton.length > 200 || env("DOCUMENTS_MOT_DE_PASSE").length < 10) return null;
  const p = jeton.split(".");
  if (p.length !== 4 || p[0] !== "c1") return null;
  const exp = Number(p[1]);
  if (!Number.isFinite(exp) || exp <= now || exp > now + DUREE + 60_000) return null;
  const a = Buffer.from(p[3]), b = Buffer.from(createHmac("sha256", cle()).update(p.slice(0, 3).join(".")).digest("base64url"));
  return a.length === b.length && timingSafeEqual(a, b) ? { exp } : null;
}

const REF_RE = /^E8-[A-Z0-9-]{3,30}$/;

export default async (req, context) => {
  retenirContexte(context);
  if (req.method !== "POST") return json(405, { ok: false, message: "Méthode non autorisée." });
  const url = new URL(req.url);
  const origin = req.headers.get("origin");
  if (origin && origin !== url.origin && !env("ALLOWED_ORIGINS").split(",").map((x) => x.trim()).includes(origin)) return json(403, { ok: false, message: "Requête refusée." });
  if (env("DOCUMENTS_MOT_DE_PASSE").length < 10) return json(503, { ok: false, code: "ferme", message: "Accès non configuré (DOCUMENTS_MOT_DE_PASSE)." });
  let b;
  try { const raw = await req.text(); if (raw.length > 8000) return json(413, { ok: false, message: "Données trop volumineuses." }); b = JSON.parse(raw) || {}; }
  catch { return json(400, { ok: false, message: "Requête illisible." }); }
  const ip = (context && context.ip) || req.headers.get("x-nf-client-connection-ip") || "inconnue";
  const now = deps.now();
  if (bloque(ip, now)) return json(429, { ok: false, message: "Trop d'essais. Réessayez dans 15 minutes." });

  let session = null;
  if (b.action === "connexion") {
    if (!motDePasseOk(b.motDePasse)) { noterEchec(ip, now); return json(401, { ok: false, code: "acces", message: "Mot de passe incorrect." }); }
    session = creerSession(now);
  } else {
    const s = sessionOk(b.session, now);
    if (!s) { noterEchec(ip, now); return json(401, { ok: false, code: "acces", message: "Session expirée : saisissez à nouveau le mot de passe." }); }
    if (s.exp - now < RENOUVELER) session = creerSession(now);          // prolongation automatique
  }
  const ok = (corps) => json(200, { ok: true, ...(session ? { session: session.jeton } : {}), ...corps });
  const ko = (r) => json(r.erreur[0], { ok: false, message: r.erreur[1], champs: r.champs || null, course: r.course || null, ...(session ? { session: session.jeton } : {}) });
  const ref = String(b.ref || "").trim().toUpperCase();
  const refOk = REF_RE.test(ref);

  try {
    switch (b.action) {
      case "connexion":
      case "verifier":
        return ok({ stripe: !!stripeActif(), modeStripe: stripeActif()?.mode || null, test: estSiteDeTest(), moyens: MOYENS });
      case "position": {
        const adresse = await adresseDePosition(b.lat, b.lon);
        return adresse ? ok({ adresse }) : json(404, { ok: false, message: "Adresse introuvable pour cette position : saisissez-la." });
      }
      case "estimer": {
        const e = lireCourse(b, now);
        if (e.depart.length < 3 || e.destination.length < 3) return json(422, { ok: false, message: MESSAGES_ESTIMATION.lieu });
        const g = await prixGrille(e);
        if (g.erreur) return ok({ estimation: { statut: "indisponible", motif: g.erreur, message: MESSAGES_ESTIMATION[g.erreur] || MESSAGES_ESTIMATION.indisponible } });
        return ok({ estimation: { ...g, message: g.statut === "sur_devis" ? (g.motif === "hors_zone" ? "Hors zone de la grille : fixez le prix avec le client." : "Sur devis : fixez le prix avec le client.") : "" } });
      }
      case "creer": {
        const r = await creerCourse(b, { origine: url.origin, now });
        return r.erreur ? ko(r) : ok(r);
      }
      case "etat": {
        if (!refOk) return json(400, { ok: false, message: "Référence invalide." });
        const r = await lire({ ref, now });
        return r.erreur ? ko(r) : ok(r);
      }
      case "encaisser": {
        if (!refOk) return json(400, { ok: false, message: "Référence invalide." });
        const r = await marquerPaye({ ref, moyen: b.moyen, reference: b.reference, now });
        return r.erreur ? ko(r) : ok(r);
      }
      case "terminer": {
        if (!refOk) return json(400, { ok: false, message: "Référence invalide." });
        const r = await terminer({ ref, now });
        return r.erreur ? ko(r) : ok(r);
      }
      case "annuler": {
        if (!refOk) return json(400, { ok: false, message: "Référence invalide." });
        const r = await annuler({ ref, now });
        return r.erreur ? ko(r) : ok(r);
      }
      case "jour":
        return ok({ courses: await listerJour({ now }) });
      default:
        return json(400, { ok: false, message: "Action inconnue." });
    }
  } catch (e) {
    console.error("Espace chauffeur :", b.action, String(e && e.message).slice(0, 80));
    const m = String(e && e.message);
    if (m === "montant") return json(422, { ok: false, message: "Montant invalide (1 € à 5 000 €)." });
    return json(500, { ok: false, message: "Erreur momentanée. Réessayez." });
  }
};
