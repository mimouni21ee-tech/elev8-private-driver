# Données personnelles — inventaire et cohérence avec la politique de confidentialité

Ce document recense **ce que le site fait réellement** des données, d'après le code livré, et indique où
chaque traitement est annoncé au client. Il sert aussi de base à votre **registre des traitements**
(article 30 du RGPD), à compléter avec vos propres outils (messagerie, facturation, agenda).

À relire à chaque modification du site : tout nouveau service (statistiques, pixel publicitaire, chat,
carte intégrée…) doit être ajouté ici et dans `public/confidentialite.html` **avant** sa mise en ligne.

## 1. Inventaire des traitements

| # | Traitement | Données | Où elles vont | Durée | Base légale |
|---|---|---|---|---|---|
| 1 | Demande via « Envoyer ma demande » | Nom, prénom, téléphone, e-mail (facultatif), trajet, n° de vol/train (facultatif), précisions, origine du lien | Service d'envoi (Netlify ou PHP) → prestataire e-mail (Brevo) → votre messagerie | Aucune copie sur le site. E-mail : 12 mois sans suite, 3 ans après la dernière prestation (comptabilité 10 ans) | Mesures précontractuelles / contrat |
| 2 | Demande via WhatsApp | Les mêmes, rédigées par le site dans WhatsApp | Rien ne transite par le site ; le client envoie lui-même via WhatsApp (Meta) | Mêmes durées pour vos conversations | Mesures précontractuelles / contrat |
| 3 | Limitation des envois | Empreinte HMAC de l'adresse IP (jamais l'IP en clair), nombre de tentatives | Netlify Blobs (ou fichiers temporaires sur l'hébergement PHP) | 24 h, suppression par la fonction planifiée `rl-cleanup` au plus tard 1 h après | Intérêt légitime (sécurité) |
| 4 | Limitation Netlify en périphérie | Adresse IP | Netlify (hébergeur) | Selon Netlify | Intérêt légitime (sécurité) |
| 5 | Vérification anti-robot *(si activée)* | Signaux techniques du navigateur, adresse IP | Cloudflare Turnstile | Selon Cloudflare | Intérêt légitime (sécurité) |
| 6 | Affichage du site | Adresse IP, navigateur | Netlify (hébergement), Google Fonts (polices) | Selon chaque prestataire | Intérêt légitime |
| 7 | Origine de la visite | Code du lien (`?src=`, UTM, `?bord=1`) | Joint à la demande (traitements 1 et 2) ; **rien n'est stocké dans le navigateur** | Celle de la demande | Intérêt légitime (mesure des canaux) |
| 8 | Fiche contact (« Enregistrer mon chauffeur ») | Aucune donnée du client : la fiche contient uniquement les coordonnées d'ELEV8. Adresse IP traitée par Netlify pour la limitation des téléchargements | Netlify | Selon Netlify | Intérêt légitime (sécurité) |

Ce que le site **ne fait pas** : aucun cookie déposé par le site, aucun stockage local (`localStorage`,
`sessionStorage`), aucun outil de statistiques, aucun pixel publicitaire, aucune base de données clients,
aucune donnée de formulaire dans les journaux techniques.

## 2. Vérification de cohérence (corrections apportées)

| Point vérifié | Constat avant | Correction |
|---|---|---|
| Durée de conservation des adresses IP | La politique annonçait « quelques minutes » ; la nouvelle limitation partagée conserve une empreinte jusqu'à 24 h | Politique : empreinte chiffrée, 24 h + suppression automatique sous 1 h (`legal.dureeEmpreintes`) |
| Nature de la donnée IP | « adresse IP… puis effacée » | Précisé : jamais en clair, empreinte HMAC non réversible |
| Refus automatique d'une demande | Non mentionné | Ajouté : refus possible si limite dépassée ou robot détecté, avec alternative WhatsApp/téléphone |
| Champs obligatoires | Non expliqué | Ajouté dans la note du formulaire et dans la politique |
| Information au moment de l'envoi | Note très courte (« servent uniquement à traiter votre demande ») | Note complète : destinataire, prestataire d'envoi, finalité, durée, droits, lien vers la politique |
| WhatsApp | Le récapitulatif ne mentionnait pas Meta | Ajouté sous le bouton « Ouvrir WhatsApp » |
| Turnstile | Paragraphe affiché même désactivé, formulé « sans cookie » (non garanti) | Affiché **uniquement si** la clé est configurée ; formulation exacte (lecture d'informations techniques strictement nécessaire à la sécurité) |
| Hébergeur | Rôle limité à « hébergement » | Ajouté : traitement de l'IP de connexion et stockage des empreintes |
| Prestataire e-mail | Rien sur ses journaux | Ajouté : historique technique des envois selon sa politique |
| Messagerie du professionnel | Non mentionnée | Ajoutée comme destinataire (`legal.messagerie`) |
| Origine de la visite | Exact | Inchangé, précisé « rien n'est enregistré sur votre appareil » |

## 3. À compléter par vous avant la mise en ligne (`public/config.js`, bloc `legal`)

- `raisonSociale`, `adresse`, `siret`, `registreVTC`, `directeurPublication`
- `hebergeur` et `prestataireEnvoi` sont déjà renseignés (Netlify, Inc. ; Brevo — Sendinblue SAS)
- `messagerie` (le fournisseur de votre boîte e-mail professionnelle)
- Si vous changez `dureeDemandes`, mettez à jour la durée citée dans `reservation.noteConfidentialite`.

## 4. Bonnes pratiques côté messagerie

- Classez les e-mails de demande dans un dossier dédié et supprimez ceux sans suite après 12 mois.
- Activez la double authentification sur la boîte qui reçoit les demandes.
- Signez un accord de traitement des données (DPA) avec Brevo et vérifiez celui de Netlify (proposés dans leurs espaces clients).
