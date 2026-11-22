/* Tests automatisés : devis et factures PDF (fonction /documents-api).
   Lancement : node tests/documents.test.mjs   (aucun service extérieur : stockage et e-mail simulés) */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PDFDocument } from "pdf-lib";
import handler, { deps, config as configFonction } from "../netlify/functions/documents.mjs";
import { montants, manquants, emetteur } from "../netlify/lib/documents.mjs";
import { buildEmail } from "../netlify/functions/reservation.mjs";

let ok = 0;
const t = async (nom, f) => { try { await f(); ok++; console.log("✓ " + nom); } catch (e) { console.error("✗ " + nom + "\n  " + (e && e.stack || e)); process.exitCode = 1; } };

function fauxStore() {
  const m = new Map(); let v = 0;
  return { m,
    async get(k) { return m.has(k) ? structuredClone(m.get(k).d) : null; },
    async getWithMetadata(k) { return m.has(k) ? { data: structuredClone(m.get(k).d), etag: m.get(k).e } : null; },
    async setJSON(k, d, o = {}) {
      if (o.onlyIfNew && m.has(k)) return { modified: false };
      if (o.onlyIfMatch && (!m.has(k) || m.get(k).e !== o.onlyIfMatch)) return { modified: false };
      m.set(k, { d: structuredClone(d), e: "e" + (++v) }); return { modified: true };
    },
    async delete(k) { m.delete(k); } };
}
const LEGAL = { raisonSociale: "Exemple Martin", formeJuridique: "EI", adresse: "1 rue de l'Exemple, 21000 Dijon", siret: "000 000 000 00000",
  regimeTVA: "franchise", tauxTVA: 10, tva: "[N° de TVA]", registreVTC: "EVTC000000000" };
const CONF = (legal = LEGAL) => ({ legal, contact: { telephoneAffiche: "06 26 92 72 18", email: "contact@elev8privatedriver.com" }, site: { url: "https://elev8privatedriver.com" } });
process.env.DOCUMENTS_MOT_DE_PASSE = "mot-de-passe-de-test";
process.env.EMAIL_API_KEY = "k"; process.env.MAIL_FROM = "r@test"; process.env.MAIL_TO = "contact@elev8privatedriver.com";
deps.store = fauxStore(); deps.config = CONF();
const envoyes = []; deps.send = async (m) => { envoyes.push(m); };
deps.now = () => Date.parse("2026-11-20T18:00:00Z");

const req = (body, h = {}) => new Request("https://elev8privatedriver.com/documents-api", { method: "POST", headers: { "content-type": "application/json", origin: "https://elev8privatedriver.com", ...h }, body: JSON.stringify(body) });
const appel = async (body, ip = "1.1.1.1") => { const r = await handler(req({ motDePasse: "mot-de-passe-de-test", ...body }), { ip }); const j = await r.json(); j.status = r.status; return j; };
const doc = (extra = {}) => ({ ref: "E8-261118-ABC",
  client: { prenom: "Claire", nom: "Martin", societe: "Domaine des Coteaux SARL", adresse: "12 route des Grands Crus, 21700 Nuits-Saint-Georges", siren: "123 456 789", email: "claire@example.test", telephone: "+33612345678" },
  prestation: { date: "2026-11-20", heure: "09:30", depart: "Gare de Dijon-Ville, 21000 Dijon", destination: "Nuits-Saint-Georges", vehicule: "Tesla Model Y", passagers: 2, bagages: 1, distanceKm: 24 },
  montant: "45,60", devis: { valide: false, validiteJours: 15 }, facture: { datePrestation: "2026-11-20", paye: true, datePaiement: "2026-11-20", modePaiement: "carte bancaire" }, ...extra });
const dossier = mkdtempSync(join(tmpdir(), "elev8-docs-"));
const texte = (b64, nom) => { const f = join(dossier, nom); writeFileSync(f, Buffer.from(b64, "base64")); return execFileSync("pdftotext", ["-layout", f, "-"]).toString().replace(/\s+/g, " "); };

await t("adresse de la fonction hors de /api/* (renvoyé en 404 par netlify.toml) et identique à celle de la page", async () => {
  const { readFileSync } = await import("node:fs");
  const toml = readFileSync(new URL("../netlify.toml", import.meta.url), "utf8");
  const bloques = [...toml.matchAll(/from\s*=\s*"([^"]+)"/g)].map((m) => m[1].replace(/\*$/, ""));
  assert.equal(configFonction.path, "/documents-api");
  assert.ok(!bloques.some((b) => configFonction.path.startsWith(b)), "la fonction est masquée par une redirection de netlify.toml");
  const page = readFileSync(new URL("../public/assets/js/documents.js", import.meta.url), "utf8");
  assert.ok(page.includes('var API = "' + configFonction.path + '"'), "la page n'appelle pas l'adresse de la fonction");
});
await t("toutes les réponses d'erreur ont un message lisible", async () => {
  for (const [r, attendu] of [[new Request("https://elev8privatedriver.com/documents-api", { method: "GET" }), 405],
    [new Request("https://elev8privatedriver.com/documents-api", { method: "POST", body: "pas du json" }), 400],
    [new Request("https://elev8privatedriver.com/documents-api", { method: "POST", headers: { origin: "https://autre.example" }, body: "{}" }), 403]]) {
    const res = await handler(r, { ip: "2.2.2.2" }); const j = await res.json();
    assert.equal(res.status, attendu); assert.ok(j.message && j.message.length > 5, "message absent pour " + attendu);
  }
});
await t("accès refusé sans le bon mot de passe ; fermé si la variable est absente", async () => {
  const r = await handler(req({ action: "verifier", motDePasse: "faux" }), { ip: "9.9.9.9" });
  assert.equal(r.status, 401);
  const avant = process.env.DOCUMENTS_MOT_DE_PASSE; delete process.env.DOCUMENTS_MOT_DE_PASSE;
  assert.equal((await handler(req({ action: "verifier", motDePasse: "x" }), {})).status, 503);
  process.env.DOCUMENTS_MOT_DE_PASSE = avant;
});
await t("trop d'essais : bloqué 15 minutes", async () => {
  for (let i = 0; i < 8; i++) await handler(req({ action: "verifier", motDePasse: "faux" + i }), { ip: "6.6.6.6" });
  assert.equal((await appel({ action: "verifier" }, "6.6.6.6")).status, 429);
});
await t("informations légales « [À compléter] » : aucun document produit, liste des manques", async () => {
  deps.config = CONF({ raisonSociale: "[Nom]", formeJuridique: "[Forme]", adresse: "[Adresse]", siret: "[SIRET]", regimeTVA: "[franchise ou assujetti]" });
  const v = await appel({ action: "verifier" });
  assert.equal(v.ok, true); assert.equal(v.emetteurIncomplet.length, 5);
  const j = await appel({ action: "devis", doc: doc() });
  assert.equal(j.status, 422); assert.equal(j.code, "emetteur");
  deps.config = CONF();
});
await t("devis provisoire : PDF valide, mention « provisoire », informations du client et de la société", async () => {
  const j = await appel({ action: "devis", doc: doc() });
  assert.equal(j.ok, true); assert.equal(j.numero, "D-E8-261118-ABC"); assert.equal(j.fichier, "Devis-D-E8-261118-ABC.pdf");
  const P = await PDFDocument.load(Buffer.from(j.pdf, "base64")); assert.equal(P.getPageCount(), 1);
  const x = texte(j.pdf, "devis.pdf");
  for (const a of ["Devis provisoire", "DEVIS PROVISOIRE", "Aucun paiement", "Domaine des Coteaux SARL", "Claire Martin", "Nuits-Saint-Georges", "Tesla Model Y", "45,60 €", "TVA non applicable, art. 293 B du CGI", "SIRET 000 000 000 00000"])
    assert.ok(x.includes(a), "absent du devis : " + a);
  assert.equal(deps.store.m.size, 0, "un devis ne doit rien enregistrer");
});
await t("devis validé : plus de mention provisoire, validité et « bon pour accord »", async () => {
  const x = texte((await appel({ action: "devis", doc: doc({ devis: { valide: true, validiteJours: 15 } }) })).pdf, "devis2.pdf");
  assert.ok(!/provisoire/i.test(x)); assert.ok(x.includes("valable jusqu'au 5 décembre 2026")); assert.ok(/Bon pour accord/i.test(x));
});
await t("facture : adresse de facturation obligatoire", async () => {
  const j = await appel({ action: "facture", doc: doc({ client: { ...doc().client, adresse: "" } }) });
  assert.equal(j.status, 422); assert.deepEqual(j.champs, ["client.adresse"]);
  assert.equal(deps.store.m.size, 0, "aucun numéro consommé");
});
await t("facture avant la prestation (date future) : refusée", async () => {
  const j = await appel({ action: "facture", doc: doc({ facture: { datePrestation: "2026-11-25", paye: true, datePaiement: "2026-11-20", modePaiement: "carte bancaire" } }) });
  assert.equal(j.status, 422); assert.equal(j.code, "date_future"); assert.equal(deps.store.m.size, 0);
});
await t("facturation réglée sur « indy » : aucune facture créée ici (pas de double numérotation), devis toujours possible", async () => {
  deps.config = CONF({ ...LEGAL, facturation: "indy" });
  const avant = deps.store.m.size;
  const j = await appel({ action: "facture", doc: doc({ ref: "E8-INDY-001" }) });
  assert.equal(j.status, 409); assert.equal(j.code, "facturation_indy"); assert.equal(deps.store.m.size, avant);
  assert.equal((await appel({ action: "devis", doc: doc() })).ok, true);
  deps.config = CONF();
});
let premiere;
await t("facture : numéro F-2026-0001, mentions obligatoires, conservée", async () => {
  const j = await appel({ action: "facture", doc: doc() });
  assert.equal(j.ok, true); assert.equal(j.numero, "F-2026-0001"); assert.equal(j.deja, false); premiere = j;
  const x = texte(j.pdf, "facture.pdf");
  for (const a of ["Facture", "F-2026-0001", "20 novembre 2026", "Exemple Martin", "1 rue de l'Exemple", "SIRET", "Domaine des Coteaux SARL", "12 route des Grands Crus",
    "SIREN / SIRET : 123 456 789", "Prestation de services", "Facture acquittée le 20 novembre 2026", "carte bancaire", "45,60 €", "TVA non applicable",
    "indemnité forfaitaire pour frais de recouvrement de 40 €", "Pas d'escompte"])
    assert.ok(x.includes(a), "absent de la facture : " + a);
  assert.ok(deps.store.m.has("facture/F-2026-0001")); assert.equal(deps.store.m.get("ref/E8-261118-ABC").d.numero, "F-2026-0001");
});
await t("facture réglée par lien Indy : mode et référence du paiement imprimés", async () => {
  const j = await appel({ action: "facture", doc: doc({ ref: "E8-261118-IND", facture: { datePrestation: "2026-11-20", paye: true, datePaiement: "2026-11-20", modePaiement: "lien de paiement Indy", referencePaiement: "IND-48213" } }) });
  assert.equal(j.ok, true);
  assert.ok(texte(j.pdf, "facture-indy.pdf").includes("Facture acquittée le 20 novembre 2026 — règlement par lien de paiement Indy (référence : IND-48213)."));
});
await t("facture redemandée (même référence, montant modifié) : même numéro, contenu inchangé", async () => {
  const j = await appel({ action: "facture", doc: doc({ montant: "99" }) });
  assert.equal(j.numero, "F-2026-0001"); assert.equal(j.deja, true); assert.equal(j.total, 45.6);
  assert.equal(j.pdf, premiere.pdf);
});
await t("numérotation continue : F-2026-0003 puis F-2026-0004 (y compris émissions simultanées)", async () => {
  const [a, b] = await Promise.all([appel({ action: "facture", doc: doc({ ref: "E8-261118-AAA" }) }), appel({ action: "facture", doc: doc({ ref: "E8-261118-BBB" }) })]);
  assert.deepEqual([a.numero, b.numero].sort(), ["F-2026-0003", "F-2026-0004"]);
  const [c, d] = await Promise.all([appel({ action: "facture", doc: doc({ ref: "E8-261118-CCC" }) }), appel({ action: "facture", doc: doc({ ref: "E8-261118-CCC" }) })]);
  const nums = [c, d].filter((x) => x.ok).map((x) => x.numero);
  assert.ok(nums.every((n) => n === "F-2026-0005")); assert.equal(deps.store.m.get("compteur/2026").d.n, 5);
});
await t("TVA (assujetti 10 %) : HT, TVA et TTC détaillés, n° de TVA de l'émetteur", async () => {
  assert.deepEqual(montants(45.6, { regimeTVA: "assujetti", tauxTVA: 10 }), { ht: 41.45, tva: 4.15, ttc: 45.6, taux: 10, franchise: false, lignesHt: [41.45] });
  deps.config = CONF({ ...LEGAL, regimeTVA: "assujetti", tva: "FR12345678901" });
  const x = texte((await appel({ action: "devis", doc: doc() })).pdf, "devis-tva.pdf");
  for (const a of ["Total HT", "41,45 €", "TVA 10 %", "4,15 €", "Total TTC", "45,60 €", "FR12345678901"]) assert.ok(x.includes(a), "absent : " + a);
  assert.ok(!x.includes("293 B"));
  assert.ok(manquants(emetteur(CONF({ ...LEGAL, regimeTVA: "assujetti", tva: "" }))).some((m) => m.includes("TVA intracommunautaire")));
  deps.config = CONF();
});
await t("configuration officielle (public/config.js) : informations cohérentes et complètes (capital social renseigné)", async () => {
  const { readFileSync } = await import("node:fs");
  const { parseConfig } = await import("../netlify/functions/documents.mjs");
  const C = parseConfig(readFileSync(new URL("../public/config.js", import.meta.url), "utf8"));
  const E = emetteur(C);
  assert.equal(E.nom, "Elev8 Private Driver"); assert.equal(E.forme, "SASU"); assert.equal(E.tva, "FR66131595068");
  assert.equal(E.siret.replace(/\s/g, ""), "13159506800019"); assert.equal(E.rcs, "131 595 068 R.C.S. Dijon");
  assert.equal(E.regimeTVA, "assujetti"); assert.equal(E.tauxTVA, 10);
  // cohérence SIREN / SIRET / TVA (clé = (12 + 3 × (SIREN mod 97)) mod 97)
  const siren = E.siret.replace(/\s/g, "").slice(0, 9);
  assert.equal(E.tva, "FR" + String((12 + 3 * (Number(siren) % 97)) % 97).padStart(2, "0") + siren);
  assert.ok(E.rcs.replace(/\s/g, "").startsWith(siren));
  assert.deepEqual(manquants(E), []);                                  // capital social complété le 20/11/2026
  assert.match(E.capital, /^\d[\d\s.]*(,\d+)?\s?€$/);
  assert.equal(manquants({ ...E, capital: "[Montant du capital social, ex. 1 000 €]" }).length, 1);   // un capital non renseigné reste bloquant
});
await t("suppléments : lignes détaillées, HT/TVA exacts au centime", async () => {
  assert.deepEqual(montants(20, { regimeTVA: "assujetti", tauxTVA: 10 }, [{ montant: 15 }]), { ht: 31.82, tva: 3.18, ttc: 35, taux: 10, franchise: false, lignesHt: [18.18, 13.64] });
  deps.config = CONF({ ...LEGAL, raisonSociale: "Elev8 Private Driver", formeJuridique: "SASU", capital: "1 000 €", immatriculation: "131 595 068 R.C.S. Dijon", regimeTVA: "assujetti", tva: "FR66131595068", nomCommercial: "ELEV8 Private Driver", modesPaiement: "carte bancaire ou virement bancaire" });
  const j = await appel({ action: "devis", doc: doc({ montant: "20", supplements: [{ libelle: "Attente 30 minutes", montant: "15" }, { libelle: "", montant: "9" }] }) });
  assert.equal(j.total, 35);
  const x = texte(j.pdf, "devis-sup.pdf");
  for (const a of ["Supplément : Attente 30 minutes", "13,64 €", "18,18 €", "Total HT 31,82 €", "TVA 10 % 3,18 €", "Total TTC 35,00 €", "SASU au capital de 1 000 €", "131 595 068 R.C.S. Dijon", "FR66131595068", "carte bancaire ou virement bancaire"])
    assert.ok(x.includes(a), "absent : " + a);
  deps.config = CONF();
});
await t("SASU sans capital social : documents bloqués", async () => {
  deps.config = CONF({ ...LEGAL, formeJuridique: "SASU", capital: "[Montant du capital social]", immatriculation: "131 595 068 R.C.S. Dijon" });
  const j = await appel({ action: "devis", doc: doc() });
  assert.equal(j.code, "emetteur"); assert.ok(j.manque.some((m) => /capital/.test(m)));
  deps.config = CONF();
});
await t("envoi par e-mail : PDF joint, copie à ELEV8 ; facture non émise refusée", async () => {
  envoyes.length = 0;
  const j = await appel({ action: "envoyer", type: "facture", doc: doc() });
  assert.equal(j.ok, true); assert.equal(j.envoye, "claire@example.test");
  assert.equal(envoyes[0].fichier, "Facture-F-2026-0001.pdf"); assert.ok(envoyes[0].contenu.length > 1000);
  assert.match(envoyes[0].subject, /Votre facture F-2026-0001/);
  const n = await appel({ action: "envoyer", type: "facture", doc: doc({ ref: "E8-JAMAIS-EMISE" }) });
  assert.equal(n.status, 409);
  const dv = await appel({ action: "envoyer", type: "devis", doc: doc(), destinataire: "autre@example.test" });
  assert.equal(dv.envoye, "autre@example.test"); assert.match(envoyes[1].subject, /devis provisoire D-E8-261118-ABC/);
});
/* ---------- Demandes enregistrées côté serveur, session d'administration ---------- */
const DEM = await import("../netlify/lib/demandes.mjs");
const { creerSession, sessionOk } = await import("../netlify/functions/documents.mjs");
DEM.deps.store = (() => {
  const m = new Map();
  return { m,
    async get(k) { return m.has(k) ? structuredClone(m.get(k).d) : null; },
    async getMetadata(k) { return m.has(k) ? { metadata: m.get(k).meta } : null; },
    async setJSON(k, d, o = {}) { m.set(k, { d: structuredClone(d), meta: o.metadata }); return { modified: true }; },
    async delete(k) { m.delete(k); },
    async list({ prefix }) { return { blobs: [...m.keys()].filter((k) => k.startsWith(prefix)).map((key) => ({ key })) }; } };
})();
const demandeType = { prenom: "Claire", nom: "Martin", societe: "Domaine des Coteaux SARL", telephone: "+33612345678", email: "claire@example.test",
  prestation: "Transferts gares", date: "2026-11-21", heure: "09:30", depart: "Gare de Dijon-Ville, 21000 Dijon", destination: "Beaune, 21200",
  allerRetour: true, dateRetour: "2026-11-21", heureRetour: "18:00", passagers: 2, bagages: 3, vehicule: "Pas de préférence",
  precisions: "Siège enfant", reference: "TGV 6703", typeReference: "train", origine: { code: "google-ads", libelle: "Google Ads", utm: {} } };
const estType = { statut: "estimation", montant: 167.2, distanceKm: 88, dureeMin: 80, vehicule: "Berline Confort — Tesla Model Y ou véhicule de catégorie équivalente", lignes: [] };

await t("demande enregistrée : identifiant opaque, lien sans aucune donnée personnelle, données complètes", async () => {
  const id = await DEM.enregistrer(DEM.deps.store, { ref: "E8-261119-AAA", d: demandeType, est: estType, now: deps.now() });
  assert.match(id, /^[A-Za-z0-9_-]{24}$/);
  const m = buildEmail(demandeType, "E8-261119-AAA", "ELEV8 Private Driver", estType, "https://elev8privatedriver.com", id);
  const liens = m.text.match(/https:\/\/elev8privatedriver\.com\/documents\/\S*/g);
  assert.deepEqual(liens, [`https://elev8privatedriver.com/documents/?r=${id}&etape=validation`, `https://elev8privatedriver.com/documents/?r=${id}`]);
  for (const l of liens) for (const perso of ["Claire", "Martin", "Coteaux", "612345678", "example", "Dijon", "Beaune", "#d="]) assert.ok(!l.includes(perso), "donnée dans le lien : " + perso);
  assert.ok(m.html.includes("?r=" + id + "&amp;etape=validation"));
  const r = (await DEM.chargerParId(DEM.deps.store, id, deps.now())).record;
  assert.equal(r.client.societe, "Domaine des Coteaux SARL"); assert.equal(r.prestation.allerRetour, true); assert.equal(r.prestation.heureRetour, "18:00");
  assert.equal(r.prestation.bagages, 3); assert.equal(r.prestation.reference, "TGV 6703"); assert.equal(r.prestation.type, "Transferts gares");
  assert.equal(r.prestation.vehicule, estType.vehicule, "« Pas de préférence » remplacé par la catégorie estimée");
  assert.equal(r.estimation.montant, 167.2); assert.equal(r.estimation.distanceKm, 88); assert.equal(r.origine, "Google Ads");
});
await t("session : connexion par mot de passe → jeton ; jeton accepté, falsifié ou expiré refusé ; changement de mot de passe = déconnexion", async () => {
  const c = await appel({ action: "connexion", resterConnecte: false });
  assert.equal(c.ok, true); assert.ok(c.session && !c.session.includes("mot-de-passe"));
  assert.equal(c.expire - deps.now(), 12 * 3600_000);
  const viaSession = async (body) => { const r = await handler(req({ ...body, session: c.session }), { ip: "3.3.3.3" }); const j = await r.json(); j.status = r.status; return j; };
  assert.equal((await viaSession({ action: "verifier" })).ok, true);
  const p = c.session.split("."); p[1] = String(Number(p[1]) + 1);
  assert.equal((await handler(req({ action: "verifier", session: p.join(".") }), { ip: "3.3.3.4" })).status, 401);
  assert.equal(sessionOk(c.session, deps.now() + 13 * 3600_000), false);
  assert.equal(sessionOk(creerSession(deps.now(), 30 * 86400_000).jeton, deps.now() + 29 * 86400_000), true);
  const avant = process.env.DOCUMENTS_MOT_DE_PASSE; process.env.DOCUMENTS_MOT_DE_PASSE = "nouveau-mot-de-passe";
  assert.equal(sessionOk(c.session, deps.now()), false);
  process.env.DOCUMENTS_MOT_DE_PASSE = avant;
  const sansMdp = await handler(req({ action: "connexion", session: c.session }), { ip: "3.3.3.5" });
  assert.equal(sansMdp.status, 401, "une session ne remplace pas le mot de passe pour se connecter");
});
await t("chargement : réservé aux personnes connectées (lien seul ou référence seule : refusé)", async () => {
  const id = await DEM.enregistrer(DEM.deps.store, { ref: "E8-261119-BBB", d: demandeType, est: estType, now: deps.now() });
  for (const corps of [{ action: "charger", id }, { action: "charger", ref: "E8-261119-BBB" }, { action: "charger", id, session: "v1.0.x.y" }]) {
    const r = await handler(req(corps), { ip: "4.4.4." + Math.floor(Math.random() * 200) }); const j = await r.json();
    assert.equal(r.status, 401); assert.equal(j.demande, undefined);
  }
});
await t("chargement par lien et par référence : demande complète ; facture déjà émise signalée", async () => {
  const id = await DEM.enregistrer(DEM.deps.store, { ref: "E8-261118-ABC", d: demandeType, est: estType, now: deps.now() });
  const a = await appel({ action: "charger", id });
  assert.equal(a.ok, true); assert.equal(a.demande.ref, "E8-261118-ABC"); assert.equal(a.demande.client.prenom, "Claire");
  assert.equal(a.facture.numero, "F-2026-0001", "la facture déjà émise pour cette référence est signalée");
  const b2 = await appel({ action: "charger", ref: "e8-261118-abc" });
  assert.equal(b2.ok, true); assert.equal(b2.demande.prestation.destination, "Beaune, 21200");
});
await t("liens invalides, inconnus et expirés", async () => {
  const inv = await appel({ action: "charger", id: "../../etc" }); assert.equal(inv.status, 400);
  const inc = await appel({ action: "charger", id: "AAAAAAAAAAAAAAAAAAAAAAAA" }); assert.equal(inc.status, 404); assert.match(inc.message, /introuvable/i);
  const ref = await appel({ action: "charger", ref: "E8-999999-ZZZ" }); assert.equal(ref.status, 404);
  const id = await DEM.enregistrer(DEM.deps.store, { ref: "E8-251101-OLD", d: { ...demandeType, date: "2025-11-01" }, est: null, now: Date.parse("2025-10-30T10:00:00Z") });
  const exp = await appel({ action: "charger", id });
  assert.equal(exp.status, 410); assert.match(exp.message, /expiré/);
  assert.ok(!DEM.deps.store.m.has("demande/" + id) && !DEM.deps.store.m.has("ref/E8-251101-OLD"), "données supprimées");
});
await t("demande sans estimation (sur devis) et données manquantes : chargement sans erreur", async () => {
  const id = await DEM.enregistrer(DEM.deps.store, { ref: "E8-261119-DEV", d: { ...demandeType, email: "", societe: "", bagages: null, allerRetour: false }, est: { statut: "sur_devis", motif: "hors_zone", vehicule: "x" }, now: deps.now() });
  const j = await appel({ action: "charger", id });
  assert.equal(j.ok, true); assert.equal(j.demande.estimation.montant, null); assert.equal(j.demande.client.email, ""); assert.equal(j.demande.prestation.bagages, "");
});
await t("nettoyage planifié : demandes expirées supprimées, récentes conservées", async () => {
  const vieux = await DEM.enregistrer(DEM.deps.store, { ref: "E8-240101-VX1", d: { ...demandeType, date: "2024-01-02" }, est: null, now: Date.parse("2024-01-01T10:00:00Z") });
  const recent = await DEM.enregistrer(DEM.deps.store, { ref: "E8-261119-REC", d: demandeType, est: null, now: deps.now() });
  const n = await DEM.nettoyer(DEM.deps.store, deps.now());
  assert.ok(n >= 1); assert.ok(!DEM.deps.store.m.has("demande/" + vieux)); assert.ok(DEM.deps.store.m.has("demande/" + recent));
});
await t("une demande ne crée jamais de facture ; e-mail sans enregistrement possible : texte de secours, aucun lien", async () => {
  const m = buildEmail(demandeType, "E8-261119-ERR", "ELEV8 Private Driver", estType, "https://elev8privatedriver.com", "");
  assert.ok(!m.text.includes("?r=")); assert.ok(m.text.includes("saisissez la référence E8-261119-ERR"));
  assert.ok(!/facture (définitive|émise)/i.test(m.text));
});

/* ---------- Messages au client : lien de paiement sécurisé (assets/js/messages-client.js) ---------- */
{
  const { readFileSync } = await import("node:fs");
  const vm = await import("node:vm");
  const ctx = { URL }; vm.createContext(ctx);
  vm.runInContext(readFileSync(new URL("../public/assets/js/messages-client.js", import.meta.url), "utf8"), ctx);
  const MSG = ctx.ELEV8Messages;
  const base = { type: "proposition", ref: "E8-261119-HZX", prenom: "Claire", date: "vendredi 20 novembre 2026", heure: "14h30",
    depart: "Gare de Dijon-Ville, 21000 Dijon", destination: "Place Carnot, 21200 Beaune", retour: "", vehicule: "Berline Confort — Tesla Model Y ou véhicule de catégorie équivalente",
    passagers: 2, supplements: [], total: 79.5, estimInitiale: 79.5, ajuste: false, sansLien: "accepte",
    marque: "ELEV8 Private Driver", email: "contact@elev8privatedriver.com", site: "https://elev8privatedriver.com" };
  const LIEN = "https://paiement.caisse-epargne.example/pay/AbC123?montant=79.50";

  await t("lien de paiement sécurisé : HTTPS de tout prestataire accepté, liens douteux refusés", () => {
    for (const u of [LIEN, "https://app.indy.fr/pay/xyz", "https://www.payplug.example/p/1"]) assert.equal(MSG.lienPaiement(u).ok, true, u);
    assert.equal(MSG.lienPaiement("https://www.payplug.example/p/1").domaine, "payplug.example");
    for (const u of ["", "http://paiement.example/p", "javascript:alert(1)", "https://user:mdp@paiement.example/p", "https://192.168.1.10/p",
      "https://localhost/p", "https://paiement", "https://paiement.example/p a", "ftp://paiement.example/p", "https://" + "a".repeat(495) + ".fr"]) assert.equal(MSG.lienPaiement(u).ok, false, u);
  });
  await t("avec lien : e-mail « Finalisation de votre réservation » au modèle, sans « J'accepte », sans confirmation automatique", () => {
    const m = MSG.composer({ ...base, lien: LIEN });
    assert.equal(m.objet, "ELEV8 Private Driver — Finalisation de votre réservation | E8-261119-HZX");
    for (const x of ["Bonjour Claire,", "Merci d'avoir choisi ELEV8 Private Driver.", "sommes heureux de vous proposer la prise en charge suivante :",
      "Votre trajet", "Référence : E8-261119-HZX", "Date : vendredi 20 novembre 2026", "Heure de prise en charge : 14h30",
      "Adresse de départ : Gare de Dijon-Ville, 21000 Dijon", "Adresse de destination : Place Carnot, 21200 Beaune",
      "Véhicule : Berline Confort — Tesla Model Y ou véhicule de catégorie équivalente", "Nombre de passagers : 2",
      "Tarif définitif : 79,50 € TTC", "Votre chauffeur est disponible pour cette prestation, sous réserve de finalisation de votre réservation.",
      "Finalisez votre réservation", "nous vous invitons à utiliser notre lien de paiement sécurisé :\n\n" + LIEN + "\n\n",
      "Votre réservation sera définitivement confirmée après vérification de votre règlement et confirmation par ELEV8 Private Driver.",
      "Cordialement,\n\nELEV8 Private Driver\ncontact@elev8privatedriver.com\nhttps://elev8privatedriver.com"]) assert.ok(m.corps.includes(x), x);
    for (const txt of [m.corps, m.wa]) {
      assert.ok(!/J'accepte/.test(txt)); assert.ok(!/\[|\]/.test(txt));
      assert.ok(!/paiement reçu|réservation (est )?(définitivement )?confirmée[ .:]/i.test(txt.replace(/sera (définitivement )?confirmée/g, "")));
    }
    assert.ok(m.wa.includes(LIEN) && m.wa.includes("Tarif définitif : 79,50 € TTC") && m.wa.length < m.corps.length / 1.5);
  });
  await t("sans lien (ou lien invalide) : fonctionnement « J'accepte » conservé, aucun emplacement de lien vide", () => {
    for (const lien of ["", "http://non-securise.example/p"]) {
      const m = MSG.composer({ ...base, lien });
      assert.equal(m.objet, "ELEV8 Private Driver — Validation de votre trajet | E8-261119-HZX");
      for (const txt of [m.corps, m.wa]) { assert.ok(txt.includes("« J'accepte »")); assert.ok(!/LIEN|\[|\]|https?:\/\/(?!elev8privatedriver\.com)|paiement sécurisé|undefined|null/i.test(txt), txt); }
    }
    const v = MSG.composer({ ...base, sansLien: "virement", ajuste: true, total: 85, supplements: [{ libelle: "Attente", montant: "10" }] });
    assert.ok(v.corps.includes("virement bancaire") && v.corps.includes("le tarif a été ajusté") && v.corps.includes("Supplément : Attente — 10,00 € TTC"));
  });
  await t("« Réservation confirmée » reste un message distinct (après règlement vérifié), sans lien de paiement", () => {
    const m = MSG.composer({ ...base, type: "reservation", lien: LIEN });
    assert.equal(m.objet, "ELEV8 Private Driver — Réservation confirmée | E8-261119-HZX");
    assert.ok(!m.corps.includes(LIEN) && !m.wa.includes(LIEN));
  });
}

console.log(`\n${ok} test(s) réussi(s)` + (process.exitCode ? " — ÉCHECS ci-dessus" : ""));
