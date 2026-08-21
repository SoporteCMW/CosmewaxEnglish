import { $, escapeHtml } from './dom.js';

/**
 * Avisos y confirmaciones sin diálogos del navegador.
 *
 * `window.confirm()` y `alert()` se sustituyen a propósito: bloquean el hilo,
 * no se pueden estilar y algunos navegadores los suprimen dentro de iframes.
 * Aquí el aviso es un elemento de la página y la confirmación es un doble clic
 * sobre el propio botón, que además deja claro qué se va a borrar.
 */

let toastTimer = null;

export function showToast(message, ms = 5000) {
  const el = $('#appToast');
  if (!el) return;
  el.textContent = message;
  el.hidden = false;
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    el.hidden = true;
  }, ms);
}

export function hideToast() {
  const el = $('#appToast');
  if (el) el.hidden = true;
}

const CONFIRM_WINDOW_MS = 4000;

/**
 * Confirmación en dos clics sobre el mismo botón.
 *
 * Primer clic: el botón pide confirmación. Segundo clic antes de 4 s: ejecuta.
 * Si no llega, vuelve a su estado original solo.
 */
export function confirmThenRun(button, action) {
  if (button.dataset.confirming === '1') {
    window.clearTimeout(Number(button.dataset.confirmTimer));
    button.dataset.confirming = '';
    button.innerHTML = button.dataset.originalHtml || button.textContent;
    action();
    return;
  }

  button.dataset.originalHtml = button.innerHTML;
  button.dataset.confirming = '1';
  button.textContent = '¿Seguro? Pulsa otra vez para confirmar';
  button.dataset.confirmTimer = String(
    window.setTimeout(() => {
      button.dataset.confirming = '';
      button.innerHTML = button.dataset.originalHtml;
    }, CONFIRM_WINDOW_MS)
  );
}

/**
 * Pinta el feedback de la IA resaltando el fallo concreto.
 *
 * La corrección llega con la palabra o expresión errónea entre asteriscos
 * dobles: lo pide el prompt en el servidor (la constante HIGHLIGHT de
 * PromptRegistry). Así el alumno ve QUÉ estaba mal y no sólo que algo lo estaba.
 *
 * Se escapa primero y se sustituye después, en ese orden: escapar no produce
 * asteriscos, así que el único `<strong>` que puede salir de aquí es este y el
 * texto del modelo nunca llega crudo al DOM. Un asterisco desparejado se queda
 * tal cual, visible, que es preferible a comerse texto del feedback.
 */
export function formatFeedbackHtml(text) {
  return escapeHtml(text).replace(/\*\*(.+?)\*\*/g, '<strong class="feedback-error">$1</strong>');
}

/**
 * Envuelve cada palabra de un texto en un span marcable para el cuaderno.
 *
 * Se conserva la puntuación en pantalla pero se guarda la palabra limpia en
 * `data-word`, y el texto completo como contexto para que la traducción sea la
 * del sentido concreto en el que aparece.
 */
export function clickableWords(text, context) {
  const ctx = context || text;
  return String(text)
    .split(/(\s+)/)
    .map((token) => {
      if (token === '') return '';
      if (/^\s+$/.test(token)) return token;
      const clean = token.replace(/^[^a-zA-Z']+/, '').replace(/[^a-zA-Z']+$/, '');
      if (!clean) return escapeHtml(token);
      return (
        `<span class="clickable-word" data-word="${escapeHtml(clean)}" ` +
        `data-ctx="${escapeHtml(ctx)}">${escapeHtml(token)}</span>`
      );
    })
    .join('');
}
