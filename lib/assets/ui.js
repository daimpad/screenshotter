/* screenshotter — Weboberfläche. Vanilla JS, keine Abhängigkeiten. */

(function () {
  'use strict';

  var THEME_KEY = 'screenshotter-theme';
  var SYMBOLS = { ok: '✓', redirect: '↻', error: '✗' };

  var el = {};
  var stream = null;

  function byId(id) {
    return document.getElementById(id);
  }

  function collect() {
    [
      'run-form', 'urls', 'url-count', 'urls-file', 'load-urls', 'save-urls',
      'preset', 'format', 'quality', 'quality-field', 'concurrency', 'title', 'out',
      'hide', 'timeout', 'delay', 'retries', 'waitUntil', 'colorScheme',
      'fullPage', 'autoScroll', 'stabilize', 'thumbnails',
      'start', 'cancel', 'form-note', 'run', 'run-title', 'run-counter',
      'meter', 'meter-fill', 'run-message', 'results', 'run-footer', 'open-report',
      'run-summary', 'version', 'theme-toggle',
    ].forEach(function (id) {
      el[id] = byId(id);
    });
  }

  /* ------------------------------------------------------------------ Hilfen */

  function note(text, kind) {
    el['form-note'].textContent = text || '';
    el['form-note'].className = 'actions__note' + (kind ? ' actions__note--' + kind : '');
  }

  function countUrls() {
    var lines = el.urls.value.split('\n').map(function (line) {
      return line.trim();
    });
    var urls = lines.filter(function (line) {
      return line && line.indexOf('#') !== 0 && line.indexOf('//') !== 0;
    });
    el['url-count'].textContent = urls.length === 1 ? '1 URL' : urls.length + ' URLs';
    return urls.length;
  }

  function formatDuration(ms) {
    if (!isFinite(ms) || ms < 0) return '–';
    if (ms < 1000) return Math.round(ms) + ' ms';
    var seconds = ms / 1000;
    if (seconds < 60) return seconds.toFixed(1).replace('.', ',') + ' s';
    return Math.floor(seconds / 60) + ' min ' + String(Math.round(seconds % 60)).padStart(2, '0') + ' s';
  }

  function formatBytes(bytes) {
    if (!bytes) return '–';
    if (bytes < 1024) return bytes + ' B';
    var units = ['KB', 'MB', 'GB'];
    var value = bytes / 1024;
    var index = 0;
    while (value >= 1024 && index < units.length - 1) {
      value /= 1024;
      index += 1;
    }
    return value.toLocaleString('de-DE', { maximumFractionDigits: value < 10 ? 1 : 0 }) + ' ' + units[index];
  }

  function classify(result) {
    if (result.error || !result.file) return 'error';
    if (result.status !== null && result.status >= 400) return 'error';
    if (result.finalUrl && result.finalUrl !== result.url) return 'redirect';
    if (result.status !== null && result.status >= 300) return 'redirect';
    return 'ok';
  }

  async function api(path, options) {
    var response = await fetch(path, options);
    var payload = null;
    try {
      payload = await response.json();
    } catch (error) {
      payload = null;
    }
    if (!response.ok) {
      var message = (payload && payload.error) || 'Anfrage fehlgeschlagen (' + response.status + ')';
      if (payload && payload.hint) message += ' — ' + payload.hint;
      throw new Error(message);
    }
    return payload;
  }

  /* ------------------------------------------------------------ Formular */

  function fillDefaults(defaults) {
    if (!defaults) return;
    var direct = ['preset', 'format', 'quality', 'concurrency', 'title', 'out', 'timeout', 'delay', 'retries', 'waitUntil', 'colorScheme'];
    direct.forEach(function (key) {
      if (el[key] && defaults[key] !== undefined && defaults[key] !== null) el[key].value = defaults[key];
    });
    if (Array.isArray(defaults.hide)) el.hide.value = defaults.hide.join(', ');
    ['fullPage', 'autoScroll', 'stabilize', 'thumbnails'].forEach(function (key) {
      if (el[key] && typeof defaults[key] === 'boolean') el[key].checked = defaults[key];
    });
    if (defaults.inputFile) el['urls-file'].textContent = 'Datei: ' + defaults.inputFile;
    toggleQuality();
  }

  function toggleQuality() {
    var active = el.format.value === 'jpeg';
    el['quality-field'].hidden = !active;
    // Deaktiviert statt nur versteckt: ein ausgeblendetes, aber aktives Feld
    // nimmt sonst weiter an der Formularprüfung teil.
    el.quality.disabled = !active;
  }

  function readForm() {
    return {
      preset: el.preset.value,
      format: el.format.value,
      quality: Number(el.quality.value) || undefined,
      concurrency: Number(el.concurrency.value) || undefined,
      title: el.title.value,
      out: el.out.value,
      hide: el.hide.value,
      timeout: Number(el.timeout.value) || undefined,
      delay: el.delay.value === '' ? undefined : Number(el.delay.value),
      retries: el.retries.value === '' ? undefined : Number(el.retries.value),
      waitUntil: el.waitUntil.value,
      colorScheme: el.colorScheme.value,
      fullPage: el.fullPage.checked,
      autoScroll: el.autoScroll.checked,
      stabilize: el.stabilize.checked,
      thumbnails: el.thumbnails.checked,
    };
  }

  /* ---------------------------------------------------------- Lauf-Anzeige */

  function resetRun() {
    el.results.innerHTML = '';
    el['run-footer'].hidden = true;
    el['run-message'].hidden = true;
    el.run.className = 'panel run';
    el.run.hidden = false;
  }

  function setProgress(done, total) {
    var percent = total > 0 ? Math.round((done / total) * 100) : 0;
    el['meter-fill'].style.width = percent + '%';
    el.meter.setAttribute('aria-valuenow', String(percent));
    el['run-counter'].textContent = done + ' von ' + total;
  }

  function addResult(result) {
    var state = classify(result);
    var item = document.createElement('li');
    item.className = 'result result--' + state;

    var symbol = document.createElement('span');
    symbol.className = 'result__symbol';
    symbol.textContent = SYMBOLS[state];

    var status = document.createElement('span');
    status.className = 'result__status';
    status.textContent = result.status === null ? '---' : String(result.status);

    var url = document.createElement('span');
    url.className = 'result__url';
    url.textContent = result.url;

    var duration = document.createElement('span');
    duration.className = 'result__duration';
    duration.textContent = formatDuration(result.durationMs);

    item.appendChild(symbol);
    item.appendChild(status);
    item.appendChild(url);
    item.appendChild(duration);

    if (result.error) {
      var error = document.createElement('p');
      error.className = 'result__error';
      error.textContent = result.error;
      item.appendChild(error);

      if (result.errorHint) {
        var hint = document.createElement('p');
        hint.className = 'result__hint';
        hint.textContent = '→ ' + result.errorHint;
        item.appendChild(hint);
      }
    }

    el.results.appendChild(item);
    el.results.scrollTop = el.results.scrollHeight;
  }

  function setRunning(running) {
    el.start.disabled = running;
    el.start.textContent = running ? 'Läuft …' : 'Screenshots erstellen';
    el.cancel.hidden = !running;
  }

  function finish(snapshot) {
    setRunning(false);
    el.run.className = 'panel run run--' + snapshot.status;

    if (snapshot.status === 'error') {
      el['run-title'].textContent = 'Fehlgeschlagen';
      el['run-message'].textContent = snapshot.error || 'Unbekannter Fehler.';
      el['run-message'].hidden = false;
      return;
    }

    el['run-title'].textContent = snapshot.status === 'cancelled' ? 'Abgebrochen' : 'Fertig';
    setProgress(snapshot.done, snapshot.total);

    var stats = snapshot.stats;
    if (stats) {
      var parts = [
        stats.ok + ' erfolgreich',
        stats.redirect ? stats.redirect + ' weitergeleitet' : null,
        stats.error ? stats.error + ' fehlgeschlagen' : null,
        formatBytes(stats.bytes),
        'in ' + formatDuration(snapshot.durationMs),
      ].filter(Boolean);
      el['run-summary'].textContent = parts.join(' · ');
    }

    if (snapshot.reportUrl) {
      el['open-report'].href = snapshot.reportUrl;
      el['run-footer'].hidden = false;
    }
  }

  function applySnapshot(snapshot) {
    if (!snapshot || snapshot.status === 'idle') return;

    resetRun();
    (snapshot.results || []).forEach(addResult);
    setProgress(snapshot.done, snapshot.total);

    if (snapshot.status === 'running') {
      setRunning(true);
      el['run-title'].textContent = 'Läuft …';
    } else {
      finish(snapshot);
    }
  }

  /* --------------------------------------------------- Ereignisstrom (SSE) */

  function connect() {
    if (stream) stream.close();
    stream = new EventSource('/api/events');

    stream.addEventListener('state', function (event) {
      applySnapshot(JSON.parse(event.data));
    });

    stream.addEventListener('result', function (event) {
      var payload = JSON.parse(event.data);
      addResult(payload.result);
      setProgress(payload.done, payload.total);
    });

    stream.addEventListener('message', function (event) {
      el['run-message'].textContent = JSON.parse(event.data).message;
      el['run-message'].hidden = false;
    });

    stream.addEventListener('done', function (event) {
      finish(JSON.parse(event.data));
    });
  }

  /* -------------------------------------------------------------- Aktionen */

  async function start(event) {
    event.preventDefault();
    if (countUrls() === 0) {
      note('Bitte mindestens eine URL eintragen.', 'error');
      el.urls.focus();
      return;
    }

    note('');
    setRunning(true);
    resetRun();
    el['run-title'].textContent = 'Läuft …';
    setProgress(0, 0);

    try {
      var result = await api('/api/run', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ urls: el.urls.value, options: readForm() }),
      });
      setProgress(0, result.total);
    } catch (error) {
      setRunning(false);
      el.run.hidden = true;
      note(error.message, 'error');
    }
  }

  async function cancel() {
    el.cancel.disabled = true;
    try {
      await api('/api/cancel', { method: 'POST' });
    } catch (error) {
      note(error.message, 'error');
    } finally {
      el.cancel.disabled = false;
    }
  }

  async function loadUrls() {
    try {
      var payload = await api('/api/urls');
      el.urls.value = payload.text;
      countUrls();
      note(payload.text ? 'Aus ' + payload.file + ' geladen.' : payload.file + ' ist noch leer.', 'ok');
    } catch (error) {
      note(error.message, 'error');
    }
  }

  async function saveUrls() {
    try {
      var payload = await api('/api/urls', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: el.urls.value }),
      });
      note('In ' + payload.saved + ' gespeichert.', 'ok');
    } catch (error) {
      note(error.message, 'error');
    }
  }

  /* ------------------------------------------------------------------ Theme */

  function initTheme() {
    var button = el['theme-toggle'];
    if (!button) return;
    var label = button.querySelector('[data-theme-label]');

    function apply(theme) {
      if (theme === 'light' || theme === 'dark') document.documentElement.setAttribute('data-theme', theme);
      else document.documentElement.removeAttribute('data-theme');
      if (label) label.textContent = theme === 'dark' ? 'Dunkel' : theme === 'light' ? 'Hell' : 'System';
    }

    var stored = null;
    try {
      stored = localStorage.getItem(THEME_KEY);
    } catch (error) {
      stored = null;
    }
    apply(stored || 'system');

    button.addEventListener('click', function () {
      var order = ['system', 'light', 'dark'];
      var current = document.documentElement.getAttribute('data-theme') || 'system';
      var next = order[(order.indexOf(current) + 1) % order.length];
      apply(next);
      try {
        if (next === 'system') localStorage.removeItem(THEME_KEY);
        else localStorage.setItem(THEME_KEY, next);
      } catch (error) {
        /* egal */
      }
    });
  }

  /* -------------------------------------------------------------------- Init */

  async function init() {
    collect();
    initTheme();

    el['run-form'].addEventListener('submit', start);
    el.cancel.addEventListener('click', cancel);
    el['load-urls'].addEventListener('click', loadUrls);
    el['save-urls'].addEventListener('click', saveUrls);
    el.urls.addEventListener('input', countUrls);
    el.format.addEventListener('change', toggleQuality);

    // Strg/Cmd + Enter startet den Lauf aus dem Textfeld heraus.
    el.urls.addEventListener('keydown', function (event) {
      if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') el['run-form'].requestSubmit();
    });

    try {
      var payload = await api('/api/state');
      el.version.textContent = 'v' + payload.version;
      fillDefaults(payload.defaults);
      applySnapshot(payload.run);
    } catch (error) {
      note('Der Server antwortet nicht: ' + error.message, 'error');
    }

    // Vorhandene urls.txt gleich anbieten, aber ohne Meldung.
    if (!el.urls.value) {
      try {
        var urls = await api('/api/urls');
        if (urls.text) el.urls.value = urls.text;
      } catch (error) {
        /* nicht schlimm */
      }
    }

    countUrls();
    connect();
    document.documentElement.classList.add('js-ready');
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
