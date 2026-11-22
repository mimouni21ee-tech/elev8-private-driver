#!/usr/bin/env bash
# Évite de publier une nouvelle version (et de consommer des crédits Netlify)
# quand seuls des documents (README, guides…) ont changé.
# Code de sortie 0 = publication ignorée ; 1 = publication normale.

# Branche de test Stripe : toujours publier (déploiement de branche, jamais la production).
# Sur une nouvelle branche, Netlify compare avec le dernier déploiement de main : la règle
# ci-dessous pourrait alors annuler la publication à tort.
if [ "$BRANCH" = "stripe-test" ]; then
  exit 1
fi

# Premier déploiement ou relance manuelle : toujours publier
if [ -z "$CACHED_COMMIT_REF" ] || [ "$CACHED_COMMIT_REF" = "$COMMIT_REF" ]; then
  exit 1
fi

# Publier uniquement si le site, les fonctions ou les réglages ont changé.
# En cas d'erreur de git (historique incomplet), git renvoie un code ≠ 0 : on publie.
git diff --quiet "$CACHED_COMMIT_REF" "$COMMIT_REF" -- public/ netlify/ netlify.toml package.json package-lock.json
