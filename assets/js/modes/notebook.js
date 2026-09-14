import { categoryLabel, content, profileLabel } from '../core/config.js';
import { $, delegate, escapeHtml } from '../core/dom.js';
import { aiAvailable, requestTask } from '../core/api.js';
import { Dictation, dictationUnavailableReason, speak } from '../core/speech.js';
import { formatFeedbackHtml } from '../core/ui.js';
import { evaluateAnswer } from '../lib/text.js';
import { MAX_BOX } from '../lib/srs.js';

const PROFILE_PREFIX = 'profile:';

const RESULT_LABELS = {
  correct: ['✓ Correcto', 'is-correct'],
  close: ['~ Casi — revisa el detalle', 'is-close'],
  incorrect: ['✗ Incorrecto', 'is-incorrect'],
};

/** Tres fallos seguidos de la IA y se deja de llamar. Ver flashcards.js. */
const MAX_AI_FAILURES = 3;

/**
 * Modo cuaderno: las tres listas de lo que el alumno está aprendiendo.
 *
 *  · Palabras Marcadas — lo que ha marcado en Conversación, Lectura, Listening
 *    o Gramática, con su propio repaso espaciado.
 *  · Vocabulario — el mazo de Tarjetas, en sólo lectura.
 *  · Gramática — las estructuras, en sólo lectura y filtrables por nivel.
 *
 * Las dos últimas son ventanas a modos que ya existen: no guardan nada y leen
 * el estado vivo de `flashcards.js` y `grammar.js` a través de las funciones que
 * llegan por parámetro. Repasar aquí, en cambio, sí escribe, porque el progreso
 * de una palabra marcada es suyo — ya no hay que copiarla al mazo para poder
 * repasarla, que era lo que antes dejaba el mismo término duplicado con dos
 * progresos distintos.
 *
 * El estado de las palabras no vive aquí sino en `core/notebook-service.js`,
 * porque cuatro modos añaden y sólo este lista.
 */
export function createNotebookMode({ notebook, cards, grammar, onActivity }) {
  const el = {
    stats: $('#notebookStatsRow'),
    body: $('#notebookBody'),
  };

  const state = {
    subView: 'marcadas', // 'marcadas' | 'vocabulario' | 'gramatica'
    deckFilter: 'all',
    grammarFilter: 'all',
    practicing: false,
    queue: [],
    index: 0,
    phase: 'answer', // 'answer' | 'grading' | 'checked'
    lastResult: null,
    pendingLatencyMs: null,
    /** Corrección en curso; descarta la que ya no toca. Ver flashcards.js. */
    checkId: 0,
    aiFailures: 0,
  };

  const dictation = new Dictation();

  function init() {
    delegate(el.body, 'click', '[data-action]', (event, target) => {
      const { action } = target.dataset;
      if (action === 'say') speak(target.dataset.text, { rate: 0.85 });
      if (action === 'remove') remove(target.dataset.id);
      if (action === 'sub-view') setSubView(target.dataset.view);
      if (action === 'deck-filter') setDeckFilter(target.dataset.filter);
      if (action === 'grammar-filter') setGrammarFilter(target.dataset.filter);
      if (action === 'practice') startPractice();
      if (action === 'stop-practice') stopPractice();
      if (action === 'check') checkAnswer();
      if (action === 'mic') toggleDictation();
      if (action === 'rate') rate(target.dataset.grade);
      if (action === 'say-answer' && state.lastResult) {
        speak(state.lastResult.correctAlt, { rate: 0.85 });
      }
    });

    el.body.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && event.target.id === 'notebookInput') {
        event.preventDefault();
        checkAnswer();
      }
    });

    // Otro modo puede añadir una palabra mientras este está abierto. Durante un
    // repaso no se repinta: la cola ya está armada y perder la ficha a medias
    // por haber marcado una palabra en otra pestaña sería desconcertante.
    notebook.onChange(() => {
      if (state.practicing) return;
      renderStats();
      render();
    });
  }

  // ---- Navegación ----

  function setSubView(view) {
    if (!['marcadas', 'vocabulario', 'gramatica'].includes(view)) return;
    dictation.stop();
    state.subView = view;
    render();
  }

  function setDeckFilter(filter) {
    state.deckFilter = filter;
    render();
  }

  function setGrammarFilter(filter) {
    state.grammarFilter = filter;
    render();
  }

  // ---- Pintado ----

  function renderStats() {
    const total = notebook.count();
    if (!total) {
      el.stats.style.display = 'none';
      return;
    }
    el.stats.style.display = 'grid';
    el.stats.innerHTML = [
      ['Palabras guardadas', total],
      ['Para hoy', notebook.dueCount()],
      ['Dominadas', notebook.masteredCount()],
    ]
      .map(([label, value]) => `<div class="stat"><div class="n">${value}</div><div class="l">${label}</div></div>`)
      .join('');
  }

  function tabsHtml(action, active, tabs) {
    const attribute = action === 'sub-view' ? 'view' : 'filter';

    return `<div class="tabs">${tabs
      .map(
        ([id, label]) =>
          `<button type="button" class="tab ${active === id ? 'is-active' : ''}"
             data-action="${action}" data-${attribute}="${escapeHtml(id)}"
           >${escapeHtml(label)}</button>`
      )
      .join('')}</div>`;
  }

  function subTabsHtml() {
    return tabsHtml('sub-view', state.subView, [
      ['marcadas', `🖊️ Palabras Marcadas (${notebook.count()})`],
      ['vocabulario', `📇 Vocabulario (${cards().length})`],
      ['gramatica', `📐 Gramática (${grammar.listItems().length})`],
    ]);
  }

  function dots(box) {
    return Array.from(
      { length: MAX_BOX },
      (_, i) => `<div class="dot ${i < box ? 'is-on' : ''}"></div>`
    ).join('');
  }

  function emptyState(title, body) {
    return `<div class="empty-state"><div class="big">${escapeHtml(title)}</div>${escapeHtml(body)}</div>`;
  }

  function render() {
    if (state.subView === 'gramatica') {
      el.body.innerHTML = subTabsHtml() + grammarViewHtml();
      return;
    }
    if (state.subView === 'vocabulario') {
      el.body.innerHTML = subTabsHtml() + deckViewHtml();
      return;
    }
    if (state.practicing) {
      renderPractice();
      return;
    }
    el.body.innerHTML = subTabsHtml() + markedViewHtml();
  }

  /** Estructuras de Gramática, en sólo lectura y filtrables por nivel. */
  function grammarViewHtml() {
    const filters = [['all', 'Todas'], ...grammar.levels().map((level) => [level, level])];
    const items = grammar
      .listItems()
      .filter((item) => state.grammarFilter === 'all' || item.level === state.grammarFilter);

    if (!items.length) {
      return (
        tabsHtml('grammar-filter', state.grammarFilter, filters) +
        emptyState('Sin estructuras en este nivel', 'Prueba con "Todas".')
      );
    }

    return (
      tabsHtml('grammar-filter', state.grammarFilter, filters) +
      items
        .map(
          (item) => `
            <article class="notebook-entry">
              <div class="notebook-source-tag">${escapeHtml(item.level)}</div>
              <div class="notebook-word" style="font-size:16px;">${escapeHtml(item.title)}</div>
              <div class="notebook-translation">${escapeHtml(item.explanation)}</div>
              <div class="notebook-example">
                ${item.examples.map((ex) => `<div>"${escapeHtml(ex)}"</div>`).join('')}
              </div>
              <div class="notebook-actions">
                <div class="notebook-box">${dots(item.box)}</div>
                <button type="button" data-action="say" data-text="${escapeHtml(item.examples[0] || item.title)}">
                  🔊 Escuchar ejemplo
                </button>
              </div>
            </article>`
        )
        .join('')
    );
  }

  /** El mazo de Tarjetas, en sólo lectura. */
  function deckViewHtml() {
    const deck = cards();
    const profileIds = [...new Set(deck.map((card) => card.profile).filter(Boolean))];
    const filters = [
      ['all', 'Todas'],
      ...content.categories
        .filter((cat) => cat.id !== 'personal')
        .map((cat) => [cat.id, cat.label]),
      ...profileIds.map((id) => [`${PROFILE_PREFIX}${id}`, `🪄 ${profileLabel(id)}`]),
      ...content.categories.filter((cat) => cat.id === 'personal').map((cat) => [cat.id, cat.label]),
    ];

    const filtered = deck
      .filter((card) => {
        if (state.deckFilter === 'all') return true;
        if (state.deckFilter.startsWith(PROFILE_PREFIX)) {
          return card.profile === state.deckFilter.slice(PROFILE_PREFIX.length);
        }
        return card.cat === state.deckFilter;
      })
      .sort((a, b) => a.es.localeCompare(b.es));

    if (!filtered.length) {
      return (
        tabsHtml('deck-filter', state.deckFilter, filters) +
        emptyState('Sin tarjetas en esta categoría', 'Genera un lote o añade alguna desde Tarjetas.')
      );
    }

    return (
      tabsHtml('deck-filter', state.deckFilter, filters) +
      filtered
        .map(
          (card) => `
            <article class="notebook-entry">
              <div class="notebook-source-tag">${escapeHtml(categoryLabel(card.cat))}</div>
              <div class="notebook-word">${escapeHtml(card.en)}</div>
              <div class="notebook-translation">${escapeHtml(card.es)}</div>
              ${card.note ? `<div class="notebook-example">${escapeHtml(card.note)}</div>` : ''}
              <div class="notebook-actions">
                <div class="notebook-box">${dots(card.box)}</div>
                <button type="button" data-action="say" data-text="${escapeHtml(card.en)}">🔊 Escuchar</button>
              </div>
            </article>`
        )
        .join('')
    );
  }

  /** Las palabras marcadas, con el botón de repaso. */
  function markedViewHtml() {
    const entries = notebook.all();
    if (!entries.length) {
      return emptyState(
        'Tu cuaderno está vacío',
        'Ve a Conversación, Lectura, Listening o Gramática y pulsa cualquier palabra del texto ' +
          'para añadirla aquí, con su traducción en ese contexto.'
      );
    }

    const due = notebook.dueCount();
    const button = `
      <button type="button" class="new-conv-btn" style="margin-bottom:16px;" data-action="practice">
        ▶ Repasar (${due} pendiente${due === 1 ? '' : 's'} hoy)
      </button>`;

    return (
      button +
      entries
        .map(
          (entry) => `
            <article class="notebook-entry">
              <div class="notebook-source-tag">Nivel ${entry.box ?? 1}/${MAX_BOX}</div>
              <div class="notebook-word">${escapeHtml(entry.word)}</div>
              <div class="notebook-translation">${escapeHtml(entry.translation)}</div>
              <div class="notebook-example">"${escapeHtml(entry.example)}"</div>
              <div class="notebook-actions">
                <div class="notebook-box">${dots(entry.box ?? 1)}</div>
                <button type="button" data-action="say" data-text="${escapeHtml(entry.example)}">🔊 Escuchar</button>
                <button type="button" data-action="remove" data-id="${escapeHtml(entry.id)}">🗑 Borrar</button>
              </div>
            </article>`
        )
        .join('')
    );
  }

  // ---- Repaso espaciado de las palabras marcadas ----

  function startPractice() {
    state.queue = notebook.queue();
    state.index = 0;
    state.phase = 'answer';
    state.lastResult = null;
    state.pendingLatencyMs = null;
    state.checkId += 1;
    state.practicing = true;
    render();
  }

  function stopPractice() {
    dictation.stop();
    state.checkId += 1;
    state.practicing = false;
    renderStats();
    render();
  }

  function renderPractice() {
    const exit = `
      <button type="button" class="new-conv-btn" style="margin-top:10px;" data-action="stop-practice">
        Volver a la lista
      </button>`;

    if (!state.queue.length) {
      el.body.innerHTML =
        emptyState('No hay palabras pendientes', 'Todas tus palabras marcadas están al día.') + exit;
      return;
    }
    if (state.index >= state.queue.length) {
      el.body.innerHTML =
        emptyState('Repaso completo', 'Has repasado todas las palabras pendientes por ahora.') + exit;
      return;
    }

    const entry = state.queue[state.index];
    el.body.innerHTML = `
      <div class="card">
        <div class="card-tag">Cuaderno</div>
        <div class="card-box">${dots(entry.box ?? 1)}</div>
        <div class="prompt-label">Traduce al inglés</div>
        <div class="prompt-text">${escapeHtml(entry.translation)}</div>
        ${practicePhaseHtml(entry)}
      </div>${exit}`;

    if (state.phase === 'answer') {
      const input = $('#notebookInput', el.body);
      if (input) input.focus();
    }
  }

  function practicePhaseHtml(entry) {
    if (state.phase === 'grading') return '<div class="loading">Corrigiendo con IA…</div>';
    if (state.phase === 'answer') {
      return `
        <div class="answer-input-row">
          <input type="text" class="answer-input" id="notebookInput" autocomplete="off"
                 placeholder="Escribe o dicta tu respuesta en inglés...">
          <button type="button" class="mic-btn" data-action="mic" title="Responder por voz">🎤</button>
          <button type="button" class="check-btn" data-action="check">Corregir</button>
        </div>
        <div class="voice-msg" id="notebookVoiceMsg" hidden></div>`;
    }

    const result = state.lastResult;
    const [label, cssClass] = RESULT_LABELS[result.classification];

    let html = `<div class="feedback-banner ${cssClass}">${escapeHtml(label)}</div>
      <div class="your-answer-label">Escribiste</div>
      <div class="your-answer-text">${escapeHtml(result.userAnswer)}</div>`;

    if (result.aiGraded) {
      if (result.feedback) html += `<div class="answer-note">${formatFeedbackHtml(result.feedback)}</div>`;
      html += `<div class="answer-note">✓ Forma más adecuada:
        <strong>${escapeHtml(result.correctAlt)}</strong></div>`;
      if (result.alternatives && result.alternatives.length) {
        html += `<div class="answer-note">También válido: ${result.alternatives
          .map((alt) => `<em>"${escapeHtml(alt)}"</em>`)
          .join(', ')}</div>`;
      }
    } else {
      if (result.feedback) html += `<div class="answer-note is-warning">${escapeHtml(result.feedback)}</div>`;
      html += `<div class="answer-note">Respuesta esperada:
        <strong>${escapeHtml(result.correctAlt)}</strong></div>`;
    }

    html += `<div class="answer-note">"${escapeHtml(entry.example)}"</div>`;
    if (result.latencyMs) {
      html += `<div class="answer-note">🎙 Tiempo hasta responder:
        <strong>${(result.latencyMs / 1000).toFixed(1)}s</strong></div>`;
    }

    return `${html}
      <button type="button" class="check-btn" style="margin-bottom:10px;" data-action="say-answer">
        🔊 Escuchar pronunciación
      </button>
      <div class="rate-row">
        <button type="button" class="rate-btn is-again" data-action="rate" data-grade="again">Otra vez</button>
        <button type="button" class="rate-btn is-good" data-action="rate" data-grade="good">Bien</button>
        <button type="button" class="rate-btn is-easy" data-action="rate" data-grade="easy">Fácil</button>
      </div>`;
  }

  async function checkAnswer() {
    if (state.phase !== 'answer') return;

    const input = $('#notebookInput', el.body);
    const value = input ? input.value.trim() : '';
    if (!value) {
      if (input) input.focus();
      return;
    }

    const entry = state.queue[state.index];
    const latencyMs = state.pendingLatencyMs;
    state.pendingLatencyMs = null;
    dictation.stop();

    state.checkId += 1;
    const checkId = state.checkId;
    state.phase = 'grading';
    renderPractice();

    const result = await gradeAnswer(value, entry);
    if (checkId !== state.checkId) return;

    state.lastResult = result;
    if (latencyMs !== null) result.latencyMs = latencyMs;
    state.phase = 'checked';
    renderPractice();
  }

  /**
   * Corrige con IA y, si no hay, con el diff de texto.
   *
   * Reutiliza la tarea `flashcards.grade` en lugar de estrenar una propia: lo
   * que se corrige es exactamente lo mismo —una expresión española que hay que
   * decir en inglés, con un ejemplo de contexto—, y duplicar el prompt sólo
   * garantizaría que los dos se separen con el tiempo.
   */
  async function gradeAnswer(value, entry) {
    const fallback = { en: entry.word };
    if (!aiAvailable()) {
      return { ...evaluateAnswer(value, fallback), aiGraded: false, feedback: '' };
    }
    if (state.aiFailures >= MAX_AI_FAILURES) {
      return {
        ...evaluateAnswer(value, fallback),
        aiGraded: false,
        feedback:
          'El servidor de IA no responde, así que se ha dejado de intentar en esta sesión: ' +
          'se compara el texto palabra a palabra, que es menos flexible con las alternativas ' +
          'válidas. Recarga la página para volver a probar.',
      };
    }

    try {
      const graded = await requestTask('flashcards.grade', {
        spanish: entry.translation,
        target: entry.word,
        note: entry.example || '',
        answer: value,
      });
      state.aiFailures = 0;
      return {
        classification: graded.classification,
        correctAlt: graded.bestAnswer,
        alternatives: graded.alternatives,
        feedback: graded.feedback,
        diffOps: null,
        userAnswer: value,
        aiGraded: true,
      };
    } catch (err) {
      state.aiFailures += 1;
      return {
        ...evaluateAnswer(value, fallback),
        aiGraded: false,
        feedback:
          `No se pudo corregir con IA (${err.message}). Se ha comparado el texto palabra ` +
          'a palabra, que es menos flexible con las alternativas válidas.',
      };
    }
  }

  async function rate(grade) {
    if (!['again', 'good', 'easy'].includes(grade)) return;

    const entry = state.queue[state.index];
    await notebook.grade(entry.id, grade);

    state.index += 1;
    state.phase = 'answer';
    state.lastResult = null;
    renderStats();
    renderPractice();
    await onActivity();
  }

  // ---- Voz ----

  function toggleDictation() {
    const unavailable = dictationUnavailableReason();
    if (unavailable) {
      showVoiceMessage(unavailable);
      return;
    }
    if (dictation.isListening) {
      dictation.stop();
      return;
    }

    showVoiceMessage('');
    const started = dictation.start({
      onFinal: (transcript, latencyMs) => {
        state.pendingLatencyMs = latencyMs;
        const input = $('#notebookInput', el.body);
        if (input) {
          input.value = transcript.trim();
          input.focus();
        }
      },
      onError: (code, message) => {
        showVoiceMessage(message);
        updateMicButton();
      },
      onEnd: updateMicButton,
    });
    if (started) updateMicButton();
  }

  function updateMicButton() {
    const button = el.body.querySelector('[data-action="mic"]');
    if (!button) return;
    button.textContent = dictation.isListening ? '● Escuchando' : '🎤';
    button.classList.toggle('is-recording', dictation.isListening);
  }

  function showVoiceMessage(message) {
    const box = $('#notebookVoiceMsg', el.body);
    if (!box) return;
    box.textContent = message;
    box.hidden = message === '';
  }

  // ---- Acciones ----

  async function remove(id) {
    await notebook.remove(id);
    // Si se borra durante un repaso, la cola se queda con una ficha fantasma.
    if (state.practicing) {
      state.queue = state.queue.filter((entry) => entry.id !== id);
      if (state.index > state.queue.length) state.index = state.queue.length;
      renderStats();
      renderPractice();
    }
  }

  return {
    init,
    show() {
      renderStats();
      render();
    },
    hide() {
      dictation.stop();
    },
    async reset() {
      await notebook.clear();
      state.practicing = false;
      state.subView = 'marcadas';
      renderStats();
      render();
    },
  };
}
