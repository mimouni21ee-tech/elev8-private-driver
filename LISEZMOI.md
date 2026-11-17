# ELEV8 Private Driver — estimation et demande de réservation gratuite (à valider)

*17 nov. 2026 (grille mise à jour à 20 h 35). Dépôt `mimouni21ee-tech/elev8-private-driver`, branche `main` (commit `21099da` du 15 nov.). Rien n'a été envoyé sur GitHub ni déployé.*

## Nouveau parcours

1. Le client saisit son trajet.
2. L'estimation s'affiche aussitôt.
3. Il clique sur « Demander la réservation » : c'est gratuit et ne demande aucun compte.
4. ELEV8 reçoit l'e-mail. Vous validez ou ajustez le tarif.
5. Le client accepte le tarif.
6. Vous confirmez la réservation.

Aucun paiement ni acompte n'est demandé à aucun moment. Le site officiel n'a jamais eu de paiement : l'acompte de 25 % n'existait que dans la préproduction, et celle-ci n'est pas modifiée.

## Ce qui change pour le client

| Élément | Comportement |
|---|---|
| Estimation | Calculée dès que le départ, la destination, la date et l'heure sont renseignés. Le montant est en grand, avec la mention exacte demandée : « Tarif indicatif, sous réserve de validation… Aucun paiement n'est demandé à cette étape. » |
| Trajets autour de Dijon (15 km) | Montant estimé avec le moteur de calcul de la préproduction (inchangé, contrôlé par un test) et la grille ci-dessous. |
| Hors zone (Genève, stations, Côte d'Azur, longues distances) et mise à disposition | « Sur devis », aucun montant affiché. La demande reste gratuite et possible. |
| Aller-retour | Nouvelle case à cocher, qui fait apparaître la date et l'heure du retour. Chaque trajet est calculé séparément. |
| Bagages | Nouveau menu (facultatif). |
| Informations complémentaires | Champ visible, avec des exemples : remorque, bagages volumineux, arrêts, attente, siège enfant. Il est précisé au client qu'une demande particulière peut modifier le tarif. |
| Boutons | **« Demander la réservation »** (bouton principal), « Nous appeler », « WhatsApp ». Le message WhatsApp reprend le trajet et l'estimation. |
| Après l'envoi | « Votre demande a bien été envoyée ! », votre texte, la référence et le statut « Demande reçue · en attente de validation ». Jamais « réservation confirmée ». |
| Double clic ou coupure réseau | Une seule demande, une seule référence. |
| Mode passager (QR code `?bord=1`) | « Réserver un trajet » ouvre le même formulaire. Le parcours est donc identique depuis l'accueil, le QR code ou une publicité. |

## Grille appliquée (prix d'une course = le plus élevé entre le minimum et km × tarif)

| | Jour (lun.–sam., 7 h–19 h) | Majoré (nuit 19 h–7 h, dimanche, jours fériés) |
|---|---|---|
| **Tesla Model Y** | **1,90 €/km, minimum 20 €** *(nouveau)* | 2,75 €/km, minimum 15 € *(inchangé)* |
| **Mercedes Classe V** | 2,25 €/km, minimum 20 € *(inchangé)* | 3,25 €/km, minimum 25 € *(inchangé)* |

Exemples (8,3 km) : Tesla Model Y de jour **20 €** (8,3 × 1,90 = 15,77 € → minimum appliqué) ; de nuit 22,83 € ; Classe V de jour 20 €. Tesla Model Y de jour sur 15 km : 28,50 €.
La préproduction (`elev8-preprod`) garde l'ancienne grille : elle n'a pas été modifiée.

## Ce que vous recevez (adresse définie par `MAIL_TO`, voir « Configuration »)

Voir `apercu-email-recu-par-elev8.png`.
- **Objet :** `[À valider] Demande E8-… — date heure — client — montant`. Un tri par objet est donc possible.
- **Contenu :**
  - consigne « À FAIRE » ;
  - statut ;
  - date de réception ;
  - **estimation calculée par le serveur**, avec le détail par trajet ;
  - toutes les informations du trajet ;
  - informations complémentaires mises en évidence ;
  - coordonnées et origine (carte de visite, Google Ads…).
- **Boutons de réponse préremplis** (par WhatsApp, et par e-mail si le client a donné son adresse) : « Confirmer le tarif » et « Proposer un tarif ajusté ». Vous complétez le montant et la raison avant d'envoyer.

Suivi des statuts, sans nouvel outil : créez dans votre messagerie quatre dossiers ou libellés.
- Demande reçue
- Tarif ajusté proposé
- Réservation confirmée
- Refusée ou annulée

## Sécurité
- Le prix est calculé **uniquement par le serveur**. Un montant modifié dans le navigateur est ignoré et recalculé (test automatique).
- Le serveur vérifie toutes les données reçues : dates, retour après l'aller, téléphone, nombre de bagages.
- Aucune clé secrète ne se trouve dans les fichiers publics.
- Pour éviter les doublons, le serveur garde seulement un identifiant aléatoire pendant 24 h, sans aucune donnée client. La politique de confidentialité a été mise à jour en conséquence.

## Fichiers (15) — dossier `fichiers/`, mêmes chemins que dans le dépôt
Si vous avez **déjà déposé** la version précédente de ce ZIP, il suffit de remplacer 3 fichiers : `netlify/lib/grille/dijon-config.cjs`, `netlify/lib/estimation.mjs` et `tests/estimation.test.mjs`.

- Nouveaux :
  - `netlify/functions/estimation.mjs`
  - `netlify/lib/estimation.mjs`
  - `netlify/lib/grille/dijon-tarif.cjs`
  - `netlify/lib/grille/dijon-config.cjs`
  - `tests/estimation.test.mjs`
- Modifiés :
  - `netlify/functions/reservation.mjs`
  - `netlify/functions/rl-cleanup.mjs`
  - `netlify/lib/ratelimit.mjs`
  - `package.json`
  - `public/index.html`
  - `public/config.js`
  - `public/assets/js/main.js`
  - `public/assets/css/style.css`
  - `public/confidentialite.html`
  - `public/mentions-legales.html` (numéro de version seulement)

Non modifiés : suggestions d'adresses, fiche contact, mode passager, mentions légales, préproduction, HUBERT, Brevo.

## Déploiement (après votre validation)
1. Sur GitHub, à la racine du dépôt, ouvrez *Add file › Upload files*. Glissez les **dossiers** `netlify`, `public` et `tests`, ainsi que le **fichier** `package.json`, tous pris **dans** `fichiers/`. Ne glissez pas le dossier `fichiers` lui-même. Vérifiez que GitHub annonce **15 fichiers**, puis faites *Commit changes*.
2. Netlify publie le site automatiquement, en 1 à 2 minutes.
3. **Retour arrière si besoin :** Netlify › *Deploys*, choisissez le déploiement précédent, puis *Publish deploy*.

## Configuration Netlify (*Site configuration › Environment variables*)
- **Aucune nouvelle variable n'est obligatoire.** Brevo, l'expéditeur et le domaine ne changent pas.
- **`MAIL_TO`** : vérifiez qu'elle vaut `contact@elev8privatedriver.com`, l'adresse qui doit recevoir les demandes.
- **Facultatif, pour plus de précision :** si `GOOGLE_MAPS_API_KEY` existe déjà (suggestions Google), activez aussi l'API **« Routes API »** pour cette clé dans Google Cloud (*APIs et services › Bibliothèque*). Sans elle, le site utilise automatiquement le service gratuit de l'IGN.
  - Plafond Google : `ROUTES_GOOGLE_MAX_JOUR` (800 par jour par défaut).
  - Pour ne jamais utiliser Google : `ESTIMATION_ITINERAIRE` = `gratuit`.

## Tests à faire après la mise en ligne (10 minutes, sur votre téléphone)
1. **Gare de Dijon → une adresse à Dijon**, demain à 10 h, Model Y : au moins 20 € s'affichent (1,90 €/km au-delà d'environ 10,5 km). Passez sur Classe V : le montant suit la grille Classe V.
2. **Même trajet à 20 h :** le tarif majoré s'applique.
3. **Dijon → Aéroport de Genève :** « Sur devis ».
4. **Envoi :** remplissez vos coordonnées, une information complémentaire, puis touchez deux fois « Demander la réservation ». Vous devez voir « Votre demande a bien été envoyée ! » avec une référence, et recevoir **un seul e-mail** complet.
5. Dans l'e-mail, touchez « Confirmer le tarif par WhatsApp » : le message prérempli s'ouvre.
6. Testez « Nous appeler » et « WhatsApp » dans le formulaire.
7. Scannez le QR code de la carte de visite, puis touchez « Réserver un trajet » : le même formulaire s'ouvre.

## Nettoyage GitHub (indépendant de ce correctif)
Le dépôt du 15 nov. a aussi placé le contenu du ZIP précédent à la racine du dépôt. Ces fichiers ne sont pas publiés, car Netlify ne publie que `public/`, mais il vaut mieux les supprimer : ouvrez chaque fichier, puis *… › Delete file › Commit*.
- À la racine :
  - `LISEZMOI.md`
  - `apercu-fiche-contact.vcf`
  - `coordonnees.patch`
  - `index.html`
  - `config.js`
  - `confidentialite.html`
  - `mentions-legales.html`
- Dans `assets/` : `assets/css/style.css` et `assets/js/main.js`. ⚠ Ne touchez pas au dossier **`public/assets/`**.
- Le dossier `captures/` : 6 images.
- Le dossier `fichiers/` : 6 fichiers.

## Limites connues
- **Grille.** Le site officiel et la préproduction n'ont plus la même grille pour la Tesla Model Y de jour. La zone de 15 km autour de Dijon est encore notée « à valider ».
- **Minimum de nuit.** En Tesla Model Y, le minimum de nuit (15 €) est désormais inférieur au minimum de jour (20 €). Un très court trajet de nuit coûte donc moins cher que de jour. C'est conforme à votre demande de ne pas toucher aux majorations.
- **E-mail au client.** Le client ne reçoit pas d'e-mail automatique : il n'y en avait pas avant. Il voit sa référence à l'écran, puis vous lui répondez avec les messages préremplis.
- **Version PHP.** `public/api/reservation.php`, la version de secours pour un hébergement PHP, n'est pas utilisée sur Netlify. Elle n'a pas été adaptée.
- **Adresses saisies librement.** Avec le service gratuit, une adresse tapée sans choisir de suggestion est localisée de façon approximative. L'estimation reste indicative, et la distance figure dans l'e-mail pour que vous puissiez la contrôler.
