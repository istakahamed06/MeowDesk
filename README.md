# 🐱 MeowDesk

A tiny desktop pet cat for **macOS (Apple Silicon)**. MeowDesk lives in your
menu bar, floats on top of everything, follows your cursor around the screen,
reacts when you type, naps when you're idle, and gets focused/excited based on
what your AI coding agent is doing. It also nudges you to stretch and runs a
Pomodoro timer.

100% offline. No telemetry, no network calls. Everything happens locally.

---

## Quick start

```bash
npm install          # install Electron + uiohook-napi
npm run build:assets # slice the sprite sheets into the runtime atlas (needs python3 + Pillow)
npm start            # launch MeowDesk
```

A cat appears in the bottom-right corner and a 🐱 icon appears in your menu bar.
There is **no dock icon** — use the menu-bar icon to control and quit the app.

> `npm run build:assets` only needs to be run once (the generated atlas is
> already committed under `assets/generated/`). Re-run it if you change
> `tools/build_atlas.py` or the source art.

---

## macOS permissions (important)

MeowDesk uses two OS capabilities:

| Feature | Permission needed | If denied |
| --- | --- | --- |
| **Cursor following** (and everything visual) | none | always works |
| **Typing detection** (excited "react") | **Accessibility** | cat just won't react to typing; nothing else breaks |

To enable typing detection:

1. Run `npm start` once. macOS will (eventually) prompt, or you can do it manually.
2. Open **System Settings → Privacy & Security → Accessibility**.
3. Enable the app you launched MeowDesk with — when running via `npm start`
   that's **Electron** (you may need to add it with the `+` button; point it at
   `node_modules/electron/dist/Electron.app`). If you package the app later,
   you'll grant permission to **MeowDesk** instead.
4. Quit and relaunch MeowDesk.

You'll see `[input] global keyboard hook started` in the console once it works.
Until then you'll see `Accessibility API is disabled!` — that's expected and
harmless.

---

## Using the cat

- **It follows your cursor.** It eases toward the pointer and stops a little
  short, like a real pet trailing you. Moving → walk; stopped → idle.
- **Idle for 30s** → it curls up and sleeps. Move the mouse to wake it.
- **Type fast (>3 keys/sec)** → it gets excited (hearts!). It settles back ~2s
  after you stop.
- **Click the cat** → it does a happy hop.
- **AI agent activity**: when a process matching `claude` or `antigravity` is
  using >10% CPU, the cat shows its focused "thinking" face. When that activity
  dies down (task finished) it does a happy hop.

### Menu-bar menu

- **Cat Color** — Ginger / White / Black / Oreo (your choice is remembered)
- **Stretch Reminder** — Off / 20 / 30 / 45 min → wakes the cat, stretches, and
  pops a "Time to stretch! 🐱" notification
- **Pomodoro** — Start 25 min / Stop. The cat looks progressively more tired as
  the session runs; at the end you get a "Take a break! 🐾" notification.
- **Quit MeowDesk**

---

## How it works (architecture)

The code is deliberately split into a clean **main process** ("the brain" +
OS-facing services) and a dumb **renderer** ("the view"). The renderer never
decides behaviour — it just draws whatever state the brain tells it to.

```
tools/build_atlas.py      One-time asset pipeline. Reads the two messy source
                          sprite sheets and emits clean, normalized 64×64
                          animation strips + a manifest.json the app trusts.

src/main/
  main.js                 Entry point. Boots Electron, wires everything together.
  config.js               All the tunable numbers (speeds, thresholds, timings).
  settings.js             Tiny local JSON persistence (chosen color, interval).
  window.js               The transparent, frameless, click-through cat window.
  brain.js                The state machine: cursor following + which animation
                          to show, by priority. Talks to the renderer.
  input.js                Global keyboard hook (uiohook-napi) → typing rate.
  agentMonitor.js         Polls `ps` for AI-agent CPU → thinking / happy.
  reminders.js            Stretch reminder + Pomodoro + native notifications.
  tray.js                 The menu-bar icon and menu.

src/preload/preload.js    The only bridge to the renderer (contextIsolation on).

src/renderer/
  index.html              Just a <canvas>.
  sprite.js               The sprite engine: loads strips, plays frames, flips.
  renderer.js             Runs the animation loop; handles hover/click-through.
```

### The asset pipeline

The two source sheets are awkward:

- **Oreo Cat** (`Sprite Sheet Cat - Aichan_owo.png`) packs one animation per
  row, but rows have irregular heights and frames are separated by transparent
  gaps rather than a fixed grid.
- **PACK cats** (`cat 1/2/3.png`, = black/ginger/white) are a clean 14×72 grid
  of 64×64 cells, frames left-packed per row.

`build_atlas.py` auto-detects frame boundaries, then **normalizes** every frame
onto a 64×64 canvas: each cat is scaled so a walking cat is the same on-screen
size, all frames share one ground baseline, and mid-jump frames stay raised so
vertical motion survives. The result is `assets/generated/` — predictable strips
the renderer can play without any runtime guesswork.

### State priority

The brain picks one state per tick, highest priority first:

```
happy / stretch (one-shot)  >  thinking (agent busy)  >  react (typing)
  >  walk (moving)  >  sleep (idle 30s)  >  tired (Pomodoro)  >  idle
```

### Cursor following & click-through

The window is always click-through (`setIgnoreMouseEvents(true, {forward:true})`)
so it never blocks the apps underneath. The renderer watches `mousemove`,
pixel-tests the canvas, and only when the pointer is over an actual cat pixel
does it ask the main process to make the window catch the click. Because the cat
deliberately keeps its distance from the cursor, this rarely gets in your way.

---

## Tweaking

Almost everything you'd want to adjust lives in `src/main/config.js`:
follow speed/stop-distance, sleep delay, typing threshold, agent CPU threshold,
Pomodoro length, and so on. Change a number, restart, done.

To change which source animation maps to which state, edit `OREO_MAP` /
`PACK_ROW` in `tools/build_atlas.py` and re-run `npm run build:assets`.

---

## Credits

- **Oreo Cat** sprite sheet by *Aichan_owo* (see
  `assets/Oreo/.../Aichan's Asset License.txt`).
- **PACK** cat sprites (ginger / white / black variants).

Built with [Electron](https://electronjs.org) and
[uiohook-napi](https://github.com/SnosMe/uiohook-napi).
