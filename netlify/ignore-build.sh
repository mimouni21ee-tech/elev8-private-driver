#!/usr/bin/env bash
# Évite de publier une nouvelle version (et de consommer des crédits Netlify)
# quand seuls des documents (README, guides…) ont changé.
# Code de sortie 0 = publication ignorée ; 1 = publication normale.

# Premier déploiement ou relance manuelle : toujours publier
if [ -z "$CACHED_COMMIT_REF" ] || [ "$CACHED_COMMIT_REF" = "$COMMIT_REF" ]; then
  exit 1
fi

# Publier uniquement si le site, les fonctions ou les réglages ont changé.
# En cas d'erreur de git (historique incomplet), git renvoie un code ≠ 0 : on publie.
git diff --quiet "$CACHED_COMMIT_REF" "$COMMIT_REF" -- public/ netlify/ netlify.toml package.json package-lock.json
