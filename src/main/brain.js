// ---------------------------------------------------------------------------
// brain.js — the cat's behaviour, all in the main process.
//
// v2 philosophy: the cat is a PET, not a laser pointer. It SITS by default at a
// home position and only gets up and walks when you wander off and stay away.
// The cursor never drags it around — the cursor only colours its mood and where
// its eyes glance.
//
// It's a small state machine. Each TICK_MS the brain:
//   1. reads the cursor (position + speed) and notices nearby activity,
//   2. runs the behaviour FSM — base states SITTING / WALKING / SLEEPING, with
//      THINKING / REACTING / ALERT layered on top as short-lived "moods",
//   3. works out where the eyes should glance (throttled, a glance not a stare),
//   4. repositions the window and, when anything changed, pushes the new
//      { cat, state, facing, eye } to the renderer.
//
// Other subsystems (input, agentMonitor, reminders, tray) don't render anything
// themselves — they just flip flags / call triggers on the brain. Their entry
// points (noteKeystroke / setAgentThinking / setPomodoroTired / playOnce / poke
// / setCat / getCat) are unchanged from v1.
// ---------------------------------------------------------------------------

const { screen } = require('electron');
const {
  BEHAVIOR,
  NAP_AFTER_MS,
  NAP_NEAR_RADIUS,
  ALERT_SPEED,
  ALERT_NEAR_RADIUS,
  ALERT_MS,
  EYE,
  TYPING,
  TICK_MS,
  WINDOW_SIZE,
} = require('./config');
const { Personality } = require('./personality');

// Eight compass directions, ordered so that index = round(angle / 45°) with
// screen coordinates (y grows downward, so +90° is "south"/down).
const DIRS8 = ['E', 'SE', 'S', 'SW', 'W', 'NW', 'N', 'NE'];

function rand(min, max) {
  return min + Math.random() * (max - min);
}

function angleToDir(dx, dy) {
  let deg = (Math.atan2(dy, dx) * 180) / Math.PI; // -180..180, +y = down
  if (deg < 0) deg += 360;
  return DIRS8[Math.round(deg / 45) % 8];
}

class Brain {
  constructor(win, manifest) {
    this.win = win;
    this.manifest = manifest;

    // Position is the cat's center, in global screen coordinates. Home is where
    // it's currently resting — it starts wherever the window was placed (bottom
    // right) and becomes "wherever it last sat down" after a walk.
    const b = win.getBounds();
    this.pos = { x: b.x + b.width / 2, y: b.y + b.height / 2 };
    this.home = { x: this.pos.x, y: this.pos.y };
    this.facing = 'left';

    this.cat = manifest.cats.oreo ? 'oreo' : Object.keys(manifest.cats)[0];

    // Base FSM state: 'sitting' | 'walking' | 'sleeping'.
    this.behavior = 'sitting';

    // v4 user overrides layered on top of the FSM.
    this.frozen = false; // "Freeze here": pinned in place, never walks off
    this.dragging = false; // being picked up and carried by the cursor

    // Cursor tracking.
    const c = screen.getCursorScreenPoint();
    this.lastCursor = c;
    this.cursorSpeed = 0; // px/s, smoothed
    this.lastTickAt = Date.now();
    this.lastNearActivityAt = Date.now(); // last nearby cursor move OR keypress

    // Walking trip state.
    this.farSince = 0; // when the cursor first went (and stayed) beyond trigger dist
    this.walkStopDist = 0; // rolled per trip within [STOP_MIN, STOP_MAX]
    this.changeMindUntil = 0; // brief mid-walk pause ("changed its mind")

    // Moods layered over the base state.
    this.lastKeyAt = 0;
    this.reactUntil = 0; // typing reaction holds until this time
    this.alertUntil = 0; // startled wide-eyes hold until this time
    this.agentThinking = false;
    this.pomodoroTired = false;

    // One-shot ("transient") animations like happy / stretch take over briefly.
    this.transientState = null;
    this.transientUntil = 0;

    // Eyes: a discrete glance direction + a mode, recomputed at most every
    // EYE.UPDATE_MS. The renderer turns these into a 1–2px pupil shift.
    this.eye = { dir: 'S', mode: 'open' };
    this.lastEyeAt = 0;
    this.thinkDir = 'E'; // current dart direction while thinking
    this.thinkDartAt = 0;

    // Random idle behaviour (glance / groom / yawn) while sitting.
    this.personality = new Personality();
    this.idleAction = null; // current action object from the scheduler, or null

    // Last payload sent to the renderer, to avoid spamming identical updates.
    this.sent = { cat: null, state: null, facing: null, eyeDir: null, eyeMode: null };
    this.state = 'idle';

    this.timer = null;
  }

  start() {
    this.timer = setInterval(() => this.#tick(), TICK_MS);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
  }

  // ---- Inputs from other subsystems (unchanged public API) ---------------

  setCat(cat) {
    if (this.manifest.cats[cat]) {
      this.cat = cat;
      this.#send(true); // force an immediate swap on the renderer
    }
  }

  getCat() {
    return this.cat;
  }

  noteKeystroke(keysPerSec) {
    const now = Date.now();
    this.lastKeyAt = now;
    this.lastNearActivityAt = now; // typing counts as activity (don't doze off)
    if (keysPerSec >= TYPING.FAST_KEYS_PER_SEC) {
      this.reactUntil = now + TYPING.RELEASE_MS;
      // Very fast typing gets an occasional playful hop instead of a flat react.
      if (keysPerSec >= TYPING.FAST_KEYS_PER_SEC * 2 && Math.random() < 0.04) {
        this.playOnce('happy', 500);
      }
    }
    if (this.behavior === 'sleeping') this.#wake(now); // a keypress wakes the cat
  }

  setAgentThinking(on) {
    this.agentThinking = on;
  }

  setPomodoroTired(on) {
    this.pomodoroTired = on;
  }

  // Play a one-shot animation (happy hop, stretch) for its natural length.
  playOnce(state, minMs = 0) {
    const anim = this.manifest.cats[this.cat].states[state];
    // Fall back gracefully if this cat lacks the animation.
    this.transientState = anim ? state : state === 'happy' ? 'walk' : 'idle';
    const dur = anim ? (anim.frames / anim.fps) * 1000 : 600;
    this.transientUntil = Date.now() + Math.max(dur, minMs);
  }

  poke() {
    this.playOnce('happy', 700); // clicking the cat = a happy hop
  }

  // ---- Drag ("pick up the cat") and Freeze (v4) --------------------------

  // The cat was grabbed: suspend the behaviour FSM (#tick now glues it to the
  // cursor each frame until endDrag()) and make the whole window interactive so
  // it keeps receiving mouse events while being carried.
  startDrag() {
    this.dragging = true;
    this.transientUntil = 0; // drop any one-shot so the carried cat animates cleanly
    this.reactUntil = 0;
    this.alertUntil = 0;
    this.behavior = 'sitting';
    this.personality.reset();
    this.idleAction = null;
    if (this.win && !this.win.isDestroyed()) this.win.setIgnoreMouseEvents(false);
  }

  // Released: the cat lives wherever it was dropped. Idempotent, because both the
  // renderer's mouseup and the global uiohook mouseup safety net call it.
  endDrag() {
    if (!this.dragging) return;
    this.dragging = false;
    const now = Date.now();
    this.home = { x: this.pos.x, y: this.pos.y };
    this.behavior = 'sitting';
    this.farSince = 0;
    this.lastNearActivityAt = now; // just settled — don't immediately doze
    this.personality.arm(now);
    this.idleAction = null;
    if (this.win && !this.win.isDestroyed()) {
      this.win.setIgnoreMouseEvents(true, { forward: true }); // back to click-through
    }
  }

  // Teleport the cat's resting spot (and the cat itself) to a point.
  setHome(x, y) {
    this.home = { x, y };
    this.pos = { x, y };
    this.behavior = 'sitting';
    this.farSince = 0;
  }

  // "Freeze here": pin the cat so it never gets up to walk. Enabling it also
  // stops any walk/drag in progress and makes the current spot its home.
  setFrozen(on) {
    this.frozen = !!on;
    if (this.frozen) {
      this.dragging = false;
      this.behavior = 'sitting';
      this.home = { x: this.pos.x, y: this.pos.y };
      this.farSince = 0;
    }
  }

  // ---- Core loop ---------------------------------------------------------

  #tick() {
    const now = Date.now();
    const cursor = screen.getCursorScreenPoint();

    // Being carried (picked up): skip the whole FSM and just follow the cursor.
    if (this.dragging) {
      this.lastTickAt = now;
      this.lastCursor = cursor;
      this.#drag(cursor);
      return;
    }

    this.#trackCursor(now, cursor);
    const dist = Math.hypot(cursor.x - this.pos.x, cursor.y - this.pos.y);

    const transient = now < this.transientUntil;

    // While a one-shot is playing the cat stays put and just shows it.
    if (transient) {
      this.farSince = 0;
    } else if (this.agentThinking) {
      // THINKING preempts movement: the cat freezes where it is and focuses
      // (no snap back home if it happened to be mid-walk).
      this.farSince = 0;
      this.personality.reset();
      this.idleAction = null;
    } else if (now < this.reactUntil || now < this.alertUntil) {
      // REACTING (typing) / ALERT (startled): perk up in place, wherever it is.
      this.farSince = 0;
      this.personality.reset();
      this.idleAction = null;
    } else {
      this.#updateBehavior(now, cursor, dist);
    }

    this.#applyPosition();
    this.#updateEyes(now, cursor, dist, transient);

    this.state = this.#resolveState(now, transient);
    this.#send(false);
  }

  // Track cursor movement, speed, and nearby activity. Startle on fast flybys.
  #trackCursor(now, cursor) {
    const dt = Math.max((now - this.lastTickAt) / 1000, 0.001);
    this.lastTickAt = now;

    const moved = cursor.x !== this.lastCursor.x || cursor.y !== this.lastCursor.y;
    if (moved) {
      const d = Math.hypot(cursor.x - this.lastCursor.x, cursor.y - this.lastCursor.y);
      // Smooth the speed a little so a single jittery sample doesn't startle.
      this.cursorSpeed = this.cursorSpeed * 0.5 + (d / dt) * 0.5;

      const near = Math.hypot(cursor.x - this.pos.x, cursor.y - this.pos.y);
      if (near <= NAP_NEAR_RADIUS) this.lastNearActivityAt = now;

      // A fast cursor zipping past nearby startles the cat (wide eyes), and
      // also wakes it if it was asleep.
      if (this.cursorSpeed > ALERT_SPEED && near <= ALERT_NEAR_RADIUS) {
        this.alertUntil = now + ALERT_MS;
        if (this.behavior === 'sleeping') this.#wake(now);
      } else if (this.behavior === 'sleeping' && near <= NAP_NEAR_RADIUS) {
        this.#wake(now); // gentle nearby movement also wakes it
      }
    } else {
      this.cursorSpeed *= 0.6; // decay toward rest when the cursor is still
    }
    this.lastCursor = cursor;
  }

  // The base finite-state machine: sitting <-> walking, sitting -> sleeping.
  #updateBehavior(now, cursor, dist) {
    switch (this.behavior) {
      case 'sleeping':
        // Waking is handled in #trackCursor / noteKeystroke; nothing to do while
        // genuinely asleep but stay put.
        this.#settleAtHome();
        break;

      case 'walking':
        this.#walk(now, cursor, dist);
        break;

      case 'sitting':
      default:
        this.#sit(now, cursor, dist);
        break;
    }
  }

  // SITTING: hold position, run idle actions, and watch for reasons to get up
  // (cursor wandered far) or doze off (no nearby activity for a while).
  #sit(now, cursor, dist) {
    this.#settleAtHome();

    // Doze off after a stretch of no nearby cursor/keyboard activity.
    if (now - this.lastNearActivityAt >= NAP_AFTER_MS) {
      this.behavior = 'sleeping';
      this.personality.reset();
      this.idleAction = null;
      return;
    }

    // Frozen ("Freeze here"): never get up to walk, but keep idle glances/grooms
    // (and it can still doze off above) so it doesn't look like a statue.
    if (this.frozen) {
      this.idleAction = this.personality.tick(now);
      return;
    }

    // Get up and walk only once the cursor has been far away for long enough.
    if (dist > BEHAVIOR.WALK_TRIGGER_DIST) {
      if (!this.farSince) this.farSince = now;
      else if (now - this.farSince >= BEHAVIOR.WALK_TRIGGER_MS) {
        this.#startWalking();
        return;
      }
    } else {
      this.farSince = 0;
    }

    // Otherwise just be a cat: maybe glance around / groom / yawn.
    this.idleAction = this.personality.tick(now);
  }

  #startWalking() {
    this.behavior = 'walking';
    this.farSince = 0;
    this.changeMindUntil = 0;
    this.walkStopDist = rand(BEHAVIOR.STOP_MIN, BEHAVIOR.STOP_MAX);
    this.personality.reset();
    this.idleAction = null;
  }

  // WALKING: ease toward a point a little short of the cursor, slowing down as
  // it arrives, occasionally pausing as if it changed its mind.
  #walk(now, cursor, dist) {
    // Arrived? Sit back down and make this the new home.
    if (dist <= this.walkStopDist) {
      this.#sitDownHere(now);
      return;
    }

    // Mid-walk "changed its mind" pause: sit still briefly, then carry on.
    if (now < this.changeMindUntil) {
      return;
    }
    if (Math.random() < BEHAVIOR.CHANGE_MIND_CHANCE) {
      this.changeMindUntil = now + rand(BEHAVIOR.CHANGE_MIND_MIN_MS, BEHAVIOR.CHANGE_MIND_MAX_MS);
      return;
    }

    // Aim for a point STOP_DIST short of the cursor along the line to it.
    const dx = cursor.x - this.pos.x;
    const dy = cursor.y - this.pos.y;
    const k = (dist - this.walkStopDist) / dist;
    const tx = this.pos.x + dx * k;
    const ty = this.pos.y + dy * k;

    // Decelerate over the last DECEL_DIST so it doesn't stop on a dime.
    const toTarget = Math.hypot(tx - this.pos.x, ty - this.pos.y);
    let scale = 1;
    if (toTarget < BEHAVIOR.DECEL_DIST) {
      scale = Math.max(BEHAVIOR.WALK_MIN_SPEED, toTarget / BEHAVIOR.DECEL_DIST);
    }
    const step = BEHAVIOR.WALK_EASE * scale;
    const nx = this.pos.x + (tx - this.pos.x) * step;
    const ny = this.pos.y + (ty - this.pos.y) * step;

    if (Math.abs(nx - this.pos.x) > 0.05) this.facing = nx > this.pos.x ? 'right' : 'left';
    this.pos.x = nx;
    this.pos.y = ny;

    // If we've essentially stopped making progress, count it as arrived.
    if (Math.hypot(nx - tx, ny - ty) < BEHAVIOR.ARRIVE_EPS) this.#sitDownHere(now);
  }

  #sitDownHere(now) {
    this.behavior = 'sitting';
    this.home = { x: this.pos.x, y: this.pos.y };
    this.farSince = 0;
    this.lastNearActivityAt = now; // just settled — don't immediately doze
    this.personality.arm(now);
    this.idleAction = null;
  }

  #wake(now) {
    this.behavior = 'sitting';
    this.lastNearActivityAt = now;
    this.personality.arm(now);
    this.idleAction = null;
    this.playOnce('stretch', 600); // a little wake-up stretch before sitting
  }

  // The cat isn't walking, so glue it to its home spot (no drift).
  #settleAtHome() {
    this.pos.x = this.home.x;
    this.pos.y = this.home.y;
  }

  // Being carried: glue the cat to the cursor, animate a little "walk" while the
  // hand is actually moving (a cat trotting through the air), idle when it stops.
  #drag(cursor) {
    const moving = Math.hypot(cursor.x - this.pos.x, cursor.y - this.pos.y) > 1;
    if (Math.abs(cursor.x - this.pos.x) > 0.5) {
      this.facing = cursor.x > this.pos.x ? 'right' : 'left';
    }
    this.pos.x = cursor.x;
    this.pos.y = cursor.y;
    this.#applyPosition(); // clamps to the work area + moves the window
    this.eye = { dir: this.facing === 'right' ? 'E' : 'W', mode: 'open' };
    this.state = moving ? 'walk' : 'idle';
    this.#send(false);
  }

  // Keep the cat on-screen and move the window to match its center.
  #applyPosition() {
    const half = WINDOW_SIZE / 2;
    const disp = screen.getDisplayNearestPoint({
      x: Math.round(this.pos.x),
      y: Math.round(this.pos.y),
    });
    const wa = disp.workArea;
    this.pos.x = Math.min(Math.max(this.pos.x, wa.x + half), wa.x + wa.width - half);
    this.pos.y = Math.min(Math.max(this.pos.y, wa.y + half), wa.y + wa.height - half);

    this.win.setPosition(Math.round(this.pos.x - half), Math.round(this.pos.y - half));
  }

  // ---- Eyes --------------------------------------------------------------

  // Recompute the glance direction + mode, throttled so the cat glances rather
  // than tracks the cursor frame-by-frame.
  #updateEyes(now, cursor, dist, transient) {
    if (now - this.lastEyeAt < EYE.UPDATE_MS) return;
    this.lastEyeAt = now;

    let mode = 'open';
    if (this.behavior === 'sleeping') mode = 'closed';
    else if (now < this.alertUntil) mode = 'wide';

    let dir = this.eye.dir;
    if (this.behavior === 'sleeping') {
      // closed — direction irrelevant, leave as-is
    } else if (this.agentThinking) {
      // Eyes dart around: the agent is busy doing stuff!
      if (now - this.thinkDartAt >= EYE.THINK_DART_MS) {
        this.thinkDartAt = now;
        this.thinkDir = DIRS8[Math.floor(Math.random() * DIRS8.length)];
      }
      dir = this.thinkDir;
    } else if (this.idleAction && this.idleAction.type === 'LOOK_LEFT') {
      dir = 'W';
    } else if (this.idleAction && this.idleAction.type === 'LOOK_RIGHT') {
      dir = 'E';
    } else if (now < this.reactUntil) {
      dir = 'S'; // perk up and look down at the keyboard
    } else if (!transient && dist < BEHAVIOR.CURSOR_OVER_DIST) {
      dir = 'N'; // cursor right on top of the cat -> look up (4th-wall moment)
    } else {
      dir = angleToDir(cursor.x - this.pos.x, cursor.y - this.pos.y);
    }

    this.eye = { dir, mode };
  }

  // ---- Animation state ---------------------------------------------------

  // Pick the animation strip by priority.
  #resolveState(now, transient) {
    if (transient) return this.transientState;
    if (this.agentThinking) return 'thinking';
    if (now < this.alertUntil) return 'react';
    if (now < this.reactUntil) return 'react';
    if (this.behavior === 'sleeping') return 'sleep';
    if (this.behavior === 'walking') {
      return now < this.changeMindUntil ? 'idle' : 'walk'; // pause looks like a sit
    }
    // Sitting: idle actions, then a tired droop during Pomodoro, then plain idle.
    if (this.idleAction) {
      if (this.idleAction.type === 'GROOM' || this.idleAction.type === 'YAWN') return 'stretch';
      // LOOK_LEFT / LOOK_RIGHT are eyes-only — body stays idle.
    }
    if (this.pomodoroTired) return 'tired';
    return 'idle';
  }

  // Push to the renderer only when something actually changed.
  #send(force) {
    const eyeDir = this.eye.dir;
    const eyeMode = this.eye.mode;
    if (
      !force &&
      this.sent.cat === this.cat &&
      this.sent.state === this.state &&
      this.sent.facing === this.facing &&
      this.sent.eyeDir === eyeDir &&
      this.sent.eyeMode === eyeMode
    ) {
      return;
    }
    this.sent = { cat: this.cat, state: this.state, facing: this.facing, eyeDir, eyeMode };
    if (!this.win.isDestroyed()) {
      this.win.webContents.send('meow:state', {
        cat: this.cat,
        state: this.state,
        facing: this.facing,
        eye: { dir: eyeDir, mode: eyeMode },
      });
    }
  }
}

module.exports = { Brain };
