// ---------------------------------------------------------------------------
// renderer.js — wires the sprite engine to the window and the main process.
//
// Responsibilities:
//   * boot the CatRenderer from the manifest handed over by main
//   * run the animation loop (requestAnimationFrame)
//   * apply state pushes from the brain
//   * detect when the pointer is over the actual cat pixels and tell main to
//     stop ignoring mouse events there (so the cat is clickable but the rest of
//     the window stays click-through)
// ---------------------------------------------------------------------------

/* global CatRenderer, meow */

(async function boot() {
  const canvas = document.getElementById('cat');

  const { manifest, assetsUrl, cat } = await meow.init();
  const renderer = new CatRenderer(canvas, manifest, assetsUrl);
  await renderer.load();
  renderer.setState({ cat, state: 'idle', facing: 'right' });

  // Receive state updates from the brain.
  meow.onState((payload) => renderer.setState(payload));

  // --- Animation loop -----------------------------------------------------
  function frame(now) {
    renderer.tick(now);
    renderer.draw();
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  // --- Click-through, poke, drag, and context menu -----------------------
  // While the window ignores mouse events (forward:true) we still receive
  // mousemove here. If the pointer is over an opaque cat pixel we ask main to
  // make the window interactive; otherwise we keep it click-through.
  let overCat = false;

  // Drag ("pick up the cat"). A left-press over the cat ARMS a potential drag;
  // once the cursor travels past a small threshold it becomes a real drag and
  // the brain carries the cat with the cursor. A press that never moves is a
  // plain click -> poke. macOS three-finger drag arrives as these same events.
  const DRAG_THRESHOLD = 4; // px of cursor travel before a press becomes a drag
  let press = null; // { x, y } screen coords where the left button went down
  let dragging = false;

  document.addEventListener('mousemove', (e) => {
    // Armed press that's travelled far enough -> begin dragging.
    if (press && !dragging && Math.hypot(e.screenX - press.x, e.screenY - press.y) > DRAG_THRESHOLD) {
      dragging = true;
      meow.startDrag();
    }
    if (dragging) return; // the brain owns interactivity while carrying

    const hit = renderer.hitTest(e.clientX, e.clientY);
    if (hit !== overCat) {
      overCat = hit;
      meow.setIgnore(!hit); // hit -> don't ignore (catch the click)
    }
  });

  // Left-press on the cat arms a potential drag; the poke fires on release only
  // if it never became a drag. A stray press while still "dragging" force-ends
  // it, so a drag can never get stuck to the cursor.
  document.addEventListener('mousedown', (e) => {
    if (dragging) {
      meow.endDrag();
      dragging = false;
      press = null;
      return;
    }
    if (e.button !== 0) return; // left button only; right-click -> contextmenu
    if (!renderer.hitTest(e.clientX, e.clientY)) return;
    press = { x: e.screenX, y: e.screenY };
  });

  document.addEventListener('mouseup', () => {
    if (!press) return;
    if (dragging) {
      meow.endDrag();
      overCat = false; // re-assert hover on the next move so the cat stays clickable
    } else {
      meow.poke(); // a click, not a drag -> happy hop
    }
    press = null;
    dragging = false;
  });

  // Right-click / two-finger click on the cat opens the native context menu.
  document.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    if (renderer.hitTest(e.clientX, e.clientY)) meow.contextMenu();
  });

  // If the pointer leaves the window entirely, go back to click-through. During
  // a drag the brain keeps the window under the cursor so this won't fire; the
  // global mouseup net in input.js covers a hard fling off-window.
  document.addEventListener('mouseleave', () => {
    if (dragging) return;
    if (overCat) {
      overCat = false;
      meow.setIgnore(true);
    }
  });
})();
