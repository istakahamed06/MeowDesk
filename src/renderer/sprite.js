// ---------------------------------------------------------------------------
// sprite.js — the little sprite engine that runs in the renderer.
//
// It knows nothing about cursors, typing, or timers. Its whole job is: given a
// manifest, preload the strip images, and on each frame draw the right frame of
// the right animation for the current { cat, state, facing }. The "brain" in
// the main process decides WHAT to show; this just shows it.
// ---------------------------------------------------------------------------

/* global Image */

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('failed to load ' + url));
    img.src = url;
  });
}

class CatRenderer {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {object} manifest  parsed manifest.json
   * @param {string} assetsUrl file:// URL of assets/generated (no trailing slash)
   */
  constructor(canvas, manifest, assetsUrl) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { willReadFrequently: true });
    this.manifest = manifest;
    this.assetsUrl = assetsUrl;
    this.frameSize = manifest.frameSize;
    this.dpr = window.devicePixelRatio || 1;

    this.images = {}; // file path -> HTMLImageElement

    // Current playback state.
    this.cat = manifest.cats.oreo ? 'oreo' : Object.keys(manifest.cats)[0];
    this.state = 'idle';
    this.facing = 'right';
    this.frame = 0;
    this.lastAdvance = 0;
    this.size = require_window_size(); // logical window size (=128)

    this.#setupCanvas();
  }

  // Size the canvas backing store for the display's pixel density so the
  // upscaled pixel art stays sharp.
  #setupCanvas() {
    this.canvas.width = this.size * this.dpr;
    this.canvas.height = this.size * this.dpr;
    this.ctx.imageSmoothingEnabled = false;
  }

  async load() {
    const jobs = [];
    for (const cat of Object.values(this.manifest.cats)) {
      for (const st of Object.values(cat.states)) {
        const url = this.assetsUrl + '/' + st.file;
        jobs.push(loadImage(url).then((img) => (this.images[st.file] = img)));
      }
    }
    await Promise.all(jobs);
  }

  // Resolve a requested state to one this cat actually has, with sensible
  // fallbacks (the PACK cats only define a few states).
  #resolveState(cat, state) {
    const states = this.manifest.cats[cat].states;
    if (states[state]) return state;
    const fallback = {
      thinking: 'idle',
      happy: 'walk',
      stretch: 'idle',
      tired: 'sleep',
      react: 'idle',
      walk: 'idle',
      sleep: 'idle',
    };
    let s = state;
    const seen = new Set();
    while (s && !states[s] && !seen.has(s)) {
      seen.add(s);
      s = fallback[s];
    }
    return states[s] ? s : 'idle';
  }

  setState({ cat, state, facing }) {
    if (cat && cat !== this.cat) this.cat = cat;
    if (facing) this.facing = facing;
    const resolved = this.#resolveState(this.cat, state);
    if (resolved !== this.state) {
      this.state = resolved;
      this.frame = 0; // restart the animation from frame 0
      this.lastAdvance = 0;
    }
  }

  #currentAnim() {
    return this.manifest.cats[this.cat].states[this.state];
  }

  // Advance the frame counter according to the animation's fps.
  tick(now) {
    const anim = this.#currentAnim();
    if (!anim) return;
    if (!this.lastAdvance) this.lastAdvance = now;
    const interval = 1000 / anim.fps;
    while (now - this.lastAdvance >= interval) {
      this.lastAdvance += interval;
      if (anim.loop) {
        this.frame = (this.frame + 1) % anim.frames;
      } else if (this.frame < anim.frames - 1) {
        this.frame++; // one-shot animations hold on the last frame
      }
    }
  }

  draw() {
    const anim = this.#currentAnim();
    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    if (!anim) return;

    const img = this.images[anim.file];
    if (!img) return;

    const fs = this.frameSize;
    const sx = this.frame * fs;
    const d = this.size; // draw the frame to fill the logical window

    const nativeFacing = this.manifest.cats[this.cat].nativeFacing || 'right';
    const flip = this.facing !== nativeFacing;

    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    if (flip) {
      ctx.translate(d, 0);
      ctx.scale(-1, 1);
    }
    ctx.drawImage(img, sx, 0, fs, fs, 0, 0, d, d);
  }

  // Is there an opaque cat pixel under this logical (CSS) point? Used by the
  // renderer to decide whether the window should swallow clicks here.
  hitTest(cssX, cssY) {
    const px = Math.floor(cssX * this.dpr);
    const py = Math.floor(cssY * this.dpr);
    if (px < 0 || py < 0 || px >= this.canvas.width || py >= this.canvas.height) {
      return false;
    }
    try {
      return this.ctx.getImageData(px, py, 1, 1).data[3] > 16;
    } catch {
      return false;
    }
  }
}

// The window is square and its logical size matches the CSS size of the body.
function require_window_size() {
  return Math.round(document.body.clientWidth || 128);
}

window.CatRenderer = CatRenderer;
