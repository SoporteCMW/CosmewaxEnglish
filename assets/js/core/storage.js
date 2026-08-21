import { config } from './config.js';

/**
 * Almacén de progreso del alumno, contra el servidor.
 *
 * Antes esto era `localStorage`, que vive en un navegador y un perfil concretos:
 * el progreso se perdía al cambiar de equipo. Ahora va a `api/state.php`, que lo
 * guarda en SQL Server contra el usuario del AD, así que sigue a la persona.
 *
 * La interfaz (`get`/`set`/`remove`, asíncrona) es la misma de antes a
 * propósito: los seis modos no han cambiado una línea.
 *
 * Tres decisiones que explican el resto del fichero:
 *
 * 1. **Todo el progreso se carga de una vez** al arrancar (`hydrate`) y se
 *    mantiene en memoria. Los modos leen decenas de veces al repintar; una
 *    petición por lectura haría la aplicación inusable.
 *
 * 2. **Las escrituras van en diferido y agrupadas por clave.** Contestar una
 *    tarjeta escribe `srs` y `voice-stats` seguidas; sin agrupar, una sesión de
 *    repaso serían cientos de POST. Se envía como muy tarde WRITE_DELAY_MS
 *    después del último cambio de esa clave.
 *
 * 3. **Un fallo de guardado no interrumpe la práctica.** El valor queda en
 *    memoria, la sesión continúa y se avisa UNA vez. Cortar el ejercicio porque
 *    la BD no responde sería peor que perder el progreso de ese rato.
 */

const WRITE_DELAY_MS = 800;

/** Se vuelca lo pendiente al salir; si no, el último repaso se perdería. */
const FLUSH_EVENTS = ['pagehide', 'beforeunload'];

let onPersistenceLost = () => {};

/** Lo llama main.js para poder avisar al alumno con el toast de la aplicación. */
export function setPersistenceWarning(handler) {
  onPersistenceLost = typeof handler === 'function' ? handler : () => {};
}

async function request(method, body) {
  const options = {
    method,
    headers: { 'X-Requested-With': config.apiToken },
  };
  if (body !== undefined) {
    options.headers['Content-Type'] = 'application/json';
    options.body = JSON.stringify(body);
  }

  const response = await fetch(config.stateUrl, options);
  if (response.status === 401) {
    window.location.assign('login.php');
    throw new Error('sesión caducada');
  }
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload || payload.ok !== true) {
    throw new Error((payload && payload.error && payload.error.message) || `HTTP ${response.status}`);
  }
  return payload;
}

export function createStore() {
  /** Copia en memoria de todo el progreso: es la que leen los modos. */
  const cache = new Map();
  /** Temporizador de escritura pendiente, por clave. */
  const timers = new Map();
  /** Claves con cambios sin confirmar, para el volcado al salir. */
  const dirty = new Set();

  let warned = false;

  function warnOnce(detail) {
    if (warned) return;
    warned = true;
    console.warn('[storage] progreso no persistido', detail);
    onPersistenceLost();
  }

  async function push(key) {
    timers.delete(key);
    try {
      const payload = await request('POST', { key, value: cache.get(key) });
      if (payload.persisted === false) {
        warnOnce('el servidor no pudo guardar');
      } else {
        dirty.delete(key);
      }
    } catch (err) {
      warnOnce(err.message);
    }
  }

  function schedule(key) {
    dirty.add(key);
    if (timers.has(key)) clearTimeout(timers.get(key));
    timers.set(key, setTimeout(() => push(key), WRITE_DELAY_MS));
  }

  /**
   * Volcado síncrono al cerrar la pestaña. `fetch` normal se cancela al
   * descargar la página; `sendBeacon` está pensado justo para esto.
   */
  function flushOnExit() {
    if (!navigator.sendBeacon) return;
    for (const key of dirty) {
      const blob = new Blob([JSON.stringify({ key, value: cache.get(key) })], {
        type: 'application/json',
      });
      navigator.sendBeacon(config.stateUrl, blob);
    }
  }

  FLUSH_EVENTS.forEach((event) => window.addEventListener(event, flushOnExit));

  return {
    /** Carga inicial. La llama main.js antes de arrancar los modos. */
    async hydrate() {
      try {
        const payload = await request('GET');
        Object.entries(payload.state || {}).forEach(([key, value]) => cache.set(key, value));
        if (payload.persisted === false) {
          warnOnce('la base de datos no responde');
        }
        return true;
      } catch (err) {
        // Sin progreso previo se empieza de cero, pero la aplicación arranca.
        warnOnce(err.message);
        return false;
      }
    },

    async get(key, fallback) {
      const value = cache.get(key);
      return value === undefined || value === null ? fallback : value;
    },

    async set(key, value) {
      cache.set(key, value);
      schedule(key);
      return true;
    },

    async remove(key) {
      cache.delete(key);
      if (timers.has(key)) {
        clearTimeout(timers.get(key));
        timers.delete(key);
      }
      dirty.delete(key);
      try {
        await request('POST', { key, remove: true });
      } catch (err) {
        warnOnce(err.message);
      }
    },

    /** Copia de todo el progreso en memoria. La usa la exportación. */
    snapshot() {
      return Object.fromEntries(cache);
    },

    /**
     * Sustituye varias claves de golpe y espera confirmación del servidor.
     *
     * Al contrario que `set`, no agrupa ni difiere: quien importa un fichero está
     * esperando el resultado, y hay que saber si se ha guardado de verdad antes de
     * recargar la página. Devuelve las claves que sí se persistieron.
     */
    async replaceAll(entries) {
      const saved = [];
      for (const [key, value] of Object.entries(entries)) {
        cache.set(key, value);
        if (timers.has(key)) {
          clearTimeout(timers.get(key));
          timers.delete(key);
        }
        try {
          const payload = await request('POST', { key, value });
          if (payload.persisted === false) {
            dirty.add(key);
            warnOnce('el servidor no pudo guardar');
          } else {
            dirty.delete(key);
            saved.push(key);
          }
        } catch (err) {
          dirty.add(key);
          warnOnce(err.message);
        }
      }
      return saved;
    },
  };
}

/** Recorta un historial para que no crezca sin límite. */
export function capHistory(list, max = 200) {
  return list.length > max ? list.slice(-max) : list;
}
