/**
 * Lokale Weboberfläche: ein kleiner HTTP-Server, der das Formular ausliefert,
 * Läufe startet und den Fortschritt per Server-Sent Events zurückmeldet.
 *
 * Bewusst ohne Framework — `node:http` reicht. Der Server bindet standardmäßig
 * nur an 127.0.0.1: er lädt beliebige URLs auf Zuruf und hat keine Anmeldung,
 * gehört also nicht ins offene Netz.
 */

import { randomBytes } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile, stat, writeFile } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { captureAll } from './capture.js';
import { applyRunOptions, VERSION } from './cli.js';
import { UserError } from './errors.js';
import { summarise, writeReport } from './report.js';
import { parseUrlList } from './urls.js';

const ASSETS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'assets');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.woff2': 'font/woff2',
};

const MAX_BODY_BYTES = 1024 * 1024;

/** Obergrenzen, damit ein Versehen den Rechner nicht lahmlegt. */
const MAX_EVENT_CLIENTS = 12;
const MAX_TARGETS_PER_RUN = 2000;

/** Nur diese Dateien werden aus lib/assets ausgeliefert. */
/**
 * Was unter /assets/ herausgegeben wird — eine Positivliste, kein Verzeichnis.
 * Die Schriftpfade stehen als vollständiger Name drin; weil hier exakt
 * verglichen wird, öffnet der Schrägstrich keinen Weg nach oben.
 */
const PUBLIC_ASSETS = new Set([
  'ui.css',
  'ui.js',
  'report.css',
  'report.js',
  'logo.svg',
  'fonts/ZillaSlab-Bold.woff2',
  'fonts/SpaceMono-Bold.woff2',
]);

/** Header, über den die Oberfläche ihr Sitzungsmerkmal mitschickt. */
const TOKEN_HEADER = 'x-screenshotter-token';

/**
 * Schutz gegen Cross-Site Request Forgery.
 *
 * Ohne diese Prüfung kann eine beliebige fremde Webseite im Browser des Nutzers
 * ein Formular an diesen Server abschicken: `enctype="text/plain"` löst keinen
 * CORS-Preflight aus, und mit einem passend gebauten Feldnamen entsteht dabei
 * gültiges JSON. Eine solche Seite könnte damit Läufe starten, das Ziel frei
 * wählen (auch Adressen im Heimnetz) und den Ausgabeordner bestimmen.
 *
 * Drei Riegel, jeder für sich ausreichend:
 *   1. Nur `application/json` — mehr kann ein Formular ohne Preflight nicht senden.
 *   2. `Origin`/`Sec-Fetch-Site` müssen zur eigenen Herkunft passen.
 *   3. Das Sitzungsmerkmal, das nur die eigene Seite lesen kann.
 */
export function checkWriteRequest({ method, headers, token, host }) {
  if (method !== 'POST') return { ok: true };

  const contentType = String(headers['content-type'] ?? '').split(';')[0].trim().toLowerCase();
  if (contentType !== 'application/json') {
    return { ok: false, reason: 'Nur application/json wird angenommen.' };
  }

  const site = String(headers['sec-fetch-site'] ?? '').toLowerCase();
  if (site && site !== 'same-origin' && site !== 'none') {
    return { ok: false, reason: 'Anfragen von fremden Seiten werden abgelehnt.' };
  }

  const origin = headers.origin;
  if (origin) {
    let originHost = '';
    try {
      originHost = new URL(origin).host.toLowerCase();
    } catch {
      return { ok: false, reason: 'Unbrauchbare Origin-Angabe.' };
    }
    if (originHost !== String(host ?? '').toLowerCase()) {
      return { ok: false, reason: 'Anfragen von fremden Seiten werden abgelehnt.' };
    }
  }

  if (headers[TOKEN_HEADER] !== token) {
    return { ok: false, reason: 'Sitzungsmerkmal fehlt oder passt nicht. Seite neu laden.' };
  }

  return { ok: true };
}

/**
 * Schutz gegen DNS-Rebinding: eine fremde Seite kann einen Namen auf 127.0.0.1
 * auflösen lassen und dann diesen Server ansprechen. Der Host-Header verrät das.
 */
export function isAllowedHost(hostHeader, boundHost) {
  if (boundHost !== '127.0.0.1' && boundHost !== 'localhost' && boundHost !== '::1') return true;
  if (!hostHeader) return false;
  const name = String(hostHeader).replace(/:\d+$/, '').replace(/^\[|\]$/g, '').toLowerCase();
  return name === 'localhost' || name === '127.0.0.1' || name === '::1';
}

/**
 * Pfad innerhalb von `root` auflösen, ohne Ausbruch über "..".
 * Gibt `null` zurück, wenn der Pfad hinausführt **oder** unbrauchbar kodiert ist
 * — sonst würde decodeURIComponent werfen und der Server mit 500 antworten.
 */
export function resolveWithin(root, relative) {
  let decoded;
  try {
    decoded = decodeURIComponent(relative);
  } catch {
    return null;
  }
  decoded = decoded.replace(/^\/+/, '');
  // Ein eingeschleustes Null-Byte könnte Pfadprüfungen aushebeln.
  if (decoded.includes('\0')) return null;

  const target = path.resolve(root, decoded);
  const prefix = path.resolve(root) + path.sep;
  if (target !== path.resolve(root) && !target.startsWith(prefix)) return null;
  return target;
}

/**
 * Kopfzeilen, die auf jede Antwort gehören.
 *
 * `frame-ancestors 'none'` verhindert, dass eine fremde Seite die Oberfläche in
 * einen unsichtbaren Rahmen legt und den Nutzer zum Klick auf „Screenshots
 * erstellen“ verleitet. `form-action 'self'` hält Formulare auf diesem Server.
 */
const SECURITY_HEADERS = {
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'no-referrer',
  'content-security-policy':
    "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; " +
    "script-src 'self' 'unsafe-inline'; connect-src 'self'; base-uri 'none'; " +
    "form-action 'self'; frame-ancestors 'none'",
};

function sendJson(response, status, payload) {
  const body = JSON.stringify(payload);
  response.writeHead(status, {
    ...SECURITY_HEADERS,
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
  });
  response.end(body);
}

function sendText(response, status, text) {
  response.writeHead(status, { ...SECURITY_HEADERS, 'content-type': 'text/plain; charset=utf-8' });
  response.end(text);
}

async function sendFile(response, filePath) {
  try {
    const info = await stat(filePath);
    if (!info.isFile()) return sendText(response, 404, 'Nicht gefunden');

    response.writeHead(200, {
      ...SECURITY_HEADERS,
      'content-type': MIME[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream',
      'content-length': info.size,
      'cache-control': 'no-store',
    });
    createReadStream(filePath).pipe(response);
    return undefined;
  } catch {
    return sendText(response, 404, 'Nicht gefunden');
  }
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let tooLarge = false;

    request.on('data', (chunk) => {
      size += chunk.length;

      if (size > MAX_BODY_BYTES) {
        // Nicht sofort abbrechen: der Absender ist noch am Senden und bekäme
        // sonst einen Verbindungsabbruch statt einer verständlichen Meldung.
        // Also weiter annehmen, aber nichts mehr aufheben.
        tooLarge = true;
        chunks.length = 0;

        // Gegen endloses Zusenden gibt es trotzdem eine harte Grenze.
        if (size > MAX_BODY_BYTES * 8) {
          request.destroy();
          reject(new UserError('Die Anfrage ist zu groß (Grenze: 1 MB).'));
        }
        return;
      }
      chunks.push(chunk);
    });

    request.on('end', () => {
      if (tooLarge) return reject(new UserError('Die Anfrage ist zu groß (Grenze: 1 MB).'));

      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw.trim()) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new UserError('Die Anfrage war kein gültiges JSON.'));
      }
    });

    request.on('error', reject);
  });
}

/** Hält den Zustand des aktuellen bzw. letzten Laufs und beliefert die Clients. */
class RunState {
  constructor() {
    this.status = 'idle';
    this.total = 0;
    this.done = 0;
    this.results = [];
    this.messages = [];
    this.startedAt = 0;
    this.finishedAt = 0;
    this.durationMs = 0;
    this.stats = null;
    this.error = null;
    this.reportUrl = '';
    this.outLabel = '';
    this.outAbsolute = '';
    this.controller = null;
    this.clients = new Set();
  }

  get isRunning() {
    return this.status === 'running';
  }

  snapshot() {
    return {
      status: this.status,
      total: this.total,
      done: this.done,
      results: this.results,
      messages: this.messages,
      durationMs: this.durationMs,
      stats: this.stats,
      error: this.error,
      reportUrl: this.reportUrl,
      outLabel: this.outLabel,
      startedAt: this.startedAt,
    };
  }

  emit(event, data) {
    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const client of this.clients) {
      client.write(payload);
    }
  }

  /** @returns {boolean} ob der Client angenommen wurde */
  addClient(response) {
    if (this.clients.size >= MAX_EVENT_CLIENTS) return false;
    this.clients.add(response);
    response.write(`event: state\ndata: ${JSON.stringify(this.snapshot())}\n\n`);
    return true;
  }

  removeClient(response) {
    this.clients.delete(response);
  }
}

/**
 * Startet die Weboberfläche.
 *
 * @param {object} baseOptions  Optionen aus der Kommandozeile (Vorbelegung des Formulars)
 * @param {{ line: Function, dim: Function, bold: Function, red: Function }} reporter
 * @returns {Promise<{ url: string, close: () => Promise<void> }>}
 */
export async function startServer(baseOptions, reporter) {
  const state = new RunState();

  // Frisch pro Serverstart: eine fremde Seite kann ihn nicht lesen, weil sie
  // ohne CORS weder die Oberfläche noch eine Antwort dieses Servers auswerten kann.
  const token = randomBytes(24).toString('base64url');

  async function beginRun(body) {
    if (state.isRunning) {
      throw new UserError('Es läuft bereits ein Auftrag. Bitte abwarten oder abbrechen.');
    }

    const entries = parseUrlList(String(body.urls ?? ''));
    if (entries.length === 0) {
      throw new UserError('Keine gültige URL gefunden. Bitte mindestens eine Adresse eintragen.');
    }

    const seen = new Map();
    for (const entry of entries) {
      if (!seen.has(entry.url)) seen.set(entry.url, entry);
    }
    const targets = [...seen.values()];

    if (targets.length > MAX_TARGETS_PER_RUN) {
      throw new UserError(
        `${targets.length} URLs sind zu viele für einen Auftrag (Grenze: ${MAX_TARGETS_PER_RUN}).`,
        { hint: 'Die Liste aufteilen oder den Lauf über die Kommandozeile starten.' },
      );
    }

    const controller = new AbortController();
    const options = { ...applyRunOptions(baseOptions, body.options ?? {}), signal: controller.signal };
    const outAbsolute = path.resolve(process.cwd(), options.out);

    Object.assign(state, {
      status: 'running',
      total: targets.length,
      done: 0,
      results: [],
      messages: [],
      startedAt: Date.now(),
      finishedAt: 0,
      durationMs: 0,
      stats: null,
      error: null,
      reportUrl: '',
      outLabel: path.relative(process.cwd(), outAbsolute) || '.',
      outAbsolute,
      controller,
    });
    state.emit('state', state.snapshot());

    // Bewusst nicht awaiten: die Antwort geht sofort raus, der Rest kommt per SSE.
    runInBackground(targets, options, outAbsolute);
    return { total: targets.length };
  }

  async function runInBackground(targets, options, outAbsolute) {
    try {
      const { results, durationMs, cancelled } = await captureAll(
        targets,
        options,
        { outAbsolute },
        (result, done, total) => {
          state.done = done;
          state.total = total;
          state.results.push(result);
          state.emit('result', { result, done, total });
        },
        (message) => {
          state.messages.push(message);
          state.emit('message', { message });
        },
      );

      state.durationMs = durationMs;
      state.stats = summarise(results, durationMs);

      if (options.report && results.length > 0) {
        await writeReport({ results, options, outAbsolute, durationMs, source: 'Weboberfläche' });
        state.reportUrl = '/report/';
      }

      state.status = cancelled ? 'cancelled' : 'done';
      state.finishedAt = Date.now();
      state.emit('done', state.snapshot());
      reporter.line(
        reporter.dim(
          `  Auftrag ${cancelled ? 'abgebrochen' : 'fertig'}: ${results.length} Seite(n) in ${Math.round(durationMs / 1000)} s`,
        ),
      );
    } catch (error) {
      state.status = 'error';
      state.error = error instanceof UserError ? error.message : String(error?.message ?? error);
      state.finishedAt = Date.now();
      state.emit('done', state.snapshot());
      reporter.line(`  ${reporter.red('Auftrag fehlgeschlagen:')} ${state.error}`);
    } finally {
      state.controller = null;
    }
  }

  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url, 'http://localhost');
    const { pathname } = url;

    if (!isAllowedHost(request.headers.host, baseOptions.host)) {
      return sendText(response, 403, 'Nur über localhost erreichbar.');
    }

    // Alles, was etwas verändert, muss von der eigenen Oberfläche kommen.
    const guard = checkWriteRequest({
      method: request.method,
      headers: request.headers,
      token,
      host: request.headers.host,
    });
    if (!guard.ok) {
      return sendJson(response, 403, { error: guard.reason });
    }

    try {
      if (request.method === 'GET' && (pathname === '/' || pathname === '/index.html')) {
        // Das Sitzungsmerkmal wird beim Ausliefern in die Seite gesetzt.
        const html = (await readFile(path.join(ASSETS_DIR, 'ui.html'), 'utf8')).replace('__TOKEN__', token);
        response.writeHead(200, {
          ...SECURITY_HEADERS,
          'content-type': 'text/html; charset=utf-8',
          'content-length': Buffer.byteLength(html),
          'cache-control': 'no-store',
        });
        response.end(html);
        return undefined;
      }

      if (request.method === 'GET' && pathname.startsWith('/assets/')) {
        const name = pathname.slice('/assets/'.length);
        if (!PUBLIC_ASSETS.has(name)) return sendText(response, 404, 'Nicht gefunden');
        return await sendFile(response, path.join(ASSETS_DIR, name));
      }

      if (request.method === 'GET' && pathname === '/api/state') {
        return sendJson(response, 200, {
          version: VERSION,
          defaults: publicDefaults(baseOptions),
          run: state.snapshot(),
        });
      }

      if (request.method === 'GET' && pathname === '/api/urls') {
        try {
          const text = await readFile(path.resolve(process.cwd(), baseOptions.input), 'utf8');
          return sendJson(response, 200, { file: baseOptions.input, text });
        } catch {
          return sendJson(response, 200, { file: baseOptions.input, text: '' });
        }
      }

      if (request.method === 'POST' && pathname === '/api/urls') {
        const body = await readBody(request);
        const text = String(body.text ?? '');
        parseUrlList(text); // wirft bei ungültigen Zeilen, bevor gespeichert wird
        await writeFile(path.resolve(process.cwd(), baseOptions.input), text.endsWith('\n') ? text : `${text}\n`, 'utf8');
        return sendJson(response, 200, { saved: baseOptions.input });
      }

      if (request.method === 'POST' && pathname === '/api/run') {
        const body = await readBody(request);
        return sendJson(response, 202, await beginRun(body));
      }

      if (request.method === 'POST' && pathname === '/api/cancel') {
        if (!state.isRunning) return sendJson(response, 200, { cancelled: false });
        state.controller?.abort();
        state.emit('message', { message: 'Abbruch angefordert — laufende Seiten werden noch zu Ende gebracht.' });
        return sendJson(response, 200, { cancelled: true });
      }

      if (request.method === 'GET' && pathname === '/api/events') {
        // Erst die Grenze prüfen, dann den Strom eröffnen: offene Tabs oder eine
        // fremde Seite sollen den Server nicht mit Dauerverbindungen zustellen.
        if (state.clients.size >= MAX_EVENT_CLIENTS) {
          return sendJson(response, 503, {
            error: `Zu viele offene Verbindungen (Grenze: ${MAX_EVENT_CLIENTS}).`,
            hint: 'Andere Tabs mit der Oberfläche schließen.',
          });
        }

        response.writeHead(200, {
          ...SECURITY_HEADERS,
          'content-type': 'text/event-stream; charset=utf-8',
          'cache-control': 'no-store',
          connection: 'keep-alive',
        });
        state.addClient(response);
        const heartbeat = setInterval(() => response.write(': ping\n\n'), 25000);
        request.on('close', () => {
          clearInterval(heartbeat);
          state.removeClient(response);
        });
        return undefined;
      }

      if (request.method === 'GET' && pathname.startsWith('/report')) {
        // Das Formular darf den Zielordner ändern — dann zeigt /report/ dorthin.
        const outAbsolute = state.outAbsolute || path.resolve(process.cwd(), baseOptions.out);
        const relative = pathname.slice('/report'.length) || '/';
        const target = resolveWithin(outAbsolute, relative.endsWith('/') ? `${relative}index.html` : relative);
        if (!target) return sendText(response, 400, 'Ungültiger Pfad');
        return await sendFile(response, target);
      }

      return sendText(response, 404, 'Nicht gefunden');
    } catch (error) {
      if (error instanceof UserError) {
        return sendJson(response, 400, { error: error.message, hint: error.hint ?? '' });
      }
      reporter.line(`  ${reporter.red('Serverfehler:')} ${error?.message ?? error}`);
      return sendJson(response, 500, { error: 'Unerwarteter Serverfehler.' });
    }
  });

  await new Promise((resolve, reject) => {
    server.once('error', (error) => {
      if (error.code === 'EADDRINUSE') {
        return reject(
          new UserError(`Port ${baseOptions.port} ist schon belegt.`, {
            hint: `Läuft screenshotter bereits in einem anderen Fenster? Sonst einen anderen Port wählen: --port ${baseOptions.port + 1}`,
          }),
        );
      }
      if (error.code === 'EACCES') {
        return reject(
          new UserError(`Port ${baseOptions.port} darf nicht geöffnet werden.`, {
            hint: 'Ports unter 1024 sind dem System vorbehalten. Einen höheren Port wählen, z.B. --port 8080.',
          }),
        );
      }
      if (error.code === 'EADDRNOTAVAIL') {
        return reject(
          new UserError(`Die Adresse ${baseOptions.host} gibt es auf diesem Rechner nicht.`, {
            hint: 'Ohne --host läuft die Oberfläche auf 127.0.0.1.',
          }),
        );
      }
      return reject(error);
    });
    server.listen(baseOptions.port, baseOptions.host, resolve);
  });

  const shown = baseOptions.host === '0.0.0.0' || baseOptions.host === '::' ? 'localhost' : baseOptions.host;
  return {
    url: `http://${shown}:${baseOptions.port}/`,
    close: () =>
      new Promise((resolve) => {
        for (const client of state.clients) client.end();
        server.close(() => resolve());
      }),
  };
}

/** Vorbelegung des Formulars — ohne Proxy und andere interne Angaben. */
function publicDefaults(options) {
  return {
    preset: options.preset || 'desktop',
    width: options.width,
    height: options.height,
    scale: options.scale,
    format: options.format,
    quality: options.quality,
    concurrency: options.concurrency,
    timeout: options.timeout,
    delay: options.delay,
    retries: options.retries,
    waitUntil: options.waitUntil,
    colorScheme: options.colorScheme,
    title: options.title,
    out: options.out,
    hide: options.hide,
    fullPage: options.fullPage,
    autoScroll: options.autoScroll,
    stabilize: options.stabilize,
    thumbnails: options.thumbnails,
    inputFile: options.input,
  };
}
