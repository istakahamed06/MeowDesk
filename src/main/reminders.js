// ---------------------------------------------------------------------------
// reminders.js — stretch reminders and the Pomodoro timer.
//
// Both nudge the cat (via the brain) and pop a native macOS notification.
// Notifications are Electron's built-in ones, so everything stays offline.
// ---------------------------------------------------------------------------

const { Notification } = require('electron');
const { POMODORO_WORK_MIN } = require('./config');

function notify(title, body) {
  if (!Notification.isSupported()) return;
  new Notification({ title, body, silent: false }).show();
}

class Reminders {
  constructor(brain) {
    this.brain = brain;

    this.stretchIntervalMin = 0;
    this.stretchTimer = null;

    this.pomodoroActive = false;
    this.pomodoroStart = 0;
    this.pomodoroTimer = null;
  }

  // ---- Stretch reminder --------------------------------------------------

  setStretchInterval(min) {
    this.stretchIntervalMin = min;
    if (this.stretchTimer) {
      clearInterval(this.stretchTimer);
      this.stretchTimer = null;
    }
    if (min > 0) {
      this.stretchTimer = setInterval(() => this.#fireStretch(), min * 60 * 1000);
    }
  }

  #fireStretch() {
    // Wake the cat up and let it stretch, then remind the human to as well.
    this.brain.playOnce('stretch', 900);
    notify('Time to stretch! 🐱', 'Stand up, roll your shoulders, look away from the screen.');
  }

  // ---- Pomodoro ----------------------------------------------------------

  startPomodoro() {
    this.stopPomodoro();
    this.pomodoroActive = true;
    this.pomodoroStart = Date.now();
    notify('Pomodoro started 🍅', `Focus for ${POMODORO_WORK_MIN} minutes. You've got this!`);

    const totalMs = POMODORO_WORK_MIN * 60 * 1000;
    // Check progress a few times a minute so the cat can tire out gradually.
    this.pomodoroTimer = setInterval(() => {
      const frac = (Date.now() - this.pomodoroStart) / totalMs;
      // Past the halfway point the cat starts looking tired.
      this.brain.setPomodoroTired(frac >= 0.5);
      if (frac >= 1) this.#finishPomodoro();
    }, 15 * 1000);
  }

  #finishPomodoro() {
    this.stopPomodoro();
    this.brain.playOnce('stretch', 900);
    notify('Take a break! MeowDesk earned it 🐾', `${POMODORO_WORK_MIN} minutes done. Rest your eyes.`);
  }

  stopPomodoro() {
    this.pomodoroActive = false;
    this.brain.setPomodoroTired(false);
    if (this.pomodoroTimer) {
      clearInterval(this.pomodoroTimer);
      this.pomodoroTimer = null;
    }
  }

  isPomodoroActive() {
    return this.pomodoroActive;
  }

  getStretchInterval() {
    return this.stretchIntervalMin;
  }

  stopAll() {
    if (this.stretchTimer) clearInterval(this.stretchTimer);
    if (this.pomodoroTimer) clearInterval(this.pomodoroTimer);
  }
}

module.exports = { Reminders };
