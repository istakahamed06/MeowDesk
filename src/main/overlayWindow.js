// ---------------------------------------------------------------------------
// overlayWindow.js — the floating answer panel next to the cat.
//
// One persistent, transparent, frameless, always-on-top window that we keep
// hidden and reuse. main.js gets a small controller (show / dismiss / hide /
// resize / isVisible) and never touches the BrowserWindow directly.
//
// Sizing is content-driven: the renderer measures its rendered answer and asks
// us (via 'overlay:resize') to size the window, which we clamp and re-center on
// the right edge of whichever display the cursor is on. Closing fades out in
// the renderer first, then calls back to actually hide.
// ---------------------------------------------------------------------------

const path = require('path');
const { BrowserWindow, screen } = require('electron');
const { AI } = require('./config');

function createOverlayWindow() {
  const win = new BrowserWindow({
    width: AI.OVERLAY_WIDTH,
    height: AI.OVERLAY_MIN_HEIGHT,
    show: false,
    transparent: true,
    frame: false,
    hasShadow: false,
    resizable: false,
    focusable: false, // never steal focus from the user's actual work
    skipTaskbar: true,
    alwaysOnTop: true,
    fullscreenable: false,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'overlayPreload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win.setAlwaysOnTop(true, 'screen-saver');
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  win.loadFile(path.join(__dirname, '..', 'renderer', 'overlay.html'));

  let curHeight = AI.OVERLAY_MIN_HEIGHT;
  let autoTimer = null;
  let showFallback = null;
  let pendingShow = false;

  function clearAuto() {
    if (autoTimer) clearTimeout(autoTimer);
    autoTimer = null;
  }

  function position() {
    if (win.isDestroyed()) return;
    const disp = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    const wa = disp.workArea;
    const w = AI.OVERLAY_WIDTH;
    const x = wa.x + wa.width - w - AI.OVERLAY_MARGIN;
    const y = Math.round(wa.y + (wa.height - curHeight) / 2);
    win.setBounds({ x, y, width: w, height: curHeight });
  }

  function reveal() {
    if (showFallback) clearTimeout(showFallback);
    showFallback = null;
    pendingShow = false;
    position();
    if (!win.isDestroyed() && !win.isVisible()) win.showInactive();
    clearAuto();
    autoTimer = setTimeout(() => controller.dismiss(), AI.OVERLAY_AUTOCLOSE_MS);
  }

  const controller = {
    show(text) {
      if (win.isDestroyed()) return;
      curHeight = AI.OVERLAY_MIN_HEIGHT;
      pendingShow = true;
      win.webContents.send('overlay:content', { text });
      // Reveal once the renderer reports its size; fall back if that never comes.
      if (showFallback) clearTimeout(showFallback);
      showFallback = setTimeout(reveal, 300);
    },

    // Begin a fade-out; the renderer calls back via 'overlay:close' -> hide().
    dismiss() {
      clearAuto();
      if (!win.isDestroyed() && win.isVisible()) win.webContents.send('overlay:dismiss');
      else controller.hide();
    },

    hide() {
      clearAuto();
      pendingShow = false;
      if (!win.isDestroyed() && win.isVisible()) win.hide();
    },

    isVisible() {
      return !win.isDestroyed() && win.isVisible();
    },

    resize(height) {
      curHeight = Math.max(
        AI.OVERLAY_MIN_HEIGHT,
        Math.min(AI.OVERLAY_MAX_HEIGHT, Math.round(height) || AI.OVERLAY_MIN_HEIGHT)
      );
      if (pendingShow) reveal();
      else if (controller.isVisible()) position();
    },

    destroy() {
      clearAuto();
      if (showFallback) clearTimeout(showFallback);
      if (!win.isDestroyed()) win.destroy();
    },

    // main.js cleanup hook.
    stop() {
      controller.destroy();
    },

    win,
  };

  return controller;
}

module.exports = { createOverlayWindow };
