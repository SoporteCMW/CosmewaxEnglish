import { config } from './config.js';

export class ApiError extends Error {
  constructor(message, code, retryable = false) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.retryable = retryable;
  }
}

/**
 * Llama al proxy del servidor. El cliente sólo declara la tarea; el prompt y la
 * clave viven en PHP.
 *
 * @param {string} task    'conversation.reply' | 'conversation.feedback' | 'reading.passage'
 * @param {object} payload datos de la tarea (scenarioId, messages, topicId…)
 * @returns {Promise<string>} texto de la respuesta
 */
export async function requestText(task, payload = {}, { signal } = {}) {
  if (!config.apiConfigured) {
    throw new ApiError(
      'El servidor todavía no tiene configurada la API key de Anthropic.',
      'not_configured'
    );
  }

  let response;
  try {
    response = await fetch(config.apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Requested-With': config.apiToken,
      },
      body: JSON.stringify({ task, ...payload }),
      signal,
    });
  } catch (err) {
    if (err && err.name === 'AbortError') throw err;
    throw new ApiError('No hay conexión con el servidor.', 'network', true);
  }

  let body = null;
  try {
    body = await response.json();
  } catch (err) {
    body = null;
  }

  if (!response.ok || !body || body.ok !== true) {
    const error = (body && body.error) || {};
    throw new ApiError(
      error.message || `El servidor respondió ${response.status}.`,
      error.code || `http_${response.status}`,
      response.status === 429 || response.status >= 500
    );
  }

  return typeof body.text === 'string' ? body.text : '';
}
