import { requestTask } from './api.js';
import { showToast } from './ui.js';
import { capHistory } from './storage.js';

const KEY = 'notebook';
const MAX_ENTRIES = 500;

/**
 * Cuaderno de vocabulario, compartido entre modos.
 *
 * Es un servicio y no un modo porque cuatro modos distintos (Conversación,
 * Lectura, Listening y Gramática) tienen que poder añadir palabras, mientras
 * que sólo uno las lista. El modo Cuaderno se suscribe con `onChange` para
 * repintarse cuando otro modo añade algo.
 */
export function createNotebookService({ store }) {
  let entries = [];
  const listeners = new Set();

  const notify = () => listeners.forEach((fn) => fn(entries));

  async function persist() {
    entries = capHistory(entries, MAX_ENTRIES);
    await store.set(KEY, entries);
    notify();
  }

  return {
    async load() {
      const stored = await store.get(KEY, null);
      entries = Array.isArray(stored) ? stored : [];
    },

    all: () => entries,
    count: () => entries.length,
    promotedCount: () => entries.filter((e) => e.promoted).length,

    onChange(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },

    has(word) {
      const needle = String(word).toLowerCase();
      return entries.some((e) => e.word.toLowerCase() === needle);
    },

    /**
     * Traduce en contexto y guarda. Devuelve la entrada, o null si no se pudo
     * (la IA está apagada, no responde, o ya estaba en el cuaderno).
     */
    async add(word, context) {
      if (this.has(word)) {
        showToast(`"${word}" ya está en tu cuaderno.`);
        return null;
      }

      const data = await requestTask('notebook.lookup', { word, context });
      const entry = {
        id: `n${Date.now()}${Math.floor(Math.random() * 1000)}`,
        word,
        translation: data.translation || '',
        example: data.example || context,
        promoted: false,
        ts: Date.now(),
      };
      // Al principio: lo último marcado es lo que interesa repasar antes.
      entries = [entry, ...entries];
      await persist();

      return entry;
    },

    async remove(id) {
      entries = entries.filter((e) => e.id !== id);
      await persist();
    },

    async markPromoted(id) {
      const entry = entries.find((e) => e.id === id);
      if (entry) {
        entry.promoted = true;
        await persist();
      }
      return entry || null;
    },

    find: (id) => entries.find((e) => e.id === id) || null,

    async clear() {
      entries = [];
      await persist();
    },
  };
}
