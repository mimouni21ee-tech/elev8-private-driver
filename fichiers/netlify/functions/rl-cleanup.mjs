/* Fonction planifiée : supprime chaque heure les compteurs anti-abus expirés
   (empreintes d'adresses IP), conformément à la politique de confidentialité,
   ainsi que les identifiants anti-doublon (24 h) et les compteurs d'itinéraires périmés. */
import { openStore, cleanup, cleanupDivers } from "../lib/ratelimit.mjs";

export default async () => {
  try {
    const store = openStore();
    const n = await cleanup(store);
    const m = await cleanupDivers(store);
    console.log(`Nettoyage limitation : ${n} compteur(s) expiré(s), ${m} identifiant(s) anti-doublon ou quota périmé(s) supprimé(s)`);
  } catch (e) {
    console.error("Nettoyage limitation impossible :", String(e && e.message).slice(0, 80));
  }
};

export const config = { schedule: "@hourly" };
