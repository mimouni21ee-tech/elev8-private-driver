# ELEV8 Private Driver — site vitrine

Site officiel : **https://elevateprivatedriver.com**
Hébergement : GitHub (code) → Netlify (publication automatique) → Brevo (e-mails de réservation).

> **Pour la mise en ligne, suivez `GUIDE-MISE-EN-LIGNE.md`**, étape par étape.
> Ce README est la référence technique.

Site statique rapide (HTML, CSS, JavaScript) avec un petit service serveur qui transmet les demandes
de réservation par e-mail. Aucune donnée client stockée sur le site, aucun cookie, aucune clé secrète
dans le navigateur.

Documents fournis :
- `GUIDE-MISE-EN-LIGNE.md` — mise en ligne en 10 étapes, sans connaissances techniques
- `PROTOCOLE-TESTS.md` — tests à dérouler après la connexion de Brevo, avant l'impression des QR codes
- `AUDIT-DONNEES.md` — inventaire des données traitées et cohérence avec la politique de confidentialité
- `CAMPAGNES.md` — liens QR code et campagnes

## Contenu du dossier

```
public/                       ← le site (c'est ce dossier qui est publié)
  index.html                  Page principale
  config.js                   ← TOUS les textes, coordonnées, photos, sources de suivi
  mentions-legales.html       Remplies depuis config.js
  confidentialite.html        Remplies depuis config.js
  404.html                    Page introuvable
  assets/css, assets/js, assets/img
  api/reservation.php         Envoi des demandes — hébergement PHP uniquement
  api/config.sample.php       Modèle de réglages pour la version PHP
  _headers, .htaccess         Sécurité (HTTPS, CSP) et cache
netlify/functions/reservation.mjs   Envoi des demandes — Netlify (recommandé), adresse /envoi-reservation
netlify/functions/rl-cleanup.mjs    Suppression horaire des compteurs anti-abus expirés
netlify/functions/contact.mjs       Fiche contact « Enregistrer mon chauffeur » (/elev8-private-driver.vcf)
netlify/functions/adresses.mjs      Suggestions d'adresses Départ / Destination (/adresses) — voir GUIDE-ADRESSES.md
netlify/lib/ratelimit.mjs     Limitation des envois partagée (Netlify Blobs)
netlify.toml, package.json    Réglages Netlify et dépendance @netlify/blobs
.env.example                  Liste des variables secrètes à créer dans Netlify
CAMPAGNES.md                  Liens QR code et campagnes prêts à l'emploi
```

## Comment fonctionne le formulaire

Le client remplit une seule fois le formulaire, puis choisit :

- **Envoyer ma demande** : la demande part vers le service d'envoi (fonction Netlify ou script PHP),
  qui la vérifie puis vous l'envoie par e-mail. Le message « Demande transmise » ne s'affiche **que si
  le serveur confirme l'envoi de l'e-mail** et renvoie une référence (ex. `E8-261220-K7P`). En cas
  d'échec (réseau, prestataire indisponible, clé invalide), le client voit un message d'erreur, ses
  informations restent dans le formulaire et il peut réessayer ou passer par WhatsApp.
- **Contacter via WhatsApp** : récapitulatif à relire, puis ouverture de WhatsApp avec le message prérempli.

L'e-mail reçu contient : référence, prestation, n° de vol/train, date, heure, départ, destination,
passagers, véhicule, nom et prénom, **téléphone**, e-mail, précisions, origine de la demande, et deux
boutons « Appeler » et « WhatsApp ». Le bouton « Répondre » de votre messagerie répond au client
s'il a indiqué son e-mail.

**Protection anti-spam**, en couches :

1. **Limitation Netlify en périphérie** : 6 requêtes / 3 min par visiteur, bloquées avant même
   l'exécution du code (règle déclarée dans la fonction, disponible sur toutes les offres Netlify).
2. **Compteurs partagés** (Netlify Blobs) : 5 tentatives / 10 min et 15 / 24 h par visiteur, plus un
   plafond global de 30 e-mails / heure. Chaque incrément est une écriture conditionnelle : le compte
   reste exact même quand Netlify exécute plusieurs instances en parallèle. L'IP n'est jamais stockée
   en clair (empreinte HMAC), et les compteurs expirés sont supprimés chaque heure.
3. **Contrôles de la demande** : champ piège invisible, durée minimale de remplissage (3 s), contrôle
   de l'origine, validation complète côté serveur.
4. **Cloudflare Turnstile** (recommandé, § 4) : jeton vérifié côté serveur, lié à votre domaine et à
   l'action « reservation », utilisable une seule fois.

Si le stockage partagé est momentanément indisponible, les demandes ne sont pas bloquées (la couche 1
reste active) et l'incident apparaît dans les journaux de la fonction.

---

## 1. Personnaliser

Ouvrez `public/config.js` avec un éditeur de texte (VS Code, Bloc-notes…).

- **Coordonnées** : `contact.telephoneAffiche`, `contact.telephone`, `contact.email`.
- **WhatsApp** : `contact.whatsapp` = indicatif + numéro sans 0, sans espace ni « + »
  (06 12 34 56 78 → `33612345678` ; 079 123 45 67 → `41791234567`).
- **Indicatif proposé par défaut** : `reservation.indicatifParDefaut` (`+33` ou `+41`). Les visiteurs
  dont le navigateur est réglé en français de Suisse voient `+41` automatiquement.
- **Véhicules** : vérifiez `passagersMax` (4 pour la Tesla, 7 pour le Classe V par défaut).
- **Destinations et prestations** : textes modifiables. Une prestation avec `transfert: "vol"`,
  `"train"` ou `"vol-train"` fait apparaître le champ « N° de vol / de train ».
- **Mentions légales** : complétez tout le bloc `legal` (SIRET, n° d'inscription au registre VTC,
  hébergeur, prestataire d'envoi). Obligatoire avant la mise en ligne.

Après une modification, si la page reste vide, une virgule ou un guillemet manque dans `config.js`.

## 2. Remplacer les photos

Remplacez les fichiers de `public/assets/img/` **en gardant les mêmes noms** :

| Fichier              | Usage                     | Format conseillé          |
|----------------------|---------------------------|---------------------------|
| `hero.jpg`           | Image d'aperçu quand le lien est partagé (WhatsApp, SMS, réseaux) — n'apparaît pas sur la page | 1200 × 630 px, < 300 Ko |
| `tesla-model-y.jpg`  | Fiche Tesla Model Y       | 1500 × 1000 px            |
| `mercedes-classe-v.jpg` | Fiche Mercedes-Benz Classe V | 1500 × 1000 px         |

Compressez-les (squoosh.app). Passez ensuite `afficherMentionPhotoProvisoire` à `false`.

---

## 3. Mise en ligne recommandée : Netlify + Brevo

Netlify héberge le site gratuitement avec HTTPS automatique et exécute la fonction d'envoi.
Brevo (société française, données hébergées dans l'UE) envoie les e-mails. Resend est aussi pris en
charge si vous le préférez.

> Important : le simple glisser-déposer du dossier sur Netlify **ne déploie pas la fonction d'envoi**.
> Utilisez GitHub (étape A) ou l'outil en ligne de commande (étape A bis).

### A. Publier le site via GitHub (sans ligne de commande)

1. Créez un compte sur github.com, puis un dépôt **privé** nommé `elev8-site`.
2. Dans le dépôt : « Add file » → « Upload files » → glissez **le contenu** du dossier `elev8`
   (les dossiers `public`, `netlify`, et les fichiers `netlify.toml`, `README.md`…). Validez.
   Vérifiez que `netlify.toml` est bien à la racine du dépôt.
3. Sur netlify.com : « Add new project » → « Import an existing project » → GitHub → `elev8-site`.
   Les réglages sont lus dans `netlify.toml` (dossier publié : `public`). Cliquez sur « Deploy ».

**A bis (alternative)** : avec Node.js installé, depuis le dossier `elev8` :
`npx netlify-cli login` puis `npx netlify-cli deploy --prod`.

### B. Configurer Brevo (envoi des e-mails)

1. Créez un compte sur brevo.com (offre gratuite).
2. **Authentifiez votre domaine** : Paramètres → « Expéditeurs, domaines et IP dédiées » → Domaines →
   « Ajouter un domaine ». Brevo affiche des enregistrements DNS (TXT de vérification, DKIM, DMARC) à
   créer chez votre registraire (OVH, Gandi, Infomaniak…). Attendez que le domaine soit « Authentifié ».
3. Créez l'expéditeur `reservations@elevateprivatedriver.com` (Expéditeurs → Ajouter).
4. **Clé API** : « SMTP & API » → « Clés API » → « Générer une nouvelle clé ». Copiez-la (elle commence
   par `xkeysib-`). Ne la collez **jamais** dans `config.js`.
5. Si Brevo bloque les appels depuis des adresses IP inconnues (« IP autorisées » dans la sécurité du
   compte), désactivez ce blocage : les serveurs de Netlify n'ont pas d'adresse IP fixe.

### C. Déclarer les clés secrètes dans Netlify

Netlify → votre site → « Site configuration » → « Environment variables » → « Add a variable » :

| Variable          | Valeur                                                  |
|-------------------|---------------------------------------------------------|
| `EMAIL_PROVIDER`  | `brevo` (ou `resend`)                                   |
| `EMAIL_API_KEY`   | la clé API Brevo (ou Resend)                            |
| `MAIL_TO`         | l'adresse qui reçoit les demandes                       |
| `MAIL_FROM`       | `reservations@elevateprivatedriver.com` (expéditeur authentifié) |
| `MAIL_FROM_NAME`  | `ELEV8 Private Driver` (facultatif)                     |
| `ALLOWED_ORIGINS` | ex. `https://elevateprivatedriver.com,https://www.elevateprivatedriver.com` (recommandé) |
| `RATE_LIMIT_SECRET` | facultatif : texte aléatoire long (rend les empreintes IP indépendantes de la clé API) |
| `RATE_GLOBAL_PER_HOUR` | facultatif : plafond d'e-mails par heure (défaut 30) |
| `TURNSTILE_SECRET_KEY` | clé secrète Turnstile (voir § 4) |

Puis « Deploys » → « Trigger deploy » → « Deploy site » pour prendre en compte les variables.

Dans `public/config.js`, laissez `formulaire.endpoint: "/envoi-reservation"`.

Netlify installe automatiquement la dépendance `@netlify/blobs` (fichier `package.json`) et active le
stockage Blobs sans réglage. Dans le journal de déploiement, la section « post-processing » doit
mentionner la règle de limitation (« rate limit ») de la fonction `reservation`.

### D. Nom de domaine et HTTPS

Netlify → « Domain management » → « Add a domain » → `elevateprivatedriver.com`. Créez chez votre
registraire les enregistrements DNS indiqués par Netlify. Le certificat HTTPS est créé automatiquement.
Chez GoDaddy (DNS conservés chez GoDaddy) : enregistrement **A** `@` → `75.2.60.5`, et enregistrement
**CNAME** `www` → l'adresse Netlify du site (ex. `elev8-private-driver.netlify.app`). Définissez
`elevateprivatedriver.com` comme domaine principal : `www` y est alors redirigé. Tant que le domaine
n'est pas relié, le site reste accessible à son adresse Netlify.

### Offre gratuite Netlify : crédits

L'offre gratuite donne 300 crédits par mois. Les principaux postes pour ce site :

| Poste | Coût | Ordre de grandeur |
|---|---|---|
| Publication d'une nouvelle version (commit sur GitHub) | 15 crédits | 8 publications ≈ 120 crédits |
| Bande passante | 20 crédits / Go | ~1 Mo par première visite → 1 000 visites ≈ 20 crédits |
| Fonctions (envois, nettoyage horaire) | 10 crédits / Go-heure | quelques crédits par mois |

Si les crédits sont épuisés, Netlify **met le site en pause** jusqu'au mois suivant (alertes à 50, 75
et 100 %). Pour économiser : regroupez vos modifications de `config.js` en un seul commit ; les commits
qui ne touchent que les documents (README, guides) ne republient pas le site (`netlify/ignore-build.sh`).
Si le trafic augmente, l'offre Personal (1 000 crédits) évite toute interruption.

### E. Tester l'envoi (indispensable)

Déroulez le protocole complet de `PROTOCOLE-TESTS.md` (réception réelle, erreurs d'envoi, WhatsApp,
smartphones). Codes visibles dans Netlify → « Logs » → « Functions » → `reservation` (aucune donnée
client n'y est écrite) :

| Message dans les journaux | Cause | Solution |
|---|---|---|
| `Envoi impossible : config` | Variable manquante | Vérifier `EMAIL_API_KEY`, `MAIL_TO`, `MAIL_FROM`, puis redéployer |
| `Envoi impossible : provider:401` | Clé API refusée | Régénérer la clé Brevo, vérifier le blocage par IP |
| `Envoi impossible : provider:400` | Expéditeur non validé | Authentifier le domaine et l'expéditeur dans Brevo |
| `Turnstile : jeton reçu mais TURNSTILE_SECRET_KEY absente` | Clé publique sans clé secrète | Ajouter la variable dans Netlify |
| `Limitation partagée indisponible` | Netlify Blobs injoignable | Passager : rien à faire ; persistant : contacter Netlify |

---

## 3 bis. Alternative : hébergement PHP (OVH, o2switch, Hostinger…)

1. Envoyez **le contenu du dossier `public/`** dans `www/` (ou `public_html/`) par FTP (FileZilla).
2. Dans `api/`, copiez `config.sample.php` sous le nom `config.php` et complétez-le
   (adresse de réception, expéditeur **de votre domaine**).
3. Méthode d'envoi :
   - `'mail'` : utilise le serveur e-mail de l'hébergeur. Simple, mais `mail()` confirme seulement que
     l'hébergeur a accepté le message, pas sa remise effective. Testez la réception.
   - `'brevo'` (recommandé) : renseignez `brevo_api_key`. La clé reste sur le serveur.
   La limitation des envois utilise des fichiers verrouillés (exacts même en cas de requêtes
   simultanées) dans le dossier temporaire du serveur, nettoyés à chaque demande.
4. Dans `config.js` : `formulaire.endpoint: "api/reservation.php"`.
5. Activez le certificat SSL gratuit (Let's Encrypt) dans l'espace client. `.htaccess` force le HTTPS
   et `api/.htaccess` interdit l'accès direct à `config.php`.
6. Faites les tests du § 3-E.

---

## 4. Anti-robot : Cloudflare Turnstile (recommandé)

Gratuit, invisible pour la plupart des visiteurs (mode « interaction-only » : une case n'apparaît
qu'en cas de doute), sans finalité publicitaire. Le paragraphe correspondant de la politique de
confidentialité s'affiche automatiquement dès que la clé publique est renseignée.

1. dash.cloudflare.com → « Turnstile » → « Add widget ». Nom : ELEV8. Domaines : `elevateprivatedriver.com`,
   `www.elevateprivatedriver.com` et, pour les essais, `elev8-private-driver.netlify.app` (adresse Netlify du site). Mode : « Managed ».
2. Clé **publique** (site key) → `public/config.js` : `formulaire.turnstileSiteKey: "0x4AAA..."`.
3. Clé **secrète** → Netlify : variable `TURNSTILE_SECRET_KEY` (ou `turnstile_secret` dans `api/config.php`).
   **Les deux clés vont ensemble** : une clé publique seule n'apporte aucune protection.
4. Redéployez, puis déroulez la partie Turnstile de `PROTOCOLE-TESTS.md`.

Clés de test officielles Cloudflare (pour vérifier le fonctionnement avant d'utiliser les vraies) :

| Usage | Clé publique (`config.js`) | Clé secrète (Netlify) |
|---|---|---|
| Toujours accepté | `1x00000000000000000000AA` | `1x0000000000000000000000000000000AA` |
| Toujours refusé | `2x00000000000000000000AB` | `2x0000000000000000000000000000000AA` |

Ne laissez jamais les clés de test en production.

## 5. Mode passager et fiche contact

Les QR codes des véhicules (`?bord=1`) ouvrent le **mode passager** : logo E8 animé, puis quatre actions
visibles sans défiler — Réserver un trajet, Enregistrer mon chauffeur, Contacter via WhatsApp, Appeler —
et en dessous les véhicules, zones et prestations. Textes : bloc `bord` de `config.js`.

**Enregistrer mon chauffeur** ouvre une fiche contact (vCard) générée automatiquement à partir de
`config.js` : nom, téléphone, lien WhatsApp, site, logo E8 (`assets/img/e8-contact.jpg`). Modifier le
numéro dans `config.js` suffit, la fiche suit. Pour ajouter l'e-mail quand la boîte sera opérationnelle :
`ficheContact.inclureEmail: true`.

- **iPhone (Safari)** : la fiche s'ouvre, le client touche « Créer un nouveau contact ».
- **Android (Chrome)** : la fiche est téléchargée ; le site affiche comment l'ouvrir avec Contacts.
- Rien n'est jamais ajouté sans la confirmation du client.
- Le lien du site enregistré dans la fiche contient `?src=contact` : les demandes envoyées plus tard
  depuis la fiche apparaissent avec l'origine « Fiche contact enregistrée ».

L'offre gratuite Netlify autorise 2 règles de limitation : elles sont utilisées par l'envoi des
réservations et par la fiche contact (30 téléchargements par minute et par visiteur).

## 6. QR codes et campagnes

Voir `CAMPAGNES.md` : liens prêts pour chaque véhicule, carte de visite, réseaux sociaux et campagnes
Google Ads / Meta. L'origine apparaît dans chaque demande reçue, sans cookie ni traceur.

## 7. Polices (optionnel, RGPD)

Les polices Bodoni Moda et Jost viennent de Google Fonts. Pour ne transmettre aucune adresse IP à Google,
téléchargez-les (google-webfonts-helper) dans `public/assets/fonts/`, remplacez la ligne
`fonts.googleapis.com` des fichiers HTML par des règles `@font-face` locales, et retirez Google Fonts
de l'en-tête `Content-Security-Policy` et de la politique de confidentialité.
