/* ==========================================================================
   ELEV8 Private Driver — demandes enregistrées côté serveur
   --------------------------------------------------------------------------
   Chaque demande envoyée depuis le site est enregistrée dans le magasin Netlify
   Blobs « elev8-demandes » sous un IDENTIFIANT OPAQUE (144 bits aléatoires).
   L'e-mail envoyé à ELEV8 ne contient que cet identifiant : aucune donnée
   personnelle dans les liens. La page /documents ne peut lire une demande
   qu'après authentification (fonction /documents-api).

   Clés :  demande/<identifiant>  → la demande (client, trajet, estimation)
           ref/<référence>        → { id } pour rouvrir une demande par sa référence
   Conservation : 12 mois après la date du trajet demandé (legal.dureeDemandes, politique
   de confidentialité), puis suppression automatique (fonction planifiée rl-cleanup).
   ========================================================================== */
import { randomBytes } from "node:crypto";
import { getStore } from "@netlify/blobs";

export const DUREE_MS = 365 * 86400_000;
export const ID_RE = /^[A-Za-z0-9_-]{24}$/;
export const REF_RE = /^E8-[A-Z0-9-]{3,30}$/;

export const deps = { store: null };
export function magasin() {
  return deps.store || getStore({ name: "elev8-demandes", consistency: "strong" });
}
export const nouvelId = () => randomBytes(18).toString("base64url");     // 24 caractères, non devinable

/* Enregistre la demande validée par /envoi-reservation. Renvoie l'identifiant opaque. */
export async function enregistrer(st, { ref, d, est, now = Date.now() }) {
  const id = nouvelId();
  // 12 mois après la date du trajet demandé (legal.dureeDemandes), et jamais moins de 12 mois après la réception
  const trajet = Date.parse((d.date || "") + "T23:59:59Z");
  const expire = Math.max(now, Number.isFinite(trajet) ? trajet : now) + DUREE_MS;
  const vehicule = /pas de préférence/i.test(d.vehicule || "") && est && est.vehicule ? est.vehicule : d.vehicule;
  const record = {
    v: 1, id, ref,
    recu: new Date(now).toISOString(),
    expire: new Date(expire).toISOString(),
    client: { prenom: d.prenom, nom: d.nom, societe: d.societe || "", email: d.email || "", telephone: d.telephone },
    prestation: {
      type: d.prestation || "", date: d.date, heure: d.heure, depart: d.depart, destination: d.destination,
      allerRetour: !!d.allerRetour, dateRetour: d.dateRetour || "", heureRetour: d.heureRetour || "",
      vehicule, vehiculeDemande: d.vehicule || "", passagers: d.passagers, bagages: d.bagages == null ? "" : d.bagages,
      precisions: d.precisions || "", reference: d.reference || "", typeReference: d.typeReference || ""
    },
    estimation: est ? {
      statut: est.statut, motif: est.motif || null,
      montant: est.statut === "estimation" && est.montant > 0 ? est.montant : null,
      distanceKm: est.statut === "estimation" ? est.distanceKm ?? null : null,
      dureeMin: est.statut === "estimation" ? est.dureeMin ?? null : null,
      lignes: Array.isArray(est.lignes) ? est.lignes : []
    } : null,
    origine: d.origine ? (d.origine.libelle || d.origine.code || "") : ""
  };
  await st.setJSON("demande/" + id, record, { metadata: { expire } });
  await st.setJSON("ref/" + ref, { id, expire });
  return id;
}
export async function supprimer(st, record) {
  try { await st.delete("demande/" + record.id); } catch { /* ignoré */ }
  try { await st.delete("ref/" + record.ref); } catch { /* ignoré */ }
}

/* Lecture (réservée à /documents-api, après authentification) */
export async function chargerParId(st, id, now = Date.now()) {
  if (typeof id !== "string" || !ID_RE.test(id)) return { erreur: "invalide" };
  const r = await st.get("demande/" + id, { type: "json" });
  if (!r) return { erreur: "introuvable" };
  if (Date.parse(r.expire) <= now) { await supprimer(st, r); return { erreur: "expiree" }; }
  return { record: r };
}
export async function chargerParRef(st, ref, now = Date.now()) {
  ref = String(ref || "").trim().toUpperCase();
  if (!REF_RE.test(ref)) return { erreur: "invalide" };
  const lien = await st.get("ref/" + ref, { type: "json" });
  if (!lien || !lien.id) return { erreur: "introuvable" };
  return chargerParId(st, lien.id, now);
}

/* Suppression des demandes de plus de 12 mois (appelée par la fonction planifiée) */
export async function nettoyer(st, now = Date.now()) {
  let n = 0;
  const { blobs } = await st.list({ prefix: "demande/" });
  for (const b of blobs) {
    const m = await st.getMetadata(b.key);
    const exp = m && m.metadata && Number(m.metadata.expire);
    if (Number.isFinite(exp) && exp <= now) {
      const r = await st.get(b.key, { type: "json" });
      if (r) await supprimer(st, r); else await st.delete(b.key);
      n++;
    }
  }
  return n;
}
