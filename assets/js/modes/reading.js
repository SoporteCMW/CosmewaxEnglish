import { content } from '../core/config.js';
import { $, delegate, escapeHtml } from '../core/dom.js';
import { requestText } from '../core/api.js';
import { capHistory } from '../core/storage.js';
import {
  Dictation,
  cancelSpeech,
  dictationUnavailableReason,
  speak,
  speakSequence,
} from '../core/speech.js';
import { clickableWords } from '../core/ui.js';
import { normalizeWord, splitWords, wordDiff } from '../lib/text.js';

const KEY_STATS = 'read-stats';
const TROUBLE_WORDS_SHOWN = 8;

/**
 * Modo lectura: la IA genera un texto, el alumno lo lee en voz alta y se
 * comparan palabra a palabra el original y lo que entendió el reconocedor.
 *
 * Las palabras que falla se acumulan en `troubleWords` entre sesiones, que es
 * lo que convierte el ejercicio en un plan de pronunciación y no en un juego.
 */
export function createReadingMode({ store, profile, onActivity }) {
  const el = {
    stats: $('#readStatsRow'),
    body: $('#readBody'),
  };

  const state = {
    phase: 'pick', // 'pick' | 'generating' | 'reading' | 'result'
    topic: null,
    passage: '',
    transcriptFinal: '',
    transcriptInterim: '',
    resultOps: null,
    missingWords: [],
    error: '',
    stats: { history: [], troubleWords: {} },
  };

  const dictation = new Dictation({ continuous: true, interim: true });

  async function init() {
    const stored = await store.get(KEY_STATS, null);
    state.stats =
      stored && Array.isArray(stored.history) && stored.troubleWords
        ? stored
        : { history: [], troubleWords: {} };
    bindEvents();
  }

  function bindEvents() {
    delegate(el.body, 'click', '[data-action]', (event, target) => {
      const { action } = target.dataset;
      if (action === 'generate') generatePassage(target.dataset.topic);
      if (action === 'mic') toggleDictation();
      if (action === 'finish') finishReading();
      if (action === 'back') backToPicker();
      if (action === 'say-word') speak(target.dataset.word, { rate: 0.85 });
      if (action === 'say-all') speakSequence(state.missingWords);
    });
  }

  // ---- Render ----

  function render() {
    if (state.phase === 'pick' || state.phase === 'generating') {
      el.body.innerHTML = pickerHtml();
      return;
    }
    if (state.phase === 'reading') {
      el.body.innerHTML = readingHtml();
      return;
    }
    el.body.innerHTML = resultHtml();
  }

  function pickerHtml() {
    const trouble = topTroubleWords(TROUBLE_WORDS_SHOWN);
    const troubleBox = trouble.length
      ? `<div class="trouble-words-box">
           <strong>Palabras que más se te resisten:</strong>
           ${trouble.map(([word, count]) => `${escapeHtml(word)} (${count})`).join(', ')}
         </div>`
      : '';

    if (state.phase === 'generating') {
      return `${troubleBox}<div class="loading">Generando texto…</div>`;
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

    const error = state.error ? `<div class="error-box">${escapeHtml(state.error)}</div>` : '';

    return `${troubleBox}${error}${topics}`;
  }

  function topicDesc(topic) {
    // El tema "profesional" se adapta al perfil elegido; el resto no cambia.
    return topic.id === 'pro'
      ? `Un texto sobre el día a día de un perfil de ${profile.label()} en la industria cosmética.`
      : topic.desc;
  }

  function readingHtml() {
    const listening = dictation.isListening;
    const liveText = listening
      ? 'Escuchando…'
      : 'Pulsa el micrófono y lee el texto en voz alta, a tu ritmo.';

    const correctButton =
      !listening && state.transcriptFinal
        ? '<button type="button" class="read-stop-btn" data-action="finish">Corregir esta lectura</button>'
        : '';

    return `
      <div class="reading-passage">${clickableWords(state.passage, state.passage)}</div>
      <div class="read-live-transcript" id="readLive">${escapeHtml(liveText)}</div>
      ${state.error ? `<div class="error-box">${escapeHtml(state.error)}</div>` : ''}
      <div class="read-mic-row">
        <button type="button" class="read-mic-btn ${listening ? 'is-recording' : ''}" data-action="mic">
          ${listening ? '● Escuchando — pulsa para terminar' : '🎤 Empezar a leer'}
        </button>
      </div>
      ${correctButton}
      <button type="button" class="read-secondary-btn" data-action="back">Elegir otro texto</button>`;
  }

  function resultHtml() {
    // Se mantiene el diff, pero cada palabra sigue siendo marcable para el
    // cuaderno: justo las que no se entendieron son las que interesa guardar.
    const passage = state.resultOps
      .map((op) => {
        const cls = op.type === 'missing' ? 'is-missing' : 'is-match';
        const clean = op.word.replace(/^[^a-zA-Z']+/, '').replace(/[^a-zA-Z']+$/, '');
        if (!clean) return `<span class="rword ${cls}">${escapeHtml(op.word)}</span>`;
        return (
          `<span class="rword ${cls} clickable-word" data-word="${escapeHtml(clean)}" ` +
          `data-ctx="${escapeHtml(state.passage)}">${escapeHtml(op.word)}</span>`
        );
      })
      .join(' ');

    const total = state.resultOps.length;
    const missed = state.missingWords.length;
    const accuracy = total ? Math.round(((total - missed) / total) * 100) : 100;

    const chips = state.missingWords
      .map(
        (word) => `
          <span class="review-word-chip">${escapeHtml(word)}
            <button type="button" data-action="say-word" data-word="${escapeHtml(word)}" title="Escuchar">🔊</button>
          </span>`
      )
      .join('');

    const reviewBox = missed
      ? `<div class="review-words-box">
           <div class="review-words-title">Palabras a repasar — pulsa 🔊 para escucharlas</div>
           ${chips}
           <button type="button" class="check-btn" style="margin-top:10px;" data-action="say-all">
             🔊 Escuchar todas seguidas
           </button>
         </div>`
      : '<div class="review-words-box">¡Lectura perfecta! No hay palabras pendientes de repasar en este texto.</div>';

    return `
      <div class="read-summary-line">Precisión de lectura: <strong>${accuracy}%</strong>
        (${missed} de ${total} palabras a repasar)</div>
      <div class="reading-passage">${passage}</div>
      ${reviewBox}
      <button type="button" class="new-read-btn" data-action="back">Leer otro texto</button>`;
  }

  function renderStats() {
    const history = state.stats.history;
    if (!history.length) {
      el.stats.style.display = 'none';
      return;
    }
    const totalMissed = history.reduce((sum, item) => sum + item.missedCount, 0);
    const averageAccuracy = (
      (history.reduce(
        (sum, item) => sum + (item.wordCount ? (item.wordCount - item.missedCount) / item.wordCount : 1),
        0
      ) /
        history.length) *
      100
    ).toFixed(0);

    el.stats.style.display = 'grid';
    el.stats.innerHTML = `
      <div class="stat"><div class="n">${history.length}</div><div class="l">Textos leídos</div></div>
      <div class="stat"><div class="n">${escapeHtml(averageAccuracy)}%</div><div class="l">Precisión media</div></div>
      <div class="stat"><div class="n">${totalMissed}</div><div class="l">Palabras a repasar</div></div>`;
  }

  function topTroubleWords(limit) {
    return Object.entries(state.stats.troubleWords)
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit);
  }

  // ---- Ciclo del ejercicio ----

  async function generatePassage(topicId) {
    const topic = content.readingTopics.find((t) => t.id === topicId);
    if (!topic) return;

    state.topic = topic;
    state.phase = 'generating';
    state.error = '';
    render();

    try {
      const text = await requestText('reading.passage', {
        topicId,
        profileId: profile.id(),
      });
      state.passage = text.trim();
      state.transcriptFinal = '';
      state.transcriptInterim = '';
      state.phase = 'reading';
    } catch (err) {
      state.phase = 'pick';
      state.error = `No se pudo generar el texto: ${err.message}`;
    }
    render();
  }

  function backToPicker() {
    dictation.stop();
    cancelSpeech();
    state.phase = 'pick';
    state.passage = '';
    state.transcriptFinal = '';
    state.transcriptInterim = '';
    state.resultOps = null;
    state.missingWords = [];
    state.error = '';
    render();
  }

  async function finishReading() {
    dictation.stop();

    const originalWords = splitWords(state.passage);
    const spokenWords = splitWords(state.transcriptFinal);

    // Se mantiene el orden del texto original: las inserciones que sólo existen
    // en la transcripción (ruido del reconocedor) no se muestran.
    state.resultOps = wordDiff(spokenWords, originalWords).filter((op) => op.type !== 'extra');

    const missing = state.resultOps
      .filter((op) => op.type === 'missing')
      .map((op) => normalizeWord(op.word))
      .filter(Boolean);
    state.missingWords = [...new Set(missing)];

    missing.forEach((word) => {
      state.stats.troubleWords[word] = (state.stats.troubleWords[word] || 0) + 1;
    });
    state.stats.history = capHistory([
      ...state.stats.history,
      {
        ts: Date.now(),
        topic: state.topic ? state.topic.id : null,
        wordCount: state.resultOps.length,
        missedCount: state.missingWords.length,
      },
    ]);
    await store.set(KEY_STATS, state.stats);

    state.phase = 'result';
    renderStats();
    render();
    await onActivity();
  }

  // ---- Voz ----

  function toggleDictation() {
    const unavailable = dictationUnavailableReason();
    if (unavailable) {
      state.error = unavailable;
      render();
      return;
    }
    if (dictation.isListening) {
      dictation.stop();
      return;
    }

    state.transcriptFinal = '';
    state.transcriptInterim = '';
    state.error = '';

    const started = dictation.start({
      onFinal: (chunk) => {
        state.transcriptFinal += chunk;
        updateLiveTranscript();
      },
      onInterim: (chunk) => {
        state.transcriptInterim = chunk;
        updateLiveTranscript();
      },
      onError: (code, message) => {
        state.error = message;
        render();
      },
      onEnd: render,
    });
    if (started) render();
  }

  function updateLiveTranscript() {
    const live = $('#readLive', el.body);
    if (!live) return;
    live.textContent = `${state.transcriptFinal} ${state.transcriptInterim}`.trim() || 'Escuchando…';
  }

  return {
    init,
    show() {
      renderStats();
      render();
    },
    hide() {
      dictation.stop();
      cancelSpeech();
    },
    sessionCount: () => state.stats.history.length,

    async reset() {
      state.stats = { history: [], troubleWords: {} };
      await store.set(KEY_STATS, state.stats);
      renderStats();
      if (state.phase === 'pick') render();
    },
  };
}
