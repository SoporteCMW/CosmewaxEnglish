import { content } from './config.js';

const KEY = 'profile';

/**
 * Perfil profesional activo.
 *
 * El cliente sólo guarda el id: los textos que orientan a la IA (`topicHint`,
 * `vocabHint`, `scenarioHint`) son prompts y viven en `data/profiles.json`, en
 * el servidor. Aquí se envía el id y PHP resuelve el resto.
 */
export function createProfile({ store }) {
  const fallback = content.profiles[0] ? content.profiles[0].id : 'rd';
  let current = fallback;
  const listeners = new Set();

  return {
    async load() {
      const stored = await store.get(KEY, null);
      const valid = typeof stored === 'string' && content.profiles.some((p) => p.id === stored);
      current = valid ? stored : fallback;
    },

    id: () => current,
    label: () => {
      const found = content.profiles.find((p) => p.id === current);
      return found ? found.label : current;
    },

    async set(id) {
      if (!content.profiles.some((p) => p.id === id)) return false;
      current = id;
      await store.set(KEY, id);
      listeners.forEach((fn) => fn(id));
      return true;
    },

    onChange(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}
