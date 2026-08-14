<?php

declare(strict_types=1);

/**
 * Progreso del alumno.
 *
 *   GET                        → todo el progreso del usuario de la sesión
 *   POST {key, value}          → guarda una clave
 *   POST {key, remove: true}   → borra una clave
 *
 * El usuario NO viaja en la petición: sale de la sesión. Aceptarlo del cliente
 * dejaría que cualquiera leyera o pisara el progreso de otro con sólo cambiar
 * un campo del JSON.
 *
 * Si la BD no responde, GET devuelve un progreso vacío con `persisted: false` y
 * POST responde 200 con `persisted: false`. Deliberadamente no es un error: la
 * sesión de estudio continúa en memoria y el cliente avisa una sola vez de que
 * no se está guardando. Cortar la práctica porque CMW0090 esté reiniciándose
 * sería peor que perder el progreso de esa sesión.
 */

use Cosmewax\English\Db\ProgressRepository;
use Cosmewax\English\Http\JsonResponse;
use Cosmewax\English\Support\Session;

/** @var Cosmewax\English\App $app */
$app = require dirname(__DIR__) . '/src/bootstrap.php';

Session::requireApi((bool) $app->config('app.login', true));

if (($_SERVER['HTTP_X_REQUESTED_WITH'] ?? '') !== 'CosmewaxEnglish') {
    JsonResponse::error(403, 'forbidden', 'Petición no reconocida.');
    exit;
}

$loginOn = (bool) $app->config('app.login', true);
$user = Session::user($loginOn);
$progress = $app->progress();
$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

if ($method === 'GET') {
    // Registrar al usuario aquí y no en index.php: es la primera petición que
    // hace la aplicación al arrancar, y así `app_user` refleja uso real y no
    // simples cargas de página.
    $progress->touchUser($user);

    JsonResponse::ok([
        'persisted' => $progress->available(),
        // Cast a objeto: sin progreso, un array PHP vacío se serializaría como
        // `[]` y el cliente espera siempre un mapa de clave a valor.
        'state' => (object) $progress->all($user),
    ]);
    exit;
}

if ($method !== 'POST') {
    header('Allow: GET, POST');
    JsonResponse::error(405, 'method_not_allowed', 'Método no permitido.');
    exit;
}

$body = JsonResponse::readBody();
$key = (string) ($body['key'] ?? '');

if (!ProgressRepository::isValidKey($key)) {
    JsonResponse::error(400, 'invalid_key', 'Clave de progreso no reconocida.');
    exit;
}

if (!empty($body['remove'])) {
    $progress->remove($user, $key);
    JsonResponse::ok(['persisted' => $progress->available(), 'key' => $key]);
    exit;
}

if (!array_key_exists('value', $body)) {
    JsonResponse::error(400, 'missing_value', 'Falta el valor a guardar.');
    exit;
}

$progress->touchUser($user);
$saved = $progress->put($user, $key, $body['value']);

JsonResponse::ok([
    'persisted' => $saved,
    'key' => $key,
]);
