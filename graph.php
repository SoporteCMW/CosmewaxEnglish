<?php
declare(strict_types=1);

/**
 * graph.php — helper de Microsoft Graph para el esqueleto
 * -------------------------------------------------------
 * Obtiene, para un usuario del tenant, sus datos de directorio y su foto de
 * perfil usando el flujo client-credentials (permiso de aplicación).
 *
 * La idea está tomada del sub-proyecto FotoPerfil, PERO aquí se usa solo para
 * el usuario autenticado en la sesión (no se expone ningún endpoint público que
 * permita volcar la foto de cualquiera) y el resultado se cachea en la sesión
 * para no llamar a Graph en cada carga de página.
 *
 * Variables en el .env (todas OPCIONALES — si faltan, la feature se desactiva
 * sola y la topbar cae al icono genérico + usuario de red):
 *   GRAPH_TENANT_ID      (o TENANT_ID)
 *   GRAPH_CLIENT_ID      (o CLIENT_ID)
 *   GRAPH_CLIENT_SECRET  (o CLIENT_SECRET)
 *   GRAPH_UPN_DOMAIN     dominio para construir el UPN a partir del usuario AD
 */

/** Lee un .env quitando comillas y espacios envolventes del valor. */
function graph_read_env(string $path): array
{
    $vars = [];
    if (!is_file($path)) {
        return $vars;
    }
    foreach (file($path, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) as $line) {
        $line = trim($line);
        if ($line === '' || $line[0] === '#' || !str_contains($line, '=')) {
            continue;
        }
        [$key, $val] = explode('=', $line, 2);
        $vars[trim($key)] = trim(trim($val), '"\'');
    }
    return $vars;
}

/** Devuelve la config de Graph a partir del .env indicado. */
function graph_config(string $envPath): array
{
    $env = graph_read_env($envPath);
    return [
        'tenant'    => $env['GRAPH_TENANT_ID']     ?? $env['TENANT_ID']     ?? '',
        'client'    => $env['GRAPH_CLIENT_ID']     ?? $env['CLIENT_ID']     ?? '',
        'secret'    => $env['GRAPH_CLIENT_SECRET'] ?? $env['CLIENT_SECRET'] ?? '',
        'upnDomain' => $env['GRAPH_UPN_DOMAIN']    ?? '',
    ];
}

/** ¿Están las credenciales mínimas de Graph configuradas? */
function graph_is_configured(array $cfg): bool
{
    return $cfg['tenant'] !== '' && $cfg['client'] !== '' && $cfg['secret'] !== '';
}

/** Token de aplicación (client credentials). Devuelve null si falla. */
function graph_token(array $cfg): ?string
{
    $ch = curl_init('https://login.microsoftonline.com/' . $cfg['tenant'] . '/oauth2/v2.0/token');
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_POST           => true,
        CURLOPT_POSTFIELDS     => http_build_query([
            'grant_type'    => 'client_credentials',
            'client_id'     => $cfg['client'],
            'client_secret' => $cfg['secret'],
            'scope'         => 'https://graph.microsoft.com/.default',
        ]),
        CURLOPT_HTTPHEADER => ['Content-Type: application/x-www-form-urlencoded'],
        CURLOPT_TIMEOUT    => 8,
    ]);
    $body = curl_exec($ch);
    curl_close($ch);

    $data = json_decode((string) $body, true) ?: [];
    return $data['access_token'] ?? null;
}

/** GET a Graph con Bearer token. Devuelve ['code' => int, 'body' => string]. */
function graph_get(string $url, string $token, array $extraHeaders = []): array
{
    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_HTTPHEADER     => array_merge(["Authorization: Bearer {$token}"], $extraHeaders),
        CURLOPT_TIMEOUT        => 8,
    ]);
    $body = curl_exec($ch);
    $code = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);

    return ['code' => $code, 'body' => (string) $body];
}

/**
 * Perfil + foto de un usuario del tenant a partir de su UPN o email.
 *
 * @return array|null  ['name','jobTitle','department','email','photo'(data URI|null),
 *                       'availability'(solo si $withPresence)] o null si no se pudo obtener.
 */
function graph_fetch_profile(array $cfg, string $upn, bool $withPresence = false): ?array
{
    if (!graph_is_configured($cfg) || !extension_loaded('curl')) {
        return null;
    }

    $token = graph_token($cfg);
    if ($token === null) {
        return null;
    }

    // ── Perfil ────────────────────────────────────────────────────────────────
    $fields = 'displayName,jobTitle,department,mail,id';
    $resp   = graph_get(
        'https://graph.microsoft.com/v1.0/users/' . rawurlencode($upn) . '?$select=' . $fields,
        $token
    );
    if ($resp['code'] !== 200) {
        return null;
    }

    $p = json_decode($resp['body'], true) ?: [];
    if (empty($p['id'])) {
        return null;
    }

    // ── Foto ──────────────────────────────────────────────────────────────────
    $photoResp = graph_get("https://graph.microsoft.com/v1.0/users/{$p['id']}/photo/\$value", $token);
    $photo     = ($photoResp['code'] === 200 && $photoResp['body'] !== '')
        ? 'data:image/jpeg;base64,' . base64_encode($photoResp['body'])
        : null;

    $out = [
        'name'       => $p['displayName'] ?? null,
        'jobTitle'   => $p['jobTitle']    ?? null,
        'department' => $p['department']  ?? null,
        'email'      => $p['mail']        ?? null,
        'photo'      => $photo,
    ];

    // ── Presencia (opcional) ────────────────────────────────────────────────────
    if ($withPresence) {
        $pr = graph_get("https://graph.microsoft.com/v1.0/users/{$p['id']}/presence", $token);
        $out['availability'] = ($pr['code'] === 200)
            ? (json_decode($pr['body'], true)['availability'] ?? null)
            : null;
    }

    return $out;
}
