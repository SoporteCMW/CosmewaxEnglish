import { content } from '../core/config.js';
import { $, delegate, escapeHtml } from '../core/dom.js';
import { aiAvailable, requestTask } from '../core/api.js';
import { Dictation, dictationUnavailableReason, speak } from '../core/speech.js';
import { clickableWords, formatFeedbackHtml } from '../core/ui.js';
import { evaluateAnswer } from '../lib/text.js';
import { applyGrade, buildQueue, isDue, newEntry, todayStr, MAX_BOX } from '../lib/srs.js';

const KEY_SRS = 'grammar-srs';

/** Orden en que se muestran las pestañas de nivel. Ver `levels()`. */
export const CEFR_ORDER = ['B1', 'B2', 'C1', 'C2'];

const RESULT_LABELS = {
  correct: ['✓ Correcto', 'is-correct'],
  close: ['~ Casi — revisa el detalle', 'is-close'],
  incorrect: ['✗ Incorrecto', 'is-incorrect'],
};

/**
 * Modo gramática: estructuras B2-C1 con explicación, ejemplos con audio y
 * ejercicio corregido, todo con repetición espaciada.
 *
 * La corrige la IA, igual que las tarjetas y por el mismo motivo, agravado: la
 * respuesta es una frase entera, así que contra el `exerciseAnswer` del catálogo
 * salía "incorrecto" por usar otro modal igual de válido o cambiar el orden de
 * las palabras. Lo que se juzga es si ha usado bien la estructura, no si ha
 * reproducido la frase de referencia. El diff sigue de respaldo si la IA está
 * apagada o no responde, así que el modo nunca se queda sin corregir.
 */
export function createGrammarMode({ store, onActivity }) {
  const el = {
    stats: $('#grammarStatsRow'),
    tabs: $('#grammarTabs'),
    zone: $('#grammarZone'),
    resetLabel: $('#resetGrammarLevelLabel'),
  };

  const state = {
    srs: {},
    level: 'all',
    queue: [],
    index: 0,
    phase: 'answer', // 'answer' | 'grading' | 'checked'
    lastResult: null,
    pendingLatencyMs: null,
    /** Corrección en curso; descarta la que ya no toca. Ver flashcards.js. */
    checkId: 0,
    /** Fallos seguidos de la IA; a los tres se deja de llamar. Ver flashcards.js. */
    aiFailures: 0,
  };

  const MAX_AI_FAILURES = 3;

  const dictation = new Dictation();

  const items = () => content.grammar;

  /**
   * Niveles presentes en el catálogo, en orden CEFR y no en el de aparición.
   *
   * El catálogo creció por tandas (primero B2 y C1, después B1 y C2), así que
   * el orden natural del fichero pondría las pestañas como B2 · C1 · B1 · C2.
   * Se derivan del contenido y no de una lista fija para que ampliarlo siga
   * siendo editar sólo `data/grammar.json`.
   */
  const levels = () => {
    const present = new Set(items().map((g) => g.level));
    const known = CEFR_ORDER.filter((level) => present.has(level));
    const rest = [...present].filter((level) => !CEFR_ORDER.includes(level));

    return [...known, ...rest];
  };

  async function init() {
    state.srs = await store.get(KEY_SRS, {});
    let changed = false;
    items().forEach((item) => {
      if (!state.srs[item.id]) {
        state.srs[item.id] = newEntry();
        changed = true;
      }
    });
    if (changed) await store.set(KEY_SRS, state.srs);

    bindEvents();
    renderTabs();
    rebuildQueue();
  }

  function bindEvents() {
    delegate(el.tabs, 'click', '[data-level]', (event, target) => setLevel(target.dataset.level));

    delegate(el.zone, 'click', '[data-action]', (event, target) => {
      const { action } = target.dataset;
      if (action === 'check') checkAnswer();
      if (action === 'mic') toggleDictation();
      if (action === 'rate') rate(target.dataset.grade);
      if (action === 'say-example') speak(target.dataset.text, { rate: 0.85 });
      if (action === 'say-answer' && state.lastResult) {
        speak(state.lastResult.correctAlt, { rate: 0.85 });
      }
    });

    el.zone.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && event.target.id === 'grammarInput') {
        event.preventDefault();
        checkAnswer();
      }
    });
  }

  function currentItems() {
    return state.level === 'all' ? items() : items().filter((g) => g.level === state.level);
  }

  function rebuildQueue() {
    dictation.stop();
    state.pendingLatencyMs = null;
    state.checkId += 1;
    state.queue = buildQueue(currentItems(), state.srs, { limitAhead: 8 });
    state.index = 0;
    state.phase = 'answer';
    state.lastResult = null;
  }

  function setLevel(level) {
    state.level = level;
    rebuildQueue();
    renderTabs();
    render();
    if (el.resetLabel) el.resetLabel.textContent = level === 'all' ? 'Todas' : level;
  }

  function renderTabs() {
    const tabs = [{ id: 'all', label: 'Todas' }, ...levels().map((l) => ({ id: l, label: l }))];
    el.tabs.innerHTML = tabs
      .map(
        (tab) =>
          `<button type="button" class="tab ${state.level === tab.id ? 'is-active' : ''}"
             data-level="${escapeHtml(tab.id)}">${escapeHtml(tab.label)}</button>`
      )
      .join('');
  }

  function renderStats() {
    const today = todayStr();
    const all = items();
    const mastered = all.filter((g) => (state.srs[g.id]?.box ?? 1) >= MAX_BOX).length;
    const due = all.filter((g) => isDue(state.srs[g.id], today)).length;

    el.stats.innerHTML = [
      ['Total', all.length],
      ['Para hoy', due],
      ['Dominadas', mastered],
      ['En curso', all.length - mastered],
    ]
      .map(([label, value]) => `<div class="stat"><div class="n">${value}</div><div class="l">${label}</div></div>`)
      .join('');
  }

  function render() {
    if (state.queue.length === 0) {
      el.zone.innerHTML = emptyState('No hay estructuras en este nivel', 'Prueba con "Todas".');
      return;
    }
    if (state.index >= state.queue.length) {
      el.zone.innerHTML = emptyState(
        'Sesión completa por hoy',
        'Has repasado todas las estructuras pendientes de este nivel. Vuelve mañana o cambia de nivel.'
      );
      return;
    }

    const item = state.queue[state.index];
    const box = state.srs[item.id]?.box ?? 1;
    const dots = Array.from(
      { length: MAX_BOX },
      (_, i) => `<div class="dot ${i < box ? 'is-on' : ''}"></div>`
    ).join('');

    const examples = item.examples
      .map(
        (example) => `
          <div class="example-line">
            <span class="ex-text">${clickableWords(example, example)}</span>
            <button type="button" class="example-speak-btn" data-action="say-example"
                    data-text="${escapeHtml(example)}" title="Escuchar">🔊</button>
          </div>`
      )
      .join('');

    el.zone.innerHTML = `
      <div class="card">
        <div class="card-tag">${escapeHtml(item.level)}</div>
        <div class="card-box">${dots}</div>
        <div class="prompt-label">Estructura</div>
        <div class="prompt-text" style="font-size:19px;">${escapeHtml(item.title)}</div>
        <div class="grammar-explanation">${escapeHtml(item.explanation)}</div>
        <div class="grammar-examples">${examples}</div>
        <div class="exercise-label">Ejercicio de práctica</div>
        <div class="exercise-prompt">${escapeHtml(item.exercisePrompt)}</div>
        ${phaseHtml()}
      </div>`;

    if (state.phase === 'answer') {
      const input = $('#grammarInput', el.zone);
      if (input) input.focus();
    }
  }

  function phaseHtml() {
    if (state.phase === 'answer') return answerFormHtml();
    if (state.phase === 'grading') return '<div class="loading">Corrigiendo con IA…</div>';
    return resultHtml();
  }

  function answerFormHtml() {
    return `
      <div class="answer-input-row">
        <input type="text" class="answer-input" id="grammarInput" autocomplete="off"
               placeholder="Escribe o dicta tu respuesta en inglés...">
        <button type="button" class="mic-btn" data-action="mic" title="Responder por voz">🎤</button>
        <button type="button" class="check-btn" data-action="check">Corregir</button>
      </div>
      <div class="voice-msg" id="grammarVoiceMsg" hidden></div>`;
  }

  function resultHtml() {
    const result = state.lastResult;
    const [label, cssClass] = RESULT_LABELS[result.classification];

    let html = `<div class="feedback-banner ${cssClass}">${escapeHtml(label)}</div>
      <div class="your-answer-label">Escribiste</div>
      <div class="your-answer-text">${escapeHtml(result.userAnswer)}</div>`;

    if (result.aiGraded) {
      // Sin diff: la frase del alumno puede usar bien la estructura y no
      // parecerse a la de referencia, y el diff sólo marcaría diferencias.
      if (result.feedback) {
        html += `<div class="answer-note">${formatFeedbackHtml(result.feedback)}</div>`;
      }
      html += `<div class="answer-note">Respuesta de referencia:
        <strong>${escapeHtml(result.correctAlt)}</strong></div>`;
    } else {
      if (result.feedback) {
        html += `<div class="answer-note is-warning">${escapeHtml(result.feedback)}</div>`;
      }
      if (result.classification === 'correct') {
        html += `<div class="diff-line"><span class="diff-word is-match">${escapeHtml(result.correctAlt)}</span></div>`;
      } else {
        const diff = result.diffOps
          .map((op) => `<span class="diff-word is-${op.type}">${escapeHtml(op.word)}</span>`)
          .join(' ');
        html += `<div class="diff-line">${diff}</div>
          <div class="answer-note">Respuesta esperada: <strong>${escapeHtml(result.correctAlt)}</strong></div>`;
      }
    }

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

  function emptyState(title, body) {
    return `<div class="empty-state"><div class="big">${escapeHtml(title)}</div>${escapeHtml(body)}</div>`;
  }

  async function checkAnswer() {
    if (state.phase !== 'answer') return;

    const input = $('#grammarInput', el.zone);
    const value = input ? input.value.trim() : '';
    if (!value) {
      if (input) input.focus();
      return;
    }

    const item = state.queue[state.index];
    const latencyMs = state.pendingLatencyMs;
    state.pendingLatencyMs = null;
    dictation.stop();

    state.checkId += 1;
    const checkId = state.checkId;
    state.phase = 'grading';
    render();

    const result = await gradeAnswer(value, item);
    if (checkId !== state.checkId) return;

    state.lastResult = result;
    if (latencyMs !== null) result.latencyMs = latencyMs;
    state.phase = 'checked';
    render();
  }

  /**
   * Corrige con IA y, si no hay, con el diff de texto de siempre.
   *
   * Al servidor sólo va el id de la estructura: el enunciado, la explicación y
   * la respuesta de referencia están en su catálogo, así que no hace falta
   * mandárselos (ni fiarse de que lleguen intactos).
   */
  async function gradeAnswer(value, item) {
    const fallback = { en: item.exerciseAnswer };
    if (!aiAvailable()) {
      return { ...evaluateAnswer(value, fallback), aiGraded: false, feedback: '' };
    }
    if (state.aiFailures >= MAX_AI_FAILURES) {
      return {
        ...evaluateAnswer(value, fallback),
        aiGraded: false,
        feedback:
          'El servidor de IA no responde, así que se ha dejado de intentar en esta sesión: ' +
          'se compara el texto contra la respuesta de referencia, que da por fallada cualquier ' +
          'otra forma válida de usar la estructura. Recarga la página para volver a probar.',
      };
    }

    try {
      const graded = await requestTask('grammar.grade', { itemId: item.id, answer: value });
      state.aiFailures = 0;
      return {
        classification: graded.classification,
        correctAlt: graded.correctAnswer,
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
          'a palabra contra la respuesta de referencia, que da por fallada cualquier otra ' +
          'forma válida de usar la estructura.',
      };
    }
  }

  async function rate(grade) {
    if (!['again', 'good', 'easy'].includes(grade)) return;

    const item = state.queue[state.index];
    state.srs[item.id] = applyGrade(state.srs[item.id] ?? newEntry(), grade);
    await store.set(KEY_SRS, state.srs);

    state.index += 1;
    state.phase = 'answer';
    state.lastResult = null;
    renderStats();
    render();
    await onActivity();
  }

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
        const input = $('#grammarInput', el.zone);
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
    const button = el.zone.querySelector('[data-action="mic"]');
    if (!button) return;
    button.textContent = dictation.isListening ? '● Escuchando' : '🎤';
    button.classList.toggle('is-recording', dictation.isListening);
  }

  function showVoiceMessage(message) {
    const box = $('#grammarVoiceMsg', el.zone);
    if (!box) return;
    box.textContent = message;
    box.hidden = message === '';
  }

  return {
    init,
    show() {
      renderStats();
      renderTabs();
      render();
    },
    hide() {
      dictation.stop();
    },
    masteredCount: () => items().filter((g) => (state.srs[g.id]?.box ?? 1) >= MAX_BOX).length,
    totalCount: () => items().length,

    /** Niveles presentes, en orden CEFR. Lo usa el filtro del Cuaderno. */
    levels,

    /**
     * Las estructuras con su nivel de dominio, para la vista de sólo lectura
     * del Cuaderno. El progreso Leitner vive aquí, así que sale de aquí.
     */
    listItems: () => items().map((item) => ({ ...item, box: state.srs[item.id]?.box ?? 1 })),

    async reset() {
      const ids =
        state.level === 'all'
          ? Object.keys(state.srs)
          : currentItems().map((g) => g.id);
      ids.forEach((id) => {
        state.srs[id] = newEntry();
      });
      await store.set(KEY_SRS, state.srs);
      renderStats();
      rebuildQueue();
      render();
      return state.level === 'all' ? 'todos los niveles' : `el nivel "${state.level}"`;
    },
  };
}
