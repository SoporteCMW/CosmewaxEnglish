<?php

declare(strict_types=1);

use Cosmewax\English\Support\Env;

/**
 * Configuración de la aplicación. Todo lo ajustable vive aquí o en `.env`;
 * ningún valor de este tipo debe aparecer incrustado en el código ni en el JS.
 */
return [
    'app' => [
        'name' => 'English Unblocked',
        'owner' => 'Cosmewax · I+D / PDM',
        'debug' => Env::bool('APP_DEBUG', false),
    ],

    'anthropic' => [
        'api_key' => Env::get('ANTHROPIC_API_KEY'),
        'base_url' => Env::get('ANTHROPIC_BASE_URL', 'https://api.anthropic.com'),

        // Modelo global. `claude-haiku-4-5` es el más barato y rápido del
        // catálogo actual ($1/$5 por millón de tokens). OJO con el formato del
        // ID: guiones, no puntos (`claude-haiku-4-5`, no `claude-haiku-4.5`).
        // Alternativas: `claude-sonnet-5` (equilibrio), `claude-opus-5` (máxima
        // calidad). Ver README § Modelos.
        'model' => Env::get('ANTHROPIC_MODEL', 'claude-haiku-4-5'),

        'timeout' => Env::int('ANTHROPIC_TIMEOUT', 120),

        // Reintento automático en un modelo de respaldo si los clasificadores
        // de seguridad declinan la petición. Sin esto, un rechazo se queda en
        // un error visible para el alumno.
        'use_fallbacks' => Env::bool('ANTHROPIC_USE_FALLBACKS', true),
    ],

    /**
     * Ajustes por tarea.
     *
     * `model` vacío = usa el modelo global. Se puede subir sólo una tarea: el
     * feedback se genera una vez por llamada, así que ponerle un modelo mejor
     * apenas mueve la factura mientras la conversación (muchos turnos) sigue en
     * el modelo barato. Ejemplo en `.env`: MODEL_FEEDBACK=claude-sonnet-5
     *
     * `effort` se ignora automáticamente en los modelos que no lo soportan
     * (Haiku 4.5, Sonnet 4.5) — ver ModelCapabilities.
     *
     * `max_tokens` es un techo, no un gasto: se factura lo que se genera.
     */
    'tasks' => [
        'conversation.reply' => [
            'model' => Env::get('MODEL_CONVERSATION', ''),
            'effort' => Env::get('EFFORT_CONVERSATION', 'low'),
            'max_tokens' => 8000,
        ],
        'conversation.feedback' => [
            'model' => Env::get('MODEL_FEEDBACK', ''),
            'effort' => Env::get('EFFORT_FEEDBACK', 'medium'),
            'max_tokens' => 8000,
        ],
        'reading.passage' => [
            'model' => Env::get('MODEL_READING', ''),
            'effort' => Env::get('EFFORT_READING', 'low'),
            'max_tokens' => 8000,
        ],
    ],

    'rate_limit' => [
        'max_requests' => Env::int('RATE_LIMIT_MAX', 60),
        'window_seconds' => Env::int('RATE_LIMIT_WINDOW', 300),
    ],

    'paths' => [
        'data' => BASE_PATH . '/data',
        'storage' => BASE_PATH . '/storage',
    ],
];
