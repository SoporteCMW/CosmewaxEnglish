<?php

declare(strict_types=1);

/**
 * Shell de la aplicación.
 *
 * El HTML aquí es sólo estructura: cada modo se renderiza en su contenedor
 * desde `assets/js/modes/*.js`. Los datos de contenido se inyectan una única
 * vez como JSON (`window.__APP__`) para no encadenar peticiones al arrancar,
 * y se proyectan a una versión segura para el cliente: los prompts y el
 * `context` de cada escenario no salen del servidor.
 */

/** @var Cosmewax\English\App $app */
$app = require __DIR__ . '/src/bootstrap.php';

$store = $app->dataStore();
$bootError = null;

try {
    /** @var array<int,array<string,mixed>> $deck */
    $deck = $store->get('deck');
    /** @var array<int,array<string,mixed>> $categories */
    $categories = $store->get('card-categories');
    /** @var array<int,array<string,mixed>> $scenarioGroups */
    $scenarioGroups = $store->get('scenario-groups');
    /** @var array<int,array<string,mixed>> $readingTopics */
    $readingTopics = $store->get('reading-topics');

    // Proyección cliente: sin `context` (sólo se usa para construir el prompt).
    $scenarios = array_map(
        static fn (array $s): array => [
            'id' => $s['id'] ?? '',
            'category' => $s['category'] ?? '',
            'initiator' => $s['initiator'] ?? 'assistant',
            'title' => $s['title'] ?? '',
            'desc' => $s['desc'] ?? '',
            'opening' => $s['opening'] ?? null,
            'guide' => $s['guide'] ?? null,
        ],
        $store->get('scenarios')
    );

    $topics = array_map(
        static fn (array $t): array => [
            'id' => $t['id'] ?? '',
            'title' => $t['title'] ?? '',
            'desc' => $t['desc'] ?? '',
        ],
        $readingTopics
    );
} catch (Throwable $e) {
    $bootError = $e->getMessage();
    $deck = $categories = $scenarios = $scenarioGroups = $topics = [];
}

$bootstrap = [
    'apiUrl' => 'api/claude.php',
    'apiToken' => 'CosmewaxEnglish', // cabecera X-Requested-With esperada por el endpoint
    'storageNamespace' => 'cosmewax-english:v1',
    'apiConfigured' => $app->hasApiKey(),
    'deck' => $deck,
    'categories' => $categories,
    'scenarios' => $scenarios,
    'scenarioGroups' => $scenarioGroups,
    'readingTopics' => $topics,
];

$appName = (string) $app->config('app.name', 'English Unblocked');
$owner = (string) $app->config('app.owner', '');
$deckCount = count($deck);

function e(string $value): string
{
    return htmlspecialchars($value, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
}
?>
<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title><?= e($appName) ?></title>
<link rel="stylesheet" href="assets/css/tokens.css">
<link rel="stylesheet" href="assets/css/base.css">
<link rel="stylesheet" href="assets/css/components.css">
<link rel="stylesheet" href="assets/css/flashcards.css">
<link rel="stylesheet" href="assets/css/conversation.css">
<link rel="stylesheet" href="assets/css/reading.css">
</head>
<body>
<div class="sheet">
  <header class="letterhead">
    <h1><?= e($appName) ?></h1>
    <div class="ref"><?= e($owner) ?><br>Banco inicial — <?= $deckCount ?> fichas</div>
  </header>

  <?php if ($bootError !== null): ?>
    <div class="alert alert-error">
      No se pudieron cargar los datos de la aplicación<?= $app->isDebug() ? ': ' . e($bootError) : '.' ?>
    </div>
  <?php endif; ?>

  <?php if (!$app->hasApiKey()): ?>
    <div class="alert alert-warn" id="apiKeyWarning">
      <strong>Falta la API key.</strong> Las tarjetas funcionan sin ella, pero los modos
      <em>Conversación</em> y <em>Lectura</em> necesitan Claude. Copia <code>.env.example</code> a
      <code>.env</code>, añade <code>ANTHROPIC_API_KEY</code> y recarga.
      Comprobación: <a href="api/health.php" target="_blank" rel="noopener">api/health.php</a>
    </div>
  <?php endif; ?>

  <nav class="mode-toggle" id="modeToggle" aria-label="Modos de práctica">
    <button type="button" class="mode-btn is-active" data-mode="flashcards">📇 Tarjetas</button>
    <button type="button" class="mode-btn" data-mode="conversation">💬 Conversación</button>
    <button type="button" class="mode-btn" data-mode="reading">📖 Lectura</button>
  </nav>

  <section id="flashcardsView" class="mode-view">
    <p class="subline">Recall activo espaciado · español → inglés · responde antes de ver la solución</p>

    <div class="stats-row" id="statsRow"></div>
    <div class="voice-panel" id="voicePanel"></div>
    <div class="tabs" id="tabs"></div>
    <div class="card-zone" id="cardZone">
      <div class="loading">Cargando banco de tarjetas…</div>
    </div>

    <details class="add-form">
      <summary>+ Añadir tarjeta nueva</summary>
      <form class="add-form-inner" id="addCardForm" autocomplete="off">
        <div>
          <label for="newCat">Categoría</label>
          <select id="newCat" name="cat"></select>
        </div>
        <div>
          <label for="newEs">Español (frente)</label>
          <input id="newEs" name="es" type="text" placeholder="ej. plazo de entrega" required>
        </div>
        <div>
          <label for="newEn">Inglés (respuesta)</label>
          <input id="newEn" name="en" type="text" placeholder="ej. lead time" required>
        </div>
        <div>
          <label for="newNote">Nota / ejemplo (opcional)</label>
          <textarea id="newNote" name="note" placeholder="ej. 'What's the lead time on this batch?'"></textarea>
        </div>
        <button class="add-btn" type="submit">Guardar tarjeta</button>
        <p class="form-msg" id="addCardMsg" role="status"></p>
      </form>
    </details>

    <footer class="footnote">
      Sistema Leitner (5 niveles). Fallar una tarjeta la devuelve al nivel 1. Los puntos junto a la
      categoría muestran el nivel de dominio.
      <br><button type="button" class="reset-link" id="resetProgress">Reiniciar progreso (mantiene las tarjetas)</button>
    </footer>
  </section>

  <section id="conversationView" class="mode-view" hidden>
    <p class="subline">Simulacro de llamada de 3-5 min · el interlocutor responde de forma dinámica a lo que digas</p>
    <div class="conv-stats-row" id="convStatsRow"></div>
    <div id="convBody"></div>
  </section>

  <section id="readingView" class="mode-view" hidden>
    <p class="subline">Claude te da un texto · lo lees en voz alta · al final corrige las palabras que no se entendieron bien</p>
    <div class="read-stats-row" id="readStatsRow"></div>
    <div id="readBody"></div>
  </section>
</div>

<script>
  window.__APP__ = <?= json_encode($bootstrap, JSON_UNESCAPED_UNICODE | JSON_HEX_TAG | JSON_HEX_AMP | JSON_HEX_APOS | JSON_HEX_QUOT) ?>;
</script>
<script type="module" src="assets/js/main.js"></script>
</body>
</html>
