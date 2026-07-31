/**
 * Sistema Leitner de 5 cajas.
 *
 * `INTERVALS[box]` = días hasta la siguiente revisión. El índice 0 no se usa
 * (las cajas van de 1 a 5) y se conserva para que `INTERVALS[s.box]` sea directo.
 */
export const INTERVALS = [1, 1, 2, 4, 7, 14];
export const MAX_BOX = 5;

/**
 * Aritmética de fechas en calendario LOCAL, nunca vía `toISOString()`.
 *
 * `toISOString()` convierte a UTC: en España (UTC+1/+2) la medianoche local es
 * el día anterior en UTC, así que "hoy" y "+3 días" salían desplazados un día.
 * Aquí sólo se manipulan los campos año/mes/día, que es lo que el alumno ve.
 */
function toDateStr(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function todayStr() {
  return toDateStr(new Date());
}

export function addDays(dateStr, days) {
  const [year, month, day] = String(dateStr).split('-').map(Number);
  const date = new Date(year, month - 1, day);
  date.setDate(date.getDate() + days);
  return toDateStr(date);
}

export function newEntry() {
  return { box: 1, due: todayStr(), reps: 0 };
}

export function isDue(entry, today = todayStr()) {
  return Boolean(entry) && entry.due <= today;
}

/**
 * Aplica una calificación y devuelve la entrada actualizada (no muta la original).
 *
 * @param {{box:number,due:string,reps:number}} entry
 * @param {'again'|'good'|'easy'} grade
 */
export function applyGrade(entry, grade) {
  const today = todayStr();
  const next = { ...entry, reps: (entry.reps || 0) + 1 };

  if (grade === 'again') {
    next.box = 1;
    next.due = addDays(today, 1);
  } else if (grade === 'good') {
    next.box = Math.min(MAX_BOX, next.box + 1);
    next.due = addDays(today, INTERVALS[next.box]);
  } else {
    next.box = Math.min(MAX_BOX, next.box + 2);
    next.due = addDays(today, INTERVALS[next.box] + 3);
  }

  return next;
}

/**
 * Cola de repaso: primero lo vencido; si no hay nada vencido, adelanta las 10
 * tarjetas con fecha más próxima para que la sesión nunca quede vacía.
 */
export function buildQueue(cards, srs, { limitAhead = 10 } = {}) {
  const today = todayStr();
  const due = cards.filter((card) => isDue(srs[card.id], today));

  const pool =
    due.length > 0
      ? due
      : [...cards]
          .sort((a, b) => String(srs[a.id]?.due).localeCompare(String(srs[b.id]?.due)))
          .slice(0, Math.min(limitAhead, cards.length));

  return shuffle(pool);
}

function shuffle(list) {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
