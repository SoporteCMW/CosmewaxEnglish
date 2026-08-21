import { content, findPairGroup } from '../core/config.js';
import { $, delegate, escapeHtml } from '../core/dom.js';
import { aiAvailable, requestTask } from '../core/api.js';
import {
  Dictation,
  cancelSpeech,
  dictationUnavailableReason,
  isSynthesisSupported,
  speak,
} from '../core/speech.js';
import { showToast } from '../core/ui.js';
import { levenshtein, normalize } from '../lib/text.js';

const KEY_STATS = 'pron-stats';
const KEY_GENERATED = 'generated-pairs';

/** Marcador vacío de un grupo de sonidos. */
const emptyGroupStat = () => ({ correctDisc: 0, totalDisc: 0, correctProd: 0, totalProd: 0 });

/**
 * Modo pronunciación: pares mínimos, en dos fases por par.
 *
 * 1. **Discriminación.** Se reproduce una de las dos palabras y hay que decir
 *    cuál era. Va primero a propósito: un sonido que no se distingue de oído no
 *    se puede corregir al hablar, y el orden inverso sólo produce frustración.
 * 2. **Producción.** Se muestra una de las dos y el alumno la dice. Se compara
 *    con lo que entendió el reconocedor, así que la corrección la da el mismo
 *    juez que le va a entender en una llamada real.
 *
 * Que el reconocedor devuelva la otra palabra del par no es un fallo suyo: es
 * exactamente el error que se está practicando, y por eso se distingue de "no se
 * ha entendido nada" ("confusion" vs "unclear").
 *
 * El ejercicio funciona sin IA. Sólo generar pares nuevos la necesita, y su
 * fallo no afecta a los 45 pares del catálogo.
 */
export function createPronunciationMode({ store, onActivity }) {
  const el = {
    stats: $('#pronStatsRow'),
    body: $('#pronBody'),
  };

  const state = {
    phase: 'pick', // 'pick' | 'practice' | 'summary'
    groupId: null,
    queue: [],
    index: 0,
    step: 'discrimination', // 'discrimination' | 'production'
    discTarget: 'a',
    discResult: null, // null | 'correct' | 'incorrect'
    prodTarget: 'a',
    prodResult: null, // null | { classification, target, other }
    session: { disc: 0, discTotal: 0, prod: 0, prodTotal: 0 },
    stats: { groups: {} },
    generated: {}, // { [groupId]: [{ a, b }] }
    generating: null, // id del grupo que se está ampliando
  };

  const dictation = new Dictation();

  async function init() {
    const stats = await store.get(KEY_STATS, null);
    const groups = stats && typeof stats.groups === 'object' && stats.groups !== null ? stats.groups : {};
    // Se completan los cuatro contadores al cargar: un marcador escrito por una
    // versión anterior con menos campos convertiría cualquier suma en NaN, y eso
    // se vería como "NaN%" en las estadísticas en lugar de fallar a la vista.
    state.stats = {
      groups: Object.fromEntries(
        Object.entries(groups).map(([id, stat]) => [id, { ...emptyGroupStat(), ...stat }])
      ),
    };

    const generated = await store.get(KEY_GENERATED, null);
    state.generated = generated && typeof generated === 'object' ? generated : {};

    bindEvents();
  }

  function bindEvents() {
    delegate(el.body, 'click', '[data-action]', (event, target) => {
      const { action } = target.dataset;
      if (action === 'start') startGroup(target.dataset.group);
      if (action === 'generate') generatePairs(target.dataset.group);
      if (action === 'replay') replayTarget();
      if (action === 'answer') answerDiscrimination(target.dataset.choice);
      if (action === 'to-production') goToProduction();
      if (action === 'check') checkProduction();
      if (action === 'mic') toggleDictation();
      if (action === 'retry') retryProduction();
      if (action === 'say-model') speakWord(target.dataset.word);
      if (action === 'next') nextPair();
      if (action === 'back') backToPicker();
    });

    el.body.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && event.target.id === 'pronInput') {
        event.preventDefault();
        checkProduction();
      }
    });
  }

  // ---- Catálogo y marcadores ----

  /** Los del catálogo más los que haya generado esta persona. */
  function pairsOf(groupId) {
    const group = findPairGroup(groupId);
    const base = group && Array.isArray(group.pairs) ? group.pairs : [];
    const extra = Array.isArray(state.generated[groupId]) ? state.generated[groupId] : [];
    return [...base, ...extra];
  }

  function groupStat(groupId) {
    return { ...emptyGroupStat(), ...state.stats.groups[groupId] };
  }

  /** Suma un intento al marcador del grupo activo y lo guarda. */
  async function score(field, hit) {
    const stat = { ...groupStat(state.groupId) };
    stat[`total${field}`] += 1;
    if (hit) stat[`correct${field}`] += 1;
    state.stats.groups[state.groupId] = stat;
    await store.set(KEY_STATS, state.stats);
  }

  // ---- Render ----

  function render() {
    if (state.phase === 'pick') {
      el.body.innerHTML = pickerHtml();
      return;
    }
    if (state.phase === 'summary') {
      el.body.innerHTML = summaryHtml();
      return;
    }
    el.body.innerHTML = state.step === 'discrimination' ? discriminationHtml() : productionHtml();
    if (state.step === 'production' && !state.prodResult) {
      const input = $('#pronInput', el.body);
      if (input) input.focus();
    }
  }

  function pickerHtml() {
    const noSynth = isSynthesisSupported()
      ? ''
      : '<div class="alert alert-warn">Este navegador no puede reproducir voz, así que la fase de ' +
        'discriminación auditiva no funcionará. Usa Chrome o Edge.</div>';

    if (!content.minimalPairs.length) {
      return `${noSynth}<div class="empty-state"><div class="big">No hay grupos de sonidos cargados</div>
        Revisa el catálogo en <a href="api/health.php" target="_blank" rel="noopener">api/health.php</a>.</div>`;
    }

    const cards = content.minimalPairs
      .map((group) => {
        const pairs = pairsOf(group.id);
        const stat = groupStat(group.id);
        const progress = stat.totalProd
          ? `<span class="pron-group-progress">${percent(stat.correctProd, stat.totalProd)}% producción</span>`
          : '';
        // Mientras se genera un lote se desactivan todos los botones, no sólo el
        // pulsado: sólo cabe una generación a la vez y un botón que no responde
        // se lee como que la aplicación se ha colgado.
        const busy = state.generating === group.id;
        const generate = aiAvailable()
          ? `<button type="button" class="pron-gen-more" data-action="generate"
                     data-group="${escapeHtml(group.id)}" ${state.generating ? 'disabled' : ''}>
               ${busy ? 'Generando…' : '🪄 Generar más pares para este sonido'}
             </button>`
          : '';

        return `
          <div class="pron-group-card">
            <button type="button" class="pron-group-open" data-action="start" data-group="${escapeHtml(group.id)}">
              <span class="pron-group-title">${escapeHtml(group.label)}</span>
              <span class="pron-group-count">${pairs.length} pares</span>
              ${progress}
            </button>
            ${generate}
          </div>`;
      })
      .join('');

    return `${noSynth}${cards}`;
  }

  function discriminationHtml() {
    const pair = state.queue[state.index];
    const answered = state.discResult !== null;

    const choice = (side) => {
      const isTarget = state.discTarget === side;
      const cls = !answered ? '' : isTarget ? 'is-correct' : state.discResult === 'incorrect' ? 'is-incorrect' : '';
      return `<button type="button" class="pron-word-btn ${cls}" data-action="answer" data-choice="${side}"
                      ${answered ? 'disabled' : ''}>${escapeHtml(pair[side])}</button>`;
    };

    const result = answered
      ? `<div class="pron-result-line">${
          state.discResult === 'correct'
            ? '✓ Correcto'
            : `✗ Has fallado — era "${escapeHtml(pair[state.discTarget])}"`
        }</div>
         <button type="button" class="new-conv-btn" data-action="to-production">Continuar → Producción</button>`
      : '';

    return `
      ${progressHtml()}
      <div class="pron-tip-box">${escapeHtml(tip())}</div>
      <div class="pron-phase-label">1. Discriminación auditiva — pulsa la palabra que has oído</div>
      <div class="pron-play-row">
        <button type="button" class="listen-play-btn" data-action="replay">🔊 Reproducir</button>
      </div>
      <div class="pron-word-row">${choice('a')}${choice('b')}</div>
      ${result}
      <button type="button" class="read-secondary-btn" data-action="back">Elegir otro sonido</button>`;
  }

  function productionHtml() {
    const pair = state.queue[state.index];
    const target = pair[state.prodTarget];
    const result = state.prodResult;

    const banner = () => {
      if (result.classification === 'correct') {
        return `<div class="feedback-banner is-correct" style="justify-content:center;">
                  ✓ Bien dicho: "${escapeHtml(target)}"</div>`;
      }
      if (result.classification === 'confusion') {
        return `<div class="feedback-banner is-incorrect" style="justify-content:center;">
                  ✗ Se ha entendido "${escapeHtml(result.other)}" en vez de "${escapeHtml(target)}" —
                  revisa el sonido de este grupo.</div>`;
      }
      return `<div class="feedback-banner is-close" style="justify-content:center;">
                ~ No se ha entendido con claridad: "${escapeHtml(result.heard)}".</div>`;
    };

    const answer = result
      ? `${banner()}
         <div class="pron-play-row">
           <button type="button" class="listen-replay-btn" data-action="say-model"
                   data-word="${escapeHtml(target)}">🔊 Escuchar el modelo</button>
           ${
             result.classification === 'correct'
               ? ''
               : '<button type="button" class="listen-replay-btn" data-action="retry">↻ Intentarlo otra vez</button>'
           }
         </div>
         <button type="button" class="new-conv-btn" data-action="next">
           ${state.index < state.queue.length - 1 ? 'Siguiente par' : 'Ver resumen'}
         </button>`
      : `<div class="answer-input-row">
           <input type="text" class="answer-input" id="pronInput" autocomplete="off"
                  placeholder="Pulsa el micrófono y di la palabra, o escríbela…">
           <button type="button" class="mic-btn" data-action="mic" title="Responder por voz">🎤</button>
           <button type="button" class="check-btn" data-action="check">Corregir</button>
         </div>
         <div class="voice-msg" id="pronVoiceMsg" hidden></div>`;

    return `
      ${progressHtml()}
      <div class="pron-phase-label">2. Producción — di esta palabra en voz alta</div>
      <div class="pron-say-word">${escapeHtml(target)}</div>
      ${answer}
      <button type="button" class="read-secondary-btn" data-action="back">Elegir otro sonido</button>`;
  }

  function summaryHtml() {
    const { disc, discTotal, prod, prodTotal } = state.session;
    return `
      <div class="listen-score-line">Discriminación: ${disc}/${discTotal} · Producción: ${prod}/${prodTotal}</div>
      <button type="button" class="new-conv-btn" data-action="start" data-group="${escapeHtml(state.groupId)}">
        Repetir este sonido
      </button>
      <button type="button" class="read-secondary-btn" style="margin-top:8px;" data-action="back">
        Elegir otro sonido
      </button>`;
  }

  function progressHtml() {
    const group = findPairGroup(state.groupId);
    const label = group ? group.label : '';
    return `<div class="listen-progress">Par ${state.index + 1} de ${state.queue.length} —
            ${escapeHtml(label)}</div>`;
  }

  function tip() {
    const group = findPairGroup(state.groupId);
    return group && group.tip ? group.tip : '';
  }

  function renderStats() {
    const groups = Object.values(state.stats.groups);
    const totalProd = groups.reduce((sum, g) => sum + g.totalProd, 0);
    if (!totalProd) {
      el.stats.style.display = 'none';
      return;
    }
    const correctProd = groups.reduce((sum, g) => sum + g.correctProd, 0);

    el.stats.style.display = 'grid';
    el.stats.innerHTML = `
      <div class="stat"><div class="n">${percent(correctProd, totalProd)}%</div>
        <div class="l">Precisión producción</div></div>
      <div class="stat"><div class="n">${totalProd}</div><div class="l">Palabras producidas</div></div>
      <div class="stat"><div class="n">${practicedCount()}/${content.minimalPairs.length}</div>
        <div class="l">Sonidos practicados</div></div>`;
  }

  function percent(part, total) {
    return total ? Math.round((part / total) * 100) : 0;
  }

  function practicedCount() {
    return Object.values(state.stats.groups).filter((g) => g.totalProd > 0).length;
  }

  // ---- Ciclo del ejercicio ----

  function startGroup(groupId) {
    const pairs = pairsOf(groupId);
    if (!pairs.length) {
      showToast('Este grupo no tiene pares todavía.');
      return;
    }

    state.groupId = groupId;
    state.queue = shuffle(pairs);
    state.index = 0;
    state.session = { disc: 0, discTotal: 0, prod: 0, prodTotal: 0 };
    state.phase = 'practice';
    beginDiscrimination();
  }

  function beginDiscrimination() {
    state.step = 'discrimination';
    state.discResult = null;
    state.discTarget = coinFlip();
    render();
    // Un margen antes de hablar: sin él la síntesis arranca mientras el
    // navegador sigue pintando y se come la primera sílaba.
    window.setTimeout(() => {
      if (state.phase === 'practice' && state.step === 'discrimination') replayTarget();
    }, 300);
  }

  function replayTarget() {
    const pair = state.queue[state.index];
    if (pair) speakWord(pair[state.discTarget]);
  }

  /** Palabra sola y algo más despacio: es el modelo a imitar, no una lectura. */
  function speakWord(word) {
    speak(word, { rate: 0.85 });
  }

  async function answerDiscrimination(choice) {
    if (state.discResult !== null) return;

    const hit = choice === state.discTarget;
    state.discResult = hit ? 'correct' : 'incorrect';
    state.session.discTotal += 1;
    if (hit) state.session.disc += 1;
    render();
    await score('Disc', hit);
  }

  function goToProduction() {
    state.step = 'production';
    state.prodResult = null;
    state.prodTarget = coinFlip();
    render();
  }

  async function checkProduction() {
    if (state.prodResult) return;

    const input = $('#pronInput', el.body);
    const value = input ? input.value.trim() : '';
    if (!value) {
      if (input) input.focus();
      return;
    }

    dictation.stop();
    const pair = state.queue[state.index];
    const target = pair[state.prodTarget];
    const other = pair[state.prodTarget === 'a' ? 'b' : 'a'];
    const said = normalize(value);
    const wantTarget = normalize(target);
    const wantOther = normalize(other);

    // Antes esto exigía coincidencia exacta, y el reconocedor de voz devuelve
    // "shipp" por "ship" con bastante alegría: una errata suya se contaba como
    // un fallo de pronunciación. Un margen del 20% de la palabra absorbe ese
    // ruido; lo que no se parece a ninguna de las dos palabras sigue siendo "no
    // se ha entendido".
    //
    // El tope de `pairDistance - 1` es lo que mantiene el ejercicio en pie. Las
    // dos palabras de un par mínimo se distinguen por muy poco —27 de los 45
    // pares del catálogo, por una sola letra— y una tolerancia que llegue a esa
    // distancia da por bueno cualquier desliz, incluido el del sonido que se
    // está examinando: con "van" de objetivo, decir "fan" quedaría a 1 de las
    // dos palabras y pasaría por acierto. En esos pares no hay margen que dar y
    // la comparación vuelve a ser exacta, como antes; el margen se aplica donde
    // sí cabe ("ship"/"sheep", "collection"/"correction").
    const pairDistance = levenshtein(wantTarget, wantOther);
    const margin = (word) =>
      Math.min(Math.max(1, Math.floor(word.length * 0.2)), Math.max(0, pairDistance - 1));

    const toTarget = levenshtein(said, wantTarget);
    const toOther = levenshtein(said, wantOther);
    const tolTarget = margin(wantTarget);
    const tolOther = margin(wantOther);

    let classification = 'unclear';
    if (toTarget <= tolTarget && toTarget <= toOther) classification = 'correct';
    else if (toOther <= tolOther && toOther < toTarget) classification = 'confusion';

    state.prodResult = { classification, target, other, heard: value };
    state.session.prodTotal += 1;
    if (classification === 'correct') state.session.prod += 1;
    render();
    await score('Prod', classification === 'correct');
    renderStats();
  }

  /** Otro intento del mismo par. El fallido ya cuenta en el marcador. */
  function retryProduction() {
    state.prodResult = null;
    render();
  }

  async function nextPair() {
    if (state.index < state.queue.length - 1) {
      state.index += 1;
      beginDiscrimination();
      return;
    }

    dictation.stop();
    cancelSpeech();
    state.phase = 'summary';
    renderStats();
    render();
    await onActivity();
  }

  function backToPicker() {
    dictation.stop();
    cancelSpeech();
    state.phase = 'pick';
    state.groupId = null;
    state.queue = [];
    state.index = 0;
    state.prodResult = null;
    state.discResult = null;
    render();
  }

  function coinFlip() {
    return Math.random() < 0.5 ? 'a' : 'b';
  }

  function shuffle(list) {
    const out = [...list];
    for (let i = out.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  }

  // ---- Pares generados con IA ----

  async function generatePairs(groupId) {
    if (state.generating) return;
    const group = findPairGroup(groupId);
    if (!group) return;

    state.generating = groupId;
    render();
    showToast(`Generando más pares para ${group.label}…`, 15000);

    try {
      // Los del catálogo los conoce el servidor; se le mandan los que ya se han
      // generado antes para que no los repita.
      const existing = (state.generated[groupId] || []).map((p) => `${p.a}/${p.b}`);
      const data = await requestTask('pron.pairs', { groupId, existing });
      const pairs = Array.isArray(data.pairs) ? data.pairs : [];
      if (!pairs.length) throw new Error('el lote venía vacío');

      state.generated[groupId] = [...(state.generated[groupId] || []), ...pairs];
      await store.set(KEY_GENERATED, state.generated);
      showToast(`${pairs.length} pares nuevos en ${group.label}.`);
    } catch (err) {
      showToast(`No se pudieron generar más pares: ${err.message}`);
    } finally {
      state.generating = null;
      render();
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
        const input = $('#pronInput', el.body);
        if (input) input.value = transcript.trim();
        // Se corrige solo: en producción lo que cuenta es lo que ha entendido el
        // reconocedor, y dejarlo en el campo invita a arreglarlo a mano.
        checkProduction();
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
    const box = $('#pronVoiceMsg', el.body);
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
      dictation.stop();
      cancelSpeech();
    },

    /** Para el resumen global: sonidos con al menos una palabra producida. */
    practicedCount,
    groupCount: () => content.minimalPairs.length,

    async reset() {
      state.stats = { groups: {} };
      await store.set(KEY_STATS, state.stats);
      renderStats();
      if (state.phase === 'pick') render();
    },
  };
}
