// ---------------------------------------------------------------------------
// input.js — global keyboard detection for "typing" reactions.
//
// We use uiohook-napi to hear key presses anywhere in the OS (an Electron app
// can't otherwise see keystrokes typed into *other* apps). On each keypress we
// measure the recent keys-per-second and hand that to the brain, which decides
// whether to play the excited "react" animation.
//
// macOS note: this needs Accessibility permission (System Settings → Privacy &
// Security → Accessibility). Without it the hook simply never fires — no crash —
// and the cat just won't react to typing. Cursor following still works because
// that uses Electron's screen API, not this hook.
// ---------------------------------------------------------------------------

const { TYPING } = require('./config');

function startInput(brain) {
  let uIOhook;
  try {
    ({ uIOhook } = require('uiohook-napi'));
  } catch (err) {
    console.warn('[input] uiohook-napi unavailable, typing detection disabled:', err.message);
    return { stop() {} };
  }

  // Timestamps of recent keydowns, trimmed to the measurement window.
  const recent = [];

  function onKeyDown() {
    const now = Date.now();
    recent.push(now);
    while (recent.length && now - recent[0] > TYPING.WINDOW_MS) recent.shift();
    const keysPerSec = recent.length / (TYPING.WINDOW_MS / 1000);
    brain.noteKeystroke(keysPerSec);
  }

  try {
    uIOhook.on('keydown', onKeyDown);
    uIOhook.start();
    console.log('[input] global keyboard hook started');
  } catch (err) {
    console.warn('[input] failed to start uiohook:', err.message);
    return { stop() {} };
  }

  return {
    stop() {
      try {
        uIOhook.stop();
      } catch {
        /* ignore */
      }
    },
  };
}

module.exports = { startInput };
