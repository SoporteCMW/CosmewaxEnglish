import { config } from './core/config.js';
import { $, delegate, escapeHtml } from './core/dom.js';
import { createStore } from './core/storage.js';
import { INSECURE_CONTEXT_MESSAGE } from './core/speech.js';
import { createFlashcardsMode } from './modes/flashcards.js';
import { createConversationMode } from './modes/conversation.js';
import { createReadingMode } from './modes/reading.js';

/**
 * Arranque y router de modos.
 *
 * Añadir un modo nuevo son tres líneas: un módulo en `modes/`, una entrada en
 * `MODES` y un botón en `index.php` con su `data-mode`.
 */
const store = createStore(config.storageNamespace);

const MODES = {
  flashcards: { view: $('#flashcardsView'), controller: createFlashcardsMode({ store }) },
  conversation: { view: $('#conversationView'), controller: createConversationMode({ store }) },
  reading: { view: $('#readingView'), controller: createReadingMode({ store }) },
};

let activeMode = 'flashcards';

function switchTo(name) {
  if (!MODES[name] || name === activeMode) return;

  MODES[activeMode].controller.hide();
  Object.entries(MODES).forEach(([key, mode]) => {
    mode.view.hidden = key !== name;
  });
  document.querySelectorAll('#modeToggle .mode-btn').forEach((button) => {
    button.classList.toggle('is-active', button.dataset.mode === name);
  });

  activeMode = name;
  MODES[name].controller.show();
}

/**
 * Aviso por adelantado si el origen no es seguro.
 *
 * Sin esto, el alumno descubre que el micrófono no va sólo al pulsarlo, y el
 * mensaje del navegador ("not-allowed") no explica que la causa es la URL.
 */
function warnIfInsecureContext() {
  if (typeof window.isSecureContext !== 'boolean' || window.isSecureContext) return;

  const anchor = document.querySelector('.letterhead');
  if (!anchor) return;

  const notice = document.createElement('div');
  notice.className = 'alert alert-warn';
  notice.innerHTML = `<strong>Micrófono no disponible en esta dirección.</strong> ${escapeHtml(
    INSECURE_CONTEXT_MESSAGE
  )}`;
  anchor.insertAdjacentElement('afterend', notice);
}

async function boot() {
  warnIfInsecureContext();

  delegate($('#modeToggle'), 'click', '[data-mode]', (event, target) => {
    switchTo(target.dataset.mode);
  });

  const results = await Promise.allSettled(
    Object.values(MODES).map((mode) => mode.controller.init())
  );
  results.forEach((result, index) => {
    if (result.status === 'rejected') {
      console.error(`[app] fallo al iniciar el modo ${Object.keys(MODES)[index]}`, result.reason);
    }
  });

  MODES[activeMode].controller.show();
}

boot().catch((err) => {
  console.error('[app] arranque fallido', err);
  const zone = $('#cardZone');
  if (zone) {
    zone.innerHTML =
      '<div class="empty-state"><div class="big">No se pudo iniciar la aplicación</div>' +
      'Abre la consola del navegador para ver el detalle.</div>';
  }
});
