// ---------------------------------------------------------------------------
// brain.js — the cat's behaviour, all in the main process.
//
// Every TICK_MS it:
//   1. reads the cursor and eases the cat toward it (stopping a little short,
//      so the cat trails like a pet rather than sitting on the pointer),
//   2. decides which animation state best fits everything that's going on
//      (typing, AI agent activity, reminders, idleness…),
//   3. repositions the window and, when something changed, pushes the new
//      { cat, state, facing } to the renderer.
//
// Other subsystems (input, agentMonitor, reminders, tray) don't render anything
// themselves — they just flip flags / call triggers on the brain.
// ---------------------------------------------------------------------------

const { screen } = require('electron');
const { FOLLOW, SLEEP_AFTER_MS, TYPING, TICK_MS, WINDOW_SIZE } = require('./config');

class Brain {
  constructor(win, manifest) {
    this.win = win;
    this.manifest = manifest;

    // Position is the cat's center, in global screen coordinates.
    const b = win.getBounds();
    this.pos = { x: b.x + b.width / 2, y: b.y + b.height / 2 };
    this.facing = 'left';

    this.cat = manifest.cats.oreo ? 'oreo' : Object.keys(manifest.cats)[0];

    // Activity tracking.
    this.lastCursor = screen.getCursorScreenPoint();
    this.lastCursorMoveAt = Date.now();
    this.lastKeyAt = 0;
    this.reactUntil = 0; // react state holds until this time
    this.moving = false;

    // External condition flags (set by other modules).
    this.agentThinking = false;
    this.pomodoroTired = false;

    // One-shot ("transient") animations like happy / stretch take over briefly.
    this.transientState = null;
    this.transientUntil = 0;

    // Last payload sent to the renderer, to avoid spamming identical updates.
    this.sent = { cat: null, state: null, facing: null };

    this.timer = null;
  }

  start() {
    this.timer = setInterval(() => this.#tick(), TICK_MS);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
  }

  // ---- Inputs from other subsystems -------------------------------------

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
    if (keysPerSec >= TYPING.FAST_KEYS_PER_SEC) {
      this.reactUntil = now + TYPING.RELEASE_MS;
    }
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
    if (!anim) {
      const fb = state === 'happy' ? 'walk' : 'idle';
      this.transientState = fb;
    } else {
      this.transientState = state;
    }
    const dur = anim ? (anim.frames / anim.fps) * 1000 : 600;
    this.transientUntil = Date.now() + Math.max(dur, minMs);
  }

  poke() {
    this.playOnce('happy', 700); // clicking the cat = a happy hop
  }

  // ---- Core loop ---------------------------------------------------------

  #tick() {
    const now = Date.now();
    const cursor = screen.getCursorScreenPoint();

    // Detect cursor movement (resets the idle timer).
    if (cursor.x !== this.lastCursor.x || cursor.y !== this.lastCursor.y) {
      this.lastCursorMoveAt = now;
      this.lastCursor = cursor;
    }

    const transient = now < this.transientUntil;

    // Move toward the cursor unless a one-shot animation is playing (those
    // happen in place).
    if (!transient) {
      this.#follow(cursor);
    } else {
      this.moving = false;
    }

    this.#applyPosition();

    const state = this.#resolveState(now, transient);
    this.#setStateInternal(state);
    this.#send(false);
  }

  // Ease the cat toward a point a little short of the cursor.
  #follow(cursor) {
    const dx = cursor.x - this.pos.x;
    const dy = cursor.y - this.pos.y;
    const dist = Math.hypot(dx, dy);

    let tx = this.pos.x;
    let ty = this.pos.y;
    if (dist > FOLLOW.STOP_DISTANCE) {
      // Aim for a point STOP_DISTANCE away from the cursor along the line.
      const k = (dist - FOLLOW.STOP_DISTANCE) / dist;
      tx = this.pos.x + dx * k;
      ty = this.pos.y + dy * k;
    }

    const nx = this.pos.x + (tx - this.pos.x) * FOLLOW.EASE;
    const ny = this.pos.y + (ty - this.pos.y) * FOLLOW.EASE;

    const moved = Math.hypot(nx - this.pos.x, ny - this.pos.y);
    this.moving = moved > FOLLOW.MOVE_EPS;
    if (this.moving && Math.abs(nx - this.pos.x) > 0.05) {
      this.facing = nx > this.pos.x ? 'right' : 'left';
    }

    this.pos.x = nx;
    this.pos.y = ny;
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

  // Pick the animation state by priority.
  #resolveState(now, transient) {
    if (transient) return this.transientState;
    if (this.agentThinking) return 'thinking';
    if (now < this.reactUntil) return 'react';
    if (this.moving) return 'walk';
    const idleMs = now - Math.max(this.lastCursorMoveAt, this.lastKeyAt);
    if (idleMs > SLEEP_AFTER_MS) return 'sleep';
    if (this.pomodoroTired) return 'tired';
    return 'idle';
  }

  #setStateInternal(state) {
    this.state = state;
  }

  // Push to the renderer only when something actually changed.
  #send(force) {
    if (
      !force &&
      this.sent.cat === this.cat &&
      this.sent.state === this.state &&
      this.sent.facing === this.facing
    ) {
      return;
    }
    this.sent = { cat: this.cat, state: this.state, facing: this.facing };
    if (!this.win.isDestroyed()) {
      this.win.webContents.send('meow:state', this.sent);
    }
  }
}

module.exports = { Brain };
