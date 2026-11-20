/* ==========================================================================
   ELEV8 Private Driver — devis et factures (réservé à ELEV8)
   --------------------------------------------------------------------------
   Adresse : POST /documents-api   (appelée par la page /documents)
   ⚠ Ne pas la placer sous /api/ : netlify.toml renvoie en 404, de façon forcée,
     toute adresse /api/* (anciens fichiers PHP) avant même d'appeler la fonction.
   Accès : mot de passe DOCUMENTS_MOT_DE_PASSE (variable Netlify, 10 caractères minimum),
           échangé contre une session signée (12 h, ou 30 jours si « Rester connecté »).
           Sans cette variable, la fonction est fermée.

   Actions :
     connexion → mot de passe → session ; signale les informations légales manquantes
     verifier  → contrôle la session (ou le mot de passe)
     charger   → demande enregistrée (identifiant opaque du lien de l'e-mail, ou référence)
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
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { getStore } from "@netlify/blobs";
import { emetteur, manquants, nettoyer, aCompleter, pdf, montants, aujourdhuiParis, euros } from "../lib/documents.mjs";
import { magasin as magasinDemandes, chargerParId, chargerParRef } from "../lib/demandes.mjs";
import { stripeActif } from "../lib/stripe.mjs";
import { retenirContexte, estSiteDeTest, nomMagasin, destinataireTest, marquerTest } from "../lib/environnement.mjs";
import { magasin as magasinPaiements, parRef as paiementParRef, resume as resumePaiement } from "../lib/paiements.mjs";
import { creerLienManuel, confirmerChauffeur, annulerEtRembourser } from "../lib/actions-paiement.mjs";

export const config = {
  path: "/documents-api",
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

/* ---------- Session d'administration ----------
   Après le mot de passe, la page reçoit un jeton signé (HMAC) à durée limitée : 12 h, ou 30 jours
   si « Rester connecté ». Le mot de passe n'est jamais conservé dans le navigateur. Changer
   DOCUMENTS_MOT_DE_PASSE dans Netlify invalide immédiatement toutes les sessions. */
const SESSION_COURTE = 12 * 3600_000, SESSION_LONGUE = 30 * 86400_000;
const cleSession = () => createHmac("sha256", env("DOCUMENTS_MOT_DE_PASSE")).update("elev8-session-v1").digest();
export function creerSession(now, duree) {
  const corps = `v1.${now + duree}.${randomBytes(12).toString("base64url")}`;
  return { jeton: `${corps}.${createHmac("sha256", cleSession()).update(corps).digest("base64url")}`, expire: now + duree };
}
export function sessionOk(jeton, now) {
  if (typeof jeton !== "string" || jeton.length > 200 || env("DOCUMENTS_MOT_DE_PASSE").length < 10) return false;
  const p = jeton.split(".");
  if (p.length !== 4 || p[0] !== "v1") return false;
  const exp = Number(p[1]);
  if (!Number.isFinite(exp) || exp <= now || exp > now + SESSION_LONGUE + 60_000) return false;
  const a = Buffer.from(p[3]), b = Buffer.from(createHmac("sha256", cleSession()).update(p.slice(0, 3).join(".")).digest("base64url"));
  return a.length === b.length && timingSafeEqual(a, b);
}

const MESSAGES_DEMANDE = {
  invalide: [400, "Lien ou référence invalide. Vérifiez la référence (ex. E8-261118-4R8)."],
  introuvable: [404, "Demande introuvable : lien incorrect, demande reçue avant la mise en service de l'enregistrement automatique, ou supprimée après son délai de conservation. Saisissez-la manuellement."],
  expiree: [410, "Ce lien a expiré : la demande a dépassé son délai de conservation (12 mois après la date du trajet) et a été supprimée."]
};

function store() {
  if (deps.store) return deps.store;
  return getStore({ name: nomMagasin("elev8-factures"), consistency: "strong" });
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

async function envoyerEmail(m) {
  let { to, subject, text, html, fichier, contenu } = m;
  if (estSiteDeTest()) { const d = destinataireTest(to); ({ subject, text, html } = marquerTest({ subject, text, html }, to, d.redirige)); to = d.to || env("MAIL_TO"); }
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

/* Facture d'une réservation payée en ligne : cohérence avec le paiement enregistré (lecture seule).
   - payée par Stripe → mode « paiement en ligne Stripe », facture acquittée, date du paiement et
     référence (pi_…) identiques à celles de Stripe (complétées si vides), total = montant encaissé
     (moins les remboursements partiels) ;
   - remboursée intégralement → aucune facture ;
   - mode Stripe sans paiement Stripe confirmé → refusé.
   Aucun appel à Stripe, aucune modification du dossier de paiement. */
export const MODE_STRIPE = "paiement en ligne Stripe";

/* Devis : règlement réellement prévu pour la réservation (lecture seule du dossier de paiement).
   « auto » → paiement en ligne si un lien Stripe est en cours ou payé, sinon règlement après la prestation.
   Une réservation qui a un lien Stripe actif ne peut pas recevoir un devis annonçant un autre règlement,
   et le total du devis doit être celui du paiement en ligne. */
async function reglementDevis(doc, E) {
  let P = null;
  try { P = doc.ref ? await paiementParRef(magasinPaiements(), doc.ref) : null; } catch { P = null; }
  const actif = P && !["annule", "remplace", "expire"].includes(P.statut) ? P : null;
  const choix = doc.devis.reglement;
  if (!actif) return { reglement: { mode: choix === "auto" ? "apres" : choix } };
  if (choix !== "auto" && choix !== "en_ligne")
    return { erreur: [422, "reglement_stripe", "Cette réservation a un paiement en ligne Stripe (" + P.statut + ") : le devis doit indiquer « Paiement en ligne avant l'attribution du chauffeur » (ou « Automatique »)."] };
  const etat = ["paye", "rembourse_partiel"].includes(P.statut) ? "paye" : P.statut === "rembourse" ? "rembourse" : "a_payer";
  const ttc = Math.round(montants(doc.montant, E, doc.supplements).ttc * 100);
  if (etat !== "rembourse" && ttc !== P.montantCents)
    return { erreur: [422, "reglement_montant", "Le total du devis (" + euros(ttc / 100) + ") diffère du montant du paiement en ligne (" + euros(P.montantCents / 100) + ")."] };
  return { reglement: { mode: "en_ligne", etat, montant: P.montantCents / 100,
    payeLe: P.payeLe ? aujourdhuiParis(Date.parse(P.payeLe)) : "", reference: P.paymentIntent || "",
    valableJusqu: etat === "a_payer" && P.valableJusqu ? aujourdhuiParis(Date.parse(P.valableJusqu)) : "", chauffeur: P.etape === "chauffeur_confirme" } };
}
async function coherenceStripe(doc, E) {
  let P = null;
  try { P = doc.ref ? await paiementParRef(magasinPaiements(), doc.ref) : null; } catch { P = null; }
  const paye = P && P.payeLe && ["paye", "rembourse_partiel", "rembourse"].includes(P.statut) ? P : null;
  const f = doc.facture, stripe = f.modePaiement === MODE_STRIPE;
  if (!paye) return stripe ? { erreur: [422, "stripe_absent", "Aucun paiement Stripe confirmé pour la référence " + doc.ref + " : choisissez un autre mode de paiement."] } : {};
  if (paye.statut === "rembourse") return { erreur: [409, "stripe_rembourse", "Cette réservation a été remboursée intégralement par Stripe : aucune facture n'est à émettre."] };
  if (!stripe) return { erreur: [422, "stripe_mode", "Cette réservation a été payée en ligne par Stripe : le mode de paiement de la facture doit être « Paiement en ligne Stripe »."] };
  if (!f.paye) return { erreur: [422, "stripe_paye", "Cette réservation est payée par Stripe : la facture doit être indiquée comme acquittée (« Paiement reçu »)."] };
  const date = aujourdhuiParis(Date.parse(paye.payeLe));
  if (!f.datePaiement) f.datePaiement = date;
  if (f.datePaiement !== date) return { erreur: [422, "stripe_date", "La date du paiement doit être celle enregistrée par Stripe : " + date.split("-").reverse().join("/") + "."] };
  if (!f.referencePaiement && paye.paymentIntent) f.referencePaiement = paye.paymentIntent;
  if (paye.paymentIntent && f.referencePaiement !== paye.paymentIntent) return { erreur: [422, "stripe_reference", "La référence du paiement doit être celle de Stripe : " + paye.paymentIntent + "."] };
  const encaisse = paye.montantCents - (paye.rembourseCents || 0);
  const ttc = Math.round(montants(doc.montant, E, doc.supplements).ttc * 100);
  if (ttc !== encaisse) return { erreur: [422, "stripe_montant", "Le total de la facture (" + euros(ttc / 100) + ") doit être égal au montant encaissé par Stripe (" + euros(encaisse / 100) + (paye.rembourseCents ? ", après remboursement partiel" : "") + ")."] };
  return {};
}

export default async (req, context) => {
  retenirContexte(context);
  if (req.method !== "POST") return json(405, { ok: false, code: "methode", message: "Méthode non autorisée." });
  const url = new URL(req.url);
  const origin = req.headers.get("origin");
  if (origin && origin !== url.origin && !env("ALLOWED_ORIGINS").split(",").map((x) => x.trim()).includes(origin)) return json(403, { ok: false, code: "origine", message: "Requête refusée : ouvrez la page /documents depuis l'adresse officielle du site." });
  if (env("DOCUMENTS_MOT_DE_PASSE").length < 10) return json(503, { ok: false, code: "ferme", message: "Accès non configuré : créez la variable Netlify DOCUMENTS_MOT_DE_PASSE (10 caractères minimum), puis redéployez." });

  let b;
  try { const raw = await req.text(); if (raw.length > MAX_BODY) return json(413, { ok: false, code: "taille", message: "Données trop volumineuses." }); b = JSON.parse(raw); }
  catch { return json(400, { ok: false, code: "format", message: "Requête illisible. Rechargez la page." }); }
  const ip = (context && context.ip) || req.headers.get("x-nf-client-connection-ip") || "inconnue";
  const now = deps.now();
  if (bloque(ip, now)) return json(429, { ok: false, code: "limite", message: "Trop d'essais. Réessayez dans 15 minutes." });
  const parSession = !!(b && b.session) && b.action !== "connexion";
  if (parSession ? !sessionOk(b.session, now) : !motDePasseOk(b && b.motDePasse)) {
    noterEchec(ip, now);
    return json(401, { ok: false, code: "acces", message: parSession ? "Session expirée : saisissez à nouveau le mot de passe." : "Mot de passe incorrect." });
  }

  /* ----- Chargement d'une demande enregistrée (identifiant opaque du lien, ou référence) ----- */
  if (b.action === "charger") {
    let res;
    try {
      const st = magasinDemandes();
      res = b.id ? await chargerParId(st, b.id, now) : await chargerParRef(st, b.ref, now);
    } catch (e) {
      console.error("Demandes illisibles :", String(e && e.message).slice(0, 60));
      return json(503, { ok: false, code: "stockage", message: "Lecture des demandes momentanément impossible. Réessayez." });
    }
    if (res.erreur) { const [st, msg] = MESSAGES_DEMANDE[res.erreur]; return json(st, { ok: false, code: res.erreur, message: msg }); }
    const r = res.record;
    // Facture déjà émise pour cette référence ? (une seule facture par demande)
    let facture = null;
    try {
      const lien = await store().get("ref/" + r.ref, { type: "json" });
      if (lien && lien.numero) {
        const f = await store().get("facture/" + lien.numero, { type: "json" });
        if (f) facture = { numero: f.numero, dateEmission: f.dateEmission, total: f.montants && f.montants.ttc };
      }
    } catch { /* information facultative */ }
    let paiement = null;
    try { paiement = resumePaiement(await paiementParRef(magasinPaiements(), r.ref)); } catch { /* information facultative */ }
    return json(200, { ok: true, demande: { ref: r.ref, recu: r.recu, client: r.client, prestation: r.prestation, estimation: r.estimation, origine: r.origine }, facture,
      paiement, paiementEnLigne: !!stripeActif() });
  }

  /* ----- Paiement en ligne (Stripe, mode test) : lien après validation manuelle, chauffeur confirmé, annulation ----- */
  if (["paiement-etat", "paiement-lien", "chauffeur-confirme", "annuler-course"].includes(b.action)) {
    const ref = String(b.ref || "").trim().toUpperCase();
    if (!/^E8-[A-Z0-9-]{3,30}$/.test(ref)) return json(400, { ok: false, code: "ref", message: "Référence invalide." });
    if (!stripeActif()) return json(503, { ok: false, code: "stripe", message: "Paiement en ligne non activé (variables Stripe de test absentes)." });
    try {
      let r;
      if (b.action === "paiement-etat") r = { paiement: resumePaiement(await paiementParRef(magasinPaiements(), ref)) };
      else if (b.action === "paiement-lien") r = await creerLienManuel({ ref, montant: Number(String(b.montant).replace(",", ".")), origine: url.origin, envoyerMail: b.envoyerMail === true, now });
      else if (b.action === "chauffeur-confirme") r = await confirmerChauffeur({ ref, chauffeur: b.chauffeur, now });
      else r = await annulerEtRembourser({ ref, motif: b.motif, now });
      if (r.erreur) return json(r.erreur[0], { ok: false, code: "paiement", message: r.erreur[1] });
      return json(200, { ok: true, ...r });
    } catch (e) {
      console.error("Paiement (" + b.action + ") :", String(e && e.message).slice(0, 80));
      return json(502, { ok: false, code: "stripe", message: "Opération impossible pour le moment (Stripe ou stockage). Réessayez ; rien n'a été fait en double." });
    }
  }

  let C;
  try { C = await chargerConfig(url.origin); } catch (e) { console.error("config.js illisible :", String(e && e.message).slice(0, 60)); return json(502, { ok: false, code: "config", message: "Lecture des informations d'ELEV8 (config.js) impossible. Réessayez dans un instant." }); }
  const E = emetteur(C), manque = manquants(E);
  const action = b.action;
  if (action === "connexion") {
    const s = creerSession(now, b.resterConnecte === true ? SESSION_LONGUE : SESSION_COURTE);
    return json(200, { ok: true, session: s.jeton, expire: s.expire, emetteurIncomplet: manque });
  }
  if (action === "verifier") return json(200, { ok: true, emetteurIncomplet: manque });

  if (!["devis", "facture", "envoyer"].includes(action)) return json(400, { ok: false, code: "action", message: "Action inconnue." });
  if (manque.length) return json(422, { ok: false, code: "emetteur", manque,
    message: "Informations légales d'ELEV8 à compléter dans public/config.js (rubrique legal) : " + manque.join(" ; ") + "." });

  const type = action === "envoyer" ? (b.type === "facture" ? "facture" : "devis") : action;
  if (type === "facture" && estSiteDeTest()) {
    // Site de test : aucune facture émise, mais les contrôles de cohérence avec le paiement Stripe sont effectués
    if (action === "facture") { const k = await coherenceStripe(nettoyer(b.doc), E); if (k.erreur) return json(k.erreur[0], { ok: false, code: k.erreur[1], message: k.erreur[2] }); }
    return json(409, { ok: false, code: "site_test", message: "Site de test : aucune facture n'est émise ici (les factures réelles restent sur le site officiel). Contrôle de cohérence avec le paiement : réussi. Le devis reste disponible." });
  }
  if (type === "facture" && E.facturation === "indy")
    return json(409, { ok: false, code: "facturation_indy", message: "Les factures sont établies dans Indy (réglage legal.facturation de config.js) : aucune facture n'est créée ici, pour éviter une double numérotation." });
  const doc = nettoyer(b.doc);
  const st = type === "facture" ? store() : null;

  /* ----- Facture : existante (même référence) ou nouvelle ----- */
  let record = null, nouvelle = false, reglement = null;
  if (type === "facture") {
    try {
      const lien = doc.ref ? await st.get("ref/" + doc.ref, { type: "json" }) : null;
      if (lien && lien.numero) record = await st.get("facture/" + lien.numero, { type: "json" });
    } catch (e) { console.error("Factures illisibles :", String(e && e.message).slice(0, 60)); return json(503, { ok: false, code: "stockage" }); }
    if (!record) {
      if (action === "envoyer") return json(409, { ok: false, code: "non_emise", message: "Générez d'abord la facture." });
      const champs = aCompleter(doc, "facture");
      if (champs.length) return json(422, { ok: false, code: "champs", champs });
      const k = await coherenceStripe(doc, E);
      if (k.erreur) return json(k.erreur[0], { ok: false, code: k.erreur[1], message: k.erreur[2] });
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
    const k = await reglementDevis(doc, E);
    if (k.erreur) return json(k.erreur[0], { ok: false, code: k.erreur[1], message: k.erreur[2] });
    reglement = k.reglement;
  }

  /* ----- PDF ----- */
  const meta = type === "facture"
    ? { numero: record.numero, dateEmission: record.dateEmission, horodatage: record.horodatage, iban: record.iban }
    : { numero: "D-" + doc.ref, dateEmission: aujourdhuiParis(now), horodatage: now, reglement };
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
        (reglement && reglement.mode === "en_ligne"
          ? (provisoire ? "Ce tarif reste à confirmer : après vérification de la disponibilité, vous recevrez un lien de paiement sécurisé. "
                        : reglement.etat === "paye" ? "Votre règlement en ligne a bien été reçu. " : reglement.etat === "rembourse" ? "Le montant réglé vous a été intégralement remboursé. " : "Le règlement s'effectue en ligne, avec le lien de paiement sécurisé transmis par ELEV8, avant l'attribution du chauffeur. ") +
            (reglement.etat === "rembourse" ? "" : "Votre réservation est définitivement confirmée après l'acceptation de la course par un chauffeur ; si aucun chauffeur n'est disponible, le montant réglé vous est intégralement remboursé.")
          : (provisoire ? "Ce tarif reste à confirmer : nous revenons vers vous après vérification de la disponibilité." : "Pour l'accepter, répondez simplement « J'accepte » à ce message.") +
            (reglement && reglement.mode === "virement_avant" ? "\nAprès votre accord, le règlement s'effectue par virement bancaire avant la prestation." : "\nAucun paiement n'est demandé à cette étape.")) +
        `\n\nELEV8 Private Driver\n${E.telephone}`;
    const html = `<!doctype html><html><body style="margin:0;background:#f4efe6;font-family:Helvetica,Arial,sans-serif;color:#1b1814"><div style="max-width:560px;margin:0 auto;padding:28px 22px"><p style="margin:0 0 18px;font:400 22px Georgia,serif;letter-spacing:.2em;color:#8b7650">ELEV8</p>${corps.split("\n").map((l) => `<p style="margin:0 0 ${l ? 8 : 4}px;font-size:15px;line-height:1.5">${esc(l) || "&nbsp;"}</p>`).join("")}</div></body></html>`;
    try { await envoyerEmail({ to, subject: sujet, text: corps, html, fichier, contenu: bytes }); }
    catch (e) { console.error("Envoi du document impossible :", String(e && e.message).slice(0, 60)); return json(502, { ok: false, code: "envoi", message: "Envoi impossible pour le moment. Téléchargez le PDF et envoyez-le vous-même." }); }
    return json(200, { ok: true, envoye: to, numero: meta.numero });
  }

  return json(200, { ok: true, type, numero: meta.numero, dateEmission: meta.dateEmission, fichier, total,
    deja: type === "facture" && !nouvelle, pdf: Buffer.from(bytes).toString("base64") });
};
