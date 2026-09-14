import { requestTask } from './api.js';
import { showToast } from './ui.js';
import { capHistory } from './storage.js';
import { applyGrade, buildQueue, isDue, newEntry, todayStr, MAX_BOX } from '../lib/srs.js';

const KEY = 'notebook';
const MAX_ENTRIES = 500;

/**
 * Cuaderno de vocabulario, compartido entre modos.
 *
 * Es un servicio y no un modo porque cuatro modos distintos (Conversación,
 * Lectura, Listening y Gramática) tienen que poder añadir palabras, mientras
 * que sólo uno las lista. El modo Cuaderno se suscribe con `onChange` para
 * repintarse cuando otro modo añade algo.
 *
 * Cada palabra marcada trae su propio nivel Leitner desde que se marca, y se
 * repasa aquí mismo. Antes había que "ascenderla a Tarjetas" para poder
 * repasarla, lo que dejaba el mismo término duplicado en dos sitios, con dos
 * progresos distintos que ya no se parecían en nada a la semana siguiente.
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

  /**
   * Pone al día una entrada guardada antes de que el cuaderno tuviera repaso.
   *
   * Las de antes traen `promoted` y ningún campo Leitner. Se les da uno nuevo
   * (vencen hoy, que es lo que el alumno espera al abrir el repaso por primera
   * vez) y se deja caer `promoted`: la tarjeta que se creó en su día sigue en
   * el mazo, con su propio progreso, y no se toca.
   */
  function migrate(entry) {
    if (entry && typeof entry.box === 'number' && typeof entry.due === 'string') return entry;
    const { promoted, ...rest } = entry || {};
    return { ...rest, ...newEntry() };
  }

  return {
    async load() {
      const stored = await store.get(KEY, null);
      entries = Array.isArray(stored) ? stored.map(migrate) : [];
    },

    all: () => entries,
    count: () => entries.length,
    dueCount: () => {
      const today = todayStr();
      return entries.filter((e) => isDue(e, today)).length;
    },
    masteredCount: () => entries.filter((e) => (e.box ?? 1) >= MAX_BOX).length,

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
        ts: Date.now(),
        // Entra en la caja 1 y vence hoy: marcar una palabra es justo el momento
        // en que interesa repasarla.
        ...newEntry(),
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

    /**
     * Cola de repaso de hoy.
     *
     * Misma regla que Tarjetas y Gramática (`lib/srs.js`): primero lo vencido y,
     * si no hay nada, se adelantan las diez más próximas para que pulsar
     * "Repasar" nunca abra una sesión vacía.
     */
    queue() {
      return buildQueue(entries, Object.fromEntries(entries.map((e) => [e.id, e])));
    },

    /** Aplica una calificación Leitner a una palabra marcada. */
    async grade(id, grade) {
      const entry = entries.find((e) => e.id === id);
      if (!entry) return null;
      Object.assign(entry, applyGrade(entry, grade));
      await persist();
      return entry;
    },

    find: (id) => entries.find((e) => e.id === id) || null,

    async clear() {
      entries = [];
      await persist();
    },
  };
}
