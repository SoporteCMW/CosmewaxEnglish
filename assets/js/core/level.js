const KEY = 'level';

/**
 * Niveles CEFR que el alumno puede elegir.
 *
 * Las etiquetas largas son las que explican la elección en el selector: "B2" a
 * secas no le dice nada a quien no se ha examinado nunca. Los `id` son los que
 * viajan al servidor, donde `PromptRegistry::LEVEL_HINTS` los traduce a la
 * instrucción concreta que recibe el modelo — aquí no hay nada de prompt, igual
 * que en `profile.js`.
 */
export const LEVELS = [
  { id: 'B1', label: 'B1', hint: 'intermedio — frases cortas y vocabulario común' },
  { id: 'B2', label: 'B2', hint: 'intermedio alto — inglés de trabajo del día a día' },
  { id: 'C1', label: 'C1', hint: 'avanzado — matices y lenguaje idiomático' },
  { id: 'C2', label: 'C2', hint: 'casi nativo — sin simplificar' },
];

/** El de siempre: es lo que la aplicación asumía antes de existir el selector. */
const FALLBACK = 'B2';

/**
 * Nivel CEFR activo.
 *
 * Afecta a TODO lo que genera o corrige la IA (lecturas, audios, conversación,
 * tarjetas, cuaderno, vocabulario y escenarios a medida) menos a una cosa:
 * Gramática corrige con el nivel de la propia estructura, porque una inversión
 * enfática es C1 aunque el alumno practique el resto en B1.
 *
 * El valor se adjunta a cada llamada desde `core/api.js`, que lee este módulo a
 * través de `setLevelProvider`. Así no hay que tocar los siete modos para que
 * el nivel viaje, ni que cada uno se acuerde de mandarlo.
 */
export function createLevel({ store }) {
  let current = FALLBACK;
  const listeners = new Set();

  return {
    LEVELS,

    async load() {
      const stored = await store.get(KEY, null);
      const valid = typeof stored === 'string' && LEVELS.some((l) => l.id === stored);
      current = valid ? stored : FALLBACK;
    },

    id: () => current,

    async set(id) {
      if (!LEVELS.some((l) => l.id === id)) return false;
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
