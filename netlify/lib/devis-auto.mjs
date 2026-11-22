/* ==========================================================================
   ELEV8 Private Driver — devis PDF envoyé automatiquement (étape B du parcours)
   --------------------------------------------------------------------------
   Déclenché dès que le tarif est validé :
     - trajet standard : validation automatique par le serveur, à l'envoi de la demande ;
     - cas particulier : quand ELEV8 crée le lien de paiement dans /documents.
   Le devis et le lien de paiement Stripe partagent LE MÊME montant, enregistré une seule fois
   dans le dossier de paiement : le montant payé est exactement celui du devis.

   Chaque devis envoyé est figé (magasin « elev8-factures », ou « elev8-factures-test » hors
   production) : devis/<numéro> = { numéro, version, référence, montant, document, date… }.
   Numéros : D-<référence> (puis -2, -3… si le montant change) ; « TEST-D-… » sur le site de test.
   Un même lien de paiement ne produit jamais deux devis (devis-jeton/<jeton>).
   ========================================================================== */
import { getStore } from "@netlify/blobs";
import { nomMagasin, estSiteDeTest } from "./environnement.mjs";
import { emetteur, manquants, nettoyer, pdf, montants, aujourdhuiParis } from "./documents.mjs";
import { modifier } from "./paiements.mjs";
import { mailDevis } from "./courriels.mjs";
import { envoyerUneFois } from "./notifications.mjs";

export const deps = { store: null, config: null };
export function magasinDevis() { return deps.store || getStore({ name: nomMagasin("elev8-factures"), consistency: "strong" }); }

function parseConfig(src) { const sandbox = {}; new Function("window", src)(sandbox); return sandbox.SITE_CONFIG; }
export async function chargerConfig(origine) {
  if (deps.config) return deps.config;
  const r = await fetch(`${origine}/config.js`, { headers: { "cache-control": "no-cache" } });
  if (!r.ok) throw new Error("config " + r.status);
  return parseConfig(await r.text());
}

/* Document du devis, à partir de la demande enregistrée (D) et du dossier de paiement (p) */
export function documentDevis(D, p, detail, valableJusqu, dateEmission) {
  const c = D.client || {}, x = D.prestation || {};
  const jours = Math.max(1, Math.min(90, Math.round((Date.parse(valableJusqu) - Date.parse(dateEmission)) / 86400_000)));
  return nettoyer({
    ref: D.ref,
    client: { prenom: c.prenom, nom: c.nom, societe: c.societe, email: c.email, telephone: c.telephone },
    prestation: { date: x.date, heure: x.heure, depart: x.depart, destination: x.destination, allerRetour: !!x.allerRetour,
      dateRetour: x.dateRetour, heureRetour: x.heureRetour, vehicule: x.vehicule, passagers: x.passagers, bagages: x.bagages,
      reference: x.reference, distanceKm: D.estimation && D.estimation.distanceKm },
    montant: detail ? detail.montant : p.montantCents / 100,
    supplements: detail ? detail.supplements : [],
    devis: { valide: true, validiteJours: jours, reglement: "en_ligne" }
  });
}

/* Numéro du devis (une version par lien de paiement) */
async function reserverNumero(st, ref, jeton, test) {
  const deja = await st.get("devis-jeton/" + jeton, { type: "json" });
  if (deja && deja.numero) return { numero: deja.numero, existant: true };
  for (let i = 0; i < 8; i++) {
    const cur = await st.getWithMetadata("devis-compteur/" + ref, { type: "json" });
    const n = ((cur && cur.data && cur.data.n) || 0) + 1;
    const r = cur ? await st.setJSON("devis-compteur/" + ref, { n }, { onlyIfMatch: cur.etag }) : await st.setJSON("devis-compteur/" + ref, { n }, { onlyIfNew: true });
    if (r && r.modified) {
      const numero = (test ? "TEST-" : "") + "D-" + ref + (n > 1 ? "-" + n : "");
      const pose = await st.setJSON("devis-jeton/" + jeton, { numero }, { onlyIfNew: true });
      if (pose && pose.modified === false) { const autre = await st.get("devis-jeton/" + jeton, { type: "json" }); return { numero: autre.numero, existant: true }; }
      return { numero, existant: false };
    }
  }
  throw new Error("devis occupé");
}

/* Produit (ou relit) le devis figé lié à ce lien de paiement. Renvoie { numero, bytes, fichier, ht, tva, taux }. */
export async function emettreDevis(D, p, { origine, detail = null, now = Date.now() }) {
  const C = await chargerConfig(origine);
  const E = emetteur(C);
  if (manquants(E).length) throw new Error("emetteur");
  const st = magasinDevis(), test = estSiteDeTest();
  const { numero, existant } = await reserverNumero(st, D.ref, p.jeton, test);
  let rec = existant ? await st.get("devis/" + numero, { type: "json" }) : null;
  if (!rec) {
    const dateEmission = aujourdhuiParis(now);
    let doc = documentDevis(D, p, detail, p.valableJusqu, dateEmission);
    // Le total du devis doit être exactement le montant du lien de paiement ; sinon, une seule ligne au montant du lien
    if (Math.round(montants(doc.montant, E, doc.supplements).ttc * 100) !== p.montantCents) doc = documentDevis(D, p, null, p.valableJusqu, dateEmission);
    rec = { numero, ref: D.ref, jeton: p.jeton, dateEmission, horodatage: new Date(now).toISOString(), montantCents: p.montantCents,
      valableJusqu: p.valableJusqu, emetteur: E, doc, test };
    await st.setJSON("devis/" + numero, rec, { onlyIfNew: true });
    rec = (await st.get("devis/" + numero, { type: "json" })) || rec;
  }
  const m = montants(rec.doc.montant, rec.emetteur, rec.doc.supplements);
  const bytes = await pdfDevis(rec);
  return { numero, bytes, fichier: numero + ".pdf", ht: m.ht, tva: m.tva, taux: m.taux, rec };
}
/* PDF d'un devis figé (identique à chaque relecture) */
export function pdfDevis(rec) {
  return pdf("devis", rec.doc, rec.emetteur, { numero: rec.numero, dateEmission: rec.dateEmission, horodatage: rec.horodatage, test: rec.test,
    reglement: { mode: "en_ligne", etat: "a_payer", montant: rec.montantCents / 100, valableJusqu: aujourdhuiParis(Date.parse(rec.valableJusqu)) } });
}

/* Envoi au client (PDF joint, bouton « Accepter le devis et payer en ligne »), copie identique à ELEV8.
   Sans e-mail client : ELEV8 reçoit le devis pour le transmettre. Un envoi par lien de paiement, jamais deux. */
export async function envoyerDevis(stPaiements, D, p, { origine, detail = null, now = Date.now() }) {
  const lien = origine + "/payer/" + p.jeton;
  let devis = null;
  try { devis = await emettreDevis(D, p, { origine, detail, now }); }
  catch (e) { console.error("Devis PDF non produit :", String(e && e.message).slice(0, 60)); }
  const m = mailDevis(D, p, lien, devis);
  if (devis) m.pieces = [{ nom: devis.fichier, contenu: devis.bytes }];
  m.copieElev8 = true;
  let envoye = false;
  if (D.client && D.client.email) envoye = await envoyerUneFois(stPaiements, p, "client_lien", m, D.client.email, now);
  else envoye = await envoyerUneFois(stPaiements, p, "elev8_devis_sans_email", { ...m, subject: "[Client sans e-mail — à transmettre] " + m.subject }, "elev8", now);
  if (devis) await modifier(stPaiements, p.jeton, (x) => (x.devis && x.devis.numero === devis.numero ? null
    : { ...x, devis: { numero: devis.numero, le: new Date(now).toISOString() }, historique: (x.historique || []).concat([{ le: new Date(now).toISOString(), quoi: "devis " + devis.numero + " envoyé" + (D.client && D.client.email ? "" : " à ELEV8 (client sans e-mail)") }]).slice(-40) })).catch(() => {});
  return { envoye, devis: devis ? devis.numero : null };
}
