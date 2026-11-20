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

export async function numeroSuivant(st, annee, serie = "F") {
  const cle = (serie === "F" ? "compteur/" : "compteur-" + serie + "/") + annee;
  for (let i = 0; i < 10; i++) {
    const cur = await st.getWithMetadata(cle, { type: "json" });
    const n = (cur && cur.data && Number.isInteger(cur.data.n) ? cur.data.n : 0) + 1;
    const r = cur ? await st.setJSON(cle, { n }, { onlyIfMatch: cur.etag }) : await st.setJSON(cle, { n }, { onlyIfNew: true });
    if (r && r.modified) return (estSiteDeTest() ? "TEST-" : "") + `${serie}-${annee}-${String(n).padStart(4, "0")}`;
  }
  throw new Error("numérotation occupée");
}
