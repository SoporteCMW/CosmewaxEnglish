/**
 * Almacén de progreso del alumno.
 *
 * La interfaz es asíncrona a propósito aunque localStorage sea síncrono: el día
 * que el progreso deba compartirse entre dispositivos, se sustituye el driver
 * por uno que hable con `api/state.php` y ningún modo cambia una línea.
 */

const memoryFallback = new Map();

const localStorageAvailable = (() => {
  try {
    const probe = '__probe__';
    window.localStorage.setItem(probe, '1');
    window.localStorage.removeItem(probe);
    return true;
  } catch (err) {
    return false;
  }
})();

function readRaw(key) {
  if (!localStorageAvailable) return memoryFallback.get(key) ?? null;
  return window.localStorage.getItem(key);
}

function writeRaw(key, value) {
  if (!localStorageAvailable) {
    memoryFallback.set(key, value);
    return true;
  }
  try {
    window.localStorage.setItem(key, value);
    return true;
  } catch (err) {
    // Cuota agotada o modo privado: seguimos en memoria para no romper la sesión.
    memoryFallback.set(key, value);
    console.warn('[storage] no se pudo persistir', key, err);
    return false;
  }
}

export function createStore(namespace) {
  const fullKey = (key) => `${namespace}:${key}`;

  return {
    async get(key, fallback) {
      const raw = readRaw(fullKey(key));
      if (raw === null) return fallback;
      try {
        const parsed = JSON.parse(raw);
        return parsed === null || parsed === undefined ? fallback : parsed;
      } catch (err) {
        console.warn('[storage] JSON corrupto en', key, '— se reinicia');
        return fallback;
      }
    },

    async set(key, value) {
      return writeRaw(fullKey(key), JSON.stringify(value));
    },

    async remove(key) {
      if (!localStorageAvailable) {
        memoryFallback.delete(fullKey(key));
        return;
      }
      window.localStorage.removeItem(fullKey(key));
    },
  };
}

/** Recorta un historial para que no crezca sin límite en localStorage. */
export function capHistory(list, max = 200) {
  return list.length > max ? list.slice(-max) : list;
}
