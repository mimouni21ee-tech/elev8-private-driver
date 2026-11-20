/* ==========================================================================
   ELEV8 Private Driver — paiements en ligne (Stripe Checkout) et suivi de la réservation
   --------------------------------------------------------------------------
   Magasin Netlify Blobs « elev8-paiements » (aucune coordonnée client : référence,
   montants et identifiants Stripe seulement ; les coordonnées restent dans « elev8-demandes »).

   Clés :
     paiement/<jeton>     dossier de paiement (jeton = 144 bits aléatoires, figure dans le lien /payer/<jeton>)
     ref/<référence>      { jeton } du lien EN VIGUEUR pour cette réservation (un seul à la fois)
     session/<cs_…>       { jeton }   pi/<pi_…> { jeton }   (retrouver le dossier depuis Stripe)
     evt/<evt_…>          événement Stripe déjà traité (anti-rejeu)

   Statut du PAIEMENT (n'avance que dans un sens, sauf « refusé » qui laisse le lien utilisable) :
     en_attente → en_cours (paiement différé) → paye → rembourse_partiel → rembourse
     annule (lien retiré avant paiement) · expire (date limite dépassée) · remplace (nouveau montant)
     a_verifier : paiement reçu sur un lien retiré ou pour un montant inattendu → décision ELEV8
   Étape de la RÉSERVATION :
     attente_paiement → payee_attente_attribution → chauffeur_confirme
     annulee_indisponible · sans_chauffeur (remboursement) · annulee
   Une course n'est JAMAIS « attribuée » sans confirmation effective d'un chauffeur.
   ========================================================================== */
import { randomBytes } from "node:crypto";
import { getStore } from "@netlify/blobs";
import { nomMagasin } from "./environnement.mjs";

export const deps = { store: null, now: () => Date.now() };
const env = (k) => (process.env[k] || "").trim();
export function magasin() { return deps.store || getStore({ name: nomMagasin("elev8-paiements"), consistency: "strong" }); }
export const JETON_RE = /^[A-Za-z0-9_-]{24}$/;
export const nouveauJeton = () => randomBytes(18).toString("base64url");

/* Règles du paiement automatique (modifiables par variables Netlify, valeurs par défaut prudentes) */
export const REGLES = {
  delaiMinH: () => Math.max(1, Number(env("PAIEMENT_DELAI_MIN_H")) || 4),        // prise en charge au moins 4 h après la demande
  limiteAvantH: () => Math.max(0.5, Number(env("PAIEMENT_LIMITE_H")) || 2),     // lien valable jusqu'à 2 h avant la prise en charge
  alertesH: [12, 3],                                                             // alertes « sans chauffeur »
  remboursementAutoH: () => Number(env("PAIEMENT_REMBOURSEMENT_AUTO_H")) || 0   // 0 = jamais automatique (défaut)
};

/* Instant de prise en charge (heure de Paris) */
export function instantParis(date, heure) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || "") || !/^\d{2}:\d{2}$/.test(heure || "")) return NaN;
  const naif = Date.parse(`${date}T${heure}:00Z`);
  const fmt = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Paris", hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
  const p = Object.fromEntries(fmt.formatToParts(new Date(naif)).map((x) => [x.type, x.value]));
  const vu = Date.parse(`${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:00Z`);
  return naif - (vu - naif);
}

/* Le trajet peut-il être payé en ligne SANS validation manuelle ?
   Oui seulement si : prix calculé automatiquement par le serveur, aucune demande particulière,
   prise en charge assez éloignée pour trouver un chauffeur. Sinon : validation manuelle (/documents). */
export function eligibleAuto(d, est, now = deps.now()) {
  if (!est || est.statut !== "estimation" || !(est.montant > 0)) return { ok: false, motif: "sur_devis" };
  if (d.precisions && String(d.precisions).trim()) return { ok: false, motif: "demande_particuliere" };
  if (/mise\s+à\s+disposition/i.test(d.prestation || "")) return { ok: false, motif: "sur_devis" };
  const t = instantParis(d.date, d.heure);
  if (!Number.isFinite(t) || t - now < REGLES.delaiMinH() * 3600_000) return { ok: false, motif: "delai_court" };
  return { ok: true };
}

/* Lecture / écriture conditionnelle (deux traitements simultanés ne s'écrasent jamais) */
export async function lire(st, jeton) {
  if (!JETON_RE.test(jeton || "")) return null;
  return st.get("paiement/" + jeton, { type: "json" });
}
export async function modifier(st, jeton, fn) {
  for (let i = 0; i < 8; i++) {
    const cur = await st.getWithMetadata("paiement/" + jeton, { type: "json" });
    if (!cur || !cur.data) return { p: null, change: false };
    const avant = JSON.stringify(cur.data);
    const p = fn(structuredClone(cur.data));
    if (!p || JSON.stringify(p) === avant) return { p: cur.data, change: false };
    const r = await st.setJSON("paiement/" + jeton, p, { onlyIfMatch: cur.etag });
    if (r && r.modified) return { p, change: true, avant: JSON.parse(avant) };
  }
  throw new Error("paiement occupé");
}
export async function parRef(st, ref) {
  const l = await st.get("ref/" + String(ref || "").toUpperCase(), { type: "json" });
  return l && l.jeton ? lire(st, l.jeton) : null;
}
export async function parCle(st, prefixe, id) {
  const l = id ? await st.get(prefixe + "/" + id, { type: "json" }) : null;
  return l && l.jeton ? lire(st, l.jeton) : null;
}
const histo = (p, quoi, now) => { p.historique = (p.historique || []).concat([{ le: new Date(now).toISOString(), quoi }]).slice(-40); return p; };

/* Création du dossier de paiement d'une réservation (automatique ou après validation manuelle).
   Un éventuel lien précédent non payé est « remplacé » : il ne peut plus servir. */
export async function creer(st, { ref, idDemande, montant, libelle, description, priseEnCharge, origine, now = deps.now() }) {
  const cents = Math.round(Number(montant) * 100);
  if (!(cents >= 100 && cents <= 500_000)) throw new Error("montant");
  const limite = priseEnCharge - REGLES.limiteAvantH() * 3600_000;
  if (!(limite - now > 35 * 60_000)) throw new Error("delai");
  const ancien = await parRef(st, ref);
  if (ancien && ["paye", "en_cours", "rembourse_partiel", "a_verifier"].includes(ancien.statut)) throw new Error("deja_paye");
  const jeton = nouveauJeton();
  const p = histo({ v: 1, jeton, ref, idDemande: idDemande || "", origine, montantCents: cents, devise: "eur", libelle, description: description || "",
    priseEnCharge: new Date(priseEnCharge).toISOString(), valableJusqu: new Date(limite).toISOString(),
    statut: "en_attente", etape: "attente_paiement", sessions: [], sessionActive: null, tentatives: 0,
    paymentIntent: null, charge: null, payeLe: null, rembourseCents: 0, litige: false,
    notifications: {}, huber: { etat: "non_transmise", cle: ref }, cree: new Date(now).toISOString() }, "lien de paiement créé (" + (cents / 100).toFixed(2) + " €)", now);
  await st.setJSON("paiement/" + jeton, p, { onlyIfNew: true });
  await st.setJSON("ref/" + ref, { jeton });
  if (ancien && ancien.jeton !== jeton) await modifier(st, ancien.jeton, (a) => (["en_attente", "expire"].includes(a.statut) ? histo({ ...a, statut: "remplace" }, "remplacé par un nouveau lien", now) : null));
  return p;
}

/* Effet d'une session Stripe RELUE auprès de Stripe (jamais du contenu brut d'un webhook) */
const RANG = { en_attente: 0, expire: 0, annule: 0, remplace: 0, en_cours: 1, paye: 2, a_verifier: 2, rembourse_partiel: 3, rembourse: 4 };
export function appliquerSession(p, s, now = deps.now()) {
  if (!p || !s) return p;
  const conforme = s.amount_total === p.montantCents && s.currency === "eur" && s.metadata && s.metadata.ref === p.ref && s.metadata.paiement === p.jeton && s.livemode === false;
  const sess = (p.sessions || []).find((x) => x.id === s.id);
  if (sess) sess.statut = s.status;
  if (s.status === "expired" && p.sessionActive === s.id) p.sessionActive = null;
  if (s.status !== "complete") return p;
  if (s.payment_status === "paid") {
    if (RANG[p.statut] >= 2) return p;                                    // déjà payé (rejeu) : rien ne change
    p.paymentIntent = typeof s.payment_intent === "string" ? s.payment_intent : s.payment_intent && s.payment_intent.id || null;
    p.payeLe = new Date(now).toISOString(); p.sessionActive = null;
    if (!conforme || !["en_attente", "en_cours", "expire"].includes(p.statut)) {
      p.motifVerification = !conforme ? "montant_ou_reference" : "lien_" + p.statut;
      p.statut = "a_verifier";
      return histo(p, "paiement reçu à vérifier (" + p.motifVerification + ")", now);
    }
    p.statut = "paye";
    if (p.etape === "attente_paiement") p.etape = "payee_attente_attribution";
    p.huber = { ...(p.huber || {}), etat: "en_attente_api" };             // HUBER : transmission dès que son API existera
    return histo(p, "paiement confirmé par Stripe", now);
  }
  if (s.payment_status === "unpaid" && RANG[p.statut] < 1 && p.statut === "en_attente") { p.statut = "en_cours"; return histo(p, "paiement en cours de validation (différé)", now); }
  return p;
}
export function appliquerEchecDiffere(p, now = deps.now()) {
  if (!p || p.statut !== "en_cours") return p;
  p.statut = "en_attente"; p.sessionActive = null;                       // le client peut réessayer avec le même lien
  return histo(p, "paiement différé refusé", now);
}
export function appliquerCharge(p, ch, now = deps.now()) {
  if (!p || !ch) return p;
  if (ch.amount_refunded > 0) {
    const total = ch.amount_refunded >= ch.amount;
    if (p.rembourseCents === ch.amount_refunded && p.statut === (total ? "rembourse" : "rembourse_partiel")) return p;
    p.rembourseCents = ch.amount_refunded; p.charge = ch.id;
    p.statut = total ? "rembourse" : "rembourse_partiel";
    return histo(p, (total ? "remboursement intégral" : "remboursement partiel") + " : " + (ch.amount_refunded / 100).toFixed(2) + " €", now);
  }
  return p;
}

/* Libellés affichés dans /documents */
export const LIBELLES = {
  en_attente: "Lien envoyé — paiement en attente", en_cours: "Paiement en cours de validation", paye: "Payée",
  a_verifier: "Paiement reçu — à vérifier", rembourse_partiel: "Remboursée partiellement", rembourse: "Remboursée",
  annule: "Lien annulé", expire: "Lien expiré (non payé)", remplace: "Lien remplacé",
  attente_paiement: "En attente de paiement", payee_attente_attribution: "Payée — en attente d'attribution",
  chauffeur_confirme: "Chauffeur confirmé", annulee_indisponible: "Annulée — indisponibilité", sans_chauffeur: "Annulée — aucun chauffeur", annulee: "Annulée"
};
export function resume(p) {
  if (!p) return null;
  return { lien: "/payer/" + p.jeton, montant: p.montantCents / 100, statut: p.statut, statutLibelle: LIBELLES[p.statut] || p.statut,
    etape: p.etape, etapeLibelle: LIBELLES[p.etape] || p.etape, valableJusqu: p.valableJusqu, priseEnCharge: p.priseEnCharge,
    payeLe: p.payeLe, paymentIntent: p.paymentIntent, rembourse: p.rembourseCents / 100, litige: !!p.litige, motifVerification: p.motifVerification || null,
    chauffeur: p.chauffeur || null, huber: p.huber, devis: p.devis || null, factures: p.factures || null, historique: (p.historique || []).slice(-12), mode: "test" };
}
