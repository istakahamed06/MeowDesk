// ---------------------------------------------------------------------------
// configWindow.js — the "MeowDesk AI Settings" window.
//
// Unlike the cat (a menu-bar-only, dockless sprite), this is an ordinary little
// settings window: focusable, in the dock/taskbar while open, single instance.
// It just hosts the form; all the get/save/verify logic lives behind IPC in
// main.js (ai:get-config / ai:save-config / ai:verify-config).
// ---------------------------------------------------------------------------

const path = require('path');
const { app, BrowserWindow } = require('electron');

let win = null;

function openConfigWindow() {
  if (win && !win.isDestroyed()) {
    win.show();
    win.focus();
    return win;
  }

  // Bring the app into the dock for as long as the settings window is open.
  if (app.dock) app.dock.show();

  win = new BrowserWindow({
    width: 400,
    height: 320,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: false, // show in the taskbar/dock (unlike the cat window)
    title: 'MeowDesk AI Settings',
    backgroundColor: '#15151f',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'configPreload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win.loadFile(path.join(__dirname, '..', 'renderer', 'config.html'));
  win.once('ready-to-show', () => {
    win.show();
    win.focus();
  });
  win.on('closed', () => {
    win = null;
    // Back to menu-bar-only once settings are closed.
    if (app.dock) app.dock.hide();
  });

  return win;
}

function closeConfigWindow() {
  if (win && !win.isDestroyed()) win.close();
}

module.exports = { openConfigWindow, closeConfigWindow };
