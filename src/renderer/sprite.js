// ---------------------------------------------------------------------------
// sprite.js — the little sprite engine that runs in the renderer.
//
// It knows nothing about cursors, typing, or timers. Its whole job is: given a
// manifest, preload the strip images, and on each frame draw the right frame of
// the right animation for the current { cat, state, facing }. The "brain" in
// the main process decides WHAT to show; this just shows it.
//
// v2 adds an EYE LAYER: a second, transparent canvas stacked over the cat. The
// cat sprites have their eyes baked in looking straight ahead; to make the cat
// glance toward the cursor we (a) scan each frame at load time to find the
// pupil pixels and the fur colour around them, then (b) on the overlay paint
// over the baked pupils with fur and redraw them shifted 1–2px in the glance
// direction the brain asked for (or closed when asleep, wider when startled).
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

// Pupil shift per glance direction, in sprite pixels and SCREEN space (the
// renderer flips X when the cat faces its non-native way). Cardinals nudge 2px,
// diagonals ~1px each axis so every glance stays a subtle 1–2px movement.
const EYE_OFFSETS = {
  E: [2, 0],
  W: [-2, 0],
  N: [0, -2],
  S: [0, 2],
  NE: [1, -1],
  SE: [1, 1],
  NW: [-1, -1],
  SW: [-1, 1],
};

// Detect an "eye" pixel: the Oreo cat's eyes are warm golden (bright pupil core
// plus a dimmer amber iris ring) sitting in dark fur.
function isEyePixel(r, g, b, a) {
  return a > 40 && r > 120 && g > 70 && b < 110 && r > b + 40 && g > b;
}

function median(values) {
  if (!values.length) return 0;
  const s = values.slice().sort((a, b) => a - b);
  return s[s.length >> 1];
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
    this.eyeData = {}; // cat -> state -> [perFrame { pupils, cover } | null]

    // Current playback state.
    this.cat = manifest.cats.oreo ? 'oreo' : Object.keys(manifest.cats)[0];
    this.state = 'idle';
    this.facing = 'right';
    this.eyeState = { dir: 'S', mode: 'open' };
    this.frame = 0;
    this.lastAdvance = 0;
    this.size = require_window_size(); // logical window size (=128)
    this.scale = this.size / this.frameSize; // sprite px -> logical px (=2)

    // A second canvas, stacked exactly over the cat, just for the eyes.
    this.eyeCanvas = this.#createEyeCanvas();
    this.eyeCtx = this.eyeCanvas.getContext('2d');

    this.#setupCanvas();
  }

  // Build the transparent overlay canvas in JS so no HTML/CSS changes are
  // needed. It sits on top of #cat, pixel-aligned, and never eats pointer
  // events (the window's click-through / hit-testing all use the cat canvas).
  #createEyeCanvas() {
    const c = document.createElement('canvas');
    c.id = 'eyes';
    c.style.position = 'absolute';
    c.style.left = '0';
    c.style.top = '0';
    c.style.width = '100%';
    c.style.height = '100%';
    c.style.pointerEvents = 'none';
    c.style.imageRendering = 'pixelated';
    this.canvas.parentNode.appendChild(c);
    return c;
  }

  // Size both canvases' backing stores for the display's pixel density so the
  // upscaled pixel art stays sharp.
  #setupCanvas() {
    for (const cv of [this.canvas, this.eyeCanvas]) {
      cv.width = this.size * this.dpr;
      cv.height = this.size * this.dpr;
    }
    this.ctx.imageSmoothingEnabled = false;
    this.eyeCtx.imageSmoothingEnabled = false;
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
    this.#buildEyeData();
  }

  // ---- Eye-pixel analysis (runs once, after images load) -----------------

  // For every cat/state/frame, find the pupil pixels and a representative fur
  // colour around them. Cats with no detectable eyes (e.g. the palette PACK
  // cats, or the eyes-closed sleep strip) simply get no overlay and show their
  // baked-in eyes — a graceful fallback.
  #buildEyeData() {
    const fs = this.frameSize;
    const tmp = document.createElement('canvas');
    tmp.width = fs;
    tmp.height = fs;
    const tctx = tmp.getContext('2d', { willReadFrequently: true });

    for (const [catKey, cat] of Object.entries(this.manifest.cats)) {
      const perState = {};
      let anyEyes = false;
      for (const [stateKey, st] of Object.entries(cat.states)) {
        const img = this.images[st.file];
        if (!img) continue;
        const frames = [];
        for (let f = 0; f < st.frames; f++) {
          const data = this.#scanFrame(tctx, img, f);
          frames.push(data);
          if (data) anyEyes = true;
        }
        perState[stateKey] = frames;
      }
      if (anyEyes) this.eyeData[catKey] = perState;
    }
  }

  // Scan one frame for pupils; return { pupils:[{x,y,r,g,b}], cover:{r,g,b} } or
  // null if it doesn't look like a pair of eyes.
  #scanFrame(tctx, img, frameIndex) {
    const fs = this.frameSize;
    tctx.clearRect(0, 0, fs, fs);
    tctx.drawImage(img, frameIndex * fs, 0, fs, fs, 0, 0, fs, fs);
    const data = tctx.getImageData(0, 0, fs, fs).data;
    const at = (x, y) => (y * fs + x) * 4;

    const pupils = [];
    const goldSet = new Set();
    for (let y = 0; y < fs; y++) {
      for (let x = 0; x < fs; x++) {
        const i = at(x, y);
        const r = data[i],
          g = data[i + 1],
          b = data[i + 2],
          a = data[i + 3];
        if (isEyePixel(r, g, b, a)) {
          pupils.push({ x, y, r, g, b });
          goldSet.add(y * fs + x);
        }
      }
    }
    // Too few = no eyes; too many = some other golden thing, not a pair of eyes.
    if (pupils.length < 2 || pupils.length > 40) return null;

    // Fur cover = median colour of the opaque, non-eye pixels ringing the eyes.
    const rs = [],
      gs = [],
      bs = [];
    for (const p of pupils) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const x = p.x + dx,
            y = p.y + dy;
          if (x < 0 || y < 0 || x >= fs || y >= fs) continue;
          if (goldSet.has(y * fs + x)) continue;
          const i = at(x, y);
          if (data[i + 3] <= 40) continue;
          rs.push(data[i]);
          gs.push(data[i + 1]);
          bs.push(data[i + 2]);
        }
      }
    }
    const cover = rs.length
      ? { r: median(rs), g: median(gs), b: median(bs) }
      : { r: 40, g: 36, b: 48 }; // dark fur fallback
    return { pupils, cover };
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

  setState({ cat, state, facing, eye }) {
    if (cat && cat !== this.cat) this.cat = cat;
    if (facing) this.facing = facing;
    if (eye) this.eyeState = eye;
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
    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    // Always clear the eye layer too, so stale eyes never linger.
    this.eyeCtx.setTransform(1, 0, 0, 1, 0, 0);
    this.eyeCtx.clearRect(0, 0, this.eyeCanvas.width, this.eyeCanvas.height);

    const anim = this.#currentAnim();
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

    this.#drawEyes(flip);
  }

  // Paint the glancing eyes on the overlay (the cat canvas is already drawn).
  #drawEyes(flip) {
    const states = this.eyeData[this.cat];
    if (!states) return;
    const frames = states[this.state];
    if (!frames) return;
    const fdata = frames[this.frame];
    if (!fdata) return; // e.g. the closed-eye sleep frames — let them be

    const ectx = this.eyeCtx;
    const s = this.scale;
    const mode = (this.eyeState && this.eyeState.mode) || 'open';
    const dir = (this.eyeState && this.eyeState.dir) || 'S';

    let [ox, oy] = EYE_OFFSETS[dir] || [0, 0];
    if (flip) ox = -ox; // screen-space X flips with the sprite

    ectx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    if (flip) {
      ectx.translate(this.size, 0);
      ectx.scale(-1, 1);
    }

    // 1) Cover the baked-in pupils with the surrounding fur colour.
    const cov = fdata.cover;
    ectx.fillStyle = `rgb(${cov.r},${cov.g},${cov.b})`;
    for (const p of fdata.pupils) ectx.fillRect(p.x * s, p.y * s, s, s);

    // 2a) Asleep / blinking: leave the fur-covered eyes and lay a thin lid line.
    if (mode === 'closed') {
      let minX = Infinity,
        maxX = -Infinity,
        sumY = 0;
      for (const p of fdata.pupils) {
        minX = Math.min(minX, p.x);
        maxX = Math.max(maxX, p.x);
        sumY += p.y;
      }
      const lidY = Math.round(sumY / fdata.pupils.length);
      ectx.fillStyle = `rgb(${Math.max(0, cov.r - 25)},${Math.max(0, cov.g - 25)},${Math.max(0, cov.b - 25)})`;
      ectx.fillRect(minX * s, lidY * s, (maxX - minX + 1) * s, s);
      return;
    }

    // 2b) Redraw the pupils, shifted toward the cursor (wider when startled).
    for (const p of fdata.pupils) {
      ectx.fillStyle = `rgb(${p.r},${p.g},${p.b})`;
      const x = (p.x + ox) * s;
      const y = (p.y + oy) * s;
      ectx.fillRect(x, y, s, s);
      if (mode === 'wide' && p.r > 170) {
        ectx.fillRect(x, y - s, s, s); // pop the bright core a pixel taller
      }
    }
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
