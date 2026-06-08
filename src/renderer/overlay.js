// ---------------------------------------------------------------------------
// overlay.js — renderer for the answer panel.
//
// Receives answer text from main, renders it safely (everything HTML-escaped;
// only fenced code blocks, inline `code`, and **bold** get light formatting),
// measures the result and asks main to size the window, then fades in. Closing
// fades out and tells main to hide.
// ---------------------------------------------------------------------------

/* global meowOverlay */

(function () {
  const panel = document.getElementById('panel');
  const bar = document.getElementById('bar');
  const content = document.getElementById('content');
  const closeBtn = document.getElementById('close');

  function escapeHtml(s) {
    return String(s).replace(
      /[&<>"']/g,
      (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
    );
  }

  function renderCodeBlock(raw) {
    let s = raw.replace(/\n$/, '');
    const nl = s.indexOf('\n');
    if (nl >= 0) {
      const first = s.slice(0, nl).trim();
      // Drop a leading bare language tag line (e.g. ```js).
      if (/^[a-zA-Z0-9_+#.-]{0,20}$/.test(first)) s = s.slice(nl + 1);
    }
    return '<pre><code>' + escapeHtml(s) + '</code></pre>';
  }

  function renderInline(text) {
    return escapeHtml(text)
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  }

  // Split on fenced code blocks (odd segments are code), paragraph-wrap the rest.
  function render(text) {
    const parts = String(text).split('```');
    let html = '';
    for (let i = 0; i < parts.length; i++) {
      if (i % 2 === 1) {
        html += renderCodeBlock(parts[i]);
      } else {
        const blocks = parts[i]
          .split(/\n{2,}/)
          .map((b) => b.replace(/\s+$/, ''))
          .filter((b) => b.trim().length);
        for (const b of blocks) html += '<p>' + renderInline(b) + '</p>';
      }
    }
    return html || '<p></p>';
  }

  function measureAndResize() {
    // Total natural height = title bar + full content + panel border.
    const h = bar.offsetHeight + content.scrollHeight + 6;
    meowOverlay.requestResize(h);
  }

  function show(text) {
    content.innerHTML = render(text);
    content.scrollTop = 0;
    panel.classList.remove('hide');
    // Measure after layout, then fade in on the next frame.
    requestAnimationFrame(() => {
      measureAndResize();
      requestAnimationFrame(() => panel.classList.add('show'));
    });
  }

  function dismiss() {
    panel.classList.remove('show');
    panel.classList.add('hide');
    setTimeout(() => meowOverlay.close(), 200); // matches the CSS transition
  }

  meowOverlay.onContent((payload) => show((payload && payload.text) || ''));
  meowOverlay.onDismiss(dismiss);
  closeBtn.addEventListener('click', dismiss);
})();
