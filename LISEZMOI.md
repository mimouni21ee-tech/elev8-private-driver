# ELEV8 Private Driver — coordonnées professionnelles (correctif à valider)

*15 nov. 2026. Dépôt `mimouni21ee-tech/elev8-private-driver`, branche `main` (commit `f77ad8f` du 12 nov.). Rien n'a été envoyé sur GitHub ni déployé.*

## Contenu
- `fichiers/` : les **6 fichiers modifiés**, avec leurs chemins exacts dans le dépôt. Ils remplacent les fichiers du même nom.
- `coordonnees.patch` : la même modification au format Git (`git am coordonnees.patch`).
- `captures/` : accueil, rubrique Contact et pied de page, sur ordinateur et sur mobile (iPhone 13).
- `apercu-fiche-contact.vcf` : la fiche que télécharge le bouton « Enregistrer ELEV8 dans mes contacts » (générée par la fonction existante `contact.mjs`, ici sans le logo).

## Ce qui change
| Emplacement | Ajout |
|---|---|
| Accueil, sous les deux boutons | Téléphone cliquable · e-mail cliquable · « Enregistrer ELEV8 dans mes contacts » |
| Rubrique Contact (« Demander une réservation ») | Cartes **E-mail** et **Contacts**, en plus de WhatsApp et Appeler |
| Pied de page (Contact) | Ligne **WhatsApp** et bouton « Enregistrer ELEV8 dans mes contacts », en plus du téléphone et de l'e-mail |
| Menu | Lien « Contact » |
| Tous les boutons WhatsApp | Lien officiel `https://wa.me/message/MZT3HSC2R4HLG1` |
| Fiche contact (.vcf) | Téléphone +33 6 26 92 72 18, e-mail `contact@elev8privatedriver.com`, site, WhatsApp |
| Mentions légales, confidentialité | Nouvelles coordonnées, reprises automatiquement de `config.js` |

Coordonnées enregistrées dans `public/config.js` :
- téléphone `06 26 92 72 18` (lien `tel:+33626927218`) ;
- WhatsApp `33626927218` et lien officiel ;
- e-mail `contact@elev8privatedriver.com`.

## Domaine
Aucun domaine n'est modifié. Le site garde `https://elev8privatedriver.com`, qui figure dans `config.js`, les balises canoniques, `sitemap.xml` et `robots.txt`. L'adresse e-mail utilise le même domaine.

**À vérifier** : le README et `api/config.sample.php` mentionnent `elevateprivatedriver.com`, de même que l'expéditeur `reservations@elevateprivatedriver.com`. Si ce n'est pas le bon domaine, l'expéditeur des e-mails de réservation (variable Netlify `MAIL_FROM`) doit appartenir au domaine réellement authentifié chez Brevo.

## Non modifié
Formulaire et fonctions de réservation, tarifs, paiements, `elev8-preprod`, HUBERT.

## Déploiement (après votre validation)
Le site se publie automatiquement à chaque envoi sur GitHub.
1. Remplacez les 6 fichiers de `fichiers/` dans le dépôt, avec les mêmes chemins (ou appliquez le patch).
2. Netlify publie.
3. Vérifiez sur un téléphone :
   - le numéro et l'e-mail s'ouvrent dans l'application Téléphone et dans la messagerie ;
   - WhatsApp ouvre la conversation ELEV8 ;
   - la fiche contact s'enregistre.

Les paramètres de version (`?v=20261115a`) forcent les navigateurs à recharger les nouveaux fichiers.
