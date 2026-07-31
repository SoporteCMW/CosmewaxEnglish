<?php

declare(strict_types=1);

/**
 * Único punto de contacto con la API de Claude.
 *
 * La clave vive en `.env` y no sale del servidor. El cliente no envía prompts:
 * envía una `task` de una lista cerrada (ver TaskRouter) y los datos mínimos.
 *
 *   POST api/claude.php
 *   { "task": "conversation.reply", "scenarioId": "delay", "messages": [...] }
 *   { "task": "conversation.feedback", "scenarioId": "delay", "messages": [...] }
 *   { "task": "reading.passage", "topicId": "pro" }
 *
 *   200 → { "ok": true, "text": "..." }
 *   4xx/5xx → { "ok": false, "error": { "code": "...", "message": "..." } }
 */

use Cosmewax\English\Api\ValidationException;
use Cosmewax\English\Claude\ClaudeException;
use Cosmewax\English\Http\JsonResponse;
use Cosmewax\English\Support\RateLimiter;

/** @var Cosmewax\English\App $app */
$app = require dirname(__DIR__) . '/src/bootstrap.php';

if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
    header('Allow: POST');
    JsonResponse::error(405, 'method_not_allowed', 'Este endpoint sólo acepta POST.');
    exit;
}

// Cabecera que un formulario o una imagen de otro origen no puede enviar: corta
// el uso cruzado del endpoint (que cuesta dinero) sin montar tokens CSRF.
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
    $result = $app->taskRouter()->handle(JsonResponse::readBody());
    JsonResponse::ok($result);
} catch (ValidationException $e) {
    JsonResponse::error(400, 'invalid_request', $e->getMessage());
} catch (ClaudeException $e) {
    error_log(sprintf(
        '[claude] %s (%s) request_id=%s',
        $e->getMessage(),
        $e->errorCode(),
        $e->requestId() ?? 'n/d'
    ));

    // Los detalles de la API (incluido cualquier eco de credenciales) no se
    // exponen al navegador salvo en modo depuración.
    $message = match ($e->errorCode()) {
        'not_configured' => 'El servidor no tiene configurada la clave de API todavía.',
        'usage_limit' => 'La cuenta de Anthropic ha alcanzado su límite de gasto. '
            . 'Revisa los límites de uso en la consola de Anthropic.',
        'auth' => 'La clave de API no es válida o ha sido revocada.',
        'not_found' => 'El modelo configurado no existe. Revisa ANTHROPIC_MODEL en .env '
            . '(el formato lleva guiones: claude-haiku-4-5).',
        'rate_limited' => 'La API está limitando las peticiones. Espera unos segundos.',
        'overloaded', 'server_error' => 'La API está saturada ahora mismo. Reinténtalo.',
        'network' => 'No se pudo contactar con la API (fallo de red).',
        'refusal' => 'El modelo ha declinado responder a esta petición.',
        default => 'No se pudo completar la petición a la API.',
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
