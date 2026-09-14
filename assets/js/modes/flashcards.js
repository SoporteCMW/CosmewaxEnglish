import { categoryLabel, content, profileLabel } from '../core/config.js';
import { $, delegate, escapeHtml } from '../core/dom.js';
import { capHistory } from '../core/storage.js';
import { aiAvailable, requestTask } from '../core/api.js';
import { Dictation, dictationUnavailableReason, speak } from '../core/speech.js';
import { formatFeedbackHtml, showToast } from '../core/ui.js';
import { evaluateAnswer } from '../lib/text.js';
import { applyGrade, buildQueue, isDue, newEntry, todayStr, MAX_BOX } from '../lib/srs.js';

const KEY_DECK = 'deck';
const KEY_SRS = 'srs';
const KEY_VOICE = 'voice-stats';

/**
 * Prefijo de las pestañas que filtran por perfil profesional.
 *
 * Las tarjetas generadas guardan el perfil con el que se pidieron, y con eso el
 * mazo se puede mirar por perfil sin tocar la categoría de cada tarjeta: una
 * palabra sigue siendo "técnica" o "comercial" aunque se generase para I+D.
 */
const PROFILE_PREFIX = 'profile:';

const RESULT_LABELS = {
  correct: ['✓ Correcto', 'is-correct'],
  close: ['~ Casi — revisa el detalle', 'is-close'],
  incorrect: ['✗ Incorrecto', 'is-incorrect'],
};

/**
 * Modo tarjetas: recall activo con repetición espaciada (Leitner).
 *
 * La corrección la juzga la IA por sentido, no por coincidencia de texto: el
 * diff sólo sabía comparar contra el campo `en` de la ficha y daba por fallado
 * cualquier sinónimo válido, que es media respuesta buena de un B2. Ese diff
 * sigue ahí como respaldo y se usa tal cual si la IA está apagada o no responde,
 * así que el modo nunca se queda sin corregir; lo que se pierde en ese caso es
 * la flexibilidad, y se avisa en pantalla para que un "incorrecto" injusto se
 * entienda. Generar vocabulario a medida del perfil también necesita IA.
 */
export function createFlashcardsMode({ store, profile, onActivity }) {
  const el = {
    stats: $('#statsRow'),
    voicePanel: $('#voicePanel'),
    tabs: $('#tabs'),
    zone: $('#cardZone'),
    form: $('#addCardForm'),
    catSelect: $('#newCat'),
    formMsg: $('#addCardMsg'),
    resetLabel: $('#resetCatLabel'),
    generateBtn: $('#generateVocabBtn'),
  };

  const state = {
    deck: [],
    srs: {},
    voiceStats: { history: [] },
    category: 'all',
    queue: [],
    index: 0,
    phase: 'answer', // 'answer' | 'grading' | 'checked'
    lastResult: null,
    pendingLatencyMs: null,
    generating: false,
    /**
     * Corrección en curso. Corregir es ahora una llamada de red, y mientras
     * vuelve se puede cambiar de pestaña o reiniciar la categoría: el token
     * descarta la respuesta que ya no corresponde a lo que hay en pantalla, en
     * lugar de pintar el resultado de una ficha que se dejó atrás.
     */
    checkId: 0,
    /**
     * Fallos seguidos de la corrección con IA.
     *
     * `aiAvailable()` sólo dice si el servidor la tiene configurada, no si
     * responde. Con el sidecar caído y la configuración puesta, cada tarjeta
     * lanzaría una llamada condenada, y si el servicio cuelga en lugar de
     * rechazar la conexión son 45 segundos de espera por ficha. A los tres
     * fallos seguidos se deja de intentar durante el resto de la sesión y se
     * repasa con el diff: un acierto vuelve a poner el contador a cero, así que
     * un 429 puntual o un timeout aislado no apagan nada.
     */
    aiFailures: 0,
  };

  /** Tres fallos seguidos y se deja de llamar hasta recargar la página. */
  const MAX_AI_FAILURES = 3;

  const dictation = new Dictation();

  async function init() {
    await loadState();
    renderCategoryOptions();
    bindEvents();
    renderTabs();
    rebuildQueue();
  }

  async function loadState() {
    const stored = await store.get(KEY_DECK, null);
    state.deck = mergeSeed(Array.isArray(stored) ? stored : [], content.deck);
    if (!Array.isArray(stored) || state.deck.length !== stored.length) {
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

  /**
   * Conserva las tarjetas del alumno y sincroniza con el mazo del servidor.
   *
   * Se compara por el campo `en` y no por `id`: el mazo semilla se regenera al
   * ampliarlo y los ids se desplazan, así que emparejar por id duplicaría
   * tarjetas. Además refresca la nota de referencia, que es donde están los
   * ejemplos de uso, sin tocar el progreso Leitner ni las tarjetas propias.
   */
  function mergeSeed(storedDeck, seedDeck) {
    if (storedDeck.length === 0) return seedDeck.map((card) => ({ ...card }));

    const notesByEn = new Map(seedDeck.map((card) => [card.en, card.note]));
    const merged = storedDeck.map((card) => {
      const seedNote = notesByEn.get(card.en);
      return seedNote !== undefined && seedNote !== card.note ? { ...card, note: seedNote } : card;
    });

    const known = new Set(merged.map((card) => card.en));
    const additions = seedDeck.filter((card) => !known.has(card.en)).map((card) => ({ ...card }));

    return [...merged, ...additions];
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
      if (action === 'say-answer' && state.lastResult) {
        speak(state.lastResult.correctAlt, { rate: 0.85 });
      }
    });

    el.zone.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && event.target.id === 'answerInput') {
        event.preventDefault();
        checkAnswer();
      }
    });

    el.form.addEventListener('submit', (event) => {
      event.preventDefault();
      addFromForm();
    });

    if (el.generateBtn) {
      el.generateBtn.addEventListener('click', generateVocab);
    }
  }

  function renderCategoryOptions() {
    el.catSelect.innerHTML = content.categories
      .map(
        (cat) =>
          `<option value="${escapeHtml(cat.id)}">${escapeHtml(cat.formLabel || cat.label)}</option>`
      )
      .join('');
  }

  function renderStats() {
    const today = todayStr();
    const total = state.deck.length;
    const due = state.deck.filter((card) => isDue(state.srs[card.id], today)).length;
    const mastered = state.deck.filter((card) => (state.srs[card.id]?.box ?? 1) >= MAX_BOX).length;

    el.stats.innerHTML = [
      ['Total', total],
      ['Para hoy', due],
      ['Dominadas', mastered],
      ['En curso', total - mastered],
    ]
      .map(
        ([label, value]) =>
          `<div class="stat"><div class="n">${value}</div><div class="l">${label}</div></div>`
      )
      .join('');
  }

  /** Etiqueta de una pestaña, sea "todas", una categoría o un perfil. */
  function tabLabel(id) {
    if (id === 'all') return 'Todas';
    if (id.startsWith(PROFILE_PREFIX)) return `🪄 ${profileLabel(id.slice(PROFILE_PREFIX.length))}`;
    return categoryLabel(id);
  }

  /**
   * Una pestaña por cada perfil con vocabulario generado en el mazo.
   *
   * Sólo aparecen los perfiles que tienen tarjetas: quien no ha generado nada
   * ve exactamente las pestañas de siempre.
   */
  function profileTabs() {
    const ids = [...new Set(state.deck.map((card) => card.profile).filter(Boolean))];
    return ids.map((id) => ({ id: `${PROFILE_PREFIX}${id}`, label: tabLabel(`${PROFILE_PREFIX}${id}`) }));
  }

  function renderTabs() {
    // Las de perfil van justo antes del cuaderno, que cierra siempre la fila:
    // es el cajón de las palabras propias y no una categoría más del catálogo.
    const catalogue = content.categories.filter((cat) => cat.id !== 'personal');
    const notebook = content.categories.filter((cat) => cat.id === 'personal');
    const tabs = [{ id: 'all', label: 'Todas' }, ...catalogue, ...profileTabs(), ...notebook];

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
    if (state.category === 'all') return state.deck;
    if (state.category.startsWith(PROFILE_PREFIX)) {
      const profileId = state.category.slice(PROFILE_PREFIX.length);
      return state.deck.filter((card) => card.profile === profileId);
    }
    return state.deck.filter((card) => card.cat === state.category);
  }

  function rebuildQueue() {
    dictation.stop();
    state.pendingLatencyMs = null;
    state.checkId += 1;
    state.queue = buildQueue(currentCards(), state.srs);
    state.index = 0;
    state.phase = 'answer';
    state.lastResult = null;
  }

  function setCategory(category) {
    state.category = category;
    rebuildQueue();
    renderTabs();
    render();
    if (el.resetLabel) {
      el.resetLabel.textContent = tabLabel(category);
    }
  }

  function render() {
    if (state.queue.length === 0) {
      el.zone.innerHTML = emptyState(
        'No hay tarjetas en esta categoría',
        'Añade alguna con el formulario de abajo, o genera un lote para tu perfil.'
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

    el.zone.innerHTML = `
      <div class="card">
        <div class="card-tag">${escapeHtml(categoryLabel(card.cat))}</div>
        <div class="card-box">${dots}</div>
        <div class="prompt-label">Traduce al inglés</div>
        <div class="prompt-text">${escapeHtml(card.es)}</div>
        ${phaseHtml(card)}
      </div>`;

    if (state.phase === 'answer') {
      const input = $('#answerInput', el.zone);
      if (input) input.focus();
    }
  }

  function phaseHtml(card) {
    if (state.phase === 'answer') return answerFormHtml();
    if (state.phase === 'grading') return '<div class="loading">Corrigiendo con IA…</div>';
    return resultHtml(card);
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

    if (result.aiGraded) {
      // Sin diff de palabras: la respuesta puede ser válida y no parecerse a la
      // de la ficha, y entonces un diff sólo señalaría diferencias que no son
      // fallos. Lo que hace falta es la forma buena y las otras que valen.
      if (result.feedback) {
        html += `<div class="answer-note">${formatFeedbackHtml(result.feedback)}</div>`;
      }
      html += `<div class="answer-note">✓ Forma más adecuada:
        <strong>${escapeHtml(result.correctAlt)}</strong></div>`;
      if (result.alternatives.length) {
        html += `<div class="answer-note">También válido: ${result.alternatives
          .map((alt) => `<em>"${escapeHtml(alt)}"</em>`)
          .join(', ')}</div>`;
      }
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

    if (card.note) html += `<div class="answer-note">${escapeHtml(card.note)}</div>`;
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

  async function checkAnswer() {
    if (state.phase !== 'answer') return;

    const input = $('#answerInput', el.zone);
    const value = input ? input.value.trim() : '';
    if (!value) {
      if (input) input.focus();
      return;
    }

    const card = state.queue[state.index];
    // El tiempo de respuesta oral se aparta antes de esperar a la corrección: lo
    // que mide es lo que tardó el alumno en hablar, no lo que tarda la IA.
    const latencyMs = state.pendingLatencyMs;
    state.pendingLatencyMs = null;
    dictation.stop();

    state.checkId += 1;
    const checkId = state.checkId;
    state.phase = 'grading';
    render();

    const result = await gradeAnswer(value, card);
    if (checkId !== state.checkId) return;

    state.lastResult = result;
    if (latencyMs !== null) {
      result.latencyMs = latencyMs;
      recordVoiceStat(result.classification, latencyMs);
    }
    state.phase = 'checked';
    render();
  }

  /**
   * Corrige con IA y, si no hay, con el diff de texto de siempre.
   *
   * Con la IA apagada en el servidor no se avisa de nada: es la configuración
   * elegida, no una avería, y un cartel en cada tarjeta sería ruido. Si la IA
   * está encendida pero falla, sí se dice — porque entonces la corrección es
   * menos flexible de lo que el alumno espera y conviene que lo sepa antes de
   * discutir con un "incorrecto".
   */
  async function gradeAnswer(value, card) {
    if (!aiAvailable()) {
      return { ...evaluateAnswer(value, card), aiGraded: false, feedback: '' };
    }
    if (state.aiFailures >= MAX_AI_FAILURES) {
      return {
        ...evaluateAnswer(value, card),
        aiGraded: false,
        feedback:
          'El servidor de IA no responde, así que se ha dejado de intentar en esta sesión: ' +
          'se corrige comparando el texto palabra a palabra, que es menos flexible con las ' +
          'alternativas válidas. Recarga la página para volver a probar.',
      };
    }

    try {
      const graded = await requestTask('flashcards.grade', {
        spanish: card.es,
        target: card.en,
        note: card.note || '',
        answer: value,
      });
      state.aiFailures = 0;
      return {
        classification: graded.classification,
        correctAlt: graded.bestAnswer,
        alternatives: graded.alternatives,
        feedback: graded.feedback,
        diffOps: null,
        userAnswer: value,
        aiGraded: true,
      };
    } catch (err) {
      state.aiFailures += 1;
      return {
        ...evaluateAnswer(value, card),
        aiGraded: false,
        feedback:
          `No se pudo corregir con IA (${err.message}). Se ha comparado el texto palabra ` +
          'a palabra, que es menos flexible con las alternativas válidas.',
      };
    }
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
    render();
    await onActivity();
  }

  /**
   * Añade una tarjeta al mazo y la deja lista para repasar hoy.
   *
   * `profile` sólo lo traen las tarjetas generadas por la IA: es el perfil con
   * el que se pidieron, y de ahí sale su pestaña.
   */
  async function addCard({ cat, es, en, note, profile: profileId }) {
    const card = {
      id: `u${Date.now()}${Math.floor(Math.random() * 1000)}`,
      cat,
      es,
      en,
      note: note || '',
      ...(profileId ? { profile: profileId } : {}),
    };
    state.deck.push(card);
    state.srs[card.id] = newEntry();
    await store.set(KEY_DECK, state.deck);
    await store.set(KEY_SRS, state.srs);

    return card;
  }

  async function addFromForm() {
    const es = $('#newEs').value.trim();
    const en = $('#newEn').value.trim();
    if (!es || !en) {
      setFormMessage('Rellena al menos el español y el inglés.', true);
      return;
    }

    await addCard({
      cat: el.catSelect.value,
      es,
      en,
      note: $('#newNote').value.trim(),
    });

    $('#newEs').value = '';
    $('#newEn').value = '';
    $('#newNote').value = '';
    setFormMessage(`Guardada: "${es}".`, false);

    renderStats();
    rebuildQueue();
    render();
  }

  function setFormMessage(message, isError) {
    el.formMsg.textContent = message;
    el.formMsg.classList.toggle('is-error', Boolean(isError));
  }

  /** Lote de vocabulario a medida del perfil activo. Requiere IA. */
  async function generateVocab() {
    if (state.generating) return;
    state.generating = true;
    if (el.generateBtn) el.generateBtn.disabled = true;
    showToast(`Generando vocabulario para ${profile.label()}… puede tardar un minuto.`, 20000);

    try {
      const data = await requestTask('vocab.generate', {
        profileId: profile.id(),
        existingTerms: state.deck.map((card) => card.en),
      });

      const known = new Set(state.deck.map((card) => card.en.toLowerCase()));
      let added = 0;
      for (const item of data.items) {
        if (known.has(item.en.toLowerCase())) continue;
        known.add(item.en.toLowerCase());
        // eslint-disable-next-line no-await-in-loop
        await addCard({ ...item, profile: profile.id() });
        added += 1;
      }

      renderStats();
      if (added > 0) {
        // Deja delante la pestaña del perfil, que acaba de nacer o de crecer:
        // buscar a mano dónde han caído treinta palabras nuevas no tiene gracia.
        setCategory(`${PROFILE_PREFIX}${profile.id()}`);
      } else {
        rebuildQueue();
        render();
      }
      showToast(
        added > 0
          ? `${added} palabras nuevas añadidas para ${profile.label()}. ` +
              'Puedes pulsar el botón otra vez para generar más.'
          : 'No había nada nuevo que añadir: ya tienes todo ese vocabulario.'
      );
    } catch (err) {
      showToast(`No se pudo generar el vocabulario: ${err.message}`);
    } finally {
      state.generating = false;
      if (el.generateBtn) el.generateBtn.disabled = false;
    }
  }

  return {
    init,
    show() {
      renderStats();
      renderVoicePanel();
      render();
    },
    hide() {
      dictation.stop();
    },

    addCard,
    deckSize: () => state.deck.length,

    /**
     * El mazo con su nivel de dominio, para la vista de sólo lectura del
     * Cuaderno. Se sirve desde aquí y no desde el `store` porque el mazo vivo
     * incluye las tarjetas propias y las generadas, que no están en el catálogo
     * que inyecta `index.php`.
     */
    listCards: () =>
      state.deck.map((card) => ({ ...card, box: state.srs[card.id]?.box ?? 1 })),

    masteredCount: () =>
      state.deck.filter((card) => (state.srs[card.id]?.box ?? 1) >= MAX_BOX).length,

    /** Reinicia el progreso de la categoría visible. Devuelve su descripción. */
    async reset() {
      const ids =
        state.category === 'all'
          ? Object.keys(state.srs)
          : currentCards().map((card) => card.id);
      ids.forEach((id) => {
        state.srs[id] = newEntry();
      });
      await store.set(KEY_SRS, state.srs);

      renderStats();
      rebuildQueue();
      render();

      return state.category === 'all' ? 'todas las categorías' : `"${tabLabel(state.category)}"`;
    },
  };
}
