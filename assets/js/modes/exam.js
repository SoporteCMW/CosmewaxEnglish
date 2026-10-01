import { content } from '../core/config.js';
import { $, delegate, escapeHtml } from '../core/dom.js';
import { aiAvailable, requestTask } from '../core/api.js';
import { capHistory } from '../core/storage.js';
import { LEVELS, levelRate } from '../core/level.js';
import {
  Dictation,
  cancelSpeech,
  dictationUnavailableReason,
  isSynthesisSupported,
  speakTracked,
  toggleDictationInto,
} from '../core/speech.js';
import { confirmThenRun, createOverlay, formatFeedbackHtml, showToast } from '../core/ui.js';
import { todayStr } from '../lib/srs.js';

const KEY_HISTORY = 'exam-history';
const KEY_PROGRESS = 'exam-inprogress';
const MAX_HISTORY = 50;
const MAX_PLAYS = 2;

const SECTIONS = [
  ['reading', '📖 Reading'],
  ['listening', '🎧 Listening'],
  ['writing', '✍️ Writing'],
  ['speaking', '🗣️ Speaking'],
];

const SKILL_LABELS = {
  reading: 'Reading & UofE',
  listening: 'Listening',
  writing: 'Writing',
  speaking: 'Speaking',
};

/** Media de las 4 destrezas → nivel orientativo. */
function estimateOverallLevel(avgPct) {
  if (avgPct < 40) return 'Por debajo de B1';
  if (avgPct < 60) return 'B1';
  if (avgPct < 75) return 'B2';
  if (avgPct < 90) return 'C1';
  return 'C2';
}

const average = (scores) =>
  Math.round((scores.reading + scores.listening + scores.writing + scores.speaking) / 4);

const shuffle = (list) => [...list].sort(() => Math.random() - 0.5);

const formatDate = (ts, opts) => new Date(ts).toLocaleDateString('es-ES', opts);

/**
 * Examen de Progreso: simulacro de las 4 destrezas, inspirado en Cambridge.
 *
 * La pestaña es el panel (historial, evolución, informes); el examen en sí va
 * en un diálogo. El alumno se mueve libremente entre las 4 partes y NADA se
 * corrige hasta entregar el examen completo, como en uno real. Si sale a
 * medias, lo escrito se guarda (`exam-inprogress`) y puede retomarlo.
 *
 * Qué corrige quién:
 *  · Test de lectura: en el navegador, contra el índice correcto que trae el
 *    propio pasaje generado.
 *  · Gramática, listening, writing y speaking: en el servidor, con la IA. Las
 *    tareas de writing/speaking y los enunciados de gramática no viajan: el
 *    servidor los saca de su catálogo por nivel o por id.
 */
export function createExamMode({ store, onActivity }) {
  const el = { body: $('#examBody') };
  const overlay = createOverlay('examOverlay', () => closeExam());
  const detail = createOverlay('examDetailOverlay', () => detail.close());
  const dictation = new Dictation();
  const speakingDictation = new Dictation({ continuous: true });

  let history = [];
  let hasSavedProgress = false;

  let exam = null;
  let ui = {
    phase: 'pick', // 'pick' | 'taking' | 'grading' | 'result'
    level: 'B2',
    loadError: '',
    speaking: false,
    recording: false,
    result: null,
  };

  /** Generación en curso. Cerrar el examen invalida la respuesta pendiente. */
  let run = 0;

  // ---- Estado del examen ----

  function newExam(level) {
    const grammar = shuffle(content.grammar.filter((g) => g.level === level)).slice(0, 4);
    return {
      level,
      section: 'reading',
      readingPart: 'grammar', // 'grammar' | 'passage'
      grammar: grammar.map((g) => ({ id: g.id, prompt: g.exercisePrompt, answer: '' })),
      grammarIdx: 0,
      passage: null, // { text, questions:[{question, options, correct}] }
      passageAnswers: [null, null, null, null],
      listening: null, // { text, questions:[...] }
      listenAnswers: ['', '', '', ''],
      listenIdx: 0,
      plays: 0,
      writing: '',
      speaking: '',
    };
  }

  async function saveProgress() {
    if (!exam) return;
    await store.set(KEY_PROGRESS, { ...exam, savedAt: Date.now() });
    hasSavedProgress = true;
  }

  async function clearProgress() {
    hasSavedProgress = false;
    await store.remove(KEY_PROGRESS);
  }

  /** Vuelca lo que haya en el campo visible al estado, sin corregir nada. */
  function captureInputs() {
    if (!exam) return;
    const input = overlay.card && overlay.card.querySelector('#examInput');
    if (exam.section === 'reading' && exam.readingPart === 'grammar' && input) {
      exam.grammar[exam.grammarIdx].answer = input.value.trim();
    }
    if (exam.section === 'listening' && input) {
      exam.listenAnswers[exam.listenIdx] = input.value.trim();
    }
    const textarea = overlay.card && overlay.card.querySelector('#examWritingInput');
    if (exam.section === 'writing' && textarea) exam.writing = textarea.value;
  }

  function stopAudioAndMic() {
    cancelSpeech();
    ui.speaking = false;
    dictation.stop();
    speakingDictation.stop();
    ui.recording = false;
  }

  // ---- Abrir / cerrar ----

  function openExam() {
    if (!aiAvailable()) {
      showToast('El Examen de Progreso necesita el servidor de IA, que ahora está desactivado.');
      return;
    }
    ui.phase = 'pick';
    ui.loadError = '';
    overlay.open();
    renderOverlay();
  }

  async function closeExam() {
    captureInputs();
    stopAudioAndMic();
    run += 1;
    if (ui.phase === 'taking') {
      await saveProgress();
      showToast('Progreso del examen guardado — puedes continuarlo más tarde.');
    }
    overlay.close();
    renderPanel();
  }

  async function startExam() {
    await clearProgress();
    exam = newExam(ui.level);
    ui.phase = 'taking';
    ui.loadError = '';
    renderOverlay();
  }

  async function resumeExam() {
    const saved = await store.get(KEY_PROGRESS, null);
    if (!saved || !Array.isArray(saved.grammar)) {
      showToast('No se pudo recuperar el examen guardado. Empieza uno nuevo.');
      hasSavedProgress = false;
      renderOverlay();
      return;
    }
    exam = { ...newExam(saved.level), ...saved };
    ui.level = exam.level;
    ui.phase = 'taking';
    ui.loadError = '';
    renderOverlay();
  }

  async function discardSaved() {
    await clearProgress();
    renderOverlay();
  }

  // ---- Navegación ----

  function switchSection(section) {
    captureInputs();
    stopAudioAndMic();
    exam.section = section;
    ui.loadError = '';
    if (section === 'listening' && !exam.listening) {
      loadListening();
      return;
    }
    renderOverlay();
  }

  function moveGrammar(delta) {
    captureInputs();
    exam.grammarIdx = Math.max(0, Math.min(exam.grammar.length - 1, exam.grammarIdx + delta));
    renderOverlay();
  }

  function moveListen(delta) {
    captureInputs();
    exam.listenIdx = Math.max(0, Math.min(3, exam.listenIdx + delta));
    renderOverlay();
  }

  function goToPassage() {
    captureInputs();
    exam.readingPart = 'passage';
    if (!exam.passage) loadPassage();
    else renderOverlay();
  }

  // ---- Generación de los textos (una vez por examen) ----

  async function loadPassage() {
    ui.loadError = '';
    renderOverlay();
    const current = ++run;
    try {
      const data = await requestTask('exam.passage', { level: exam.level });
      if (current !== run) return;
      exam.passage = { text: data.passage, questions: data.questions };
      exam.passageAnswers = [null, null, null, null];
    } catch (err) {
      if (current !== run) return;
      ui.loadError = `No se pudo generar el texto de comprensión: ${err.message}`;
    }
    renderOverlay();
  }

  async function loadListening() {
    ui.loadError = '';
    renderOverlay();
    const current = ++run;
    try {
      const data = await requestTask('exam.listening', { level: exam.level });
      if (current !== run) return;
      exam.listening = { text: data.passage, questions: data.questions };
      exam.listenAnswers = ['', '', '', ''];
    } catch (err) {
      if (current !== run) return;
      ui.loadError = `No se pudo generar el audio: ${err.message}`;
    }
    renderOverlay();
  }

  function playListening() {
    if (!exam.listening || exam.plays >= MAX_PLAYS || ui.speaking || !isSynthesisSupported()) return;
    captureInputs();
    exam.plays += 1;
    ui.speaking = true;
    speakTracked(exam.listening.text, {
      rate: levelRate(exam.level),
      onEnd: () => {
        ui.speaking = false;
        if (exam && exam.section === 'listening' && overlay.isOpen()) renderOverlay();
      },
    });
    renderOverlay();
  }

  // ---- Speaking: dictado continuo que se va acumulando ----

  function toggleSpeaking() {
    const unavailable = dictationUnavailableReason();
    if (unavailable) {
      showToast(unavailable);
      return;
    }
    if (speakingDictation.isListening) {
      speakingDictation.stop();
      return;
    }
    const started = speakingDictation.start({
      onFinal: (chunk) => {
        exam.speaking += chunk;
        const live = overlay.card && overlay.card.querySelector('#examSpeakingLive');
        if (live) live.textContent = exam.speaking || 'Escuchando…';
      },
      onError: (code, message) => showToast(message),
      onEnd: () => {
        ui.recording = false;
        if (exam && exam.section === 'speaking' && overlay.isOpen()) renderOverlay();
      },
    });
    ui.recording = started;
    renderOverlay();
  }

  // ---- Entrega y corrección (una sola vez, las 4 destrezas juntas) ----

  async function gradeReading(failed) {
    const mcq = exam.passage
      ? exam.passage.questions.filter((q, i) => exam.passageAnswers[i] === q.correct).length
      : 0;
    let grammar = 0;
    try {
      const data = await requestTask('exam.grade.grammar', {
        level: exam.level,
        answers: exam.grammar.map((g) => ({ id: g.id, answer: g.answer })),
      });
      grammar = Number(data.correctCount) || 0;
    } catch (err) {
      failed.push('gramática');
    }
    const max = exam.grammar.length + 4;
    return { pct: Math.round(((grammar + mcq) / max) * 100) };
  }

  async function gradeListening(failed) {
    if (!exam.listening) return { pct: 0 };
    try {
      const data = await requestTask('exam.grade.listening', {
        level: exam.level,
        passage: exam.listening.text,
        answers: exam.listening.questions.map((question, i) => ({ question, answer: exam.listenAnswers[i] || '' })),
      });
      return { pct: Math.round(((Number(data.correctCount) || 0) / 4) * 100) };
    } catch (err) {
      failed.push('listening');
      return { pct: 0 };
    }
  }

  /** Writing y Speaking: 4 criterios de 1 a 5 → sobre 20. */
  async function gradeRubric(section, text, minWords, failed) {
    const clean = (text || '').trim();
    if (!clean || clean.split(/\s+/).length < minWords) return { pct: 0, result: { error: 'too-short' } };
    try {
      const data = await requestTask(`exam.grade.${section}`, { level: exam.level, text: clean });
      const total = Object.values(data.scores || {}).reduce((sum, n) => sum + (Number(n) || 0), 0);
      return { pct: Math.round((total / 20) * 100), result: { scores: data.scores, feedback: data.feedback || '' } };
    } catch (err) {
      failed.push(section);
      return { pct: 0, result: { error: err.message } };
    }
  }

  async function submitExam() {
    if (ui.phase !== 'taking') return;
    captureInputs();
    stopAudioAndMic();
    ui.phase = 'grading';
    renderOverlay();

    const failed = [];
    // En paralelo: son cuatro correcciones independientes.
    const [reading, listening, writing, speaking] = await Promise.all([
      gradeReading(failed),
      gradeListening(failed),
      // Menos de 15 palabras no es un texto que corregir (igual que el prototipo).
      gradeRubric('writing', exam.writing, 15, failed),
      gradeRubric('speaking', exam.speaking, 1, failed),
    ]);

    const scores = {
      reading: reading.pct,
      listening: listening.pct,
      writing: writing.pct,
      speaking: speaking.pct,
    };
    const entry = {
      id: `exam${Date.now()}`,
      ts: Date.now(),
      date: todayStr(),
      level: exam.level,
      overallLevel: estimateOverallLevel(average(scores)),
      scores,
      detail: {
        grammar: exam.grammar,
        reading: exam.passage
          ? { passage: exam.passage.text, questions: exam.passage.questions, answers: exam.passageAnswers }
          : null,
        listening: exam.listening
          ? { passage: exam.listening.text, questions: exam.listening.questions, answers: exam.listenAnswers }
          : null,
        writing: { task: content.examTasks.writing[exam.level]?.instructions || '', response: exam.writing, result: writing.result },
        speaking: { task: content.examTasks.speaking[exam.level] || '', transcript: exam.speaking, result: speaking.result },
      },
    };

    history = capHistory([...history, entry], MAX_HISTORY);
    await store.set(KEY_HISTORY, history);
    await clearProgress();
    exam = null;

    ui.result = { entry, failed };
    ui.phase = 'result';
    await onActivity();
    renderOverlay();
  }

  async function deleteAttempt(id) {
    history = history.filter((h) => h.id !== id);
    await store.set(KEY_HISTORY, history);
    detail.close();
    renderPanel();
    showToast('Intento de examen borrado.');
  }

  // ---- Pintado del diálogo ----

  function renderOverlay() {
    const card = overlay.card;
    if (!card) return;
    if (ui.phase === 'pick') card.innerHTML = pickHtml();
    if (ui.phase === 'grading') {
      card.innerHTML = '<div class="loading">Corrigiendo el examen completo — Reading, Listening, Writing y Speaking…</div>';
    }
    if (ui.phase === 'result') card.innerHTML = resultHtml();
    if (ui.phase === 'taking') {
      card.innerHTML = `
        <div class="duration-row" style="margin-bottom:16px;">
          ${SECTIONS.map(
            ([id, label]) =>
              `<button type="button" class="duration-btn ${exam.section === id ? 'is-active' : ''}"
                 data-action="section" data-section="${id}">${label}</button>`
          ).join('')}
        </div>
        <div>${sectionHtml()}</div>
        <button type="button" class="new-conv-btn" style="margin-top:16px;" data-action="submit">✅ Entregar examen completo y corregir</button>
        <button type="button" class="new-read-btn is-secondary" data-action="close">Guardar y salir por ahora</button>`;
      const input = card.querySelector('#examInput');
      if (input) input.focus();
    }
  }

  function pickHtml() {
    const resume = hasSavedProgress
      ? `<div class="pron-tip-box">Tienes un simulacro sin terminar.</div>
         <button type="button" class="new-conv-btn" data-action="resume">▶ Continuar donde lo dejaste</button>
         <button type="button" class="new-read-btn is-danger" style="margin-bottom:16px;" data-action="discard">🗑 Descartar y empezar uno nuevo</button>`
      : '';
    return `
      <div class="pron-tip-box">Simulacro orientativo de las 4 destrezas (Reading &amp; Use of English, Listening,
        Writing, Speaking), inspirado en el formato de los exámenes Cambridge — no es una certificación oficial ni
        sustituye a un examen real. Puedes moverte libremente entre las 4 partes; nada se corrige hasta que entregues
        el examen completo.</div>
      ${resume}
      <div class="scenario-group-label">Elige el nivel objetivo del simulacro</div>
      <div class="duration-row">
        ${LEVELS.map(
          (l) =>
            `<button type="button" class="duration-btn ${ui.level === l.id ? 'is-active' : ''}"
               data-action="level" data-level="${l.id}">${l.label}</button>`
        ).join('')}
      </div>
      <button type="button" class="new-conv-btn" data-action="start">▶ Empezar simulacro completo</button>
      <button type="button" class="new-read-btn is-secondary" data-action="close">Cancelar</button>`;
  }

  function loadingOrError(retryAction, loadingText) {
    return ui.loadError
      ? `<div class="error-box">${escapeHtml(ui.loadError)}</div>
         <button type="button" class="new-conv-btn" data-action="${retryAction}">Reintentar</button>`
      : `<div class="loading">${loadingText}</div>`;
  }

  function answerRow(value, placeholder) {
    return `
      <div class="answer-input-row">
        <input type="text" class="answer-input" id="examInput" value="${escapeHtml(value)}" autocomplete="off"
               placeholder="${placeholder}">
        <button type="button" class="mic-btn" data-action="mic" title="Responder por voz">🎤</button>
      </div>
      <div class="voice-msg" id="examVoiceMsg" hidden></div>`;
  }

  function navRow(prevAction, isFirst, next) {
    return `
      <div class="duration-row" style="margin-top:14px;">
        <button type="button" class="duration-btn" data-action="${prevAction}" ${isFirst ? 'disabled' : ''}>◀ Anterior</button>
        ${next}
      </div>`;
  }

  function sectionHtml() {
    if (exam.section === 'reading' && exam.readingPart === 'grammar') {
      const item = exam.grammar[exam.grammarIdx];
      if (!item) return '<div class="error-box">No hay estructuras de este nivel en el catálogo.</div>';
      const isLast = exam.grammarIdx === exam.grammar.length - 1;
      return `
        <div class="overlay-progress">Reading &amp; Use of English — parte 1 de 2 (gramática), ítem ${exam.grammarIdx + 1} de ${exam.grammar.length}</div>
        <div class="prompt-text" style="font-size:17px; margin-bottom:16px;">${escapeHtml(item.prompt)}</div>
        ${answerRow(item.answer, 'Escribe o dicta tu respuesta en inglés...')}
        ${navRow(
          'grammar-prev',
          exam.grammarIdx === 0,
          isLast
            ? '<button type="button" class="duration-btn is-active" data-action="to-passage">Ir al texto de lectura →</button>'
            : '<button type="button" class="duration-btn" data-action="grammar-next">Siguiente ▶</button>'
        )}`;
    }

    if (exam.section === 'reading') {
      if (!exam.passage) return loadingOrError('retry-passage', 'Generando texto de comprensión…');
      const questions = exam.passage.questions
        .map(
          (q, qi) => `
            <div class="answer-note" style="margin-bottom:6px; font-weight:700;">${qi + 1}. ${escapeHtml(q.question)}</div>
            <div style="margin-bottom:14px;">
              ${q.options
                .map(
                  (opt, oi) => `
                    <button type="button" class="exam-option ${exam.passageAnswers[qi] === oi ? 'is-active' : ''}"
                      data-action="choose" data-q="${qi}" data-o="${oi}">${String.fromCharCode(65 + oi)}. ${escapeHtml(opt)}</button>`
                )
                .join('')}
            </div>`
        )
        .join('');
      return `
        <div class="overlay-progress">Reading &amp; Use of English — parte 2 de 2 (comprensión lectora)</div>
        <div class="overlay-passage">${escapeHtml(exam.passage.text)}</div>
        ${questions}
        <button type="button" class="new-read-btn is-secondary" data-action="to-grammar">← Volver a la gramática</button>`;
    }

    if (exam.section === 'listening') {
      if (!exam.listening) return loadingOrError('retry-listening', 'Generando audio…');
      const used = exam.plays >= MAX_PLAYS;
      return `
        <div class="overlay-progress">Listening — pregunta ${exam.listenIdx + 1} de 4 · reproducciones usadas: ${exam.plays}/${MAX_PLAYS}</div>
        <div style="text-align:center; margin-bottom:16px;">
          <button type="button" class="listen-play-btn" data-action="play" ${used || ui.speaking ? 'disabled' : ''}>
            ${ui.speaking ? '🔊 Reproduciendo…' : '🔊 Reproducir audio'}</button>
        </div>
        <div class="prompt-text" style="font-size:16px; margin-bottom:16px;">${escapeHtml(exam.listening.questions[exam.listenIdx])}</div>
        ${answerRow(exam.listenAnswers[exam.listenIdx] || '', 'Escribe o dicta tu respuesta...')}
        ${navRow(
          'listen-prev',
          exam.listenIdx === 0,
          `<button type="button" class="duration-btn" data-action="listen-next" ${exam.listenIdx === 3 ? 'disabled' : ''}>Siguiente ▶</button>`
        )}`;
    }

    if (exam.section === 'writing') {
      return `
        <div class="overlay-progress">Writing</div>
        <div class="pron-tip-box">${escapeHtml(content.examTasks.writing[exam.level]?.instructions || '')}</div>
        <textarea id="examWritingInput" class="exam-textarea" placeholder="Escribe tu respuesta en inglés aquí...">${escapeHtml(exam.writing)}</textarea>
        <div class="answer-note">Tu texto se guarda al cambiar de parte — se corrige junto con el resto al entregar el examen completo.</div>`;
    }

    return `
      <div class="overlay-progress">Speaking</div>
      <div class="pron-tip-box">${escapeHtml(content.examTasks.speaking[exam.level] || '')}</div>
      <div class="read-live-transcript" id="examSpeakingLive">${ui.recording ? 'Escuchando…' : escapeHtml(exam.speaking || 'Pulsa el micrófono y habla.')}</div>
      <div class="read-mic-row">
        <button type="button" class="read-mic-btn ${ui.recording ? 'is-recording' : ''}" data-action="record">
          ${ui.recording ? '● Grabando — pulsa para terminar' : '🎤 Empezar a hablar'}</button>
      </div>
      ${!ui.recording && exam.speaking ? '<button type="button" class="new-read-btn is-secondary" data-action="clear-speaking">🗑 Borrar y grabar de nuevo</button>' : ''}
      <div class="answer-note" style="margin-top:10px;">Tu grabación se guarda — se corrige junto con el resto al entregar el examen completo.</div>`;
  }

  function resultHtml() {
    const { entry, failed } = ui.result;
    return `
      <div class="overlay-progress">Resultado del simulacro — orientativo, no oficial</div>
      <div class="overlay-badge">${escapeHtml(entry.overallLevel)}</div>
      <div class="answer-note" style="text-align:center; margin-bottom:18px;">Nivel general estimado (media de las 4 destrezas)</div>
      ${failed.length ? `<div class="error-box">No se pudo corregir: ${escapeHtml(failed.join(', '))}. Esa parte cuenta como 0.</div>` : ''}
      <div class="stats-row" style="margin-bottom:20px;">
        ${Object.keys(SKILL_LABELS)
          .map((k) => `<div class="stat"><div class="n">${entry.scores[k]}%</div><div class="l">${escapeHtml(SKILL_LABELS[k])}</div></div>`)
          .join('')}
      </div>
      <button type="button" class="new-conv-btn" data-action="close">Cerrar y ver informe en el panel</button>`;
  }

  // ---- Panel (la pestaña) ----

  function renderPanel() {
    if (!el.body) return;
    const newBtn = '<button type="button" class="new-conv-btn" style="margin-bottom:18px;" data-action="open">▶ Nuevo examen</button>';
    if (!history.length) {
      el.body.innerHTML = `
        <div class="empty-state">
          <div class="big">Todavía no has hecho ningún simulacro</div>
          Haz tu primer examen de progreso para empezar a ver tu evolución aquí.
        </div>${newBtn}`;
      return;
    }

    const rows = [...history]
      .reverse()
      .map(
        (h) => `
          <tr>
            <td>${formatDate(h.ts)}</td>
            <td>${escapeHtml(h.level)}</td>
            <td>${h.scores.reading}%</td>
            <td>${h.scores.listening}%</td>
            <td>${h.scores.writing}%</td>
            <td>${h.scores.speaking}%</td>
            <td><strong>${average(h.scores)}%</strong></td>
            <td>${escapeHtml(h.overallLevel)}</td>
            <td class="exam-row-actions">
              <button type="button" class="check-btn" data-action="detail" data-id="${escapeHtml(h.id)}">Ver informe</button>
              <button type="button" class="check-btn is-danger" data-action="delete" data-id="${escapeHtml(h.id)}">🗑 Borrar</button>
            </td>
          </tr>`
      )
      .join('');

    el.body.innerHTML = `
      ${newBtn}
      ${chartHtml()}
      <div class="scenario-group-label">Historial de intentos</div>
      <div class="exam-table-wrap">
        <table class="exam-table">
          <thead><tr>
            <th>Fecha</th><th>Nivel</th><th>Reading</th><th>Listening</th><th>Writing</th>
            <th>Speaking</th><th>Media</th><th>Estimado</th><th></th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`;
  }

  function chartHtml() {
    if (history.length < 2) {
      return '<div class="pron-tip-box">Haz al menos 2 simulacros para ver aquí tu gráfica de evolución.</div>';
    }
    const sorted = [...history].sort((a, b) => a.ts - b.ts);
    const w = 600;
    const h = 180;
    const pad = 30;
    const points = sorted.map((entry) => average(entry.scores));
    const step = (w - pad * 2) / (points.length - 1);
    const x = (i) => pad + i * step;
    const y = (pct) => h - pad - (pct / 100) * (h - pad * 2);
    const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${x(i)} ${y(p)}`).join(' ');
    return `
      <div class="scenario-group-label">Evolución de la media general</div>
      <svg class="exam-chart" viewBox="0 0 ${w} ${h}" role="img" aria-label="Evolución de la media general por intento">
        <line x1="${pad}" y1="${pad}" x2="${pad}" y2="${h - pad}" class="axis" />
        <line x1="${pad}" y1="${h - pad}" x2="${w - pad}" y2="${h - pad}" class="axis" />
        <path d="${path}" class="line" />
        ${points
          .map(
            (p, i) => `<circle cx="${x(i)}" cy="${y(p)}" r="4" class="dot"><title>${p}%</title></circle>
              <text x="${x(i)}" y="${h - 6}" class="label">${formatDate(sorted[i].ts, { day: '2-digit', month: '2-digit' })}</text>`
          )
          .join('')}
      </svg>`;
  }

  function rubricHtml(result, labels) {
    if (!result || result.error) {
      return `<div class="error-box">${result && result.error === 'too-short' ? 'Respuesta vacía o demasiado corta: no se corrigió.' : 'No se pudo corregir en su momento.'}</div>`;
    }
    const parts = Object.entries(labels).map(([key, label]) => `${label}: ${result.scores[key] ?? '-'}/5`);
    return `<div class="answer-note">${escapeHtml(parts.join(' · '))}</div>
      <div class="feedback-box">${formatFeedbackHtml(result.feedback)}</div>`;
  }

  function openDetail(id) {
    const entry = history.find((h) => h.id === id);
    if (!entry || !detail.card) return;
    const d = entry.detail;

    const grammar = d.grammar
      .map(
        (g, i) => `
          <div class="notebook-entry">
            <div class="notebook-word" style="font-size:13.5px;">${i + 1}. ${escapeHtml(g.prompt)}</div>
            <div class="notebook-translation">Tu respuesta: ${escapeHtml(g.answer)}</div>
            <div class="notebook-example" style="font-style:normal;">Referencia: ${escapeHtml(content.grammar.find((item) => item.id === g.id)?.exerciseAnswer || '')}</div>
          </div>`
      )
      .join('');

    const reading = d.reading
      ? `<div class="overlay-passage" style="margin-top:10px;">${escapeHtml(d.reading.passage)}</div>
         ${d.reading.questions
           .map(
             (q, i) => `
               <div class="notebook-entry">
                 <div class="notebook-word" style="font-size:13.5px;">${i + 1}. ${escapeHtml(q.question)}</div>
                 ${q.options
                   .map((opt, oi) => {
                     const mark = oi === q.correct ? ['is-right', '✓ correcta'] : oi === d.reading.answers[i] ? ['is-wrong', '✗ tu respuesta'] : ['', ''];
                     return `<div class="answer-note exam-option-result ${mark[0]}">${String.fromCharCode(65 + oi)}. ${escapeHtml(opt)} ${mark[1]}</div>`;
                   })
                   .join('')}
               </div>`
           )
           .join('')}`
      : '<div class="answer-note">No llegaste a abrir el texto de comprensión.</div>';

    const listening = d.listening
      ? d.listening.questions
          .map(
            (q, i) => `
              <div class="notebook-entry">
                <div class="notebook-word" style="font-size:13.5px;">${i + 1}. ${escapeHtml(q)}</div>
                <div class="notebook-translation">Tu respuesta: ${escapeHtml(d.listening.answers[i] || '')}</div>
              </div>`
          )
          .join('')
      : '<div class="answer-note">No llegaste a abrir el audio.</div>';

    detail.card.innerHTML = `
      <div class="overlay-progress">Informe del ${formatDate(entry.ts)} — Nivel ${escapeHtml(entry.level)} — Estimado: ${escapeHtml(entry.overallLevel)}</div>

      <div class="scenario-group-label">📖 Reading &amp; Use of English — ${entry.scores.reading}%</div>
      ${grammar}
      ${reading}

      <div class="scenario-group-label">🎧 Listening — ${entry.scores.listening}%</div>
      ${listening}

      <div class="scenario-group-label">✍️ Writing — ${entry.scores.writing}%</div>
      <div class="pron-tip-box">${escapeHtml(d.writing.task)}</div>
      <div class="exam-response">${escapeHtml(d.writing.response)}</div>
      ${rubricHtml(d.writing.result, { content: 'Content', communicativeAchievement: 'Communicative Achievement', organisation: 'Organisation', language: 'Language' })}

      <div class="scenario-group-label">🗣️ Speaking — ${entry.scores.speaking}%</div>
      <div class="pron-tip-box">${escapeHtml(d.speaking.task)}</div>
      <div class="exam-response">${escapeHtml(d.speaking.transcript)}</div>
      ${rubricHtml(d.speaking.result, { content: 'Content', fluencyCoherence: 'Fluency & Coherence', range: 'Range', accuracy: 'Accuracy' })}

      <button type="button" class="new-read-btn is-secondary" style="margin-top:14px;" data-action="close-detail">Cerrar informe</button>
      <button type="button" class="new-read-btn is-danger" data-action="delete" data-id="${escapeHtml(entry.id)}">🗑 Borrar este intento</button>`;
    detail.open();
  }

  // ---- Eventos ----

  function wire() {
    if (el.body) {
      delegate(el.body, 'click', '[data-action]', (event, target) => {
        const { action, id } = target.dataset;
        if (action === 'open') openExam();
        if (action === 'detail') openDetail(id);
        if (action === 'delete') confirmThenRun(target, () => deleteAttempt(id));
      });
    }

    if (detail.card) {
      delegate(detail.card, 'click', '[data-action]', (event, target) => {
        const { action, id } = target.dataset;
        if (action === 'close-detail') detail.close();
        if (action === 'delete') confirmThenRun(target, () => deleteAttempt(id));
      });
    }

    if (!overlay.card) return;
    delegate(overlay.card, 'click', '[data-action]', (event, target) => {
      const { action } = target.dataset;
      if (action === 'close') closeExam();
      if (action === 'level') {
        ui.level = target.dataset.level;
        renderOverlay();
      }
      if (action === 'start') startExam();
      if (action === 'resume') resumeExam();
      if (action === 'discard') confirmThenRun(target, discardSaved);
      if (action === 'section') switchSection(target.dataset.section);
      if (action === 'grammar-prev') moveGrammar(-1);
      if (action === 'grammar-next') moveGrammar(1);
      if (action === 'to-passage') goToPassage();
      if (action === 'to-grammar') {
        exam.readingPart = 'grammar';
        renderOverlay();
      }
      if (action === 'retry-passage') loadPassage();
      if (action === 'retry-listening') loadListening();
      if (action === 'choose') {
        exam.passageAnswers[Number(target.dataset.q)] = Number(target.dataset.o);
        renderOverlay();
      }
      if (action === 'play') playListening();
      if (action === 'listen-prev') moveListen(-1);
      if (action === 'listen-next') moveListen(1);
      if (action === 'record') toggleSpeaking();
      if (action === 'clear-speaking') {
        exam.speaking = '';
        renderOverlay();
      }
      if (action === 'mic') {
        toggleDictationInto(
          dictation,
          overlay.card.querySelector('#examInput'),
          target,
          overlay.card.querySelector('#examVoiceMsg')
        );
      }
      if (action === 'submit') submitExam();
    });
  }

  return {
    async init() {
      const stored = await store.get(KEY_HISTORY, null);
      history = Array.isArray(stored) ? stored : [];
      const saved = await store.get(KEY_PROGRESS, null);
      hasSavedProgress = Boolean(saved && Array.isArray(saved.grammar));
      wire();
    },
    show() {
      renderPanel();
    },
    hide() {},

    /** La destreza más floja del último intento, para "¿Qué hago hoy?". */
    lastExamSummary() {
      const last = history[history.length - 1];
      if (!last) return null;
      const [id, pct] = Object.entries(last.scores).sort((a, b) => a[1] - b[1])[0];
      return { date: last.date || todayStr(), weakestSkill: { id, pct } };
    },
  };
}
