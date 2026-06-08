// ---------------------------------------------------------------------------
// configPreload.js — bridge for the AI settings window.
// ---------------------------------------------------------------------------

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('meowConfig', {
  // Load the saved config to pre-fill the form: { endpoint, apiKey, model, format }.
  getConfig: () => ipcRenderer.invoke('ai:get-config'),
  // Persist the form: { endpoint, apiKey, model, format } -> { ok } | { ok:false, error }.
  saveConfig: (cfg) => ipcRenderer.invoke('ai:save-config', cfg),
  // Test the (unsaved) form values -> { ok, text } | { ok:false, error }.
  verifyConfig: (cfg) => ipcRenderer.invoke('ai:verify-config', cfg),
});
