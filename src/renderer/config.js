// ---------------------------------------------------------------------------
// config.js — renderer for the AI settings form. Loads current settings,
// verifies a connection on demand, and saves. All logic lives behind the
// meowConfig IPC bridge; this just drives the form and shows status.
// ---------------------------------------------------------------------------

/* global meowConfig */

(function () {
  const $ = (id) => document.getElementById(id);
  const format = $('format');
  const endpoint = $('endpoint');
  const apiKey = $('apiKey');
  const model = $('model');
  const verifyBtn = $('verify');
  const saveBtn = $('save');
  const statusEl = $('status');

  const DEFAULT_ENDPOINTS = {
    anthropic: 'https://api.anthropic.com/v1/messages',
    openai: 'https://api.openai.com/v1/chat/completions',
  };

  function setStatus(msg, cls) {
    statusEl.textContent = msg || '';
    statusEl.className = 'status' + (cls ? ' ' + cls : '');
  }

  // Form values, defaulting the endpoint to the format's standard one if blank.
  function values() {
    const fmt = format.value === 'openai' ? 'openai' : 'anthropic';
    return {
      format: fmt,
      endpoint: endpoint.value.trim() || DEFAULT_ENDPOINTS[fmt],
      apiKey: apiKey.value,
      model: model.value.trim(),
    };
  }

  function syncPlaceholders() {
    const fmt = format.value === 'openai' ? 'openai' : 'anthropic';
    endpoint.placeholder = DEFAULT_ENDPOINTS[fmt];
    model.placeholder = fmt === 'openai' ? 'gpt-4o' : 'claude-opus-4-8';
  }

  format.addEventListener('change', syncPlaceholders);

  async function loadConfig() {
    try {
      const c = await meowConfig.getConfig();
      format.value = c.format === 'openai' ? 'openai' : 'anthropic';
      endpoint.value = c.endpoint || '';
      apiKey.value = c.apiKey || '';
      model.value = c.model || '';
      syncPlaceholders();
    } catch {
      setStatus('Could not load saved settings.', 'err');
    }
  }

  function busy(on) {
    verifyBtn.disabled = on;
    saveBtn.disabled = on;
  }

  verifyBtn.addEventListener('click', async () => {
    const v = values();
    if (!v.endpoint || !v.apiKey) {
      setStatus('Enter an endpoint and API key first.', 'err');
      return;
    }
    busy(true);
    setStatus('Verifying…');
    try {
      const r = await meowConfig.verifyConfig(v);
      if (r && r.ok) setStatus('✓ Connected — ' + String(r.text || 'ok').slice(0, 80), 'ok');
      else setStatus('✗ ' + ((r && r.error) || 'Verification failed'), 'err');
    } catch (e) {
      setStatus('✗ ' + (e.message || 'Verification failed'), 'err');
    } finally {
      busy(false);
    }
  });

  saveBtn.addEventListener('click', async () => {
    const v = values();
    busy(true);
    setStatus('Saving…');
    try {
      const r = await meowConfig.saveConfig(v);
      if (r && r.ok) {
        endpoint.value = v.endpoint; // reflect any defaulted endpoint
        setStatus('✓ Saved.', 'ok');
      } else {
        setStatus('✗ ' + ((r && r.error) || 'Could not save'), 'err');
      }
    } catch (e) {
      setStatus('✗ ' + (e.message || 'Could not save'), 'err');
    } finally {
      busy(false);
    }
  });

  loadConfig();
})();
