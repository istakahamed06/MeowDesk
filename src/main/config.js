// ---------------------------------------------------------------------------
// config.js — all the tunable numbers in one place.
//
// Keeping these together makes the cat's "feel" easy to tweak without hunting
// through the logic. Everything here is plain data; no Electron imports so it
// can be required from anywhere in the main process.
// ---------------------------------------------------------------------------

const path = require('path');

module.exports = {
  // Where the preprocessed sprites + manifest live (built by tools/build_atlas.py).
  ASSETS_DIR: path.join(__dirname, '..', '..', 'assets', 'generated'),

  // --- Window / rendering -------------------------------------------------
  WINDOW_SIZE: 128, // logical px; the 64px sprite is drawn at 2x -> crisp on retina
  FRAME_SIZE: 64,

  // --- Brain tick ---------------------------------------------------------
  TICK_MS: 16, // ~60 fps position/state update

  // --- Cursor following ---------------------------------------------------
  FOLLOW: {
    STOP_DISTANCE: 90, // cat halts this far from the cursor (pet-like trailing)
    EASE: 0.07, // 0..1 lerp factor per tick — lower = slower, floatier
    MOVE_EPS: 0.35, // px/tick below which the cat is considered "stopped"
  },

  // --- Idle -> sleep ------------------------------------------------------
  SLEEP_AFTER_MS: 30_000, // 30s of no mouse/keyboard activity -> sleep

  // --- Typing detection ---------------------------------------------------
  TYPING: {
    FAST_KEYS_PER_SEC: 3, // faster than this counts as "typing hard" -> react
    WINDOW_MS: 1000, // sliding window used to measure keys/sec
    RELEASE_MS: 2000, // return to idle this long after the last keystroke
  },

  // --- AI agent monitoring ------------------------------------------------
  AGENT: {
    POLL_MS: 2000, // how often to check process CPU
    CPU_THRESHOLD: 10, // %CPU above which an agent is "thinking"
    // Matched (case-insensitive substring) against the process command column.
    PROCESS_PATTERNS: ['claude', 'antigravity'],
  },

  // --- Reminders ----------------------------------------------------------
  STRETCH_INTERVALS_MIN: [0, 20, 30, 45], // 0 = off
  POMODORO_WORK_MIN: 25,

  // --- Defaults (overridden by saved settings if present) -----------------
  DEFAULTS: {
    cat: 'oreo', // Oreo is the headline cat
    stretchIntervalMin: 0, // off
  },
};
