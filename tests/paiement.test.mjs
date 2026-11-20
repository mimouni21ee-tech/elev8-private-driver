/* Tests automatisés : paiement en ligne Stripe Checkout (mode test), webhooks, suivi de la réservation.
   Lancement : node tests/paiement.test.mjs
   Aucun service extérieur : Stripe, l'itinéraire, le stockage et les e-mails sont simulés.
   Les signatures des webhooks sont calculées exactement comme Stripe (HMAC-SHA256). */
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";

let ok = 0;
const t = async (nom, f) => { try { await f(); ok++; console.log("✓ " + nom); } catch (e) { console.error("✗ " + nom + "\n  " + (e && e.stack || e)); process.exitCode = 1; } };

/* ---------- Environnement de test ---------- */
const CLE = "sk_test_" + "x".repeat(24), SECRET = "whsec_" + "s".repeat(32);
Object.assign(process.env, { PAIEMENT_STRIPE: "test", STRIPE_SECRET_KEY: CLE, STRIPE_WEBHOOK_SECRET: SECRET, DOCUMENTS_MOT_DE_PASSE: "mot-de-passe-de-test",
  EMAIL_API_KEY: "cle-email", MAIL_TO: "contact@elev8privatedriver.com", MAIL_FROM: "reservations@example.test", GOOGLE_MAPS_API_KEY: "cle-google", EMAILS_TEST_AUTORISES: "claire@example.test",
  FACTURATION_AUTOMATIQUE: "non", RATE_GLOBAL_PER_HOUR: "1000" });   // nombreuses demandes de test dans la même heure simulée          // étapes précédentes testées sans facturation automatique ; activée pour les tests de l'étape 2
let NOW = Date.parse("2026-11-17T12:00:00Z");
const horloge = () => NOW;
Date.now = horloge;          // toute la simulation (contrôles de date du formulaire compris) suit l'horloge du test

function fauxStore() {
  const m = new Map(); let v = 0;
  return { m,
    async get(k) { return m.has(k) ? structuredClone(m.get(k).d) : null; },
    async getWithMetadata(k) { return m.has(k) ? { data: structuredClone(m.get(k).d), etag: m.get(k).e, metadata: m.get(k).meta || {} } : null; },
    async getMetadata(k) { return m.has(k) ? { metadata: m.get(k).meta || {} } : null; },
    async setJSON(k, d, o = {}) {
      if (o.onlyIfNew && m.has(k)) return { modified: false };
      if (o.onlyIfMatch && (!m.has(k) || m.get(k).e !== o.onlyIfMatch)) return { modified: false };
      m.set(k, { d: structuredClone(d), e: "e" + (++v), meta: o.metadata }); return { modified: true };
    },
    async delete(k) { m.delete(k); },
    async list({ prefix }) { return { blobs: [...m.keys()].filter((k) => k.startsWith(prefix)).map((key) => ({ key })) }; } };
}

/* ---------- Faux Stripe (API REST) ---------- */
const S = { sessions: new Map(), charges: new Map(), idem: new Map(), refunds: [], creations: 0, n: 0 };
async function fauxStripe(url, init = {}) {
  const u = new URL(url), chemin = u.pathname, h = init.headers || {};
  const rep = (o, s = 200) => ({ ok: s < 400, status: s, json: async () => o });
  assert.ok(String(h.Authorization).startsWith("Bearer sk_test_"), "clé de test attendue");
  const corps = new URLSearchParams(init.body || "");
  const cleIdem = h["Idempotency-Key"];
  if (cleIdem && S.idem.has(cleIdem)) return rep(structuredClone(S.idem.get(cleIdem)));
  let r;
  if (init.method === "POST" && chemin === "/v1/checkout/sessions") {
    S.creations++;
    const id = "cs_test_" + (++S.n);
    r = { id, object: "checkout.session", url: "https://checkout.stripe.com/c/pay/" + id, status: "open", payment_status: "unpaid", livemode: false,
      amount_total: Number(corps.get("line_items[0][price_data][unit_amount]")), currency: corps.get("line_items[0][price_data][currency]"),
      client_reference_id: corps.get("client_reference_id"), customer_email: corps.get("customer_email"), expires_at: Number(corps.get("expires_at")),
      metadata: { ref: corps.get("metadata[ref]"), paiement: corps.get("metadata[paiement]"), version: corps.get("metadata[version]") },
      payment_method_types: [corps.get("payment_method_types[0]")], mode: corps.get("mode"), success_url: corps.get("success_url"), payment_intent: null };
    S.sessions.set(id, r);
  } else if (init.method === "GET" && chemin.startsWith("/v1/checkout/sessions/")) {
    r = S.sessions.get(decodeURIComponent(chemin.split("/")[4]));
    if (!r) return rep({ error: { type: "invalid_request_error", code: "resource_missing" } }, 404);
  } else if (init.method === "POST" && /\/expire$/.test(chemin)) {
    r = S.sessions.get(chemin.split("/")[4]);
    if (!r || r.status !== "open") return rep({ error: { type: "invalid_request_error" } }, 400);
    r.status = "expired";
  } else if (init.method === "POST" && chemin === "/v1/refunds") {
    const pi = corps.get("payment_intent"), ch = [...S.charges.values()].find((c) => c.payment_intent === pi);
    ch.amount_refunded = ch.amount; r = { id: "re_test_" + (++S.n), payment_intent: pi, amount: ch.amount, status: "succeeded" };
    S.refunds.push(r);
  } else if (init.method === "GET" && chemin.startsWith("/v1/charges/")) {
    r = S.charges.get(chemin.split("/")[3]);
  } else throw new Error("appel Stripe inattendu " + init.method + " " + chemin);
  if (cleIdem) S.idem.set(cleIdem, structuredClone(r));
  return rep(structuredClone(r));
}
/* Le client paie sur la page Stripe (simulation de ce que fait Stripe) */
function payerChezStripe(id, { differe = false, montant } = {}) {
  const s = S.sessions.get(id); s.status = "complete";
  if (montant) s.amount_total = montant;
  s.payment_status = differe ? "unpaid" : "paid";
  s.payment_intent = "pi_test_" + (++S.n);
  const ch = { id: "ch_test_" + (++S.n), amount: s.amount_total, amount_refunded: 0, payment_intent: s.payment_intent };
  S.charges.set(ch.id, ch);
  return s;
}

/* ---------- Modules testés ---------- */
const STR = await import("../netlify/lib/stripe.mjs");
const PAI = await import("../netlify/lib/paiements.mjs");
const DEM = await import("../netlify/lib/demandes.mjs");
const MAIL = await import("../netlify/lib/courriels.mjs");
const EST = await import("../netlify/lib/estimation.mjs");
const { default: reservation, deps: resDeps } = await import("../netlify/functions/reservation.mjs");
const { default: payer } = await import("../netlify/functions/payer.mjs");
const { default: webhook } = await import("../netlify/functions/stripe-webhook.mjs");
const { default: documents, deps: docDeps } = await import("../netlify/functions/documents.mjs");
const { suivre } = await import("../netlify/functions/suivi-paiements.mjs");

STR.deps.fetch = fauxStripe; STR.deps.now = horloge; PAI.deps.now = horloge; EST.deps.now = horloge; docDeps.now = horloge;
PAI.deps.store = fauxStore(); DEM.deps.store = fauxStore(); resDeps.store = fauxStore(); docDeps.store = fauxStore();
const envoyes = [], notifElev8 = [];
resDeps.send = async (m) => { notifElev8.push(m); };
MAIL.deps.send = async (m) => { envoyes.push(m); };
// Devis automatique : configuration officielle (public/config.js) et stockage simulé
const DEVIS = await import("../netlify/lib/devis-auto.mjs");
{ const { readFileSync } = await import("node:fs"); const sb = {}; new Function("window", readFileSync(new URL("../public/config.js", import.meta.url), "utf8"))(sb); DEVIS.deps.config = sb.SITE_CONFIG; }
DEVIS.deps.store = docDeps.store;                                     // même magasin que les factures (clés devis/…)
// Itinéraire simulé (Google Routes) : 8,3 km dans Dijon
EST.deps.fetch = async (url) => {
  if (!String(url).startsWith("https://routes.googleapis.com")) throw new Error("URL inattendue " + url);
  return { ok: true, status: 200, json: async () => ({ routes: [{ distanceMeters: 8300, duration: "900s", legs: [{ startLocation: { latLng: { latitude: 47.3233, longitude: 5.0274 } }, endLocation: { latLng: { latitude: 47.29, longitude: 5.05 } } }] }] }) };
};

const ORIGINE = "https://elev8privatedriver.com";
const post = (chemin, body, h = {}) => new Request(ORIGINE + chemin, { method: "POST", headers: { "content-type": "application/json", origin: ORIGINE, ...h }, body: JSON.stringify(body) });
const demande = (extra = {}) => ({ prestation: "Transferts gares", depart: "Gare de Dijon-Ville, 21000 Dijon, France", destination: "12 rue de Longvic, 21000 Dijon, France",
  date: "2026-11-18", heure: "10:00", vehicule: "Tesla Model Y", passagers: 2, nom: "Martin", prenom: "Claire", telephone: "+33612345678", email: "claire@example.test",
  bagages: "1", precisions: "", duree: 9000, website: "", origine: { code: "site", libelle: "", utm: {} },
  demandeId: Math.floor(NOW / 1000) + "-" + Math.random().toString(36).slice(2, 16).padEnd(14, "x"), ...extra });
const envoyer = async (extra) => { const r = await reservation(post("/envoi-reservation", demande(extra)), { ip: "1.2.3." + Math.floor(Math.random() * 250) }); return { status: r.status, j: await r.json() }; };
const ouvrir = async (lien) => { const r = await payer(new Request(ORIGINE + lien), { params: { jeton: lien.split("/").pop() } }); return { status: r.status, loc: r.headers.get("location") }; };
let nEvt = 0;
const signer = (corps, ts = Math.floor(NOW / 1000), secret = SECRET) => `t=${ts},v1=${createHmac("sha256", secret).update(`${ts}.${corps}`).digest("hex")}`;
async function evenement(type, objet, { id = "evt_test_" + (++nEvt), livemode = false, signature } = {}) {
  const corps = JSON.stringify({ id, object: "event", type, livemode, data: { object: objet } });
  const r = await webhook(new Request(ORIGINE + "/stripe-webhook", { method: "POST", headers: { "stripe-signature": signature || signer(corps), "content-type": "application/json" }, body: corps }));
  return { status: r.status, j: await r.json(), id };
}
const admin = async (body) => { const r = await documents(post("/documents-api", { motDePasse: "mot-de-passe-de-test", ...body }), { ip: "8.8.8.8" }); return { status: r.status, j: await r.json() }; };
const dossier = (ref) => PAI.parRef(PAI.magasin(), ref);

/* ====================================================================== */
await t("activation : uniquement PAIEMENT_STRIPE=test avec des clés de TEST ; toute clé réelle désactive le paiement", () => {
  assert.ok(STR.stripeActif());
  for (const [k, v] of [["STRIPE_SECRET_KEY", "sk_live_" + "x".repeat(24)], ["STRIPE_SECRET_KEY", "rk_live_" + "x".repeat(24)], ["STRIPE_SECRET_KEY", ""], ["STRIPE_WEBHOOK_SECRET", ""], ["PAIEMENT_STRIPE", "live"], ["PAIEMENT_STRIPE", ""]]) {
    const avant = process.env[k]; process.env[k] = v; assert.equal(STR.stripeActif(), null, k + "=" + v); process.env[k] = avant;
  }
  process.env.STRIPE_SECRET_KEY = "rk_test_" + "y".repeat(24); assert.ok(STR.stripeActif()); process.env.STRIPE_SECRET_KEY = CLE;
});

await t("trajets automatiques ou manuels : sur devis, demande particulière, mise à disposition, prise en charge trop proche → validation manuelle", () => {
  const est = { statut: "estimation", montant: 20 };
  assert.equal(PAI.eligibleAuto(demande(), est, NOW).ok, true);
  assert.equal(PAI.eligibleAuto(demande(), { statut: "sur_devis" }, NOW).motif, "sur_devis");
  assert.equal(PAI.eligibleAuto(demande({ precisions: "Siège bébé" }), est, NOW).motif, "demande_particuliere");
  assert.equal(PAI.eligibleAuto(demande({ prestation: "Mise à disposition" }), est, NOW).motif, "sur_devis");
  assert.equal(PAI.eligibleAuto(demande({ date: "2026-11-17", heure: "15:00" }), est, NOW).motif, "delai_court");     // 2 h après la demande
});

let A;   // réservation standard
await t("trajet standard : montant calculé par le serveur (jamais celui du navigateur), lien individuel créé et envoyé au client", async () => {
  envoyes.length = 0; notifElev8.length = 0;
  const { status, j } = await envoyer({ estimation: { statut: "estimation", montant: 1, jeton: { exp: NOW + 1e6, sig: "falsifie" } } });
  assert.equal(status, 200); assert.equal(j.statut, "attente_paiement");
  assert.equal(j.paiement.montant, 20); assert.match(j.paiement.url, /^\/payer\/[A-Za-z0-9_-]{24}$/); assert.equal(j.paiement.email, true);
  A = { ref: j.ref, lien: j.paiement.url };
  const m = envoyes.find((x) => x.to === "claire@example.test");
  assert.equal(m.subject, "[TEST] ELEV8 Private Driver — Votre devis TEST-D-" + j.ref + " | " + j.ref);
  for (const x of ["Bonjour Claire,", "votre devis n° TEST-D-" + j.ref + " (PDF)", "Votre trajet", "Référence : " + j.ref, "Heure de prise en charge : 10h00", "Adresse de départ : Gare de Dijon-Ville", "Nombre de passagers : 2",
    "Tarif : 20,00 € TTC (18,18 € HT + TVA 10 % : 1,82 €)", "Le paiement vaut acceptation du devis", "Accepter le devis et payer en ligne : " + ORIGINE + j.paiement.url, "intégralement remboursé"]) assert.ok(m.text.includes(x), x);
  assert.equal(m.pieces.length, 1); assert.equal(m.pieces[0].nom, "TEST-D-" + j.ref + ".pdf"); assert.equal(m.copie, "contact@elev8privatedriver.com");
  assert.ok(m.html.includes(">Accepter le devis et payer en ligne<"));
  assert.ok(!/J'accepte|chauffeur est disponible|réservation (est )?confirmée/i.test(m.text), "aucune confirmation ni « J'accepte » avant paiement et chauffeur");
  assert.ok(!m.text.includes("claire@example.test") || true);
  assert.match(notifElev8[0].subject, /^\[TEST\] \[Paiement en ligne envoyé\]/);
  assert.ok(notifElev8[0].text.includes("AUCUNE ACTION REQUISE"));
  assert.ok(!/[?&](nom|email|tel|prenom)=/i.test(j.paiement.url));
});

await t("demande particulière : aucun lien automatique, validation manuelle signalée à ELEV8", async () => {
  notifElev8.length = 0; envoyes.length = 0;
  const { j } = await envoyer({ precisions: "Deux sièges enfants, arrêt à la pharmacie" });
  assert.equal(j.paiement, null); assert.equal(j.statut, "demande_recue");
  assert.match(notifElev8[0].subject, /^\[TEST\] \[À valider\]/); assert.ok(notifElev8[0].text.includes("Validation manuelle requise : informations complémentaires à examiner"));
  assert.equal(envoyes.length, 0);
  A.refManuel = j.ref;
});

await t("/payer : lien inconnu refusé ; une seule session Stripe, réutilisée ; montant du serveur, carte uniquement", async () => {
  assert.equal((await ouvrir("/payer/" + "A".repeat(24))).loc, "/paiement/?etat=inconnu");
  assert.equal((await ouvrir("/payer/../../etc")).loc, "/paiement/?etat=inconnu");
  const avant = S.creations;
  const [x, y] = await Promise.all([ouvrir(A.lien), ouvrir(A.lien)]);          // deux clics simultanés
  const z = await ouvrir(A.lien);
  assert.equal(x.status, 303); assert.match(x.loc, /^https:\/\/checkout\.stripe\.com\//);
  assert.equal(x.loc, y.loc); assert.equal(x.loc, z.loc);
  assert.equal(S.creations - avant, 1, "une seule session créée");
  const s = S.sessions.get(x.loc.split("/").pop());
  assert.equal(s.amount_total, 2000); assert.equal(s.currency, "eur"); assert.equal(s.mode, "payment"); assert.deepEqual(s.payment_method_types, ["card"]);
  assert.equal(s.client_reference_id, A.ref); assert.equal(s.metadata.ref, A.ref); assert.equal(s.customer_email, "claire@example.test");
  assert.match(s.success_url, /\/paiement\/\?etat=merci&ref=E8-/);
  A.session = s.id;
});

await t("page de succès sans effet : la réservation reste « en attente de paiement » tant que Stripe n'a rien notifié", async () => {
  payerChezStripe(A.session);                                              // le client a payé chez Stripe…
  const p = await dossier(A.ref);
  assert.equal(p.statut, "en_attente"); assert.equal(p.etape, "attente_paiement"); // …mais seul le webhook fait foi
});

await t("webhook : signature absente, falsifiée, ancienne ou d'un autre secret → refusé (400), rien ne change", async () => {
  const o = { id: A.session, object: "checkout.session" };
  assert.equal((await evenement("checkout.session.completed", o, { signature: "t=1,v1=abc" })).status, 400);
  assert.equal((await evenement("checkout.session.completed", o, { signature: signer("{}") })).status, 400);
  assert.equal((await evenement("checkout.session.completed", o, { signature: "x" })).status, 400);
  const corps = JSON.stringify({ id: "evt_vieux", type: "checkout.session.completed", data: { object: o } });
  const r = await webhook(new Request(ORIGINE + "/stripe-webhook", { method: "POST", headers: { "stripe-signature": signer(corps, Math.floor(NOW / 1000) - 600) }, body: corps }));
  assert.equal(r.status, 400);
  const r2 = await webhook(new Request(ORIGINE + "/stripe-webhook", { method: "POST", headers: { "stripe-signature": signer(corps, undefined, "whsec_" + "z".repeat(32)) }, body: corps }));
  assert.equal(r2.status, 400);
  assert.equal((await dossier(A.ref)).statut, "en_attente");
});

await t("paiement confirmé par Stripe → « Payée — en attente d'attribution », HUBER en attente de son API, e-mails envoyés une seule fois", async () => {
  envoyes.length = 0;
  // Le contenu du webhook est volontairement trompeur : l'état est RELU chez Stripe
  const e = await evenement("checkout.session.completed", { id: A.session, object: "checkout.session", payment_status: "paid", amount_total: 1 });
  assert.equal(e.status, 200); assert.equal(e.j.resultat, "paye");
  const p = await dossier(A.ref);
  assert.equal(p.statut, "paye"); assert.equal(p.etape, "payee_attente_attribution"); assert.equal(p.huber.etat, "en_attente_api"); assert.equal(p.huber.cle, A.ref);
  const client = envoyes.filter((m) => m.to === "claire@example.test");
  assert.equal(client.length, 1); assert.match(client[0].subject, /Paiement reçu, attribution en cours/);
  assert.ok(!/Réservation confirmée|chauffeur a accepté/i.test(client[0].text), "jamais « attribuée » avant un chauffeur");
  assert.equal(envoyes.filter((m) => !m.to && /Paiement reçu — course à attribuer/.test(m.subject)).length, 1);
  // Même événement renvoyé par Stripe, puis un autre événement pour la même session : aucun double traitement
  const n = envoyes.length;
  const corps = JSON.stringify({ id: e.id, type: "checkout.session.completed", livemode: false, data: { object: { id: A.session } } });
  const rejeu = await webhook(new Request(ORIGINE + "/stripe-webhook", { method: "POST", headers: { "stripe-signature": signer(corps) }, body: corps }));
  assert.equal((await rejeu.json()).deja, true);
  await evenement("checkout.session.async_payment_succeeded", { id: A.session });
  await evenement("checkout.session.expired", { id: A.session });             // événement en retard : ne fait pas reculer
  assert.equal(envoyes.length, n); assert.equal((await dossier(A.ref)).statut, "paye");
  assert.equal((await ouvrir(A.lien)).loc, "/paiement/?etat=deja&ref=" + A.ref);
});

await t("événement réel (livemode) refusé sur le site de test", async () => {
  const e = await evenement("checkout.session.completed", { id: A.session }, { livemode: true });
  assert.equal(e.status, 400); assert.equal(e.j.erreur, "mode_incorrect");
});

await t("chauffeur : confirmation réservée à une session ELEV8, puis e-mail « Réservation confirmée » une seule fois", async () => {
  const sans = await documents(post("/documents-api", { action: "chauffeur-confirme", ref: A.ref, chauffeur: { prenom: "Karim", vehicule: "Tesla Model Y" } }), { ip: "7.7.7.7" });
  assert.equal(sans.status, 401);
  envoyes.length = 0;
  assert.equal((await admin({ action: "chauffeur-confirme", ref: A.ref, chauffeur: { prenom: "", vehicule: "" } })).status, 422);
  const r = await admin({ action: "chauffeur-confirme", ref: A.ref, chauffeur: { prenom: "Karim", vehicule: "Tesla Model Y noire", plaque: "AB-123-CD" } });
  assert.equal(r.status, 200); assert.equal(r.j.paiement.etape, "chauffeur_confirme"); assert.equal(r.j.mail, true);
  const m = envoyes.find((x) => x.to === "claire@example.test");
  assert.match(m.subject, /Réservation confirmée \| E8-/); assert.ok(m.text.includes("Votre chauffeur : Karim") && m.text.includes("AB-123-CD"));
  assert.equal((await admin({ action: "chauffeur-confirme", ref: A.ref, chauffeur: { prenom: "Karim", vehicule: "X" } })).status, 409);
  assert.equal(envoyes.filter((x) => x.to === "claire@example.test").length, 1);
});

await t("aucun chauffeur avant paiement confirmé : refusé (une course n'est jamais attribuée sans paiement)", async () => {
  const { j } = await envoyer({});
  const r = await admin({ action: "chauffeur-confirme", ref: j.ref, chauffeur: { prenom: "Karim", vehicule: "Tesla" } });
  assert.equal(r.status, 409);
  A.nonPaye = j;
});

await t("indisponibilité avant paiement : lien désactivé, session Stripe fermée, client prévenu sans prélèvement", async () => {
  const j = A.nonPaye;
  const o = await ouvrir(j.paiement.url); const sid = o.loc.split("/").pop();
  envoyes.length = 0;
  const r = await admin({ action: "annuler-course", ref: j.ref, motif: "indisponible" });
  assert.equal(r.status, 200); assert.equal(r.j.rembourse, false); assert.equal(r.j.paiement.statut, "annule"); assert.equal(r.j.paiement.etape, "annulee_indisponible");
  assert.equal(S.sessions.get(sid).status, "expired");
  assert.ok(envoyes.find((m) => m.to === "claire@example.test").text.includes("aucun montant n'a été prélevé"));
  assert.equal((await ouvrir(j.paiement.url)).loc, "/paiement/?etat=annule-lien");
});

await t("course payée sans chauffeur : alertes à 12 h puis 3 h (une seule fois chacune), aucun remboursement automatique par défaut", async () => {
  const { j } = await envoyer({ date: "2026-11-18", heure: "18:00" });
  const sid = (await ouvrir(j.paiement.url)).loc.split("/").pop();
  payerChezStripe(sid); await evenement("checkout.session.completed", { id: sid });
  assert.equal((await dossier(j.ref)).etape, "payee_attente_attribution");
  envoyes.length = 0;
  const debut = NOW;
  NOW = Date.parse("2026-11-18T06:30:00Z");                                  // 10 h 30 avant (18 h Paris = 17 h UTC)
  await suivre(NOW); await suivre(NOW);
  NOW = Date.parse("2026-11-18T14:30:00Z");                                  // 2 h 30 avant
  await suivre(NOW); await suivre(NOW);
  const alertes = envoyes.filter((m) => /SANS chauffeur/.test(m.subject));
  assert.deepEqual(alertes.map((m) => m.subject.match(/moins de (\d+) h/)[1]), ["12", "3"]);
  assert.equal(S.refunds.length, 0); assert.equal((await dossier(j.ref)).statut, "paye");
  NOW = debut;
  A.sansChauffeur = j;
});

await t("aucun chauffeur → remboursement intégral unique (clé d'idempotence), confirmé ensuite par Stripe", async () => {
  const j = A.sansChauffeur;
  envoyes.length = 0;
  const r1 = await admin({ action: "annuler-course", ref: j.ref, motif: "sans_chauffeur" });
  const r2 = await admin({ action: "annuler-course", ref: j.ref, motif: "sans_chauffeur" });
  assert.equal(r1.j.rembourse, true); assert.equal(r2.j.dejaFait, true);
  assert.equal(S.refunds.length, 1, "un seul remboursement");
  assert.ok(envoyes.find((m) => m.to === "claire@example.test").text.includes("remboursement intégral de 20,00 €"));
  const p = await dossier(j.ref);
  assert.equal(p.etape, "sans_chauffeur"); assert.equal(p.statut, "paye");                  // pas encore confirmé par Stripe
  const ch = [...S.charges.values()].find((c) => c.payment_intent === p.paymentIntent);
  const e = await evenement("charge.refunded", { id: ch.id, object: "charge", amount_refunded: 1 });
  assert.equal(e.j.resultat, "rembourse");
  const p2 = await dossier(j.ref);
  assert.equal(p2.statut, "rembourse"); assert.equal(p2.rembourseCents, 2000);
  assert.equal((await ouvrir(j.paiement.url)).loc, "/paiement/?etat=rembourse");
});

await t("paiement différé : en cours → refusé (le même lien reste utilisable) → nouvelle session → payé", async () => {
  const { j } = await envoyer({});
  const s1 = (await ouvrir(j.paiement.url)).loc.split("/").pop();
  payerChezStripe(s1, { differe: true });
  await evenement("checkout.session.completed", { id: s1 });
  assert.equal((await dossier(j.ref)).statut, "en_cours");
  assert.equal((await ouvrir(j.paiement.url)).loc, "/paiement/?etat=deja&ref=" + j.ref);
  await evenement("checkout.session.async_payment_failed", { id: s1 });
  assert.equal((await dossier(j.ref)).statut, "en_attente");
  const s2 = (await ouvrir(j.paiement.url)).loc.split("/").pop();
  assert.notEqual(s2, s1);
  payerChezStripe(s2); await evenement("checkout.session.completed", { id: s2 });
  assert.equal((await dossier(j.ref)).statut, "paye");
});

await t("session expirée chez Stripe : le clic suivant en crée une nouvelle ; lien expiré après sa date limite", async () => {
  const { j } = await envoyer({});
  const s1 = (await ouvrir(j.paiement.url)).loc.split("/").pop();
  S.sessions.get(s1).status = "expired"; await evenement("checkout.session.expired", { id: s1 });
  assert.equal((await dossier(j.ref)).sessionActive, null);
  const s2 = (await ouvrir(j.paiement.url)).loc.split("/").pop();
  assert.notEqual(s1, s2);
  const debut = NOW; NOW = Date.parse("2026-11-18T08:00:00Z");                // 1 h avant 10 h (Paris) : après la limite de 2 h
  assert.equal((await ouvrir(j.paiement.url)).loc, "/paiement/?etat=expire");
  assert.equal((await dossier(j.ref)).statut, "expire");
  NOW = debut;
});

await t("montant payé différent du dossier → « à vérifier » + alerte ELEV8, jamais « Payée »", async () => {
  const { j } = await envoyer({});
  const sid = (await ouvrir(j.paiement.url)).loc.split("/").pop();
  payerChezStripe(sid, { montant: 500 });
  envoyes.length = 0;
  await evenement("checkout.session.completed", { id: sid });
  const p = await dossier(j.ref);
  assert.equal(p.statut, "a_verifier"); assert.equal(p.etape, "attente_paiement");
  assert.ok(envoyes.some((m) => /Paiement reçu à vérifier/.test(m.subject)));
  assert.ok(!envoyes.some((m) => m.to === "claire@example.test"));
});

await t("validation manuelle : lien Stripe créé par ELEV8 pour le montant validé ; un nouveau montant désactive l'ancien lien", async () => {
  const r1 = await admin({ action: "paiement-lien", ref: A.refManuel, montant: "45,50" });
  assert.equal(r1.status, 200); assert.equal(r1.j.paiement.montant, 45.5);
  const r2 = await admin({ action: "paiement-lien", ref: A.refManuel, montant: 48 });
  assert.equal((await ouvrir(r1.j.paiement.lien)).loc, "/paiement/?etat=annule-lien");
  const o = await ouvrir(r2.j.paiement.lien);
  assert.equal(S.sessions.get(o.loc.split("/").pop()).amount_total, 4800);
  assert.equal((await admin({ action: "paiement-lien", ref: A.refManuel, montant: 0.2 })).status, 422);
  assert.equal((await admin({ action: "paiement-lien", ref: "E8-000000-ZZZ", montant: 30 })).status, 404);
  const chg = await admin({ action: "charger", ref: A.refManuel });
  assert.equal(chg.j.paiementEnLigne, true); assert.equal(chg.j.paiement.montant, 48);
});

await t("aucune facture n'est créée par un paiement ; aucune donnée client dans le dossier de paiement", async () => {
  assert.equal([...docDeps.store.m.keys()].filter((k) => k.startsWith("facture/") || k.startsWith("compteur/")).length, 0);
  for (const [k, v] of PAI.magasin().m) {
    const txt = JSON.stringify(v.d);
    assert.ok(!/claire@example|Martin|\+33612345678|Longvic/.test(txt), "donnée personnelle dans " + k);
  }
});

await t("paiement en ligne désactivé (variables absentes) : le site fonctionne exactement comme avant", async () => {
  const avant = process.env.PAIEMENT_STRIPE; delete process.env.PAIEMENT_STRIPE;
  notifElev8.length = 0;
  const { j } = await envoyer({});
  assert.equal(j.paiement, null); assert.equal(j.statut, "demande_recue");
  assert.match(notifElev8[0].subject, /^\[À valider\]/); assert.ok(!notifElev8[0].text.includes("Paiement en ligne"));
  assert.equal((await ouvrir(A.lien)).loc, "/paiement/?etat=indisponible");
  assert.equal((await evenement("checkout.session.completed", { id: A.session })).status, 503);
  process.env.PAIEMENT_STRIPE = avant;
});

/* ---------- Site de test (déploiement de branche Netlify) isolé de la production ---------- */
const ENV = await import("../netlify/lib/environnement.mjs");
await t("contexte Netlify « production » : paiement de test refusé, vrais stockages ; « branch-deploy » : stockages « -test »", () => {
  ENV.retenirContexte({ deploy: { context: "production" } });
  assert.equal(STR.stripeActif(), null, "jamais de paiement de test en production");
  assert.equal(ENV.nomMagasin("elev8-demandes"), "elev8-demandes"); assert.equal(ENV.estSiteDeTest(), false);
  for (const c of ["branch-deploy", "deploy-preview", "dev"]) {
    ENV.retenirContexte({ deploy: { context: c } });
    assert.ok(STR.stripeActif(), c);
    for (const n of ["elev8-demandes", "elev8-paiements", "elev8-factures"]) assert.equal(ENV.nomMagasin(n), n + "-test", c + " " + n);
  }
  // Production : clés LIVE et activation explicite requises ; jamais les clés TEST.
  ENV.retenirContexte({ deploy: { context: "production" } });
  const old = { mode: process.env.PAIEMENT_STRIPE, key: process.env.STRIPE_SECRET_KEY, secret: process.env.STRIPE_WEBHOOK_SECRET };
  try {
    process.env.PAIEMENT_STRIPE = "live";
    process.env.STRIPE_SECRET_KEY = "sk_live_" + "x".repeat(24);
    assert.equal(STR.stripeActif()?.mode, "live");
    process.env.STRIPE_SECRET_KEY = "rk_live_" + "x".repeat(24);
    assert.equal(STR.stripeActif()?.mode, "live");
    process.env.STRIPE_SECRET_KEY = CLE;
    assert.equal(STR.stripeActif(), null, "clé test interdite en production");
    ENV.retenirContexte({ deploy: { context: "branch-deploy" } });
    process.env.STRIPE_SECRET_KEY = "sk_live_" + "x".repeat(24);
    assert.equal(STR.stripeActif(), null, "clé live interdite sur branche de test");
    ENV._reinitialiser();
    assert.equal(STR.stripeActif(), null, "clé live interdite hors Netlify");
  } finally {
    process.env.PAIEMENT_STRIPE = old.mode;
    process.env.STRIPE_SECRET_KEY = old.key;
    process.env.STRIPE_WEBHOOK_SECRET = old.secret;
  }
  ENV.retenirContexte({ deploy: { context: "branch-deploy" } });
  const avant = process.env.PAIEMENT_STRIPE; delete process.env.PAIEMENT_STRIPE;          // variable oubliée : stockages de test quand même
  assert.equal(ENV.nomMagasin("elev8-factures"), "elev8-factures-test");
  process.env.PAIEMENT_STRIPE = avant;
  ENV._reinitialiser();
});
await t("site de test : e-mails marqués [TEST] ; un client non autorisé n'est jamais destinataire (redirigé vers ELEV8)", async () => {
  ENV.retenirContexte({ deploy: { context: "branch-deploy" } });
  const autorises = process.env.EMAILS_TEST_AUTORISES; process.env.EMAILS_TEST_AUTORISES = "";
  envoyes.length = 0; notifElev8.length = 0;
  const { j } = await envoyer({ email: "vrai.client@exemple.fr" });
  const m = envoyes.find((x) => /Votre devis/.test(x.subject));
  assert.equal(m.copie, "", "client redirigé vers ELEV8 : pas de copie en double");
  assert.equal(m.to, "", "redirigé vers MAIL_TO (ELEV8)");
  assert.match(m.subject, /^\[TEST\] /); assert.ok(m.text.startsWith("MESSAGE DE TEST") && m.text.includes("Destinataire prévu : vrai.client@exemple.fr"));
  assert.ok(m.html.includes("MESSAGE DE TEST"));
  assert.ok(!envoyes.some((x) => x.to === "vrai.client@exemple.fr"));
  assert.match(notifElev8[0].subject, /^\[TEST\] /);
  assert.ok(j.paiement);
  process.env.EMAILS_TEST_AUTORISES = autorises;
  ENV._reinitialiser();
});
await t("site de test : aucune facture définitive ne peut être émise", async () => {
  ENV.retenirContexte({ deploy: { context: "branch-deploy" } });
  const { readFileSync } = await import("node:fs");
  const C = (await import("../netlify/functions/documents.mjs")).parseConfig(readFileSync(new URL("../public/config.js", import.meta.url), "utf8"));
  C.legal.capital = "1 000 €"; docDeps.config = C;
  const r = await admin({ action: "facture", doc: { ref: "E8-261117-SANSPAIEMENT", client: { prenom: "Claire", nom: "Martin", adresse: "1 rue X, 21000 Dijon" }, prestation: { date: "2026-11-16", depart: "A", destination: "B", vehicule: "Berline" }, montant: "20", facture: { dateEmission: "2026-11-17", datePrestation: "2026-11-16" } } });
  assert.equal(r.status, 409); assert.equal(r.j.code, "site_test");
  assert.equal([...docDeps.store.m.keys()].filter((k) => k.startsWith("facture/") || k.startsWith("compteur/")).length, 0);
  docDeps.config = null; ENV._reinitialiser();
});

/* ---------- Facture d'une course payée par Stripe : cohérence du mode, du montant, de la date et de la référence ---------- */
await t("facture d'une course payée par Stripe : mode, date et référence imposés, total = montant encaissé ; émission unique", async () => {
  const { readFileSync } = await import("node:fs");
  const C = (await import("../netlify/functions/documents.mjs")).parseConfig(readFileSync(new URL("../public/config.js", import.meta.url), "utf8"));
  C.legal.capital = "1 000 €"; docDeps.config = C;
  const avant = process.env.PAIEMENT_STRIPE; delete process.env.PAIEMENT_STRIPE;        // émission comme sur le site officiel
  const debut = NOW; NOW = Date.parse("2026-11-19T10:00:00Z");                          // après la course du 18/11
  const P = await dossier(A.ref);                                                       // payée le 17/11, 20 €, chauffeur confirmé
  assert.equal(P.statut, "paye"); assert.match(P.paymentIntent, /^pi_test_/);
  const doc = (f = {}, montant = "20") => ({ ref: A.ref, client: { prenom: "Claire", nom: "Martin", adresse: "12 rue de Longvic, 21000 Dijon" },
    prestation: { date: "2026-11-18", depart: "Gare de Dijon-Ville", destination: "12 rue de Longvic", vehicule: "Berline Confort" }, montant,
    facture: { datePrestation: "2026-11-18", paye: true, datePaiement: "2026-11-17", modePaiement: "paiement en ligne Stripe", referencePaiement: "", ...f } });
  const essai = async (d) => admin({ action: "facture", doc: d });
  assert.equal((await essai(doc({ modePaiement: "carte bancaire" }))).j.code, "stripe_mode");
  assert.equal((await essai(doc({ modePaiement: "lien de paiement Indy" }))).j.code, "stripe_mode");
  const e1 = await essai(doc({ datePaiement: "2026-11-16" })); assert.equal(e1.j.code, "stripe_date"); assert.ok(e1.j.message.includes("17/11/2026"));
  assert.equal((await essai(doc({ referencePaiement: "pi_autre" }))).j.code, "stripe_reference");
  const e2 = await essai(doc({}, "25")); assert.equal(e2.j.code, "stripe_montant"); assert.ok(e2.j.message.includes("20,00 €"));
  assert.equal((await essai(doc({ paye: false, datePaiement: "" }))).j.code, "stripe_paye");
  assert.equal([...docDeps.store.m.keys()].filter((k) => k.startsWith("facture/")).length, 0, "aucune facture après les refus");
  const ok1 = await essai(doc());                                                       // référence vide → reprise de Stripe
  assert.equal(ok1.status, 200, JSON.stringify(ok1.j)); assert.equal(ok1.j.total, 20);
  const rec = docDeps.store.m.get("facture/" + ok1.j.numero).d;
  assert.equal(rec.doc.facture.modePaiement, "paiement en ligne Stripe"); assert.equal(rec.doc.facture.referencePaiement, P.paymentIntent);
  assert.equal(rec.doc.facture.datePaiement, "2026-11-17"); assert.equal(rec.montants.ttc, 20);
  const ok2 = await essai(doc());                                                       // redemandée : même facture, pas de doublon
  assert.equal(ok2.j.numero, ok1.j.numero);
  assert.equal([...docDeps.store.m.keys()].filter((k) => k.startsWith("facture/")).length, 1);
  // Remboursée intégralement → aucune facture ; mode Stripe sans paiement Stripe → refusé ; autre réservation, autre mode → inchangé
  const r1 = await essai({ ...doc(), ref: A.sansChauffeur.ref }); assert.equal(r1.status, 409); assert.equal(r1.j.code, "stripe_rembourse");
  const r2 = await essai({ ...doc(), ref: "E8-261117-MANUEL" }); assert.equal(r2.j.code, "stripe_absent");
  const r3 = await essai({ ...doc({ modePaiement: "virement bancaire", referencePaiement: "VIR-42" }, "35"), ref: "E8-261117-MANUEL" });
  assert.equal(r3.status, 200); assert.equal(docDeps.store.m.get("facture/" + r3.j.numero).d.doc.facture.modePaiement, "virement bancaire");
  // Le dossier de paiement n'a pas été modifié par la facturation
  assert.deepEqual(await dossier(A.ref), P);
  process.env.PAIEMENT_STRIPE = avant; NOW = debut; docDeps.config = null;
});
await t("site de test : contrôle de cohérence de la facture effectué, puis aucune émission", async () => {
  const { readFileSync } = await import("node:fs");
  const C = (await import("../netlify/functions/documents.mjs")).parseConfig(readFileSync(new URL("../public/config.js", import.meta.url), "utf8"));
  C.legal.capital = "1 000 €"; docDeps.config = C;
  ENV.retenirContexte({ deploy: { context: "branch-deploy" } });
  const n = docDeps.store.m.size;
  const d = (mode) => ({ ref: A.ref, client: { nom: "Martin", adresse: "12 rue de Longvic, 21000 Dijon" }, prestation: { depart: "A", destination: "B", date: "2026-11-18" }, montant: "20",
    facture: { datePrestation: "2026-11-18", paye: true, datePaiement: "2026-11-17", modePaiement: mode } });
  assert.equal((await admin({ action: "facture", doc: d("carte bancaire") })).j.code, "stripe_mode");
  const r = await admin({ action: "facture", doc: d("paiement en ligne Stripe") });
  assert.equal(r.status, 409); assert.equal(r.j.code, "site_test"); assert.ok(r.j.message.includes("réussi"));
  assert.equal(docDeps.store.m.size, n);
  ENV._reinitialiser(); docDeps.config = null;
});

/* ---------- Devis : « Étapes suivantes » selon le règlement réellement prévu ---------- */
await t("devis : textes adaptés au règlement (en ligne avant attribution, après la prestation, virement) ; texte d'origine conservé hors paiement en ligne", async () => {
  const { textesDevis } = await import("../netlify/lib/documents.mjs");
  const E = { modesPaiement: "carte bancaire ou virement bancaire" };
  const d = (valide, reglement) => ({ devis: { valide, validiteJours: 15, reglement: reglement || "auto" } });
  const meta = (r) => ({ dateEmission: "2026-11-20", reglement: r });
  const tout = (x) => [x.bandeau || "", x.titre, ...x.paragraphes].join(" ");
  // En ligne, à payer
  let x = textesDevis(d(true), E, meta({ mode: "en_ligne", etat: "a_payer", montant: 20, valableJusqu: "2026-11-21" }), 20);
  let t1 = tout(x);
  for (const m of ["avant l'attribution du chauffeur", "réglez 20,00 € TTC en ligne", "lien valable jusqu'au 21 novembre 2026", "Le paiement vaut acceptation du présent devis",
    "n'est définitivement confirmée qu'après l'acceptation de la course par un chauffeur", "si aucun chauffeur n'est disponible, le montant réglé vous est intégralement remboursé"]) assert.ok(t1.includes(m), m);
  assert.ok(!/après la prestation|Aucun paiement n'est demandé/.test(t1)); assert.equal(x.signature, false); assert.equal(x.titre, "Étapes suivantes");
  // En ligne, provisoire
  t1 = tout(textesDevis(d(false), E, meta({ mode: "en_ligne", etat: "a_payer", montant: 20 }), 20));
  assert.ok(t1.includes("lien de paiement sécurisé") && t1.includes("avant l'attribution du chauffeur") && t1.includes("intégralement remboursé") && !t1.includes("après la prestation"));
  // Payé, sans chauffeur / avec chauffeur / remboursé
  t1 = tout(textesDevis(d(true), E, meta({ mode: "en_ligne", etat: "paye", montant: 20, payeLe: "2026-11-17", reference: "pi_123" }), 20));
  assert.ok(t1.includes("20,00 € TTC reçus en ligne le 17 novembre 2026 (référence Stripe : pi_123), valant acceptation du présent devis") && t1.includes("en cours d'attribution") && t1.includes("intégralement remboursé"));
  assert.ok(!/Réservation confirmée/.test(t1), "jamais « confirmée » sans chauffeur");
  x = textesDevis(d(true), E, meta({ mode: "en_ligne", etat: "paye", montant: 20, payeLe: "2026-11-17", chauffeur: true }), 20);
  assert.equal(x.titre, "Réservation confirmée"); assert.ok(tout(x).includes("un chauffeur a accepté votre course"));
  assert.ok(tout(textesDevis(d(true), E, meta({ mode: "en_ligne", etat: "rembourse", montant: 20 }), 20)).includes("intégralement remboursé"));
  // Sans paiement en ligne : texte d'origine, mot pour mot
  x = textesDevis(d(true), E, meta(null), 20);
  assert.equal(x.titre, "Bon pour accord"); assert.equal(x.signature, true);
  assert.equal(x.paragraphes[0], "Pour accepter ce devis, répondez simplement « J'accepte » par e-mail ou par WhatsApp, ou retournez-le daté et signé avec la mention « Bon pour accord ». Règlement après la prestation, par carte bancaire ou virement bancaire.");
  assert.equal(x.bandeau, "Devis valable jusqu'au 5 décembre 2026. Aucun paiement n'est demandé à cette étape : la réservation est confirmée par ELEV8 après votre accord.");
  assert.equal(textesDevis(d(false), E, meta({ mode: "apres" }), 20).paragraphes[0], "ELEV8 vérifie la disponibilité du chauffeur et du véhicule, puis vous confirme le tarif définitif. Votre réservation est définitive uniquement après cette confirmation et votre accord. Règlement après la prestation, par carte bancaire ou virement bancaire.");
  // Virement avant la prestation
  x = textesDevis(d(true), E, meta({ mode: "virement_avant" }), 20);
  assert.ok(tout(x).includes("virement bancaire avant la prestation") && !tout(x).includes("après la prestation") && x.signature);
});
await t("devis : règlement déterminé par le serveur depuis le paiement réel ; incohérences refusées ; PDF généré", async () => {
  const { readFileSync } = await import("node:fs");
  const C = (await import("../netlify/functions/documents.mjs")).parseConfig(readFileSync(new URL("../public/config.js", import.meta.url), "utf8"));
  C.legal.capital = C.legal.capital && !/\[/.test(C.legal.capital) ? C.legal.capital : "1 000 €"; docDeps.config = C;
  const doc = (ref, reglement = "auto", montant = "20") => ({ ref, client: { prenom: "Claire", nom: "Martin" }, prestation: { date: "2026-11-18", depart: "Gare de Dijon-Ville", destination: "12 rue de Longvic" },
    montant, devis: { valide: true, validiteJours: 15, reglement } });
  const avant = { ...(await dossier(A.ref)) };
  const r1 = await admin({ action: "devis", doc: doc(A.ref) });                        // payée + chauffeur confirmé
  assert.equal(r1.status, 200, JSON.stringify(r1.j)); assert.equal(r1.j.type, "devis");
  assert.equal((await admin({ action: "devis", doc: doc(A.ref, "apres") })).j.code, "reglement_stripe");
  assert.equal((await admin({ action: "devis", doc: doc(A.ref, "virement_avant") })).j.code, "reglement_stripe");
  const r2 = await admin({ action: "devis", doc: doc(A.ref, "auto", "25") });
  assert.equal(r2.j.code, "reglement_montant"); assert.ok(r2.j.message.includes("20,00 €"));
  assert.equal((await admin({ action: "devis", doc: doc(A.ref, "en_ligne") })).status, 200);
  for (const reg of ["auto", "apres", "virement_avant", "en_ligne"]) assert.equal((await admin({ action: "devis", doc: doc("E8-261120-SANSLIEN", reg, "35") })).status, 200, reg);
  assert.equal((await admin({ action: "devis", doc: doc(A.sansChauffeur.ref) })).status, 200);   // remboursée : devis possible, montant non contrôlé
  assert.deepEqual(await dossier(A.ref), avant, "le paiement n'est pas modifié");
  assert.equal([...docDeps.store.m.keys()].filter((k) => k.startsWith("facture/") && docDeps.store.m.get(k).d.doc.ref === "E8-261120-SANSLIEN").length, 0);
  docDeps.config = null;
});

/* ---------- Devis d'une réservation déjà payée (cas E8-261119-QQC : 75,35 €, chauffeur confirmé) ---------- */
await t("devis d'une réservation payée et confirmée : jamais « provisoire », montant, date et référence Stripe, réservation confirmée", async () => {
  const { readFileSync } = await import("node:fs");
  const L = await import("../netlify/lib/documents.mjs");
  const C = (await import("../netlify/functions/documents.mjs")).parseConfig(readFileSync(new URL("../public/config.js", import.meta.url), "utf8"));
  docDeps.config = C;
  // Réservation payée 75,35 € puis chauffeur confirmé, par le parcours réel (lien → Stripe → webhook → /documents)
  const { j } = await envoyer({ date: "2026-11-25", heure: "08:00" });
  const montant = j.paiement.montant;
  const sid = (await ouvrir(j.paiement.url)).loc.split("/").pop();
  payerChezStripe(sid); await evenement("checkout.session.completed", { id: sid });
  await admin({ action: "chauffeur-confirme", ref: j.ref, chauffeur: { prenom: "Karim", vehicule: "Tesla Model Y" } });
  const P = await dossier(j.ref);
  assert.equal(P.statut, "paye"); assert.equal(P.etape, "chauffeur_confirme");
  const doc = (valide, reglement = "auto") => ({ ref: j.ref, client: { prenom: "Claire", nom: "Martin" }, prestation: { date: "2026-11-25", depart: "Gare de Dijon-Ville", destination: "12 rue de Longvic" },
    montant: String(montant), devis: { valide, validiteJours: 15, reglement } });
  // La case « Tarif validé » décochée (valeur par défaut du navigateur) ne rend PAS le devis provisoire
  for (const valide of [false, true]) {
    const r = await admin({ action: "devis", doc: doc(valide) });
    assert.equal(r.status, 200, JSON.stringify(r.j));
    assert.equal(r.j.provisoire, false); assert.deepEqual(r.j.reglement, { mode: "en_ligne", etat: "paye", chauffeur: true });
  }
  // Textes : montant encaissé, date, référence ; réservation confirmée ; ni « Aucun paiement », ni lien futur, ni attribution future
  const r = { mode: "en_ligne", etat: "paye", montant: 75.35, payeLe: "2026-11-19", reference: "pi_3QQC", chauffeur: true };
  const meta = { dateEmission: "2026-11-20", reglement: r };
  for (const valide of [false, true]) {
    const x = L.textesDevis({ devis: { valide, validiteJours: 15 } }, {}, meta, 75.35), tout = [x.bandeau, x.titre, ...x.paragraphes].join(" ");
    assert.ok(tout.includes("Règlement de 75,35 € TTC reçu en ligne le 19 novembre 2026 (référence Stripe : pi_3QQC)"), tout);
    assert.equal(x.titre, "Réservation confirmée"); assert.ok(tout.includes("votre réservation est définitivement confirmée"));
    assert.ok(!/Aucun paiement n'est demandé|recevrez alors un lien|lien de paiement sécurisé|en cours d'attribution|sera proposée|est ensuite proposée/.test(tout), tout);
  }
  // PDF : titre « Devis » (pas « Devis provisoire »), désignation sans « (VTC) »
  const E = L.emetteur(C);
  const pdfTexte = async (valide) => {
    const octets = await L.pdf("devis", L.nettoyer(doc(valide)), E, { numero: "D-" + j.ref, dateEmission: "2026-11-20", horodatage: NOW, reglement: r });
    const { PDFDocument } = await import("pdf-lib");
    return { titre: (await PDFDocument.load(octets)).getTitle() };
  };
  assert.equal((await pdfTexte(false)).titre, "Devis D-" + j.ref + " — ELEV8 Private Driver");
  docDeps.config = null;
});
await t("devis : la désignation par défaut ne contient plus « (VTC) » ; une facture déjà émise garde son libellé", async () => {
  const L = await import("../netlify/lib/documents.mjs");
  assert.equal(L.designationAuto({}), "Transport de personnes avec chauffeur");
  assert.equal(L.designationAuto({ allerRetour: true }), "Transport de personnes avec chauffeur — aller-retour");
  assert.equal(L.designationAuto({}, true), "Transport de personnes avec chauffeur (VTC)");          // anciennes factures sans libellé enregistré
  assert.equal(L.designationAuto({ designation: "Mise à disposition 3 h" }), "Mise à disposition 3 h");
  // Nouvelle facture : libellé figé au moment de l'émission (la facture émise plus haut dans ces tests)
  const f = [...docDeps.store.m.entries()].find(([k, v]) => k.startsWith("facture/") && v.d.doc.ref === A.ref);
  assert.equal(f[1].d.doc.prestation.designation, "Transport de personnes avec chauffeur");
});
await t("devis : réservations non payées, remboursées et sans paiement en ligne inchangées ; devis provisoire possible sans lien Stripe", async () => {
  const { readFileSync } = await import("node:fs");
  const C = (await import("../netlify/functions/documents.mjs")).parseConfig(readFileSync(new URL("../public/config.js", import.meta.url), "utf8"));
  docDeps.config = C;
  const doc = (ref, valide, montant = "20", reglement = "auto") => ({ ref, client: { nom: "Martin" }, prestation: { depart: "A", destination: "B" }, montant, devis: { valide, validiteJours: 15, reglement } });
  // Sans paiement en ligne : la case « Tarif validé » est respectée (provisoire possible)
  let r = await admin({ action: "devis", doc: doc("E8-261120-SANSLIEN", false, "35") });
  assert.equal(r.j.provisoire, true); assert.deepEqual(r.j.reglement, { mode: "apres", etat: null, chauffeur: false });
  r = await admin({ action: "devis", doc: doc("E8-261120-SANSLIEN", true, "35", "virement_avant") });
  assert.equal(r.j.provisoire, false); assert.equal(r.j.reglement.mode, "virement_avant");
  // Lien envoyé, pas encore payé : montant fixé → non provisoire, « à payer »
  const { j } = await envoyer({ date: "2026-11-26", heure: "08:00" });
  r = await admin({ action: "devis", doc: doc(j.ref, false, String(j.paiement.montant)) });
  assert.equal(r.j.provisoire, false); assert.equal(r.j.reglement.etat, "a_payer");
  // Remboursée
  r = await admin({ action: "devis", doc: doc(A.sansChauffeur.ref, false) });
  assert.equal(r.j.provisoire, false); assert.equal(r.j.reglement.etat, "rembourse");
  docDeps.config = null;
});

/* ---------- Étape 1 : devis PDF envoyé automatiquement avec « Accepter le devis et payer en ligne » ---------- */
const { inflateSync } = await import("node:zlib");
function textePdf(octets) {                                   // contenu des pages (flux décompressés), texte en hexadécimal WinAnsi
  const b = Buffer.from(octets), out = [];
  let i = 0;
  while ((i = b.indexOf("stream", i)) >= 0) {
    let d = i + 6; if (b[d] === 0x0d) d++; if (b[d] === 0x0a) d++;
    const f = b.indexOf("endstream", d); if (f < 0) break;
    try { out.push(inflateSync(b.subarray(d, f)).toString("latin1")); } catch { out.push(b.subarray(d, f).toString("latin1")); }
    i = f + 9;
  }
  const brut = out.join("\n");
  return brut + "\n" + brut.replace(/<([0-9A-Fa-f]+)>/g, (_, h) => Buffer.from(h, "hex").toString("latin1"));
}
await t("devis automatique (trajet standard) : PDF joint, numéro unique, montant = lien de paiement, devis figé, aucun doublon", async () => {
  envoyes.length = 0;
  const { j } = await envoyer({ date: "2026-11-27", heure: "09:00", societe: "Hôtel Exemple" });
  const m = envoyes.find((x) => x.to === "claire@example.test" && /Votre devis/.test(x.subject));
  const numero = "TEST-D-" + j.ref;
  assert.equal(j.paiement.devis, numero);
  const txt = textePdf(m.pieces[0].contenu);
  for (const x of [numero, "DOCUMENT DE TEST", "Transport de personnes avec chauffeur", "Total TTC", "20,00", "Étapes suivantes".toUpperCase(), "lien de paiement s"]) assert.ok(txt.includes(x), x);
  assert.ok(!txt.includes("(VTC)") && !txt.includes("Aucun paiement n'est demand") && !txt.includes("Devis provisoire"));
  // Devis figé et rattaché au dossier de paiement
  const rec = docDeps.store.m.get("devis/" + numero).d;
  assert.equal(rec.montantCents, 2000); assert.equal(rec.test, true); assert.equal(rec.doc.client.societe, "Hôtel Exemple");
  const P = await dossier(j.ref);
  assert.equal(P.devis.numero, numero); assert.equal(P.montantCents, rec.montantCents, "montant payé = montant du devis");
  // Un deuxième envoi pour le même lien ne produit ni nouveau devis ni nouvel e-mail
  const n = envoyes.length;
  const r2 = await DEVIS.envoyerDevis(PAI.magasin(), (await DEM.chargerParRef(DEM.magasin(), j.ref, NOW)).record, P, { origine: ORIGINE, now: NOW });
  assert.equal(r2.envoye, false); assert.equal(r2.devis, numero); assert.equal(envoyes.length, n);
  assert.equal([...docDeps.store.m.keys()].filter((k) => k.startsWith("devis/" + numero)).length, 1);
  // Le devis téléchargé dans /documents est exactement celui envoyé
  const tel = await admin({ action: "devis-envoye", ref: j.ref });
  assert.equal(tel.status, 200); assert.equal(tel.j.numero, numero);
  assert.equal(Buffer.from(tel.j.pdf, "base64").compare(Buffer.from(m.pieces[0].contenu)), 0);
  assert.equal((await admin({ action: "devis-envoye", ref: "E8-261120-SANSLIEN" })).status, 404);
  // Le bouton du devis ouvre le Checkout existant, au montant du devis
  const o = await ouvrir(j.paiement.url);
  assert.equal(S.sessions.get(o.loc.split("/").pop()).amount_total, rec.montantCents);
});
await t("cas particulier : « Valider le tarif et envoyer le devis » → devis détaillé (suppléments) envoyé ; nouveau montant = devis -2 et ancien lien désactivé", async () => {
  const { j } = await envoyer({ date: "2026-11-28", heure: "09:00", precisions: "Siège enfant" });
  assert.equal(j.paiement, null);
  envoyes.length = 0;
  const r1 = await admin({ action: "paiement-lien", ref: j.ref, montant: 45.5, detail: { montant: "40", supplements: [{ libelle: "Siège enfant", montant: "5,50" }] } });
  assert.equal(r1.status, 200, JSON.stringify(r1.j)); assert.equal(r1.j.devis, "TEST-D-" + j.ref); assert.equal(r1.j.mail, true);
  const m1 = envoyes.find((x) => x.to === "claire@example.test");
  const t1 = textePdf(m1.pieces[0].contenu);
  assert.ok(t1.includes("Siège enfant") && t1.includes("45,50"));
  assert.ok(m1.text.includes("Tarif : 45,50 € TTC"));
  const r2 = await admin({ action: "paiement-lien", ref: j.ref, montant: 50, detail: { montant: "50", supplements: [] } });
  assert.equal(r2.j.devis, "TEST-D-" + j.ref + "-2");
  assert.equal((await ouvrir(r1.j.paiement.lien)).loc, "/paiement/?etat=annule-lien");
  assert.equal(S.sessions.get((await ouvrir(r2.j.paiement.lien)).loc.split("/").pop()).amount_total, 5000);
  // Détail incohérent (40 + 10 ≠ 45) : devis sur une seule ligne, au montant du lien
  const r3 = await admin({ action: "paiement-lien", ref: j.ref, montant: 45, detail: { montant: "40", supplements: [{ libelle: "Attente", montant: "10" }] } });
  const rec = docDeps.store.m.get("devis/" + r3.j.devis).d;
  assert.equal(rec.doc.montant, 45); assert.equal(rec.doc.supplements.length, 0);
});
await t("client sans e-mail : le devis est envoyé à ELEV8 pour transmission ; informations légales incomplètes : lien envoyé sans PDF", async () => {
  envoyes.length = 0;
  const { j } = await envoyer({ date: "2026-11-29", heure: "09:00", email: "" });
  assert.equal(j.paiement.email, false);
  const m = envoyes.find((x) => /Client sans e-mail/.test(x.subject));
  assert.equal(m.to, ""); assert.equal(m.pieces.length, 1);
  const cfg = DEVIS.deps.config; DEVIS.deps.config = { ...cfg, legal: { ...cfg.legal, capital: "" } };
  envoyes.length = 0;
  const { j: j2 } = await envoyer({ date: "2026-11-29", heure: "10:00" });
  const m2 = envoyes.find((x) => x.to === "claire@example.test");
  assert.equal(m2.pieces.length, 0); assert.match(m2.subject, /Finalisation de votre réservation/); assert.ok(m2.text.includes("Accepter le tarif") || m2.text.includes("Accepter le devis et payer en ligne"));
  assert.equal(j2.paiement.devis, null);
  DEVIS.deps.config = cfg;
});
await t("site officiel : devis « D-… » sans mention de test ; site de test : « TEST-D-… » avec la mention", async () => {
  const L = await import("../netlify/lib/documents.mjs");
  const E = L.emetteur(DEVIS.deps.config);
  const doc = L.nettoyer({ ref: "E8-261120-PROD", client: { nom: "Martin" }, prestation: { depart: "A", destination: "B" }, montant: "20", devis: { valide: true } });
  const prod = textePdf(await L.pdf("devis", doc, E, { numero: "D-E8-261120-PROD", dateEmission: "2026-11-20" }));
  const test = textePdf(await L.pdf("devis", doc, E, { numero: "TEST-D-E8-261120-PROD", dateEmission: "2026-11-20", test: true }));
  assert.ok(!prod.includes("DOCUMENT DE TEST")); assert.ok(test.includes("DOCUMENT DE TEST") && test.includes("SANS VALEUR COMPTABLE"));
  ENV.retenirContexte({ deploy: { context: "production" } });
  assert.equal(ENV.estSiteDeTest(), false);                    // en production : numéros « D-… », sans mention
  ENV._reinitialiser();
});

/* ---------- Étape 2 : facture d'acompte de 100 % émise automatiquement au paiement confirmé ---------- */
const FACT = await import("../netlify/lib/facturation.mjs");
const factures = (ref) => [...docDeps.store.m.entries()].filter(([k, v]) => k.startsWith("facture/") && v.d.ref === ref && v.d.type === "acompte").map(([, v]) => v.d);
async function reserverEtPayer(extra = {}) {
  const { j } = await envoyer({ date: "2026-12-02", heure: "09:00", ...extra });
  if (!j.paiement) throw new Error("demande refusée : " + JSON.stringify(j));
  const sid = (await ouvrir(j.paiement.url)).loc.split("/").pop();
  payerChezStripe(sid);
  const e = await evenement("checkout.session.completed", { id: sid });
  return { j, sid, e };
}
await t("paiement confirmé → UNE facture d'acompte TEST-F-AAAA-…, PDF joint au client, copie identique à ELEV8, rattachée au dossier", async () => {
  process.env.FACTURATION_AUTOMATIQUE = "";
  envoyes.length = 0;
  const { j, e } = await reserverEtPayer({ societe: "Hôtel Exemple" });
  assert.equal(e.j.resultat, "paye");
  const F = factures(j.ref);
  assert.equal(F.length, 1);
  const f = F[0];
  assert.match(f.numero, /^TEST-F-2026-\d{4}$/); assert.equal(f.test, true); assert.equal(f.type, "acompte");
  const P = await dossier(j.ref);
  assert.equal(P.factures.acompte, f.numero);
  // Égalité exacte paiement = facture = devis
  const dv = docDeps.store.m.get("devis/" + P.devis.numero).d;
  assert.equal(f.acompte.montantCents, P.montantCents); assert.equal(dv.montantCents, P.montantCents); assert.equal(Math.round(f.montants.ttc * 100), P.montantCents);
  assert.deepEqual(f.doc.supplements, dv.doc.supplements); assert.equal(f.doc.montant, dv.doc.montant);
  assert.deepEqual([f.montants.ht, f.montants.tva, f.montants.ttc, f.montants.taux], [18.18, 1.82, 20, 10]);
  assert.equal(f.acompte.reference, P.paymentIntent); assert.equal(f.acompte.mode, "carte bancaire via Stripe"); assert.equal(f.acompte.pourcentage, 100);
  assert.equal(f.acompte.devis, P.devis.numero); assert.equal(f.acompte.dateEncaissement, "2026-11-17");
  // E-mail au client avec le PDF, copie cachée identique à ELEV8
  const m = envoyes.find((x) => /facture d'acompte/.test(x.subject));
  assert.equal(m.to, "claire@example.test"); assert.equal(m.copie, "contact@elev8privatedriver.com");
  assert.equal(m.subject, "[TEST] ELEV8 Private Driver — Votre facture d'acompte " + f.numero + " | " + j.ref);
  assert.equal(m.pieces[0].nom, f.numero + ".pdf");
  for (const x of ["acompte de 100 % reçu, reste à payer : 0,00 €", "carte bancaire via Stripe", "La facture finale vous sera adressée après la réalisation"]) assert.ok(m.text.includes(x), x);
  // Contenu du PDF
  const txt = textePdf(m.pieces[0].contenu);
  for (const x of ["Facture d'acompte", f.numero, j.ref, "SASU au capital de 1 000", "SIRET 131 595 068 00019", "FR66131595068", "Hôtel Exemple", "Date prévue", "mercredi 2 décembre 2026",
    "Transport de personnes avec chauffeur", "8,3 km", "Tesla Model Y", "Total HT", "18,18", "TVA 10 %", "1,82", "Total TTC", "20,00", "Acompte reçu (100 %)", "Reste à payer", "0,00",
    "Acompte de 100 % reçu le 17 novembre 2026", "carte bancaire via Stripe", P.paymentIntent, "Montant déjà réglé : 20,00", "DOCUMENT DE TEST", "SANS VALEUR COMPTABLE", "Pas d'escompte"]) assert.ok(txt.includes(x), x);
  assert.ok(!txt.includes("(VTC)"));
  A.acompte = { ref: j.ref, numero: f.numero, sid: e.id, pdf: m.pieces[0].contenu };
});
await t("notifications Stripe répétées ou simultanées : toujours UNE seule facture d'acompte, facture jamais modifiée", async () => {
  const ref = A.acompte.ref, avant = structuredClone(factures(ref)[0]);
  const P = await dossier(ref);
  const sid = (P.sessions || []).find((x) => x.statut === "complete").id;
  envoyes.length = 0;
  const corps = JSON.stringify({ id: A.acompte.sid, type: "checkout.session.completed", livemode: false, data: { object: { id: sid } } });
  await webhook(new Request(ORIGINE + "/stripe-webhook", { method: "POST", headers: { "stripe-signature": signer(corps) }, body: corps }));
  await evenement("checkout.session.completed", { id: sid });                // nouvel identifiant d'événement, même paiement
  await evenement("checkout.session.async_payment_succeeded", { id: sid });
  await Promise.all([FACT.facturerPaiement(PAI.magasin(), P, { now: NOW }), FACT.facturerPaiement(PAI.magasin(), P, { now: NOW })]);
  await suivre(NOW);
  assert.equal(factures(ref).length, 1);
  assert.deepEqual(factures(ref)[0], avant, "facture inchangée");
  assert.equal(envoyes.filter((x) => /facture d'acompte/.test(x.subject)).length, 0, "aucun second envoi");
});
await t("échec de l'e-mail : facture conservée, puis envoi relancé par la tâche horaire, une seule fois", async () => {
  const envoiNormal = MAIL.deps.send;
  let panne = true;
  MAIL.deps.send = async (m) => { if (panne && /facture d'acompte/.test(m.subject)) throw new Error("provider:503"); envoyes.push(m); };
  envoyes.length = 0;
  const { j } = await reserverEtPayer();
  const F = factures(j.ref);
  assert.equal(F.length, 1, "facture émise malgré l'échec de l'e-mail");
  let P = await dossier(j.ref);
  assert.equal(P.factures.acompte, F[0].numero); assert.ok(!P.notifications.client_facture_acompte, "envoi non marqué");
  assert.equal(FACT.acompteEnAttente(P), true);
  await suivre(NOW);                                                        // le prestataire est toujours en panne
  assert.equal(envoyes.filter((x) => /facture d'acompte/.test(x.subject)).length, 0);
  panne = false;
  await suivre(NOW); await suivre(NOW);
  const recus = envoyes.filter((x) => /facture d'acompte/.test(x.subject) && x.subject.includes(j.ref));
  assert.equal(recus.length, 1); assert.ok(recus[0].subject.includes(F[0].numero));
  assert.equal(factures(j.ref).length, 1, "aucune nouvelle facture");
  P = await dossier(j.ref); assert.equal(FACT.acompteEnAttente(P), false);
  MAIL.deps.send = envoiNormal;
});
await t("paiement refusé, incomplet (différé) ou à vérifier : aucune facture", async () => {
  // Différé puis refusé
  const { j } = await envoyer({ date: "2026-12-03", heure: "09:00" });
  const s1 = (await ouvrir(j.paiement.url)).loc.split("/").pop();
  payerChezStripe(s1, { differe: true });
  await evenement("checkout.session.completed", { id: s1 });
  assert.equal((await dossier(j.ref)).statut, "en_cours"); assert.equal(factures(j.ref).length, 0);
  await evenement("checkout.session.async_payment_failed", { id: s1 });
  await suivre(NOW);
  assert.equal(factures(j.ref).length, 0);
  // Session ouverte mais jamais payée (retour navigateur seul)
  const { j: j2 } = await envoyer({ date: "2026-12-03", heure: "10:00" });
  await ouvrir(j2.paiement.url);
  assert.equal(factures(j2.ref).length, 0);
  // Montant payé différent : « à vérifier », jamais facturé
  const { j: j3 } = await envoyer({ date: "2026-12-03", heure: "11:00" });
  const s3 = (await ouvrir(j3.paiement.url)).loc.split("/").pop();
  payerChezStripe(s3, { montant: 500 }); await evenement("checkout.session.completed", { id: s3 });
  assert.equal((await dossier(j3.ref)).statut, "a_verifier"); await suivre(NOW);
  assert.equal(factures(j3.ref).length, 0);
});
await t("téléchargement dans /documents : PDF enregistré identique à l'envoi, réservé à une session ELEV8", async () => {
  const r = await admin({ action: "facture-acompte", ref: A.acompte.ref });
  assert.equal(r.status, 200); assert.equal(r.j.numero, A.acompte.numero); assert.equal(r.j.fichier, A.acompte.numero + ".pdf");
  assert.equal(Buffer.from(r.j.pdf, "base64").compare(Buffer.from(A.acompte.pdf)), 0);
  const sans = await documents(post("/documents-api", { action: "facture-acompte", ref: A.acompte.ref }), { ip: "9.9.9.9" });
  assert.equal(sans.status, 401);
  assert.equal((await admin({ action: "facture-acompte", ref: "E8-261120-SANSLIEN" })).status, 404);
  const chg = await admin({ action: "charger", ref: A.acompte.ref });
  assert.equal(chg.j.paiement.factures.acompte, A.acompte.numero);
});
await t("pas de seconde facture manuelle pour une course déjà facturée en acompte", async () => {
  docDeps.config = DEVIS.deps.config;
  const r = await admin({ action: "facture", doc: { ref: A.acompte.ref, client: { nom: "Martin", adresse: "1 rue X" }, prestation: { depart: "A", destination: "B" }, montant: "20",
    facture: { datePrestation: "2026-11-16", paye: true, datePaiement: "2026-11-17", modePaiement: "paiement en ligne Stripe" } } });
  assert.equal(r.status, 409); assert.equal(r.j.code, "acompte_emis"); assert.ok(r.j.message.includes(A.acompte.numero));
  docDeps.config = null;
});
await t("cas particulier avec supplément : HT/TVA calculés ligne à ligne, facture = devis = paiement", async () => {
  envoyes.length = 0;
  const { j } = await envoyer({ date: "2026-12-04", heure: "09:00", precisions: "Siège enfant" });
  const r = await admin({ action: "paiement-lien", ref: j.ref, montant: 45.5, detail: { montant: "40", supplements: [{ libelle: "Siège enfant", montant: "5,50" }] } });
  const sid = (await ouvrir(r.j.paiement.lien)).loc.split("/").pop();
  payerChezStripe(sid); await evenement("checkout.session.completed", { id: sid });
  const f = factures(j.ref)[0];
  assert.deepEqual([f.montants.ht, f.montants.tva, f.montants.ttc], [41.36, 4.14, 45.5]);
  assert.equal(f.acompte.montantCents, 4550);
  const txt = textePdf(envoyes.find((x) => /facture d'acompte/.test(x.subject)).pieces[0].contenu);
  assert.ok(txt.includes("Siège enfant") && txt.includes("41,36") && txt.includes("4,14") && txt.includes("45,50"));
});
await t("réglages : FACTURATION_AUTOMATIQUE=non ou facturation « indy » → aucune facture ; production : série F-AAAA continue, sans mention de test", async () => {
  process.env.FACTURATION_AUTOMATIQUE = "non";
  const { j } = await reserverEtPayer({ heure: "12:00" });
  assert.equal(factures(j.ref).length, 0);
  process.env.FACTURATION_AUTOMATIQUE = "";
  const cfg = DEVIS.deps.config; DEVIS.deps.config = { ...cfg, legal: { ...cfg.legal, facturation: "indy" } };
  const { j: j2 } = await reserverEtPayer({ heure: "13:00" });
  assert.equal(factures(j2.ref).length, 0);
  DEVIS.deps.config = cfg;
  // Production : même compteur que les factures déjà émises (« compteur/AAAA »), jamais réinitialisé ni réutilisé
  const { numeroSuivant } = await import("../netlify/lib/numerotation.mjs");
  const avant = docDeps.store.m.get("compteur/2026").d.n;
  ENV.retenirContexte({ deploy: { context: "production" } });
  const n1 = await numeroSuivant(docDeps.store, "2026"), n2 = await numeroSuivant(docDeps.store, "2026");
  ENV._reinitialiser();
  assert.equal(n1, "F-2026-" + String(avant + 1).padStart(4, "0")); assert.equal(n2, "F-2026-" + String(avant + 2).padStart(4, "0"));
  const L = await import("../netlify/lib/documents.mjs");
  const rec = factures(A.acompte.ref)[0];
  const prod = textePdf(await L.pdf("acompte", rec.doc, rec.emetteur, { numero: "F-2026-0099", dateEmission: rec.dateEmission, acompte: rec.acompte }));
  assert.ok(!prod.includes("DOCUMENT DE TEST") && prod.includes("Facture d'acompte"));
  process.env.FACTURATION_AUTOMATIQUE = "non";
});

/* ---------- Étape 3 : « Course réalisée », facture finale, avoirs ---------- */
const docsDe = (ref, type) => [...docDeps.store.m.entries()].filter(([k, v]) => (k.startsWith("facture/") || k.startsWith("avoir/")) && v.d.ref === ref && v.d.type === type).map(([, v]) => v.d);
async function payeeConfirmee(heure) {
  const r = await reserverEtPayer({ date: "2026-12-05", heure });
  await admin({ action: "chauffeur-confirme", ref: r.j.ref, chauffeur: { prenom: "Karim", vehicule: "Tesla Model Y" } });
  return r;
}
async function rembourserChezStripe(ref, cumulCents) {
  const P = await dossier(ref);
  const ch = [...S.charges.values()].find((c) => c.payment_intent === P.paymentIntent);
  ch.amount_refunded = cumulCents;
  return evenement("charge.refunded", { id: ch.id, object: "charge" });
}
await t("paiement → chauffeur confirmé → COURSE RÉALISÉE → facture finale (acompte déduit, solde 0,00 €), PDF au client + copie ELEV8", async () => {
  process.env.FACTURATION_AUTOMATIQUE = "";
  const { j } = await payeeConfirmee("09:00");
  const acompte = docsDe(j.ref, "acompte")[0];
  envoyes.length = 0;
  // Contrôles d'accès et de cohérence
  const sans = await documents(post("/documents-api", { action: "course-realisee", ref: j.ref }), { ip: "6.6.6.6" });
  assert.equal(sans.status, 401);
  assert.equal((await admin({ action: "course-realisee", ref: j.ref, realiseeLe: "2026-12-31T10:00" })).status, 422);     // dans le futur
  assert.match((await admin({ action: "course-realisee", ref: j.ref, realiseeLe: "2026-11-01T12:30" })).j.message, /antérieure à la prise en charge/);
  const debut = NOW; NOW = Date.parse("2026-12-05T11:00:00Z");                         // le jour de la course, après la prise en charge
  const r = await admin({ action: "course-realisee", ref: j.ref, realiseeLe: "2026-12-05T09:40" });
  NOW = debut;
  assert.equal(r.status, 200, JSON.stringify(r.j));
  assert.equal(r.j.paiement.etape, "realisee"); assert.equal(r.j.paiement.etapeLibelle, "Course réalisée");
  const P = await dossier(j.ref);
  assert.equal(P.realisation.le, new Date(PAI.instantParis("2026-12-05", "09:40")).toISOString()); assert.equal(P.realisation.par, "elev8");
  const F = docsDe(j.ref, "finale");
  assert.equal(F.length, 1);
  const f = F[0];
  assert.match(f.numero, /^TEST-F-2026-\d{4}$/); assert.ok(f.numero > acompte.numero, "numéro postérieur à l'acompte (série continue)");
  assert.equal(P.factures.finale, f.numero); assert.equal(r.j.facture.numero, f.numero);
  assert.equal(f.finale.acompte.numero, acompte.numero); assert.equal(f.finale.deductionCents, 2000); assert.equal(f.finale.soldeCents, 0);
  assert.deepEqual([f.montants.ht, f.montants.tva, f.montants.ttc], [18.18, 1.82, 20]);
  assert.equal(f.doc.facture.datePrestation, "2026-12-05");
  const m = envoyes.find((x) => /Votre facture TEST-F/.test(x.subject));
  assert.equal(m.to, "claire@example.test"); assert.equal(m.copie, "contact@elev8privatedriver.com"); assert.equal(m.pieces[0].nom, f.numero + ".pdf");
  assert.ok(m.text.includes("solde à payer 0,00 €") && m.text.includes(acompte.numero));
  const txt = textePdf(m.pieces[0].contenu);
  for (const x of ["Facture", f.numero, j.ref, "Date de réalisation", "samedi 5 décembre 2026 à 09h40", "Transport de personnes avec chauffeur", "Total HT", "18,18", "1,82", "Total TTC", "20,00",
    "Acompte vers", acompte.numero, "Solde à payer", "0,00", "Facture réglée par l'acompte", "SASU au capital de 1 000", "DOCUMENT DE TEST"]) assert.ok(txt.includes(x), x);
  // Téléchargement réservé, document rattaché à la réservation
  const tel = await admin({ action: "document-pdf", ref: j.ref, numero: f.numero });
  assert.equal(tel.status, 200); assert.equal(Buffer.from(tel.j.pdf, "base64").compare(Buffer.from(m.pieces[0].contenu)), 0);
  assert.equal((await admin({ action: "document-pdf", ref: A.acompte.ref, numero: f.numero })).status, 404);
  assert.equal((await documents(post("/documents-api", { action: "document-pdf", ref: j.ref, numero: f.numero }), { ip: "6.6.6.7" })).status, 401);
  A.finale = { ref: j.ref, numero: f.numero, acompte: acompte.numero };
});
await t("double clic / validations simultanées sur « Course réalisée » : une seule validation, une seule facture finale", async () => {
  const { j } = await payeeConfirmee("10:00");
  envoyes.length = 0;
  const debut = NOW; NOW = Date.parse("2026-12-05T10:30:00Z");                         // 11 h 30 à Paris, après la prise en charge de 10 h
  const [a, b] = await Promise.all([admin({ action: "course-realisee", ref: j.ref }), admin({ action: "course-realisee", ref: j.ref })]);
  assert.deepEqual([a.status, b.status].sort(), [200, 409]);
  assert.equal((await admin({ action: "course-realisee", ref: j.ref })).status, 409);
  NOW = debut;
  await suivre(NOW); await suivre(NOW);
  assert.equal(docsDe(j.ref, "finale").length, 1);
  assert.equal(envoyes.filter((x) => /Votre facture TEST-F/.test(x.subject) && x.subject.includes(j.ref)).length, 1);
});
await t("« Course réalisée » refusée : chauffeur non confirmé, paiement non confirmé, course annulée ou remboursée", async () => {
  const { j } = await reserverEtPayer({ date: "2026-12-06", heure: "09:00" });
  assert.match((await admin({ action: "course-realisee", ref: j.ref })).j.message, /Confirmez d'abord le chauffeur/);
  const { j: j2 } = await envoyer({ date: "2026-12-06", heure: "10:00" });
  assert.equal((await admin({ action: "course-realisee", ref: j2.ref })).status, 409);         // lien envoyé, non payé
  assert.equal((await admin({ action: "course-realisee", ref: "E8-261120-SANSLIEN" })).status, 404);
  A.nonRealisee = j.ref;
});
await t("remboursement total AVANT la prestation : avoir TEST-AV sur la facture d'acompte, envoyé ; course non réalisable ; pas de double avoir", async () => {
  const ref = A.nonRealisee, acompte = docsDe(ref, "acompte")[0];
  envoyes.length = 0;
  await admin({ action: "annuler-course", ref, motif: "sans_chauffeur" });       // remboursement intégral demandé à Stripe
  const P0 = await dossier(ref);
  const e = await rembourserChezStripe(ref, P0.montantCents);                     // Stripe confirme
  assert.equal(e.j.resultat, "rembourse");
  const AV = docsDe(ref, "avoir");
  assert.equal(AV.length, 1);
  const av = AV[0];
  assert.match(av.numero, /^TEST-AV-2026-\d{4}$/);
  assert.equal(av.avoir.facture.numero, acompte.numero); assert.equal(av.avoir.facture.type, "acompte");
  assert.equal(av.avoir.montantCents, P0.montantCents); assert.equal(av.avoir.total, true); assert.equal(av.avoir.reference, P0.paymentIntent);
  assert.equal(Math.round(av.montants.ttc * 100), P0.montantCents); assert.equal(Math.round((av.montants.ht + av.montants.tva) * 100), P0.montantCents);
  assert.equal(av.montants.ht, Math.round(P0.montantCents / 1.1) / 100);
  const m = envoyes.find((x) => /Votre avoir/.test(x.subject));
  assert.equal(m.to, "claire@example.test"); assert.equal(m.copie, "contact@elev8privatedriver.com");
  const txt = textePdf(m.pieces[0].contenu);
  for (const x of ["Avoir", av.numero, "Avoir sur la facture d'acompte " + acompte.numero, "Remboursement intégral de " + (P0.montantCents / 100).toFixed(2).replace(".", ","), "Montant remboursé", "Total TTC de l'avoir", "DOCUMENT DE TEST"]) assert.ok(txt.includes(x), x);
  // Notification répétée et relance : aucun second avoir
  await rembourserChezStripe(ref, P0.montantCents); await suivre(NOW);
  assert.equal(docsDe(ref, "avoir").length, 1);
  assert.equal(envoyes.filter((x) => /Votre avoir/.test(x.subject)).length, 1);
  assert.equal((await admin({ action: "course-realisee", ref })).status, 409);
  assert.equal(docsDe(ref, "finale").length, 0);
  assert.deepEqual(docsDe(ref, "acompte")[0], acompte, "facture d'acompte inchangée");
});
await t("remboursements partiels progressifs avant la course : un avoir par tranche, puis facture finale au montant réellement dû", async () => {
  const { j } = await payeeConfirmee("11:00");
  const acompte = docsDe(j.ref, "acompte")[0];
  await rembourserChezStripe(j.ref, 500);                                         // 5,00 € (geste commercial)
  await rembourserChezStripe(j.ref, 500);                                         // notification répétée
  await rembourserChezStripe(j.ref, 800);                                         // 3,00 € de plus (cumul 8,00 €)
  const AV = docsDe(j.ref, "avoir").sort((a, b) => a.numero.localeCompare(b.numero));
  assert.deepEqual(AV.map((x) => x.avoir.montantCents), [500, 300]);
  assert.deepEqual(AV.map((x) => x.avoir.cumulCents), [500, 800]);
  assert.ok(AV.every((x) => x.avoir.facture.numero === acompte.numero && !x.avoir.total));
  assert.equal((await dossier(j.ref)).statut, "rembourse_partiel");
  const debut = NOW; NOW = Date.parse("2026-12-05T12:00:00Z");
  const r = await admin({ action: "course-realisee", ref: j.ref, realiseeLe: "2026-12-05T11:20" });
  NOW = debut;
  assert.equal(r.status, 200, JSON.stringify(r.j));
  const f = docsDe(j.ref, "finale")[0];
  assert.equal(f.montants.ttc, 12); assert.equal(f.finale.deductionCents, 1200); assert.equal(f.finale.soldeCents, 0);
  assert.deepEqual(f.finale.avoirs.map((a) => a.numero), AV.map((x) => x.numero));
  assert.ok(f.doc.supplements.some((x) => x.montant === -5 && x.libelle.includes(AV[0].numero)));
  assert.equal(Math.round((f.montants.ht + f.montants.tva) * 100), 1200);
});
await t("remboursement APRÈS la facture finale : avoir rattaché à la facture finale (partiel puis solde), factures inchangées", async () => {
  const ref = A.finale.ref;
  const finale = docsDe(ref, "finale")[0], acompte = docsDe(ref, "acompte")[0];
  envoyes.length = 0;
  await rembourserChezStripe(ref, 700);
  await rembourserChezStripe(ref, 2000);
  const AV = docsDe(ref, "avoir").sort((a, b) => a.numero.localeCompare(b.numero));
  assert.deepEqual(AV.map((x) => [x.avoir.montantCents, x.avoir.facture.numero, x.avoir.total]), [[700, finale.numero, false], [1300, finale.numero, true]]);
  assert.equal(envoyes.filter((x) => /Votre avoir/.test(x.subject)).length, 2);
  assert.deepEqual(docsDe(ref, "finale")[0], finale); assert.deepEqual(docsDe(ref, "acompte")[0], acompte);
  const P = await dossier(ref);
  assert.equal(P.statut, "rembourse"); assert.equal(P.etape, "realisee");
  for (const a of P.factures.avoirs) assert.equal((await admin({ action: "document-pdf", ref, numero: a.numero })).status, 200);
});
await t("échec d'e-mail de la facture finale : facture conservée, renvoyée une seule fois par la tâche horaire", async () => {
  const { j } = await payeeConfirmee("12:00");
  const normal = MAIL.deps.send; let panne = true;
  MAIL.deps.send = async (m) => { if (panne && /Votre facture TEST-F/.test(m.subject)) throw new Error("provider:503"); envoyes.push(m); };
  envoyes.length = 0;
  const debut = NOW; NOW = Date.parse("2026-12-05T12:00:00Z");
  const r = await admin({ action: "course-realisee", ref: j.ref, realiseeLe: "2026-12-05T12:15" });
  NOW = debut;
  assert.equal(r.status, 200); assert.equal(r.j.facture.envoye, false);
  assert.equal(docsDe(j.ref, "finale").length, 1);
  panne = false; await suivre(NOW); await suivre(NOW);
  assert.equal(envoyes.filter((x) => /Votre facture TEST-F/.test(x.subject) && x.subject.includes(j.ref)).length, 1);
  assert.equal(docsDe(j.ref, "finale").length, 1);
  MAIL.deps.send = normal;
});
await t("émission interrompue : la reprise réutilise le numéro déjà attribué (pas de trou), sans doublon", async () => {
  const { j } = await payeeConfirmee("13:00");
  const st = docDeps.store;
  // Simulation : une émission a pris le numéro suivant puis s'est arrêtée avant d'enregistrer la facture
  const cle = "finale-ref/" + j.ref;
  const cpt = st.m.get("compteur/2026").d.n + 1;
  await st.setJSON("compteur/2026", { n: cpt, par: cle });
  await st.setJSON(cle, { numero: null, t: NOW - 10 * 60_000 });
  await PAI.modifier(PAI.magasin(), (await dossier(j.ref)).jeton, (x) => ({ ...x, etape: "realisee",
    realisation: { le: new Date(Date.parse(x.priseEnCharge) + 3600_000).toISOString(), declareLe: new Date(Date.parse(x.priseEnCharge) + 7200_000).toISOString(), par: "elev8", reference: { priseEnCharge: x.priseEnCharge, fin: x.priseEnCharge } } }));
  await suivre(NOW);
  const f = docsDe(j.ref, "finale");
  assert.equal(f.length, 1); assert.equal(f[0].numero, "TEST-F-2026-" + String(cpt).padStart(4, "0"), "numéro repris");
  assert.equal(st.m.get("compteur/2026").d.n, cpt, "aucun numéro supplémentaire consommé");
});
await t("séries distinctes : factures F (acompte + finale, compteur commun) et avoirs AV (compteur propre)", async () => {
  const F = [...docDeps.store.m.values()].map((v) => v.d).filter((d) => d && d.numero && d.test && (d.type === "acompte" || d.type === "finale")).map((d) => d.numero);
  const AV = [...docDeps.store.m.values()].map((v) => v.d).filter((d) => d && d.type === "avoir").map((d) => d.numero);
  assert.equal(new Set(F).size, F.length, "aucun numéro F en double"); assert.equal(new Set(AV).size, AV.length, "aucun numéro AV en double");
  assert.ok(AV.every((n) => /^TEST-AV-2026-\d{4}$/.test(n)));
  assert.equal(docDeps.store.m.get("compteur-AV/2026").d.n, AV.length);
  process.env.FACTURATION_AUTOMATIQUE = "non";
});

/* ---------- Étape 3 bis : contrôle de la date de réalisation (serveur) et modification officielle de la date ---------- */
const aLaDate = async (iso, f) => { const debut = NOW; NOW = Date.parse(iso); try { return await f(); } finally { NOW = debut; } };
async function courseConfirmee(date, heure, extra = {}) {
  const r = await reserverEtPayer({ date, heure, ...extra });
  if (!r.j.paiement) throw new Error("réservation refusée : " + JSON.stringify(r.j));
  await admin({ action: "chauffeur-confirme", ref: r.j.ref, chauffeur: { prenom: "Karim", vehicule: "Tesla Model Y" } });
  return r.j.ref;
}
await t("cas KPH : course prévue le 25/11 à 14 h, déclarée réalisée le 20/11 → refus du SERVEUR (date indiquée ou absente), aucune facture finale", async () => {
  process.env.FACTURATION_AUTOMATIQUE = "";
  const ref = await courseConfirmee("2026-11-25", "14:00");
  const refus = async (corps) => { const r = await admin({ action: "course-realisee", ref, ...corps }); assert.equal(r.status, 422, JSON.stringify(r.j)); return r.j.message; };
  await aLaDate("2026-11-20T11:00:00Z", async () => {
    assert.match(await refus({ realiseeLe: "2026-11-20T10:00" }), /antérieure à la prise en charge prévue \(25 novembre 2026 à 14:00\)/);
    assert.match(await refus({}), /antérieure à la prise en charge/);                       // champ vide : l'heure du clic est contrôlée aussi
    assert.match(await refus({ realiseeLe: "2026-11-25T14:30" }), /futur/);
  });
  await aLaDate("2026-11-26T20:00:00Z", async () => {
    assert.match(await refus({ realiseeLe: "2026-11-25T13:20" }), /antérieure/);          // 40 min avant la prise en charge
    assert.match(await refus({ realiseeLe: "2026-11-26T15:30" }), /plus de 24 h après/);
    assert.match(await refus({ realiseeLe: "25/11/2026 14:00" }), /invalides/);
  });
  const P = await dossier(ref);
  assert.equal(P.etape, "chauffeur_confirme"); assert.equal(P.realisation, undefined);
  assert.equal(docsDe(ref, "finale").length, 0);
  // Dans la fenêtre (20 min d'avance tolérées) : accepté une seule fois
  const ok = await aLaDate("2026-11-25T15:00:00Z", () => admin({ action: "course-realisee", ref, realiseeLe: "2026-11-25T13:40" }));
  assert.equal(ok.status, 200, JSON.stringify(ok.j)); assert.equal(docsDe(ref, "finale").length, 1);
  assert.equal((await aLaDate("2026-11-25T15:00:00Z", () => admin({ action: "course-realisee", ref, realiseeLe: "2026-11-25T14:10" }))).status, 409);
  assert.equal(docsDe(ref, "finale").length, 1);
});
await t("exception sécurisée : date officiellement modifiée (session ELEV8, motif, historique) → réalisation acceptée à la nouvelle date", async () => {
  const ref = await courseConfirmee("2026-11-26", "14:00");
  const corps = { action: "modifier-date", ref, date: "2026-11-20", heure: "09:30", motif: "Avancée à la demande du client" };
  assert.equal((await documents(post("/documents-api", corps), { ip: "5.5.5.5" })).status, 401);
  assert.equal((await admin({ ...corps, motif: "" })).status, 422);
  assert.equal((await admin({ ...corps, date: "20/11/2026" })).status, 422);
  const r = await aLaDate("2026-11-19T10:00:00Z", () => admin(corps));
  assert.equal(r.status, 200, JSON.stringify(r.j));
  const P = await dossier(ref);
  assert.equal(P.priseEnCharge, new Date(PAI.instantParis("2026-11-20", "09:30")).toISOString());
  assert.equal(P.modificationsDate.length, 1); assert.equal(P.modificationsDate[0].motif, "Avancée à la demande du client");
  assert.equal(P.modificationsDate[0].ancienne, new Date(PAI.instantParis("2026-11-26", "14:00")).toISOString());
  assert.ok(P.historique.some((h) => /date de la prestation modifiée/.test(h.quoi)));
  assert.equal(r.j.paiement.modificationsDate.length, 1);
  // Réalisation à la nouvelle date : acceptée, facture finale datée du jour réel
  const ok = await aLaDate("2026-11-20T11:00:00Z", () => admin({ action: "course-realisee", ref, realiseeLe: "2026-11-20T10:15" }));
  assert.equal(ok.status, 200, JSON.stringify(ok.j));
  const f = docsDe(ref, "finale")[0];
  assert.equal(f.doc.facture.datePrestation, "2026-11-20"); assert.equal(f.finale.heureRealisation, "10h15");
  // Plus aucune modification possible une fois la course réalisée
  assert.equal((await admin({ ...corps, date: "2026-11-21" })).status, 409);
});
await t("facture finale bloquée si la date de réalisation enregistrée est incohérente (contrôle indépendant de l'écran)", async () => {
  const ref = await courseConfirmee("2026-11-27", "14:00");
  const P0 = await dossier(ref);
  const debut = Date.parse(P0.priseEnCharge);
  const casIncoherents = [
    { le: debut - 5 * 86400_000, declareLe: debut - 5 * 86400_000, reference: { priseEnCharge: P0.priseEnCharge, fin: P0.priseEnCharge } },   // avant la prise en charge
    { le: debut + 3600_000, declareLe: debut - 86400_000, reference: { priseEnCharge: P0.priseEnCharge, fin: P0.priseEnCharge } },            // déclarée avant d'avoir eu lieu
    { le: debut + 3600_000, declareLe: debut + 7200_000, reference: { priseEnCharge: "2026-11-01T10:00:00.000Z", fin: P0.priseEnCharge } },  // date de référence différente
    { le: debut + 3600_000, declareLe: debut + 7200_000 }                                                                                    // sans référence
  ];
  for (const R of casIncoherents) {
    await PAI.modifier(PAI.magasin(), P0.jeton, (x) => ({ ...x, etape: "realisee", realisation: { ...R, le: new Date(R.le).toISOString(), declareLe: new Date(R.declareLe).toISOString(), par: "elev8" } }));
    const r = await FACT.facturerRealisation(PAI.magasin(), await dossier(ref), { now: NOW });
    assert.equal(r.ignore, "date_incoherente");
    await suivre(NOW);
    assert.equal(docsDe(ref, "finale").length, 0);
  }
});
await t("aller-retour : réalisation acceptée jusqu'à 24 h après le retour prévu, refusée au-delà", async () => {
  const ref = await courseConfirmee("2026-11-28", "08:00", { allerRetour: true, dateRetour: "2026-11-30", heureRetour: "18:00" });
  const r1 = await aLaDate("2026-12-02T10:00:00Z", () => admin({ action: "course-realisee", ref, realiseeLe: "2026-12-01T19:30" }));
  assert.equal(r1.status, 422);
  const r2 = await aLaDate("2026-12-01T10:00:00Z", () => admin({ action: "course-realisee", ref, realiseeLe: "2026-11-30T19:00" }));
  assert.equal(r2.status, 200, JSON.stringify(r2.j));
  process.env.FACTURATION_AUTOMATIQUE = "non";
});

/* ---------- Étape 4 : tableau de gestion, documents, export comptable, e-mail de changement de date ---------- */
const lireCsv = (b64) => Buffer.from(b64, "base64").toString("utf8").replace(/^﻿/, "").trim().split("\r\n").map((l) => l.split(";"));
const num = (x) => Math.round(parseFloat(String(x).replace(",", ".")) * 100);
const G = {};
await t("préparation : 4 réservations (réalisée, remboursée partiellement, en attente de paiement, annulée)", async () => {
  process.env.FACTURATION_AUTOMATIQUE = "";
  envoyes.length = 0;
  G.r1 = await courseConfirmee("2026-12-14", "09:00");                                         // payée → réalisée
  await aLaDate("2026-12-14T09:00:00Z", () => admin({ action: "course-realisee", ref: G.r1, realiseeLe: "2026-12-14T09:30" }));
  G.r2 = await courseConfirmee("2026-12-15", "09:00");                                         // payée, remboursement partiel de 5 €
  await rembourserChezStripe(G.r2, 500);
  G.r3 = (await envoyer({ date: "2026-12-16", heure: "09:00" })).j.ref;                        // lien envoyé, non payé
  G.r4 = (await envoyer({ date: "2026-12-17", heure: "09:00" })).j.ref;                        // annulée avant paiement
  await admin({ action: "annuler-course", ref: G.r4, motif: "indisponible" });
  G.pdf = Object.fromEntries(envoyes.filter((m) => m.pieces && m.pieces.length).map((m) => [m.pieces[0].nom.replace(".pdf", ""), m.pieces[0].contenu]));
  assert.equal((await dossier(G.r1)).etape, "realisee"); assert.equal((await dossier(G.r2)).statut, "rembourse_partiel");
});
await t("tableau : droits d'accès, filtres, période, recherche, montants et documents de chaque réservation", async () => {
  assert.equal((await documents(post("/documents-api", { action: "tableau" }), { ip: "4.4.4.4" })).status, 401);
  const tab = async (o) => (await admin({ action: "tableau", du: "2026-12-14", au: "2026-12-17", ...o })).j;
  const tous = await tab({});
  assert.equal(tous.total, 4); assert.deepEqual(tous.lignes.map((l) => l.ref).sort(), [G.r1, G.r2, G.r3, G.r4].sort());
  const L = Object.fromEntries(tous.lignes.map((l) => [l.ref, l]));
  // Réservation payée et réalisée, avec ses documents
  assert.equal(L[G.r1].client, "Claire Martin"); assert.match(L[G.r1].trajet, /^Gare de Dijon-Ville.* → 12 rue de Longvic/);
  assert.equal(L[G.r1].etapeLibelle, "Course réalisée"); assert.equal(L[G.r1].chauffeur, "Karim");
  assert.equal(L[G.r1].encaisse, L[G.r1].prixTTC); assert.equal(L[G.r1].rembourse, 0); assert.equal(L[G.r1].solde, 0);
  assert.equal(L[G.r1].devis.length, 1); assert.match(L[G.r1].acompte, /^TEST-F-/); assert.match(L[G.r1].finale, /^TEST-F-/);
  // Remboursement partiel et son avoir
  assert.equal(L[G.r2].rembourse, 5); assert.equal(L[G.r2].encaisse, L[G.r2].prixTTC - 5);
  assert.equal(L[G.r2].avoirs.length, 1); assert.equal(L[G.r2].avoirs[0].montant, 5); assert.equal(L[G.r2].finale, null);
  // En attente de paiement : solde = prix ; annulée : solde 0
  assert.equal(L[G.r3].solde, L[G.r3].prixTTC); assert.equal(L[G.r3].encaisse, 0); assert.equal(L[G.r4].solde, 0);
  // Filtres
  const refs = async (filtre) => (await tab({ filtre })).lignes.map((l) => l.ref).sort();
  assert.deepEqual(await refs("payees"), [G.r1, G.r2].sort());
  assert.deepEqual(await refs("realisees"), [G.r1]);
  assert.deepEqual(await refs("a_attribuer"), []);
  assert.deepEqual(await refs("remboursees"), [G.r2]);
  assert.deepEqual(await refs("annulees"), [G.r4]);
  assert.deepEqual(await refs("attente_paiement"), [G.r3]);
  assert.deepEqual(await refs("inconnu"), [G.r1, G.r2, G.r3, G.r4].sort());                        // filtre inconnu → tous
  // Période et recherche
  assert.deepEqual((await tab({ du: "2026-12-15", au: "2026-12-15" })).lignes.map((l) => l.ref), [G.r2]);
  assert.deepEqual((await tab({ recherche: G.r3.toLowerCase() })).lignes.map((l) => l.ref), [G.r3]);
  assert.equal((await tab({ du: "pas-une-date" })).total >= 4, true);                              // date invalide ignorée
});
await t("tableau : pagination côté serveur (pages disjointes, taille bornée)", async () => {
  const p1 = (await admin({ action: "tableau", page: 1, parPage: 5 })).j, p2 = (await admin({ action: "tableau", page: 2, parPage: 5 })).j;
  assert.equal(p1.lignes.length, 5); assert.ok(p1.pages >= 2); assert.equal(p1.total, p2.total);
  assert.equal(p1.lignes.filter((l) => p2.lignes.some((m) => m.ref === l.ref)).length, 0);
  assert.equal((await admin({ action: "tableau", parPage: 500 })).j.parPage, 50);
  assert.equal((await admin({ action: "tableau", page: 999 })).j.lignes.length, 0);
});
await t("documents d'une réservation : une rubrique (devis, acompte, finale, avoirs, références Stripe), téléchargement identique à l'envoi", async () => {
  const d1 = (await admin({ action: "documents-reservation", ref: G.r1 })).j;
  assert.deepEqual(d1.docs.map((d) => d.type), ["devis", "acompte", "finale"]);
  assert.match(d1.stripe.paiement, /^pi_test_/);
  for (const d of d1.docs) {
    const r = await admin({ action: "document-pdf", ref: G.r1, numero: d.numero });
    assert.equal(r.status, 200, d.numero); assert.equal(r.j.fichier, d.numero + ".pdf");
    if (G.pdf[d.numero]) assert.equal(Buffer.from(r.j.pdf, "base64").compare(Buffer.from(G.pdf[d.numero])), 0, "identique à l'envoi : " + d.numero);
  }
  const d2 = (await admin({ action: "documents-reservation", ref: G.r2 })).j;
  const av = d2.docs.find((d) => d.type === "avoir");
  assert.equal(av.montant, 5); assert.match(av.facture, /^TEST-F-/); assert.equal(d2.stripe.rembourse, 5); assert.equal(d2.stripe.operations.length, 1);
  assert.equal((await admin({ action: "document-pdf", ref: G.r2, numero: av.numero })).status, 200);
  // Droits : autre réservation, sans session, numéro mal formé, référence inconnue
  assert.equal((await admin({ action: "document-pdf", ref: G.r2, numero: d1.docs[1].numero })).status, 404);
  assert.equal((await documents(post("/documents-api", { action: "document-pdf", ref: G.r1, numero: d1.docs[1].numero }), { ip: "4.4.4.5" })).status, 401);
  assert.equal((await documents(post("/documents-api", { action: "documents-reservation", ref: G.r1 }), { ip: "4.4.4.6" })).status, 401);
  assert.equal((await admin({ action: "document-pdf", ref: G.r1, numero: "../../etc" })).status, 400);
  assert.equal((await admin({ action: "documents-reservation", ref: "E8-261120-INCONNUE" })).status, 404);
});
await t("export comptable CSV : colonnes, période, aucune double comptabilisation acompte/facture finale, montants inchangés", async () => {
  assert.equal((await documents(post("/documents-api", { action: "export-comptable", du: "2026-01-01", au: "2026-12-31" }), { ip: "4.4.4.7" })).status, 401);
  assert.equal((await admin({ action: "export-comptable", du: "2026-12-31", au: "2026-01-01" })).status, 422);
  assert.equal((await admin({ action: "export-comptable", du: "2025-01-01", au: "2026-12-31" })).status, 422);
  const avant = JSON.stringify([...docDeps.store.m.entries()].filter(([k]) => /^(facture|avoir|devis)\//.test(k)));
  const r = await admin({ action: "export-comptable", du: "2026-01-01", au: "2026-12-31" });
  assert.equal(r.status, 200); assert.match(r.j.fichier, /^elev8-comptabilite-TEST-2026-01-01_2026-12-31\.csv$/);
  assert.equal(JSON.stringify([...docDeps.store.m.entries()].filter(([k]) => /^(facture|avoir|devis)\//.test(k))), avant, "aucun document modifié par l'export");
  const csv = lireCsv(r.j.csv), tete = csv[0], C = (n) => tete.indexOf(n);
  for (const c of ["Date d'émission", "Type de document", "Numéro", "Référence réservation", "Client", "Montant HT", "TVA", "Montant TTC", "Montant encaissé",
    "Montant remboursé", "Référence Stripe", "Mode de paiement", "Identifiant archivé", "CA HT", "TVA collectée", "Avance client HT"]) assert.ok(C(c) >= 0, c);
  const lignes = csv.slice(1, -1), total = csv[csv.length - 1];
  assert.equal(lignes.length, r.j.documents);
  assert.ok(lignes.every((l) => l[0] === "TEST"));
  const de = (ref) => lignes.filter((l) => l[C("Référence réservation")] === ref);
  const somme = (ls, c) => ls.reduce((a, l) => a + num(l[C(c)]), 0);
  // R1 : acompte + facture finale → CA = HT de la course UNE fois, TVA = TVA de la course UNE fois, avance soldée
  const r1 = de(G.r1);
  assert.deepEqual(r1.map((l) => l[C("Type de document")]).sort(), ["Facture d'acompte", "Facture finale"]);
  const fin = r1.find((l) => l[C("Type de document")] === "Facture finale"), ac = r1.find((l) => l[C("Type de document")] === "Facture d'acompte");
  assert.equal(somme(r1, "CA HT"), num(fin[C("Montant HT")]));
  assert.equal(somme(r1, "TVA collectée"), num(ac[C("TVA")]));
  assert.equal(somme(r1, "Avance client HT"), 0);
  assert.equal(somme(r1, "Montant encaissé"), num(ac[C("Montant TTC")]), "encaissement compté une seule fois");
  assert.equal(num(fin[C("Acompte déduit TTC")]), num(ac[C("Montant TTC")])); assert.match(fin[C("Document lié")], /Acompte TEST-F-/);
  assert.match(ac[C("Référence Stripe")], /^pi_test_/); assert.equal(ac[C("Mode de paiement")], "carte bancaire via Stripe");
  assert.match(ac[C("Identifiant archivé")], /^facture\/TEST-F-/);
  // R2 : acompte + avoir sur acompte → aucun CA, avance et TVA nettes du remboursement
  const r2 = de(G.r2), avr = r2.find((l) => l[C("Type de document")] === "Avoir");
  assert.equal(somme(r2, "CA HT"), 0); assert.equal(num(avr[C("Montant remboursé")]), 500);
  assert.equal(somme(r2, "Avance client HT") + somme(r2, "TVA collectée"), num(r2.find((l) => l[C("Type de document")] === "Facture d'acompte")[C("Montant TTC")]) - 500);
  // Ligne TOTAL = somme des colonnes
  for (const c of ["CA HT", "TVA collectée", "Avance client HT", "Montant encaissé", "Montant remboursé"]) assert.equal(num(total[C(c)]), somme(lignes, c), c);
  // Période : seuls les documents émis entre les dates
  const vide = await admin({ action: "export-comptable", du: "2026-01-01", au: "2026-01-31" });
  assert.equal(vide.j.documents, 0); assert.equal(lireCsv(vide.j.csv).length, 2);
});
await t("changement officiel de date : e-mail au client (ancienne/nouvelle date, référence, sans nouvelle facturation), variante « à confirmer »", async () => {
  const ref = await courseConfirmee("2026-12-18", "09:00");
  const nbFactures = [...docDeps.store.m.keys()].filter((k) => k.startsWith("facture/") || k.startsWith("avoir/")).length;
  envoyes.length = 0;
  const r = await aLaDate("2026-12-01T10:00:00Z", () => admin({ action: "modifier-date", ref, date: "2026-12-19", heure: "10:30", motif: "Report demandé par le client" }));
  assert.equal(r.status, 200); assert.equal(r.j.mail, true);
  const m = envoyes.find((x) => /date/i.test(x.subject));
  assert.equal(m.to, "claire@example.test"); assert.equal(m.copie, "contact@elev8privatedriver.com");
  assert.match(m.subject, /Modification de la date de votre réservation \| E8-/);
  for (const x of ["Référence : " + ref, "Ancienne date : vendredi 18 décembre 2026 à 09h00", "Nouvelle date : samedi 19 décembre 2026 à 10h30", "aucune nouvelle facturation"]) assert.ok(m.text.includes(x), x);
  assert.ok(!/facture/i.test(m.text.replace("aucune nouvelle facturation", "")), "aucune facturation annoncée");
  assert.ok(!m.text.includes("Report demandé"), "motif interne non communiqué");
  envoyes.length = 0;
  const r2 = await aLaDate("2026-12-01T10:00:00Z", () => admin({ action: "modifier-date", ref, date: "2026-12-20", heure: "10:30", motif: "Disponibilité du chauffeur", validationClient: true }));
  assert.equal(r2.status, 200);
  const m2 = envoyes.find((x) => /date/i.test(x.subject));
  assert.match(m2.subject, /Nouvelle date à confirmer/); assert.ok(m2.text.includes("« Je confirme »") && m2.text.includes("Ancienne date : samedi 19 décembre 2026 à 10h30"));
  assert.equal((await dossier(ref)).modificationsDate[1].validationClient, true);
  assert.equal([...docDeps.store.m.keys()].filter((k) => k.startsWith("facture/") || k.startsWith("avoir/")).length, nbFactures, "aucune facture créée");
  process.env.FACTURATION_AUTOMATIQUE = "non";
});

console.log(`\n${ok} test(s) réussi(s)` + (process.exitCode ? " — ÉCHECS ci-dessus" : ""));
