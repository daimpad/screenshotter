/**
 * Tests der Weboberfläche: echter Serverprozess, echte Testseiten, echter
 * Browser. Deckt neben der Bedienung auch die Absicherung ab (Pfad-Traversal,
 * fremder Host-Header, Prüfung der Formularwerte).
 *
 *   node --test test/server.test.js
 */

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, test } from 'node:test';

import { launchBrowser } from '../lib/capture.js';
import { isAllowedHost, resolveWithin } from '../lib/server.js';
import { freePort, startServer } from './fixtures/server.js';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const CLI = path.join(ROOT, 'screenshotter.js');

let fixture;
let workDir;
let child;
let base;
let browser;

/** GET mit frei wählbarem Host-Header — `fetch` darf den nicht setzen. */
function rawGet(port, requestPath, hostHeader) {
  return new Promise((resolve, reject) => {
    const request = http.request(
      { host: '127.0.0.1', port, path: requestPath, method: 'GET', headers: { Host: hostHeader } },
      (response) => {
        let body = '';
        response.on('data', (chunk) => (body += chunk));
        response.on('end', () => resolve({ status: response.statusCode, body }));
      },
    );
    request.on('error', reject);
    request.end();
  });
}

async function api(pathname, init) {
  const response = await fetch(`${base}${pathname}`, init);
  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }
  return { status: response.status, payload };
}

const postJson = (body) => ({
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
});

before(async () => {
  fixture = await startServer();
  workDir = await mkdtemp(path.join(os.tmpdir(), 'screenshotter-ui-'));
  const port = await freePort();
  base = `http://127.0.0.1:${port}`;

  child = spawn(process.execPath, [CLI, '--serve', '--port', String(port), '--no-proxy'], {
    cwd: workDir,
    env: { ...process.env, NO_COLOR: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      if ((await fetch(`${base}/api/state`)).ok) break;
    } catch {
      /* noch nicht bereit */
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  browser = await launchBrowser({});
}, { timeout: 180000 });

after(async () => {
  await browser?.close().catch(() => {});
  child?.kill('SIGTERM');
  await new Promise((resolve) => setTimeout(resolve, 400));
  child?.kill('SIGKILL');
  await fixture?.close();
  if (workDir) await rm(workDir, { recursive: true, force: true });
});

/* ------------------------------------------------------------- Bausteine */

test('isAllowedHost lässt nur localhost durch, solange lokal gebunden wird', () => {
  assert.equal(isAllowedHost('127.0.0.1:8080', '127.0.0.1'), true);
  assert.equal(isAllowedHost('localhost:8080', '127.0.0.1'), true);
  assert.equal(isAllowedHost('[::1]:8080', '127.0.0.1'), true);
  assert.equal(isAllowedHost('boese.example', '127.0.0.1'), false);
  assert.equal(isAllowedHost('', '127.0.0.1'), false);
  // Wer bewusst ins Netz bindet, bekommt die Einschränkung nicht aufgezwungen.
  assert.equal(isAllowedHost('firma.intern', '0.0.0.0'), true);
});

test('resolveWithin verhindert das Ausbrechen aus dem Zielordner', () => {
  assert.equal(resolveWithin('/var/report', '/index.html'), path.resolve('/var/report/index.html'));
  assert.equal(resolveWithin('/var/report', '/screenshots/a.png'), path.resolve('/var/report/screenshots/a.png'));
  assert.equal(resolveWithin('/var/report', '/../../etc/passwd'), null);
  assert.equal(resolveWithin('/var/report', '/%2e%2e%2f%2e%2e%2fetc/passwd'), null);
});

/* ------------------------------------------------------------------ Server */

test('die Oberfläche wird ausgeliefert und meldet Version und Vorbelegung', async () => {
  const page = await fetch(`${base}/`);
  const html = await page.text();
  assert.equal(page.status, 200);
  assert.match(html, /<title>screenshotter<\/title>/);
  assert.ok(html.includes('id="run-form"'));

  const { status, payload } = await api('/api/state');
  assert.equal(status, 200);
  assert.match(payload.version, /^\d+\.\d+\.\d+$/);
  assert.equal(payload.defaults.preset, 'desktop');
  assert.equal(payload.run.status, 'idle');
  assert.ok(!('proxy' in payload.defaults), 'Proxy-Adresse darf nicht an den Browser gehen');
});

test('nur freigegebene Dateien werden aus assets ausgeliefert', async () => {
  assert.equal((await fetch(`${base}/assets/ui.css`)).status, 200);
  assert.equal((await fetch(`${base}/assets/report.js`)).status, 200);
  assert.equal((await fetch(`${base}/assets/ui.html`)).status, 404);
  assert.equal((await fetch(`${base}/assets/../server.js`)).status, 404);
});

test('ein fremder Host-Header wird abgewiesen (DNS-Rebinding)', async () => {
  const port = Number(new URL(base).port);
  assert.equal((await rawGet(port, '/api/state', '127.0.0.1')).status, 200);
  assert.equal((await rawGet(port, '/api/state', 'boese.example')).status, 403);
  assert.equal((await rawGet(port, '/', 'attacker.test:8080')).status, 403);
});

test('Formularwerte werden serverseitig geprüft', async () => {
  const tooMany = await api('/api/run', postJson({ urls: 'https://a.example', options: { concurrency: 999 } }));
  assert.equal(tooMany.status, 400);
  assert.match(tooMany.payload.error, /--concurrency muss zwischen 1 und 32 liegen/);

  const badPreset = await api('/api/run', postJson({ urls: 'https://a.example', options: { preset: 'fernseher' } }));
  assert.equal(badPreset.status, 400);

  const noUrls = await api('/api/run', postJson({ urls: '# nur ein Kommentar' }));
  assert.equal(noUrls.status, 400);
  assert.match(noUrls.payload.error, /Keine gültige URL/);

  const badUrl = await api('/api/run', postJson({ urls: 'ftp://a.example' }));
  assert.equal(badUrl.status, 400);
  assert.match(badUrl.payload.error, /Protokoll/);
});

test('urls.txt lässt sich über die Oberfläche lesen und schreiben', async () => {
  const empty = await api('/api/urls');
  assert.equal(empty.status, 200);
  assert.equal(empty.payload.text, '');

  const saved = await api('/api/urls', postJson({ text: 'https://gespeichert.example | Test' }));
  assert.equal(saved.status, 200);

  const onDisk = await readFile(path.join(workDir, 'urls.txt'), 'utf8');
  assert.equal(onDisk, 'https://gespeichert.example | Test\n');
  assert.equal((await api('/api/urls')).payload.text, onDisk);

  // Ungültige Zeilen dürfen die Datei nicht überschreiben.
  const rejected = await api('/api/urls', postJson({ text: 'ftp://falsch.example' }));
  assert.equal(rejected.status, 400);
  assert.equal(await readFile(path.join(workDir, 'urls.txt'), 'utf8'), onDisk);

  await writeFile(path.join(workDir, 'urls.txt'), '', 'utf8');
});

/* ------------------------------------------------------------- Bedienung */

test('ein Lauf über die Oberfläche liefert Fortschritt, Fehlertexte und Report', async () => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
  const page = await context.newPage();
  const consoleErrors = [];
  page.on('pageerror', (error) => consoleErrors.push(String(error)));
  page.on('console', (message) => message.type() === 'error' && consoleErrors.push(message.text()));

  await page.goto(`${base}/`, { waitUntil: 'load' });
  await page.waitForSelector('html.js-ready');

  // [hidden] muss trotz eigener display-Regeln greifen.
  assert.equal(await page.locator('#quality-field').isVisible(), false, 'JPEG-Qualität gehört zu PNG versteckt');
  assert.equal(await page.locator('#cancel').isVisible(), false, 'Abbrechen erscheint erst während eines Laufs');
  assert.equal(await page.locator('#run').isVisible(), false, 'der Laufbereich ist anfangs leer');

  // Umschalten auf JPEG blendet das Qualitätsfeld ein und aktiviert es.
  await page.selectOption('#format', 'jpeg');
  assert.equal(await page.locator('#quality-field').isVisible(), true);
  assert.equal(await page.locator('#quality').isDisabled(), false);
  await page.selectOption('#format', 'png');
  assert.equal(await page.locator('#quality').isDisabled(), true, 'unbenutzte Felder blockieren sonst das Absenden');

  const dead = await freePort(); // sicher geschlossen
  await page.fill(
    '#urls',
    [`${fixture.origin}/short`, `${fixture.origin}/missing`, `http://127.0.0.1:${dead}/tot`].join('\n'),
  );
  assert.equal(await page.textContent('#url-count'), '3 URLs');

  await page.selectOption('#preset', 'laptop');
  await page.fill('#title', 'Oberflächen-Test');
  await page.click('#start');

  await page.waitForSelector('#run:not([hidden])');
  await page.waitForFunction(
    () => document.getElementById('run-title').textContent.trim() !== 'Läuft …',
    null,
    { timeout: 120000 },
  );

  assert.equal((await page.textContent('#run-title')).trim(), 'Fertig');
  assert.equal(await page.locator('.result').count(), 3);
  assert.equal(await page.locator('.result--error').count(), 2, '404 und toter Port sind beide Fehler');

  const hint = await page.locator('.result__hint').first().textContent();
  assert.match(hint, /Läuft der Server und stimmt der Port/);

  const summary = await page.textContent('#run-summary');
  assert.match(summary, /1 erfolgreich/);
  assert.match(summary, /2 fehlgeschlagen/);

  // Der Report ist über den Server erreichbar.
  assert.equal(await page.locator('#run-footer').isVisible(), true);
  const report = await fetch(`${base}/report/`);
  const html = await report.text();
  assert.equal(report.status, 200);
  assert.ok(html.includes('id="shots-table"'));
  assert.ok(html.includes('Oberflächen-Test'), 'der Titel aus dem Formular fehlt im Report');

  const image = await fetch(`${base}/report/screenshots/001-127-0-0-1-short.png`);
  assert.equal(image.status, 200);
  assert.equal(image.headers.get('content-type'), 'image/png');

  assert.deepEqual(consoleErrors, [], `Konsolenfehler: ${consoleErrors.join(' | ')}`);
  await context.close();
});

test('Pfad-Traversal über /report/ wird abgewehrt', async () => {
  const port = Number(new URL(base).port);

  // Zwei Verteidigungslinien: die URL-Normalisierung entfernt ".." bereits
  // (der Pfad landet dann ausserhalb von /report und endet in 404), und die
  // prozentkodierte Variante fängt resolveWithin ab (400). Entscheidend ist,
  // dass in keinem Fall eine Systemdatei herauskommt.
  const attempts = [
    '/report/../../../../etc/passwd',
    '/report/%2e%2e%2f%2e%2e%2f%2e%2e%2f%2e%2e%2fetc/passwd',
    '/report/..%2f..%2f..%2f..%2fetc/passwd',
    '/report/screenshots/../../../../etc/passwd',
  ];

  for (const attempt of attempts) {
    const raw = await rawGet(port, attempt, '127.0.0.1');
    assert.ok([400, 404].includes(raw.status), `${attempt} sollte abgelehnt werden, war ${raw.status}`);
    assert.ok(!raw.body.includes('root:'), `${attempt} hat eine Systemdatei ausgeliefert`);
  }
});

test('ein zweiter Lauf wird abgelehnt, solange einer läuft, und Abbrechen greift', async () => {
  const slow = Array.from({ length: 6 }, () => `${fixture.origin}/slow`).join('\n');
  const urls = `${fixture.origin}/slow\n${fixture.origin}/short\n${fixture.origin}/tall\n${slow}`;

  const started = await api('/api/run', postJson({ urls, options: { concurrency: 1, thumbnails: false } }));
  assert.equal(started.status, 202);

  const second = await api('/api/run', postJson({ urls: 'https://a.example' }));
  assert.equal(second.status, 400);
  assert.match(second.payload.error, /läuft bereits/);

  const cancelled = await api('/api/cancel', postJson({}));
  assert.equal(cancelled.status, 200);
  assert.equal(cancelled.payload.cancelled, true);

  let state = null;
  for (let attempt = 0; attempt < 120; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    state = (await api('/api/state')).payload.run;
    if (state.status !== 'running') break;
  }

  assert.equal(state.status, 'cancelled');
  assert.ok(state.done < 3, `es sollten nicht alle Seiten erfasst worden sein (${state.done})`);
  assert.equal((await api('/api/cancel', postJson({}))).payload.cancelled, false, 'ohne Lauf gibt es nichts abzubrechen');
});
