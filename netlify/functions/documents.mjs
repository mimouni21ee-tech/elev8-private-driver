/* ==========================================================================
   ELEV8 Private Driver — devis et factures (réservé à ELEV8)
   --------------------------------------------------------------------------
   Adresse : POST /api/documents   (appelée par la page /documents)
   Accès : mot de passe DOCUMENTS_MOT_DE_PASSE (variable Netlify, 10 caractères minimum).
           Sans cette variable, la fonction est fermée.

   Actions :
     verifier  → contrôle le mot de passe et signale les informations légales manquantes
     devis     → renvoie le PDF du devis (rien n'est enregistré)
     facture   → attribue le numéro suivant (F-AAAA-0001…), enregistre la facture,
                 renvoie le PDF. Une facture déjà émise pour la même référence est
                 renvoyée à l'identique (jamais renumérotée ni modifiée).
     envoyer   → envoie le devis ou la facture au client par e-mail (Brevo), PDF en
                 pièce jointe, copie à ELEV8 (MAIL_TO).
   Une demande de réservation ne crée JAMAIS de facture : seule l'action « facture »,
   déclenchée volontairement par ELEV8 depuis la page /documents, le fait.

   Conservation : magasin Netlify Blobs « elev8-factures » (obligation comptable, 10 ans).
   ========================================================================== */
import { createHash, timingSafeEqual } from "node:crypto";
import { getStore } from "@netlify/blobs";
import { emetteur, manquants, nettoyer, aCompleter, pdf, montants, aujourdhuiParis, euros } from "../lib/documents.mjs";

export const config = {
  path: "/api/documents",
  rateLimit: { windowLimit: 30, windowSize: 60, aggregateBy: ["ip", "domain"] }
};

/* Dépendances remplaçables pour les tests automatisés */
export const deps = { store: null, config: null, send: null, now: () => Date.now() };

const MAX_BODY = 20_000;
const env = (k) => (process.env[k] || "").trim();
const json = (status, body) => new Response(JSON.stringify(body), {
  status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Robots-Tag": "noindex" }
});

/* Tentatives de mot de passe : 8 erreurs par quart d'heure et par adresse (par instance) */
const echecs = new Map();
const bloque = (ip, now) => (echecs.get(ip) || []).filter((t) => now - t < 900_000).length >= 8;
const noterEchec = (ip, now) => { const l = (echecs.get(ip) || []).filter((t) => now - t < 900_000); l.push(now); echecs.set(ip, l); if (echecs.size > 2000) echecs.delete(echecs.keys().next().value); };
function motDePasseOk(saisi) {
  const attendu = env("DOCUMENTS_MOT_DE_PASSE");
  if (attendu.length < 10 || typeof saisi !== "string") return false;
  const h = (x) => createHash("sha256").update("elev8-documents\u0000" + x).digest();
  return timingSafeEqual(h(saisi), h(attendu));
}

function store() {
  if (deps.store) return deps.store;
  return getStore({ name: "elev8-factures", consistency: "strong" });
}

/* Identité d'ELEV8 : rubrique « legal » de config.js (même source que les mentions légales) */
export function parseConfig(src) {
  const sandbox = {};
  new Function("window", src)(sandbox);
  return sandbox.SITE_CONFIG;
}
async function chargerConfig(origin) {
  if (deps.config) return deps.config;
  const r = await fetch(`${origin}/config.js`, { headers: { "cache-control": "no-cache" } });
  if (!r.ok) throw new Error("config " + r.status);
  return parseConfig(await r.text());
}

/* Numéro suivant, sans trou ni doublon (écriture conditionnelle) */
async function numeroSuivant(st, annee) {
  const cle = "compteur/" + annee;
  for (let i = 0; i < 10; i++) {
    const cur = await st.getWithMetadata(cle, { type: "json" });
    const n = (cur && cur.data && Number.isInteger(cur.data.n) ? cur.data.n : 0) + 1;
    const r = cur ? await st.setJSON(cle, { n }, { onlyIfMatch: cur.etag }) : await st.setJSON(cle, { n }, { onlyIfNew: true });
    if (r && r.modified) return `F-${annee}-${String(n).padStart(4, "0")}`;
  }
  throw new Error("numérotation occupée");
}

const nomFichier = (type, numero) => (type === "facture" ? "Facture-" : "Devis-") + numero + ".pdf";

async function envoyerEmail({ to, subject, text, html, fichier, contenu }) {
  if (deps.send) return deps.send({ to, subject, text, html, fichier, contenu });
  const provider = env("EMAIL_PROVIDER").toLowerCase() || "brevo";
  const key = env("EMAIL_API_KEY"), from = env("MAIL_FROM"), copie = env("MAIL_TO");
  const fromName = env("MAIL_FROM_NAME") || "ELEV8 Private Driver";
  if (!key || !from) throw new Error("config");
  const b64 = Buffer.from(contenu).toString("base64");
  let res;
  if (provider === "resend") {
    res = await fetch("https://api.resend.com/emails", {
      method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: `${fromName} <${from}>`, to: [to], ...(copie ? { bcc: [copie], reply_to: copie } : {}), subject, text, html,
        attachments: [{ filename: fichier, content: b64 }] })
    });
  } else {
    res = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST", headers: { "api-key": key, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ sender: { name: fromName, email: from }, to: [{ email: to }], ...(copie ? { bcc: [{ email: copie }], replyTo: { email: copie } } : {}),
        subject, textContent: text, htmlContent: html, attachment: [{ name: fichier, content: b64 }] })
    });
  }
  if (!res.ok) throw new Error(`provider:${res.status}`);
}
const esc = (x) => String(x).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

export default async (req, context) => {
  if (req.method !== "POST") return json(405, { ok: false, code: "methode" });
  const url = new URL(req.url);
  const origin = req.headers.get("origin");
  if (origin && origin !== url.origin && !env("ALLOWED_ORIGINS").split(",").map((x) => x.trim()).includes(origin)) return json(403, { ok: false, code: "origine" });
  if (env("DOCUMENTS_MOT_DE_PASSE").length < 10) return json(503, { ok: false, code: "ferme", message: "Accès non configuré : créez la variable Netlify DOCUMENTS_MOT_DE_PASSE (10 caractères minimum), puis redéployez." });

  let b;
  try { const raw = await req.text(); if (raw.length > MAX_BODY) return json(413, { ok: false, code: "taille" }); b = JSON.parse(raw); }
  catch { return json(400, { ok: false, code: "format" }); }
  const ip = (context && context.ip) || req.headers.get("x-nf-client-connection-ip") || "inconnue";
  const now = deps.now();
  if (bloque(ip, now)) return json(429, { ok: false, code: "limite", message: "Trop d'essais. Réessayez dans 15 minutes." });
  if (!motDePasseOk(b && b.motDePasse)) { noterEchec(ip, now); return json(401, { ok: false, code: "acces", message: "Mot de passe incorrect." }); }

  let C;
  try { C = await chargerConfig(url.origin); } catch (e) { console.error("config.js illisible :", String(e && e.message).slice(0, 60)); return json(502, { ok: false, code: "config" }); }
  const E = emetteur(C), manque = manquants(E);
  const action = b.action;
  if (action === "verifier") return json(200, { ok: true, emetteurIncomplet: manque });

  if (!["devis", "facture", "envoyer"].includes(action)) return json(400, { ok: false, code: "action" });
  if (manque.length) return json(422, { ok: false, code: "emetteur", manque,
    message: "Informations légales d'ELEV8 à compléter dans public/config.js (rubrique legal) : " + manque.join(" ; ") + "." });

  const type = action === "envoyer" ? (b.type === "facture" ? "facture" : "devis") : action;
  const doc = nettoyer(b.doc);
  const st = type === "facture" ? store() : null;

  /* ----- Facture : existante (même référence) ou nouvelle ----- */
  let record = null, nouvelle = false;
  if (type === "facture") {
    try {
      const lien = doc.ref ? await st.get("ref/" + doc.ref, { type: "json" }) : null;
      if (lien && lien.numero) record = await st.get("facture/" + lien.numero, { type: "json" });
    } catch (e) { console.error("Factures illisibles :", String(e && e.message).slice(0, 60)); return json(503, { ok: false, code: "stockage" }); }
    if (!record) {
      if (action === "envoyer") return json(409, { ok: false, code: "non_emise", message: "Générez d'abord la facture." });
      const champs = aCompleter(doc, "facture");
      if (champs.length) return json(422, { ok: false, code: "champs", champs });
      const jour = aujourdhuiParis(now);
      if (doc.facture.datePrestation > jour || (doc.facture.paye && doc.facture.datePaiement > jour))
        return json(422, { ok: false, code: "date_future", message: "La facture s'établit une fois la prestation effectuée et le paiement reçu : la date de la prestation et celle du paiement ne peuvent pas être postérieures à aujourd'hui." });
      try {
        const verrou = await st.setJSON("ref/" + doc.ref, { numero: null, t: now }, { onlyIfNew: true });
        if (verrou && verrou.modified === false) {                 // émission simultanée ou déjà émise
          const l = await st.get("ref/" + doc.ref, { type: "json" });
          if (l && l.numero) record = await st.get("facture/" + l.numero, { type: "json" });
          if (!record) {
            if (l && !l.numero && now - (l.t || 0) > 60_000) await st.delete("ref/" + doc.ref);   // émission interrompue : on libère
            return json(409, { ok: false, code: "en_cours", message: "Facture en cours d'émission. Réessayez dans quelques secondes." });
          }
        } else {
          const dateEmission = aujourdhuiParis(now);
          const numero = await numeroSuivant(st, dateEmission.slice(0, 4));
          record = { numero, dateEmission, horodatage: new Date(now).toISOString(), emetteur: E, doc, montants: montants(doc.montant, E, doc.supplements), iban: env("FACTURE_IBAN") || "" };
          await st.setJSON("facture/" + numero, record, { onlyIfNew: true });
          await st.setJSON("ref/" + doc.ref, { numero, t: now });
          nouvelle = true;
        }
      } catch (e) {
        console.error("Émission impossible :", String(e && e.message).slice(0, 60));
        return json(503, { ok: false, code: "stockage", message: "Enregistrement de la facture impossible. Réessayez." });
      }
    }
  } else {
    const champs = aCompleter(doc, "devis");
    if (champs.length) return json(422, { ok: false, code: "champs", champs });
  }

  /* ----- PDF ----- */
  const meta = type === "facture"
    ? { numero: record.numero, dateEmission: record.dateEmission, horodatage: record.horodatage, iban: record.iban }
    : { numero: "D-" + doc.ref, dateEmission: aujourdhuiParis(now), horodatage: now };
  const bytes = await pdf(type, type === "facture" ? record.doc : doc, type === "facture" ? record.emetteur : E, meta);
  const fichier = nomFichier(type, meta.numero);
  const d = type === "facture" ? record.doc : doc;
  const total = (type === "facture" ? record.montants : montants(d.montant, E, d.supplements)).ttc;

  if (action === "envoyer") {
    const to = String(b.destinataire || d.client.email || "").trim();
    if (!/^[^\s@<>]+@[^\s@<>]+\.[a-z]{2,}$/i.test(to) || to.length > 120) return json(422, { ok: false, code: "destinataire", message: "Adresse e-mail du client manquante ou invalide." });
    const nom = d.client.prenom || d.client.nom || "";
    const provisoire = type === "devis" && !d.devis.valide;
    const sujet = type === "facture" ? `Votre facture ${meta.numero} — ELEV8 Private Driver` : `Votre devis ${provisoire ? "provisoire " : ""}${meta.numero} — ELEV8 Private Driver`;
    const corps = type === "facture"
      ? `Bonjour ${nom},\n\nVeuillez trouver ci-joint votre facture ${meta.numero} d'un montant de ${euros(total)}.\n\nMerci pour votre confiance.\n\nELEV8 Private Driver\n${E.telephone}`
      : `Bonjour ${nom},\n\nVeuillez trouver ci-joint votre devis ${provisoire ? "provisoire " : ""}pour le trajet du ${d.prestation.date.split("-").reverse().join("/")}, d'un montant de ${euros(total)}.\n\n` +
        (provisoire ? "Ce tarif reste à confirmer : nous revenons vers vous après vérification de la disponibilité." : "Pour l'accepter, répondez simplement « J'accepte » à ce message.") +
        `\nAucun paiement n'est demandé à cette étape.\n\nELEV8 Private Driver\n${E.telephone}`;
    const html = `<!doctype html><html><body style="margin:0;background:#f4efe6;font-family:Helvetica,Arial,sans-serif;color:#1b1814"><div style="max-width:560px;margin:0 auto;padding:28px 22px"><p style="margin:0 0 18px;font:400 22px Georgia,serif;letter-spacing:.2em;color:#8b7650">ELEV8</p>${corps.split("\n").map((l) => `<p style="margin:0 0 ${l ? 8 : 4}px;font-size:15px;line-height:1.5">${esc(l) || "&nbsp;"}</p>`).join("")}</div></body></html>`;
    try { await envoyerEmail({ to, subject: sujet, text: corps, html, fichier, contenu: bytes }); }
    catch (e) { console.error("Envoi du document impossible :", String(e && e.message).slice(0, 60)); return json(502, { ok: false, code: "envoi", message: "Envoi impossible pour le moment. Téléchargez le PDF et envoyez-le vous-même." }); }
    return json(200, { ok: true, envoye: to, numero: meta.numero });
  }

  return json(200, { ok: true, type, numero: meta.numero, dateEmission: meta.dateEmission, fichier, total,
    deja: type === "facture" && !nouvelle, pdf: Buffer.from(bytes).toString("base64") });
};
