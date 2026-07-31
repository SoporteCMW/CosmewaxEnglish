<?php

declare(strict_types=1);

/**
 * Diagnóstico de instalación. No llama a la API (no gasta tokens): sólo
 * comprueba que el entorno está en condiciones de llamarla.
 *
 *   GET api/health.php
 */

use Cosmewax\English\Http\JsonResponse;

/** @var Cosmewax\English\App $app */
$app = require dirname(__DIR__) . '/src/bootstrap.php';

$storage = (string) $app->config('paths.storage');

$checks = [
    'php_version' => PHP_VERSION,
    'curl' => extension_loaded('curl'),
    'openssl' => extension_loaded('openssl'),
    'mbstring' => extension_loaded('mbstring'),
    'api_key_present' => $app->hasApiKey(),
    'model' => (string) $app->config('anthropic.model'),
    'storage_writable' => is_dir($storage) ? is_writable($storage) : is_writable(dirname($storage)),
];

try {
    $checks['datasets'] = [
        'deck' => count($app->dataStore()->get('deck')),
        'scenarios' => count($app->dataStore()->get('scenarios')),
        'reading-topics' => count($app->dataStore()->get('reading-topics')),
    ];
} catch (Throwable $e) {
    $checks['datasets'] = 'error: ' . $e->getMessage();
}

$ready = $checks['curl'] === true
    && $checks['openssl'] === true
    && $checks['mbstring'] === true
    && $checks['api_key_present'] === true
    && is_array($checks['datasets']);

JsonResponse::ok(['ready' => $ready, 'checks' => $checks]);
