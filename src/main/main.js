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
const { app, ipcMain, globalShortcut, Menu } = require('electron');

const { ASSETS_DIR, AI } = require('./config');
const settings = require('./settings');
const { createCatWindow } = require('./window');
const { Brain } = require('./brain');
const { startInput } = require('./input');
const { startAgentMonitor } = require('./agentMonitor');
const { Reminders } = require('./reminders');
const { createTray } = require('./tray');
const { createOverlayWindow } = require('./overlayWindow');
const { AiAssistant } = require('./aiAssistant');
const { registerHotkey } = require('./hotkey');
const { openConfigWindow } = require('./configWindow');

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

  // Drag ("pick up the cat"): the brain pins the cat to the cursor between these
  // and owns the window's click-through state for the duration.
  ipcMain.on('meow:start-drag', () => brain && brain.startDrag());
  ipcMain.on('meow:end-drag', () => brain && brain.endDrag());

  // --- Brain + subsystems -------------------------------------------------
  brain = new Brain(win, manifest);
  brain.setCat(settings.get('cat'));
  brain.start();

  const reminders = new Reminders(brain);
  reminders.setStretchInterval(settings.get('stretchIntervalMin') || 0);

  services.push(startInput(brain));
  services.push(startAgentMonitor(brain));
  services.push(reminders);

  // --- "Ask MeowDesk" AI assistant (opt-in, off until configured) ---------
  const overlay = createOverlayWindow();
  const aiAssistant = new AiAssistant({ brain, overlay });
  services.push(overlay); // controller exposes stop() -> destroy()

  const tray = createTray({
    brain,
    reminders,
    aiAssistant,
    openConfig: () => openConfigWindow(),
    onQuit: () => app.quit(),
  });

  // Right-click / two-finger click on the cat -> native context menu.
  ipcMain.on('meow:context-menu', () => {
    if (!brain || !win || win.isDestroyed()) return;
    const frozen = !!brain.frozen;
    const aiOn = !!settings.get('aiEnabled');
    const menu = Menu.buildFromTemplate([
      {
        label: frozen ? '❄️ Frozen here' : '😴 Freeze here',
        type: 'checkbox',
        checked: frozen,
        click: () => {
          brain.setFrozen(!frozen);
          tray.setFrozen(brain.frozen);
        },
      },
      {
        label: '🐾 Wander freely',
        enabled: frozen,
        click: () => {
          brain.setFrozen(false);
          tray.setFrozen(false);
        },
      },
      { type: 'separator' },
      { label: '👁 Ask MeowDesk  (⌘⇧A)', click: () => aiAssistant.trigger() },
      { type: 'separator' },
      {
        label: '📺 Screen Reader',
        type: 'checkbox',
        checked: aiOn,
        click: () => {
          settings.set('aiEnabled', !aiOn);
          if (tray.rebuild) tray.rebuild(); // keep the tray's "Enable" check in sync
        },
      },
      { type: 'separator' },
      { label: '❌ Quit MeowDesk', click: () => app.quit() },
    ]);
    menu.popup({ window: win });
  });

  // Global Cmd+Shift+A: ask about whatever's on screen, or toggle the panel.
  services.push(registerHotkey(AI.HOTKEY, () => aiAssistant.trigger()));

  // Overlay sizing / closing, requested by the overlay's own renderer.
  ipcMain.on('overlay:resize', (_e, height) => overlay.resize(height));
  ipcMain.on('overlay:close', () => overlay.hide());

  // Config window <-> settings (the key is decrypted/encrypted via safeStorage).
  ipcMain.handle('ai:get-config', () => ({
    enabled: !!settings.get('aiEnabled'),
    endpoint: settings.get('aiEndpoint') || '',
    apiKey: settings.getSecret('aiApiKey') || '',
    model: settings.get('aiModel') || 'claude-opus-4-8',
    format: settings.get('aiFormat') || 'anthropic',
  }));

  ipcMain.handle('ai:save-config', (_e, cfg) => {
    cfg = cfg || {};
    settings.set('aiEndpoint', String(cfg.endpoint || '').trim());
    settings.set('aiModel', String(cfg.model || '').trim() || 'claude-opus-4-8');
    settings.set('aiFormat', cfg.format === 'openai' ? 'openai' : 'anthropic');
    settings.setSecret('aiApiKey', String(cfg.apiKey || ''));
    if (tray && tray.rebuild) tray.rebuild(); // refresh the "Connected" status line
    return { ok: true };
  });

  ipcMain.handle('ai:verify-config', async (_e, cfg) => {
    try {
      return await aiAssistant.verify(cfg || {});
    } catch (err) {
      return { ok: false, error: (err && err.message) || 'Verification failed.' };
    }
  });
}

// No dock icon — MeowDesk lives in the menu bar only.
if (app.dock) app.dock.hide();

if (hasLock) app.whenReady().then(start);

// Keep running even when the (only) window is "closed"; the tray is the app.
app.on('window-all-closed', (e) => e.preventDefault());

app.on('before-quit', () => {
  globalShortcut.unregisterAll();
  if (brain) brain.stop();
  for (const s of services) {
    if (s && typeof s.stop === 'function') s.stop();
    if (s && typeof s.stopAll === 'function') s.stopAll();
  }
});
