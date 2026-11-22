/* ==========================================================================
   ELEV8 Private Driver — site de PRODUCTION ou site de TEST (déploiement de branche)
   --------------------------------------------------------------------------
   Le contexte vient de Netlify lui-même (context.deploy.context : "production",
   "branch-deploy", "deploy-preview", "dev"), pas d'une variable modifiable par erreur.

   Sur tout site qui n'est pas la production :
     - stockages séparés : « elev8-demandes-test », « elev8-paiements-test »,
       « elev8-factures-test » → impossible de lire ou modifier les vraies réservations
       et les vraies factures ;
     - e-mails marqués « [TEST] » ; ceux destinés aux clients sont redirigés vers ELEV8
       (MAIL_TO), sauf adresses listées dans EMAILS_TEST_AUTORISES ;
     - aucune facture définitive ne peut être émise.
   En production, le paiement Stripe de test est refusé, même si ses variables existent.
   ========================================================================== */
const env = (k) => (process.env[k] || "").trim();
let retenu = "";

/* À appeler au début de chaque fonction avec l'objet « context » fourni par Netlify */
export function retenirContexte(context) {
  const c = context && context.deploy && context.deploy.context;
  if (typeof c === "string" && c) retenu = c;
}
export function _reinitialiser() { retenu = ""; }    // tests
export function contexteDeploiement() {
  if (retenu) return retenu;
  try { const g = globalThis.Netlify && globalThis.Netlify.context; if (g && g.deploy && g.deploy.context) return g.deploy.context; } catch { /* hors Netlify */ }
  return "";
}
export const estProduction = () => contexteDeploiement() === "production";
/* Site de test : tout déploiement Netlify qui n'est pas la production ; hors Netlify (essais locaux),
   seulement si PAIEMENT_STRIPE=test. */
export function estSiteDeTest() {
  const c = contexteDeploiement();
  return c ? c !== "production" : env("PAIEMENT_STRIPE").toLowerCase() === "test";
}
export const nomMagasin = (base) => (estSiteDeTest() ? base + "-test" : base);

/* Destinataire réel d'un e-mail au client sur le site de test */
export function destinataireTest(to) {
  const autorises = env("EMAILS_TEST_AUTORISES").toLowerCase().split(",").map((x) => x.trim()).filter(Boolean);
  if (to && autorises.includes(String(to).toLowerCase())) return { to, redirige: false };
  return { to: "", redirige: !!to };              // "" = MAIL_TO (ELEV8)
}
export function marquerTest(m, destinataireInitial, redirige) {
  const bandeau = "MESSAGE DE TEST — site de test ELEV8, paiements Stripe en mode test (aucun prélèvement réel)." +
    (redirige ? " Destinataire prévu : " + destinataireInitial + " (redirigé vers ELEV8)." : "");
  return { ...m, subject: "[TEST] " + m.subject, text: bandeau + "\n\n" + (m.text || ""),
    html: m.html ? m.html.replace(/<body([^>]*)>/i, `<body$1><div style="background:#b3261e;color:#fff;padding:10px 14px;font:13px Helvetica,Arial,sans-serif">${bandeau.replace(/[<>&]/g, "")}</div>`) : m.html };
}
