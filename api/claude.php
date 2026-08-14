<?php

declare(strict_types=1);

/**
 * Único punto de contacto con la IA.
 *
 * El cliente no envía prompts: envía una `task` de una lista cerrada (ver
 * TaskRouter) y los datos mínimos. Detrás puede estar el claude-sidecar interno
 * o la API pública de Anthropic; el navegador no sabe cuál ni conoce su URL.
 *
 *   POST api/claude.php
 *   { "task": "conversation.reply",   "scenarioId": "delay", "messages": [...] }
 *   { "task": "conversation.feedback","scenarioId": "delay", "messages": [...] }
 *   { "task": "reading.passage",      "topicId": "pro", "profileId": "rd" }
 *   { "task": "listening.passage",    "topicId": "pro", "profileId": "rd" }
 *   { "task": "listening.grade",      "passage": "...", "question": "...", "answer": "..." }
 *   { "task": "notebook.lookup",      "word": "batch", "context": "..." }
 *   { "task": "vocab.generate",       "profileId": "rd", "existingTerms": [...] }
 *   { "task": "scenario.generate",    "profileId": "rd" }
 *
 *   200 → { "ok": true, ...datos de la tarea }
 *   4xx/5xx → { "ok": false, "error": { "code": "...", "message": "..." } }
 */

use Cosmewax\English\Api\UnusableResponseException;
use Cosmewax\English\Api\ValidationException;
use Cosmewax\English\Claude\ClaudeException;
use Cosmewax\English\Http\JsonResponse;
use Cosmewax\English\Support\RateLimiter;

/** @var Cosmewax\English\App $app */
$app = require dirname(__DIR__) . '/src/bootstrap.php';

// Sesion antes que cualquier otra cosa: sin usuario autenticado no se llama al
// servidor de IA ni se toca la BD. Devuelve 401 JSON, no un redirect: un
// `Location:` en respuesta a fetch() daria un 200 con el HTML del login.
Cosmewax\English\Support\Session::requireApi((bool) $app->config('app.login', true));

if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
    header('Allow: POST');
    JsonResponse::error(405, 'method_not_allowed', 'Este endpoint sólo acepta POST.');
    exit;
}

// Cabecera que un formulario o una imagen de otro origen no puede enviar: corta
// el uso cruzado del endpoint sin montar tokens CSRF.
if (($_SERVER['HTTP_X_REQUESTED_WITH'] ?? '') !== 'CosmewaxEnglish') {
    JsonResponse::error(403, 'forbidden', 'Petición no reconocida.');
    exit;
}

$origin = $_SERVER['HTTP_ORIGIN'] ?? '';
if (is_string($origin) && $origin !== '') {
    $host = $_SERVER['HTTP_HOST'] ?? '';
    $originHost = parse_url($origin, PHP_URL_HOST);
    $originPort = parse_url($origin, PHP_URL_PORT);
    $expected = $originHost . ($originPort !== null ? ':' . $originPort : '');
    if ($originHost !== null && $expected !== $host && $originHost !== $host) {
        JsonResponse::error(403, 'forbidden', 'Origen no permitido.');
        exit;
    }
}

// El servidor de IA lanza un proceso por llamada: sin tope, una pestaña en bucle
// lo satura para todos los proyectos que lo comparten.
$limit = $app->rateLimiter()->hit(RateLimiter::clientKey());
if (!$limit['allowed']) {
    JsonResponse::error(
        429,
        'rate_limited',
        'Demasiadas peticiones seguidas. Espera unos segundos y reinténtalo.',
        ['Retry-After' => $limit['retryAfter']]
    );
    exit;
}

try {
    JsonResponse::ok($app->taskRouter()->handle(JsonResponse::readBody()));
} catch (ValidationException $e) {
    JsonResponse::error(400, 'invalid_request', $e->getMessage());
} catch (UnusableResponseException $e) {
    // Respondió, pero no sirve. Reintentar suele funcionar.
    error_log('[ai] respuesta no utilizable: ' . $e->getMessage());
    JsonResponse::error(502, 'unusable_response', $e->getMessage() . ' Puedes reintentarlo.');
} catch (ClaudeException $e) {
    error_log(sprintf(
        '[ai] %s (%s) request_id=%s',
        $e->getMessage(),
        $e->errorCode(),
        $e->requestId() ?? 'n/d'
    ));

    // Los detalles del servicio no se exponen al navegador salvo en depuración:
    // ni la URL del sidecar, ni ecos de credenciales de la API pública.
    $message = match ($e->errorCode()) {
        'not_configured' => 'Los modos con IA están desactivados en el servidor. '
            . 'Tarjetas y Gramática funcionan igual.',
        'sidecar_forbidden' => 'El servidor de IA sólo acepta peticiones desde la red interna de Cosmewax.',
        'timeout' => 'El servidor de IA ha tardado demasiado. Reinténtalo.',
        'usage_limit' => 'La cuenta de Anthropic ha alcanzado su límite de gasto.',
        'auth' => 'Las credenciales de la API no son válidas.',
        'not_found' => 'El modelo configurado no existe. Revisa el modelo en .env.',
        'rate_limited' => 'El servicio está limitando las peticiones. Espera unos segundos.',
        'overloaded', 'server_error' => 'El servidor de IA no está disponible ahora mismo. Reinténtalo.',
        'network' => 'No se pudo contactar con el servidor de IA.',
        'refusal' => 'El modelo ha declinado responder a esta petición.',
        default => 'No se pudo completar la petición a la IA.',
    };

    JsonResponse::error(
        $e->httpStatus(),
        $e->errorCode(),
        $app->isDebug() ? $e->getMessage() : $message,
        $e->isRetryable() ? ['Retry-After' => 5] : []
    );
} catch (Throwable $e) {
    error_log('[app] ' . $e->getMessage() . ' @ ' . $e->getFile() . ':' . $e->getLine());
    JsonResponse::error(
        500,
        'internal_error',
        $app->isDebug() ? $e->getMessage() : 'Error interno del servidor.'
    );
}
