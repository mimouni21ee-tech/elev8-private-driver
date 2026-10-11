/* Fonction planifiée : supprime chaque heure les compteurs anti-abus expirés
   (empreintes d'adresses IP), conformément à la politique de confidentialité. */
import { openStore, cleanup } from "../lib/ratelimit.mjs";

export default async () => {
  try {
    const n = await cleanup(openStore());
    console.log(`Nettoyage limitation : ${n} compteur(s) expiré(s) supprimé(s)`);
  } catch (e) {
    console.error("Nettoyage limitation impossible :", String(e && e.message).slice(0, 80));
  }
};

export const config = { schedule: "@hourly" };
