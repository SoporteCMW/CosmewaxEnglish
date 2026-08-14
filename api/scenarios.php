<?php

declare(strict_types=1);

/**
 * Biblioteca de escenarios generados por IA.
 *
 * Viven en el servidor porque su `context` es material de prompt (ver
 * GeneratedScenarioRepository). El navegador sólo maneja ids y la proyección segura.
 *
 *   GET  api/scenarios.php            → { ok:true, scenarios:[...] }  (sin context)
 *   POST api/scenarios.php {id:"..."} → borra uno
 */

use Cosmewax\English\Http\JsonResponse;

/** @var Cosmewax\English\App $app */
$app = require dirname(__DIR__) . '/src/bootstrap.php';

// Sesion antes que cualquier otra cosa: sin usuario autenticado no se llama al
// servidor de IA ni se toca la BD. Devuelve 401 JSON, no un redirect: un
// `Location:` en respuesta a fetch() daria un 200 con el HTML del login.
Cosmewax\English\Support\Session::requireApi((bool) $app->config('app.login', true));

if (($_SERVER['HTTP_X_REQUESTED_WITH'] ?? '') !== 'CosmewaxEnglish') {
    JsonResponse::error(403, 'forbidden', 'Petición no reconocida.');
    exit;
}

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
$store = $app->scenarioStore();

try {
    if ($method === 'GET') {
        JsonResponse::ok(['scenarios' => $store->clientView()]);
        exit;
    }

    if ($method === 'POST') {
        $body = JsonResponse::readBody();
        $id = is_string($body['id'] ?? null) ? $body['id'] : '';
        if ($id === '') {
            JsonResponse::error(400, 'invalid_request', 'Falta el id del escenario.');
            exit;
        }
        $removed = $store->remove($id);
        JsonResponse::ok(['removed' => $removed, 'scenarios' => $store->clientView()]);
        exit;
    }

    header('Allow: GET, POST');
    JsonResponse::error(405, 'method_not_allowed', 'Método no admitido.');
} catch (Throwable $e) {
    error_log('[scenarios] ' . $e->getMessage());
    JsonResponse::error(
        500,
        'internal_error',
        $app->isDebug() ? $e->getMessage() : 'No se pudo acceder a los escenarios generados.'
    );
}
