import { todayStr } from '../lib/srs.js';

const KEY = 'streak';

/**
 * Racha de días consecutivos con actividad.
 *
 * Cuenta un día en cuanto el alumno completa algo en cualquier modo. Se usa el
 * calendario local (ver `todayStr` en lib/srs.js), no UTC: "hoy" tiene que ser
 * el día que el alumno ve en su reloj.
 */
export function createStreak({ store }) {
  let state = { lastActiveDate: null, currentStreak: 0, bestStreak: 0 };

  const daysBetween = (from, to) => {
    const [ay, am, ad] = String(from).split('-').map(Number);
    const [by, bm, bd] = String(to).split('-').map(Number);
    const a = Date.UTC(ay, am - 1, ad);
    const b = Date.UTC(by, bm - 1, bd);
    return Math.round((b - a) / 86400000);
  };

  return {
    async load() {
      const stored = await store.get(KEY, null);
      if (stored && typeof stored === 'object') {
        state = {
          lastActiveDate: stored.lastActiveDate ?? null,
          currentStreak: Number(stored.currentStreak) || 0,
          bestStreak: Number(stored.bestStreak) || 0,
        };
      }
    },

    /** Marca actividad hoy. Idempotente: sólo cuenta la primera vez del día. */
    async recordActivity() {
      const today = todayStr();
      if (state.lastActiveDate === today) return state;

      state.currentStreak =
        state.lastActiveDate && daysBetween(state.lastActiveDate, today) === 1
          ? state.currentStreak + 1
          : 1;
      state.lastActiveDate = today;
      state.bestStreak = Math.max(state.bestStreak, state.currentStreak);

      await store.set(KEY, state);
      return state;
    },

    /**
     * Racha vigente. Si la última actividad no fue hoy ni ayer, ya está rota:
     * se muestra 0 aunque el contador guardado diga otra cosa.
     */
    current() {
      if (!state.lastActiveDate) return 0;
      return daysBetween(state.lastActiveDate, todayStr()) > 1 ? 0 : state.currentStreak;
    },

    best: () => state.bestStreak,
    snapshot: () => ({ ...state }),

    async replace(next) {
      if (next && typeof next === 'object') {
        state = {
          lastActiveDate: next.lastActiveDate ?? null,
          currentStreak: Number(next.currentStreak) || 0,
          bestStreak: Number(next.bestStreak) || 0,
        };
        await store.set(KEY, state);
      }
    },
  };
}
