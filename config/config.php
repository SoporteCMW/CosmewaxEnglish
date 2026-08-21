<?php

declare(strict_types=1);

use Cosmewax\English\Support\Env;

/**
 * Configuración de la aplicación. Todo lo ajustable vive aquí o en `.env`;
 * ningún valor de este tipo debe aparecer incrustado en el código ni en el JS.
 */
return [
    'app' => [
        // APP_NAME y APP_ENVIRONMENT son los mismos nombres que usan el resto de
        // aplicaciones de la casa, para que el login y la topbar muestren lo
        // mismo sin duplicar la lectura del .env.
        'name' => Env::get('APP_NAME', 'English Unblocked'),
        'owner' => 'Cosmewax · I+D / PDM',
        'environment' => Env::get('APP_ENVIRONMENT', 'Desarrollo'),
        // LOGIN_ON=false salta el login: sólo para desarrollo en local. Sin
        // usuario autenticado el progreso va contra una cuenta compartida.
        'login' => Env::bool('LOGIN_ON', true),
        'debug' => Env::bool('APP_DEBUG', false),
    ],

    'ai' => [
        // sidecar → claude-sidecar interno, sin claves (modo normal)
        // anthropic → API pública, requiere ANTHROPIC_API_KEY
        'provider' => Env::get('AI_PROVIDER', 'sidecar'),
    ],

    /**
     * claude-sidecar interno. Solo accesible desde la red 10.0.x.x y sólo desde
     * el backend: el puerto 5060 está en la lista de "bad ports" de fetch, así
     * que el navegador no puede llamarlo ni por error.
     */
    'sidecar' => [
        'enabled' => Env::bool('IA_CLI', false),
        'url' => Env::get('IA_CLI_URL', 'http://10.0.70.32:5060/claude'),
        'model' => Env::get('IA_CLI_MODEL', 'claude-sonnet-4-6'),
        'timeout' => Env::int('IA_CLI_TIMEOUT', 120),
    ],

    'anthropic' => [
        'api_key' => Env::get('ANTHROPIC_API_KEY'),
        'base_url' => Env::get('ANTHROPIC_BASE_URL', 'https://api.anthropic.com'),
        // OJO con el formato del ID: guiones, no puntos (claude-haiku-4-5).
        'model' => Env::get('ANTHROPIC_MODEL', 'claude-haiku-4-5'),
        'timeout' => Env::int('ANTHROPIC_TIMEOUT', 120),
        'use_fallbacks' => Env::bool('ANTHROPIC_USE_FALLBACKS', true),
    ],

    /**
     * Ajustes por tarea. Cada cliente usa lo que entiende y omite el resto:
     *   - `timeout`     → segundos, lo usa el sidecar (tabla de tiempos reales
     *                     medidos en la referencia del servicio).
     *   - `effort`      → sólo API pública, y sólo en modelos que lo soportan.
     *   - `max_tokens`  → sólo API pública. Es un techo, no un gasto.
     *   - `model`       → sólo API pública; vacío = modelo global.
     */
    'tasks' => [
        'conversation.reply' => [
            'timeout' => 45,
            'model' => Env::get('MODEL_CONVERSATION', ''),
            'effort' => Env::get('EFFORT_CONVERSATION', 'low'),
            'max_tokens' => 8000,
        ],
        'conversation.feedback' => [
            'timeout' => 90,
            'model' => Env::get('MODEL_FEEDBACK', ''),
            'effort' => Env::get('EFFORT_FEEDBACK', 'medium'),
            'max_tokens' => 8000,
        ],
        'reading.passage' => [
            // Un texto de 350-400 palabras: se lee en voz alta durante varios
            // minutos, así que también tarda más en generarse que el de antes.
            'timeout' => 120,
            'model' => Env::get('MODEL_READING', ''),
            'effort' => Env::get('EFFORT_READING', 'low'),
            'max_tokens' => 8000,
        ],
        // Pasaje de 500-600 palabras (largo de B2 First) más seis preguntas: es
        // bastante más texto que el resto de generaciones, de ahí el margen.
        'listening.passage' => ['timeout' => 150, 'effort' => 'low', 'max_tokens' => 8000],
        'listening.grade' => ['timeout' => 60, 'effort' => 'low', 'max_tokens' => 4000],
        // Corregir una tarjeta o un ejercicio de gramática: una frase de entrada y
        // otra de salida. Son las llamadas más cortas de la app y también, de
        // lejos, las más frecuentes — una por cada respuesta repasada —, así que el
        // timeout es corto a propósito: si el servidor de IA no contesta en 45 s,
        // el modo cae al diff de texto y sigue repasando en lugar de esperar.
        'flashcards.grade' => ['timeout' => 45, 'effort' => 'low', 'max_tokens' => 2000],
        'grammar.grade' => ['timeout' => 45, 'effort' => 'low', 'max_tokens' => 2000],
        'notebook.lookup' => ['timeout' => 45, 'effort' => 'low', 'max_tokens' => 2000],
        // 30 términos con ejemplo: es la llamada más larga de la app.
        'vocab.generate' => ['timeout' => 150, 'effort' => 'low', 'max_tokens' => 8000],
        'scenario.generate' => ['timeout' => 90, 'effort' => 'low', 'max_tokens' => 4000],
        'scenario.everyday' => ['timeout' => 90, 'effort' => 'low', 'max_tokens' => 4000],
        // Cinco pares de palabras: la respuesta más corta de toda la aplicación.
        'pron.pairs' => ['timeout' => 60, 'effort' => 'low', 'max_tokens' => 2000],
    ],

    'rate_limit' => [
        'max_requests' => Env::int('RATE_LIMIT_MAX', 60),
        'window_seconds' => Env::int('RATE_LIMIT_WINDOW', 300),
    ],

    // Autenticación integrada de Windows: sin usuario ni contraseña, se usa la
    // identidad del proceso Apache. Ver .env.example para el detalle.
    'db' => [
        'host' => Env::get('DB_HOST_DEV', 'CMW0090'),
        'name' => Env::get('DB_NAME', 'CosmewaxEnglish'),
    ],

    'paths' => [
        'data' => BASE_PATH . '/data',
        'storage' => BASE_PATH . '/storage',
    ],
];
