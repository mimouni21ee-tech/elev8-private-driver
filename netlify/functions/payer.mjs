/* ==========================================================================
   ELEV8 Private Driver — lien de paiement individuel : GET /payer/<jeton>
   --------------------------------------------------------------------------
   Le lien envoyé au client ne contient qu'un jeton aléatoire (aucune donnée personnelle).
   À chaque clic, le serveur :
     - refuse un lien inconnu, annulé, remplacé ou expiré (page d'explication) ;
     - indique « paiement déjà reçu » si la course est réglée ;
     - sinon réutilise la session Stripe Checkout encore ouverte, ou en crée une nouvelle
       (une session Stripe dure au plus 24 h ; le lien, lui, reste valable jusqu'à 2 h avant
       la prise en charge). Une seule session ouverte à la fois par réservation.
   Le MONTANT vient exclusivement du dossier enregistré côté serveur.
   ========================================================================== */
import { stripeActif, creerSession, lireSession } from "../lib/stripe.mjs";
import { magasin, lire, modifier, appliquerSession, deps as P } from "../lib/paiements.mjs";
import { magasin as magasinDemandes, chargerParId } from "../lib/demandes.mjs";

export const config = { path: "/payer/:jeton", rateLimit: { windowLimit: 20, windowSize: 60, aggregateBy: ["ip", "domain"] } };

const vers = (url) => new Response(null, { status: 303, headers: { Location: url, "Cache-Control": "no-store", "X-Robots-Tag": "noindex", "Referrer-Policy": "no-referrer" } });
const page = (etat, extra = "") => vers("/paiement/?etat=" + etat + extra);

export default async (req, context) => {
  if (req.method !== "GET" && req.method !== "HEAD") return new Response("", { status: 405 });
  const jeton = (context && context.params && context.params.jeton) || new URL(req.url).pathname.split("/").filter(Boolean)[1] || "";
  if (!stripeActif()) return page("indisponible");
  const st = magasin(), now = P.now();
  let p;
  try { p = await lire(st, jeton); } catch { return page("erreur"); }
  if (!p) return page("inconnu");
  if (req.method === "HEAD") return new Response(null, { status: 200 });          // aperçus de liens : aucune session créée

  if (["paye", "en_cours", "a_verifier"].includes(p.statut)) return page("deja", "&ref=" + encodeURIComponent(p.ref));
  if (["rembourse", "rembourse_partiel"].includes(p.statut)) return page("rembourse");
  if (["annule", "remplace"].includes(p.statut)) return page("annule-lien");
  const limite = Date.parse(p.valableJusqu);
  if (p.statut === "expire" || now > limite - 31 * 60_000) {                         // Stripe exige 30 min de validité minimum
    await modifier(st, jeton, (x) => (x.statut === "en_attente" ? { ...x, statut: "expire", historique: (x.historique || []).concat([{ le: new Date(now).toISOString(), quoi: "lien expiré (date limite)" }]) } : null)).catch(() => {});
    return page("expire");
  }

  try {
    // 1. Session encore ouverte : on la réutilise
    const act = p.sessionActive && (p.sessions || []).find((s) => s.id === p.sessionActive);
    if (act && act.expire - now > 3 * 60_000) {
      const s = await lireSession(act.id);
      if (s.status === "open" && s.url) return vers(s.url);
      const r = await modifier(st, jeton, (x) => appliquerSession(x, s, now));
      if (r.p && ["paye", "en_cours", "a_verifier"].includes(r.p.statut)) return page("deja", "&ref=" + encodeURIComponent(p.ref));
    }
    // 2. Nouvelle session (clé d'idempotence = jeton + numéro de tentative : deux clics simultanés → une seule session)
    const tentative = (p.tentatives || 0) + 1;
    const expireA = Math.min(now + 23 * 3600_000, limite);
    let email = "";                                                                  // e-mail prérempli sur la page Stripe (facultatif)
    try { const d = p.idDemande ? await chargerParId(magasinDemandes(), p.idDemande, now) : null; email = (d && d.record && d.record.client.email) || ""; } catch { /* facultatif */ }
    const s = await creerSession({ ref: p.ref, jeton, version: p.v || 1, tentative, montantCents: p.montantCents, libelle: p.libelle, description: p.description,
      expireA, origine: new URL(req.url).origin, email });
    const r = await modifier(st, jeton, (x) => {
      if (x.statut !== "en_attente") return null;
      if ((x.sessions || []).some((y) => y.id === s.id)) return null;
      x.tentatives = Math.max(x.tentatives || 0, tentative);
      x.sessions = (x.sessions || []).concat([{ id: s.id, expire: expireA, statut: "open", cree: new Date(now).toISOString() }]).slice(-20);
      x.sessionActive = s.id;
      return x;
    });
    await st.setJSON("session/" + s.id, { jeton });
    if (r.p && r.p.statut !== "en_attente") return page(["paye", "en_cours", "a_verifier"].includes(r.p.statut) ? "deja" : "annule-lien");
    return vers(s.url);
  } catch (e) {
    console.error("Lien de paiement :", String(e && e.message).slice(0, 80));
    return page("erreur", "&j=" + encodeURIComponent(jeton));
  }
};
