# Liens QR code et campagnes — suivi des sources de demande

Chaque lien ci-dessous ouvre le même site. Le paramètre ajouté à la fin de l'adresse indique d'où vient
le visiteur. Il est **joint automatiquement à la demande** (e-mail reçu : ligne « Origine », et fin du
message WhatsApp).

Aucun cookie, aucun pixel publicitaire, aucun stockage dans le navigateur : ce suivi ne nécessite pas
de bandeau de consentement.

## QR codes à bord (passagers)

| Usage | Lien |
|---|---|
| QR générique dans le véhicule | `https://elevateprivatedriver.com/?bord=1` |
| QR de la Tesla Model Y | `https://elevateprivatedriver.com/?bord=1&src=tesla` |
| QR du Mercedes-Benz Viano | `https://elevateprivatedriver.com/?bord=1&src=viano` |

`bord=1` affiche le message d'accueil des passagers (`messageABord` dans `config.js`).

## Supports et réseaux

| Support | Lien |
|---|---|
| Carte de visite | `https://elevateprivatedriver.com/?src=carte` |
| Flyer | `https://elevateprivatedriver.com/?src=flyer` |
| Fiche Google (site web) | `https://elevateprivatedriver.com/?src=google-maps` |
| Bio Instagram | `https://elevateprivatedriver.com/?src=instagram` |
| Page Facebook | `https://elevateprivatedriver.com/?src=facebook` |
| Profil LinkedIn | `https://elevateprivatedriver.com/?src=linkedin` |
| Partenaire hôtelier | `https://elevateprivatedriver.com/?src=partenaire-hotel` |

## Campagnes publicitaires (format UTM standard)

Les paramètres UTM sont reconnus par Google Ads, Meta et la plupart des outils. Ils sont joints tels quels
à la demande.

| Campagne | Lien |
|---|---|
| Google Ads — Genève / ski | `https://elevateprivatedriver.com/?utm_source=google-ads&utm_medium=cpc&utm_campaign=geneve-ski` |
| Google Ads — Côte d'Azur | `https://elevateprivatedriver.com/?utm_source=google-ads&utm_medium=cpc&utm_campaign=cote-azur` |
| Google Ads — Dijon | `https://elevateprivatedriver.com/?utm_source=google-ads&utm_medium=cpc&utm_campaign=dijon` |
| Instagram sponsorisé | `https://elevateprivatedriver.com/?utm_source=instagram&utm_medium=paid-social&utm_campaign=hiver-2026` |
| Facebook sponsorisé | `https://elevateprivatedriver.com/?utm_source=facebook&utm_medium=paid-social&utm_campaign=hiver-2026` |

Pour une campagne qui mène directement au formulaire, ajoutez `#reservation` à la fin du lien.

## Ajouter une source

1. Choisissez un code court en minuscules, sans espace ni accent (ex. `salon-mariage`).
2. Ajoutez-le dans `config.js`, rubrique `suivi.sources` : `"salon-mariage": "Salon du mariage",`
3. Utilisez le lien `https://elevateprivatedriver.com/?src=salon-mariage`.

Un code absent de la liste fonctionne aussi : il apparaît alors tel quel dans la demande.

## Si vous souhaitez un jour mesurer les conversions publicitaires

Les balises de conversion Google Ads, le pixel Meta ou Google Analytics déposent des traceurs : elles
ne doivent être activées qu'**après le consentement** du visiteur, via un outil de gestion du consentement
(bandeau conforme CNIL). Elles ne sont pas installées sur ce site. Il faudra alors aussi ajouter leurs
domaines dans l'en-tête `Content-Security-Policy` (`public/_headers` et `public/.htaccess`) et mettre à
jour la politique de confidentialité.

## Conseils d'impression des QR codes

- Encodez exactement le lien voulu (avec `?bord=1`), en noir sur fond clair.
- Taille minimale 3 × 3 cm pour un appui-tête, avec une marge blanche autour.
- Testez avec un iPhone et un Android avant l'impression définitive.
