/* ==========================================================================
   CONFIGURATION DU SITE — ELEV8 Private Driver
   --------------------------------------------------------------------------
   Modifiez uniquement ce fichier pour changer les textes, les photos et les
   coordonnées. Gardez les guillemets "..." et les virgules en fin de ligne.
   Les photos se placent dans le dossier assets/img/ (voir README.md).
   Aucune clé secrète ne doit figurer ici : ce fichier est public.
   ========================================================================== */

window.SITE_CONFIG = {

  /* ---------- Marque ---------- */
  marque: {
    nom: "ELEV8",                       // Nom affiché dans le logo
    activite: "Private Driver",         // Affiché sous le nom
    nomComplet: "ELEV8 Private Driver", // Utilisé dans les titres, e-mails et pages légales
    monogramme: "E8"                    // Lettres affichées dans le cercle du logo
  },

  /* ---------- Site ---------- */
  site: {
    url: "https://elevateprivatedriver.com"   // Domaine officiel (sans / final)
  },

  /* ---------- Coordonnées ---------- */
  contact: {
    telephoneAffiche: "+33 6 00 00 00 00",
    telephone: "+33600000000",     // Format international, sans espaces
    whatsapp: "33600000000",       // Indicatif pays + numéro, sans + ni espaces
    email: "contact@elevateprivatedriver.com", // Adresse de contact affichée : doit être une boîte e-mail réelle
    zone: "Genève & stations de ski · Côte d'Azur · Dijon & Bourgogne",
    disponibilite: "Sur réservation"
  },

  /* ---------- Référencement (Google, partage de lien) ---------- */
  seo: {
    titre: "ELEV8 Private Driver — Chauffeur privé Genève, Côte d'Azur, Dijon",
    description: "Chauffeur privé haut de gamme à Genève et vers les stations de ski, sur la Côte d'Azur, à Dijon et en Bourgogne : transferts aéroports et gares, déplacements professionnels, longues distances, événements privés et mise à disposition."
  },

  /* ---------- 1. Accueil ---------- */
  accueil: {
    surtitre: "Genève · Côte d'Azur · Bourgogne",
    slogan: "L'excellence<br><em>à chaque destination.</em>",
    texte: "Un chauffeur attitré, un véhicule soigné, un trajet pensé pour vous.",
    bouton: "Découvrir nos services",
    image: "assets/img/hero.jpg",
    imageAlt: "Véhicule haut de gamme de nuit"
  },

  /* Message affiché aux passagers qui scannent le QR code (lien terminé par ?bord=1). */
  messageABord: "Vous êtes à bord. Gardez ce contact pour vos prochains trajets.",

  /* ---------- 2. L'expérience ---------- */
  experience: {
    surtitre: "L'expérience",
    titre: "Bien plus qu'un trajet, un service sur mesure",
    paragraphes: [
      "Chaque déplacement est préparé à l'avance : l'horaire, l'itinéraire et vos préférences sont convenus avant la prise en charge.",
      "Vous voyagez avec un chauffeur privé dédié, dans un véhicule entretenu avec soin, sans intermédiaire entre vous et votre chauffeur.",
      "Pour un rendez-vous professionnel, un départ en voyage ou une soirée, le trajet se déroule dans le calme et à votre rythme."
    ],
    signature: "Votre chauffeur privé",
    image: "assets/img/experience.jpg",
    imageAlt: "Intérieur de véhicule"
  },

  /* ---------- Destinations (zones desservies) ----------
     "prestation" : prestation présélectionnée dans le formulaire au clic sur « Demander un trajet ». */
  destinations: {
    surtitre: "Destinations",
    titre: "Trois territoires, un même service",
    intro: "Nous intervenons principalement dans ces régions. Pour un trajet au départ ou à destination d'une autre ville, indiquez-le dans votre demande.",
    liste: [
      {
        region: "Suisse · Alpes",
        nom: "Genève & stations de ski",
        texte: "Transferts depuis l'aéroport et la gare de Genève vers votre hôtel, votre chalet ou les stations de ski, et trajets retour en fin de séjour.",
        prestation: "Transferts stations de ski"
      },
      {
        region: "Alpes-Maritimes · Var",
        nom: "Côte d'Azur",
        texte: "Transferts aéroports et gares, déplacements professionnels et soirées sur la Côte d'Azur.",
        prestation: "Transferts aéroports"
      },
      {
        region: "Côte-d'Or",
        nom: "Dijon & Bourgogne",
        texte: "Transferts depuis la gare de Dijon, rendez-vous professionnels et déplacements à travers la Bourgogne.",
        prestation: "Transferts gares"
      }
    ]
  },

  /* ---------- 3. Flotte ---------- */
  flotte: {
    surtitre: "La flotte",
    titre: "Deux véhicules, une même exigence",
    intro: "Choisissez le véhicule adapté à votre trajet et au nombre de passagers.",
    afficherMentionPhotoProvisoire: true,   // Passez à false après avoir mis vos photos
    vehicules: [
      {
        id: "tesla",
        nom: "Tesla Model Y",
        categorie: "SUV 100 % électrique",
        description: "Silencieux et spacieux, idéal pour les trajets en ville, les transferts et les déplacements professionnels.",
        passagersMax: 4,                    // À vérifier selon votre configuration
        caracteristiques: [
          { label: "Motorisation", valeur: "Électrique" },
          { label: "Passagers", valeur: "Jusqu'à 4" }
        ],
        image: "assets/img/tesla-model-y.jpg",
        imageAlt: "Tesla Model Y"
      },
      {
        id: "viano",
        nom: "Mercedes-Benz Viano",
        categorie: "Van grand confort",
        description: "Un espace généreux pour voyager à plusieurs, en famille ou entre collaborateurs, avec vos bagages.",
        passagersMax: 7,                    // À vérifier selon votre configuration
        caracteristiques: [
          { label: "Format", valeur: "Van" },
          { label: "Passagers", valeur: "Jusqu'à 7" }
        ],
        image: "assets/img/mercedes-viano.jpg",
        imageAlt: "Mercedes-Benz Viano"
      }
    ]
  },

  /* ---------- 4. Prestations ----------
     icones disponibles : avion, train, mallette, route, coupe, horloge, montagne
     transfert : "vol", "train" ou "vol-train" → affiche le champ « N° de vol / de train » dans le formulaire
     afficherDansListe : false → proposé uniquement dans le formulaire */
  prestations: {
    surtitre: "Prestations",
    titre: "À chaque déplacement, son service",
    liste: [
      { icone: "avion",    titre: "Transferts aéroports",        transfert: "vol",   texte: "Vers et depuis les aéroports, notamment Genève et Nice Côte d'Azur, à l'heure convenue." },
      { icone: "train",    titre: "Transferts gares",            transfert: "train", texte: "Prise en charge et dépose en gare, notamment à Genève, Dijon et sur la Côte d'Azur." },
      { icone: "mallette", titre: "Déplacements professionnels", texte: "Rendez-vous, séminaires, accueil de clients ou de collaborateurs." },
      { icone: "route",    titre: "Longues distances",           texte: "Des trajets interurbains de porte à porte, entre Genève, les Alpes, la Bourgogne et la Côte d'Azur." },
      { icone: "coupe",    titre: "Événements privés",           texte: "Mariages, soirées, galas et occasions particulières." },
      { icone: "horloge",  titre: "Mise à disposition",          texte: "Un chauffeur et un véhicule à votre disposition pour la durée de votre choix." },
      { icone: "montagne", titre: "Transferts stations de ski",  transfert: "vol-train", afficherDansListe: false, texte: "Depuis l'aéroport ou la gare de Genève vers les stations de ski." }
    ]
  },

  /* ---------- 5. Avantages ---------- */
  avantages: {
    surtitre: "Nos engagements",
    titre: "Ce qui fait la différence",
    liste: [
      { titre: "Service personnalisé", texte: "Vos préférences et vos contraintes sont prises en compte dès la demande." },
      { titre: "Discrétion",           texte: "Vos trajets, vos échanges et vos informations restent confidentiels." },
      { titre: "Confort",              texte: "Un véhicule haut de gamme et une conduite souple, pour voyager sereinement." },
      { titre: "Ponctualité",          texte: "La prise en charge est organisée à l'avance pour respecter vos horaires." },
      { titre: "Réservation simplifiée", texte: "Une demande en quelques champs, une confirmation directe par votre chauffeur." }
    ]
  },

  /* ---------- 6. Réservation ---------- */
  reservation: {
    surtitre: "Réservation",
    titre: "Demander une réservation",
    intro: "Envoyez votre demande directement depuis le site, ou préparez un message WhatsApp. Votre chauffeur vous confirme ensuite la disponibilité.",
    boutonEnvoyer: "Envoyer ma demande",
    boutonWhatsApp: "Contacter via WhatsApp",
    introMessage: "Bonjour, je souhaite faire une demande de réservation :",
    // Si vous modifiez legal.dureeDemandes, adaptez aussi la durée citée ici.
    noteConfidentialite: "Les champs sans mention « facultatif » sont nécessaires. « Envoyer ma demande » transmet vos informations par e-mail à ELEV8 Private Driver, via notre prestataire d'envoi, uniquement pour traiter votre demande ; elles sont conservées au plus 12 mois si la demande reste sans suite. Vous pouvez y accéder ou demander leur suppression : <a href=\"confidentialite.html\">politique de confidentialité</a>.",
    noteWhatsApp: "WhatsApp s'ouvre avec votre message prérempli. Il ne part qu'après avoir appuyé sur « Envoyer » dans l'application, et l'échange est alors traité par WhatsApp (groupe Meta) selon ses propres conditions.",
    indicatifParDefaut: "+33"
  },

  /* ---------- Envoi du formulaire ----------
     endpoint : adresse du service d'envoi.
       - Netlify (recommandé)          : "/envoi-reservation"
       - Hébergement PHP (OVH, o2switch…) : "api/reservation.php"
     turnstileSiteKey : clé PUBLIQUE Cloudflare Turnstile (anti-robot, recommandé).
       Laisser vide pour la désactiver. La clé SECRÈTE se règle côté serveur uniquement
       (variable Netlify TURNSTILE_SECRET_KEY). Les deux doivent être renseignées ensemble.
       Clé de test (toujours valide) : "1x00000000000000000000AA" — voir PROTOCOLE-TESTS.md. */
  formulaire: {
    endpoint: "/envoi-reservation",
    turnstileSiteKey: "",
    delaiMaxMs: 15000
  },

  /* ---------- Suivi des sources de demande ----------
     Aucun cookie, aucun traceur publicitaire, rien d'enregistré dans le navigateur.
     Le paramètre ?src=... du lien visité est simplement joint à la demande envoyée par le client.
     Associez ici chaque code de lien à un libellé lisible (voir CAMPAGNES.md). */
  suivi: {
    sources: {
      "tesla": "QR code — Tesla Model Y",
      "viano": "QR code — Mercedes-Benz Viano",
      "carte": "Carte de visite",
      "google-ads": "Google Ads",
      "google-maps": "Fiche Google",
      "instagram": "Instagram",
      "facebook": "Facebook",
      "linkedin": "LinkedIn",
      "partenaire-hotel": "Partenaire hôtelier",
      "flyer": "Flyer"
    },
    libelleBord: "QR code à bord",
    libelleDirect: "Accès direct"
  },

  /* ---------- 8. Informations légales ----------
     À compléter impérativement avant la mise en ligne. */
  legal: {
    raisonSociale: "[Nom de l'entreprise ou nom de l'entrepreneur]",
    formeJuridique: "[Forme juridique : EI, SASU, EURL…]",
    adresse: "[Adresse du siège]",
    siret: "[Numéro SIRET]",
    tva: "[N° de TVA intracommunautaire, le cas échéant]",
    registreVTC: "[Numéro d'inscription au registre des exploitants VTC]",
    directeurPublication: "[Prénom Nom]",
    hebergeur: "Netlify, Inc. — 101 2nd Street, San Francisco, CA 94105, États-Unis",
    prestataireEnvoi: "Brevo (Sendinblue SAS) — 9-17 rue Salneuve, 75017 Paris, France",
    dureeDemandes: "12 mois après la date du trajet demandé, lorsque la demande n'a pas donné lieu à une prestation",
    dureeClients: "3 ans après la dernière prestation, pièces comptables conservées 10 ans",
    dureeEmpreintes: "24 heures, suppression automatique au plus tard une heure après",
    messagerie: "[Ex. : Google Workspace, OVHcloud, Infomaniak…]",
    dateMiseAJour: "11 octobre 2026"
  }
};
