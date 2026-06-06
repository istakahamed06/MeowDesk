// ---------------------------------------------------------------------------
// main.js — application entry point.
//
// Boots Electron, loads the sprite manifest, creates the floating window, and
// wires together the four subsystems that feed the brain:
//   input         -> typing reactions
//   agentMonitor  -> AI-agent "thinking"/"done" moods
//   reminders     -> stretch + Pomodoro
//   tray          -> the user's controls
//
// The brain owns all behaviour and is the single thing that talks to the
// renderer. Everything is local and offline.
// ---------------------------------------------------------------------------

const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const { app, ipcMain } = require('electron');

const { ASSETS_DIR } = require('./config');
const settings = require('./settings');
const { createCatWindow } = require('./window');
const { Brain } = require('./brain');
const { startInput } = require('./input');
const { startAgentMonitor } = require('./agentMonitor');
const { Reminders } = require('./reminders');
const { createTray } = require('./tray');

// Only ever one MeowDesk at a time. If a second copy launches, it quits
// immediately and never starts up.
const hasLock = app.requestSingleInstanceLock();
if (!hasLock) app.quit();

let win = null;
let brain = null;
const services = []; // things with a stop() to clean up on quit

function loadManifest() {
  const raw = fs.readFileSync(path.join(ASSETS_DIR, 'manifest.json'), 'utf8');
  return JSON.parse(raw);
}

function start() {
  const manifest = loadManifest();
  const assetsUrl = pathToFileURL(ASSETS_DIR).href.replace(/\/$/, '');

  win = createCatWindow();

  // Renderer handshake: hand over the manifest, the assets URL, and which cat
  // to show first (restored from settings).
  ipcMain.handle('meow:init', () => ({
    manifest,
    assetsUrl,
    cat: settings.get('cat'),
  }));

  // Click-through toggle requested by the renderer's hover detection.
  ipcMain.on('meow:set-ignore', (_e, ignore) => {
    if (win && !win.isDestroyed()) {
      win.setIgnoreMouseEvents(!!ignore, { forward: true });
    }
  });

  // The cat was clicked.
  ipcMain.on('meow:poke', () => brain && brain.poke());

  // --- Brain + subsystems -------------------------------------------------
  brain = new Brain(win, manifest);
  brain.setCat(settings.get('cat'));
  brain.start();

  const reminders = new Reminders(brain);
  reminders.setStretchInterval(settings.get('stretchIntervalMin') || 0);

  services.push(startInput(brain));
  services.push(startAgentMonitor(brain));
  services.push(reminders);

  createTray({
    brain,
    reminders,
    onQuit: () => app.quit(),
  });
}

// No dock icon — MeowDesk lives in the menu bar only.
if (app.dock) app.dock.hide();

if (hasLock) app.whenReady().then(start);

// Keep running even when the (only) window is "closed"; the tray is the app.
app.on('window-all-closed', (e) => e.preventDefault());

app.on('before-quit', () => {
  if (brain) brain.stop();
  for (const s of services) {
    if (s && typeof s.stop === 'function') s.stop();
    if (s && typeof s.stopAll === 'function') s.stopAll();
  }
});
