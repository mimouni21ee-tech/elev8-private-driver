# Mise en ligne d'ELEV8 Private Driver — guide pas à pas

Site : **https://elevateprivatedriver.com**

Ce guide est fait pour être suivi **une étape à la fois**. À la fin de chaque étape, une case
« Validation » indique comment savoir que tout s'est bien passé. Ne passez à l'étape suivante
qu'une fois la validation réussie.

Les noms de boutons des sites (GitHub, Netlify, Brevo, GoDaddy, Cloudflare) peuvent changer
légèrement avec le temps. Si un bouton ne correspond pas exactement, cherchez le libellé le plus
proche, ou faites une capture d'écran.

| Étape | Durée | Coût |
|---|---|---|
| 1. Créer le compte GitHub | 10 min | Gratuit |
| 2. Importer les fichiers du site | 15 min | Gratuit |
| 3. Créer le compte Netlify | 5 min | Gratuit |
| 4. Connecter GitHub à Netlify | 10 min | Gratuit |
| 5. Relier le domaine GoDaddy | 20 min + attente (jusqu'à 24 h) | Inclus dans le domaine |
| 6. Configurer Brevo et les réservations | 30 min + attente DNS | Gratuit |
| 7. Activer les protections | 20 min | Gratuit |
| 8. Faire une vraie réservation de test | 30 min | Gratuit |
| 9. Vérifier le site sur téléphone | 30 min | Gratuit |
| 10. Finaliser les QR codes | 15 min | Impression |

**Règle d'or de sécurité** : les clés secrètes (Brevo, Cloudflare) ne se collent **que** dans Netlify,
jamais dans un fichier du site, jamais dans GitHub, jamais par e-mail ou message.

---

## Étape 1 — Créer le compte GitHub

GitHub conserve le code de votre site, comme un coffre-fort avec historique.

1. Allez sur **github.com** et cliquez sur **Sign up**.
2. Saisissez une adresse e-mail que vous consultez, un mot de passe solide, puis un nom d'utilisateur
   (exemple : `elev8-private-driver`).
3. Résolvez la vérification puis saisissez le code reçu par e-mail.
4. Si GitHub propose un abonnement payant, choisissez l'offre **Free**.
5. Si GitHub vous demande d'activer la **double authentification**, acceptez : installez une
   application comme Google Authenticator ou Microsoft Authenticator et suivez les instructions.
   Conservez précieusement les **codes de récupération** qu'il affiche.

**Validation** : vous êtes connecté à GitHub et voyez votre nom d'utilisateur en haut à droite.

---

## Étape 2 — Importer les fichiers du site

**Avant d'importer**, vérifiez que `public/config.js` contient vos vraies informations (téléphone,
WhatsApp, e-mail, informations légales). Chaque modification ultérieure entraîne une nouvelle
publication, qui consomme des crédits Netlify : il est plus économique de tout préparer avant.

1. Sur GitHub, cliquez sur **+** (en haut à droite) → **New repository**.
2. **Repository name** : `elev8-private-driver`.
3. Cochez **Private** (le code ne sera visible que par vous).
4. Ne cochez **rien** d'autre (pas de README, pas de .gitignore, pas de licence).
5. Cliquez sur **Create repository**.
6. Sur la page qui s'affiche, cliquez sur le lien **uploading an existing file**.
7. Sur votre ordinateur, décompressez `elev8-private-driver.zip`, puis ouvrez le dossier `elev8`.
8. Affichez les fichiers cachés (ils commencent par un point, comme `.gitignore`) :
   - Mac : dans le Finder, appuyez sur **Cmd + Maj + .**
   - Windows : Explorateur → **Affichage** → cochez **Éléments masqués**
9. Sélectionnez **tout le contenu** du dossier `elev8` (Cmd+A ou Ctrl+A), **pas** le dossier lui-même,
   et faites-le glisser dans la zone de dépôt de GitHub. Utilisez Chrome, Edge ou Firefox.
10. Attendez que tous les fichiers soient chargés. En bas, dans **Commit changes**, écrivez
    `Version initiale du site` puis cliquez sur **Commit changes**.

**Validation** : à la racine du dépôt, vous voyez directement les dossiers `public` et `netlify`, et
les fichiers `netlify.toml`, `package.json`, `README.md`. Si vous voyez un seul dossier `elev8`,
le contenu a été glissé au mauvais niveau : supprimez le dépôt et recommencez l'étape 9.

---

## Étape 3 — Créer le compte Netlify

Netlify publie votre site sur Internet et exécute l'envoi des réservations.

1. Allez sur **netlify.com** → **Sign up**.
2. Choisissez **Sign up with GitHub** : vos deux comptes seront reliés automatiquement.
3. Autorisez Netlify à accéder à votre compte GitHub.
4. Répondez aux questions d'accueil (usage personnel/professionnel), puis choisissez l'offre **Free**.

**Validation** : vous êtes sur le tableau de bord Netlify.

### À savoir sur l'offre gratuite

Vous disposez de 300 crédits par mois. Chaque **publication** d'une nouvelle version coûte 15 crédits,
et chaque gigaoctet de visites coûte 20 crédits (environ 1 000 visites). C'est suffisant pour démarrer.
Si les crédits sont épuisés, Netlify **met le site en pause** jusqu'au mois suivant, après vous avoir
alerté par e-mail à 50 %, 75 % et 100 %. Si cela arrive, l'offre Personal (9 $/mois, 1 000 crédits)
relance le site immédiatement.

---

## Étape 4 — Connecter GitHub à Netlify

1. Dans Netlify : **Add new project** (ou **Add new site**) → **Import an existing project**.
2. Choisissez **GitHub**. Si Netlify demande une autorisation supplémentaire, choisissez
   **Only select repositories** → `elev8-private-driver` → **Install** / **Save**.
3. Sélectionnez le dépôt `elev8-private-driver`.
4. Netlify lit automatiquement les réglages du projet. Vérifiez seulement :
   - **Branch to deploy** : `main`
   - **Publish directory** : `public`
   - **Functions directory** : `netlify/functions`
   - **Build command** : laissez vide
5. **Project name** : `elev8-private-driver` (si ce nom est pris, Netlify en propose un autre ; notez-le).
6. Cliquez sur **Deploy**.

Le déploiement prend une à deux minutes.

**Validation** :
- Le statut affiche **Published**.
- L'adresse `https://elev8-private-driver.netlify.app` (ou celle notée au point 5) ouvre votre site.
- Dans **Deploys** → le dernier déploiement → journal, les fonctions `reservation` et `rl-cleanup`
  apparaissent.
- Sur le site, « Envoyer ma demande » affiche pour l'instant **un message d'erreur** : c'est normal,
  Brevo n'est pas encore configuré. Le bouton WhatsApp fonctionne déjà.

À partir de maintenant, **toute modification enregistrée sur GitHub est publiée automatiquement**.

---

## Étape 5 — Relier le domaine GoDaddy à Netlify

On garde la gestion du domaine chez GoDaddy et on lui indique simplement où se trouve le site.

**Dans Netlify**

1. Ouvrez le projet → **Domain management** → **Add a domain**.
2. Saisissez `elevateprivatedriver.com` → **Verify** → **Add domain**.
3. Si Netlify propose « Netlify DNS », choisissez de **configurer le DNS ailleurs** (« external DNS »).
4. Netlify ajoute aussi `www.elevateprivatedriver.com`. Vérifiez que `elevateprivatedriver.com`
   est marqué **Primary domain** (sinon : menu **Options** → **Set as primary domain**).

**Dans GoDaddy**

1. Connectez-vous → **Mes produits** → à côté de `elevateprivatedriver.com`, cliquez sur **DNS**.
2. Si un **transfert de domaine** (« Forwarding ») est activé, supprimez-le.
3. Enregistrement **A** dont le nom est **@** : cliquez sur le crayon, remplacez la valeur
   (souvent « Parked ») par `75.2.60.5`, puis enregistrez. S'il existe d'autres enregistrements
   **A** avec le nom **@**, supprimez-les.
4. Enregistrement **CNAME** dont le nom est **www** : remplacez la valeur par l'adresse Netlify de votre
   site, par exemple `elev8-private-driver.netlify.app` (sans `https://`). S'il n'existe pas, ajoutez-le.
5. Ne touchez **à aucun autre enregistrement**, en particulier les lignes **MX** si vous avez une
   messagerie liée au domaine.

**Attente** : la prise en compte prend en général moins d'une heure, parfois jusqu'à 24 heures.
Netlify crée ensuite automatiquement le certificat de sécurité HTTPS (cadenas). Si, après quelques
heures, **Domain management** → **HTTPS** indique toujours une attente, cliquez sur
**Verify DNS configuration**.

**Validation** :
- `https://elevateprivatedriver.com` affiche le site avec un cadenas.
- `http://elevateprivatedriver.com` et `https://www.elevateprivatedriver.com` redirigent vers
  `https://elevateprivatedriver.com`.

---

## Étape 6 — Configurer Brevo et la réception des réservations

Brevo envoie les demandes de réservation dans votre boîte e-mail.

**Préparez** :
- l'adresse qui doit **recevoir** les réservations (votre messagerie habituelle convient) ;
- l'adresse d'**expédition** : `reservations@elevateprivatedriver.com`.

### 6.1 Créer le compte et authentifier le domaine

1. Allez sur **brevo.com** → **S'inscrire gratuitement**, puis choisissez l'offre gratuite.
2. Roue dentée (Paramètres) → **Expéditeurs, domaines et IP dédiées** → **Domaines** →
   **Ajouter un domaine** → `elevateprivatedriver.com`.
3. Si Brevo propose une **authentification automatique avec GoDaddy**, acceptez-la et connectez-vous
   à GoDaddy quand il le demande. Sinon, choisissez l'authentification manuelle : Brevo affiche
   plusieurs enregistrements (code Brevo, DKIM, DMARC) à recopier dans GoDaddy → **DNS** → **Ajouter**.
   Dans le champ **Nom** de GoDaddy, n'écrivez **que** la première partie (par exemple
   `brevo1._domainkey`) : GoDaddy ajoute lui-même `.elevateprivatedriver.com`.
4. Revenez dans Brevo et cliquez sur **Authentifier ce domaine**. Si la vérification échoue, réessayez
   une heure plus tard.

### 6.2 Créer l'expéditeur

Brevo → **Expéditeurs** → **Ajouter un expéditeur** : nom `ELEV8 Private Driver`, adresse
`reservations@elevateprivatedriver.com`. Si Brevo demande de confirmer cette adresse par un code
et que vous n'avez pas de boîte à ce nom, dites-le-moi : nous choisirons ensemble une solution.

### 6.3 Créer la clé API

1. Brevo → **SMTP & API** → onglet **Clés API** → **Générer une nouvelle clé API**.
2. Nom : `Netlify ELEV8`. Copiez la clé (elle commence par `xkeysib-`). Elle ne s'affiche qu'une fois.
3. Si Brevo active le blocage des **adresses IP non autorisées** (menu Sécurité), désactivez-le pour
   les clés API : les serveurs de Netlify n'ont pas d'adresse fixe.

### 6.4 Donner les réglages à Netlify (et seulement à Netlify)

Netlify → votre projet → **Project configuration** (ou **Site configuration**) →
**Environment variables** → **Add a variable** → **Add a single variable**. Créez ces variables une par une :

| Clé (à recopier exactement) | Valeur |
|---|---|
| `EMAIL_PROVIDER` | `brevo` |
| `EMAIL_API_KEY` | la clé Brevo copiée (cochez « Contains secret values » si proposé) |
| `MAIL_TO` | l'adresse qui reçoit les réservations |
| `MAIL_FROM` | `reservations@elevateprivatedriver.com` |
| `MAIL_FROM_NAME` | `ELEV8 Private Driver` |
| `ALLOWED_ORIGINS` | `https://elevateprivatedriver.com,https://www.elevateprivatedriver.com` |
| `RATE_LIMIT_SECRET` | une longue phrase inventée, gardée pour vous (au moins 30 caractères) |

Puis **Deploys** → **Trigger deploy** → **Deploy project** pour que Netlify prenne en compte ces réglages.

**Validation** : sur `https://elevateprivatedriver.com`, envoyez une demande avec votre propre numéro.
Le message « Demande transmise » s'affiche avec une référence `E8-…`, et l'e-mail arrive dans votre
boîte. Vérifiez aussi le dossier spam.

---

## Étape 7 — Activer les protections de sécurité

Déjà actives sans rien faire : validation du formulaire, limitation des envois (Netlify + compteurs),
contrôle de l'origine, champ piège anti-robot, HTTPS, clés protégées côté serveur.

À activer : **Cloudflare Turnstile**, la vérification anti-robot invisible.

1. Créez un compte gratuit sur **dash.cloudflare.com** (aucun changement de DNS n'est nécessaire).
2. Menu **Turnstile** → **Add widget** :
   - **Widget name** : `ELEV8`
   - **Hostnames** : `elevateprivatedriver.com`, `www.elevateprivatedriver.com`, et votre adresse Netlify
     (`elev8-private-driver.netlify.app`)
   - **Widget mode** : **Managed**
   - **Pre-clearance** : **No**
3. Cloudflare affiche deux clés : **Site Key** (publique) et **Secret Key** (secrète).
4. **D'abord** dans Netlify → Environment variables : ajoutez `TURNSTILE_SECRET_KEY` = la **Secret Key**.
5. **Ensuite** dans GitHub : ouvrez `public/config.js` → crayon (**Edit this file**) → trouvez la ligne
   `turnstileSiteKey: "",` et collez la **Site Key** entre les guillemets → **Commit changes**.
   Cette modification déclenche automatiquement la publication, avec la clé secrète déjà en place.
6. Activez la double authentification sur **Netlify**, **Brevo**, **Cloudflare** et **GoDaddy**
   (rubriques Sécurité de chaque compte).

**Validation** :
- Une nouvelle demande de test réussit, en général sans case à cocher visible.
- La page **Politique de confidentialité** mentionne désormais Cloudflare Turnstile.
- Dans le dernier déploiement Netlify, le journal mentionne la règle de limitation (« rate limit »).

---

## Étape 8 — Effectuer une vraie réservation de test

Suivez `PROTOCOLE-TESTS.md`, sections **2** (réception des e-mails), **3** (erreurs), **4** (anti-spam)
et **6** (formulaire). Pour économiser vos crédits Netlify :
- privilégiez le test **X4** (mode avion) pour vérifier les erreurs : il ne coûte rien ;
- les tests X1 à X3 et S5 nécessitent chacun deux publications (30 crédits) : faites-les une seule fois,
  ou pas du tout le premier mois.

Préfixez les noms de test par `TEST` pour les retrouver et les supprimer ensuite.

**Validation** : tous les tests E1 à E11 sont OK, et vous avez reçu l'e-mail avec le **téléphone** du
client et les boutons « Appeler » et « WhatsApp ».

---

## Étape 9 — Vérifier le site sur téléphone

Suivez `PROTOCOLE-TESTS.md`, sections **5** (WhatsApp) et **8** (smartphones), sur au moins un iPhone
et un Android. Vérifiez en particulier :
- l'affichage de l'accueil, du menu et du formulaire ;
- l'ouverture de WhatsApp avec le message prérempli, **non envoyé automatiquement** ;
- le fonctionnement en 4G, pas seulement en Wi-Fi.

**Validation** : sections 5 et 8 OK sur les deux téléphones.

---

## Étape 10 — Finaliser les QR codes

Liens définitifs :

| Véhicule | Lien encodé dans le QR code |
|---|---|
| Tesla Model Y | `https://elevateprivatedriver.com/?bord=1&src=tesla` |
| Mercedes-Benz Classe V | `https://elevateprivatedriver.com/?bord=1&src=classe-v` |

1. Testez chaque lien à la main sur votre téléphone : le mode passager doit s'ouvrir (logo E8 animé, « Merci de voyager avec ELEV8 Private Driver » et les trois boutons Réserver, WhatsApp, Appeler).
2. Envoyez une demande depuis chaque lien : l'e-mail doit indiquer « Origine : QR code — Tesla Model Y »
   ou « Origine : QR code — Mercedes-Benz Classe V ».
3. Je génère ensuite les QR codes **statiques** prêts à imprimer (sans service intermédiaire qui
   pourrait expirer). Évitez les générateurs en ligne « dynamiques » : beaucoup redirigent par leurs
   propres serveurs et cessent de fonctionner à la fin d'un essai gratuit.
4. Avant l'impression définitive, imprimez un exemplaire, fixez-le au dossier du siège et scannez-le
   avec deux téléphones différents, de jour et de nuit.

**Validation** : chaque QR code imprimé ouvre le bon lien en moins de 3 secondes, et l'origine
apparaît dans la demande reçue.

---

## Après la mise en ligne

- **Modifier un texte, un numéro ou une photo** : sur GitHub, ouvrez le fichier → crayon → modifier →
  **Commit changes**. Le site est republié en 1 à 2 minutes (15 crédits par publication : regroupez
  vos modifications).
- **Remplacer une photo** : dans GitHub, ouvrez `public/assets/img` → **Add file** → **Upload files** →
  déposez la photo avec **exactement le même nom** (par exemple `tesla-model-y.jpg`) → **Commit changes**.
- **Surveiller les crédits** : Netlify → **Usage & billing**.
- **Un problème ?** Netlify → **Logs** → **Functions** → `reservation` indique la cause sans afficher
  les données des clients (voir le tableau du README, § 3-E).
