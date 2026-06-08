// ---------------------------------------------------------------------------
// hotkey.js — the single global keyboard shortcut for "Ask MeowDesk".
//
// A thin wrapper around Electron's globalShortcut so main.js doesn't have to
// care about the registration details. The accelerator works system-wide (even
// when another app is focused), which is the whole point — you hit Cmd+Shift+A
// while looking at whatever you need help with.
//
// Registration can fail if another app already owns the combo; that's not fatal
// (the tray still works), so we just warn and carry on.
// ---------------------------------------------------------------------------

const { globalShortcut } = require('electron');

function registerHotkey(accelerator, callback) {
  let ok = false;
  try {
    ok = globalShortcut.register(accelerator, () => {
      try {
        callback();
      } catch (err) {
        console.error('[hotkey] handler threw:', err);
      }
    });
    if (ok) {
      console.log(`[hotkey] registered ${accelerator}`);
    } else {
      console.warn(`[hotkey] could not register ${accelerator} (already in use?)`);
    }
  } catch (err) {
    console.warn(`[hotkey] failed to register ${accelerator}:`, err.message);
  }

  return {
    registered: ok,
    unregister() {
      try {
        globalShortcut.unregister(accelerator);
      } catch {
        /* ignore */
      }
    },
    // main.js pushes this into its services list, which calls stop() on quit.
    stop() {
      this.unregister();
    },
  };
}

module.exports = { registerHotkey };
