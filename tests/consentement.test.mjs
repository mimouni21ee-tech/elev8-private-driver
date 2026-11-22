// Tests du bandeau de consentement et de la mesure Google Ads (public/assets/js/consentement.js).
// Lancement : npm i --no-save jsdom && node tests/consentement.test.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";

const lire = (f) => readFileSync(new URL(f, import.meta.url), "utf8");
const CONFIG = lire("../public/config.js");
const SCRIPT = lire("../public/assets/js/consentement.js");
let ok = 0;
async function t(nom, fn) {
  try { await fn(); ok++; console.log("✓ " + nom); }
  catch (e) { process.exitCode = 1; console.log("✗ " + nom + "\n ", e); }
}

// Page minimale : config.js réel, puis réglages Google Ads du test, puis consentement.js
async function page({ ads = {}, stockage = null, maintenant = Date.now(), url = "https://elev8privatedriver.com/reservation?gclid=TEST123" } = {}) {
  const dom = new JSDOM(`<!doctype html><html><head></head><body>
    <footer><a href="#" data-cookies hidden>Gestion des cookies</a></footer></body></html>`,
    { url, runScripts: "outside-only" });
  const w = dom.window;
  if (stockage) w.localStorage.setItem("elev8_consentement", JSON.stringify(stockage));
  w.Date.now = () => maintenant;
  w.eval(CONFIG);
  Object.assign(w.SITE_CONFIG.suivi.googleAds, ads);
  w.eval(SCRIPT);
  await new Promise((r) => w.setTimeout(r, 0));          // laisse passer DOMContentLoaded
  const balise = () => w.document.querySelector("script[data-elev8-gtag]");
  const bandeau = () => w.document.querySelector(".consent");
  const visible = () => !!bandeau() && !bandeau().hidden;
  const clic = (choix) => bandeau().querySelector(`[data-consent="${choix}"]`).click();
  const evenement = (detail) => w.document.dispatchEvent(new w.CustomEvent("elev8:suivi", { detail }));
  const commandes = () => (w.dataLayer || []).filter((x) => x && typeof x === "object" && "0" in x).map((x) => Array.from(x));
  const conversions = () => JSON.parse(JSON.stringify(commandes().filter((c) => c[0] === "event" && c[1] === "conversion").map((c) => c[2])));
  return { w, balise, bandeau, visible, clic, evenement, commandes, conversions };
}
const ADS = { id: "AW-123456789", conversionDemande: "AbCdEf123", conversionAppel: "Appel456" };

await t("sans identifiant Google Ads (situation actuelle) : aucun bandeau, aucune balise, aucun cookie", async () => {
  const p = await page();
  assert.equal(p.bandeau(), null);
  assert.equal(p.balise(), null);
  assert.equal(p.w.document.cookie, "");
  assert.equal(p.w.document.querySelector("[data-cookies]").hidden, true, "lien « Gestion des cookies » masqué");
  p.evenement({ event: "elev8_demande_envoyee", value: 80, elev8_reference: "E8-1" });
  assert.equal(p.conversions().length, 0);
});

await t("identifiant mal formé : ignoré, rien n'est chargé", async () => {
  const p = await page({ ads: { id: "G-ABC123", conversionDemande: "x" } });
  assert.equal(p.bandeau(), null); assert.equal(p.balise(), null);
});

await t("première visite : bandeau affiché, balise NON chargée tant qu'aucun choix n'est fait", async () => {
  const p = await page({ ads: ADS });
  assert.ok(p.visible());
  assert.equal(p.balise(), null);
  assert.equal(p.commandes().length, 0, "aucune commande Google avant l'accord");
  const b = p.bandeau();
  assert.ok(b.querySelector('[data-consent="refuse"]') && b.querySelector('[data-consent="accepte"]'));
  assert.equal(b.querySelector('[data-consent="refuse"]').className, b.querySelector('[data-consent="accepte"]').className, "même présentation des deux boutons");
  assert.match(b.innerHTML, /confidentialite\.html#cookies/);
  assert.equal(p.w.document.querySelector("[data-cookies]").hidden, false);
});

await t("« Tout refuser » : rien chargé, choix mémorisé, aucune conversion envoyée", async () => {
  const p = await page({ ads: ADS });
  p.evenement({ event: "elev8_demande_envoyee", value: 80, elev8_reference: "E8-1" });
  p.clic("refuse");
  assert.equal(p.visible(), false);
  assert.equal(p.balise(), null);
  assert.equal(p.conversions().length, 0);
  assert.equal(JSON.parse(p.w.localStorage.getItem("elev8_consentement")).choix, "refuse");
  p.evenement({ event: "elev8_demande_envoyee", value: 80, elev8_reference: "E8-2" });
  assert.equal(p.conversions().length, 0);
});

await t("« Accepter » : balise chargée avec Consent Mode v2, personnalisation refusée", async () => {
  const p = await page({ ads: ADS });
  p.clic("accepte");
  assert.equal(p.visible(), false);
  assert.equal(p.balise().src, "https://www.googletagmanager.com/gtag/js?id=AW-123456789");
  const c = JSON.parse(JSON.stringify(p.commandes()));
  const def = c.find((x) => x[0] === "consent" && x[1] === "default")[2];
  assert.deepEqual(def, { ad_storage: "denied", ad_user_data: "denied", ad_personalization: "denied", analytics_storage: "denied" });
  const maj = c.find((x) => x[0] === "consent" && x[1] === "update")[2];
  assert.deepEqual(maj, { ad_storage: "granted", ad_user_data: "granted" });
  assert.ok(c.findIndex((x) => x[1] === "default") < c.findIndex((x) => x[0] === "config"), "consentement déclaré avant la configuration");
  const conf = c.find((x) => x[0] === "config");
  assert.equal(conf[1], "AW-123456789");
  assert.equal(conf[2].allow_ad_personalization_signals, false);
});

await t("demande envoyée après accord : conversion avec valeur, devise et référence (anti-doublon)", async () => {
  const p = await page({ ads: ADS });
  p.clic("accepte");
  p.evenement({ event: "elev8_demande_envoyee", value: 87.21, currency: "EUR", elev8_reference: "E8-2026-000123", elev8_origine: "google-ads" });
  assert.deepEqual(p.conversions(), [{ send_to: "AW-123456789/AbCdEf123", value: 87.21, currency: "EUR", transaction_id: "E8-2026-000123" }]);
});

await t("demande « sur devis » (montant 0) : valeur par défaut de config.js (120 €)", async () => {
  const p = await page({ ads: ADS });
  p.clic("accepte");
  p.evenement({ event: "elev8_demande_envoyee", value: 0, elev8_reference: "E8-9" });
  assert.equal(p.conversions()[0].value, 120);
});

await t("demande envoyée AVANT le choix puis « Accepter » : conversion envoyée une seule fois", async () => {
  const p = await page({ ads: ADS });
  p.evenement({ event: "elev8_demande_envoyee", value: 50, elev8_reference: "E8-7" });
  assert.equal(p.conversions().length, 0);
  p.clic("accepte");
  assert.equal(p.conversions().length, 1);
  assert.equal(p.conversions()[0].transaction_id, "E8-7");
});

await t("clic Appeler : conversion seulement si son libellé est configuré ; WhatsApp non configuré ignoré", async () => {
  const p = await page({ ads: ADS });
  p.clic("accepte");
  p.evenement({ event: "elev8_clic_appel", elev8_emplacement: "resa" });
  p.evenement({ event: "elev8_clic_whatsapp", elev8_emplacement: "resa" });
  assert.deepEqual(p.conversions(), [{ send_to: "AW-123456789/Appel456" }]);
});

await t("aucune donnée personnelle dans les conversions", async () => {
  const p = await page({ ads: ADS });
  p.clic("accepte");
  p.evenement({ event: "elev8_demande_envoyee", value: 40, elev8_reference: "E8-3", nom: "Dupont", telephone: "0600000000", email: "a@b.fr" });
  const txt = JSON.stringify(p.conversions());
  assert.ok(!/Dupont|0600000000|a@b\.fr/.test(txt));
});

await t("visite suivante après accord : pas de bandeau, balise chargée directement", async () => {
  const p = await page({ ads: ADS, stockage: { v: 1, choix: "accepte", t: Date.now() - 10 * 864e5 } });
  assert.equal(p.visible(), false);
  assert.ok(p.balise());
});

await t("visite suivante après refus : pas de bandeau, pas de balise", async () => {
  const p = await page({ ads: ADS, stockage: { v: 1, choix: "refuse", t: Date.now() - 10 * 864e5 } });
  assert.equal(p.visible(), false);
  assert.equal(p.balise(), null);
});

await t("choix de plus de 6 mois : redemandé", async () => {
  const p = await page({ ads: ADS, stockage: { v: 1, choix: "accepte", t: Date.now() - 190 * 864e5 } });
  assert.ok(p.visible());
  assert.equal(p.balise(), null);
});

await t("« Gestion des cookies » rouvre le bandeau ; retrait de l'accord : cookies Google supprimés", async () => {
  const p = await page({ ads: ADS, stockage: { v: 1, choix: "accepte", t: Date.now() } });
  p.w.document.cookie = "_gcl_au=1.1.123; path=/";
  p.w.document.cookie = "autre=1; path=/";
  p.w.document.querySelector("[data-cookies]").click();
  assert.ok(p.visible());
  p.clic("refuse");
  assert.ok(!/_gcl_au/.test(p.w.document.cookie), "cookie Google supprimé");
  assert.ok(/autre=1/.test(p.w.document.cookie), "autres cookies intacts");
  const derniere = p.commandes().filter((x) => x[0] === "consent").pop()[2];
  assert.equal(derniere.ad_storage, "denied");
});

await t("pages : consentement.js chargé après config.js sur les pages publiques, absent de /documents", () => {
  for (const f of ["../public/index.html", "../public/reservation/index.html", "../public/cgv.html", "../public/mentions-legales.html", "../public/confidentialite.html"]) {
    const h = lire(f);
    const iC = h.indexOf("config.js?v="), iS = h.indexOf("consentement.js?v=");
    assert.ok(iC > 0 && iS > iC, f);
  }
  assert.ok(!lire("../public/documents/index.html").includes("consentement.js"));
  assert.ok(lire("../public/index.html").includes("data-cookies"));
  assert.ok(lire("../public/reservation/index.html").includes("data-cookies"));
  assert.ok(lire("../public/confidentialite.html").includes('id="cookies"'));
});

await t("en-tête de sécurité (CSP) : domaines de la balise Google Ads autorisés", () => {
  const csp = lire("../public/_headers").split("\n").find((l) => l.includes("Content-Security-Policy"));
  const dir = (n) => (csp.split(";").find((x) => x.trim().startsWith(n + " ")) || "");
  assert.match(dir("script-src"), /https:\/\/www\.googletagmanager\.com/);
  for (const d of ["https://www.googletagmanager.com", "https://www.google.com", "https://googleads.g.doubleclick.net", "https://www.googleadservices.com"]) {
    assert.ok(dir("connect-src").includes(d), "connect-src " + d);
    assert.ok(dir("img-src").includes(d), "img-src " + d);
  }
  assert.ok(dir("frame-src").includes("https://www.googletagmanager.com"));
  assert.ok(!/'unsafe-inline'|'unsafe-eval'/.test(dir("script-src")), "aucun script en ligne autorisé");
});

await t("liens internes : l'identifiant de clic Google (gclid) suit le visiteur vers /reservation", () => {
  assert.match(lire("../public/assets/js/main.js"), /"gclid", "gbraid", "wbraid"/);
});

console.log(`\n${ok} test(s) réussi(s)` + (process.exitCode ? " — ÉCHECS ci-dessus" : ""));
