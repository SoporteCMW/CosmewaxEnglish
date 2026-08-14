import { content } from '../core/config.js';
import { $, delegate, escapeHtml } from '../core/dom.js';
import { Dictation, dictationUnavailableReason, speak } from '../core/speech.js';
import { clickableWords } from '../core/ui.js';
import { evaluateAnswer } from '../lib/text.js';
import { applyGrade, buildQueue, isDue, newEntry, todayStr, MAX_BOX } from '../lib/srs.js';

const KEY_SRS = 'grammar-srs';

const RESULT_LABELS = {
  correct: ['✓ Correcto', 'is-correct'],
  close: ['~ Casi — revisa el detalle', 'is-close'],
  incorrect: ['✗ Incorrecto', 'is-incorrect'],
};

/**
 * Modo gramática: estructuras B2-C1 con explicación, ejemplos con audio y
 * ejercicio corregido, todo con repetición espaciada.
 *
 * No usa IA: las respuestas esperadas vienen en `data/grammar.json` y se
 * corrigen con el mismo diff que las tarjetas. Junto con Tarjetas, es lo que
 * hace que la app siga siendo útil si el servidor de IA está caído.
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
    phase: 'answer', // 'answer' | 'checked'
    lastResult: null,
    pendingLatencyMs: null,
  };

  const dictation = new Dictation();

  const items = () => content.grammar;
  const levels = () => [...new Set(items().map((g) => g.level))];

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
        ${state.phase === 'answer' ? answerFormHtml() : resultHtml()}
      </div>`;

    if (state.phase === 'answer') {
      const input = $('#grammarInput', el.zone);
      if (input) input.focus();
    }
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

    if (result.classification === 'correct') {
      html += `<div class="diff-line"><span class="diff-word is-match">${escapeHtml(result.correctAlt)}</span></div>`;
    } else {
      const diff = result.diffOps
        .map((op) => `<span class="diff-word is-${op.type}">${escapeHtml(op.word)}</span>`)
        .join(' ');
      html += `<div class="diff-line">${diff}</div>
        <div class="answer-note">Respuesta esperada: <strong>${escapeHtml(result.correctAlt)}</strong></div>`;
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

  function checkAnswer() {
    const input = $('#grammarInput', el.zone);
    const value = input ? input.value.trim() : '';
    if (!value) {
      if (input) input.focus();
      return;
    }

    const item = state.queue[state.index];
    state.lastResult = evaluateAnswer(value, { en: item.exerciseAnswer });
    if (state.pendingLatencyMs !== null) {
      state.lastResult.latencyMs = state.pendingLatencyMs;
      state.pendingLatencyMs = null;
    }
    state.phase = 'checked';
    render();
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
