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

  // --- Behaviour: walking -------------------------------------------------
  // The cat SITS by default. It only gets up and walks when you wander off
  // and stay away — it does not chase the cursor.
  BEHAVIOR: {
    WALK_TRIGGER_DIST: 250, // cursor must be at least this far from the cat...
    WALK_TRIGGER_MS: 2000, //   ...for this long before the cat decides to walk
    STOP_MIN: 80, // it stops somewhere in this band from the cursor (cats don't
    STOP_MAX: 120, //   sit ON you); the exact distance is rolled per trip
    DECEL_DIST: 50, // start easing off the throttle within this far of the target
    WALK_EASE: 0.12, // 0..1 lerp per tick while walking
    WALK_MIN_SPEED: 0.18, // floor on the decel scale so the last steps don't crawl forever
    ARRIVE_EPS: 0.6, // px/tick below which a walk counts as "arrived"
    CHANGE_MIND_CHANCE: 0.0016, // per-tick chance to pause mid-walk ("changes its mind")
    CHANGE_MIND_MIN_MS: 600, // how long that little pause lasts...
    CHANGE_MIND_MAX_MS: 1400,
    CURSOR_OVER_DIST: 44, // cursor this close = "right on top of the cat" -> look up
  },

  // --- Behaviour: napping / startling ------------------------------------
  NAP_AFTER_MS: 60_000, // 60s with no nearby cursor/keyboard activity -> sleep
  NAP_NEAR_RADIUS: 150, // what counts as "nearby" for dozing off and for waking
  ALERT_SPEED: 500, // px/s the cursor must zip past at to startle the cat...
  ALERT_NEAR_RADIUS: 250, //   ...while within this radius
  ALERT_MS: 900, // how long the wide-eyed startled look holds

  // --- Idle action scheduler (personality.js) ----------------------------
  IDLE: {
    MIN_MS: 8_000, // soonest a fresh random idle action fires while sitting
    MAX_MS: 20_000, // latest
    LOOK_MS: 2_000, // LOOK_LEFT / LOOK_RIGHT eye-glance duration
    GROOM_MS: 2_400, // groom (uses the stretch strip) duration
    YAWN_MS: 1_600, // yawn / stretch duration
  },

  // --- Eyes ---------------------------------------------------------------
  EYE: {
    UPDATE_MS: 100, // recompute the glance direction at most this often (a glance,
    //                not an intent stare)
    MAX_OFFSET: 2, // px the pupils shift toward the cursor (sprite space)
    THINK_DART_MS: 1100, // while the agent is "thinking", dart the eyes this often
  },

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

  // --- "Ask MeowDesk" AI assistant (opt-in, off by default) ---------------
  AI: {
    HOTKEY: 'CommandOrControl+Shift+A', // Cmd+Shift+A on macOS
    MAX_TOKENS: 1024,
    TIMEOUT_MS: 30_000, // abort the API call after this long
    // Cap the screenshot's long edge. 1568 is Anthropic's no-resize sweet spot;
    // it also keeps the base64 payload comfortably under the 5MB/image limit and
    // trims token cost. The server downscales anything larger anyway.
    CAPTURE_LONG_EDGE: 1568,
    JPEG_FALLBACK_BYTES: 4_500_000, // if the PNG base64 exceeds this, send JPEG
    OVERLAY_WIDTH: 320,
    OVERLAY_MIN_HEIGHT: 120,
    OVERLAY_MAX_HEIGHT: 500,
    OVERLAY_MARGIN: 24, // gap from the screen edge
    OVERLAY_AUTOCLOSE_MS: 60_000,
  },

  // --- Defaults (overridden by saved settings if present) -----------------
  DEFAULTS: {
    cat: 'oreo', // Oreo is the headline cat
    stretchIntervalMin: 0, // off

    // AI assistant — everything off/empty until the user configures it.
    aiEnabled: false, // master toggle
    aiEndpoint: '', // e.g. https://api.anthropic.com/v1/messages
    aiApiKey: '', // stored encrypted via safeStorage when available
    aiModel: 'claude-opus-4-8',
    aiFormat: 'anthropic', // 'anthropic' | 'openai'
  },
};
