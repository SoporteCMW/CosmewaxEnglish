<?php

declare(strict_types=1);

/**
 * Diagnóstico de instalación.
 *
 * Comprueba el /health del sidecar (~50 ms, gratis) pero NUNCA hace una llamada
 * de generación: este endpoint no debe costar tiempo de servidor de IA.
 *
 *   GET api/health.php
 */

use Cosmewax\English\Http\JsonResponse;

/** @var Cosmewax\English\App $app */
$app = require dirname(__DIR__) . '/src/bootstrap.php';

$storage = (string) $app->config('paths.storage');
$provider = $app->provider();

$checks = [
    'php_version' => PHP_VERSION,
    'curl' => extension_loaded('curl'),
    'openssl' => extension_loaded('openssl'),
    'mbstring' => extension_loaded('mbstring'),
    'storage_writable' => is_dir($storage) ? is_writable($storage) : is_writable(dirname($storage)),
    'ai_provider' => $provider,
    'ai_configured' => $app->aiConfigured(),
];

if ($provider === 'sidecar') {
    $checks['sidecar_enabled'] = (bool) $app->config('sidecar.enabled', false);
    $checks['sidecar_model'] = (string) $app->config('sidecar.model');
    // La URL sólo se revela en depuración: no tiene que aparecer en el HTML ni
    // en respuestas normales servidas al navegador.
    if ($app->isDebug()) {
        $checks['sidecar_url'] = (string) $app->config('sidecar.url');
    }
    $checks['sidecar_reachable'] = $app->aiReachable();
} else {
    $checks['anthropic_key_present'] = $app->aiConfigured();
    $checks['anthropic_model'] = (string) $app->config('anthropic.model');
}

// Base de datos. `db_fallback` a true significa que la aplicación está viva
// pero sirviendo el catálogo de los JSON: funciona, y el progreso no se guarda.
$checks['db_host'] = (string) $app->config('db.host');
$checks['db_name'] = (string) $app->config('db.name');
$checks['db_reachable'] = $app->dbReachable();

try {
    $content = $app->content();
    $checks['datasets'] = [
        'deck' => count($content->cards()),
        'grammar' => count($content->grammar()),
        'scenarios' => count($content->scenarios()),
        'profiles' => count($content->profiles()),
        'reading-topics' => count($content->readingTopics()),
        'card-categories' => count($content->cardCategories()),
        'scenario-groups' => count($content->scenarioGroups()),
        'minimal-pairs' => count($content->minimalPairGroups()),
    ];
    $checks['db_fallback'] = $content->usedFallback();
    $checks['generated_scenarios'] = count($app->scenarioStore()->all());
} catch (Throwable $e) {
    $checks['datasets'] = 'error: ' . $e->getMessage();
}

$aiReady = $provider === 'sidecar'
    ? ($checks['sidecar_reachable'] ?? false) === true
    : $checks['ai_configured'] === true;

$ready = $checks['curl'] === true
    && $checks['mbstring'] === true
    && is_array($checks['datasets']);

JsonResponse::ok([
    // La app arranca aunque la IA esté caída: Tarjetas, Gramática y
    // Pronunciación son locales.
    'ready' => $ready,
    'ai_ready' => $aiReady,
    'checks' => $checks,
]);
