// ---------------------------------------------------------------------------
// preload.js — the only bridge between the (sandboxed) renderer and the main
// process. With contextIsolation on, the renderer can't touch Node or Electron
// directly; it gets exactly the small, named API we expose here and nothing
// more.
// ---------------------------------------------------------------------------

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('meow', {
  // One-time handshake: returns { manifest, assetsUrl, cat }.
  init: () => ipcRenderer.invoke('meow:init'),

  // Subscribe to state pushes from the brain: { cat, state, facing }.
  onState: (cb) => {
    const handler = (_e, payload) => cb(payload);
    ipcRenderer.on('meow:state', handler);
    return () => ipcRenderer.removeListener('meow:state', handler);
  },

  // Tell main whether the pointer is over the cat (controls click-through).
  setIgnore: (ignore) => ipcRenderer.send('meow:set-ignore', ignore),

  // The user clicked the cat — let the brain react (a happy hop).
  poke: () => ipcRenderer.send('meow:poke'),

  // Right-click / two-finger click on the cat -> native context menu.
  contextMenu: () => ipcRenderer.send('meow:context-menu'),

  // Drag ("pick up the cat"): the brain pins it to the cursor between these.
  startDrag: () => ipcRenderer.send('meow:start-drag'),
  endDrag: () => ipcRenderer.send('meow:end-drag'),
});
