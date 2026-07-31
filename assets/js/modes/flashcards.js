import { categoryLabel, content } from '../core/config.js';
import { $, delegate, escapeHtml } from '../core/dom.js';
import { capHistory } from '../core/storage.js';
import { Dictation, dictationUnavailableReason } from '../core/speech.js';
import { evaluateAnswer } from '../lib/text.js';
import { applyGrade, buildQueue, isDue, newEntry, todayStr, MAX_BOX } from '../lib/srs.js';

const KEY_DECK = 'deck';
const KEY_SRS = 'srs';
const KEY_VOICE = 'voice-stats';

const RESULT_LABELS = {
  correct: ['✓ Correcto', 'is-correct'],
  close: ['~ Casi — revisa el detalle', 'is-close'],
  incorrect: ['✗ Incorrecto', 'is-incorrect'],
};

/**
 * Modo tarjetas: recall activo con repetición espaciada (Leitner).
 *
 * Es el único modo que funciona sin API key, así que no depende de `core/api`.
 */
export function createFlashcardsMode({ store }) {
  const el = {
    stats: $('#statsRow'),
    voicePanel: $('#voicePanel'),
    tabs: $('#tabs'),
    zone: $('#cardZone'),
    form: $('#addCardForm'),
    catSelect: $('#newCat'),
    formMsg: $('#addCardMsg'),
    reset: $('#resetProgress'),
  };

  const state = {
    deck: [],
    srs: {},
    voiceStats: { history: [] },
    category: 'all',
    queue: [],
    index: 0,
    phase: 'answer', // 'answer' | 'checked'
    lastResult: null,
    pendingLatencyMs: null,
  };

  const dictation = new Dictation({ continuous: false, interim: false });

  async function init() {
    await loadState();
    renderCategoryOptions();
    bindEvents();
    renderStats();
    renderVoicePanel();
    renderTabs();
    rebuildQueue();
    renderCard();
  }

  async function loadState() {
    const stored = await store.get(KEY_DECK, null);
    state.deck = mergeSeed(Array.isArray(stored) ? stored : [], content.deck);
    if (!Array.isArray(stored) || state.deck.length !== stored.length) {
      // Primera ejecución, o el mazo semilla de `data/deck.json` ha crecido.
      await store.set(KEY_DECK, state.deck);
    }

    state.srs = await store.get(KEY_SRS, {});
    let srsChanged = false;
    state.deck.forEach((card) => {
      if (!state.srs[card.id]) {
        state.srs[card.id] = newEntry();
        srsChanged = true;
      }
    });
    if (srsChanged) await store.set(KEY_SRS, state.srs);

    const voice = await store.get(KEY_VOICE, null);
    state.voiceStats = voice && Array.isArray(voice.history) ? voice : { history: [] };
  }

  /** Conserva las tarjetas del alumno y añade las nuevas del mazo del servidor. */
  function mergeSeed(storedDeck, seedDeck) {
    if (storedDeck.length === 0) return seedDeck.map((card) => ({ ...card }));
    const known = new Set(storedDeck.map((card) => card.id));
    const additions = seedDeck.filter((card) => !known.has(card.id)).map((card) => ({ ...card }));
    return [...storedDeck, ...additions];
  }

  function bindEvents() {
    delegate(el.tabs, 'click', '[data-category]', (event, target) => {
      setCategory(target.dataset.category);
    });

    delegate(el.zone, 'click', '[data-action]', (event, target) => {
      const { action } = target.dataset;
      if (action === 'check') checkAnswer();
      if (action === 'mic') toggleDictation();
      if (action === 'rate') rate(target.dataset.grade);
    });

    el.zone.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && event.target.id === 'answerInput') {
        event.preventDefault();
        checkAnswer();
      }
    });

    el.form.addEventListener('submit', (event) => {
      event.preventDefault();
      addCard();
    });

    el.reset.addEventListener('click', resetProgress);
  }

  function renderCategoryOptions() {
    el.catSelect.innerHTML = content.categories
      .map((cat) => `<option value="${escapeHtml(cat.id)}">${escapeHtml(cat.formLabel || cat.label)}</option>`)
      .join('');
  }

  function renderStats() {
    const today = todayStr();
    const total = state.deck.length;
    const due = state.deck.filter((card) => isDue(state.srs[card.id], today)).length;
    const mastered = state.deck.filter((card) => (state.srs[card.id]?.box ?? 1) >= MAX_BOX).length;

    el.stats.innerHTML = [
      statCell(total, 'Total'),
      statCell(due, 'Para hoy'),
      statCell(mastered, 'Dominadas'),
      statCell(total - mastered, 'En curso'),
    ].join('');
  }

  function statCell(value, label) {
    return `<div class="stat"><div class="n">${escapeHtml(value)}</div><div class="l">${escapeHtml(label)}</div></div>`;
  }

  function renderTabs() {
    const tabs = [{ id: 'all', label: 'Todas' }, ...content.categories];
    el.tabs.innerHTML = tabs
      .map(
        (tab) =>
          `<button type="button" class="tab ${state.category === tab.id ? 'is-active' : ''}"
             data-category="${escapeHtml(tab.id)}">${escapeHtml(tab.label)}</button>`
      )
      .join('');
  }

  function renderVoicePanel() {
    const history = state.voiceStats.history;
    if (!history.length) {
      el.voicePanel.style.display = 'none';
      return;
    }
    const averageSeconds = (list) =>
      (list.reduce((sum, item) => sum + item.latencyMs, 0) / list.length / 1000).toFixed(1);

    el.voicePanel.style.display = 'grid';
    el.voicePanel.innerHTML = `
      <div class="voice-stat"><span class="n">${averageSeconds(history.slice(-10))}s</span><span class="l">Media últimas 10 (voz)</span></div>
      <div class="voice-stat"><span class="n">${averageSeconds(history)}s</span><span class="l">Media histórica</span></div>
      <div class="voice-stat"><span class="n">${history.length}</span><span class="l">Respuestas orales</span></div>`;
  }

  function currentCards() {
    return state.category === 'all'
      ? state.deck
      : state.deck.filter((card) => card.cat === state.category);
  }

  function rebuildQueue() {
    dictation.stop();
    state.pendingLatencyMs = null;
    state.queue = buildQueue(currentCards(), state.srs);
    state.index = 0;
    state.phase = 'answer';
    state.lastResult = null;
  }

  function setCategory(category) {
    state.category = category;
    rebuildQueue();
    renderTabs();
    renderCard();
  }

  function renderCard() {
    if (state.queue.length === 0) {
      el.zone.innerHTML = emptyState(
        'No hay tarjetas en esta categoría',
        'Añade alguna con el formulario de abajo.'
      );
      return;
    }
    if (state.index >= state.queue.length) {
      el.zone.innerHTML = emptyState(
        'Sesión completa por hoy',
        'Has repasado todas las tarjetas pendientes de esta categoría. Vuelve mañana o cambia de pestaña.'
      );
      return;
    }

    const card = state.queue[state.index];
    const box = state.srs[card.id]?.box ?? 1;
    const dots = Array.from(
      { length: MAX_BOX },
      (_, i) => `<div class="dot ${i < box ? 'is-on' : ''}"></div>`
    ).join('');

    const body = state.phase === 'answer' ? answerFormHtml() : resultHtml(card);

    el.zone.innerHTML = `
      <div class="card">
        <div class="card-tag">${escapeHtml(categoryLabel(card.cat))}</div>
        <div class="card-box">${dots}</div>
        <div class="prompt-label">Traduce al inglés</div>
        <div class="prompt-text">${escapeHtml(card.es)}</div>
        ${body}
      </div>`;

    if (state.phase === 'answer') {
      const input = $('#answerInput', el.zone);
      if (input) input.focus();
    }
  }

  function answerFormHtml() {
    return `
      <div class="answer-input-row">
        <input type="text" class="answer-input" id="answerInput" autocomplete="off"
               placeholder="Escribe o dicta tu respuesta en inglés...">
        <button type="button" class="mic-btn" data-action="mic" title="Responder por voz">🎤</button>
        <button type="button" class="check-btn" data-action="check">Corregir</button>
      </div>
      <div class="voice-msg" id="voiceMsg" hidden></div>`;
  }

  function resultHtml(card) {
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

    if (card.note) html += `<div class="answer-note">${escapeHtml(card.note)}</div>`;
    if (result.latencyMs) {
      html += `<div class="answer-note">🎙 Tiempo hasta responder: <strong>${(result.latencyMs / 1000).toFixed(1)}s</strong></div>`;
    }

    return `${html}
      <div class="rate-row">
        <button type="button" class="rate-btn is-again" data-action="rate" data-grade="again">Otra vez</button>
        <button type="button" class="rate-btn is-good" data-action="rate" data-grade="good">Bien</button>
        <button type="button" class="rate-btn is-easy" data-action="rate" data-grade="easy">Fácil</button>
      </div>`;
  }

  function emptyState(title, body) {
    return `<div class="empty-state"><div class="big">${escapeHtml(title)}</div>${escapeHtml(body)}</div>`;
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
        const input = $('#answerInput', el.zone);
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
    const box = $('#voiceMsg', el.zone);
    if (!box) return;
    box.textContent = message;
    box.hidden = message === '';
  }

  async function recordVoiceStat(classification, latencyMs) {
    state.voiceStats.history = capHistory([
      ...state.voiceStats.history,
      { ts: Date.now(), latencyMs, classification },
    ]);
    await store.set(KEY_VOICE, state.voiceStats);
    renderVoicePanel();
  }

  // ---- Acciones ----

  function checkAnswer() {
    const input = $('#answerInput', el.zone);
    const value = input ? input.value.trim() : '';
    if (!value) {
      if (input) input.focus();
      return;
    }

    const card = state.queue[state.index];
    state.lastResult = evaluateAnswer(value, card);

    if (state.pendingLatencyMs !== null) {
      state.lastResult.latencyMs = state.pendingLatencyMs;
      recordVoiceStat(state.lastResult.classification, state.pendingLatencyMs);
      state.pendingLatencyMs = null;
    }

    state.phase = 'checked';
    renderCard();
  }

  async function rate(grade) {
    if (!['again', 'good', 'easy'].includes(grade)) return;

    const card = state.queue[state.index];
    state.srs[card.id] = applyGrade(state.srs[card.id] ?? newEntry(), grade);
    await store.set(KEY_SRS, state.srs);

    state.index += 1;
    state.phase = 'answer';
    state.lastResult = null;
    renderStats();
    renderCard();
  }

  async function addCard() {
    const cat = el.catSelect.value;
    const es = $('#newEs').value.trim();
    const en = $('#newEn').value.trim();
    const note = $('#newNote').value.trim();

    if (!es || !en) {
      setFormMessage('Rellena al menos el español y el inglés.', true);
      return;
    }

    const card = { id: `u${Date.now()}`, cat, es, en, note };
    state.deck.push(card);
    state.srs[card.id] = newEntry();
    await store.set(KEY_DECK, state.deck);
    await store.set(KEY_SRS, state.srs);

    $('#newEs').value = '';
    $('#newEn').value = '';
    $('#newNote').value = '';
    setFormMessage(`Guardada: "${es}".`, false);

    renderStats();
    rebuildQueue();
    renderCard();
  }

  function setFormMessage(message, isError) {
    el.formMsg.textContent = message;
    el.formMsg.classList.toggle('is-error', Boolean(isError));
  }

  async function resetProgress() {
    const confirmed = window.confirm(
      'Esto reinicia el nivel de todas las tarjetas a 1, pero no las borra. ¿Continuar?'
    );
    if (!confirmed) return;

    Object.keys(state.srs).forEach((id) => {
      state.srs[id] = newEntry();
    });
    await store.set(KEY_SRS, state.srs);

    renderStats();
    rebuildQueue();
    renderCard();
  }

  return {
    init,
    show() {
      renderStats();
      renderVoicePanel();
    },
    hide() {
      dictation.stop();
    },
  };
}
