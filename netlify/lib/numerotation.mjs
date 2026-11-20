/* ==========================================================================
   ELEV8 Private Driver — numérotation des factures et avoirs
   Série « F » : F-AAAA-0001… (compteur « compteur/AAAA », le même que celui des factures déjà
   émises depuis /documents : la série continue, aucun numéro n'est réinitialisé ni réutilisé).
   Série « AV » (avoirs, étape 3) : AV-AAAA-0001… (compteur « compteur-AV/AAAA »).
   Sur le site de test, le magasin est distinct (« elev8-factures-test ») et les numéros sont
   préfixés « TEST- » : aucune collision possible avec les vraies factures.
   Écriture conditionnelle : deux émissions simultanées ne reçoivent jamais le même numéro.
   ========================================================================== */
import { estSiteDeTest } from "./environnement.mjs";

const cleCompteur = (annee, serie) => (serie === "F" ? "compteur/" : "compteur-" + serie + "/") + annee;
const format = (serie, annee, n) => (estSiteDeTest() ? "TEST-" : "") + `${serie}-${annee}-${String(n).padStart(4, "0")}`;

/* « par » (facultatif) : identifiant de l'émission qui prend le numéro, conservé dans le compteur.
   Si cette émission est interrompue avant d'enregistrer son document, elle peut reprendre
   EXACTEMENT ce numéro (numeroAttribue) au lieu d'en prendre un nouveau : pas de trou. */
export async function numeroSuivant(st, annee, serie = "F", par = "") {
  const cle = cleCompteur(annee, serie);
  for (let i = 0; i < 10; i++) {
    const cur = await st.getWithMetadata(cle, { type: "json" });
    const n = (cur && cur.data && Number.isInteger(cur.data.n) ? cur.data.n : 0) + 1;
    const val = par ? { n, par } : { n };
    const r = cur ? await st.setJSON(cle, val, { onlyIfMatch: cur.etag }) : await st.setJSON(cle, val, { onlyIfNew: true });
    if (r && r.modified) return format(serie, annee, n);
  }
  throw new Error("numérotation occupée");
}
/* Dernier numéro de la série, s'il a été pris par « par » et n'est encore utilisé par aucun document */
export async function numeroAttribue(st, annee, serie, par, existe) {
  const cur = await st.get(cleCompteur(annee, serie), { type: "json" });
  if (!cur || cur.par !== par || !Number.isInteger(cur.n)) return null;
  const numero = format(serie, annee, cur.n);
  return (await existe(numero)) ? null : numero;
}
