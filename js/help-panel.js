/* help-panel.js — Panel de ayuda deslizante corporativo Cosmewax */
(function () {
    'use strict';

    const panel   = document.getElementById('helpPanel');
    const overlay = document.getElementById('helpOverlay');
    const openBtn = document.getElementById('helpOpenBtn');
    const closeBtn = document.getElementById('helpCloseBtn');
    const search  = document.getElementById('helpSearch');
    const noRes   = document.getElementById('helpNoResults');
    const resizeHandle = document.getElementById('helpResizeHandle');

    if (!panel) return;

    // ── Abrir / cerrar ────────────────────────────────────────────────────────
    function open() {
        panel.classList.add('open');
        overlay.classList.add('open');
        document.body.style.overflow = 'hidden';
        setTimeout(() => search && search.focus(), 320);
    }

    function close() {
        panel.classList.remove('open');
        overlay.classList.remove('open');
        document.body.style.overflow = '';
    }

    openBtn  && openBtn.addEventListener('click', open);
    closeBtn && closeBtn.addEventListener('click', close);
    overlay  && overlay.addEventListener('click', close);

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && panel.classList.contains('open')) close();
    });

    // ── Secciones expandibles ─────────────────────────────────────────────────
    document.querySelectorAll('.help-section-toggle').forEach((btn) => {
        btn.addEventListener('click', () => {
            const section = btn.closest('.help-section');
            const wasOpen = section.classList.contains('expanded');
            // Cerrar todas
            document.querySelectorAll('.help-section').forEach(s => s.classList.remove('expanded'));
            // Abrir la pulsada (si no estaba abierta)
            if (!wasOpen) section.classList.add('expanded');
        });
    });

    // ── Búsqueda ──────────────────────────────────────────────────────────────
    search && search.addEventListener('input', () => {
        const q = search.value.trim().toLowerCase();
        let found = 0;

        document.querySelectorAll('.help-section').forEach((section) => {
            const kw    = (section.dataset.kw || '').toLowerCase();
            const label = section.querySelector('.help-section-label')?.textContent.toLowerCase() || '';
            const body  = section.querySelector('.help-section-body')?.textContent.toLowerCase() || '';
            const match = !q || kw.includes(q) || label.includes(q) || body.includes(q);

            section.style.display = match ? '' : 'none';
            if (match) {
                found++;
                if (q) section.classList.add('expanded');
            }
        });

        if (noRes) noRes.style.display = found === 0 ? 'block' : 'none';
    });

    // ── Lightbox para imágenes ────────────────────────────────────────────────
    const lightbox = document.createElement('div');
    lightbox.className = 'help-lightbox';
    lightbox.innerHTML = '<button class="help-lightbox-close" title="Cerrar">✕</button><img alt="">';
    document.body.appendChild(lightbox);

    const lbImg   = lightbox.querySelector('img');
    const lbClose = lightbox.querySelector('.help-lightbox-close');

    document.addEventListener('click', (e) => {
        if (e.target.classList.contains('help-img')) {
            lbImg.src = e.target.src;
            lbImg.alt = e.target.alt || '';
            lightbox.classList.add('open');
        }
    });

    function closeLightbox() { lightbox.classList.remove('open'); }
    lbClose && lbClose.addEventListener('click', closeLightbox);
    lightbox.addEventListener('click', (e) => { if (e.target === lightbox) closeLightbox(); });
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') closeLightbox();
    });

    // ── Redimensionado del panel (arrastrar borde izquierdo) ──────────────────
    if (resizeHandle) {
        const STORAGE_KEY = 'helpPanelWidth';
        const DEFAULT_W   = 500;
        const MIN_W       = 320;
        const MAX_W       = Math.min(900, window.innerWidth * 0.92);

        // Restaurar ancho guardado
        const saved = parseInt(localStorage.getItem(STORAGE_KEY) || '', 10);
        if (saved >= MIN_W) panel.style.width = saved + 'px';

        let startX = 0, startW = 0, dragging = false;

        resizeHandle.addEventListener('mousedown', (e) => {
            dragging = true;
            startX   = e.clientX;
            startW   = panel.offsetWidth;
            resizeHandle.classList.add('is-dragging');
            document.body.style.userSelect = 'none';
            e.preventDefault();
        });

        document.addEventListener('mousemove', (e) => {
            if (!dragging) return;
            const delta = startX - e.clientX;
            const newW  = Math.min(MAX_W, Math.max(MIN_W, startW + delta));
            panel.style.width = newW + 'px';
        });

        document.addEventListener('mouseup', () => {
            if (!dragging) return;
            dragging = false;
            resizeHandle.classList.remove('is-dragging');
            document.body.style.userSelect = '';
            localStorage.setItem(STORAGE_KEY, panel.offsetWidth.toString());
        });

        // Doble clic → restablecer al ancho por defecto
        resizeHandle.addEventListener('dblclick', () => {
            panel.style.width = DEFAULT_W + 'px';
            localStorage.removeItem(STORAGE_KEY);
        });
    }
})();
