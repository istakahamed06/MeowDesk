// ---------------------------------------------------------------------------
// window.js — creates the floating cat window.
//
// The window is a small, transparent, frameless, always-on-top surface that we
// reposition every frame so the cat appears to roam the desktop. It must never
// steal focus or show in the dock/taskbar, and clicks should pass through to
// whatever is underneath — except when the pointer is actually over the cat
// (the renderer toggles that via the 'meow:set-ignore' IPC message).
// ---------------------------------------------------------------------------

const path = require('path');
const { BrowserWindow, screen } = require('electron');
const { WINDOW_SIZE } = require('./config');

function createCatWindow() {
  // Start parked in the bottom-right corner of the primary display's work area.
  const { workArea } = screen.getPrimaryDisplay();
  const startX = workArea.x + workArea.width - WINDOW_SIZE - 24;
  const startY = workArea.y + workArea.height - WINDOW_SIZE - 24;

  const win = new BrowserWindow({
    width: WINDOW_SIZE,
    height: WINDOW_SIZE,
    x: startX,
    y: startY,
    transparent: true, // see-through background
    frame: false, // no title bar / chrome
    hasShadow: false,
    resizable: false,
    movable: false, // we move it programmatically, not by dragging the frame
    focusable: false, // never grab keyboard focus from the user's real work
    skipTaskbar: true, // no taskbar entry
    alwaysOnTop: true,
    fullscreenable: false,
    // Don't show until the renderer has painted, to avoid a flash.
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      // Needed so the renderer can load sprite PNGs via file:// URLs.
      webSecurity: false,
    },
  });

  // Float above full-screen apps and on every Space/desktop.
  win.setAlwaysOnTop(true, 'screen-saver');
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

  // Start click-through; the renderer flips this off while the pointer is over
  // an opaque part of the cat. `forward: true` keeps mousemove events flowing
  // to the page so it can detect that hover.
  win.setIgnoreMouseEvents(true, { forward: true });

  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

  win.once('ready-to-show', () => win.show());

  return win;
}

module.exports = { createCatWindow };
