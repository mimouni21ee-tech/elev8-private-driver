/* ==========================================================================
   ELEV8 Private Driver — réservation Dijon : réglages (prototype v4)
   --------------------------------------------------------------------------
   PROTOTYPE. Chaque valeur porte l'une de ces mentions :
     [VALIDÉ]   décidé par ELEV8 (12 nov. 2026)
     [DÉMO]     valeur de démonstration, À VALIDER avant toute mise en service
   Tant que tarifs.statut n'est pas "valide", la page affiche « démonstration »
   à côté de chaque prix.

   En mode « serveur », la grille est appliquée par la fonction « devis-dijon » (avec
   assets/js/dijon-tarif.js et CE fichier, lus côté serveur) : le navigateur affiche
   le prix renvoyé et ne décide jamais du montant. Aucune clé ni secret ici.
   ========================================================================== */
var DIJON_CONFIG = {

  mode: "serveur",             // simulation (aperçu) | serveur (préproduction : fonctions Netlify)
  endpointDevis: "/devis-dijon",
  endpointLieux: "/lieux-dijon",

  /* Sécurités du prototype */
  paiementReel: false,          // Stripe : aucun paiement débité
  transmissionHubert: false,    // HUBERT : aucune course publiée

  reservation: {
    delaiMinimumHeures: 2,      // [DÉMO] départ au plus tôt dans 2 h
    validiteDevisMinutes: 15    // [DÉMO] durée de garantie du prix affiché
  },

  tarifs: {
    statut: "provisoire",          // grille des trajets VALIDÉE (12 nov. 2026, soir) ; forfait km de mise à disposition et acompte encore à confirmer
    devise: "EUR",

    /* ---------- Trajets classiques (aller simple, aller-retour) — GRILLE OFFICIELLE ELEV8 (validée le 12 nov. 2026, soir) ----------
       prix_course = max(minimum de la catégorie ET de la période, distance_routiere_km × tarif_km_applicable)
       Le minimum inclut les premiers kilomètres : il ne s'additionne jamais au prix kilométrique.
       Tarif de jour : lundi → samedi, 7 h 00 → 18 h 59, hors jours fériés.
       Tarif majoré : 19 h 00 → 6 h 59 chaque nuit, dimanche 0 h → 24 h, jours fériés 0 h → 24 h.
       Heure locale de prise en charge, fuseau Europe/Paris. Aucune autre majoration (pas de +20 %). */
    trajets: {
      minimum: {                                              // [VALIDÉ] par course (chaque trajet d'un aller-retour), selon la période
        confort: { jour: 20, majore: 15 },                   // [VALIDÉ 17 nov. 2026] minimum de jour 20 € (au lieu de 10 €) ; majoré inchangé
        van:     { jour: 20, majore: 25 }
      },
      tarifKm: {                                              // [VALIDÉ] € par km de distance routière avec le client
        confort: { jour: 1.90, majore: 2.75 },               // [VALIDÉ 17 nov. 2026] jour 1,90 €/km (au lieu de 1,75 €) ; majoré inchangé
        van:     { jour: 2.25, majore: 3.25 }
      },
      jour: { debut: "07:00", fin: "19:00" },                // [VALIDÉ] tarif de jour de 7 h 00 inclus à 19 h 00 exclu
      majoreDimanche: true,                                  // [VALIDÉ]
      majoreJoursFeries: true,                               // [VALIDÉ] jours fériés français calculés chaque année
      feriesAlsaceMoselle: false,                            // Vendredi saint et 26 décembre : non applicables à Dijon
      fuseau: "Europe/Paris",
      arrondiDistanceKm: 0.1,                                // [À VALIDER] précision de la distance facturée
      /* Kilomètres hors charge (approche, retour à vide) — DONNÉES INTERNES UNIQUEMENT.
         Stratégie ELEV8 : aucun supplément automatique ; ces kilomètres ne sont jamais facturés.
         Ils sont mesurés pour les simulations de rentabilité et transmis à HUBERT pour l'enchaînement des missions. */
      horsCharge: {
        coefficient_approche: null,                          // non utilisé pour la facturation (pas de supplément automatique)
        coefficient_retour: null,                            // non utilisé pour la facturation
        zoneReference: { nom: "Dijon", lat: 47.3220, lon: 5.0415, rayonKm: 15 }   // [À VALIDER] rayon de travail du prototype
      },
      /* Longues distances (départ ou arrivée hors de la zone de référence) : réservation sur devis,
         sans paiement en ligne, tant que leurs règles commerciales et leur rentabilité ne sont pas validées. */
      longueDistance: { reservableEnLigne: false }
    },
    /* Anciens paramètres retirés (historique, non appliqués) : prise en charge 12 €, 0,30 €/min,
       paliers 1,90 / 1,60 / 1,40 €/km, minimum 35 €, majoration de nuit +20 %, Van = Confort +30 %,
       tarifs de jour du 12 nov. 2026 (matin) : 2,42 €/km Confort et 3,00 €/km Van ;
       grille remplacée le 12 nov. 2026 (soir) : minimum unique 25 € / 40 €, 2,28 / 3,42 €/km Confort,
       2,86 / 4,20 €/km Van. */

    /* ---------- Mise à disposition avec chauffeur ---------- */
    miseADisposition: {
      tarifHoraire: { confort: 50, van: 75 },     // [VALIDÉ] € par heure
      prixKmSupplementaire: 2.50,                 // [VALIDÉ] € par km au-delà du forfait inclus (les deux catégories)
      kmInclusParHeure: 20,                       // [PROVISOIRE] km compris dans le forfait, par heure réservée — à confirmer
      majorationNuit: null,                       // [VALIDÉ] aucune majoration de nuit en mise à disposition avant validation
      dureeMinimumHeures: 2,                      // [VALIDÉ, envisagé] minimum de réservation
      durees: [2, 3, 4, 6, 8],                    // [VALIDÉ] durées proposées (+ durée personnalisée)
      dureeMaximumHeures: 12,                     // [DÉMO] limite de la durée personnalisée
      pasDureeHeures: 0.5,                        // [DÉMO] durée personnalisée par demi-heure
      depassement: {
        heureSupplementaire: "tarifHoraire",      // [DÉMO] tarif horaire de la catégorie…
        trancheMinutes: 30,                       // [DÉMO] …facturé par tranche de 30 min entamée
        peagesStationnement: "Péages et stationnement en sus, sur justificatif"   // [DÉMO] à valider
      }
    },

    /* ---------- Acompte (commun) ---------- */
    acompte: { taux: 0.25, minimum: 10 },          // [ÉTUDE] 25 % au centime près, 10 € minimum, plafonné au prix total
    frais: []                                      // aucun frais ajouté au prix
  },

  /* Conditions affichées au récapitulatif — reprises du PROJET DE CGV du 12 nov. 2026 (page /dijon/cgv/).
     Projet à valider juridiquement : rien n'est appliqué automatiquement. */
  conditions: {
    annulation: "Projet de CGV (art. 6) : annulation gratuite plus de 3 h avant la prise en charge, avec remboursement de toutes les sommes versées. À 3 h ou moins : frais de 25 % du prix total confirmé, 10 € minimum, jamais plus que le prix total ; le trop-versé est remboursé.",
    confirmation: "Projet de CGV (art. 2) : votre réservation n'est confirmée qu'une fois le prix définitif accepté, un chauffeur disponible identifié, le premier paiement éventuel effectué, et après confirmation écrite d'ELEV8.",
    fraisTrajet: "Projet de CGV (art. 3) : aucun frais supplémentaire sans annonce claire préalable. Toute modification substantielle peut donner lieu à un nouveau devis.",
    attente: "Projet de CGV (art. 8) : attente gratuite de 5 min à une adresse, un hôtel ou une entreprise, 20 min en gare, 60 min à l'aéroport après l'atterrissage. Au-delà, 0,50 € TTC par minute, au maximum 20 min (10 €) à une adresse, 30 min (15 €) en gare ou à l'aéroport. Attente totale maximum : 25 min, 50 min ou 90 min ; le chauffeur peut ensuite partir.",
    nonPresentation: "Projet de CGV (art. 8.5 et 8.6) : en cas de non-présentation après l'attente maximum, frais de 25 % du prix total confirmé, 10 € minimum, jamais plus que le prix total ; le reste est remboursé. Ces frais, comme ceux d'une annulation tardive, reviennent intégralement au chauffeur, sans commission ELEV8. Ils ne s'ajoutent ni aux frais d'attente ni aux frais d'annulation."
  },

  /* Conditions générales de vente : PROJET, non publié commercialement */
  cgv: { version: "projet-2026-11-12-art8-revise", libelle: "projet du 12 novembre 2026, article 8 révisé", url: "/dijon/cgv/", statut: "projet" },

  /* Échéancier de paiement (projet de CGV, art. 5) — AUCUN paiement, SMS ni lien Stripe n'est actif.
     Calculé par assets/js/dijon-paiement.js pour l'affichage et les tests uniquement. */
  paiements: {
    actif: false,                                   // Stripe : désactivé
    statut: "projet",
    fuseau: "Europe/Paris",
    premierPaiement: { taux: 0.25, minimum: 10 },   // étape 2 : payé AVANT la recherche du chauffeur
    reglementIntegralSiMoinsDeHeures: 24,           // réservation à moins de 24 h : règlement intégral dès la réservation
    rappelSolde: { actif: false, heuresAvant: 24, canal: "sms", moyen: "lien de paiement Stripe" },   // envoi réel non activé
    /* Étape 2 (simulation) — décisions du 12 nov. 2026 */
    lienPaiementMinutes: { reservation: 60, devis: 1440 },  // validité du lien du paiement initial (borné par le délai minimal ci-dessous)
    delaiMinimumPaiementMinutes: 105,               // paiement en ligne seulement si le départ est dans 1 h 45 au moins (2 h, tolérance de saisie 15 min)
    solde: { lienHeuresAvant: 24, relanceHeuresAvant: 8, echeanceHeuresAvant: 3, annulationAutomatique: false }
  },

  /* Garanties bancaires hybrides (étape 3, décisions du 12 nov. 2026, 23 h 13) — SIMULATION ou STRIPE MODE TEST uniquement.
     < 24 h : autorisation du prix total · 24 h à 6 jours : empreinte 25 % (min. 10 €, plafonnée)
     > 6 jours : carte enregistrée chez Stripe (consentement explicite), AUCUN fonds garanti.
     J-1 : lien d'autorisation du total · H-3 : vérification · prise en charge effective : capture du total. */
  garanties: {
    totalSiMoinsDeHeures: 24,
    empreinteJusquaJours: 6,
    empreinte: { taux: 0.25, minimum: 10 },
    validiteAutorisationJours: 7,                   // simulation ; en mode test Stripe, la date réelle (capture_before) fait foi
    lienGarantieMinutes: { reservation: 60, devis: 1440 },
    totalDemandeHeuresAvant: 24, relanceHeuresAvant: 8, verificationHeuresAvant: 3,
    margeValiditeApresDepartMinutes: 120,           // une autorisation doit rester valable jusqu'au départ + 2 h (attente, non-présentation)
    priseEnChargePossibleAvantMinutes: 60,          // confirmation de prise en charge au plus tôt 1 h avant l'heure prévue
    autorisationHorsSessionAutomatique: false,      // à H-3 : aucune tentative automatique sur la carte enregistrée (décision du standard)
    consentementCarte: { version: "carte-2026-11-13", texte: "J'autorise ELEV8 à enregistrer ma carte auprès de son prestataire de paiement Stripe et à l'utiliser, sans nouvelle intervention de ma part, uniquement pour autoriser et débiter le prix de cette course et, le cas échéant, les frais d'annulation tardive ou de non-présentation prévus aux CGV. Ma carte est supprimée à la clôture du dossier." }
  },

  /* Attribution du chauffeur après la garantie bancaire (décision du 13 nov. 2026, 1 h 16, option B)
     Heure de Paris à l'obtention de la garantie :
       8 h – 20 h : + 4 h ; échéance après 22 h → 12 h le lendemain
       20 h – 8 h : 12 h (le jour même avant 8 h, sinon le lendemain)
     Toujours au plus tard départ − 45 min. Rappel prioritaire au standard à 8 h pour les demandes de la nuit. */
  attribution: {
    jourDebut: "08:00",
    jourFin: "20:00",
    delaiJourMinutes: 240,
    plafondSoir: "22:00",
    limiteNuit: "12:00",
    rappelNuit: "08:00",
    margeAvantDepartMinutes: 45,
    alerteAvantMinutes: 30,                         // alerte au standard ; à mi-délai si le délai total est inférieur à 1 h
    delaiMinimalMinutes: 15                         // en dessous : pas de recherche possible → indisponible et remboursement intégral
  },

  contact: { telephone: null, message: "Pour une prise en charge urgente (départ dans moins de 2 h), contactez directement ELEV8." },

  /* Annulation par le client (projet de CGV, art. 6) — calcul prévu, NON appliqué (aucun remboursement automatique) */
  annulation: {
    actif: false,
    statut: "projet",
    gratuiteAuDelaHeures: 3,                        // plus de 3 h avant : gratuite
    frais: { taux: 0.25, minimum: 10 },             // 3 h ou moins : 25 % du prix total, 10 € minimum, plafonné au total
    attribution: { chauffeur: 1, commissionElev8: 0 }   // art. 8.6 : frais retenus intégralement au chauffeur, sans commission
  },

  /* Attente (projet de CGV, art. 8 révisé) — calcul prévu, NON appliqué (aucun prélèvement automatique).
     Aéroport : décompté à partir de l'atterrissage effectif ; adresse et gare : à partir de l'heure convenue. */
  attente: {
    actif: false,
    statut: "projet",
    prixMinute: 0.50,                                                     // € TTC par minute au-delà de la franchise
    lieux: {
      adresse:  { libelle: "Adresse, domicile, hôtel ou entreprise", gratuitMinutes: 5,  supplementMaxMinutes: 20, depuis: "heure de prise en charge convenue" },
      gare:     { libelle: "Gare",                                    gratuitMinutes: 20, supplementMaxMinutes: 30, depuis: "heure de prise en charge convenue" },
      aeroport: { libelle: "Aéroport",                                gratuitMinutes: 60, supplementMaxMinutes: 30, depuis: "atterrissage effectif du vol" }
    }
  },

  /* Non-présentation du client (projet de CGV, art. 8.5 et 8.6) — calcul prévu, NON appliqué */
  nonPresentation: {
    actif: false,
    statut: "projet",
    frais: { taux: 0.25, minimum: 10 },             // 25 % du prix total confirmé, 10 € minimum, plafonné au total
    attribution: { chauffeur: 1, commissionElev8: 0 },
    cumulAvecAttente: false,                        // jamais ajoutés aux frais d'attente
    cumulAvecAnnulation: false                      // jamais ajoutés aux frais d'annulation
  },

  /* Historique (non appliqué) : prototype v1 du 11 nov. 2026 — prise en charge 12 €, minimum 35 € par trajet,
     acompte 30 % (minimum 20 €). Conservé pour mémoire uniquement. */

  vehicules: {
    confort: {
      nom: "Confort",
      categorie: "Berline ou SUV premium",
      modele: "Berline ou SUV premium",
      equivalent: "catégorie équivalente selon disponibilité",
      passagersMax: 4, bagagesMax: 3,
      image: "/assets/img/tesla-model-y.jpg?v=3",
      texte: "Un véhicule premium récent, confortable et discret, pour vos trajets en ville comme sur la route."
    },
    van: {
      nom: "Van Premium",
      categorie: "Van haut de gamme",
      modele: "Mercedes Classe V",
      equivalent: "ou autre van haut de gamme équivalent",
      passagersMax: 7, bagagesMax: 7,
      image: "/assets/img/mercedes-classe-v.jpg?v=2",
      texte: "Davantage d'espace et de confort, pour voyager à l'aise, seul ou à plusieurs."
    }
  },
  noteVehicules: "Photos d'illustration. Le véhicule exact dépend du chauffeur attribué ; la catégorie réservée est garantie.",

  /* Attentions offertes à bord, selon équipements et disponibilités — transmises au chauffeur */
  attentions: [
    { id: "eau_plate", libelle: "Eau plate" },
    { id: "eau_gazeuse", libelle: "Eau gazeuse" },
    { id: "douceurs", libelle: "Petites douceurs" },
    { id: "chargeur", libelle: "Chargeur de téléphone" },
    { id: "calme", libelle: "Trajet calme" },
    { id: "musique", libelle: "Musique douce" },
    { id: "demande", libelle: "Demande particulière", precision: true }
  ],

  /* Données préparées pour HUBERT (format provisoire, à aligner sur le rapport technique) */
  /* Identité d'apporteur transmise à HUBERT (même raison sociale que les CGV) — aucune connexion dans cette version */
  hubert: {
    id: "ELEV8",
    apporteur: "SASU ELEV8 Private Driver",
    source: "ELEV8",
    connecte: false
  }
};
/* Même fichier lu par le navigateur (window.DIJON_CONFIG) et par la fonction serveur « devis-dijon ». */
if (typeof window !== "undefined") window.DIJON_CONFIG = DIJON_CONFIG;
if (typeof module !== "undefined" && module.exports) module.exports = DIJON_CONFIG;
