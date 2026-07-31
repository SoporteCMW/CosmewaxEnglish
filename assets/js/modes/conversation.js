import { content, whoLabel } from '../core/config.js';
import { $, delegate, escapeHtml } from '../core/dom.js';
import { capHistory } from '../core/storage.js';
import { requestText } from '../core/api.js';
import { Dictation, cancelSpeech, dictationUnavailableReason, speak } from '../core/speech.js';

const KEY_STATS = 'conversations';
const DURATIONS = [
  { seconds: 180, label: '3 minutos' },
  { seconds: 240, label: '4 minutos' },
  { seconds: 300, label: '5 minutos' },
];

/**
 * Modo conversación: simulacro de llamada con un interlocutor simulado.
 *
 * Todo el estado de la llamada es efímero (no se persiste la transcripción);
 * sólo se guarda el recuento de sesiones para las estadísticas.
 */
export function createConversationMode({ store }) {
  const el = {
    stats: $('#convStatsRow'),
    body: $('#convBody'),
  };

  const state = {
    phase: 'pick', // 'pick' | 'chat' | 'sending' | 'feedback'
    scenario: null,
    durationSec: 240,
    messages: [], // { role: 'user' | 'assistant', text }
    timeLeft: 0,
    timerId: null,
    feedbackText: '',
    error: '',
    ttsEnabled: false,
    stats: { history: [] },
  };

  const dictation = new Dictation({ continuous: false, interim: false });

  async function init() {
    const stored = await store.get(KEY_STATS, null);
    state.stats = stored && Array.isArray(stored.history) ? stored : { history: [] };
    bindEvents();
  }

  function bindEvents() {
    delegate(el.body, 'click', '[data-action]', (event, target) => {
      const { action } = target.dataset;
      if (action === 'set-duration') setDuration(Number(target.dataset.seconds));
      if (action === 'start') startConversation(target.dataset.scenario);
      if (action === 'send') sendTurn();
      if (action === 'mic') toggleDictation();
      if (action === 'end') endConversation();
      if (action === 'back') backToPicker();
    });

    delegate(el.body, 'change', '#ttsCheckbox', (event, target) => {
      state.ttsEnabled = target.checked;
      if (!state.ttsEnabled) cancelSpeech();
    });

    el.body.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && event.target.id === 'convInput') {
        event.preventDefault();
        sendTurn();
      }
    });
  }

  // ---- Render ----

  function render() {
    if (state.phase === 'pick') {
      el.body.innerHTML = pickerHtml();
      return;
    }
    if (state.phase === 'chat' || state.phase === 'sending') {
      el.body.innerHTML = chatHtml();
      const window_ = $('#chatWindow', el.body);
      if (window_) window_.scrollTop = window_.scrollHeight;
      const input = $('#convInput', el.body);
      if (input && state.phase === 'chat') input.focus();
      return;
    }
    if (state.phase === 'feedback') {
      el.body.innerHTML = `
        <div class="feedback-box">${escapeHtml(state.feedbackText)}</div>
        <button type="button" class="new-conv-btn" data-action="back">Nueva conversación</button>`;
    }
  }

  function pickerHtml() {
    const durations = DURATIONS.map(
      (d) => `<button type="button" class="duration-btn ${state.durationSec === d.seconds ? 'is-active' : ''}"
                data-action="set-duration" data-seconds="${d.seconds}">${escapeHtml(d.label)}</button>`
    ).join('');

    const groups = content.scenarioGroups
      .map((group) => {
        const cards = content.scenarios
          .filter((scenario) => scenario.category === group.id)
          .map(
            (scenario) => `
              <button type="button" class="scenario-card" data-action="start" data-scenario="${escapeHtml(scenario.id)}">
                <div class="stitle">${escapeHtml(scenario.title)}</div>
                <div class="sdesc">${escapeHtml(scenario.desc)}</div>
              </button>`
          )
          .join('');
        return cards
          ? `<h3 class="scenario-group-label">${escapeHtml(group.label)}</h3>${cards}`
          : '';
      })
      .join('');

    return `
      <div class="duration-row">${durations}</div>
      <div class="tts-toggle-row">
        <input type="checkbox" id="ttsCheckbox" ${state.ttsEnabled ? 'checked' : ''}>
        <label for="ttsCheckbox">🔊 Leer en voz alta las frases del interlocutor</label>
      </div>
      ${groups}`;
  }

  function chatHtml() {
    const who = whoLabel(state.scenario.category);
    const guide =
      state.scenario.initiator === 'user' && state.messages.length === 0 && state.scenario.guide
        ? `<div class="bubble is-assistant"><div class="who">Guía</div>${escapeHtml(state.scenario.guide)}</div>`
        : '';

    const bubbles = state.messages
      .map(
        (message) => `
          <div class="bubble ${message.role === 'assistant' ? 'is-assistant' : 'is-user'}">
            <div class="who">${escapeHtml(message.role === 'assistant' ? who : 'Tú')}</div>
            ${escapeHtml(message.text)}
          </div>`
      )
      .join('');

    const thinking =
      state.phase === 'sending'
        ? '<div class="bubble is-assistant is-thinking">escribiendo…</div>'
        : '';
    const disabled = state.phase === 'sending' ? 'disabled' : '';

    return `
      <div class="conv-header">
        <div class="stitle">${escapeHtml(state.scenario.title)}</div>
        <div class="conv-timer ${state.timeLeft <= 30 ? 'is-urgent' : ''}">${formatTime(state.timeLeft)}</div>
      </div>
      <div class="chat-window" id="chatWindow">${guide}${bubbles}${thinking}</div>
      ${state.error ? `<div class="error-box">${escapeHtml(state.error)}</div>` : ''}
      <div class="conv-input-row">
        <input type="text" class="answer-input" id="convInput" autocomplete="off" ${disabled}
               placeholder="Escribe o dicta tu respuesta...">
        <button type="button" class="mic-btn" data-action="mic" title="Responder por voz" ${disabled}>🎤</button>
        <button type="button" class="check-btn" data-action="send" ${disabled}>Enviar</button>
      </div>
      <div class="voice-msg" id="convVoiceMsg" hidden></div>
      <button type="button" class="conv-end-btn" data-action="end">Terminar conversación y ver feedback</button>`;
  }

  function renderStats() {
    const history = state.stats.history;
    if (!history.length) {
      el.stats.style.display = 'none';
      return;
    }
    const averageTurns = (history.reduce((sum, item) => sum + item.turns, 0) / history.length).toFixed(1);
    const lastDate = new Date(history[history.length - 1].ts).toLocaleDateString('es-ES');

    el.stats.style.display = 'grid';
    el.stats.innerHTML = `
      <div class="stat"><div class="n">${history.length}</div><div class="l">Conversaciones</div></div>
      <div class="stat"><div class="n">${escapeHtml(averageTurns)}</div><div class="l">Turnos medios</div></div>
      <div class="stat"><div class="n" style="font-size:13px;">${escapeHtml(lastDate)}</div><div class="l">Última sesión</div></div>`;
  }

  function formatTime(totalSeconds) {
    const safe = Math.max(0, totalSeconds);
    const minutes = String(Math.floor(safe / 60)).padStart(2, '0');
    const seconds = String(safe % 60).padStart(2, '0');
    return `${minutes}:${seconds}`;
  }

  // ---- Ciclo de la llamada ----

  function setDuration(seconds) {
    if (!DURATIONS.some((d) => d.seconds === seconds)) return;
    state.durationSec = seconds;
    render();
  }

  function startConversation(scenarioId) {
    const scenario = content.scenarios.find((s) => s.id === scenarioId);
    if (!scenario) return;

    state.scenario = scenario;
    state.error = '';
    state.feedbackText = '';
    state.phase = 'chat';
    state.timeLeft = state.durationSec;
    state.messages =
      scenario.initiator === 'user' || !scenario.opening
        ? []
        : [{ role: 'assistant', text: scenario.opening }];

    render();
    if (state.ttsEnabled && state.messages.length) speak(state.messages[0].text);
    startTimer();
  }

  function startTimer() {
    stopTimer();
    // Sólo actualizamos el nodo del reloj: un re-render completo cada segundo
    // destruiría el input y el alumno perdería lo que está escribiendo.
    state.timerId = window.setInterval(() => {
      state.timeLeft -= 1;
      const timer = el.body.querySelector('.conv-timer');
      if (timer) {
        timer.textContent = formatTime(state.timeLeft);
        timer.classList.toggle('is-urgent', state.timeLeft <= 30);
      }
      if (state.timeLeft <= 0) {
        stopTimer();
        endConversation();
      }
    }, 1000);
  }

  function stopTimer() {
    if (state.timerId !== null) {
      window.clearInterval(state.timerId);
      state.timerId = null;
    }
  }

  async function sendTurn() {
    if (state.phase !== 'chat') return;

    const input = $('#convInput', el.body);
    const value = input ? input.value.trim() : '';
    if (!value) {
      if (input) input.focus();
      return;
    }

    dictation.stop();
    state.messages.push({ role: 'user', text: value });
    state.phase = 'sending';
    state.error = '';
    render();

    try {
      const reply = await requestText('conversation.reply', {
        scenarioId: state.scenario.id,
        messages: state.messages,
      });
      state.messages.push({ role: 'assistant', text: reply });
      state.phase = 'chat';
      render();
      if (state.ttsEnabled) speak(reply);
    } catch (err) {
      state.phase = 'chat';
      state.error = `${err.message} ${err.retryable ? 'Puedes reintentar enviando de nuevo.' : ''}`.trim();
      render();
    }
  }

  async function endConversation() {
    stopTimer();
    cancelSpeech();
    dictation.stop();

    const userTurns = state.messages.filter((message) => message.role === 'user').length;
    const elapsed = Math.max(0, state.durationSec - state.timeLeft);

    state.phase = 'feedback';
    state.feedbackText = 'Generando feedback…';
    render();

    try {
      state.feedbackText = await requestText('conversation.feedback', {
        scenarioId: state.scenario.id,
        messages: state.messages,
      });
    } catch (err) {
      const who = whoLabel(state.scenario.category);
      const transcript = state.messages
        .map((message) => `${message.role === 'assistant' ? who : 'Alumno'}: ${message.text}`)
        .join('\n');
      state.feedbackText =
        `No se pudo generar el feedback automático (${err.message})\n\n` +
        `Aquí tienes la transcripción para que la revises tú mismo:\n\n${transcript}`;
    }

    state.stats.history = capHistory([
      ...state.stats.history,
      { ts: Date.now(), scenarioId: state.scenario.id, durationSec: elapsed, turns: userTurns },
    ]);
    await store.set(KEY_STATS, state.stats);

    renderStats();
    render();
  }

  function backToPicker() {
    stopTimer();
    cancelSpeech();
    dictation.stop();
    state.phase = 'pick';
    state.scenario = null;
    state.messages = [];
    state.feedbackText = '';
    state.error = '';
    render();
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
      onFinal: (transcript) => {
        const input = $('#convInput', el.body);
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
    const box = $('#convVoiceMsg', el.body);
    if (!box) return;
    box.textContent = message;
    box.hidden = message === '';
  }

  return {
    init,
    show() {
      renderStats();
      render();
      // Al volver al modo se reanuda la cuenta atrás donde se dejó.
      if (state.phase === 'chat' && state.timeLeft > 0) startTimer();
    },
    hide() {
      // Salir del modo pausa el reloj en lugar de perder la llamada.
      stopTimer();
      cancelSpeech();
      dictation.stop();
    },
  };
}
