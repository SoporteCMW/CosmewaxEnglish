import { content } from './config.js';
import { delegate, escapeHtml } from './dom.js';
import { aiAvailable, requestTask } from './api.js';
import { Dictation, toggleDictationInto } from './speech.js';
import { createOverlay, formatFeedbackHtml, showToast } from './ui.js';

const LEVEL_ORDER = ['B1', 'B2', 'C1', 'C2'];

/**
 * Test de nivel: colocación rápida de 12 ítems, no una certificación.
 *
 * 8 de gramática (las dos primeras estructuras de cada nivel del catálogo), 3 de
 * vocabulario y 1 de comprensión lectora. Al terminar, el servidor recomienda un
 * nivel y el alumno decide si lo aplica o elige él.
 *
 * Al servidor sólo viaja `{id, answer}` por ítem: los enunciados y referencias
 * los pone él, que es quien corrige (ver TaskRouter::levelTest).
 */
export function createLevelTest({ onAccept }) {
  const overlay = createOverlay('levelTestOverlay', close);
  const dictation = new Dictation();

  const state = {
    items: [],
    index: 0,
    answers: [],
    phase: 'answer', // 'answer' | 'analyzing' | 'result'
    result: null,
    /** Análisis en curso; si se cierra el test, su respuesta se descarta. */
    run: 0,
  };

  function buildItems() {
    const items = [];
    LEVEL_ORDER.forEach((level) => {
      content.grammar
        .filter((g) => g.level === level)
        .slice(0, 2)
        .forEach((g) => items.push({ id: g.id, prompt: g.exercisePrompt }));
    });
    content.levelTest.vocab.forEach((v) => items.push({ id: v.id, prompt: `Traduce al inglés: "${v.es}"` }));
    const reading = content.levelTest.reading;
    if (reading) items.push({ id: reading.id, prompt: reading.question, passage: reading.text });
    return items;
  }

  function open() {
    if (!aiAvailable()) {
      showToast('El test de nivel necesita el servidor de IA, que ahora está desactivado.');
      return;
    }
    state.items = buildItems();
    state.index = 0;
    state.answers = [];
    state.phase = 'answer';
    state.result = null;
    overlay.open();
    render();
  }

  function close() {
    dictation.stop();
    state.run += 1;
    overlay.close();
  }

  function submitAnswer() {
    const input = overlay.card.querySelector('#levelTestInput');
    const value = input ? input.value.trim() : '';
    if (!value) {
      if (input) input.focus();
      return;
    }
    dictation.stop();
    state.answers.push({ id: state.items[state.index].id, answer: value });
    state.index += 1;
    if (state.index >= state.items.length) analyze();
    else render();
  }

  async function analyze() {
    state.phase = 'analyzing';
    render();
    const run = ++state.run;
    try {
      const data = await requestTask('leveltest.analyze', { answers: state.answers });
      if (run !== state.run) return;
      state.result = data;
    } catch (err) {
      if (run !== state.run) return;
      state.result = { error: err.message };
    }
    state.phase = 'result';
    render();
  }

  async function accept() {
    const level = state.result && state.result.recommendedLevel;
    if (level) await onAccept(level);
    close();
  }

  function render() {
    const card = overlay.card;
    if (!card) return;

    if (state.phase === 'analyzing') {
      card.innerHTML = '<div class="loading">Analizando tus respuestas…</div>';
      return;
    }

    if (state.phase === 'result') {
      const r = state.result;
      if (!r || r.error) {
        card.innerHTML = `
          <div class="overlay-progress">Test de nivel</div>
          <div class="error-box">No se pudo analizar el test${r && r.error ? `: ${escapeHtml(r.error)}` : ''}. Inténtalo de nuevo más tarde.</div>
          <button type="button" class="new-read-btn is-secondary" data-action="close">Cerrar</button>`;
        return;
      }
      card.innerHTML = `
        <div class="overlay-progress">Resultado orientativo — no es una certificación oficial</div>
        <div class="overlay-badge">${escapeHtml(r.recommendedLevel)}</div>
        <div class="answer-note" style="margin-bottom:16px; text-align:center;">Nivel recomendado para empezar</div>
        <div class="feedback-box">${formatFeedbackHtml(r.explanation || '')}</div>
        <button type="button" class="new-conv-btn" data-action="accept">Usar este nivel (${escapeHtml(r.recommendedLevel)})</button>
        <button type="button" class="new-read-btn is-secondary" data-action="close">Elegir el nivel yo mismo</button>`;
      return;
    }

    const item = state.items[state.index];
    const isLast = state.index === state.items.length - 1;
    card.innerHTML = `
      <div class="overlay-progress">Ítem ${state.index + 1} de ${state.items.length}</div>
      ${item.passage ? `<div class="overlay-passage">${escapeHtml(item.passage)}</div>` : ''}
      <div class="prompt-text" style="font-size:17px; margin-bottom:16px;">${escapeHtml(item.prompt)}</div>
      <div class="answer-input-row">
        <input type="text" class="answer-input" id="levelTestInput" autocomplete="off"
               placeholder="Escribe o dicta tu respuesta en inglés...">
        <button type="button" class="mic-btn" data-action="mic" title="Responder por voz">🎤</button>
        <button type="button" class="check-btn" data-action="next">${isLast ? 'Terminar' : 'Siguiente'}</button>
      </div>
      <div class="voice-msg" id="levelTestVoiceMsg" hidden></div>
      <button type="button" class="new-read-btn is-secondary" style="margin-top:14px;" data-action="close">Cancelar test</button>`;
    const input = card.querySelector('#levelTestInput');
    if (input) input.focus();
  }

  if (overlay.card) {
    delegate(overlay.card, 'click', '[data-action]', (event, target) => {
      const { action } = target.dataset;
      if (action === 'close') close();
      if (action === 'next') submitAnswer();
      if (action === 'accept') accept();
      if (action === 'mic') {
        toggleDictationInto(
          dictation,
          overlay.card.querySelector('#levelTestInput'),
          target,
          overlay.card.querySelector('#levelTestVoiceMsg')
        );
      }
    });
    overlay.card.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && event.target.id === 'levelTestInput') {
        event.preventDefault();
        submitAnswer();
      }
    });
  }

  return { open };
}
