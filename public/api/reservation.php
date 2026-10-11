<?php
/* ==========================================================================
   ELEV8 Private Driver — réception des demandes de réservation (PHP)
   À utiliser sur un hébergement PHP classique. Dans config.js, réglez :
     formulaire.endpoint: "api/reservation.php"
   Réglages : api/config.php (copie de config.sample.php).
   ========================================================================== */
declare(strict_types=1);
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');

function out(int $code, array $body): void { http_response_code($code); echo json_encode($body, JSON_UNESCAPED_UNICODE); exit; }

$cfgFile = __DIR__ . '/config.php';
if (!is_file($cfgFile)) out(500, ['ok' => false, 'error' => 'config']);
$cfg = require $cfgFile;

if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') out(405, ['ok' => false, 'error' => 'method']);

// Même origine uniquement
$origin = $_SERVER['HTTP_ORIGIN'] ?? '';
if ($origin !== '') {
  $scheme = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') ? 'https' : 'http';
  $self = $scheme . '://' . ($_SERVER['HTTP_HOST'] ?? '');
  if ($origin !== $self && !in_array($origin, $cfg['allowed_origins'] ?? [], true)) out(403, ['ok' => false, 'error' => 'origin']);
}
if (stripos($_SERVER['CONTENT_TYPE'] ?? '', 'application/json') === false) out(415, ['ok' => false, 'error' => 'type']);

$raw = file_get_contents('php://input', false, null, 0, 12001);
if ($raw === false || strlen($raw) > 12000) out(413, ['ok' => false, 'error' => 'size']);
$b = json_decode($raw, true);
if (!is_array($b)) out(400, ['ok' => false, 'error' => 'json']);

// Limitation des envois — un seul serveur PHP : compteurs dans des fichiers verrouillés (flock),
// donc exacts même si plusieurs requêtes arrivent en même temps. L'adresse IP n'est pas stockée :
// seule une empreinte HMAC sert de nom de fichier. Les fichiers expirés sont supprimés automatiquement.
$ip = $_SERVER['REMOTE_ADDR'] ?? 'inconnue';
$rlDir = rtrim(($cfg['rate_dir'] ?? '') ?: (sys_get_temp_dir() . '/elev8_rl'), '/');
if (!is_dir($rlDir)) @mkdir($rlDir, 0700, true);
$rlSecret = (string)($cfg['rate_limit_secret'] ?? '') ?: hash('sha256', __DIR__ . ($cfg['mail_to'] ?? ''));
$fp = substr(hash_hmac('sha256', $ip, $rlSecret), 0, 24);

/** Ajoute un événement si la limite n'est pas atteinte ; false si refusé. */
function rl_consume(string $file, int $limit, int $window): bool {
  $h = @fopen($file, 'c+');
  if (!$h) return true; // stockage indisponible : on n'empêche pas les demandes légitimes
  try {
    flock($h, LOCK_EX);
    $now = time();
    $list = json_decode((string)stream_get_contents($h), true) ?: [];
    $list = array_values(array_filter($list, fn($t) => $now - (int)$t < $window));
    if (count($list) >= $limit) return false;
    $list[] = $now;
    ftruncate($h, 0); rewind($h); fwrite($h, json_encode($list)); fflush($h);
    return true;
  } finally { flock($h, LOCK_UN); fclose($h); }
}
// Nettoyage des compteurs expirés (plus de 24 h) à chaque demande
foreach (glob($rlDir . '/*.json') ?: [] as $f) if (time() - (int)@filemtime($f) > 86400) @unlink($f);

if (!rl_consume("$rlDir/ip10m_$fp.json", 5, 600) || !rl_consume("$rlDir/ip24h_$fp.json", 15, 86400)) out(429, ['ok' => false, 'error' => 'rate']);

// Anti-spam : champ piège et durée minimale de remplissage
if (!empty($b['website'])) out(400, ['ok' => false, 'error' => 'spam']);
if (!isset($b['duree']) || !is_numeric($b['duree']) || (float)$b['duree'] < 3000) out(400, ['ok' => false, 'error' => 'spam']);

// Cloudflare Turnstile (si configuré)
if (!empty($cfg['turnstile_secret'])) {
  $tok = is_string($b['turnstile'] ?? null) ? $b['turnstile'] : '';
  if ($tok === '') out(400, ['ok' => false, 'error' => 'captcha']);
  $ctx = stream_context_create(['http' => ['method' => 'POST', 'timeout' => 8,
    'header' => "Content-Type: application/x-www-form-urlencoded\r\n",
    'content' => http_build_query(['secret' => $cfg['turnstile_secret'], 'response' => $tok, 'remoteip' => $ip])]]);
  $r = @file_get_contents('https://challenges.cloudflare.com/turnstile/v0/siteverify', false, $ctx);
  $j = $r ? json_decode($r, true) : null;
  if (!is_array($j) || ($j['success'] ?? false) !== true) out(400, ['ok' => false, 'error' => 'captcha']);
  if (!preg_match('/^[123]x0+AA$/', $cfg['turnstile_secret'])) { // clés de test : valeurs fictives
    $host = strtolower(explode(':', $_SERVER['HTTP_HOST'] ?? '')[0]);
    if (!empty($j['hostname']) && strtolower($j['hostname']) !== $host) out(400, ['ok' => false, 'error' => 'captcha']);
    if (!empty($j['action']) && $j['action'] !== 'reservation') out(400, ['ok' => false, 'error' => 'captcha']);
  }
} elseif (!empty($b['turnstile'])) {
  error_log('ELEV8 : jeton Turnstile reçu mais turnstile_secret absent de config.php');
}

// Validation
function s($v, int $max): string {
  if (!is_string($v)) return '';
  $v = preg_replace('/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/u', '', $v) ?? '';
  return mb_substr(trim($v), 0, $max);
}
function validPhone(string $p): bool {
  if (!preg_match('/^\+[1-9]\d{7,14}$/', $p)) return false;
  $rules = ['+377' => '/^\+377\d{8,9}$/', '+352' => '/^\+352\d{6,11}$/', '+33' => '/^\+33[1-9]\d{8}$/',
    '+41' => '/^\+41[1-9]\d{8}$/', '+32' => '/^\+32\d{8,9}$/', '+39' => '/^\+39\d{6,11}$/', '+49' => '/^\+49\d{6,13}$/',
    '+34' => '/^\+34[6-9]\d{8}$/', '+44' => '/^\+44\d{9,10}$/', '+31' => '/^\+31\d{9}$/', '+1' => '/^\+1[2-9]\d{9}$/'];
  foreach ($rules as $cc => $re) if (str_starts_with($p, $cc)) return (bool)preg_match($re, $p);
  return true;
}
$o = is_array($b['origine'] ?? null) ? $b['origine'] : [];
$d = [
  'prestation' => s($b['prestation'] ?? '', 80),
  'reference' => strtoupper(s($b['reference'] ?? '', 20)),
  'typeReference' => in_array($b['typeReference'] ?? '', ['vol', 'train', 'vol-train'], true) ? $b['typeReference'] : '',
  'date' => s($b['date'] ?? '', 10),
  'heure' => s($b['heure'] ?? '', 5),
  'depart' => s($b['depart'] ?? '', 200),
  'destination' => s($b['destination'] ?? '', 200),
  'passagers' => filter_var($b['passagers'] ?? null, FILTER_VALIDATE_INT),
  'vehicule' => s($b['vehicule'] ?? '', 60),
  'nom' => s($b['nom'] ?? '', 80),
  'prenom' => s($b['prenom'] ?? '', 80),
  'telephone' => s($b['telephone'] ?? '', 20),
  'email' => s($b['email'] ?? '', 120),
  'precisions' => s($b['precisions'] ?? '', 1500),
  'origine' => s($o['libelle'] ?? '', 120) ?: (preg_replace('/[^a-z0-9._-]/i', '', s($o['code'] ?? '', 60)) ?: 'Accès direct'),
];
$utm = [];
foreach (['utm_source', 'utm_medium', 'utm_campaign', 'utm_content'] as $k) {
  $v = preg_replace('/[^a-z0-9._-]/i', '', s(($o['utm'][$k] ?? ''), 60));
  if ($v) $utm[] = "$k=$v";
}
$bad = [];
$yesterday = gmdate('Y-m-d', time() - 36 * 3600);
if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $d['date']) || !strtotime($d['date']) || $d['date'] < $yesterday) $bad[] = 'date';
if (!preg_match('/^([01]\d|2[0-3]):[0-5]\d$/', $d['heure'])) $bad[] = 'heure';
if (mb_strlen($d['depart']) < 3) $bad[] = 'depart';
if (mb_strlen($d['destination']) < 3) $bad[] = 'destination';
if ($d['nom'] === '') $bad[] = 'nom';
if ($d['prenom'] === '') $bad[] = 'prenom';
if (!validPhone($d['telephone'])) $bad[] = 'telephone';
if ($d['email'] !== '' && !filter_var($d['email'], FILTER_VALIDATE_EMAIL)) $bad[] = 'email';
if ($d['passagers'] === false || $d['passagers'] < 1 || $d['passagers'] > 8) $bad[] = 'passagers';
if ($d['reference'] !== '' && !preg_match('/^[A-Z0-9 \-]{2,20}$/', $d['reference'])) $bad[] = 'reference';
if ($bad) out(422, ['ok' => false, 'error' => 'validation', 'fields' => $bad]);

// Plafond global d'e-mails par heure
if (!rl_consume("$rlDir/global.json", (int)($cfg['global_per_hour'] ?? 30), 3600)) out(429, ['ok' => false, 'error' => 'busy']);

// Composition de l'e-mail
$ref = 'E8-' . gmdate('ymd') . '-' . substr(str_shuffle('ABCDEFGHJKLMNPQRSTUVWXYZ23456789'), 0, 3);
$refLabels = ['vol' => 'N° de vol', 'train' => 'N° de train', 'vol-train' => 'N° de vol / train'];
$jours = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
$mois = ['', 'janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
$ts = strtotime($d['date'] . ' 12:00:00 UTC');
$dateFr = ucfirst($jours[(int)gmdate('w', $ts)]) . ' ' . (int)gmdate('j', $ts) . ' ' . $mois[(int)gmdate('n', $ts)] . ' ' . gmdate('Y', $ts);
$rows = [['Référence', $ref], ['Prestation', $d['prestation'] ?: 'À préciser']];
if ($d['reference'] !== '') $rows[] = [$refLabels[$d['typeReference']] ?? 'N° de vol / train', $d['reference']];
array_push($rows,
  ['Date', $dateFr], ['Heure', str_replace(':', 'h', $d['heure'])], ['Départ', $d['depart']],
  ['Destination', $d['destination']], ['Passagers', (string)$d['passagers']], ['Véhicule', $d['vehicule'] ?: 'Pas de préférence'],
  ['Client', $d['prenom'] . ' ' . $d['nom']], ['Téléphone', $d['telephone']], ['E-mail', $d['email'] ?: 'Non renseigné']);
if ($d['precisions'] !== '') $rows[] = ['Précisions', $d['precisions']];
$rows[] = ['Origine', $d['origine']];
if ($utm) $rows[] = ['UTM', implode(' · ', $utm)];

$brand = $cfg['mail_from_name'] ?? 'ELEV8 Private Driver';
$subject = 'Demande de réservation ' . $ref . ' — ' . implode('/', array_reverse(explode('-', $d['date']))) . ' ' . str_replace(':', 'h', $d['heure']) . ' — ' . $d['prenom'] . ' ' . $d['nom'];
$text = "Nouvelle demande de réservation reçue depuis le site $brand.\n\n";
foreach ($rows as [$k, $v]) $text .= "$k : $v\n";
$text .= "\nAppeler : {$d['telephone']}\nWhatsApp : https://wa.me/" . preg_replace('/\D/', '', $d['telephone']) . "\n";

$sent = false;
if (($cfg['methode'] ?? 'mail') === 'brevo') {
  $payload = ['sender' => ['name' => $brand, 'email' => $cfg['mail_from']], 'to' => [['email' => $cfg['mail_to']]],
    'subject' => $subject, 'textContent' => $text];
  if ($d['email'] !== '') $payload['replyTo'] = ['email' => $d['email']];
  $ch = curl_init('https://api.brevo.com/v3/smtp/email');
  curl_setopt_array($ch, [CURLOPT_POST => true, CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 10,
    CURLOPT_HTTPHEADER => ['api-key: ' . ($cfg['brevo_api_key'] ?? ''), 'Content-Type: application/json', 'Accept: application/json'],
    CURLOPT_POSTFIELDS => json_encode($payload, JSON_UNESCAPED_UNICODE)]);
  curl_exec($ch);
  $code = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
  curl_close($ch);
  $sent = $code >= 200 && $code < 300;
} else {
  $enc = fn(string $s) => '=?UTF-8?B?' . base64_encode($s) . '?=';
  $headers = [
    'From: ' . $enc($brand) . ' <' . $cfg['mail_from'] . '>',
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: 8bit',
  ];
  if ($d['email'] !== '') $headers[] = 'Reply-To: ' . $d['email'];
  $sent = @mail($cfg['mail_to'], $enc($subject), $text, implode("\r\n", $headers), '-f' . $cfg['mail_from']);
}

if (!$sent) { error_log('ELEV8 : envoi de demande impossible'); out(502, ['ok' => false, 'error' => 'send']); }
out(200, ['ok' => true, 'ref' => $ref]);
