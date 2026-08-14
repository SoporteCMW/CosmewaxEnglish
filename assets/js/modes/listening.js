import { content } from '../core/config.js';
import { $, delegate, escapeHtml } from '../core/dom.js';
import { requestTask } from '../core/api.js';
import { capHistory } from '../core/storage.js';
import {
  Dictation,
  cancelSpeech,
  dictationUnavailableReason,
  isSynthesisSupported,
  speakTracked,
} from '../core/speech.js';
import { clickableWords } from '../core/ui.js';

const KEY_STATS = 'listen-stats';

/**
 * Modo listening: la IA genera un audio y preguntas, el alumno escucha sin ver
 * el texto y responde. Cada respuesta la corrige la IA por comprensión, no por
 * corrección gramatical.
 *
 * El "audio" es la síntesis de voz del navegador leyendo el pasaje: no se
 * descarga ningún fichero, así que funciona sin coste y sin latencia de red.
 */
export function createListeningMode({ store, profile, onActivity }) {
  const el = {
    stats: $('#listenStatsRow'),
    body: $('#listenBody'),
  };

  const state = {
    phase: 'pick', // 'pick' | 'generating' | 'listening' | 'questions' | 'grading' | 'result'
    topic: null,
    passage: '',
    questions: [],
    index: 0,
    answers: [],
    speaking: false,
    textVisible: false,
    error: '',
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
      if (action === 'generate') generate(target.dataset.topic);
      if (action === 'play') togglePlayback();
      if (action === 'replay') play();
      if (action === 'toggle-text') toggleText();
      if (action === 'start-questions') startQuestions();
      if (action === 'submit') submitAnswer();
      if (action === 'mic') toggleDictation();
      if (action === 'back') backToPicker();
    });

    el.body.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && event.target.id === 'listenInput') {
        event.preventDefault();
        submitAnswer();
      }
    });
  }

  // ---- Render ----

  function render() {
    if (state.phase === 'pick' || state.phase === 'generating') {
      el.body.innerHTML = pickerHtml();
      return;
    }
    if (state.phase === 'listening') {
      el.body.innerHTML = listeningHtml();
      return;
    }
    if (state.phase === 'questions' || state.phase === 'grading') {
      el.body.innerHTML = questionsHtml();
      if (state.phase === 'questions') {
        const input = $('#listenInput', el.body);
        if (input) input.focus();
      }
      return;
    }
    el.body.innerHTML = resultHtml();
  }

  function pickerHtml() {
    const error = state.error ? `<div class="error-box">${escapeHtml(state.error)}</div>` : '';
    if (state.phase === 'generating') {
      return `${error}<div class="loading">Generando audio y preguntas…</div>`;
    }

    const topics = content.readingTopics
      .map(
        (topic) => `
          <button type="button" class="topic-btn" data-action="generate" data-topic="${escapeHtml(topic.id)}">
            <div class="stitle">${escapeHtml(topic.title)}</div>
            <div class="sdesc">${escapeHtml(topicDesc(topic))}</div>
          </button>`
      )
      .join('');

    const noSynth = isSynthesisSupported()
      ? ''
      : '<div class="alert alert-warn">Este navegador no puede reproducir voz, así que no hay audio. ' +
        'Puedes usar el modo Lectura en su lugar.</div>';

    return `${error}${noSynth}${topics}`;
  }

  function topicDesc(topic) {
    // El tema "profesional" se adapta al perfil elegido; el resto no cambia.
    return topic.id === 'pro'
      ? `Un texto sobre el día a día de un perfil de ${profile.label()} en la industria cosmética.`
      : topic.desc;
  }

  function listeningHtml() {
    return `
      <div class="listen-play-card">
        <button type="button" class="listen-play-btn ${state.speaking ? 'is-playing' : ''}" data-action="play">
          ${state.speaking ? '⏹ Detener' : '▶️ Reproducir audio'}
        </button>
        <div class="listen-play-hint">Escúchalo tantas veces como necesites.</div>
      </div>
      <div class="listen-replay-row">
        <button type="button" class="listen-replay-btn" data-action="toggle-text">
          👁 Ver texto: ${state.textVisible ? 'SÍ' : 'NO'}
        </button>
      </div>
      ${revealHtml()}
      <button type="button" class="new-read-btn" data-action="start-questions">
        Ya lo tengo — pasar a las preguntas
      </button>
      <button type="button" class="read-secondary-btn" style="margin-top:8px;" data-action="back">
        Elegir otro tema
      </button>`;
  }

  function questionsHtml() {
    const question = state.questions[state.index] || '';
    return `
      <div class="listen-progress">Pregunta ${state.index + 1} de ${state.questions.length}</div>
      <div class="listen-replay-row">
        <button type="button" class="listen-replay-btn" data-action="replay">🔊 Escuchar otra vez</button>
        <button type="button" class="listen-replay-btn" data-action="toggle-text">
          👁 Ver texto: ${state.textVisible ? 'SÍ' : 'NO'}
        </button>
      </div>
      ${revealHtml()}
      <div class="listen-question-text">${escapeHtml(question)}</div>
      ${
        state.phase === 'questions'
          ? `<div class="answer-input-row">
               <input type="text" class="answer-input" id="listenInput" autocomplete="off"
                      placeholder="Responde en español o inglés...">
               <button type="button" class="mic-btn" data-action="mic" title="Responder por voz">🎤</button>
               <button type="button" class="check-btn" data-action="submit">Enviar</button>
             </div>
             <div class="voice-msg" id="listenVoiceMsg" hidden></div>`
          : '<div class="loading">Corrigiendo…</div>'
      }
      ${state.error ? `<div class="error-box">${escapeHtml(state.error)}</div>` : ''}`;
  }

  function revealHtml() {
    return state.textVisible
      ? `<div class="listen-passage-reveal">${clickableWords(state.passage, state.passage)}</div>`
      : '';
  }

  function resultHtml() {
    const correct = state.answers.filter((a) => a.classification === 'correct').length;
    const items = state.answers
      .map((answer, i) => {
        const cls =
          answer.classification === 'correct'
            ? 'is-correct'
            : answer.classification === 'partial'
              ? 'is-close'
              : 'is-incorrect';
        const label =
          answer.classification === 'correct'
            ? '✓ Correcto'
            : answer.classification === 'partial'
              ? '~ Parcial'
              : '✗ Incorrecto';
        return `
          <div class="listen-result-item">
            <div class="feedback-banner ${cls}" style="display:inline-flex;">${label}</div>
            <div class="listen-result-q">${i + 1}. ${escapeHtml(answer.question)}</div>
            <div class="listen-result-a">Tu respuesta: "${escapeHtml(answer.userAnswer)}"</div>
            <div class="listen-result-a">${escapeHtml(answer.feedback)}</div>
          </div>`;
      })
      .join('');

    return `
      <div class="listen-score-line">${correct} / ${state.answers.length} respuestas correctas</div>
      ${items}
      <details class="listen-details">
        <summary>Ver el texto del audio</summary>
        <div class="listen-passage-reveal">${clickableWords(state.passage, state.passage)}</div>
      </details>
      <button type="button" class="new-read-btn" data-action="back">Escuchar otro audio</button>`;
  }

  function renderStats() {
    const history = state.stats.history;
    if (!history.length) {
      el.stats.style.display = 'none';
      return;
    }
    const average = (
      (history.reduce((sum, h) => sum + (h.total ? h.correctCount / h.total : 0), 0) / history.length) *
      100
    ).toFixed(0);
    const lastDate = new Date(history[history.length - 1].ts).toLocaleDateString('es-ES');

    el.stats.style.display = 'grid';
    el.stats.innerHTML = `
      <div class="stat"><div class="n">${history.length}</div><div class="l">Audios escuchados</div></div>
      <div class="stat"><div class="n">${escapeHtml(average)}%</div><div class="l">Comprensión media</div></div>
      <div class="stat"><div class="n" style="font-size:13px;">${escapeHtml(lastDate)}</div><div class="l">Última sesión</div></div>`;
  }

  // ---- Ciclo del ejercicio ----

  async function generate(topicId) {
    const topic = content.readingTopics.find((t) => t.id === topicId);
    if (!topic) return;

    state.topic = topic;
    state.phase = 'generating';
    state.error = '';
    state.textVisible = false;
    render();

    try {
      const data = await requestTask('listening.passage', {
        topicId,
        profileId: profile.id(),
      });
      state.passage = data.passage;
      state.questions = data.questions;
      state.index = 0;
      state.answers = [];
      state.phase = 'listening';
    } catch (err) {
      state.phase = 'pick';
      state.error = `No se pudo generar el audio: ${err.message}`;
    }
    render();
  }

  function play() {
    if (!isSynthesisSupported()) return;
    state.speaking = true;
    speakTracked(state.passage, {
      rate: 0.95,
      onEnd: () => {
        state.speaking = false;
        if (state.phase === 'listening') render();
      },
    });
  }

  function togglePlayback() {
    if (state.speaking) {
      cancelSpeech();
      state.speaking = false;
    } else {
      play();
    }
    render();
  }

  function toggleText() {
    state.textVisible = !state.textVisible;
    render();
  }

  function startQuestions() {
    cancelSpeech();
    state.speaking = false;
    state.phase = 'questions';
    state.index = 0;
    state.answers = [];
    render();
  }

  async function submitAnswer() {
    if (state.phase !== 'questions') return;

    const input = $('#listenInput', el.body);
    const value = input ? input.value.trim() : '';
    if (!value) {
      if (input) input.focus();
      return;
    }

    dictation.stop();
    const question = state.questions[state.index];
    state.phase = 'grading';
    state.error = '';
    render();

    try {
      const graded = await requestTask('listening.grade', {
        passage: state.passage,
        question,
        answer: value,
      });
      state.answers.push({
        question,
        userAnswer: value,
        classification: graded.classification,
        feedback: graded.feedback,
      });
    } catch (err) {
      // Se registra como no corregida, nunca se descarta la respuesta del alumno.
      state.answers.push({
        question,
        userAnswer: value,
        classification: 'incorrect',
        feedback: `No se pudo corregir automáticamente (${err.message}).`,
      });
    }

    if (state.index < state.questions.length - 1) {
      state.index += 1;
      state.phase = 'questions';
      render();
    } else {
      await finish();
    }
  }

  async function finish() {
    const correctCount = state.answers.filter((a) => a.classification === 'correct').length;
    state.stats.history = capHistory([
      ...state.stats.history,
      {
        ts: Date.now(),
        topic: state.topic ? state.topic.id : null,
        correctCount,
        total: state.answers.length,
      },
    ]);
    await store.set(KEY_STATS, state.stats);

    state.phase = 'result';
    renderStats();
    render();
    await onActivity();
  }

  function backToPicker() {
    cancelSpeech();
    dictation.stop();
    state.speaking = false;
    state.phase = 'pick';
    state.topic = null;
    state.passage = '';
    state.questions = [];
    state.index = 0;
    state.answers = [];
    state.textVisible = false;
    state.error = '';
    render();
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
      onFinal: (transcript) => {
        const input = $('#listenInput', el.body);
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
    const box = $('#listenVoiceMsg', el.body);
    if (!box) return;
    box.textContent = message;
    box.hidden = message === '';
  }

  return {
    init,
    show() {
      renderStats();
      render();
    },
    hide() {
      cancelSpeech();
      dictation.stop();
      state.speaking = false;
    },
    sessionCount: () => state.stats.history.length,

    async reset() {
      state.stats = { history: [] };
      await store.set(KEY_STATS, state.stats);
      renderStats();
      if (state.phase === 'pick') render();
    },
  };
}
