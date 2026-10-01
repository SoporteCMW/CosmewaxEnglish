import { delegate, escapeHtml } from './dom.js';
import { aiAvailable, requestText } from './api.js';
import { createOverlay, formatFeedbackHtml } from './ui.js';
import { todayStr } from '../lib/srs.js';

const KEY_RECOMMENDATION = 'guide-recommendation';
const KEY_ONBOARDING = 'onboarding-seen';

/**
 * Recorrido de bienvenida. Lectura describe lo que hace la aplicación, no el
 * prototipo: aquí se compara palabra a palabra, sin puntuación de la IA.
 */
const ONBOARDING_STEPS = [
  { title: '👋 Bienvenido a English Unblocked', desc: 'Una app pensada para desbloquear tu inglés hablado bajo presión, no solo para acumular vocabulario. Este recorrido rápido te muestra qué hace cada pestaña — puedes verlo de nuevo cuando quieras con el botón "❓ Guía de uso".' },
  { title: '📓 Cuaderno', desc: 'Tu centro de repaso: palabras que marcas por la app (o añades tú mismo), tu mazo de Tarjetas en modo lectura, y las estructuras de Gramática — todo con su nivel de dominio visible.' },
  { title: '📇 Tarjetas de Vocabulario', desc: 'Repaso con repetición espaciada del vocabulario técnico y comercial de Cosmewax. Corrige con IA, acepta sinónimos válidos, y te dice cuál es la forma más natural.' },
  { title: '📐 Tarjetas de Gramática', desc: '40 estructuras de B1 a C2, con explicación, ejemplos con audio, y un ejercicio de producción corregido por IA según el nivel de cada estructura.' },
  { title: '🗣️ Pronunciación', desc: 'Grupos de pares mínimos (sonidos que confunden a un hispanohablante, como TH o la vocal de "bird"). Primero identificas de oído, luego produces la palabra — con margen de tolerancia a ruido del micrófono.' },
  { title: '💬 Conversación', desc: 'Simulacros de llamada con un interlocutor de IA que responde de forma dinámica — modo profesional (clientes, proveedores) y modo cotidiano (vida diaria). Auto-envío por voz con cuenta atrás cancelable.' },
  { title: '📖 Lectura y 🎧 Listening', desc: 'Lectura: generas un texto, lo lees en voz alta, y ves qué palabras no se entendieron bien (se acumulan para repasarlas). Listening: escuchas sin ver el texto y respondes preguntas de comprensión.' },
  { title: '🎓 Examen de Progreso', desc: 'Simulacros inspirados en Cambridge (Reading & Use of English, Listening, Writing, Speaking). Navega libremente entre las 4 partes; nada se corrige hasta que entregas el examen completo. Tu panel guarda el historial y la evolución.' },
  { title: '💡 ¿Qué hago hoy?', desc: 'En la barra superior, este botón te da una recomendación diaria basada en tus datos reales (qué tienes pendiente, en qué destreza flaqueas) — y puedes preguntarle directamente en qué centrarte.' },
];

/**
 * "¿Qué hago hoy?" y el recorrido de bienvenida.
 *
 * `stats()` devuelve el estado real del alumno (pendientes de hoy, racha, la
 * destreza más floja del último examen). Sólo números y valores cerrados: el
 * servidor los vuelve a validar antes de meterlos en el prompt.
 *
 * La recomendación se cachea por día en el progreso: abrir el panel diez veces
 * no son diez llamadas a la IA.
 */
export function createGuide({ store, stats, profileId }) {
  const guideOverlay = createOverlay('guideOverlay', closeGuide);
  const onboardingOverlay = createOverlay('onboardingOverlay', () => closeOnboarding());

  const state = {
    recommendation: null, // { date, text }
    loading: false,
    error: '',
    question: '',
    answer: '',
    answerLoading: false,
    onboardingSeen: false,
    step: 0,
  };

  async function load() {
    const stored = await store.get(KEY_RECOMMENDATION, null);
    state.recommendation = stored && typeof stored.text === 'string' ? stored : null;
    state.onboardingSeen = (await store.get(KEY_ONBOARDING, false)) === true;
  }

  const payload = () => ({ stats: stats(), profileId: profileId() });

  // ---- ¿Qué hago hoy? ----

  function openGuide() {
    state.question = '';
    state.answer = '';
    state.error = '';
    guideOverlay.open();
    renderGuide();
    const fresh = state.recommendation && state.recommendation.date === todayStr();
    if (!fresh && aiAvailable()) loadRecommendation();
  }

  function closeGuide() {
    guideOverlay.close();
  }

  async function loadRecommendation() {
    state.loading = true;
    renderGuide();
    try {
      const text = await requestText('guide.daily', payload());
      state.recommendation = { date: todayStr(), text: text.trim() };
      await store.set(KEY_RECOMMENDATION, state.recommendation);
    } catch (err) {
      state.error = `No se pudo generar la recomendación: ${err.message}`;
    }
    state.loading = false;
    renderGuide();
  }

  async function ask() {
    const input = guideOverlay.card.querySelector('#guideQuestionInput');
    const value = input ? input.value.trim() : '';
    if (!value || state.answerLoading) return;
    state.question = value;
    state.answer = '';
    state.error = '';
    state.answerLoading = true;
    renderGuide();
    try {
      state.answer = (await requestText('guide.ask', { ...payload(), question: value })).trim();
    } catch (err) {
      state.error = `No se pudo generar la respuesta: ${err.message}`;
    }
    state.answerLoading = false;
    renderGuide();
  }

  function renderGuide() {
    const card = guideOverlay.card;
    if (!card) return;

    if (!aiAvailable()) {
      card.innerHTML = `
        <div class="overlay-progress">💡 ¿Qué hago hoy?</div>
        <div class="error-box">La guía necesita el servidor de IA, que ahora está desactivado.</div>
        <button type="button" class="new-read-btn is-secondary" data-action="close">Cerrar</button>`;
      return;
    }

    let rec = '';
    if (state.loading) rec = '<div class="loading">Analizando tu progreso…</div>';
    else if (state.recommendation && state.recommendation.date === todayStr()) {
      rec = `<div class="feedback-box">${formatFeedbackHtml(state.recommendation.text)}</div>`;
    }

    let answer = '';
    if (state.answerLoading) answer = '<div class="loading">Pensando la respuesta…</div>';
    else if (state.answer) {
      answer = `<div class="your-answer-label">Preguntaste</div>
        <div class="your-answer-text">${escapeHtml(state.question)}</div>
        <div class="feedback-box">${formatFeedbackHtml(state.answer)}</div>`;
    }

    card.innerHTML = `
      <div class="overlay-progress">💡 ¿Qué hago hoy?</div>
      <div class="scenario-group-label">Recomendación de hoy</div>
      ${rec}
      ${state.error ? `<div class="error-box">${escapeHtml(state.error)}</div>` : ''}
      <div class="scenario-group-label">Pregúntame algo</div>
      <div class="answer-input-row">
        <input type="text" class="answer-input" id="guideQuestionInput" autocomplete="off" maxlength="500"
               placeholder="ej. ¿en qué debería centrarme esta semana?">
        <button type="button" class="check-btn" data-action="ask" ${state.answerLoading ? 'disabled' : ''}>Preguntar</button>
      </div>
      ${answer}
      <button type="button" class="new-read-btn is-secondary" style="margin-top:16px;" data-action="close">Cerrar</button>`;
  }

  // ---- Recorrido de bienvenida ----

  function openOnboarding() {
    state.step = 0;
    onboardingOverlay.open();
    renderOnboarding();
  }

  async function closeOnboarding() {
    onboardingOverlay.close();
    if (!state.onboardingSeen) {
      state.onboardingSeen = true;
      await store.set(KEY_ONBOARDING, true);
    }
  }

  function renderOnboarding() {
    const card = onboardingOverlay.card;
    if (!card) return;
    const step = ONBOARDING_STEPS[state.step];
    const isLast = state.step === ONBOARDING_STEPS.length - 1;
    card.innerHTML = `
      <div class="overlay-progress">Paso ${state.step + 1} de ${ONBOARDING_STEPS.length}</div>
      <div class="prompt-text" style="font-size:19px; margin-bottom:10px;">${escapeHtml(step.title)}</div>
      <div class="answer-note" style="font-size:13px; line-height:1.7; margin-bottom:20px;">${escapeHtml(step.desc)}</div>
      <div class="duration-row">
        <button type="button" class="duration-btn" data-action="prev" ${state.step === 0 ? 'disabled' : ''}>◀ Anterior</button>
        <button type="button" class="duration-btn is-active" data-action="next">${isLast ? 'Terminar' : 'Siguiente ▶'}</button>
      </div>
      <button type="button" class="new-read-btn is-secondary" style="margin-top:10px;" data-action="skip">Saltar el recorrido</button>`;
  }

  if (guideOverlay.card) {
    delegate(guideOverlay.card, 'click', '[data-action]', (event, target) => {
      if (target.dataset.action === 'close') closeGuide();
      if (target.dataset.action === 'ask') ask();
    });
    guideOverlay.card.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && event.target.id === 'guideQuestionInput') {
        event.preventDefault();
        ask();
      }
    });
  }

  if (onboardingOverlay.card) {
    delegate(onboardingOverlay.card, 'click', '[data-action]', (event, target) => {
      const { action } = target.dataset;
      if (action === 'skip') closeOnboarding();
      if (action === 'prev') {
        state.step = Math.max(0, state.step - 1);
        renderOnboarding();
      }
      if (action === 'next') {
        if (state.step >= ONBOARDING_STEPS.length - 1) closeOnboarding();
        else {
          state.step += 1;
          renderOnboarding();
        }
      }
    });
  }

  return {
    load,
    openGuide,
    openOnboarding,
    /** Primera visita: el recorrido se abre solo una vez por persona. */
    showOnboardingIfNew() {
      if (!state.onboardingSeen) openOnboarding();
    },
  };
}
