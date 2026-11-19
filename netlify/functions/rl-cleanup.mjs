/* Fonction planifiée : supprime chaque heure les compteurs anti-abus expirés
   (empreintes d'adresses IP), conformément à la politique de confidentialité,
   ainsi que les identifiants anti-doublon (24 h) et les compteurs d'itinéraires périmés.
   Une fois par jour (vers 4 h, heure de Paris) : suppression des demandes enregistrées
   depuis plus de 12 mois (magasin elev8-demandes). */
import { openStore, cleanup, cleanupDivers } from "../lib/ratelimit.mjs";
import { magasin as magasinDemandes, nettoyer as nettoyerDemandes } from "../lib/demandes.mjs";
import { retenirContexte } from "../lib/environnement.mjs";

export default async (req, context) => {
  retenirContexte(context);
  try {
    const store = openStore();
    const n = await cleanup(store);
    const m = await cleanupDivers(store);
    console.log(`Nettoyage limitation : ${n} compteur(s) expiré(s), ${m} identifiant(s) anti-doublon ou quota périmé(s) supprimé(s)`);
  } catch (e) {
    console.error("Nettoyage limitation impossible :", String(e && e.message).slice(0, 80));
  }
  const heureParis = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Paris", hour: "2-digit", hourCycle: "h23" }).format(new Date()));
  if (heureParis === 4) {
    try {
      const d = await nettoyerDemandes(magasinDemandes());
      console.log(`Nettoyage des demandes : ${d} demande(s) de plus de 12 mois supprimée(s)`);
    } catch (e) {
      console.error("Nettoyage des demandes impossible :", String(e && e.message).slice(0, 80));
    }
  }
};

export const config = { schedule: "@hourly" };
