<?php
/* ==========================================================================
   Configuration de l'envoi des réservations — hébergement PHP (OVH, o2switch…)
   1. Copiez ce fichier sous le nom  config.php  (dans ce même dossier api/)
   2. Complétez les valeurs ci-dessous.
   Ce fichier reste sur le serveur : il n'est jamais transmis au navigateur
   (accès direct bloqué par api/.htaccess).
   ========================================================================== */
return [
  // Adresse qui reçoit les demandes
  'mail_to'       => 'contact@elevateprivatedriver.com',
  // Expéditeur : une adresse de VOTRE domaine (indispensable pour ne pas finir en spam)
  'mail_from'     => 'reservations@elevateprivatedriver.com',
  'mail_from_name'=> 'ELEV8 Private Driver',

  // Méthode d'envoi : 'mail' (fonction mail() de l'hébergeur) ou 'brevo' (API Brevo, plus fiable)
  'methode'       => 'mail',
  'brevo_api_key' => '',            // uniquement si methode = 'brevo'

  // Cloudflare Turnstile (facultatif) : clé SECRÈTE, à laisser vide si non utilisé
  'turnstile_secret' => '',

  // Limitation des envois
  'global_per_hour'   => 30,   // e-mails maximum par heure, tous visiteurs confondus
  'rate_limit_secret' => '',   // facultatif : texte aléatoire long (sinon dérivé automatiquement)
  'rate_dir'          => null, // facultatif : dossier des compteurs (défaut : dossier temporaire du serveur)

  // Domaines autorisés à envoyer le formulaire (laisser vide = domaine du site)
  'allowed_origins' => [],
];
