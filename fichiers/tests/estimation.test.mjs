/* Tests automatisés : estimation tarifaire et envoi de la demande sans paiement.
   Lancement : node tests/estimation.test.mjs   (aucun service extérieur appelé : réponses simulées) */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import * as EST from "../netlify/lib/estimation.mjs";
import handler, { deps as resDeps, idemKey } from "../netlify/functions/reservation.mjs";
import estimationHandler from "../netlify/functions/estimation.mjs";

let ok = 0;
const t = async (nom, f) => { try { await f(); ok++; console.log("✓ " + nom); } catch (e) { console.error("✗ " + nom + "\n  " + (e && e.stack || e)); process.exitCode = 1; } };

/* ---------- Faux services ---------- */
const DIJON_GARE = { lat: 47.3233, lon: 5.0274 }, DIJON_SUD = { lat: 47.2900, lon: 5.0500 }, GENEVE = { lat: 46.2382, lon: 6.1089 };
const LIEUX = { "gare de dijon-ville, 21000 dijon, france": DIJON_GARE, "12 rue de longvic, 21000 dijon, france": DIJON_SUD, "aéroport de genève, genève, suisse": GENEVE };
let appels = [];
function fauxFetch({ km = 8.3, min = 15, google = true } = {}) {
  return async (url, init = {}) => {
    appels.push(String(url).split("?")[0]);
    const rep = (o, s = 200) => ({ ok: s < 400, status: s, json: async () => o });
    if (String(url).startsWith("https://routes.googleapis.com")) {
      if (!google) return rep({}, 403);
      const b = JSON.parse(init.body), a = LIEUX[b.origin.address.toLowerCase()], z = LIEUX[b.destination.address.toLowerCase()];
      if (!a || !z) return rep({ routes: [] });
      return rep({ routes: [{ distanceMeters: km * 1000, duration: min * 60 + "s", legs: [{ startLocation: { latLng: { latitude: a.lat, longitude: a.lon } }, endLocation: { latLng: { latitude: z.lat, longitude: z.lon } } }] }] });
    }
    if (String(url).startsWith("https://photon.komoot.io") || String(url).startsWith("https://data.geopf.fr/geocodage")) {
      const q = new URL(url).searchParams.get("q").toLowerCase(), p = LIEUX[q];
      return rep({ features: p ? [{ geometry: { coordinates: [p.lon, p.lat] }, properties: { score: 0.9 } }] : [] });
    }
    if (String(url).startsWith("https://data.geopf.fr/navigation/itineraire")) return rep({ distance: km, duration: min });
    throw new Error("URL inattendue " + url);
  };
}
function fauxStore() {
  const m = new Map(); let v = 0;
  return {
    m,
    async get(k) { return m.has(k) ? structuredClone(m.get(k).d) : null; },
    async getWithMetadata(k) { return m.has(k) ? { data: structuredClone(m.get(k).d), etag: m.get(k).e } : null; },
    async setJSON(k, d, o = {}) {
      if (o.onlyIfNew && m.has(k)) return { modified: false };
      if (o.onlyIfMatch && (!m.has(k) || m.get(k).e !== o.onlyIfMatch)) return { modified: false };
      m.set(k, { d: structuredClone(d), e: "e" + (++v) }); return { modified: true };
    },
    async delete(k) { m.delete(k); },
    async list({ prefix }) { return { blobs: [...m.keys()].filter((k) => k.startsWith(prefix)).map((key) => ({ key })) }; }
  };
}

process.env.GOOGLE_MAPS_API_KEY = "cle-de-test";
process.env.EMAIL_API_KEY = "cle-email-de-test";
process.env.MAIL_TO = "contact@elev8privatedriver.com";
process.env.MAIL_FROM = "reservations@example.test";
EST.deps.now = () => Date.parse("2026-11-17T12:00:00Z");
const base = { prestation: "Transferts gares", depart: "Gare de Dijon-Ville, 21000 Dijon, France", destination: "12 rue de Longvic, 21000 Dijon, France",
  date: "2026-11-18", heure: "10:00", vehicule: "Tesla Model Y", passagers: 2 };

/* ---------- 1. Grille inchangée ---------- */
await t("moteur de calcul identique à la préproduction ; grille ELEV8 du 17 nov. 2026", async () => {
  const h = (f) => createHash("sha256").update(readFileSync(f)).digest("hex").slice(0, 16);
  assert.equal(h(new URL("../netlify/lib/grille/dijon-tarif.cjs", import.meta.url)), "74628511857cd825");
  const T = (await import("../netlify/lib/grille/dijon-config.cjs")).default.tarifs.trajets;
  assert.deepEqual(T.minimum, { confort: { jour: 20, majore: 15 }, van: { jour: 20, majore: 25 } });
  assert.deepEqual(T.tarifKm, { confort: { jour: 1.90, majore: 2.75 }, van: { jour: 2.25, majore: 3.25 } });
});
await t("jour, Tesla : 8,3 km × 1,90 € = 15,77 € → minimum 20 €", async () => {
  EST._reset(); EST.deps.fetch = fauxFetch();
  const r = await EST.estimer(base);
  assert.equal(r.statut, "estimation"); assert.equal(r.montant, 20); assert.equal(r.categorie, "confort"); assert.equal(r.distanceKm, 8.3);
  assert.match(r.lignes[0].detail, /1,90 € .*minimum 20 € appliqué/);
});
await t("jour, Tesla, 15 km : 15 × 1,90 € = 28,50 €", async () => {
  EST._reset(); EST.deps.fetch = fauxFetch({ km: 15 });
  assert.equal((await EST.estimer(base)).montant, 28.5);
  EST._reset(); EST.deps.fetch = fauxFetch();
});
await t("jour, Classe V : minimum 20 € appliqué", async () => {
  const r = await EST.estimer({ ...base, vehicule: "Mercedes-Benz Classe V" });
  assert.equal(r.montant, 20); assert.equal(r.categorie, "van");
});
await t("nuit (20 h) : 8,3 × 2,75 = 22,83 €", async () => {
  assert.equal((await EST.estimer({ ...base, heure: "20:00" })).montant, 22.83);
});
await t("dimanche (22 nov. 2026, 10 h) : tarif majoré", async () => {
  assert.equal((await EST.estimer({ ...base, date: "2026-11-22" })).montant, 22.83);
});
await t("jour férié (25 déc. 2026) : tarif majoré", async () => {
  assert.equal((await EST.estimer({ ...base, date: "2026-12-25" })).montant, 22.83);
});
await t("court trajet de nuit : minimum 15 € (Confort)", async () => {
  EST._reset(); EST.deps.fetch = fauxFetch({ km: 2 });
  assert.equal((await EST.estimer({ ...base, heure: "23:00" })).montant, 15);
  EST._reset(); EST.deps.fetch = fauxFetch();
});
await t("« Pas de préférence » : Confort jusqu'à 4 passagers, Van au-delà", async () => {
  assert.equal((await EST.estimer({ ...base, vehicule: "Pas de préférence", passagers: 4 })).categorie, "confort");
  assert.equal((await EST.estimer({ ...base, vehicule: "Pas de préférence", passagers: 5 })).categorie, "van");
});
await t("aller-retour : chaque trajet calculé séparément (jour 20 € + nuit 22,83 €)", async () => {
  const r = await EST.estimer({ ...base, allerRetour: true, dateRetour: "2026-11-18", heureRetour: "21:00" });
  assert.equal(r.montant, 42.83); assert.equal(r.lignes.length, 2);
});
await t("retour avant l'aller : refusé", async () => {
  await assert.rejects(EST.estimer({ ...base, allerRetour: true, dateRetour: "2026-11-18", heureRetour: "09:00" }), { code: "retour" });
});
await t("hors zone (Genève) : sur devis, aucun montant", async () => {
  const r = await EST.estimer({ ...base, destination: "Aéroport de Genève, Genève, Suisse" });
  assert.equal(r.statut, "sur_devis"); assert.equal(r.motif, "hors_zone"); assert.equal(r.montant, undefined);
});
await t("mise à disposition : sur devis, sans calcul d'itinéraire", async () => {
  appels = [];
  const r = await EST.estimer({ ...base, prestation: "Mise à disposition" });
  assert.equal(r.statut, "sur_devis"); assert.equal(r.motif, "mise_a_disposition"); assert.equal(appels.length, 0);
});
await t("relais gratuit (Google refusé) : même prix via IGN", async () => {
  EST._reset(); EST.deps.fetch = fauxFetch({ google: false }); appels = [];
  const r = await EST.estimer(base);
  assert.equal(r.montant, 20); assert.equal(r.source, "ign");
  assert.ok(appels.includes("https://data.geopf.fr/navigation/itineraire"));
  EST._reset(); EST.deps.fetch = fauxFetch();
});
await t("adresse introuvable : erreur explicite (la demande reste possible)", async () => {
  EST._reset(); EST.deps.fetch = fauxFetch({ google: false });
  await assert.rejects(EST.estimer({ ...base, depart: "Lieu imaginaire" }), { code: "lieu_inconnu" });
  EST._reset(); EST.deps.fetch = fauxFetch();
});
await t("date passée : refusée", async () => {
  await assert.rejects(EST.estimer({ ...base, date: "2026-11-16" }), { code: "passe" });
});

/* ---------- 2. Jeton signé ---------- */
await t("jeton : accepté pour la même demande, refusé si le montant, l'adresse ou le véhicule changent", async () => {
  const r = await EST.estimer(base); r.jeton = EST.signer(r);
  const rt = JSON.parse(JSON.stringify(r));
  assert.equal(EST.verifier(rt, base).montant, 20);
  assert.equal(EST.verifier({ ...rt, montant: 1 }, base), null);
  assert.equal(EST.verifier(rt, { ...base, destination: "Ailleurs" }), null);
  assert.equal(EST.verifier(rt, { ...base, vehicule: "Mercedes-Benz Classe V" }), null);
  const now = EST.deps.now; EST.deps.now = () => now() + 25 * 3600_000;
  assert.equal(EST.verifier(rt, base), null);
  EST.deps.now = now;
});

/* ---------- 3. Fonction /estimation ---------- */
const req = (path, body, h = {}) => new Request("https://elev8privatedriver.com" + path, { method: "POST", headers: { "content-type": "application/json", origin: "https://elev8privatedriver.com", ...h }, body: JSON.stringify(body) });
await t("/estimation : renvoie le montant et un jeton, sans aucune donnée personnelle demandée", async () => {
  const r = await (await estimationHandler(req("/estimation", base), { ip: "1.2.3.4" })).json();
  assert.equal(r.ok, true); assert.equal(r.estimation.montant, 20); assert.ok(r.estimation.jeton.sig);
});
await t("/estimation : autre origine refusée", async () => {
  assert.equal((await estimationHandler(req("/estimation", base, { origin: "https://pirate.example" }), {})).status, 403);
});

/* ---------- 4. Envoi de la demande ---------- */
const envoyes = [];
resDeps.send = async (m) => { envoyes.push(m); };
const store = fauxStore(); resDeps.store = store;
const demande = (extra = {}) => ({ ...base, nom: "Martin", prenom: "Claire", telephone: "+33612345678", email: "claire@example.test", bagages: "2",
  precisions: "Remorque à vélo, attente 10 min", duree: 9000, website: "", origine: { code: "carte", libelle: "Carte de visite", utm: {} }, ...extra });
const idDemande = () => Math.floor(Date.now() / 1000) + "-" + Math.random().toString(36).slice(2, 16).padEnd(14, "x");

await t("demande sans paiement : e-mail complet, statut « en attente de validation », estimation du serveur", async () => {
  envoyes.length = 0;
  const est = (await (await estimationHandler(req("/estimation", base), { ip: "1.2.3.5" })).json()).estimation;
  const r = await handler(req("/envoi-reservation", demande({ estimation: est, demandeId: idDemande() })), { ip: "5.6.7.8" });
  const j = await r.json();
  assert.equal(r.status, 200); assert.equal(j.ok, true); assert.match(j.ref, /^E8-\d{6}-[A-Z2-9]{3}$/);
  assert.equal(j.statut, "demande_recue"); assert.equal(j.estimation.montant, 20);
  assert.equal(envoyes.length, 1);
  const m = envoyes[0];
  for (const attendu of ["en attente de validation", "20 €", "Remorque à vélo", "Bagages : 2", "Aller simple", "Carte de visite", "Claire Martin", "+33612345678", "Le client n'a rien payé"])
    assert.ok(m.text.includes(attendu), "absent de l'e-mail : " + attendu);
  assert.ok(!/réservation (est )?confirmée/i.test(m.text), "l'e-mail ne doit jamais annoncer une réservation confirmée");
  assert.ok(!/acompte|paiement requis/i.test(m.text));
  assert.match(m.subject, /^\[À valider\] Demande E8-/);
  assert.ok(m.html.includes("Proposer un tarif ajusté"));
});
await t("montant falsifié dans le navigateur : ignoré, recalculé par le serveur", async () => {
  envoyes.length = 0;
  const est = (await (await estimationHandler(req("/estimation", base), { ip: "1.2.3.6" })).json()).estimation;
  est.montant = 1;
  const j = await (await handler(req("/envoi-reservation", demande({ estimation: est, demandeId: idDemande() })), { ip: "5.6.7.9" })).json();
  assert.equal(j.estimation.montant, 20); assert.ok(envoyes[0].text.includes("Estimation : 20 €")); assert.ok(!envoyes[0].text.includes(" 1 €"));
});
await t("double clic / renvoi : un seul e-mail, même référence", async () => {
  envoyes.length = 0;
  const id = idDemande(), body = demande({ demandeId: id });
  const [a, b] = await Promise.all([handler(req("/envoi-reservation", body), { ip: "9.9.9.1" }), handler(req("/envoi-reservation", body), { ip: "9.9.9.1" })]);
  const c = await handler(req("/envoi-reservation", body), { ip: "9.9.9.1" });
  const ja = await a.json(), jb = await b.json(), jc = await c.json();
  assert.equal(envoyes.length, 1);
  const okRef = [ja, jb].find((x) => x.ok).ref;
  assert.equal(jc.ok, true); assert.equal(jc.ref, okRef); assert.equal(jc.deja, true);
  assert.ok([ja, jb].some((x) => x.error === "pending" || x.deja));
});
await t("échec d'envoi : la demande peut être renvoyée", async () => {
  envoyes.length = 0; const id = idDemande();
  resDeps.send = async () => { throw new Error("provider:500"); };
  assert.equal((await handler(req("/envoi-reservation", demande({ demandeId: id })), { ip: "9.9.9.2" })).status, 502);
  resDeps.send = async (m) => { envoyes.push(m); };
  assert.equal((await handler(req("/envoi-reservation", demande({ demandeId: id })), { ip: "9.9.9.3" })).status, 200);
  assert.equal(envoyes.length, 1);
});
await t("hors zone : demande transmise « tarif à établir », sans montant", async () => {
  envoyes.length = 0;
  const j = await (await handler(req("/envoi-reservation", demande({ destination: "Aéroport de Genève, Genève, Suisse", demandeId: idDemande() })), { ip: "9.9.9.4" })).json();
  assert.equal(j.ok, true); assert.equal(j.estimation.statut, "sur_devis"); assert.equal(j.estimation.montant, null);
  assert.ok(envoyes[0].text.includes("Tarif à établir par ELEV8"));
});
await t("calcul indisponible : la demande part quand même", async () => {
  envoyes.length = 0; EST._reset();
  EST.deps.fetch = async () => { throw new Error("réseau"); };
  const j = await (await handler(req("/envoi-reservation", demande({ demandeId: idDemande() })), { ip: "9.9.9.5" })).json();
  assert.equal(j.ok, true); assert.equal(envoyes.length, 1); assert.ok(envoyes[0].text.includes("Tarif à établir"));
  EST.deps.fetch = fauxFetch();
});
await t("aller-retour : retour avant l'aller refusé par le serveur", async () => {
  const r = await handler(req("/envoi-reservation", demande({ allerRetour: true, dateRetour: "2026-11-18", heureRetour: "08:00", demandeId: idDemande() })), { ip: "9.9.9.6" });
  assert.equal(r.status, 422); assert.deepEqual((await r.json()).fields, ["heureRetour"]);
});
await t("identifiant anti-doublon : format et durée de validité contrôlés", () => {
  const now = Date.now(), s = Math.floor(now / 1000);
  assert.ok(idemKey(s + "-abcdefghijkl", now));
  assert.equal(idemKey("../../x", now), "");
  assert.equal(idemKey((s - 2 * 86400) + "-abcdefghijkl", now), "");
});

console.log(`\n${ok} test(s) réussi(s)` + (process.exitCode ? " — ÉCHECS ci-dessus" : ""));
