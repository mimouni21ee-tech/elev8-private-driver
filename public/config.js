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

  /* ---------- 1. Accueil ----------
     Deux boutons visibles dès l'arrivée : réservation (formulaire) et WhatsApp direct. */
  accueil: {
    surtitre: "Service privé · Sur réservation",
    slogan: "L'excellence<br><em>à chaque destination.</em>",   // <br> = retour à la ligne
    texte: "Votre chauffeur en Tesla Model Y ou Mercedes-Benz Viano, à Genève et dans les Alpes, sur la Côte d'Azur et en Bourgogne.",
    boutonReservation: "Demander une réservation",
    boutonCourt: "Réserver un trajet",              // Barre flottante en bas d'écran
    boutonWhatsApp: "Contacter via WhatsApp"
  },

  /* Engagements : affichés sur une ligne discrète en bas de l'accueil */
  engagements: ["Service personnalisé", "Discrétion", "Confort", "Ponctualité", "Réservation simplifiée"],

  /* ---------- Fiche contact « Enregistrer mon chauffeur » (vCard) ----------
     Générée automatiquement à partir des informations de ce fichier (nom, téléphone,
     WhatsApp, site) et du logo assets/img/e8-contact.jpg. */
  ficheContact: {
    url: "/elev8-private-driver.vcf",
    inclureEmail: false,     // Passez à true quand contact.email sera une boîte opérationnelle
    fonction: "Chauffeur privé",
    note: "Chauffeur privé sur réservation · Genève et stations de ski · Côte d'Azur · Dijon et Bourgogne"
  },

  /* ---------- Mode passager à bord (QR code des véhicules : lien contenant ?bord=1) ----------
     Page courte de recontact : 3 actions immédiates, puis véhicules, zones et prestations. */
  bord: {
    bienvenue: "Merci de voyager avec ELEV8 Private Driver",
    phrase: "Votre chauffeur privé,<br><em>à nouveau en un instant.</em>",   // <br> = retour à la ligne
    boutonReserver: "Réserver un trajet",
    boutonEnregistrer: "Enregistrer mon chauffeur",
    boutonWhatsApp: "Contacter via WhatsApp",
    aideIphone: "La fiche ELEV8 s'ouvre : touchez « Créer un nouveau contact » pour l'enregistrer.",
    aideAndroid: "Fiche téléchargée : ouvrez-la depuis la notification ou le dossier Téléchargements, puis choisissez « Contacts » pour l'enregistrer.",
    boutonAppeler: "Appeler",
    titreVehicules: "Véhicules",
    titreZones: "Zones desservies",
    titrePrestations: "Prestations",
    zones: ["Genève", "Stations de ski", "Côte d'Azur", "Dijon & Bourgogne"],
    lienDecouvrir: "Voir véhicules & prestations",
    lienSiteComplet: "Découvrir le site complet",
    introReservation: "Indiquez votre trajet : votre chauffeur vous confirme la disponibilité."
  },

  /* ---------- 2. Flotte ---------- */
  flotte: {
    surtitre: "La flotte",
    titre: "Deux véhicules, une même exigence",
    intro: "Choisissez le véhicule adapté à votre trajet et au nombre de passagers.",
    afficherMentionPhotoProvisoire: true,   // Passez à false après avoir mis vos photos
    vehicules: [
      {
        id: "tesla",
        nom: "Tesla Model Y",
        nomCourt: "Model Y",                // Affiché dans le choix du formulaire
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
        nomCourt: "Viano",
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

  /* ---------- 3. Prestations ----------
     icones disponibles : avion, train, mallette, route, coupe, horloge, montagne
     transfert : "vol", "train" ou "vol-train" → affiche le champ « N° de vol / de train » dans le formulaire
     afficherDansListe : false → proposé uniquement dans le formulaire */
  prestations: {
    surtitre: "Prestations",
    titre: "À chaque déplacement, son service",
    liste: [
      { icone: "avion",    titre: "Transferts aéroports",        transfert: "vol",   texte: "Départs et arrivées, notamment à Genève et à Nice." },
      { icone: "train",    titre: "Transferts gares",            transfert: "train", texte: "Genève, Dijon et la Côte d'Azur." },
      { icone: "mallette", titre: "Déplacements professionnels", texte: "Rendez-vous, séminaires, accueil de clients." },
      { icone: "route",    titre: "Longues distances",           texte: "De porte à porte, d'une région à l'autre." },
      { icone: "coupe",    titre: "Événements privés",           texte: "Mariages, soirées, galas." },
      { icone: "horloge",  titre: "Mise à disposition",          texte: "Un chauffeur pour la durée de votre choix." },
      { icone: "montagne", titre: "Transferts stations de ski",  transfert: "vol-train", afficherDansListe: false, texte: "Depuis l'aéroport ou la gare de Genève vers les stations de ski." }
    ]
  },

  /* ---------- Destinations (dans la section Prestations) ----------
     "prestation" : prestation présélectionnée dans le formulaire au toucher de la destination. */
  destinations: {
    surtitre: "Destinations",
    titre: "Trois territoires, un même service",
    note: "Autre ville de départ ou d'arrivée ? Précisez-la dans votre demande.",
    liste: [
      { region: "Suisse · Alpes",        nom: "Genève & stations de ski", texte: "Aéroport et gare de Genève, chalets et stations.", prestation: "Transferts stations de ski" },
      { region: "Alpes-Maritimes · Var", nom: "Côte d'Azur",              texte: "Aéroport de Nice, gares, soirées et événements.",   prestation: "Transferts aéroports" },
      { region: "Côte-d'Or",             nom: "Dijon & Bourgogne",        texte: "Gare de Dijon et déplacements en Bourgogne.",       prestation: "Transferts gares" }
    ]
  },

  /* ---------- 4. Réservation ---------- */
  reservation: {
    surtitre: "Réservation",
    titre: "Demander une réservation",
    intro: "Écrivez-nous directement, ou envoyez une demande détaillée. Votre chauffeur vous confirme la disponibilité.",
    waTexte: "Écrire directement, sans formulaire",
    ouTexte: "ou envoyez une demande détaillée",
    // Message prérempli du contact WhatsApp direct (boutons « Contacter via WhatsApp »)
    messageWhatsAppDirect: "Bonjour ELEV8, je souhaite des renseignements pour un trajet.",
    boutonEnvoyer: "Envoyer ma demande",
    boutonWhatsApp: "Envoyer par WhatsApp",        // Envoie le détail du formulaire dans WhatsApp
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
      "contact": "Fiche contact enregistrée",
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
