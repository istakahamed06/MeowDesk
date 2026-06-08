// ---------------------------------------------------------------------------
// aiAssistant.js — "Ask MeowDesk": grab the screen, ask an AI about it.
//
// Flow when the global hotkey fires (see hotkey.js / main.js):
//   1. the cat immediately plays its "thinking" animation (instant feedback),
//   2. we capture the screen the cursor is on,
//   3. we POST it + a prompt to the user's configured endpoint,
//   4. the answer goes into the floating overlay panel; the cat hops happily,
//   5. anything goes wrong -> a native notification + the cat's "react" pose.
//
// Everything is opt-in and local-to-the-user's-account: nothing here runs
// unless the user has enabled the feature and entered their own endpoint + key.
//
// Provider support is configurable so it works with the Anthropic Messages API
// (default) or any OpenAI-compatible chat/completions endpoint — the request
// body, headers, AND response shape differ between the two, so we handle both.
// ---------------------------------------------------------------------------

const {
  desktopCapturer,
  screen,
  systemPreferences,
  shell,
  Notification,
} = require('electron');
const { AI } = require('./config');
const settings = require('./settings');

// The instruction sent alongside the screenshot.
const USER_PROMPT =
  'You are a helpful assistant. Look at this screenshot and answer any question ' +
  'or help with any task visible on screen. Be concise and direct. If there is a ' +
  'question visible, answer it. If there is code, explain or fix it. If there is ' +
  'text, summarize or help with it.';

function notify(title, body) {
  try {
    if (Notification.isSupported()) new Notification({ title, body, silent: false }).show();
  } catch {
    /* notifications are best-effort */
  }
}

function truncate(s, n) {
  s = String(s || '');
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

// ---- Screen capture --------------------------------------------------------

async function captureScreen() {
  // macOS gates screen capture behind a Screen Recording permission that can't
  // be requested programmatically. Detect it and guide the user.
  if (process.platform === 'darwin') {
    const status = systemPreferences.getMediaAccessStatus('screen');
    if (status !== 'granted') {
      // Touch desktopCapturer once so macOS surfaces its prompt the first time.
      try {
        await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 1, height: 1 } });
      } catch {
        /* ignore — we only wanted to trigger the OS prompt */
      }
      shell
        .openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture')
        .catch(() => {});
      throw new Error(
        'Screen Recording permission needed — enable MeowDesk under System Settings → ' +
          'Privacy & Security → Screen Recording, then try again.'
      );
    }
  }

  // Capture the display the cursor is on, scaled so its long edge is capped.
  const cursor = screen.getCursorScreenPoint();
  const disp = screen.getDisplayNearestPoint(cursor);
  const scale = disp.scaleFactor || 1;
  const fullW = Math.round(disp.size.width * scale);
  const fullH = Math.round(disp.size.height * scale);
  const longEdge = Math.max(fullW, fullH);
  const ratio = longEdge > AI.CAPTURE_LONG_EDGE ? AI.CAPTURE_LONG_EDGE / longEdge : 1;
  const thumbnailSize = { width: Math.round(fullW * ratio), height: Math.round(fullH * ratio) };

  const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize });
  if (!sources || !sources.length) throw new Error('No screen available to capture.');

  // Prefer the source for the display under the cursor; fall back to the first.
  const source = sources.find((s) => String(s.display_id) === String(disp.id)) || sources[0];
  const img = source.thumbnail;
  if (!img || img.isEmpty()) {
    throw new Error('Screen capture came back empty (Screen Recording permission may be missing).');
  }

  // PNG by default; if it's too big for the API's per-image limit, use JPEG.
  let mediaType = 'image/png';
  let data = img.toPNG().toString('base64');
  if (data.length > AI.JPEG_FALLBACK_BYTES) {
    mediaType = 'image/jpeg';
    data = img.toJPEG(80).toString('base64');
  }
  return { data, mediaType };
}

// ---- Request building / response parsing (provider-aware) ------------------

function headersFor(format, key) {
  if (format === 'openai') {
    return { 'content-type': 'application/json', Authorization: `Bearer ${key}` };
  }
  // Anthropic Messages API.
  return {
    'content-type': 'application/json',
    'x-api-key': key,
    'anthropic-version': '2023-06-01',
  };
}

// Build the `content` array for a user message in the right shape per provider.
function buildUserContent(format, { text, image }) {
  const blocks = [];
  if (format === 'openai') {
    if (text) blocks.push({ type: 'text', text });
    if (image) {
      blocks.push({ type: 'image_url', image_url: { url: `data:${image.mediaType};base64,${image.data}` } });
    }
  } else {
    // Anthropic puts the image first, then the instruction.
    if (image) {
      blocks.push({ type: 'image', source: { type: 'base64', media_type: image.mediaType, data: image.data } });
    }
    if (text) blocks.push({ type: 'text', text });
  }
  return blocks;
}

function extractError(json, raw, status) {
  const msg =
    json &&
    ((json.error && (json.error.message || (typeof json.error === 'string' ? json.error : null))) ||
      json.message);
  if (msg) return `${msg} (HTTP ${status})`;
  const snippet = String(raw || '')
    .slice(0, 160)
    .replace(/\s+/g, ' ')
    .trim();
  return snippet ? `HTTP ${status}: ${snippet}` : `HTTP ${status}`;
}

// Pull the assistant's text out of either provider's response shape (and a few
// proxy variants), so a misconfigured "format" still tends to work.
function extractText(json) {
  if (!json) return '';
  // Anthropic: { content: [ { type:'text', text } ] }
  if (Array.isArray(json.content)) {
    const t = json.content
      .filter((b) => b && b.type === 'text' && typeof b.text === 'string')
      .map((b) => b.text)
      .join('\n')
      .trim();
    if (t) return t;
  }
  // OpenAI: { choices: [ { message: { content } } ] }
  const c = json.choices && json.choices[0] && json.choices[0].message && json.choices[0].message.content;
  if (typeof c === 'string' && c.trim()) return c.trim();
  if (Array.isArray(c)) {
    const t = c
      .map((p) => (p && typeof p.text === 'string' ? p.text : ''))
      .join('\n')
      .trim();
    if (t) return t;
  }
  return '';
}

// Core call. config: { endpoint, apiKey, model, format }. Returns
// { ok:true, text } or { ok:false, error }.
async function callAi(config, content) {
  const endpoint = (config.endpoint || '').trim();
  const apiKey = (config.apiKey || '').trim();
  const model = (config.model || '').trim() || 'claude-opus-4-8';
  const format = config.format === 'openai' ? 'openai' : 'anthropic';
  if (!endpoint) return { ok: false, error: 'No API endpoint configured.' };
  if (!apiKey) return { ok: false, error: 'No API key configured.' };

  const body = { model, max_tokens: AI.MAX_TOKENS, messages: [{ role: 'user', content }] };

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), AI.TIMEOUT_MS);
  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: headersFor(format, apiKey),
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    const raw = await res.text();
    let json = null;
    try {
      json = raw ? JSON.parse(raw) : null;
    } catch {
      /* non-JSON body — handled below */
    }
    if (!res.ok) return { ok: false, error: extractError(json, raw, res.status) };
    const text = extractText(json);
    if (!text) return { ok: false, error: 'The API returned an empty or unrecognized response.' };
    return { ok: true, text };
  } catch (err) {
    if (err && err.name === 'AbortError') {
      return { ok: false, error: `Request timed out after ${Math.round(AI.TIMEOUT_MS / 1000)}s.` };
    }
    return { ok: false, error: (err && err.message) || 'Network error.' };
  } finally {
    clearTimeout(timer);
  }
}

// ---- Orchestrator ----------------------------------------------------------

class AiAssistant {
  constructor({ brain, overlay }) {
    this.brain = brain;
    this.overlay = overlay;
    this.busy = false;
  }

  // Read the live, persisted config (key is decrypted via safeStorage).
  currentConfig() {
    return {
      enabled: !!settings.get('aiEnabled'),
      endpoint: settings.get('aiEndpoint') || '',
      apiKey: settings.getSecret('aiApiKey') || '',
      model: settings.get('aiModel') || 'claude-opus-4-8',
      format: settings.get('aiFormat') || 'anthropic',
    };
  }

  isConfigured() {
    const c = this.currentConfig();
    return !!(c.endpoint && c.apiKey);
  }

  // Hotkey entry point.
  async trigger() {
    // Pressing the hotkey again while the panel is open just closes it.
    if (this.overlay && this.overlay.isVisible()) {
      this.overlay.dismiss();
      return;
    }
    if (this.busy) return; // a query is already in flight

    const cfg = this.currentConfig();
    if (!cfg.enabled || !cfg.endpoint || !cfg.apiKey) {
      notify('Ask MeowDesk', 'Configure the AI Assistant in the MeowDesk tray first.');
      return;
    }

    this.busy = true;
    // Hold "thinking" until a terminal happy/react one-shot replaces it.
    if (this.brain) this.brain.playOnce('thinking', AI.TIMEOUT_MS + 5000);

    try {
      const image = await captureScreen();
      const content = buildUserContent(cfg.format, { text: USER_PROMPT, image });
      const res = await callAi(cfg, content);
      if (!res.ok) throw new Error(res.error);
      if (this.overlay) this.overlay.show(res.text);
      if (this.brain) this.brain.playOnce('happy', 700);
    } catch (err) {
      if (this.brain) this.brain.playOnce('react', 900);
      notify('Ask MeowDesk failed', truncate((err && err.message) || err, 160));
    } finally {
      this.busy = false;
    }
  }

  // Called by the config window's "Verify Connection" with unsaved form values.
  async verify({ endpoint, apiKey, model, format }) {
    const content = buildUserContent(format === 'openai' ? 'openai' : 'anthropic', {
      text: 'Reply with exactly: ready',
    });
    return callAi({ endpoint, apiKey, model, format }, content);
  }
}

module.exports = { AiAssistant, callAi, captureScreen, buildUserContent };
