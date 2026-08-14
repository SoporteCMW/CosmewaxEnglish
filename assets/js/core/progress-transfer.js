import { PROGRESS_KEYS } from './storage.js';
import { todayStr } from '../lib/srs.js';

const FORMAT = 'English Unblocked';
const EXPORT_VERSION = 2;

/**
 * Exportar e importar el progreso como un fichero JSON.
 *
 * El progreso ya vive en SQL Server contra el usuario del AD, así que esto no es
 * una copia de seguridad para no perderlo al cambiar de equipo — eso ya lo
 * resuelve el servidor. Sirve para lo otro: llevarse el propio progreso si la
 * cuenta cambia, revisarlo fuera de la aplicación, o restaurar un estado
 * anterior cuando alguien se ha reiniciado un modo por error.
 *
 * Dos cosas que **no** entran en el fichero, y no es un olvido:
 *
 *  - Los **escenarios generados** viven en el servidor, no en el progreso: su
 *    `context` es material de prompt y nunca sale de PHP. Ya siguen a la persona.
 *  - Las **tarjetas propias** que se hayan creado sí van dentro, porque la clave
 *    `deck` incluye el mazo completo.
 *
 * La confirmación es un banner en la página y no `window.confirm()`, igual que el
 * resto de la aplicación: importar pisa el progreso actual y conviene que se lea
 * qué fichero es antes de aceptar.
 */
export function createProgressTransfer({ store }) {
  /** Fichero ya leído y validado, esperando el segundo clic. */
  let pending = null;

  /** Todo el progreso conocido, en el orden estable de PROGRESS_KEYS. */
  function collect() {
    const snapshot = store.snapshot();
    const state = {};
    PROGRESS_KEYS.forEach((key) => {
      if (snapshot[key] !== undefined && snapshot[key] !== null) state[key] = snapshot[key];
    });
    return state;
  }

  return {
    /** Descarga un JSON con el progreso. Devuelve cuántas claves llevaba. */
    download() {
      const state = collect();
      const payload = {
        app: FORMAT,
        exportVersion: EXPORT_VERSION,
        exportedAt: new Date().toISOString(),
        state,
      };

      const url = URL.createObjectURL(
        new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
      );
      const link = document.createElement('a');
      link.href = url;
      link.download = `english-unblocked-progreso-${todayStr()}.json`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);

      return Object.keys(state).length;
    },

    /**
     * Lee y valida un fichero, sin escribir nada todavía.
     *
     * @returns {Promise<{keys:string[], exportedAt:string|null}>}
     * @throws  {Error} si no es un export de esta aplicación o no trae progreso
     */
    async read(file) {
      let data;
      try {
        data = JSON.parse(await file.text());
      } catch (err) {
        // El mensaje nativo ("Unexpected token < in JSON at position 0") no le
        // dice nada a quien acaba de elegir el fichero equivocado.
        throw new Error('el fichero no es un JSON válido');
      }

      if (!data || data.app !== FORMAT) {
        throw new Error('el fichero no es un export de English Unblocked');
      }

      // Formato 1 (el prototipo de un solo fichero) traía las claves en la raíz,
      // con otros nombres; el 2 las agrupa bajo `state` con la clave del servidor.
      const raw = data.state && typeof data.state === 'object' ? data.state : legacyState(data);
      const state = {};
      PROGRESS_KEYS.forEach((key) => {
        if (raw[key] !== undefined && raw[key] !== null) state[key] = raw[key];
      });

      if (Object.keys(state).length === 0) {
        throw new Error('el fichero no contiene ninguna clave de progreso reconocible');
      }

      pending = state;
      return { keys: Object.keys(state), exportedAt: data.exportedAt || null };
    },

    /**
     * Escribe el progreso leído. Devuelve las claves que el servidor confirmó.
     *
     * Quien llama recarga la página después: los modos leen su estado al
     * iniciarse, y volver a arrancarlos uno a uno sería reimplementar el arranque.
     */
    async apply() {
      if (!pending) return [];
      const saved = await store.replaceAll(pending);
      pending = null;
      return saved;
    },

    cancel() {
      pending = null;
    },

    get hasPending() {
      return pending !== null;
    },
  };
}

/** Export del prototipo de un solo fichero: claves en la raíz y otros nombres. */
function legacyState(data) {
  return {
    deck: data.deck,
    srs: data.srs,
    'voice-stats': data.voiceStats,
    conversations: data.convStats,
    'read-stats': data.readStats,
    'listen-stats': data.listenStats,
    'grammar-srs': data.grammarSrs,
    notebook: data.notebookEntries,
    streak: data.streak,
    profile: data.currentProfile,
    'pron-stats': data.pronStats,
    'generated-pairs': data.generatedPairs,
  };
}
