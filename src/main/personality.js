// ---------------------------------------------------------------------------
// personality.js — the idle-action scheduler.
//
// A real cat sitting still isn't frozen: every so often it glances around,
// grooms, or has a little yawn/stretch. This module owns ONLY that "what
// random thing does the cat do next while it's just sitting there" decision.
//
// It deliberately knows nothing about cursors, walking, sleeping, typing or the
// AI agent — the brain drives all of that and simply asks this scheduler, each
// tick that the cat is calmly sitting, "anything going on right now?". The brain
// then maps the returned action onto an animation / eye direction.
//
// Actions it can pick (the conditional ones — nap, startle — live in the brain
// because they're triggered by the world, not by a dice roll):
//   LOOK_LEFT / LOOK_RIGHT  glance, eyes only, body stays in the idle pose
//   GROOM                   a grooming beat (reuses the stretch strip)
//   YAWN                    a yawn / stretch
// ---------------------------------------------------------------------------

const { IDLE } = require('./config');

const ACTIONS = ['LOOK_LEFT', 'LOOK_RIGHT', 'GROOM', 'YAWN'];

const DURATION_MS = {
  LOOK_LEFT: IDLE.LOOK_MS,
  LOOK_RIGHT: IDLE.LOOK_MS,
  GROOM: IDLE.GROOM_MS,
  YAWN: IDLE.YAWN_MS,
};

function randBetween(min, max) {
  return min + Math.random() * (max - min);
}

class Personality {
  constructor() {
    // When the next random action should fire (ms epoch). 0 = "not armed yet".
    this.nextAt = 0;
    // The action currently playing, or null. { type, until }.
    this.action = null;
  }

  // Called whenever the cat (re)enters the calm sitting state, so the first
  // idle action doesn't fire the instant it sits down and the timer is fresh.
  arm(now) {
    this.action = null;
    this.nextAt = now + randBetween(IDLE.MIN_MS, IDLE.MAX_MS);
  }

  // Called when the cat leaves sitting (walks off, dozes off, reacts…): drop any
  // in-flight action and disarm. arm() will restart the clock on return.
  reset() {
    this.action = null;
    this.nextAt = 0;
  }

  // Ask "what idle action, if any, is the cat doing right now?" Returns the
  // action object ({ type, until }) or null. Safe to call every tick.
  tick(now) {
    if (!this.nextAt) this.arm(now);

    // An action is in progress — let it finish, then schedule the next one.
    if (this.action) {
      if (now < this.action.until) return this.action;
      this.action = null;
      this.nextAt = now + randBetween(IDLE.MIN_MS, IDLE.MAX_MS);
      return null;
    }

    // Time for a new one?
    if (now >= this.nextAt) {
      const type = ACTIONS[Math.floor(Math.random() * ACTIONS.length)];
      this.action = { type, until: now + DURATION_MS[type] };
      return this.action;
    }

    return null;
  }
}

module.exports = { Personality };
