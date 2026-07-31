const ESCAPES = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

/**
 * Escapa texto antes de interpolarlo en una plantilla HTML.
 *
 * Necesario también para el contenido "propio": el alumno puede crear tarjetas
 * y escribir turnos de conversación, así que todo texto es entrada de usuario.
 */
export function escapeHtml(value) {
  return String(value === null || value === undefined ? '' : value).replace(
    /[&<>"']/g,
    (char) => ESCAPES[char]
  );
}

export function $(selector, root = document) {
  return root.querySelector(selector);
}

/** Delegación de eventos: sobrevive a los re-renders del contenedor. */
export function delegate(root, eventName, selector, handler) {
  root.addEventListener(eventName, (event) => {
    const target = event.target instanceof Element ? event.target.closest(selector) : null;
    if (target && root.contains(target)) {
      handler(event, target);
    }
  });
}

export function setBusy(element, busy) {
  if (element) element.toggleAttribute('disabled', Boolean(busy));
}
