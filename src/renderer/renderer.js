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

  // --- Click-through toggling --------------------------------------------
  // While the window ignores mouse events (forward:true) we still receive
  // mousemove here. If the pointer is over an opaque cat pixel we ask main to
  // make the window interactive; otherwise we keep it click-through.
  let overCat = false;
  document.addEventListener('mousemove', (e) => {
    const hit = renderer.hitTest(e.clientX, e.clientY);
    if (hit !== overCat) {
      overCat = hit;
      meow.setIgnore(!hit); // hit -> don't ignore (catch the click)
    }
  });

  // Clicking the cat pokes it (main responds with a happy hop).
  document.addEventListener('mousedown', (e) => {
    if (renderer.hitTest(e.clientX, e.clientY)) meow.poke();
  });

  // If the pointer leaves the window entirely, go back to click-through.
  document.addEventListener('mouseleave', () => {
    if (overCat) {
      overCat = false;
      meow.setIgnore(true);
    }
  });
})();
