<?php
/**
 * FotoPerfil — configuración y carga de credenciales
 * ---------------------------------------------------
 * Lee el fichero .env (junto a este archivo) y expone las credenciales de la
 * app de Azure AD como constantes.
 *
 * IMPORTANTE: el parser QUITA las comillas que rodean el valor. Si no se hace,
 * un valor como  CLIENT_SECRET = "abc..."  entra con las comillas incluidas y
 * el token OAuth falla con `invalid_client`. (Lección aprendida en la prueba
 * previa; ver todo.md.)
 */

$envFile = __DIR__ . '/.env';
if (is_file($envFile)) {
    foreach (file($envFile, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) as $line) {
        $line = trim($line);
        if ($line === '' || $line[0] === '#' || !str_contains($line, '=')) {
            continue;
        }
        [$key, $val] = explode('=', $line, 2);
        $key = trim($key);
        $val = trim($val);
        // Quitar comillas envolventes (dobles o simples) si las hay.
        $len = strlen($val);
        if ($len >= 2 && ($val[0] === '"' || $val[0] === "'") && $val[$len - 1] === $val[0]) {
            $val = substr($val, 1, -1);
        }
        $_ENV[$key] = $val;
    }
}

define('TENANT_ID',     $_ENV['TENANT_ID']     ?? '');
define('CLIENT_ID',     $_ENV['CLIENT_ID']     ?? '');
define('CLIENT_SECRET', $_ENV['CLIENT_SECRET'] ?? '');

/** ¿Están las credenciales de Graph configuradas? */
function graph_configured(): bool
{
    return TENANT_ID !== '' && CLIENT_ID !== '' && CLIENT_SECRET !== '';
}
