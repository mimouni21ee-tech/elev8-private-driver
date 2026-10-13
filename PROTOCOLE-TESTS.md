# Protocole de test — ELEV8 Private Driver

À dérouler **après la connexion de Brevo**, avant d'imprimer les QR codes et de lancer une campagne.
Durée : environ 2 h la première fois, puis 10 minutes pour la recette rapide (§ 10) après chaque modification.

Notez chaque résultat dans la fiche du § 11 : **OK**, **KO** (avec capture d'écran) ou **N/A**.

---

## 0. Préparation

**Matériel**

| Appareil | Navigateur | Remarque |
|---|---|---|
| iPhone récent | Safari | WhatsApp installé |
| iPhone (même ou autre) | Chrome | |
| Petit écran (iPhone SE ou équivalent) | Safari | Contrôle des débordements |
| Android | Chrome | WhatsApp installé |
| Android Samsung | Samsung Internet | Navigateur par défaut de nombreux clients |
| Ordinateur | Chrome ou Firefox | Contrôles techniques et WhatsApp Web |

**Comptes et accès** : Netlify (journaux), Brevo (journaux d'envoi), la boîte qui reçoit les demandes,
une seconde adresse e-mail personnelle (Gmail **et** Outlook/Hotmail si possible) pour jouer le client.

**Jeu de données de test** (préfixez le nom par `TEST` pour retrouver et supprimer ces demandes) :

| Cas | Nom / Prénom | Téléphone | E-mail | Trajet |
|---|---|---|---|---|
| A | TEST Dupont / Élodie | FR — `06 12 34 56 78` | votre Gmail | Aéroport de Genève → Megève, vol `LX1234`, 3 passagers, Viano |
| B | TEST Müller / Jean-François | CH — `079 123 45 67` | *(vide)* | Gare de Dijon → Beaune, train `TGV 6501`, Tesla |
| C | TEST O'Brien / Zoé | `+377 6 12 34 56 78` (saisi avec +) | votre Outlook | Nice → Cannes, Événements privés, précisions avec accents et retour à la ligne |

Utilisez votre propre numéro mobile à la place des exemples quand un rappel réel est testé.

---

## 1. Vérifications de configuration

| ID | Action | Résultat attendu |
|---|---|---|
| C1 | Netlify → Deploys → dernier déploiement → journal | « Published ». Section *post-processing* : la fonction `reservation` et sa règle de limitation (rate limit) sont listées, ainsi que la fonction planifiée `rl-cleanup` |
| C2 | Netlify → Site configuration → Environment variables | `EMAIL_PROVIDER`, `EMAIL_API_KEY`, `MAIL_TO`, `MAIL_FROM` présentes ; si Turnstile actif : `TURNSTILE_SECRET_KEY` |
| C3 | Ouvrir `http://elevateprivatedriver.com` (sans « s ») | Redirection automatique vers `https://` ; cadenas valide |
| C4 | Ouvrir `https://www.elevateprivatedriver.com` | Redirige vers le domaine principal (ou affiche le site) en HTTPS |
| C5 | Ordinateur : ouvrir le site, outils de développement (F12) → Console | Aucune erreur rouge (en particulier aucune erreur « Content Security Policy ») |
| C6 | Ouvrir `https://elevateprivatedriver.com/config.js` | Le fichier s'affiche : vérifier qu'**aucune clé secrète** n'y figure (seule la clé publique Turnstile est admise) |
| C7 | Ouvrir `https://elevateprivatedriver.com/api/reservation.php` (version Netlify) | Page « introuvable » (le code PHP n'est pas servi sur Netlify) |
| C8 | Brevo → Expéditeurs, domaines | Domaine « Authentifié », expéditeur `MAIL_FROM` vérifié |

---

## 2. Réception réelle des e-mails

| ID | Action | Résultat attendu |
|---|---|---|
| E1 | Cas A, « Envoyer ma demande » | Bouton « Envoi en cours » puis panneau **« Demande transmise »** avec une référence `E8-AAMMJJ-XXX` et le téléphone `+33 6 12 34 56 78` |
| E2 | Boîte de réception (moins d'une minute) | E-mail reçu, objet `Demande de réservation E8-… — JJ/MM/AAAA HHhMM — Élodie TEST Dupont` ; **même référence** qu'à l'écran |
| E3 | Contenu de l'e-mail A | Tous les champs présents et exacts : prestation, **N° de vol LX1234**, date en toutes lettres, heure, départ, destination, 3 passagers, Viano, nom complet, **téléphone**, e-mail, origine |
| E4 | Boutons de l'e-mail sur smartphone | « Appeler » ouvre le composeur avec le bon numéro ; « WhatsApp » ouvre une conversation avec le client |
| E5 | « Répondre » dans la messagerie | Le destinataire proposé est l'e-mail du **client** (Reply-To) |
| E6 | Cas B (sans e-mail, numéro suisse) | E-mail reçu ; téléphone `+41791234567` ; « E-mail : Non renseigné » ; « N° de train TGV 6501 » |
| E7 | Cas C (accents, apostrophe, retour à la ligne) | Accents et apostrophes intacts dans l'objet et le corps ; précisions sur plusieurs lignes |
| E8 | Délivrabilité : dans Gmail, ⋮ → « Afficher l'original » | `SPF: PASS`, `DKIM: PASS`, `DMARC: PASS` |
| E9 | Dossier spam de la boîte de réception (et Outlook si utilisé) | E-mails **pas** en spam. Sinon : les marquer « non indésirable » et revérifier E8 |
| E10 | Brevo → Transactionnel → Journaux | Chaque envoi apparaît « Délivré » |
| E11 | Netlify → Logs → Functions → `reservation` | Aucune donnée client (nom, téléphone, adresse) n'apparaît dans les journaux |

---

## 3. Erreurs d'envoi (aucune fausse confirmation)

Règle à vérifier à chaque ligne : **le panneau « Demande transmise » ne doit jamais apparaître**, le
message d'erreur propose WhatsApp et le téléphone, et les champs restent remplis.

| ID | Provocation | Résultat attendu | Remise en état |
|---|---|---|---|
| X1 | Netlify : remplacer `EMAIL_API_KEY` par `fausse-cle`, redéployer, envoyer le cas A | « Votre demande n'a pas pu être transmise. » ; aucun e-mail reçu ; journal : `provider:401` | Remettre la vraie clé, redéployer |
| X2 | Remplacer `MAIL_FROM` par une adresse non vérifiée (ex. `test@gmail.com`), redéployer | Message d'erreur ; journal : `provider:400` ; aucun e-mail | Restaurer, redéployer |
| X3 | Supprimer la variable `MAIL_TO`, redéployer | Message d'erreur ; journal : `config` | Restaurer, redéployer |
| X4 | Smartphone : remplir le formulaire, activer le **mode avion**, envoyer | « …connexion interrompue ou service indisponible » ; données conservées | Désactiver le mode avion, renvoyer → succès (E1) |
| X5 | Ordinateur : F12 → Réseau → « Slow 3G », envoyer | Bouton désactivé pendant l'envoi ; succès ou erreur claire en moins de 15 s, jamais d'attente infinie | Remettre « No throttling » |
| X6 | Appuyer 3 fois très vite sur « Envoyer ma demande » | **Un seul** e-mail reçu | — |
| X7 | Après X1–X3 restaurés | Refaire E1 : succès | — |

---

## 4. Anti-spam et limitation des envois

| ID | Action | Résultat attendu |
|---|---|---|
| S1 | Ouvrir la page et envoyer en moins de 3 secondes (remplissage automatique du navigateur) | Refus, message d'erreur, aucun e-mail |
| S2 | Ordinateur, F12 → Console : `document.getElementById('f-website').value='x'`, puis envoyer | Refus, aucun e-mail |
| S3 | Même téléphone : envoyer 6 demandes valides en moins de 10 min | Les 5 premières reçues ; la 6ᵉ : « Trop de demandes envoyées » |
| S4 | Depuis un **autre** réseau (4G au lieu du Wi-Fi), envoyer | Accepté (la limite est propre à chaque visiteur) |
| S5 | Plafond global : `RATE_GLOBAL_PER_HOUR=2`, redéployer, envoyer 3 demandes depuis 2 appareils | 3ᵉ demande : « Le service d'envoi est momentanément saturé » | 
| S6 | Retirer `RATE_GLOBAL_PER_HOUR`, redéployer | Retour au plafond de 30 / heure |
| S7 | Le lendemain : Netlify → Logs → Functions → `rl-cleanup` | Une exécution par heure, « Nettoyage limitation : N compteur(s) expiré(s) supprimé(s) » |

### Turnstile (si activé)

| ID | Configuration | Résultat attendu |
|---|---|---|
| T1 | Clés de test « toujours accepté » (README § 4), redéployer, envoyer | Succès, e-mail reçu |
| T2 | Clés de test « toujours refusé » | Message « La vérification anti-robot… » ; aucun e-mail |
| T3 | Clé publique renseignée **sans** clé secrète | Envoi accepté mais journal : `Turnstile : jeton reçu mais TURNSTILE_SECRET_KEY absente` → configuration incomplète à corriger |
| T4 | Vraies clés, envoi normal sur iPhone et Android | Succès ; dans la plupart des cas aucune case visible ; si une case apparaît, elle s'intègre au formulaire sombre |
| T5 | Vraies clés, deux envois successifs sans recharger la page | Les deux réussissent (un nouveau jeton est demandé automatiquement) |
| T6 | Navigateur avec bloqueur de contenu strict (ou Firefox « Protection stricte ») | Si Turnstile est bloqué : message expliquant le blocage et proposant WhatsApp / téléphone |
| T7 | Page confidentialité, Turnstile actif puis inactif | Paragraphes Cloudflare visibles uniquement quand la clé publique est renseignée |
| T8 | Après les tests | **Vraies clés** en place, clés de test retirées |

---

## 5. Réservation via WhatsApp

| ID | Action | Résultat attendu |
|---|---|---|
| W1 | iPhone, cas A, « Contacter via WhatsApp » | Récapitulatif complet avec **téléphone** ; mention WhatsApp (Meta) sous le bouton |
| W2 | « Ouvrir WhatsApp » | L'application s'ouvre sur **votre** numéro professionnel, message prérempli, **pas encore envoyé** |
| W3 | Lire le message avant envoi | Une ligne par information, accents corrects, téléphone au format `+33 6 12 34 56 78`, N° de vol, ligne « Origine » si le site a été ouvert par un lien de suivi |
| W4 | Envoyer, vérifier sur le téléphone professionnel (WhatsApp ou WhatsApp Business) | Message reçu identique |
| W5 | Android, cas B | Mêmes vérifications W1–W4 |
| W6 | Ordinateur sans WhatsApp installé | Ouverture de WhatsApp Web / page d'accueil WhatsApp avec le message |
| W7 | Récapitulatif → « Modifier la demande » | Retour au formulaire, champs conservés |
| W8 | Récapitulatif → « Copier le message » | « Message copié » ; le collage dans SMS ou e-mail donne le texte complet |
| W9 | Formulaire incomplet → « Contacter via WhatsApp » | WhatsApp ne s'ouvre pas ; champs manquants signalés |

---

## 6. Formulaire

| ID | Action | Résultat attendu |
|---|---|---|
| F1 | « Envoyer ma demande » sans rien remplir | 7 champs signalés : date, heure, départ, destination, nom, prénom, téléphone ; le curseur va sur le premier |
| F2 | Date d'hier | Refusée (« à partir d'aujourd'hui ») |
| F3 | Prestation « Transferts aéroports » / « gares » / « stations de ski » / « Déplacements professionnels » | Champ « N° de vol » / « N° de train » / « N° de vol ou de train » / **absent** |
| F4 | Saisir un n° de vol, puis passer à « Mise à disposition » et envoyer | Le n° de vol n'apparaît pas dans l'e-mail |
| F5 | Tesla Model Y sélectionnée | Passagers proposés : 1 à 4 ; Viano : 1 à 7 |
| F6 | Section Destinations → « Demander un trajet » (Genève) | Défilement vers le formulaire, prestation « Transferts stations de ski » présélectionnée |
| F7 | Section Flotte → « Choisir ce véhicule » (Viano) | Viano présélectionné |
| F8 | E-mail `jean@` | Refusé ; e-mail vide : accepté |
| F9 | « Faire une nouvelle demande » après un succès | Formulaire vide, prêt |

**Téléphones** (indicatif choisi → saisie → attendu) :

| Indicatif | Saisie | Attendu |
|---|---|---|
| FR +33 | `06 12 34 56 78` | Accepté → `+33612345678` |
| FR +33 | `6.12.34.56.78` | Accepté |
| FR +33 | `0612` | Refusé |
| CH +41 | `079 123 45 67` | Accepté → `+41791234567` |
| CH +41 | `022 123 45 67` (fixe Genève) | Accepté |
| FR +33 | `+41 79 123 45 67` | Accepté → `+41…` (le + l'emporte sur l'indicatif choisi) |
| FR +33 | `0041 79 123 45 67` | Accepté → `+41…` |
| CH +41 | `06 12 34 56 78` (numéro français, mauvais indicatif) | Accepté comme `+41612345678` (format suisse valide) : c'est pourquoi le numéro est **réaffiché au client** dans la confirmation et le récapitulatif |
| MC +377 | `6 12 34 56 78` | Accepté |
| FR +33 | `abc` | Refusé |

---

## 7. QR codes et sources

| ID | Action | Résultat attendu |
|---|---|---|
| Q1 | Scanner le QR imprimé (`?bord=1&src=viano`) avec l'appareil photo, iPhone et Android | Le mode passager s'ouvre : logo E8 animé, « Merci de voyager avec ELEV8 Private Driver », et les trois boutons Réserver / WhatsApp / Appeler visibles sans défiler |
| Q1b | En mode passager : toucher une carte véhicule, puis « Découvrir le site complet » | La carte ouvre le formulaire avec ce véhicule présélectionné ; le lien affiche le site complet |
| Q1c | iPhone (Safari), mode passager : « Enregistrer mon chauffeur » | La fiche ELEV8 s'ouvre avec le logo E8, le nom, le numéro, le lien WhatsApp et le site ; rien n'est ajouté tant que « Créer un nouveau contact » n'est pas touché ; une aide s'affiche sous les boutons |
| Q1d | Android (Chrome), même bouton | La fiche `ELEV8-Private-Driver.vcf` est téléchargée ; l'aide indique de l'ouvrir depuis la notification ; l'ouverture propose Contacts (ou Google Contacts) et l'enregistrement demande confirmation |
| Q1e | Ouvrir le contact enregistré, toucher le lien du site, envoyer une demande | L'e-mail reçu indique « Origine : Fiche contact enregistrée » |
| Q1f | Samsung Internet et Firefox Android, même bouton | Fiche téléchargée ou ouverte selon le navigateur, enregistrement possible |
| Q2 | Envoyer une demande depuis cette page | E-mail : « Origine : QR code — Mercedes-Benz Viano » |
| Q3 | Même test en WhatsApp | Dernière ligne du message : « (Origine : QR code — Mercedes-Benz Viano) » |
| Q4 | Lien `?utm_source=google-ads&utm_medium=cpc&utm_campaign=geneve-ski` | E-mail : origine « Google Ads — campagne geneve-ski » et ligne UTM |
| Q5 | Site ouvert sans paramètre | E-mail : « Origine : Accès direct » |
| Q6 | Scan en conditions réelles : QR fixé au dossier, éclairage de nuit, distance d'un passager | Lecture en moins de 3 secondes sur les deux téléphones |

---

## 8. Smartphones et affichage

À faire sur **chaque appareil** du § 0.

| ID | Vérification | Résultat attendu |
|---|---|---|
| M1 | Accueil | Photo plein écran, slogan lisible, aucun texte coupé ; animation fluide |
| M2 | Défilement complet de la page | Aucun défilement horizontal, aucun élément qui déborde |
| M3 | Menu | S'ouvre, chaque lien mène à la bonne section, se ferme |
| M4 | Bouton flottant « Demander une réservation » | Absent sur l'accueil, apparaît ensuite, disparaît dans le formulaire |
| M5 | Champs date et heure | Sélecteurs natifs du téléphone, lisibles sur fond sombre |
| M6 | Champ téléphone / e-mail | Clavier numérique pour le téléphone, clavier avec « @ » pour l'e-mail |
| M7 | Saisie automatique (nom, téléphone, e-mail) | Le téléphone propose les coordonnées enregistrées et les place dans les bons champs |
| M8 | Clavier ouvert | Le champ en cours reste visible ; boutons d'envoi accessibles |
| M9 | Mode paysage | Mise en page correcte |
| M10 | Taille de texte agrandie (Réglages → Accessibilité) | Textes lisibles, pas de chevauchement |
| M11 | Réseau 4G faible (extérieur, parking souterrain) | Page affichée en moins de 4 s ; envoi réussi ou erreur claire |
| M12 | Pages Mentions légales et Confidentialité | Lisibles ; « Retour au site » fonctionne |
| M13 | Partage du lien dans WhatsApp / SMS | Aperçu avec le titre ELEV8 Private Driver |

---

## 9. Pages légales et contrôles externes

| ID | Vérification | Résultat attendu |
|---|---|---|
| L1 | Mentions légales et confidentialité | **Aucun texte entre crochets** `[…]` (ils apparaissent en couleur champagne tant qu'ils ne sont pas remplis) |
| L2 | N° d'inscription au registre VTC, SIRET, hébergeur, prestataire d'envoi, messagerie | Renseignés et exacts |
| L3 | Note sous les boutons du formulaire | Durée de conservation identique à celle de la politique |
| L4 | pagespeed.web.dev, onglet Mobile | Performance ≥ 85, Accessibilité ≥ 90 |
| L5 | securityheaders.com | Note A ou A+ |
| L6 | ssllabs.com/ssltest | Note A ou A+ |

---

## 10. Recette rapide (après chaque modification du site)

1. Ouvrir le site sur un smartphone : accueil et menu corrects (M1, M3).
2. Envoyer le cas A : confirmation à l'écran **et** e-mail reçu avec la même référence (E1, E2).
3. Préparer le cas B en WhatsApp : message correct, non envoyé automatiquement (W1–W3).
4. Console de l'ordinateur sans erreur (C5).

---

## 11. Fiche de résultats

| Date | Testeur | Appareil / navigateur | IDs testés | Résultat | Remarques / captures |
|---|---|---|---|---|---|
| | | | | | |
| | | | | | |
| | | | | | |

**Critères de mise en service** : tous les tests C, E, X, W, Q1–Q3 et L1–L2 sont OK sur au moins un
iPhone et un Android ; S1–S3 OK ; si Turnstile est activé, T1, T2, T4 et T8 OK.
Supprimez ensuite les e-mails et conversations de test (préfixe `TEST`).
