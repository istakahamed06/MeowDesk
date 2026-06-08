// ---------------------------------------------------------------------------
// overlayPreload.js — bridge for the answer-panel renderer. With
// contextIsolation on, overlay.js only ever sees this small named API.
// ---------------------------------------------------------------------------

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('meowOverlay', {
  // Receive the answer text to display: { text }.
  onContent: (cb) => {
    const handler = (_e, payload) => cb(payload);
    ipcRenderer.on('overlay:content', handler);
    return () => ipcRenderer.removeListener('overlay:content', handler);
  },
  // Main asks us to fade out (hotkey toggle / auto-close).
  onDismiss: (cb) => {
    const handler = () => cb();
    ipcRenderer.on('overlay:dismiss', handler);
    return () => ipcRenderer.removeListener('overlay:dismiss', handler);
  },
  // Tell main how tall the rendered content is, so it can size the window.
  requestResize: (height) => ipcRenderer.send('overlay:resize', height),
  // Done fading out — main can hide the window now.
  close: () => ipcRenderer.send('overlay:close'),
});
