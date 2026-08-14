import { config } from './config.js';

export class ApiError extends Error {
  constructor(message, code, retryable = false) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.retryable = retryable;
  }
}

/** Los modos con IA se apagan solos si el servidor no la tiene configurada. */
export const aiAvailable = () => config.aiConfigured;

async function post(url, body, { signal } = {}) {
  let response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Requested-With': config.apiToken,
      },
      body: JSON.stringify(body),
      signal,
    });
  } catch (err) {
    if (err && err.name === 'AbortError') throw err;
    throw new ApiError('No hay conexión con el servidor.', 'network', true);
  }

  let payload = null;
  try {
    payload = await response.json();
  } catch (err) {
    payload = null;
  }

  if (!response.ok || !payload || payload.ok !== true) {
    const error = (payload && payload.error) || {};

    // Sesión caducada: no es un error que el alumno pueda resolver leyendo un
    // mensaje, así que se le devuelve al login en lugar de mostrar un aviso.
    if (response.status === 401 || error.code === 'unauthenticated') {
      redirectToLogin();
      throw new ApiError('Tu sesión ha caducado. Volviendo al login…', 'unauthenticated');
    }

    throw new ApiError(
      error.message || `El servidor respondió ${response.status}.`,
      error.code || `http_${response.status}`,
      response.status === 429 || response.status >= 500
    );
  }

  return payload;
}

/**
 * Una sola redirección aunque caduquen varias peticiones a la vez: los modos
 * lanzan llamadas en paralelo y cada 401 pediría su propia navegación.
 */
let redirecting = false;
function redirectToLogin() {
  if (redirecting) return;
  redirecting = true;
  window.location.assign('login.php');
}

/**
 * Ejecuta una tarea de IA. El cliente sólo declara la tarea; el prompt, las
 * credenciales y la URL del servidor de IA viven en PHP.
 *
 * @param {string} task  'conversation.reply' | 'listening.passage' | …
 * @param {object} payload datos de la tarea
 * @returns {Promise<object>} el cuerpo de la respuesta (sin el campo `ok`)
 */
export async function requestTask(task, payload = {}, options = {}) {
  if (!aiAvailable()) {
    throw new ApiError(
      'Los modos con IA están desactivados en el servidor.',
      'not_configured'
    );
  }
  const body = await post(config.apiUrl, { task, ...payload }, options);
  const { ok, ...rest } = body;
  return rest;
}

/** Atajo para las tareas que devuelven un único texto. */
export async function requestText(task, payload = {}, options = {}) {
  const body = await requestTask(task, payload, options);
  return typeof body.text === 'string' ? body.text : '';
}

/** Biblioteca de escenarios generados (vive en el servidor). */
export const scenariosApi = {
  async list() {
    const response = await fetch(config.scenariosUrl, {
      headers: { 'X-Requested-With': config.apiToken },
    });
    const payload = await response.json().catch(() => null);
    if (response.status === 401) {
      redirectToLogin();
      throw new ApiError('Tu sesión ha caducado. Volviendo al login…', 'unauthenticated');
    }
    if (!response.ok || !payload || payload.ok !== true) {
      throw new ApiError('No se pudo leer la lista de escenarios.', 'scenarios_list');
    }
    return Array.isArray(payload.scenarios) ? payload.scenarios : [];
  },

  async remove(id) {
    const payload = await post(config.scenariosUrl, { id });
    return Array.isArray(payload.scenarios) ? payload.scenarios : [];
  },
};
