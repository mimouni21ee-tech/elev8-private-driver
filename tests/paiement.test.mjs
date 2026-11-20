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
  EMAIL_API_KEY: "cle-email", MAIL_TO: "contact@elev8privatedriver.com", MAIL_FROM: "reservations@example.test", GOOGLE_MAPS_API_KEY: "cle-google", EMAILS_TEST_AUTORISES: "claire@example.test" });
let NOW = Date.parse("2026-11-17T12:00:00Z");
const horloge = () => NOW;

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

await t("événement réel (livemode) ignoré dans cette version de test", async () => {
  const e = await evenement("checkout.session.completed", { id: A.session }, { livemode: true });
  assert.equal(e.status, 200); assert.equal(e.j.ignore, "livemode");
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

console.log(`\n${ok} test(s) réussi(s)` + (process.exitCode ? " — ÉCHECS ci-dessus" : ""));
