<?php
/**
 * FotoPerfil — endpoint de perfil + foto (Microsoft Graph)
 * --------------------------------------------------------
 * Devuelve, en JSON, los datos de directorio y la foto de perfil de un usuario
 * del tenant a partir de su email (o de su nombre para mostrar).
 *
 * Control de acceso: se gestiona A NIVEL DE RED con el .htaccess de la raíz del
 * proyecto (solo localhost + subredes internas). Este PHP no implementa auth
 * propia; confía en esa restricción de red.
 *
 * Uso:
 *   GET api/profile.php?email=usuario@dominio.com
 *   GET api/profile.php?nombre=Nombre Apellido
 */

require_once __DIR__ . '/../config.php';

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: private, max-age=1800');

// Solo GET (higiene básica).
if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'GET') {
    header('Allow: GET');
    http_response_code(405);
    echo json_encode(['error' => 'Método no permitido']);
    exit;
}

$email  = trim($_GET['email']  ?? '');
$nombre = trim($_GET['nombre'] ?? '');

if ($email === '' && $nombre === '') {
    http_response_code(400);
    echo json_encode(['error' => 'Se requiere email o nombre']);
    exit;
}

if ($email !== '' && !filter_var($email, FILTER_VALIDATE_EMAIL)) {
    http_response_code(400);
    echo json_encode(['error' => 'Email no válido']);
    exit;
}

if (!graph_configured()) {
    http_response_code(503);
    echo json_encode(['error' => 'Microsoft Graph no configurado (revisa el .env)']);
    exit;
}

/** Llamada GET a Graph con Bearer token. */
function graphGet(string $url, string $token, array $extraHeaders = []): array
{
    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_HTTPHEADER     => array_merge(["Authorization: Bearer {$token}"], $extraHeaders),
        CURLOPT_TIMEOUT        => 10,
    ]);
    $body = curl_exec($ch);
    $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    return ['code' => $code, 'body' => $body ?: ''];
}

// ── 1) Token (client credentials) ─────────────────────────────────────────────
$ch = curl_init('https://login.microsoftonline.com/' . TENANT_ID . '/oauth2/v2.0/token');
curl_setopt_array($ch, [
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_POST           => true,
    CURLOPT_POSTFIELDS     => http_build_query([
        'grant_type'    => 'client_credentials',
        'client_id'     => CLIENT_ID,
        'client_secret' => CLIENT_SECRET,
        'scope'         => 'https://graph.microsoft.com/.default',
    ]),
    CURLOPT_HTTPHEADER => ['Content-Type: application/x-www-form-urlencoded'],
    CURLOPT_TIMEOUT    => 10,
]);
$tokenBody = curl_exec($ch);
curl_close($ch);

$tokenData = json_decode($tokenBody, true) ?? [];
$token = $tokenData['access_token'] ?? null;
if (!$token) {
    http_response_code(502);
    echo json_encode([
        'error'  => 'No se pudo obtener el token de Graph',
        'detail' => $tokenData['error_description'] ?? ($tokenData['error'] ?? null),
    ]);
    exit;
}

// ── 2) Perfil ─────────────────────────────────────────────────────────────────
$fields  = 'displayName,jobTitle,department,mail,id';
$profile = [];

if ($email !== '') {
    $enc  = urlencode($email);
    $resp = graphGet("https://graph.microsoft.com/v1.0/users/{$enc}?\$select={$fields}", $token);
    if ($resp['code'] === 200) {
        $profile = json_decode($resp['body'], true) ?: [];
    } elseif ($resp['code'] === 404) {
        http_response_code(404);
        echo json_encode(['error' => 'Usuario no encontrado']);
        exit;
    }
} else {
    $q    = '"displayName:' . str_replace('"', '', $nombre) . '"';
    $resp = graphGet(
        "https://graph.microsoft.com/v1.0/users?\$search=" . urlencode($q) . "&\$select={$fields}&\$top=1",
        $token,
        ['ConsistencyLevel: eventual']
    );
    $users = ($resp['code'] === 200) ? (json_decode($resp['body'], true)['value'] ?? []) : [];
    if (!empty($users)) {
        $profile = $users[0];
    }
}

if (empty($profile['id'])) {
    http_response_code(404);
    echo json_encode(['error' => 'Usuario no encontrado']);
    exit;
}

$userId = $profile['id'];

// ── 3) Foto ─────────────────────────────────────────────────────────────────
$photoResp = graphGet("https://graph.microsoft.com/v1.0/users/{$userId}/photo/\$value", $token);
$photo = ($photoResp['code'] === 200 && $photoResp['body'] !== '')
    ? 'data:image/jpeg;base64,' . base64_encode($photoResp['body'])
    : null;

// ── 4) Presencia ──────────────────────────────────────────────────────────────
$availability = null;
$presenceResp = graphGet("https://graph.microsoft.com/v1.0/users/{$userId}/presence", $token);
if ($presenceResp['code'] === 200) {
    $availability = json_decode($presenceResp['body'], true)['availability'] ?? null;
}

echo json_encode([
    'name'         => $profile['displayName'] ?? null,
    'jobTitle'     => $profile['jobTitle']    ?? null,
    'department'   => $profile['department']  ?? null,
    'email'        => $profile['mail']        ?? ($email ?: null),
    'photo'        => $photo,
    'availability' => $availability,
]);
