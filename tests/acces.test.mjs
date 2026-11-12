/* Tests de la fonction de bord preprod-acces : préproduction PUBLIQUE, diagnostic protégé à part.
   node tests/acces.test.mjs */
import assert from "node:assert/strict";
import { jetonAcces, verifierAcces, VARIABLES } from "../netlify/lib/securite.mjs";
/* Comme pendant un build Netlify : les vraies variables du site sont présentes dans process.env.
   Les tests doivent donner le même résultat avec ou sans elles (régression du build 59bb7d7). */
for (const k of VARIABLES) process.env[k] = "valeur-reelle-du-build-netlify-0123456789-abcdef";
const ENV = { PREPROD_MOT_DE_PASSE: "motdepasse-test-123" };
globalThis.Netlify = { env: { get: (k) => ENV[k] } };      // runtime Netlify simulé : seule source lue
const { default: acces, config, estDiagnostic } = await import("../netlify/edge-functions/preprod-acces.js");
let n = 0; const eq = (a, b, m) => { assert.deepEqual(a, b, m); n++; };
const B = (u, p) => "Basic " + Buffer.from(u + ":" + p).toString("base64");
let servis = 0;
const ctx = { next: async () => { servis++; return new Response("contenu", { headers: { "Content-Type": "text/html" } }); } };
const get = (path, headers = {}, method = "GET") => acces(new Request("https://preprod.example" + path, { method, headers }), ctx);
const MDP = ENV.PREPROD_MOT_DE_PASSE;

eq(config.path, "/*", "déclarée sur toutes les adresses (le diagnostic ne peut pas être oublié)");
eq(config.onError, "fail", "erreur : refus, jamais d'ouverture");

/* 1. Accès direct, sans identifiant ni cookie */
const publiques = ["/", "/dijon", "/dijon/", "/dijon/index.html", "/assets/js/dijon.js", "/assets/img/tesla-model-y.jpg", "/robots.txt", "/lieux-dijon", "/devis-dijon", "/devis-dijon?etat=1", "/inexistante", "/dijon/diagnostique-faux-ami/x"];
for (const p of publiques) {
  const r = await get(p);
  eq(r.status, 200, "public sans identifiants : " + p);
  eq(r.headers.get("www-authenticate"), null, "aucune demande d'identifiants : " + p);
  eq(r.headers.get("set-cookie"), null, "aucun cookie posé : " + p);
  eq(r.headers.get("x-robots-tag"), "noindex, nofollow", "non indexée : " + p);
}
eq((await get("/devis-dijon", { "content-type": "application/json" }, "POST")).status, 200, "POST public vers les fonctions");
eq((await get("/dijon/", { authorization: B("elev8", "faux") })).status, 200, "un en-tête d'identifiants sans effet sur les pages publiques");

/* 2. Diagnostic protégé : toutes les variantes d'adresse */
const variantes = ["/dijon/diagnostic", "/dijon/diagnostic/", "/dijon/diagnostic/index.html", "/DIJON/Diagnostic/", "/dijon//diagnostic/", "/dijon/%64iagnostic/", "/dijon/diagnostic.html", "/dijon/diagnostic/?x=1", "/dijon/%E0%A4%A/"];
for (const p of variantes) eq(estDiagnostic("https://preprod.example" + p), true, "reconnue comme diagnostic : " + p);
eq(estDiagnostic("https://preprod.example/dijon/"), false, "/dijon n'est pas le diagnostic");
eq(estDiagnostic("https://preprod.example/dijon/diagnostic/%2e%2e/"), false, "« diagnostic/.. » se résout en /dijon/ (page publique), pas en diagnostic");
servis = 0;
for (const p of variantes.slice(0, 8)) eq((await get(p)).status, 401, "diagnostic sans identifiants : 401 sur " + p);
eq(servis, 0, "aucun contenu de diagnostic servi sans identifiants");
eq((await get("/dijon/diagnostic/", { authorization: B("elev8", "faux-mot-de-passe") })).status, 401, "mauvais mot de passe");
eq((await get("/dijon/diagnostic/", { authorization: B("autre", MDP) })).status, 401, "mauvais identifiant");
const r = await get("/dijon/diagnostic/", { authorization: B("Elev8", MDP) });
eq(r.status, 200, "bons identifiants : diagnostic servi");
const ck = r.headers.get("set-cookie");
eq(/^elev8_preprod=\d+\.[\w-]+; Path=\/; Max-Age=43200; HttpOnly; Secure; SameSite=Strict$/.test(ck), true, "cookie de session sécurisé");
const valeur = ck.split(";")[0];
eq((await get("/dijon/diagnostic/", { cookie: valeur })).status, 200, "cookie accepté sur le diagnostic");
eq((await get("/dijon/diagnostic/", { cookie: "elev8_preprod=" + (Date.now() + 1e6) + ".falsifie" })).status, 401, "cookie falsifié refusé");
eq((await get("/dijon/diagnostic/", { cookie: "elev8_preprod=" + jetonAcces(MDP, Date.now() - 1) })).status, 401, "cookie expiré refusé");

/* 3. L'état de configuration (/devis-dijon?etat=1) reste réservé : même cookie, vérifié par la fonction */
const fReq = (h) => new Request("https://preprod.example/devis-dijon?etat=1", { headers: h });
eq(verifierAcces(fReq({ cookie: valeur })), null, "état : cookie du diagnostic accepté");
eq(verifierAcces(fReq({})).status, 401, "état : refusé sans cookie");

/* 4. Sans mot de passe configuré : diagnostic désactivé, site toujours public */
delete ENV.PREPROD_MOT_DE_PASSE;
eq((await get("/dijon/diagnostic/")).status, 404, "mot de passe absent : diagnostic désactivé (404)");
eq((await get("/dijon/diagnostic/", { authorization: B("elev8", MDP) })).status, 404, "désactivé même avec d'anciens identifiants");
eq((await get("/dijon/")).status, 200, "mot de passe absent : /dijon reste accessible");
eq(verifierAcces(fReq({ cookie: valeur })).status, 503, "état fermé quand le diagnostic est désactivé");
eq(verifierAcces(fReq({ authorization: B("elev8", process.env.PREPROD_MOT_DE_PASSE) })).status, 503,
  "cohérence : une valeur restée dans process.env ne rouvre pas l'état quand Netlify.env n'a pas de mot de passe");
ENV.PREPROD_MOT_DE_PASSE = "court";
eq((await get("/dijon/diagnostic/", { authorization: B("elev8", "court") })).status, 404, "mot de passe trop court : diagnostic désactivé");

/* 5. Lecture de la configuration (correctif précédent conservé) */
ENV.PREPROD_MOT_DE_PASSE = MDP + "\n";
eq((await get("/dijon/diagnostic/", { authorization: B("elev8", MDP) })).status, 200, "valeur Netlify avec retour à la ligne : connexion possible");
eq((await get("/dijon/diagnostic/", { authorization: B("elev8", MDP.toUpperCase()) })).status, 401, "mot de passe sensible à la casse");
ENV.PREPROD_MOT_DE_PASSE = "Café-préprod-2026";
eq((await get("/dijon/diagnostic/", { authorization: "Basic " + Buffer.from("elev8:Café-préprod-2026", "latin1").toString("base64") })).status, 200, "mot de passe accentué en Latin-1");
eq((await get("/dijon/diagnostic/", { authorization: B("elev8", "Café-préprod-2026") })).status, 200, "accents décomposés (NFD)");

/* 6. Journal de diagnostic : étapes seulement, jamais de secret */
const lignes = [], log0 = console.log; console.log = (...a) => lignes.push(a.join(" "));
const SECRET_MDP = "Secret-Tres-Prive-42";
ENV.PREPROD_MOT_DE_PASSE = SECRET_MDP;
await get("/dijon/diagnostic/", { authorization: B("intrus", "autre") });
eq(lignes.length, 0, "aucun journal sans PREPROD_DIAGNOSTIC=1");
ENV.PREPROD_DIAGNOSTIC = "1";
await get("/dijon/");
eq(lignes.length, 0, "pages publiques : aucun journal");
await get("/dijon/diagnostic/");
await get("/dijon/diagnostic/", { authorization: B("intrus", "autre-mot-de-passe") });
await get("/dijon/diagnostic/", { authorization: B("elev8", "autre-mot-de-passe") });
await get("/dijon/diagnostic/", { authorization: B("elev8", SECRET_MDP) });
delete ENV.PREPROD_MOT_DE_PASSE;
await get("/dijon/diagnostic/");
console.log = log0;
const tout = lignes.join("\n");
eq(/etape=cookie_absent\+authorization_absent/.test(lignes[0]), true, "étape : aucun identifiant envoyé");
eq(/etape=identifiant_different/.test(lignes[1]), true, "étape : identifiant différent");
eq(/etape=mot_de_passe_different/.test(lignes[2]), true, "étape : mot de passe différent");
eq(/etape=ok_basic/.test(lignes[3]), true, "étape : succès");
eq(/etape=diagnostic_desactive/.test(lignes[4]), true, "étape : diagnostic désactivé");
for (const interdit of [SECRET_MDP, "autre-mot-de-passe", "intrus", "Basic ", Buffer.from("elev8:" + SECRET_MDP).toString("base64"), "elev8_preprod="])
  eq(tout.includes(interdit), false, "le journal ne contient pas « " + interdit.slice(0, 6) + "… »");
delete ENV.PREPROD_DIAGNOSTIC;

console.log("✓ " + n + " vérifications passées (accès public, diagnostic protégé)");
