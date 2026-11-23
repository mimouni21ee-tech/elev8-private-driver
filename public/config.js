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
    url: "https://elev8privatedriver.com"   // Domaine officiel (sans / final)
  },

  /* ---------- Coordonnées ---------- */
  contact: {
    telephoneAffiche: "06 26 92 72 18",
    telephone: "+33626927218",     // Format international, sans espaces
    whatsapp: "33626927218",       // Indicatif pays + numéro, sans + ni espaces
    whatsappLien: "https://wa.me/message/MZT3HSC2R4HLG1",   // Lien officiel WhatsApp Business (boutons « WhatsApp »)
    email: "contact@elev8privatedriver.com", // Adresse de contact affichée : doit être une boîte e-mail réelle
    boutonEnregistrer: "Enregistrer ELEV8 dans mes contacts",
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
    texte: "Votre chauffeur en Tesla Model Y ou Mercedes-Benz Classe V, à Genève et dans les Alpes, sur la Côte d'Azur et en Bourgogne.",
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
    inclureEmail: true,      // contact.email est une boîte opérationnelle
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
    introReservation: "Indiquez votre trajet : estimation immédiate et demande sans engagement. Vous recevez votre devis, à régler en ligne de façon sécurisée, puis la confirmation de votre chauffeur."
  },

  /* ---------- 2. Flotte ---------- */
  flotte: {
    surtitre: "La flotte",
    titre: "Deux véhicules, une même exigence",
    intro: "Choisissez le véhicule adapté à votre trajet et au nombre de passagers.",
    afficherMentionPhotoProvisoire: false,  // true = affiche la mention « Photo provisoire » sur les photos des véhicules
    vehicules: [
      {
        id: "tesla",
        /* Catégorie de véhicule : certaines courses sont assurées par des chauffeurs partenaires.
           Un véhicule équivalent respecte le confort, la capacité et la qualité de prestation annoncés. */
        nom: "Berline Confort — Tesla Model Y ou véhicule de catégorie équivalente",   // repris dans l'estimation, les e-mails, devis et factures
        titre: "Berline Confort",            // titre de la fiche (rubrique Flotte)
        sousTitre: "Tesla Model Y ou véhicule de catégorie équivalente",
        nomCourt: "Berline Confort",        // Affiché dans le choix du formulaire
        categorie: "",                      // surtitre facultatif de la fiche
        description: "Silencieux et spacieux, idéal pour les trajets en ville, les transferts et les déplacements professionnels.",
        passagersMax: 4,                    // À vérifier selon votre configuration
        caracteristiques: [
          { label: "Passagers", valeur: "Jusqu'à 4" }
        ],
        image: "assets/img/tesla-model-y.jpg?v=3",
        imageAlt: "Tesla Model Y noire"
      },
      {
        id: "classe-v",
        nom: "Van Premium — Mercedes Classe V ou véhicule de catégorie équivalente",
        titre: "Van Premium",
        sousTitre: "Mercedes Classe V ou véhicule de catégorie équivalente",
        nomCourt: "Van Premium",
        categorie: "",
        description: "Un espace généreux pour voyager à plusieurs, en famille ou entre collaborateurs, avec vos bagages.",
        passagersMax: 7,                    // À vérifier selon votre configuration
        caracteristiques: [
          { label: "Passagers", valeur: "Jusqu'à 7" }
        ],
        image: "assets/img/mercedes-classe-v.jpg?v=2",
        imageAlt: "Mercedes-Benz Classe V noir"
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
    intro: "Obtenez une estimation immédiate, puis envoyez votre demande, sans engagement ni compte à créer. Vous recevez votre devis, à régler en ligne par paiement sécurisé ; ELEV8 attribue ensuite votre course à un chauffeur et vous la confirme.",
    waTexte: "Écrire directement, sans formulaire",
    ouTexte: "ou estimez votre trajet et envoyez votre demande",
    // Message prérempli du contact WhatsApp direct (boutons « Contacter via WhatsApp »)
    messageWhatsAppDirect: "Bonjour ELEV8, je souhaite des renseignements pour un trajet.",
    boutonEnvoyer: "Demander ma réservation",      // Bouton principal : envoi de la demande, sans paiement à cette étape
    boutonAppeler: "Appeler ELEV8",
    sousTitreAppeler: "Pour une demande urgente.",       // petit texte sous « Appeler ELEV8 », dans le bouton
    sousTitreWhatsApp: "Pour échanger directement.",     // petit texte sous « WhatsApp », dans le bouton
    boutonFicheContact: "Enregistrer ELEV8 dans mes contacts",   // proposé après l'envoi réussi d'une demande
    boutonWhatsApp: "WhatsApp",                    // Envoie le détail du formulaire (et l'estimation) dans WhatsApp
    /* Estimation affichée dans le formulaire (calculée par le serveur, jamais modifiable par le client) */
    estimation: {
      titre: "Estimation de votre trajet",
      mention: "Tarif calculé selon notre grille, repris dans votre devis. L'envoi de la demande est sans engagement : aucun paiement n'est prélevé à cette étape. Votre réservation devient définitive lorsqu'un chauffeur vous est confirmé.",
      attente: "Renseignez le départ, la destination, la date et l'heure pour obtenir une estimation immédiate.",
      calcul: "Calcul de votre estimation…",
      surDevis: "Sur devis",
      horsZone: "L'estimation automatique couvre Dijon, la Côte de Nuits, Beaune et leurs environs (50 km autour de Dijon). Envoyez votre demande sans engagement : ELEV8 vous communique le tarif de ce trajet avant toute confirmation.",
      miseADisposition: "Mise à disposition : le tarif dépend de la durée et du programme. Envoyez votre demande sans engagement : ELEV8 vous communique le tarif avant toute confirmation.",
      aideInfos: "Une demande particulière peut modifier le tarif : ELEV8 vous confirme le montant final avant toute réservation."
    },
    /* Message affiché après l'envoi (jamais « réservation confirmée » : seule ELEV8 confirme) */
    envoi: {
      titre: "Votre demande a bien été envoyée !",
      texte: "Merci d'avoir choisi ELEV8 Private Driver. Nous avons bien reçu votre demande. Selon votre trajet, vous recevez votre devis à régler en ligne, ou ELEV8 vous communique le tarif. Votre réservation sera définitive uniquement lorsqu'un chauffeur vous aura été confirmé.",
      note: "Aucun paiement ne vous a été demandé. Pour toute question, appelez-nous ou écrivez-nous sur WhatsApp en indiquant votre référence."
    },
    introMessage: "Bonjour, je souhaite faire une demande de réservation :",
    // Si vous modifiez legal.dureeDemandes, adaptez aussi la durée citée ici.
    noteConfidentialite: "Les champs sans mention « facultatif » sont nécessaires. « Demander ma réservation » est gratuit et sans engagement : aucun paiement n'est prélevé à cette étape. Le règlement éventuel du devis s'effectue ensuite sur la page sécurisée de notre prestataire de paiement Stripe : ELEV8 n'a jamais accès à votre numéro de carte. Ce bouton transmet vos informations par e-mail à ELEV8 Private Driver, via notre prestataire d'envoi, et les enregistre de façon sécurisée (accès réservé à ELEV8), uniquement pour traiter votre demande ; elles sont conservées au plus 12 mois si la demande reste sans suite. Vous pouvez y accéder ou demander leur suppression : <a href=\"/confidentialite.html\">politique de confidentialité</a>.",
    noteWhatsApp: "WhatsApp s'ouvre avec votre message prérempli. Il ne part qu'après avoir appuyé sur « Envoyer » dans l'application, et l'échange est alors traité par WhatsApp (groupe Meta) selon ses propres conditions.",
    indicatifParDefaut: "+33"
  },

  /* ---------- Page dédiée /reservation (liens des publicités Google Ads, Facebook Ads…) ----------
     Même formulaire et même estimation que la rubrique Réservation de l'accueil.
     Lien conseillé dans les publicités : https://elev8privatedriver.com/reservation?src=google-ads
     (ou ?src=facebook, ?src=instagram) : l'origine apparaît dans l'e-mail de chaque demande. */
  pageReservation: {
    surtitre: "Réservation · Chauffeur privé",
    titre: "Votre trajet,<br><em>estimé en un instant.</em>",       // <br> = retour à la ligne
    texte: "Estimez votre trajet en quelques instants et envoyez votre demande sans engagement. Devis par e-mail, paiement en ligne sécurisé, puis confirmation de votre chauffeur par ELEV8.",
    proTexte: "Vous êtes un professionnel ?",             // hôtels, entreprises, restaurants, conciergeries
    proLien: "Contactez ELEV8 directement",
    proMessageWhatsApp: "Bonjour ELEV8, je vous contacte pour des trajets professionnels (hôtel, entreprise, restaurant ou conciergerie).",
    etape1: "Estimation immédiate", etape1Texte: "selon notre grille tarifaire",
    etape2: "Devis et paiement sécurisé", etape2Texte: "règlement en ligne par carte (Stripe)",
    etape3: "Confirmation du chauffeur", etape3Texte: "remboursement intégral si aucun n'est disponible",
    aideTitre: "Une question avant de réserver ?",
    retour: "Découvrir le site ELEV8"
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

  /* ---------- Suggestions d'adresses (champs « Départ » et « Destination ») ----------
     Une liste de suggestions s'affiche pendant la saisie (adresses, gares, aéroports, hôtels…).
     Le client peut toujours écrire son adresse librement.
     Le service utilisé se règle dans Netlify, jamais ici (voir GUIDE-ADRESSES.md) :
     Google Places si la variable GOOGLE_MAPS_API_KEY existe, sinon un service gratuit. */
  adresses: {
    actif: true,             // false = désactive les suggestions
    endpoint: "/adresses",   // fonction Netlify (netlify/functions/adresses.mjs)
    minCaracteres: 3         // nombre de lettres avant d'afficher des suggestions
  },

  /* ---------- Suivi des sources de demande ----------
     Aucun cookie ni traceur pour ce suivi des sources : rien d'enregistré dans le navigateur.
     (La mesure Google Ads, plus bas, est distincte et soumise au consentement du visiteur.)
     Le paramètre ?src=... du lien visité est simplement joint à la demande envoyée par le client.
     Associez ici chaque code de lien à un libellé lisible (voir CAMPAGNES.md). */
  suivi: {
    sources: {
      "tesla": "QR code — Tesla Model Y",
      "classe-v": "QR code — Mercedes-Benz Classe V",
      "viano": "QR code — Mercedes-Benz Classe V",      // ancien code, conservé par sécurité
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
    libelleDirect: "Accès direct",

    /* Mesure des conversions Google Ads (assets/js/consentement.js).
       Tant que « id » est vide : aucun bandeau, aucune balise, aucun cookie (situation actuelle).
       Une fois renseigné : bandeau de consentement, puis balise Google chargée UNIQUEMENT si le visiteur accepte.
       id                : identifiant du compte, format « AW-123456789 » (Google Ads › Objectifs › Conversions › balise)
       conversionDemande : « libellé de conversion » de l'action « Demande de réservation » (partie après le « / »)
       conversionAppel / conversionWhatsApp : facultatifs (clics sur Appeler / WhatsApp), laisser vide sinon
       valeurParDefaut   : valeur en € d'une demande « sur devis » (sans estimation automatique) */
    googleAds: {
      id: "AW-18590283906",
      conversionDemande: "PLWDCNiOw70dEILxxKBF",
      conversionAppel: "",
      conversionWhatsApp: "",
      valeurParDefaut: 120,
      dureeConsentementJours: 182
    }
  },

  /* ---------- 8. Informations légales ----------
     À compléter impérativement avant la mise en ligne. */
  legal: {
    /* Informations officielles (transmises par ELEV8 le 18 nov. 2026) : mentions légales, devis et factures */
    raisonSociale: "Elev8 Private Driver",
    nomCommercial: "ELEV8 Private Driver",
    formeJuridique: "SASU",
    adresse: "17 rue Ferdinand Claudon, 21000 Dijon, France",
    siret: "131 595 068 00019",
    immatriculation: "131 595 068 R.C.S. Dijon",
    tva: "FR66131595068",
    capital: "1 000 €",  // OBLIGATOIRE pour une SASU sur les factures et devis : à compléter
    regimeTVA: "assujetti",                  // n° de TVA intracommunautaire fourni : TVA facturée
    tauxTVA: 10,                             // transport de personnes (VTC) : 10 %. Les prix du site sont des prix TTC.
    modesPaiement: "carte bancaire ou virement bancaire",
    facturation: "site",                     // "site" : factures F-AAAA-0001… établies sur /documents ;
                                             // "indy" : factures établies dans Indy (le site ne fait plus que les devis).
                                             // Une course = une seule facture, jamais dans les deux outils.
    penalitesRetard: "",                     // vide = « trois fois le taux d'intérêt légal »
    registreVTC: "",                         // N° EVTC : la ligne apparaît dans les mentions légales et les CGV dès qu'il est renseigné
    directeurPublication: "Enzo Mimouni",
    hebergeur: "Netlify, Inc. — 101 2nd Street, San Francisco, CA 94105, États-Unis",
    prestataireEnvoi: "Brevo (Sendinblue SAS) — 9-17 rue Salneuve, 75017 Paris, France",
    dureeDemandes: "12 mois après la date du trajet demandé, lorsque la demande n'a pas donné lieu à une prestation",
    dureeClients: "3 ans après la dernière prestation, pièces comptables conservées 10 ans",
    dureeEmpreintes: "24 heures, suppression automatique au plus tard une heure après",
    messagerie: "Microsoft 365 (Outlook)",
    cgv: "/cgv.html",                        // Adresse des conditions générales de vente.
                                             // Vide = aucun lien. Renseignée : lien dans le pied de page, sous le formulaire
                                             // et sur la page de paiement Stripe (« En procédant au paiement, vous acceptez… »).
    mediateur: "ANM Conso, 25 allée Rose Dieng Kuntz, 75019 Paris — saisine en ligne : www.anm-conso.com/page-saisine.php",                           // Médiateur de la consommation (nom, adresse, site) : OBLIGATOIRE, à renseigner dès l'adhésion
    assurance: "",                           // Assureur RC professionnelle, n° de contrat, couverture géographique : à renseigner
    dateMiseAJour: "23 novembre 2026"
  }
};
