# Suggestions d'adresses — guide de mise en route

Quand un client tape une adresse dans **Départ** ou **Destination**, une liste de suggestions
apparaît sous le champ (rues et numéros, places, gares, aéroports, hôtels, établissements,
France et étranger). Il touche une suggestion : l'adresse complète est remplie.
Le client peut toujours écrire son adresse librement : la réservation n'est jamais bloquée.

## Comment ça marche (et pourquoi c'est sûr)

```
Téléphone du client ──► elev8privatedriver.com/adresses ──► Google Places (ou service gratuit)
                         (fonction Netlify, clé secrète
                          stockée chez Netlify)
```

- Le navigateur du client n'appelle **jamais** Google directement : aucune clé dans le code
  du site, rien sur GitHub, aucun script ni cookie Google ajouté.
- Seul le texte tapé est transmis (pas l'adresse IP du client).
- L'envoi des réservations (Brevo) n'est pas modifié.

## Deux modes

| Mode | Quand | Qualité | Coût |
|---|---|---|---|
| **Gratuit** (par défaut) | Aucune clé configurée | Très bon pour les adresses françaises (IGN) ; bon pour gares, aéroports, hôtels et l'étranger (OpenStreetMap) | 0 € |
| **Google Places** (recommandé) | Variable `GOOGLE_MAPS_API_KEY` présente dans Netlify | Le meilleur : identique à Google Maps (hôtels, établissements, monde entier) | 10 000 recherches gratuites / mois, puis 2,83 $ les 1 000 |

Le mode gratuit fonctionne dès la mise en ligne, sans rien régler.
Si Google ne répond pas (panne, quota du jour atteint), le mode gratuit prend le relais tout seul.

## Activer Google Places (environ 15 minutes)

### 1. Google Cloud
1. Aller sur https://console.cloud.google.com et se connecter avec un compte Google.
2. En haut : **Sélectionner un projet → Nouveau projet** → nom `ELEV8` → **Créer**.
3. Menu ☰ → **Facturation** → associer un compte de facturation (carte bancaire demandée par
   Google, même pour l'usage gratuit).
4. Menu ☰ → **API et services → Bibliothèque** → chercher **Places API (New)** → **Activer**.
   (Attention : bien « (New) », pas l'ancienne « Places API ».)
5. **API et services → Identifiants → Créer des identifiants → Clé API**. Copier la clé (commence par `AIza…`).
6. Cliquer sur la clé pour la **restreindre** :
   - *Restrictions relatives aux applications* : **Aucune** (la clé est utilisée par le serveur
     Netlify, jamais par le navigateur — elle reste secrète) ;
   - *Restrictions relatives aux API* : **Restreindre la clé** → cocher uniquement **Places API (New)** → **Enregistrer**.

### 2. Plafond de dépense (fortement recommandé)
- **API et services → Places API (New) → Quotas et limites du système** : filtrer sur
  « Autocomplete » et abaisser la limite (par exemple **300 par jour** si la limite quotidienne
  est proposée, sinon la limite par minute). 300 × 30 jours = 9 000 recherches, sous les 10 000 gratuites.
- **Facturation → Budgets et alertes** : créer un budget de **5 €** avec alerte par e-mail.

Quand le quota est atteint, Google refuse les nouvelles recherches et le site bascule
automatiquement sur le mode gratuit : les clients ont toujours des suggestions.

### 3. Netlify
1. Netlify → site **elev8-private-driver** → **Site configuration → Environment variables → Add a variable**.
2. Key : `GOOGLE_MAPS_API_KEY` — Value : la clé `AIza…` — Scopes : **Functions** (ou « All scopes ») → **Create variable**.
3. **Deploys → Trigger deploy → Deploy site** (une variable n'est prise en compte qu'après une nouvelle publication).
4. Tester : dans le formulaire, taper `17 rue Ferdinand` → en bas de la liste doit apparaître « Google Maps ».

**Ne jamais** mettre la clé dans `config.js`, dans un fichier sur GitHub ou dans un message.

## Réglages facultatifs

| Où | Réglage | Effet |
|---|---|---|
| `config.js` → `adresses.actif` | `false` | Désactive les suggestions (champs texte simples) |
| `config.js` → `adresses.minCaracteres` | `3` | Lettres tapées avant d'afficher la liste |
| Netlify → `ADRESSES_PROVIDER` | `gratuit` | Force le mode gratuit même si une clé existe |
| Netlify → `ADRESSES_PROVIDER` | `google` | Google uniquement (pas de relais gratuit) |

## Coûts : ordre de grandeur
Une adresse tapée déclenche en moyenne 3 à 6 recherches (une pause de 0,2 s après la frappe,
cache des recherches identiques). 10 000 recherches gratuites par mois ≈ 1 500 à 3 000 adresses saisies.
