/* ==========================================================================
   ELEV8 Private Driver — suggestions d'adresses, version rapide (« Edge »)
   --------------------------------------------------------------------------
   Même code que netlify/functions/adresses.mjs, mais exécuté sur le serveur
   Netlify le plus proche du client (Paris, Genève…) au lieu des États-Unis :
   les suggestions s'affichent nettement plus vite.
   Cette version répond en priorité à l'adresse /adresses ; la fonction
   classique reste en place en secours.
   ========================================================================== */
import handler from "../functions/adresses.mjs";

export default handler;

export const config = { path: "/adresses" };
