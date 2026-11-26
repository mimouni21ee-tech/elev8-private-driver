/* Tests automatisés : espace chauffeur (courses saisies sur place).
   Lancement : node tests/chauffeur.test.mjs
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
      payment_method_types: [corps.get("payment_method_types[0]")], mode: corps.get("mode"), success_url: corps.get("success_url"), payment_intent: null,
      texteCgv: corps.get("custom_text[submit][message]") };
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
const SP = await import("../netlify/lib/sur-place.mjs");
const { default: chauffeur, deps: chDeps, creerSession: sessionChauffeur } = await import("../netlify/functions/chauffeur.mjs");
const { default: payer } = await import("../netlify/functions/payer.mjs");
const { default: webhook } = await import("../netlify/functions/stripe-webhook.mjs");
const { default: documents, deps: docDeps, creerSession: sessionDocuments } = await import("../netlify/functions/documents.mjs");
const { suivre } = await import("../netlify/functions/suivi-paiements.mjs");
const GES = await import("../netlify/lib/gestion.mjs");

STR.deps.fetch = fauxStripe; STR.deps.now = horloge; PAI.deps.now = horloge; EST.deps.now = horloge; docDeps.now = horloge; chDeps.now = horloge;
PAI.deps.store = fauxStore(); DEM.deps.store = fauxStore(); docDeps.store = fauxStore();
const envoyes = [];
MAIL.deps.send = async (m) => { envoyes.push(m); };
const DEVIS = await import("../netlify/lib/devis-auto.mjs");
{ const { readFileSync } = await import("node:fs"); const sb = {}; new Function("window", readFileSync(new URL("../public/config.js", import.meta.url), "utf8"))(sb); DEVIS.deps.config = sb.SITE_CONFIG; docDeps.config = sb.SITE_CONFIG; }
DEVIS.deps.store = docDeps.store;
// Itinéraire simulé : Grand Hôtel La Cloche → BMW (≈ 8,3 km dans Dijon)
let routeKm = 8300;
EST.deps.fetch = async (url) => {
  if (!String(url).startsWith("https://routes.googleapis.com")) throw new Error("URL inattendue " + url);
  return { ok: true, status: 200, json: async () => ({ routes: [{ distanceMeters: routeKm, duration: "900s", legs: [{ startLocation: { latLng: { latitude: 47.3233, longitude: 5.0274 } }, endLocation: { latLng: { latitude: 47.29, longitude: 5.05 } } }] }] }) };
};
SP.deps.reverse = async (lat, lon) => (Math.abs(lat - 47.3226) < 0.01 ? "14 Place Darcy 21000 Dijon" : null);

const ORIGINE = "https://elev8privatedriver.com";
let ipN = 0;
async function ch(body, { session = JETON } = {}) {
  const r = await chauffeur(new Request(ORIGINE + "/chauffeur-api", { method: "POST", headers: { "content-type": "application/json", origin: ORIGINE }, body: JSON.stringify({ session, ...body }) }), { ip: "9.9.9." + (++ipN % 250) });
  return { status: r.status, j: await r.json() };
}
let nEvt = 0;
const signer = (corps, ts = Math.floor(NOW / 1000)) => `t=${ts},v1=${createHmac("sha256", SECRET).update(`${ts}.${corps}`).digest("hex")}`;
async function evenement(type, objet) {
  const corps = JSON.stringify({ id: "evt_ch_" + (++nEvt), object: "event", type, livemode: false, data: { object: objet } });
  const r = await webhook(new Request(ORIGINE + "/stripe-webhook", { method: "POST", headers: { "stripe-signature": signer(corps), "content-type": "application/json" }, body: corps }));
  return { status: r.status };
}
const ouvrir = async (lien) => { const r = await payer(new Request(ORIGINE + lien), { params: { jeton: lien.split("/").pop() } }); return { status: r.status, loc: r.headers.get("location") }; };
const dossier = (ref) => PAI.parRef(PAI.magasin(), ref);
const course = (extra = {}) => ({ action: "creer", depart: "Grand Hôtel La Cloche, 14 Place Darcy, 21000 Dijon", destination: "BMW Hénin, 21000 Dijon", vehicule: "confort", passagers: 1,
  montant: 20, client: { prenom: "Paul", nom: "Durand", telephone: "06 12 34 56 78" }, apporteur: "Voiturier La Cloche", ...extra });

let JETON = null;
/* ====================================================================== */
await t("accès : mot de passe → session d'1 an ; mauvais mot de passe, session falsifiée ou session /documents refusés", async () => {
  let r = await ch({ action: "connexion", motDePasse: "faux-mot-de-passe" }, { session: undefined });
  assert.equal(r.status, 401);
  r = await ch({ action: "connexion", motDePasse: "mot-de-passe-de-test" }, { session: undefined });
  assert.equal(r.status, 200); assert.match(r.j.session, /^c1\./); assert.equal(r.j.stripe, true);
  JETON = r.j.session;
  const exp = Number(JETON.split(".")[1]); assert.ok(exp - NOW > 364 * 86400_000);
  assert.equal((await ch({ action: "verifier" })).status, 200);
  assert.equal((await ch({ action: "verifier" }, { session: JETON.slice(0, -2) + "xx" })).status, 401);
  // la session /documents n'ouvre pas l'espace chauffeur, et inversement
  assert.equal((await ch({ action: "verifier" }, { session: sessionDocuments(NOW, 86400_000).jeton })).status, 401);
  const { sessionOk } = await import("../netlify/functions/documents.mjs");
  assert.equal(sessionOk(JETON, NOW), false);
});

await t("session prolongée automatiquement : utilisée après 2 mois, elle est renouvelée pour 1 an ; changer le mot de passe déconnecte", async () => {
  const ancien = NOW; NOW += 70 * 86400_000;
  const r = await ch({ action: "verifier" });
  assert.equal(r.status, 200); assert.ok(r.j.session && r.j.session !== JETON);
  assert.ok(Number(r.j.session.split(".")[1]) - NOW > 364 * 86400_000);
  JETON = r.j.session; NOW = ancien + 70 * 86400_000;
  const mdp = process.env.DOCUMENTS_MOT_DE_PASSE; process.env.DOCUMENTS_MOT_DE_PASSE = "nouveau-mot-de-passe";
  assert.equal((await ch({ action: "verifier" })).status, 401);
  process.env.DOCUMENTS_MOT_DE_PASSE = mdp;
  NOW = ancien;
  JETON = sessionChauffeur(NOW).jeton;
});

await t("Ma position : adresse retrouvée depuis le GPS ; position inconnue → message", async () => {
  let r = await ch({ action: "position", lat: 47.3226, lon: 5.0353 });
  assert.equal(r.j.adresse, "14 Place Darcy 21000 Dijon");
  r = await ch({ action: "position", lat: 10, lon: 10 }); assert.equal(r.status, 404);
  r = await ch({ action: "position", lat: "x", lon: 5 }); assert.equal(r.status, 404);
});

await t("prix : grille du site à l'heure actuelle (20 € minimum, puis au kilomètre) ; adresses manquantes refusées", async () => {
  let r = await ch({ action: "estimer", depart: "Grand Hôtel La Cloche, Dijon", destination: "BMW Hénin, Dijon", vehicule: "confort", passagers: 1 });
  assert.equal(r.j.estimation.statut, "estimation"); assert.equal(r.j.estimation.montant, 20); assert.equal(r.j.estimation.distanceKm, 8.3);
  routeKm = 30000;
  r = await ch({ action: "estimer", depart: "Grand Hôtel La Cloche, Dijon", destination: "Beaune centre", vehicule: "confort", passagers: 1 });
  assert.ok(r.j.estimation.montant > 20, "grille au kilomètre : " + r.j.estimation.montant);
  routeKm = 8300;
  r = await ch({ action: "estimer", depart: "", destination: "x" }); assert.equal(r.status, 422);
});

let C;
await t("validation : réservation horodatée (justificatif), dossier de paiement immédiat, chauffeur déjà confirmé, valable 24 h", async () => {
  const r = await ch(course());
  assert.equal(r.status, 200, JSON.stringify(r.j));
  C = r.j.course;
  assert.match(C.ref, /^E8-261117-[A-Z2-9]{3}$/); assert.match(C.lien, /^\/payer\/[A-Za-z0-9_-]{24}$/);
  assert.equal(C.montant, 20); assert.equal(C.statut, "en_attente"); assert.equal(C.reservationLe, new Date(NOW).toISOString());
  assert.equal(C.client.telephone, "+33612345678"); assert.equal(C.apporteur, "Voiturier La Cloche"); assert.equal(C.prixGrille, 20); assert.equal(C.ajustement, null);
  const p = await dossier(C.ref);
  assert.equal(p.chauffeur.prenom, "David"); assert.equal(p.chauffeur.vehicule, "Tesla Model Y"); assert.ok(p.surPlace);
  assert.equal(Date.parse(p.valableJusqu) - Date.parse(p.priseEnCharge), 24 * 3600_000);
  assert.ok(Math.abs(Date.parse(p.priseEnCharge) - NOW) < 60_000, "prise en charge = maintenant (heure de Paris)");
  const D = (await DEM.chargerParRef(DEM.magasin(), C.ref, NOW)).record;
  assert.equal(D.client.nom, "Durand"); assert.equal(D.prestation.type, "Course sur place"); assert.equal(D.surPlace.apporteur, "Voiturier La Cloche");
  assert.equal(D.origine, "Course sur place (saisie chauffeur)");
  // aucun e-mail au client à la saisie
  assert.equal(envoyes.length, 0);
});

await t("prix ajusté : motif obligatoire ; prix du téléphone jamais pris comme prix de grille ; champs manquants signalés", async () => {
  let r = await ch(course({ montant: 25 }));
  assert.equal(r.status, 422); assert.deepEqual(r.j.champs, ["motif"]); assert.match(r.j.message, /20,00 €/);
  r = await ch(course({ montant: 25, motif: "attente 15 min" }));
  assert.equal(r.status, 200); assert.deepEqual(r.j.course.ajustement, { de: 20, a: 25, motif: "attente 15 min" });
  r = await ch(course({ client: { nom: "", telephone: "123" }, montant: 0 }));
  assert.equal(r.status, 422); assert.deepEqual(r.j.champs.sort(), ["montant", "nom", "telephone"]);
  r = await ch(course({ quand: "plus_tard", date: "2026-11-17", heure: "08:00" }));     // 5 h dans le passé
  assert.equal(r.status, 422); assert.deepEqual(r.j.champs, ["horaire"]);
});

await t("paiement par QR code / SMS : le client paie sur Stripe → « Payée », chauffeur toujours confirmé, alerte ELEV8 adaptée", async () => {
  envoyes.length = 0;
  const o = await ouvrir(C.lien);
  assert.equal(o.status, 303);
  const id = o.loc.split("/").pop();
  const s = payerChezStripe(id);
  assert.equal((await evenement("checkout.session.completed", { id: s.id, object: "checkout.session" })).status, 200);
  const r = await ch({ action: "etat", ref: C.ref });
  assert.equal(r.j.course.statut, "paye"); assert.equal(r.j.course.etape, "chauffeur_confirme"); assert.equal(r.j.course.enLigne, true);
  const alerte = envoyes.find((m) => /Paiement reçu — course sur place/.test(m.subject));
  assert.ok(alerte, envoyes.map((m) => m.subject).join(" | "));
  assert.ok(!envoyes.some((m) => /course à attribuer/.test(m.subject)));
  // suivi horaire : aucune alerte « sans chauffeur »
  NOW += 3600_000; const b = await suivre(NOW); assert.equal(b.alertes, 0); NOW -= 3600_000;
});

await t("encaissement refusé si déjà payé en ligne ; « Course terminée » → course réalisée", async () => {
  let r = await ch({ action: "encaisser", ref: C.ref, moyen: "espèces" });
  assert.equal(r.status, 409);
  NOW += 20 * 60_000;
  r = await ch({ action: "terminer", ref: C.ref });
  assert.equal(r.status, 200, JSON.stringify(r.j)); assert.equal(r.j.course.etape, "realisee");
  r = await ch({ action: "terminer", ref: C.ref }); assert.equal(r.status, 409);
});

let H;
await t("TPE / Tap to Pay Indy : marqué payé hors Stripe, lien Stripe fermé, le client ne peut plus payer en ligne", async () => {
  const r0 = await ch(course({ client: { nom: "Lefèvre" } }));
  H = r0.j.course;
  const o = await ouvrir(H.lien); const id = o.loc.split("/").pop();
  assert.equal((await ch({ action: "encaisser", ref: H.ref, moyen: "virement" })).status, 422);
  const r = await ch({ action: "encaisser", ref: H.ref, moyen: "carte bancaire (Tap to Pay Indy)", reference: "INDY-4471" });
  assert.equal(r.status, 200);
  assert.equal(r.j.course.statut, "paye"); assert.equal(r.j.course.etape, "chauffeur_confirme");
  assert.deepEqual({ ...r.j.course.horsStripe, le: 0 }, { moyen: "carte bancaire (Tap to Pay Indy)", reference: "INDY-4471", le: 0 });
  assert.equal(S.sessions.get(id).status, "expired");
  const o2 = await ouvrir(H.lien); assert.match(o2.loc, /etat=deja/);
  assert.equal((await ch({ action: "encaisser", ref: H.ref, moyen: "espèces" })).status, 409);
});

await t("double paiement (payé en ligne juste après le TPE) → « à vérifier », remboursable par Stripe", async () => {
  const r0 = await ch(course({ client: { nom: "Bernard" } }));
  const X = r0.j.course;
  const o = await ouvrir(X.lien); const id = o.loc.split("/").pop();
  // le client paie en ligne au même moment : la fermeture du lien échoue, le paiement est détecté
  const s = payerChezStripe(id);
  let r = await ch({ action: "encaisser", ref: X.ref, moyen: "carte bancaire (TPE)" });
  assert.equal(r.status, 409); assert.match(r.j.message, /vient de payer en ligne/); assert.equal(r.j.course.statut, "paye");
  // cas extrême : marqué payé hors Stripe AVANT que Stripe ne confirme
  const r1 = await ch(course({ client: { nom: "Petit" } }));
  const Y = r1.j.course;
  const o1 = await ouvrir(Y.lien); const id1 = o1.loc.split("/").pop();
  await ch({ action: "encaisser", ref: Y.ref, moyen: "espèces" });
  const s1 = S.sessions.get(id1); s1.status = "open";                         // Stripe avait déjà accepté la carte
  payerChezStripe(id1);
  await evenement("checkout.session.completed", { id: id1, object: "checkout.session" });
  const p = await dossier(Y.ref);
  assert.equal(p.statut, "a_verifier"); assert.equal(p.motifVerification, "double_paiement_hors_stripe"); assert.ok(p.paymentIntent);
  void s;
});

await t("remboursement automatique impossible pour un paiement hors Stripe (message clair)", async () => {
  const { annulerEtRembourser } = await import("../netlify/lib/actions-paiement.mjs");
  const r = await annulerEtRembourser({ ref: H.ref, motif: "indisponible", now: NOW });
  assert.equal(r.erreur[0], 409); assert.match(r.erreur[1], /hors Stripe/);
});

await t("annulation avant paiement : lien désactivé ; impossible une fois payée", async () => {
  const r0 = await ch(course({ client: { nom: "Roux" } }));
  const Z = r0.j.course;
  await ouvrir(Z.lien);
  let r = await ch({ action: "annuler", ref: Z.ref });
  assert.equal(r.status, 200); assert.equal(r.j.course.statut, "annule");
  const o = await ouvrir(Z.lien); assert.match(o.loc, /annule-lien/);
  r = await ch({ action: "annuler", ref: H.ref }); assert.equal(r.status, 409);
});

await t("courses du jour : liste des courses saisies, plus récentes d'abord", async () => {
  const r = await ch({ action: "jour" });
  assert.equal(r.status, 200);
  assert.ok(r.j.courses.length >= 6);
  assert.ok(r.j.courses.some((c) => c.ref === H.ref && c.horsStripe));
  const t0 = r.j.courses.map((c) => c.reservationLe); assert.deepEqual(t0, [...t0].sort().reverse());
});

await t("facture /documents : mode hors Stripe imposé et prérempli ; « paiement en ligne Stripe » refusé ; journal des encaissements", async () => {
  const D = (await DEM.chargerParRef(DEM.magasin(), H.ref, NOW)).record;
  const doc = (mode) => ({ type: "facture", ref: H.ref, client: { nom: "Lefèvre", prenom: "" }, prestation: { date: D.prestation.date, heure: D.prestation.heure, depart: D.prestation.depart, destination: D.prestation.destination, vehicule: D.prestation.vehicule, passagers: 1 },
    montant: 20, supplements: [], facture: { datePrestation: D.prestation.date, paye: true, datePaiement: "", modePaiement: mode, referencePaiement: "" } });
  const admin = async (body) => { const r = await documents(new Request(ORIGINE + "/documents-api", { method: "POST", headers: { "content-type": "application/json", origin: ORIGINE }, body: JSON.stringify({ motDePasse: "mot-de-passe-de-test", ...body }) }), { ip: "8.8.4.4" }); return { status: r.status, j: r.headers.get("content-type").includes("json") ? await r.json() : null }; };
  let r = await admin({ action: "facture", doc: doc("paiement en ligne Stripe") });
  assert.equal(r.status, 422); assert.equal(r.j.code, "hors_stripe_mode");
  r = await admin({ action: "facture", doc: { ...doc("carte bancaire (Tap to Pay Indy)"), montant: 22 } });
  assert.equal(r.status, 422); assert.equal(r.j.code, "hors_stripe_montant");
  const csv = await GES.exportEncaissements({ du: "2026-11-17", au: "2026-11-17", origine: ORIGINE });
  const texte = typeof csv === "string" ? csv : JSON.stringify(csv);
  assert.ok(texte.includes("Paiement reçu hors Stripe (carte bancaire (Tap to Pay Indy))"), texte.slice(0, 400));
  assert.ok(texte.includes("INDY-4471"));
});

await t("page /chauffeur : non référencée, sans cache, position autorisée pour le site seulement", async () => {
  const { readFileSync } = await import("node:fs");
  const h = readFileSync(new URL("../public/_headers", import.meta.url), "utf8");
  assert.match(h, /Permissions-Policy: camera=\(\), microphone=\(\), geolocation=\(self\)/);
  assert.match(h, /\/chauffeur\/\*\n  X-Robots-Tag: noindex, nofollow\n  Cache-Control: no-store/);
  assert.match(readFileSync(new URL("../public/robots.txt", import.meta.url), "utf8"), /Disallow: \/chauffeur\//);
  const page = readFileSync(new URL("../public/chauffeur/index.html", import.meta.url), "utf8");
  assert.ok(page.includes('name="robots" content="noindex, nofollow"'));
  for (const s of page.match(/src="([^"]+)"/g)) assert.ok(/src="\//.test(s), "script local uniquement : " + s);
});

/* ====================== Compteur ELEV8 ====================== */
const CPT = await import("../netlify/lib/compteur.mjs");
await t("compteur : formule (prise en charge + km + temps lent, paliers de 0,10 €, minimum 10 €, péages en sus)", async () => {
  let r = CPT.calculer({ km: 3, lentSec: 180 });                 // 4,50 + 5,70 + 2,25 = 12,45 → palier 12,40
  assert.equal(r.brut, 12.4); assert.equal(r.total, 12.4);
  assert.ok(!r.lignes.some((l) => /Minimum/.test(l.libelle)));
  r = CPT.calculer({ km: 1, lentSec: 60 });                      // 4,50 + 1,90 + 0,75 = 7,15 → minimum 10 €
  assert.equal(r.total, 10); assert.ok(r.lignes.some((l) => /Minimum/.test(l.libelle)));
  r = CPT.calculer({ km: 45, lentSec: 600, peages: 3.4 });
  assert.equal(r.total, 100.9);
  assert.equal(r.lignes.at(-1).montant, 3.4);
  r = CPT.calculer({ km: -5, lentSec: -1 }); assert.equal(r.total, 10);
});

let K;
await t("compteur : départ → réservation horodatée avec les tarifs ; arrivée → prix serveur, dossier de paiement, QR", async () => {
  CPT.deps.route = async () => ({ distanceKm: 8.3 });
  CPT.deps.adresse = async () => "BMW Hénin, 21000 Dijon";
  let r = await ch({ action: "compteur-depart", depart: "Grand Hôtel La Cloche, Dijon", position: { lat: 47.3226, lon: 5.0353 }, vehicule: "confort", client: { nom: "Martin", telephone: "0611223344" } });
  assert.equal(r.status, 200, JSON.stringify(r.j)); K = r.j.compteur;
  assert.match(K.ref, /^E8-/); assert.equal(K.tarifs.km, 1.9);
  const D0 = (await DEM.chargerParRef(DEM.magasin(), K.ref, NOW)).record;
  assert.equal(D0.prestation.type, "Course au compteur"); assert.match(D0.prestation.precisions, /1,90 €\/km/); assert.equal(D0.estimation.montant, null);
  assert.equal((await ch({ action: "compteur-etat", ref: K.ref })).j.compteur.ref, K.ref);
  NOW += 25 * 60_000;
  r = await ch({ action: "compteur-arrivee", ref: K.ref, km: 9.1, lentSec: 420, peages: "0", position: { lat: 47.29, lon: 5.05 } });
  assert.equal(r.status, 200, JSON.stringify(r.j));
  const attendu = 27;                                             // 4,50 + 17,29 + 5,25 = 27,04 → palier 27,00
  assert.equal(r.j.course.montant, attendu); assert.equal(r.j.course.statut, "en_attente"); assert.match(r.j.course.lien, /^\/payer\//);
  assert.equal(r.j.course.trajet.destination, "BMW Hénin, 21000 Dijon");
  const D = (await DEM.chargerParRef(DEM.magasin(), K.ref, NOW)).record;
  assert.equal(D.estimation.montant, attendu); assert.equal(D.surPlace.compteur.kmItineraire, 8.3);
  // deuxième « Arrivée » (double appui) : renvoie la même course, ne recrée rien
  r = await ch({ action: "compteur-arrivee", ref: K.ref, km: 50 });
  assert.equal(r.j.course.montant, attendu);
  assert.equal((await ch({ action: "compteur-etat", ref: K.ref })).j.compteur, null);
  // la course apparaît dans la liste du jour et s'encaisse comme les autres
  assert.ok((await ch({ action: "jour" })).j.courses.some((c) => c.ref === K.ref));
  assert.equal((await ch({ action: "encaisser", ref: K.ref, moyen: "espèces" })).status, 200);
});

await t("compteur : GPS qui décroche → au moins la distance de l'itinéraire ; abandon sans facturation", async () => {
  CPT.deps.route = async () => ({ distanceKm: 40 });
  let r = await ch({ action: "compteur-depart", depart: "Gare de Dijon", position: { lat: 47.32, lon: 5.03 }, client: { nom: "Roy" } });
  const ref = r.j.compteur.ref;
  r = await ch({ action: "compteur-arrivee", ref, km: 12, lentSec: 0, position: { lat: 47.02, lon: 4.84 } });
  assert.equal(r.j.course.montant, 80.5);
  r = await ch({ action: "compteur-depart", depart: "Gare de Dijon", client: { nom: "Roy" } });
  const ref2 = r.j.compteur.ref;
  assert.equal((await ch({ action: "compteur-annuler", ref: ref2 })).status, 200);
  assert.equal((await DEM.chargerParRef(DEM.magasin(), ref2, NOW)).erreur, "introuvable");
  assert.equal((await ch({ action: "compteur-arrivee", ref: ref2, km: 5 })).status, 409);
  // Départ en un seul appui : sans nom ni adresse, le lieu vient du GPS
  CPT.deps.adresse = async () => "8 Rue de la Liberté 21000 Dijon";
  r = await ch({ action: "compteur-depart", position: { lat: 47.3226, lon: 5.0353 } });
  assert.equal(r.status, 200); assert.equal(r.j.compteur.depart.adresse, "8 Rue de la Liberté 21000 Dijon");
  r = await ch({ action: "compteur-depart" });
  assert.equal(r.status, 200); assert.equal(r.j.compteur.depart.adresse, "Lieu non renseigné");
  assert.equal((await ch({ action: "compteur-depart", client: { telephone: "123" } })).status, 422);
});

console.log("\n" + ok + " test(s) réussi(s)");
