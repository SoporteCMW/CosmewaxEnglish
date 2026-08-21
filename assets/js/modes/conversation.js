import { content, findScenario, profileLabel, whoLabel } from '../core/config.js';
import { $, delegate, escapeHtml } from '../core/dom.js';
import { capHistory } from '../core/storage.js';
import { requestTask, requestText, scenariosApi } from '../core/api.js';
import { Dictation, cancelSpeech, dictationUnavailableReason, speak } from '../core/speech.js';
import { clickableWords, showToast } from '../core/ui.js';

const KEY_STATS = 'conversations';
const DURATIONS = [
  { seconds: 180, label: '3 minutos' },
  { seconds: 300, label: '5 minutos' },
  { seconds: 900, label: '15 minutos' },
  { seconds: 1800, label: '30 minutos' },
];

/**
 * Bloques del selector, en orden. El `mode` de cada grupo dice a cuál va.
 *
 * El inglés de trabajo y el de la vida diaria se practican por separado a
 * propósito: son registros distintos y en una sola lista de veintidós tarjetas
 * las situaciones cotidianas quedaban enterradas entre las llamadas de cliente.
 */
const MODE_BLOCKS = [
  { id: 'profesional', label: '💼 Modo profesional' },
  { id: 'cotidiano', label: '🌍 Modo cotidiano' },
];

/** Qué botón de generar lleva cada grupo de escenarios generados. */
const GENERATORS = {
  generado: {
    task: 'scenario.generate',
    label: '🪄 Generar un escenario para mi perfil',
    busy: 'Generando escenario…',
  },
  'generado-cotidiano': {
    task: 'scenario.everyday',
    label: '🪄 Generar una situación cotidiana nueva',
    busy: 'Generando situación…',
  },
};

/** Margen tras dictar antes de enviar solo. Cancelable con un clic o al teclear. */
const AUTOSEND_DELAY_MS = 1800;

/**
 * Modo conversación: simulacro de conversación con un interlocutor simulado.
 *
 * La transcripción es efímera (no se persiste); sólo se guarda el recuento de
 * sesiones. Los escenarios generados por IA viven en el servidor, no aquí: su
 * `context` es material de prompt (ver GeneratedScenarioRepository en PHP).
 */
export function createConversationMode({ store, profile, onActivity }) {
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
    generating: null, // id del grupo que está generando, o null
    autoSendId: null, // temporizador del envío automático tras dictar
    /**
     * Lo que hay escrito o dictado sin enviar.
     *
     * Vive en el estado y no sólo en el `<input>` porque repintar el chat
     * reconstruye el campo y se llevaría por delante su contenido. Mientras se
     * escribe no hay repintados, pero dictar provoca uno (para sacar el aviso de
     * envío automático) y cancelar provoca otro: sin esto, el turno dictado se
     * borraba justo antes de mandarse y se enviaba una cadena vacía.
     */
    draft: '',
    stats: { history: [] },
  };

  const dictation = new Dictation();

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
      if (action === 'generate') generateScenario(target.dataset.group);
      if (action === 'cancel-autosend') cancelAutoSend();
      if (action === 'say-message') speak(state.messages[Number(target.dataset.index)]?.text || '');
      if (action === 'delete-scenario') {
        event.stopPropagation();
        deleteScenario(target.dataset.scenario);
      }
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

    // Cada tecla actualiza el borrador, que es lo que sobrevive a un repintado.
    // Además, tocar el texto dictado cancela el envío automático: si se está
    // corrigiendo la transcripción, mandarla a mitad de la corrección es lo peor
    // que puede pasar. La tecla Enter la maneja el listener de arriba y envía ya.
    el.body.addEventListener('input', (event) => {
      if (event.target.id !== 'convInput') return;
      state.draft = event.target.value;
      if (state.autoSendId !== null) cancelAutoSend();
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
      const chat = $('#chatWindow', el.body);
      if (chat) chat.scrollTop = chat.scrollHeight;
      const input = $('#convInput', el.body);
      // Con un envío automático en marcha no se roba el foco: el alumno acaba de
      // hablar y el siguiente gesto esperable es cancelar, no escribir.
      if (input && state.phase === 'chat' && state.autoSendId === null) input.focus();
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

    const card = (scenario, deletable = false) => `
      <button type="button" class="scenario-card" data-action="start" data-scenario="${escapeHtml(scenario.id)}"
              style="${deletable ? 'position:relative;' : ''}">
        ${
          deletable
            ? `<span class="scenario-delete" data-action="delete-scenario"
                 data-scenario="${escapeHtml(scenario.id)}" title="Borrar este escenario">🗑</span>`
            : ''
        }
        <div class="stitle">${escapeHtml(scenario.title)}</div>
        <div class="sdesc">${escapeHtml(scenario.desc)}${
          scenario.profileLabel ? ` <em>(${escapeHtml(scenario.profileLabel)})</em>` : ''
        }</div>
      </button>`;

    const heading = (label) => `<h3 class="scenario-group-label">${label}</h3>`;
    const cardsOf = (list, deletable) => list.map((s) => card(s, deletable)).join('');

    /**
     * Los escenarios generados a medida se reparten por el perfil con el que se
     * crearon, no por el que esté activo ahora.
     *
     * Antes todos colgaban de un único titular con el perfil del momento, así
     * que al cambiar de perfil los de ayer aparecían etiquetados con el de hoy.
     * El titular no sale del catálogo de grupos porque ahí pone "para tu
     * perfil", que es justo lo que aquí deja de ser cierto.
     */
    const profileSections = (list) => {
      const ids = [...new Set(list.map((s) => s.profileId || ''))];
      return ids
        .map((id) => {
          // Los generados antes de guardar el perfil se quedan en su propio
          // grupo: no hay forma de saber con cuál se crearon.
          const label = id ? profileLabel(id) : 'un perfil sin identificar';
          return (
            heading(`🪄 Generados para ${escapeHtml(label)}`) +
            cardsOf(
              list.filter((s) => (s.profileId || '') === id),
              true
            )
          );
        })
        .join('');
    };

    const groupHtml = (group) => {
      const generator = GENERATORS[group.id];
      const list = generator
        ? content.generatedScenarios.filter((s) => s.category === group.id)
        : content.scenarios.filter((s) => s.category === group.id);

      if (!generator) {
        return list.length === 0 ? '' : heading(escapeHtml(group.label)) + cardsOf(list, false);
      }

      const busy = state.generating === group.id;
      const generateBtn = `<button type="button" class="new-conv-btn" data-action="generate"
                 data-group="${escapeHtml(group.id)}" ${state.generating ? 'disabled' : ''}>
             ${busy ? escapeHtml(generator.busy) : escapeHtml(generator.label)}
           </button>`;

      if (list.length === 0) {
        return (
          heading(escapeHtml(group.label)) +
          '<p class="sdesc" style="margin:0 0 10px;">Todavía no hay ninguno. Genera el primero.</p>' +
          generateBtn
        );
      }

      const body =
        group.id === 'generado'
          ? profileSections(list)
          : heading(escapeHtml(group.label)) + cardsOf(list, true);

      return body + generateBtn;
    };

    // Un bloque sólo se dibuja si tiene grupos: así una instalación sin el grupo
    // cotidiano sembrado sigue mostrando el selector de siempre, sin un titular
    // "Modo cotidiano" vacío debajo.
    const blocks = MODE_BLOCKS.map((block) => {
      const groups = content.scenarioGroups
        .filter((group) => (group.mode || 'profesional') === block.id)
        .map(groupHtml)
        .join('');
      return groups === '' ? '' : `<h2 class="scenario-mode-heading">${escapeHtml(block.label)}</h2>${groups}`;
    }).join('');

    return `
      <div class="duration-row">${durations}</div>
      <div class="tts-toggle-row">
        <input type="checkbox" id="ttsCheckbox" ${state.ttsEnabled ? 'checked' : ''}>
        <label for="ttsCheckbox">🔊 Leer en voz alta las frases del interlocutor</label>
      </div>
      ${blocks}`;
  }

  function chatHtml() {
    const who = whoLabel(state.scenario.category);
    const guide =
      state.scenario.initiator === 'user' && state.messages.length === 0 && state.scenario.guide
        ? `<div class="bubble is-assistant"><div class="who">Guía</div>${escapeHtml(state.scenario.guide)}</div>`
        : '';

    const bubbles = state.messages
      .map((message, index) => {
        const isAssistant = message.role === 'assistant';
        return `
          <div class="bubble ${isAssistant ? 'is-assistant' : 'is-user'}">
            <div class="who">${escapeHtml(isAssistant ? who : 'Tú')}</div>
            ${clickableWords(message.text, message.text)}
            ${
              isAssistant
                ? `<button type="button" class="bubble-speak-btn" data-action="say-message"
                     data-index="${index}" title="Escuchar de nuevo">🔊</button>`
                : ''
            }
          </div>`;
      })
      .join('');

    const thinking =
      state.phase === 'sending'
        ? '<div class="bubble is-assistant is-thinking">escribiendo…</div>'
        : '';
    const disabled = state.phase === 'sending' ? 'disabled' : '';

    const autoSend =
      state.autoSendId !== null
        ? `<div class="conv-autosend-banner">
             <span>Enviando automáticamente…</span>
             <button type="button" data-action="cancel-autosend">Cancelar / Editar</button>
             <div class="conv-autosend-track"><div class="conv-autosend-bar"></div></div>
           </div>`
        : '';

    return `
      <div class="conv-header">
        <div class="stitle">${escapeHtml(state.scenario.title)}</div>
        <div class="conv-timer ${state.timeLeft <= 30 ? 'is-urgent' : ''}">${formatTime(state.timeLeft)}</div>
      </div>
      <div class="chat-window" id="chatWindow">${guide}${bubbles}${thinking}</div>
      ${state.error ? `<div class="error-box">${escapeHtml(state.error)}</div>` : ''}
      <div class="conv-input-row">
        <input type="text" class="answer-input" id="convInput" autocomplete="off" ${disabled}
               value="${escapeHtml(state.draft)}" placeholder="Escribe o dicta tu respuesta...">
        <button type="button" class="mic-btn" data-action="mic" title="Responder por voz" ${disabled}>🎤</button>
        <button type="button" class="check-btn" data-action="send" ${disabled}>Enviar</button>
      </div>
      ${autoSend}
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
    const scenario = findScenario(scenarioId);
    if (!scenario) return;

    state.scenario = scenario;
    state.error = '';
    state.feedbackText = '';
    state.draft = '';
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
    // Sólo se actualiza el nodo del reloj: un re-render completo cada segundo
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

  /**
   * Envío automático poco después de dictar.
   *
   * Dictar y luego tener que buscar el botón de enviar rompe el ritmo de una
   * conversación hablada: se habla, se espera un momento y sigue sola. El margen
   * es cancelable — con el botón del banner o tocando el texto — porque el
   * reconocedor se equivoca y hay que poder arreglar la frase antes de mandarla.
   */
  function scheduleAutoSend() {
    clearAutoSend();
    state.autoSendId = window.setTimeout(() => {
      state.autoSendId = null;
      sendTurn();
    }, AUTOSEND_DELAY_MS);
    render();
  }

  function clearAutoSend() {
    if (state.autoSendId !== null) {
      window.clearTimeout(state.autoSendId);
      state.autoSendId = null;
    }
  }

  function cancelAutoSend() {
    clearAutoSend();
    render();
    const input = $('#convInput', el.body);
    if (input) {
      input.focus();
      // El cursor al final: se va a corregir la transcripción, no a reescribirla.
      input.setSelectionRange(input.value.length, input.value.length);
    }
  }

  async function sendTurn() {
    if (state.phase !== 'chat') return;
    clearAutoSend();

    // El campo es la fuente si existe (puede llevar tecleo aún sin evento
    // `input` procesado); si no, el borrador, que es lo que sobrevive al repintado.
    const input = $('#convInput', el.body);
    const value = (input ? input.value : state.draft).trim();
    if (!value) {
      if (input) input.focus();
      return;
    }

    dictation.stop();
    // Se limpia antes de repintar: si no, el campo reaparecería con el turno
    // que se acaba de enviar.
    state.draft = '';
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
    clearAutoSend();
    cancelSpeech();
    dictation.stop();
    state.draft = '';

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
      // Sin feedback automático se devuelve la transcripción: el trabajo del
      // alumno no se pierde por un fallo del servidor de IA.
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
    await onActivity();
  }

  function backToPicker() {
    stopTimer();
    clearAutoSend();
    cancelSpeech();
    dictation.stop();
    state.phase = 'pick';
    state.scenario = null;
    state.messages = [];
    state.feedbackText = '';
    state.draft = '';
    state.error = '';
    render();
  }

  // ---- Escenarios generados (viven en el servidor) ----

  async function generateScenario(groupId) {
    const generator = GENERATORS[groupId];
    if (!generator || state.generating) return;

    state.generating = groupId;
    render();
    showToast(
      groupId === 'generado'
        ? `Generando un escenario para ${profile.label()}…`
        : 'Generando una situación cotidiana nueva…',
      15000
    );

    try {
      // El perfil sólo viaja en el generador profesional: el cotidiano no lo usa
      // y mandarlo devolvía otra situación de trabajo.
      const payload = groupId === 'generado' ? { profileId: profile.id() } : {};
      const data = await requestTask(generator.task, payload);
      content.generatedScenarios = [data.scenario, ...content.generatedScenarios];
      showToast(`Nuevo: "${data.scenario.title}".`);
    } catch (err) {
      showToast(`No se pudo generar: ${err.message}`);
    } finally {
      state.generating = null;
      render();
    }
  }

  async function deleteScenario(id) {
    try {
      content.generatedScenarios = await scenariosApi.remove(id);
      render();
    } catch (err) {
      showToast('No se pudo borrar el escenario.');
    }
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
        // Al borrador antes de repintar: `scheduleAutoSend` redibuja el chat para
        // sacar el aviso y reconstruye el campo desde `state.draft`.
        state.draft = transcript.trim();
        const input = $('#convInput', el.body);
        if (input) input.value = state.draft;
        if (state.phase === 'chat') scheduleAutoSend();
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
      // Salir del modo pausa el reloj en lugar de perder la llamada. El envío
      // automático sí se cancela: dispararlo desde otro modo sería invisible.
      stopTimer();
      clearAutoSend();
      cancelSpeech();
      dictation.stop();
    },
    sessionCount: () => state.stats.history.length,

    async reset() {
      state.stats = { history: [] };
      await store.set(KEY_STATS, state.stats);
      renderStats();
    },
  };
}
