/**
 * Configuración y datos inyectados por `index.php` en `window.__APP__`.
 *
 * El cliente nunca conoce credenciales, la URL del servidor de IA ni los
 * prompts: sólo la URL del proxy propio y los datos que necesita para
 * renderizar.
 */
const raw = window.__APP__ || {};

const list = (value) => (Array.isArray(value) ? value : []);

export const config = Object.freeze({
  apiUrl: raw.apiUrl || 'api/claude.php',
  scenariosUrl: raw.scenariosUrl || 'api/scenarios.php',
  stateUrl: raw.stateUrl || 'api/state.php',
  apiToken: raw.apiToken || 'CosmewaxEnglish',
  aiConfigured: Boolean(raw.aiConfigured),
});

export const content = {
  deck: list(raw.deck),
  categories: list(raw.categories),
  scenarios: list(raw.scenarios),
  scenarioGroups: list(raw.scenarioGroups),
  // Los generados llegan del servidor y se refrescan al crear o borrar uno.
  generatedScenarios: list(raw.generatedScenarios),
  readingTopics: list(raw.readingTopics),
  grammar: list(raw.grammar),
  profiles: list(raw.profiles),
  minimalPairs: list(raw.minimalPairs),
};

/** Etiqueta corta de una categoría de tarjeta ("reunion" → "Reunión"). */
export function categoryLabel(id) {
  const found = content.categories.find((c) => c.id === id);
  return found ? found.label : id;
}

/** Cómo se llama al interlocutor en el chat, según el grupo del escenario. */
export function whoLabel(categoryId) {
  const group = content.scenarioGroups.find((g) => g.id === categoryId);
  return group && group.whoLabel ? group.whoLabel : 'Interlocutor';
}

/** Grupo de pares mínimos por id. */
export function findPairGroup(id) {
  return content.minimalPairs.find((g) => g.id === id) || null;
}

/** Escenario por id, sea de catálogo o generado. */
export function findScenario(id) {
  return (
    content.scenarios.find((s) => s.id === id) ||
    content.generatedScenarios.find((s) => s.id === id) ||
    null
  );
}

export function profileLabel(id) {
  const found = content.profiles.find((p) => p.id === id);
  return found ? found.label : id;
}
