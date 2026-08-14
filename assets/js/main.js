import { config, content } from './core/config.js';
import { $, delegate, escapeHtml } from './core/dom.js';
import { createStore, setPersistenceWarning } from './core/storage.js';
import { aiAvailable } from './core/api.js';
import { INSECURE_CONTEXT_MESSAGE } from './core/speech.js';
import { confirmThenRun, showToast } from './core/ui.js';
import { createProfile } from './core/profile.js';
import { createStreak } from './core/streak.js';
import { createNotebookService } from './core/notebook-service.js';
import { createProgressTransfer } from './core/progress-transfer.js';
import { createFlashcardsMode } from './modes/flashcards.js';
import { createConversationMode } from './modes/conversation.js';
import { createReadingMode } from './modes/reading.js';
import { createListeningMode } from './modes/listening.js';
import { createGrammarMode } from './modes/grammar.js';
import { createNotebookMode } from './modes/notebook.js';
import { createPronunciationMode } from './modes/pronunciation.js';

/**
 * Arranque y router de modos.
 *
 * Añadir un modo son tres cosas: un módulo en `modes/` que exponga
 * `init/show/hide`, una entrada en `MODES` y un botón con su `data-mode` en
 * `index.php`.
 */
const store = createStore();
const profile = createProfile({ store });
const streak = createStreak({ store });
const notebook = createNotebookService({ store });
const transfer = createProgressTransfer({ store });

/** Cualquier modo que complete algo llama aquí: alimenta racha y resumen. */
async function onActivity() {
  await streak.recordActivity();
  renderStreak();
  renderSummary();
}

const flashcards = createFlashcardsMode({ store, profile, onActivity });
const grammar = createGrammarMode({ store, onActivity });
const pronunciation = createPronunciationMode({ store, onActivity });
const conversation = createConversationMode({ store, profile, onActivity });
const reading = createReadingMode({ store, profile, onActivity });
const listening = createListeningMode({ store, profile, onActivity });
const notebookMode = createNotebookMode({
  notebook,
  // Ascender una palabra del cuaderno crea una tarjeta en la categoría propia.
  onPromote: async (entry) => {
    await flashcards.addCard({
      cat: 'personal',
      es: entry.translation,
      en: entry.word,
      note: `Ejemplo: "${entry.example}"`,
    });
    flashcards.refresh();
    renderSummary();
  },
});

const MODES = {
  notebook: { view: $('#notebookView'), controller: notebookMode },
  grammar: { view: $('#grammarView'), controller: grammar },
  pronunciation: { view: $('#pronunciationView'), controller: pronunciation },
  flashcards: { view: $('#flashcardsView'), controller: flashcards },
  conversation: { view: $('#conversationView'), controller: conversation },
  reading: { view: $('#readingView'), controller: reading },
  listening: { view: $('#listeningView'), controller: listening },
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

// ---- Barra global ----

function renderSummary() {
  const el = $('#globalSummary');
  if (!el) return;
  el.innerHTML = [
    `<strong>${flashcards.masteredCount()}</strong>/${flashcards.deckSize()} tarjetas dominadas`,
    `<strong>${grammar.masteredCount()}</strong>/${grammar.totalCount()} estructuras dominadas`,
    `<strong>${pronunciation.practicedCount()}</strong>/${pronunciation.groupCount()} sonidos practicados`,
    `<strong>${conversation.sessionCount()}</strong> conversaciones`,
    `<strong>${reading.sessionCount()}</strong> textos leídos`,
    `<strong>${listening.sessionCount()}</strong> audios escuchados`,
    `<strong>${notebook.count()}</strong> palabras en el cuaderno`,
  ].join(' · ');
}

function renderStreak() {
  const el = $('#streakBadge');
  if (!el) return;
  const days = streak.current();
  el.textContent = days > 0 ? `🔥 ${days} día${days === 1 ? '' : 's'} seguidos` : '🔥 Empieza tu racha hoy';
  el.title = `Mejor racha: ${streak.best()} día(s)`;
}

function renderProfileSelect() {
  const select = $('#profileSelect');
  if (!select) return;
  select.innerHTML = content.profiles
    .map(
      (p) =>
        `<option value="${escapeHtml(p.id)}" ${p.id === profile.id() ? 'selected' : ''}>${escapeHtml(p.label)}</option>`
    )
    .join('');
}

function wireGlobalBar() {
  const select = $('#profileSelect');
  if (select) {
    select.addEventListener('change', async (event) => {
      if (await profile.set(event.target.value)) {
        showToast(
          `Perfil activo: ${profile.label()}. El vocabulario, las conversaciones, las lecturas ` +
            'y los audios nuevos se adaptarán a este perfil.'
        );
        // Los modos que muestran el perfil en su portada se repintan.
        MODES[activeMode].controller.show();
      }
    });
  }
  wireProgressTransfer();
}

/**
 * Exportar e importar el progreso.
 *
 * La importación pide confirmación en un banner y, al aceptar, **recarga la
 * página**: cada modo lee su estado al iniciarse, así que reinyectarlo en los
 * siete en caliente sería reimplementar el arranque. Recargar usa el que ya hay.
 */
function wireProgressTransfer() {
  const exportBtn = $('#exportProgressBtn');
  const importBtn = $('#importProgressBtn');
  const fileInput = $('#importProgressFile');
  const banner = $('#importConfirmBanner');
  const message = $('#importConfirmMsg');

  if (exportBtn) {
    exportBtn.addEventListener('click', () => {
      const keys = transfer.download();
      showToast(
        keys === 0
          ? 'Todavía no hay progreso que exportar.'
          : `Progreso exportado (${keys} apartados). Los escenarios generados no van en el fichero: ` +
              'viven en el servidor y ya te siguen.'
      );
    });
  }

  if (importBtn && fileInput) {
    importBtn.addEventListener('click', () => fileInput.click());

    fileInput.addEventListener('change', async (event) => {
      const file = event.target.files[0];
      // Se limpia siempre: sin esto, volver a elegir el mismo fichero no dispara
      // otro `change` y el segundo intento parecería no hacer nada.
      event.target.value = '';
      if (!file) return;

      try {
        const { keys, exportedAt } = await transfer.read(file);
        const when = exportedAt ? new Date(exportedAt).toLocaleString('es-ES') : 'fecha desconocida';
        if (message) {
          message.textContent =
            `Fichero válido (exportado: ${when}) con ${keys.length} apartados de progreso. ` +
            'Esto sobrescribirá tu progreso actual. ¿Continuar?';
        }
        if (banner) banner.hidden = false;
      } catch (err) {
        showToast(`No se pudo importar: ${err.message}.`);
      }
    });
  }

  delegate(document, 'click', '[data-import-action]', async (event, target) => {
    if (banner) banner.hidden = true;
    if (target.dataset.importAction === 'cancel') {
      transfer.cancel();
      showToast('Importación cancelada. Tu progreso no se ha tocado.');
      return;
    }
    if (!transfer.hasPending) return;

    const saved = await transfer.apply();
    if (saved.length === 0) {
      showToast(
        'El servidor no pudo guardar el progreso importado. Recarga la página para volver ' +
          'al progreso que sí está guardado.'
      );
      return;
    }
    showToast('Progreso importado. Recargando…');
    window.setTimeout(() => window.location.reload(), 1200);
  });
}

// ---- Acciones de reinicio, con confirmación en dos clics ----

const RESET_ACTIONS = {
  'reset-cards': async () => showToast(`Progreso reiniciado: ${await flashcards.reset()}.`),
  'reset-grammar': async () => showToast(`Progreso de gramática reiniciado: ${await grammar.reset()}.`),
  'reset-conv': async () => {
    await conversation.reset();
    renderSummary();
    showToast('Historial de conversaciones borrado.');
  },
  'reset-read': async () => {
    await reading.reset();
    renderSummary();
    showToast('Historial de lecturas borrado.');
  },
  'reset-listen': async () => {
    await listening.reset();
    renderSummary();
    showToast('Historial de listening borrado.');
  },
  'reset-notebook': async () => {
    await notebookMode.reset();
    renderSummary();
    showToast('Cuaderno borrado.');
  },
  'reset-pron': async () => {
    await pronunciation.reset();
    renderSummary();
    showToast('Progreso de pronunciación reiniciado.');
  },
};

function wireResetButtons() {
  delegate(document, 'click', '[data-confirm-action]', (event, target) => {
    const action = RESET_ACTIONS[target.dataset.confirmAction];
    if (action) confirmThenRun(target, action);
  });
}

/**
 * Marcar palabras para el cuaderno, en toda la aplicación.
 *
 * Un único listener delegado en `document` en lugar de uno por modo: el gesto es
 * idéntico en Conversación, Lectura, Listening y Gramática, y así los modos sólo
 * tienen que renderizar el marcado.
 */
function wireWordMarking() {
  delegate(document, 'click', '.clickable-word', async (event, target) => {
    const { word, ctx } = target.dataset;
    if (!word || target.classList.contains('is-marking')) return;

    if (!aiAvailable()) {
      showToast('El cuaderno necesita el servidor de IA, que ahora está desactivado.');
      return;
    }
    if (notebook.has(word)) {
      showToast(`"${word}" ya está en tu cuaderno.`);
      return;
    }

    target.classList.add('is-marking');
    try {
      const entry = await notebook.add(word, ctx || word);
      if (entry) {
        showToast(`"${entry.word}" → "${entry.translation}" · añadida al cuaderno.`);
        renderSummary();
      }
    } catch (err) {
      showToast(`No se pudo traducir "${word}": ${err.message}`);
    } finally {
      target.classList.remove('is-marking');
    }
  });
}

/**
 * Aviso por adelantado si el origen no es seguro.
 *
 * Sin esto, el alumno descubre que el micrófono no va sólo al pulsarlo, y el
 * mensaje del navegador ("not-allowed") no explica que la causa es la URL.
 */
function warnIfInsecureContext() {
  if (typeof window.isSecureContext !== 'boolean' || window.isSecureContext) return;

  // Se ancla a la barra global, que es lo primero del contenido: el aviso tiene
  // que verse sin desplazarse, no enterrado entre los modos.
  const anchor = document.querySelector('.global-bar') || document.querySelector('.letterhead');
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

  // Si el progreso deja de guardarse, el alumno tiene que enterarse: seguirá
  // practicando, pero conviene que sepa que ese rato no quedará registrado.
  setPersistenceWarning(() =>
    showToast(
      'No se está guardando tu progreso ahora mismo (la base de datos no responde). ' +
        'Puedes seguir practicando, pero avisa a IT.'
    )
  );

  delegate($('#modeToggle'), 'click', '[data-mode]', (event, target) => {
    switchTo(target.dataset.mode);
  });

  // El progreso completo llega en una sola petición ANTES de que los modos se
  // inicialicen: todos leen de la copia en memoria que deja esta llamada.
  await store.hydrate();

  // El perfil y el cuaderno los necesitan varios modos al iniciarse.
  await Promise.all([profile.load(), streak.load(), notebook.load()]);

  const controllers = Object.entries(MODES);
  const results = await Promise.allSettled(
    controllers.map(([, mode]) => mode.controller.init())
  );
  results.forEach((result, index) => {
    if (result.status === 'rejected') {
      console.error(`[app] fallo al iniciar el modo ${controllers[index][0]}`, result.reason);
    }
  });

  renderProfileSelect();
  wireGlobalBar();
  wireResetButtons();
  wireWordMarking();
  renderStreak();
  renderSummary();

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
