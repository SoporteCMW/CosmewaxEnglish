<?php
declare(strict_types=1);

session_start();

// ── Solo acepta POST ──────────────────────────────────────────────────────────
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    header('Location: login.php');
    exit;
}

// ── Lectura de .env ───────────────────────────────────────────────────────────
function readEnv(string $path): array
{
    $vars = [];
    if (!is_file($path)) return $vars;
    foreach (file($path, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) as $line) {
        $line = trim($line);
        if ($line === '' || $line[0] === '#') continue;
        [$key, $val] = array_pad(explode('=', $line, 2), 2, '');
        $vars[trim($key)] = trim($val, '"\'');
    }
    return $vars;
}

$env = readEnv(__DIR__ . '/.env');

$adHost   = $env['AD_HOST']    ?? 'localhost';
$adPort   = (int)($env['AD_PORT'] ?? 389);
$adDomain = $env['AD_DOMAIN']  ?? 'empresa.local';

// ── Validación de campos ──────────────────────────────────────────────────────
$username = trim($_POST['username'] ?? '');
$password = $_POST['password'] ?? '';

if ($username === '' || $password === '') {
    header('Location: login.php?error=' . urlencode('Usuario y contraseña son obligatorios.'));
    exit;
}

// Bloquear solo bytes nulos y saltos de línea (vectores reales de inyección LDAP).
// El username va directo a un bind UPN (usuario@dominio), no a un filtro de búsqueda,
// por lo que no hay riesgo de inyección con caracteres como punto, guion o acentos.
if (preg_match('/[\x00\n\r]/', $username)) {
    header('Location: login.php?error=' . urlencode('Nombre de usuario no válido.'));
    exit;
}

// ── Autenticación LDAP contra el AD ──────────────────────────────────────────
if (!extension_loaded('ldap')) {
    header('Location: login.php?error=' . urlencode('La extensión PHP LDAP no está habilitada. Actívala en php.ini.'));
    exit;
}

$ldap = ldap_connect("ldap://{$adHost}:{$adPort}");

if ($ldap === false) {
    header('Location: login.php?error=' . urlencode('No se pudo conectar al servidor de directorio.'));
    exit;
}

ldap_set_option($ldap, LDAP_OPT_PROTOCOL_VERSION, 3);
ldap_set_option($ldap, LDAP_OPT_REFERRALS, 0);
ldap_set_option($ldap, LDAP_OPT_NETWORK_TIMEOUT, 5);

// Bind con UPN: si el usuario escribió su email completo (contiene @) se usa tal cual;
// si escribió solo el nombre de usuario se le añade el dominio AD.
$bindUser = str_contains($username, '@') ? $username : $username . '@' . $adDomain;
$bound    = @ldap_bind($ldap, $bindUser, $password);

if (!$bound) {
    ldap_unbind($ldap);
    header('Location: login.php?error=' . urlencode('Usuario o contraseña incorrectos.'));
    exit;
}

ldap_unbind($ldap);

// ── Sesión ────────────────────────────────────────────────────────────────────
session_regenerate_id(true);
$_SESSION['logged_in'] = true;
$_SESSION['user']      = $username;
$_SESSION['login_at']  = time();

header('Location: index.php');
exit;
