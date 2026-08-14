import { $, delegate, escapeHtml } from '../core/dom.js';
import { speak } from '../core/speech.js';
import { showToast } from '../core/ui.js';

/**
 * Modo cuaderno: lista las palabras marcadas en los demás modos y permite
 * ascenderlas a tarjeta de repaso.
 *
 * El estado no vive aquí sino en `core/notebook-service.js`, porque cuatro modos
 * añaden palabras y sólo este las muestra. Se suscribe a los cambios del
 * servicio para repintarse cuando otro modo añade algo.
 */
export function createNotebookMode({ notebook, onPromote }) {
  const el = {
    stats: $('#notebookStatsRow'),
    body: $('#notebookBody'),
  };

  function init() {
    delegate(el.body, 'click', '[data-action]', (event, target) => {
      const { action, id } = target.dataset;
      if (action === 'say') speak(target.dataset.text, { rate: 0.85 });
      if (action === 'promote') promote(id);
      if (action === 'remove') remove(id);
    });

    // Otro modo puede añadir una palabra mientras este está abierto.
    notebook.onChange(() => {
      renderStats();
      render();
    });
  }

  function renderStats() {
    const total = notebook.count();
    if (!total) {
      el.stats.style.display = 'none';
      return;
    }
    const promoted = notebook.promotedCount();
    el.stats.style.display = 'grid';
    el.stats.innerHTML = `
      <div class="stat"><div class="n">${total}</div><div class="l">Palabras guardadas</div></div>
      <div class="stat"><div class="n">${promoted}</div><div class="l">En tarjetas</div></div>
      <div class="stat"><div class="n">${total - promoted}</div><div class="l">Pendientes</div></div>`;
  }

  function render() {
    const entries = notebook.all();
    if (!entries.length) {
      el.body.innerHTML = `
        <div class="empty-state">
          <div class="big">Tu cuaderno está vacío</div>
          Ve a Conversación, Lectura, Listening o Gramática y pulsa cualquier palabra del texto
          para añadirla aquí, con su traducción en ese contexto.
        </div>`;
      return;
    }

    el.body.innerHTML = entries
      .map(
        (entry) => `
          <article class="notebook-entry">
            <div class="notebook-source-tag">${entry.promoted ? '✓ En tarjetas' : 'Nueva'}</div>
            <div class="notebook-word">${escapeHtml(entry.word)}</div>
            <div class="notebook-translation">${escapeHtml(entry.translation)}</div>
            <div class="notebook-example">"${escapeHtml(entry.example)}"</div>
            <div class="notebook-actions">
              <button type="button" data-action="say" data-text="${escapeHtml(entry.example)}">🔊 Escuchar</button>
              <button type="button" data-action="promote" data-id="${escapeHtml(entry.id)}"
                      class="${entry.promoted ? 'is-promoted' : ''}" ${entry.promoted ? 'disabled' : ''}>
                ${entry.promoted ? '✓ Ya está en Tarjetas' : '➕ Añadir a Tarjetas'}
              </button>
              <button type="button" data-action="remove" data-id="${escapeHtml(entry.id)}">🗑 Borrar</button>
            </div>
          </article>`
      )
      .join('');
  }

  async function promote(id) {
    const entry = notebook.find(id);
    if (!entry || entry.promoted) return;

    await onPromote(entry);
    await notebook.markPromoted(id);
    showToast(`"${entry.word}" añadida a tus Tarjetas (categoría Cuaderno).`);
  }

  async function remove(id) {
    await notebook.remove(id);
  }

  return {
    init,
    show() {
      renderStats();
      render();
    },
    hide() {},
    async reset() {
      await notebook.clear();
      renderStats();
      render();
    },
  };
}
