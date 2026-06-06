// ---------------------------------------------------------------------------
// settings.js — tiny JSON persistence for user choices (cat color, stretch
// interval). Fully local: a single file in Electron's userData folder. No
// network, no telemetry. If the file is missing/corrupt we just fall back to
// defaults.
// ---------------------------------------------------------------------------

const fs = require('fs');
const path = require('path');
const { app } = require('electron');
const { DEFAULTS } = require('./config');

let cache = null;

function file() {
  return path.join(app.getPath('userData'), 'meowdesk-settings.json');
}

function load() {
  if (cache) return cache;
  try {
    cache = { ...DEFAULTS, ...JSON.parse(fs.readFileSync(file(), 'utf8')) };
  } catch {
    cache = { ...DEFAULTS };
  }
  return cache;
}

function get(key) {
  return load()[key];
}

function set(key, value) {
  load();
  cache[key] = value;
  try {
    fs.writeFileSync(file(), JSON.stringify(cache, null, 2));
  } catch {
    // Non-fatal: settings just won't persist across restarts.
  }
}

module.exports = { get, set };
