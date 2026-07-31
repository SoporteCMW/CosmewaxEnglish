/**
 * Configuración y datos inyectados por `index.php` en `window.__APP__`.
 *
 * El cliente nunca conoce la API key ni los prompts: sólo la URL del proxy y
 * los datos de contenido que necesita para renderizar.
 */
const raw = window.__APP__ || {};

export const config = Object.freeze({
  apiUrl: raw.apiUrl || 'api/claude.php',
  apiToken: raw.apiToken || 'CosmewaxEnglish',
  storageNamespace: raw.storageNamespace || 'cosmewax-english:v1',
  apiConfigured: Boolean(raw.apiConfigured),
});

export const content = Object.freeze({
  deck: Array.isArray(raw.deck) ? raw.deck : [],
  categories: Array.isArray(raw.categories) ? raw.categories : [],
  scenarios: Array.isArray(raw.scenarios) ? raw.scenarios : [],
  scenarioGroups: Array.isArray(raw.scenarioGroups) ? raw.scenarioGroups : [],
  readingTopics: Array.isArray(raw.readingTopics) ? raw.readingTopics : [],
});

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
