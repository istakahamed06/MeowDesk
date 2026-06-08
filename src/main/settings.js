// ---------------------------------------------------------------------------
// settings.js — tiny JSON persistence for user choices (cat color, stretch
// interval). Fully local: a single file in Electron's userData folder. No
// network, no telemetry. If the file is missing/corrupt we just fall back to
// defaults.
// ---------------------------------------------------------------------------

const fs = require('fs');
const path = require('path');
const { app, safeStorage } = require('electron');
const { DEFAULTS } = require('./config');

const ENC_PREFIX = 'enc:'; // marks a value encrypted with the OS keychain

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

// Store a sensitive string (the API key) encrypted with Electron's safeStorage
// when the OS keychain is available, so it isn't sitting in plaintext in the
// settings JSON. Falls back to plaintext if encryption isn't available.
function setSecret(key, value) {
  let stored = value || '';
  try {
    if (value && safeStorage && safeStorage.isEncryptionAvailable()) {
      stored = ENC_PREFIX + safeStorage.encryptString(value).toString('base64');
    }
  } catch {
    stored = value || ''; // fall back to plaintext on any keychain hiccup
  }
  set(key, stored);
}

function getSecret(key) {
  const raw = get(key);
  if (typeof raw === 'string' && raw.startsWith(ENC_PREFIX)) {
    try {
      return safeStorage.decryptString(Buffer.from(raw.slice(ENC_PREFIX.length), 'base64'));
    } catch {
      return ''; // unreadable (e.g. different machine/keychain) -> treat as unset
    }
  }
  return raw || '';
}

module.exports = { get, set, getSecret, setSecret };
