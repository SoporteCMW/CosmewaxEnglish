<?php

declare(strict_types=1);

/**
 * Shell de la aplicación.
 *
 * El HTML aquí es sólo estructura: cada modo se renderiza en su contenedor desde
 * `assets/js/modes/*.js`. Los datos de contenido se inyectan una única vez como
 * JSON (`window.__APP__`) para no encadenar peticiones al arrancar, y se
 * proyectan a una versión segura: el `context` de los escenarios y los `*Hint`
 * de los perfiles son material de prompt y no salen del servidor.
 *
 * A propósito NO se comprueba aquí si el servidor de IA responde: sondearlo
 * costaría hasta 5 s de espera en cada carga si estuviera caído. La página se
 * dibuja siempre, y el primer uso de un modo con IA informa del problema.
 */

/** @var Cosmewax\English\App $app */
$app = require __DIR__ . '/src/bootstrap.php';

// Puerta de sesión antes de cualquier trabajo: si no hay login válido no tiene
// sentido consultar la BD ni Graph.
$loginOn = (bool) $app->config('app.login', true);
Cosmewax\English\Support\Session::requirePage($loginOn);

// Los catálogos salen de SQL Server; si no responde, el repositorio cae solo a
// los JSON de `data/` y la página se dibuja igual.
$content = $app->content();
$bootError = null;
$deck = $categories = $scenarios = $scenarioGroups = $topics = $grammar = $profiles = $generated = [];
$minimalPairs = [];

try {
    $deck = $content->cards();
    $categories = $content->cardCategories();
    $scenarioGroups = $content->scenarioGroups();
    $grammar = $content->grammar();
    // Los pares mínimos van enteros: no hay nada de prompt en ellos, y el modo
    // corrige en el navegador comparando con el reconocedor de voz.
    $minimalPairs = $content->minimalPairGroups();

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
        $content->scenarios()
    );

    // Proyección cliente: sólo id y etiqueta. topicHint/vocabHint/scenarioHint
    // son prompts y se quedan en el servidor.
    $profiles = array_map(
        static fn (array $p): array => ['id' => $p['id'] ?? '', 'label' => $p['label'] ?? ''],
        $content->profiles()
    );

    // Igual con `prompt`, que es material de prompt del tema de lectura.
    $topics = array_map(
        static fn (array $t): array => [
            'id' => $t['id'] ?? '',
            'title' => $t['title'] ?? '',
            'desc' => $t['desc'] ?? '',
        ],
        $content->readingTopics()
    );

    $generated = $app->scenarioStore()->clientView();
} catch (Throwable $e) {
    $bootError = $e->getMessage();
}

$bootstrap = [
    'apiUrl' => 'api/claude.php',
    'scenariosUrl' => 'api/scenarios.php',
    'stateUrl' => 'api/state.php',
    'apiToken' => 'CosmewaxEnglish', // cabecera X-Requested-With esperada por el endpoint
    'aiConfigured' => $app->aiConfigured(),
    'deck' => $deck,
    'categories' => $categories,
    'scenarios' => $scenarios,
    'scenarioGroups' => $scenarioGroups,
    'generatedScenarios' => $generated,
    'readingTopics' => $topics,
    'grammar' => $grammar,
    'profiles' => $profiles,
    'minimalPairs' => $minimalPairs,
];

$appName = (string) $app->config('app.name', 'English Unblocked');
$owner = (string) $app->config('app.owner', '');
$appEnvironment = (string) $app->config('app.environment', 'Desarrollo');

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
<title><?= e($appName) ?> · Cosmewax</title>
<link rel="icon" type="image/x-icon" href="favicon_circle2.ico">
<!-- El tema se aplica antes de pintar para no provocar un destello claro al
     entrar en oscuro. Misma clave que login.php, así la elección se respeta a
     ambos lados. Va en línea a propósito: un fichero externo llegaría tarde. -->
<script>
  (function () {
    try {
      var t = localStorage.getItem('siteTheme');
      if (t) document.documentElement.setAttribute('data-theme', t);
    } catch (e) {}
  })();
</script>
<link rel="stylesheet" href="assets/fontawesome/css/all.min.css">
<link rel="stylesheet" href="assets/css/tokens.css">
<link rel="stylesheet" href="assets/css/topbar.css">
<link rel="stylesheet" href="assets/css/base.css">
<link rel="stylesheet" href="assets/css/components.css">
<link rel="stylesheet" href="assets/css/global-bar.css">
<link rel="stylesheet" href="assets/css/flashcards.css">
<link rel="stylesheet" href="assets/css/conversation.css">
<link rel="stylesheet" href="assets/css/reading.css">
<link rel="stylesheet" href="assets/css/listening.css">
<link rel="stylesheet" href="assets/css/grammar.css">
<link rel="stylesheet" href="assets/css/pronunciation.css">
<link rel="stylesheet" href="assets/css/notebook.css">
</head>
<body>
<?php require __DIR__ . '/partials/topbar.php'; ?>

<div class="app-shell">
<div class="sheet">
  <header class="letterhead">
    <div class="ref"><?= e($owner) ?></div>
  </header>

  <div class="global-bar">
    <div class="global-summary" id="globalSummary"></div>
    <div class="global-actions">
      <select id="profileSelect" class="global-select"
              title="El contenido generado (vocabulario, escenarios, lecturas, audios) se adapta a este perfil"></select>
      <span class="streak-badge" id="streakBadge"></span>
      <button type="button" class="global-btn" id="exportProgressBtn"
              title="Descargar una copia de tu progreso en un fichero JSON">📤 Exportar</button>
      <button type="button" class="global-btn" id="importProgressBtn"
              title="Restaurar el progreso desde un fichero exportado antes">📥 Importar</button>
      <input type="file" id="importProgressFile" accept=".json,application/json" hidden>
    </div>
  </div>

  <div class="app-toast" id="appToast" role="status" hidden></div>

  <div class="import-confirm-banner" id="importConfirmBanner" role="alertdialog" hidden>
    <span id="importConfirmMsg"></span>
    <div class="import-confirm-actions">
      <button type="button" class="global-btn" data-import-action="apply">Sí, sobrescribir</button>
      <button type="button" class="global-btn" data-import-action="cancel">Cancelar</button>
    </div>
  </div>

  <?php if ($bootError !== null): ?>
    <div class="alert alert-error">
      No se pudieron cargar los datos de la aplicación<?= $app->isDebug() ? ': ' . e($bootError) : '.' ?>
    </div>
  <?php endif; ?>

  <?php if (!$app->aiConfigured()): ?>
    <div class="alert alert-warn">
      <strong>Los modos con IA están desactivados.</strong>
      <em>Tarjetas</em>, <em>Gramática</em> y <em>Pronunciación</em> funcionan igual (son totalmente
      locales), pero <em>Conversación</em>, <em>Lectura</em>, <em>Listening</em> y el <em>Cuaderno</em>
      necesitan el servidor de IA. Pon <code>IA_CLI=true</code> en <code>.env</code> y recarga.
      Comprobación: <a href="api/health.php" target="_blank" rel="noopener">api/health.php</a>
    </div>
  <?php endif; ?>

  <nav class="mode-toggle" id="modeToggle" aria-label="Modos de práctica">
    <button type="button" class="mode-btn" data-mode="notebook">📓 Cuaderno</button>
    <button type="button" class="mode-btn" data-mode="grammar">📐 Gramática</button>
    <button type="button" class="mode-btn" data-mode="pronunciation">🗣️ Pronunciación</button>
    <button type="button" class="mode-btn is-active" data-mode="flashcards">📇 Tarjetas</button>
    <button type="button" class="mode-btn" data-mode="conversation">💬 Conversación</button>
    <button type="button" class="mode-btn" data-mode="reading">📖 Lectura</button>
    <button type="button" class="mode-btn" data-mode="listening">🎧 Listening</button>
  </nav>

  <section id="flashcardsView" class="mode-view">
    <p class="subline">Recall activo espaciado · español → inglés · responde antes de ver la solución</p>

    <div class="stats-row" id="statsRow"></div>
    <div class="voice-panel" id="voicePanel"></div>
    <div class="tabs" id="tabs"></div>
    <div class="card-zone" id="cardZone">
      <div class="loading">Cargando banco de tarjetas…</div>
    </div>

    <button type="button" class="new-conv-btn" id="generateVocabBtn" style="margin-bottom:14px;">
      🪄 Generar vocabulario para mi perfil activo
    </button>

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
      <br><button type="button" class="reset-link" data-confirm-action="reset-cards">Reiniciar progreso de
      "<span id="resetCatLabel">Todas</span>" (mantiene las tarjetas)</button>
    </footer>
  </section>

  <section id="conversationView" class="mode-view" hidden>
    <p class="subline">Inglés de trabajo o de la vida diaria · de 3 a 30 min · el interlocutor responde
      de forma dinámica a lo que digas</p>
    <div class="conv-stats-row" id="convStatsRow"></div>
    <div id="convBody"></div>
    <footer class="footnote">
      <button type="button" class="reset-link" data-confirm-action="reset-conv">Borrar historial de conversaciones</button>
    </footer>
  </section>

  <section id="readingView" class="mode-view" hidden>
    <p class="subline">La IA te da un texto · lo lees en voz alta · al final corrige las palabras que no se entendieron bien</p>
    <div class="read-stats-row" id="readStatsRow"></div>
    <div id="readBody"></div>
    <footer class="footnote">
      <button type="button" class="reset-link" data-confirm-action="reset-read">Borrar historial de lecturas y palabras difíciles</button>
    </footer>
  </section>

  <section id="listeningView" class="mode-view" hidden>
    <p class="subline">Escuchas un audio sin ver el texto · respondes preguntas de comprensión por texto o voz</p>
    <div class="listen-stats-row" id="listenStatsRow"></div>
    <div id="listenBody"></div>
    <footer class="footnote">
      <button type="button" class="reset-link" data-confirm-action="reset-listen">Borrar historial de listening</button>
    </footer>
  </section>

  <section id="grammarView" class="mode-view" hidden>
    <p class="subline">Estructuras B2-C1 · explicación + ejemplos con audio + práctica corregida con repaso espaciado</p>
    <div class="stats-row" id="grammarStatsRow"></div>
    <div class="tabs" id="grammarTabs"></div>
    <div class="card-zone" id="grammarZone">
      <div class="loading">Cargando estructuras…</div>
    </div>
    <footer class="footnote">
      Se corrige en el navegador, sin IA: este modo funciona aunque el servidor de IA esté caído.
      <br><button type="button" class="reset-link" data-confirm-action="reset-grammar">Reiniciar progreso de
      "<span id="resetGrammarLevelLabel">Todas</span>" (mantiene las estructuras)</button>
    </footer>
  </section>

  <section id="pronunciationView" class="mode-view" hidden>
    <p class="subline">Pares mínimos por sonido · primero distingues de oído, luego produces la palabra correcta</p>
    <div class="stats-row" id="pronStatsRow"></div>
    <div id="pronBody"></div>
    <footer class="footnote">
      Los 45 pares del catálogo se corrigen en el navegador, sin IA. Sólo generar pares nuevos
      necesita el servidor de IA.
      <br><button type="button" class="reset-link" data-confirm-action="reset-pron">Reiniciar progreso de
      pronunciación</button>
    </footer>
  </section>

  <section id="notebookView" class="mode-view" hidden>
    <p class="subline">Pulsa cualquier palabra en Conversación, Lectura, Listening o Gramática para añadirla aquí,
      con traducción y ejemplo</p>
    <div class="stats-row" id="notebookStatsRow"></div>
    <div id="notebookBody"></div>
    <footer class="footnote">
      <button type="button" class="reset-link" data-confirm-action="reset-notebook">Borrar todo el cuaderno</button>
    </footer>
  </section>
</div>
</div>

<script>
  window.__APP__ = <?= json_encode($bootstrap, JSON_UNESCAPED_UNICODE | JSON_HEX_TAG | JSON_HEX_AMP | JSON_HEX_APOS | JSON_HEX_QUOT) ?>;
</script>
<script>
  // Toggle de tema. Fuera del módulo principal y sin `type="module"` para que
  // funcione aunque main.js falle: cambiar de tema no debe depender de que la
  // aplicación haya arrancado bien.
  (function () {
    var btn = document.getElementById('themeToggle');
    if (!btn) return;
    btn.addEventListener('click', function () {
      var next = (document.documentElement.getAttribute('data-theme') || 'light') === 'dark' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', next);
      try { localStorage.setItem('siteTheme', next); } catch (e) {}
    });
  })();
</script>
<script type="module" src="assets/js/main.js"></script>
</body>
</html>
