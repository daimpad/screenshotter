/**
 * End-to-End-Test: kompletter CLI-Lauf gegen einen lokalen Testserver,
 * danach Prüfung des erzeugten Reports im echten Browser.
 *
 *   node --test test/e2e.test.js
 *
 * Benötigt einen installierten Chromium ("npx playwright install chromium").
 */

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { after, before, test } from 'node:test';

import { launchBrowser } from '../lib/capture.js';
import { pngSize, reservedDeadOrigin, startServer } from './fixtures/server.js';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const CLI = path.join(ROOT, 'screenshotter.js');

let server;
let outDir;
let run;
let report;
let browser;

function runCli(args, cwd) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [CLI, ...args], {
      cwd,
      env: { ...process.env, NO_COLOR: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => (stdout += chunk));
    child.stderr.on('data', (chunk) => (stderr += chunk));
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

before(async () => {
  server = await startServer();
  const deadOrigin = await reservedDeadOrigin();
  outDir = await mkdtemp(path.join(os.tmpdir(), 'screenshotter-e2e-'));

  run = await runCli(
    [
      '--out',
      outDir,
      '--no-proxy',
      '--retries',
      '0',
      '--delay',
      '100',
      '--timeout',
      '15000',
      '--width',
      '800',
      '--height',
      '600',
      '--thumb-width',
      '320',
      '--thumb-height',
      '240',
      '--title',
      'E2E Report',
      `${server.origin}/tall`,
      `${server.origin}/short`,
      `${server.origin}/redirect`,
      `${server.origin}/missing`,
      `${server.origin}/quotes`,
      `${deadOrigin}/tot`,
    ],
    ROOT,
  );

  report = JSON.parse(await readFile(path.join(outDir, 'report.json'), 'utf8'));
  browser = await launchBrowser({});
}, { timeout: 180000 });

after(async () => {
  await browser?.close().catch(() => {});
  await server?.close();
  if (outDir) await rm(outDir, { recursive: true, force: true });
});

test('CLI endet mit Exit-Code 1, weil URLs fehlschlagen', () => {
  assert.equal(run.code, 1, `stdout:\n${run.stdout}\nstderr:\n${run.stderr}`);
  assert.match(run.stdout, /Fertig in/);
  // 404 und Verbindungsfehler zählen beide als Fehler.
  assert.match(run.stdout, /2 fehlgeschlagen/);
  assert.match(run.stdout, /Fehlgeschlagen \(2\):/, 'Fehlerliste am Ende fehlt');
  // CLI-URLs haben Vorrang: die urls.txt des Projekts darf nicht mitgelesen werden.
  assert.match(run.stdout, /6 URL\(s\) aus CLI-Argumente\b/);
  assert.ok(!run.stdout.includes('urls.txt'), 'Standard-Eingabedatei wurde fälschlich mitgelesen');
});

test('alle erwarteten Dateien werden erzeugt', async () => {
  // logo.svg und die beiden Markenschnitte gehören dazu: Favicon, Fußzeile und
  // report.css verweisen darauf. Wird eines beim Kopieren vergessen, bleibt der
  // Fehler still — der Report sieht dann nur falsch aus.
  for (const relative of [
    'index.html',
    'report.json',
    'assets/report.css',
    'assets/report.js',
    'assets/logo.svg',
    'assets/fonts/ZillaSlab-Bold.woff2',
    'assets/fonts/SpaceMono-Bold.woff2',
  ]) {
    assert.ok(existsSync(path.join(outDir, relative)), `fehlt: ${relative}`);
  }

  const shots = await readdir(path.join(outDir, 'screenshots'));
  const images = shots.filter((name) => name.endsWith('.png'));
  assert.equal(images.length, 5, `erwartet 5 Screenshots, bekam ${images.join(', ')}`);

  // Die Hilfsdateien der Thumbnail-Erzeugung müssen wieder weg sein.
  assert.deepEqual(shots.filter((name) => name.startsWith('.thumb-')), []);

  const thumbs = (await readdir(path.join(outDir, 'screenshots', 'thumbs'))).filter((n) => n.endsWith('.png'));
  assert.equal(thumbs.length, 5);
});

test('Full-Page-Screenshot ist höher als der Viewport und enthält Lazy-Inhalte', async () => {
  const tall = report.results.find((result) => result.url.endsWith('/tall'));
  assert.ok(tall, 'Ergebnis für /tall fehlt');
  assert.equal(tall.status, 200);

  const buffer = await readFile(path.join(outDir, tall.file));
  const size = pngSize(buffer);

  assert.equal(size.width, 800, 'Screenshotbreite entspricht dem Viewport');
  assert.ok(size.height > 600, `Full-Page erwartet, bekam ${size.height}px`);
  assert.equal(size.height, tall.pageHeight, 'Bildhöhe entspricht der gemessenen Dokumenthöhe');
  // 3 Blöcke à 600px + Kopf/Abschnitte, plus der erst beim Scrollen geladene Block.
  assert.ok(size.height > 2400, `Lazy-Inhalt fehlt vermutlich (${size.height}px)`);
});

test('Viewport-Screenshot einer kurzen Seite bleibt bei der Viewporthöhe', async () => {
  const short = report.results.find((result) => result.url.endsWith('/short'));
  const size = pngSize(await readFile(path.join(outDir, short.file)));
  assert.equal(size.width, 800);
  assert.ok(size.height <= 600, `kurze Seite sollte <= 600px sein, war ${size.height}px`);
});

test('Thumbnails haben exakt die angeforderte Größe', async () => {
  const withThumb = report.results.filter((result) => result.thumb);
  assert.equal(withThumb.length, 5);

  for (const result of withThumb) {
    const size = pngSize(await readFile(path.join(outDir, result.thumb)));
    assert.deepEqual(size, { width: 320, height: 240 }, `falsche Thumbnailgröße für ${result.url}`);
  }
});

test('Status, Weiterleitung und Netzwerkfehler werden korrekt erfasst', () => {
  const byPath = Object.fromEntries(report.results.map((result) => [new URL(result.url).pathname, result]));

  assert.equal(byPath['/short'].state, 'ok');
  assert.equal(byPath['/missing'].status, 404);
  assert.equal(byPath['/missing'].state, 'error');
  assert.ok(byPath['/missing'].file, 'auch 404-Seiten werden abfotografiert');

  // Playwright folgt der Weiterleitung: Endstatus 200, aber die Ziel-URL weicht ab.
  assert.equal(byPath['/redirect'].status, 200);
  assert.ok(byPath['/redirect'].finalUrl.endsWith('/short'));
  assert.equal(byPath['/redirect'].state, 'redirect', 'gefolgte Weiterleitung muss als solche erkannt werden');

  const dead = byPath['/tot'];
  assert.equal(dead.state, 'error');
  assert.equal(dead.file, null);
  assert.equal(dead.status, null);
  assert.ok(dead.error && dead.error.length > 0);
});

test('report.json enthält Metadaten und keine Proxy-Angaben', () => {
  assert.match(report.generator, /^screenshotter v/);
  assert.ok(Date.parse(report.generatedAt));
  assert.equal(report.stats.total, 6);
  assert.equal(report.stats.error, 2); // 404 + Verbindungsfehler
  assert.equal(report.stats.redirect, 1);
  assert.equal(report.stats.ok, 3);
  assert.equal(report.options.width, 800);
  assert.equal(report.options.fullPage, true);
  assert.ok(!('proxy' in report.options), 'Proxy-URL darf nicht im Report landen');
});

test('index.html rendert beide Tabellen serverseitig (funktioniert ohne JS)', async () => {
  const html = await readFile(path.join(outDir, 'index.html'), 'utf8');

  assert.match(html, /<html lang="de">/);
  assert.match(html, /<title>E2E Report<\/title>/);
  for (const heading of ['URL', 'Statuscode', 'Zeitstempel', 'Dateiname']) {
    assert.ok(html.includes(`>${heading}</th>`), `Spalte "${heading}" fehlt in der Zusammenfassung`);
  }
  assert.equal(html.match(/<tr data-state="/g).length, 12, '6 Galerie- + 6 Zusammenfassungszeilen erwartet');
});

test('ein Seitentitel kann nicht aus dem HTML ausbrechen', async () => {
  const html = await readFile(path.join(outDir, 'index.html'), 'utf8');

  // Der Fixture-Titel ist ein echter Ausbruchsversuch: "><img src=x onerror=...>
  assert.ok(html.includes('&quot;&gt;&lt;img src=x onerror=alert(1)&gt;'), 'Titel nicht escaped');
  assert.ok(!html.includes('"><img src=x'), 'roher Ausbruchsversuch im HTML gefunden');
  assert.ok(!/<img[^>]*onerror/i.test(html), 'eingeschleustes img-Element im HTML');

  // Und im Browser darf daraus kein Element werden.
  const context = await browser.newContext();
  const page = await context.newPage();
  const alarme = [];
  page.on('dialog', (dialog) => { alarme.push(dialog.message()); dialog.dismiss(); });
  page.on('pageerror', (error) => alarme.push(String(error)));

  await page.goto(pathToFileURL(path.join(outDir, 'index.html')).href, { waitUntil: 'load' });
  await page.waitForSelector('html.js-ready');

  const eingeschleust = await page.evaluate(
    () => document.querySelectorAll('img[onerror], img[src="x"]').length,
  );
  assert.equal(eingeschleust, 0, 'der Titel hat ein Element erzeugt');
  assert.deepEqual(alarme, [], `unerwartete Reaktion: ${alarme.join(' | ')}`);

  // Der Titel muss trotzdem als Text ankommen.
  const sichtbar = await page.locator('.page-title').allTextContents();
  assert.ok(sichtbar.some((text) => text.includes('<img src=x onerror=alert(1)>')), 'Titel fehlt in der Anzeige');

  await context.close();
});

test('Report ist im Browser bedienbar: Sortierung, Filter, Suche, Lightbox', async () => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  const consoleErrors = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => consoleErrors.push(String(error)));

  await page.goto(pathToFileURL(path.join(outDir, 'index.html')).href, { waitUntil: 'load' });
  await page.waitForSelector('html.js-ready');

  const rowSelector = '#shots-table tbody tr:not(.empty-row)';
  assert.equal(await page.locator(rowSelector).count(), 6);

  // Standard: alphabetisch nach URL sortiert.
  const urls = await page.locator(`${rowSelector} .page-url`).allTextContents();
  assert.deepEqual(urls, [...urls].sort((a, b) => a.localeCompare(b, 'de')), 'Galerie ist nicht vorsortiert');

  // Sortierung über den Spaltenkopf "Status".
  await page.locator('#shots-table th', { hasText: 'Status' }).click();
  const statuses = (await page.locator(`${rowSelector} .badge`).allTextContents()).map((text) => text.trim());
  const numeric = statuses.map((text) => (/^\d+$/.test(text) ? Number(text) : 999));
  assert.deepEqual(numeric, [...numeric].sort((a, b) => a - b), `Statussortierung falsch: ${statuses.join(',')}`);

  // Statusfilter.
  await page.locator('.chip[data-filter="error"]').click();
  assert.equal(await page.locator(`${rowSelector}:visible`).count(), 2);
  await page.locator('.chip[data-filter="all"]').click();
  assert.equal(await page.locator(`${rowSelector}:visible`).count(), 6);

  // Volltextsuche.
  await page.fill('#search', 'quotes');
  assert.equal(await page.locator(`${rowSelector}:visible`).count(), 1);
  await page.fill('#search', 'gibtesnicht');
  assert.equal(await page.locator(`${rowSelector}:visible`).count(), 0);
  assert.ok(await page.locator('#no-results').isVisible(), 'Leermeldung fehlt');
  await page.fill('#search', '');

  // Lightbox öffnen, blättern, schließen.
  await page.locator('a.shot-link').first().click();
  const lightbox = page.locator('#lightbox');
  await lightbox.waitFor({ state: 'visible' });
  assert.match(await lightbox.locator('.lightbox__counter').textContent(), /^1 \/ 5$/);

  const firstSource = await lightbox.locator('.lightbox__img').getAttribute('src');
  await lightbox.locator('[data-lb="next"]').click();
  const secondSource = await lightbox.locator('.lightbox__img').getAttribute('src');
  assert.notEqual(firstSource, secondSource, 'Weiterblättern hat das Bild nicht gewechselt');
  assert.match(await lightbox.locator('.lightbox__counter').textContent(), /^2 \/ 5$/);

  await page.keyboard.press('ArrowLeft');
  assert.equal(await lightbox.locator('.lightbox__img').getAttribute('src'), firstSource);

  await page.keyboard.press('Escape');
  await lightbox.waitFor({ state: 'hidden' });

  // Zoom: die lange Seite wird eingepasst dargestellt, ein Klick zeigt sie in
  // Originalgröße (nur dort messbar — kurze Bilder passen ohnehin ins Fenster).
  await page.locator('a.shot-link[href*="tall"]').click();
  await lightbox.waitFor({ state: 'visible' });
  const image = lightbox.locator('.lightbox__img');

  // Die eingepasste Größe entsteht rein über CSS (max-width/max-height) und
  // steht erst, wenn das PNG geladen ist — vorher misst boundingBox() 0 und
  // der Vergleich unten hätte keinen Bezugswert. Lokal liegt die Datei im
  // Cache und lädt binnen eines Frames, auf einem kalten Läufer nicht.
  await page.waitForFunction(
    () => {
      const element = document.querySelector('#lightbox .lightbox__img');
      return Boolean(element) && element.getBoundingClientRect().width > 0;
    },
    null,
    { timeout: 10_000 },
  );

  const fitted = (await image.boundingBox()).width;
  await image.click({ position: { x: 5, y: 5 } });
  const zoomed = (await image.boundingBox()).width;
  assert.ok(zoomed > fitted, `Zoom hat das Bild nicht vergrößert (${fitted} -> ${zoomed})`);
  await image.click({ position: { x: 5, y: 5 } });
  assert.equal(Math.round((await image.boundingBox()).width), Math.round(fitted));

  // Klick auf den Hintergrund schließt.
  await page.locator('.lightbox__stage').click({ position: { x: 5, y: 5 } });
  await lightbox.waitFor({ state: 'hidden' });

  // Theme-Umschalter.
  await page.locator('#theme-toggle').click();
  assert.equal(await page.locator('html').getAttribute('data-theme'), 'light');
  await page.locator('#theme-toggle').click();
  assert.equal(await page.locator('html').getAttribute('data-theme'), 'dark');

  assert.deepEqual(consoleErrors, [], `Konsolenfehler im Report: ${consoleErrors.join(' | ')}`);
  await context.close();
});

test('Kartenlayout auf schmalen Viewports: Vorschau sichtbar, Filter wirksam', async () => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  await page.goto(pathToFileURL(path.join(outDir, 'index.html')).href, { waitUntil: 'load' });
  await page.waitForSelector('html.js-ready');

  // Die Vorschau darf nicht auf die Tabellenbreite von 1% zusammenfallen.
  const box = await page.locator('a.shot-link').first().boundingBox();
  assert.ok(box && box.width > 200, `Vorschaubild zu schmal: ${box?.width}px`);
  assert.ok(box.height > 120, `Vorschaubild zu flach: ${box?.height}px`);

  // `display: grid` auf der Zeile darf [hidden] nicht aushebeln.
  const rows = '#shots-table tbody tr:not(.empty-row)';
  await page.locator('.chip[data-filter="error"]').click();
  assert.equal(await page.locator(`${rows}:visible`).count(), 2);
  assert.equal(await page.locator('#no-results').isVisible(), false);

  await page.locator('.chip[data-filter="all"]').click();
  await page.fill('#search', 'gibtesnicht');
  assert.equal(await page.locator(`${rows}:visible`).count(), 0);
  assert.equal(await page.locator('#no-results').isVisible(), true);

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  assert.equal(overflow, 0, 'die Seite darf horizontal nicht überlaufen');
  await context.close();
});

test('--no-report und --no-thumbnails erzeugen nur Bilder', async () => {
  const bare = await mkdtemp(path.join(os.tmpdir(), 'screenshotter-bare-'));
  try {
    const result = await runCli(
      ['--out', bare, '--no-proxy', '--no-report', '--no-thumbnails', '--retries', '0', `${server.origin}/short`],
      ROOT,
    );

    assert.equal(result.code, 0, result.stderr);
    assert.ok(!existsSync(path.join(bare, 'index.html')));
    assert.ok(!existsSync(path.join(bare, 'screenshots', 'thumbs')));
    assert.equal((await readdir(path.join(bare, 'screenshots'))).length, 1);
  } finally {
    await rm(bare, { recursive: true, force: true });
  }
});

test('fehlende Eingabedatei liefert Exit-Code 2 mit Hinweis', async () => {
  const empty = await mkdtemp(path.join(os.tmpdir(), 'screenshotter-empty-'));
  try {
    const result = await runCli(['--input', path.join(empty, 'fehlt.txt'), '--out', empty], empty);
    assert.equal(result.code, 2);
    assert.match(result.stderr, /nicht gefunden/i);
  } finally {
    await rm(empty, { recursive: true, force: true });
  }
});

test('Fehlerzeilen zeigen Klartext plus Lösungshinweis', async () => {
  const html = await readFile(path.join(outDir, 'index.html'), 'utf8');

  assert.ok(html.includes('Server nimmt keine Verbindung an'), 'Klartextmeldung fehlt im Report');
  assert.ok(html.includes('class="page-hint"'), 'Hinweiszeile fehlt im Report');

  const dead = report.results.find((result) => result.file === null);
  assert.equal(dead.errorCode, 'ERR_CONNECTION_REFUSED');
  assert.equal(dead.error, 'Server nimmt keine Verbindung an');
  assert.ok(dead.errorHint.length > 0);
  assert.ok(dead.errorRaw.includes('ERR_CONNECTION_REFUSED'), 'Rohmeldung bleibt für die Fehlersuche erhalten');
});

test('Galerie-Ansicht: Umschalter ordnet die Zeilen als Karten an', async () => {
  const context = await browser.newContext({ viewport: { width: 1440, height: 950 } });
  const page = await context.newPage();
  await page.goto(pathToFileURL(path.join(outDir, 'index.html')).href, { waitUntil: 'load' });
  await page.waitForSelector('html.js-ready');

  const rows = '#shots-table tbody tr:not(.empty-row)';
  const tableWidth = (await page.locator(rows).first().boundingBox()).width;

  await page.locator('.chip[data-view="grid"]').click();
  await page.waitForTimeout(200);

  const cardWidth = (await page.locator(rows).first().boundingBox()).width;
  assert.ok(cardWidth < tableWidth / 2, `Karte sollte deutlich schmaler sein (${cardWidth} vs ${tableWidth})`);
  assert.equal(await page.locator('#shots-card').evaluate((el) => el.classList.contains('view-grid')), true);
  assert.equal(await page.locator('.chip[data-view="grid"]').getAttribute('aria-pressed'), 'true');

  // Filter müssen auch in der Galerie greifen.
  await page.locator('.chip[data-filter="error"]').click();
  assert.equal(await page.locator(`${rows}:visible`).count(), 2);
  await page.locator('.chip[data-filter="all"]').click();

  // Die Wahl überlebt einen Neuaufbau der Seite.
  await page.reload({ waitUntil: 'load' });
  await page.waitForSelector('html.js-ready');
  assert.equal(await page.locator('#shots-card').evaluate((el) => el.classList.contains('view-grid')), true);

  await context.close();
});

test('Werkzeugleiste klebt oben und überdeckt die Tabellenkopfzeile nicht', async () => {
  const context = await browser.newContext({ viewport: { width: 1440, height: 700 } });
  const page = await context.newPage();
  await page.goto(pathToFileURL(path.join(outDir, 'index.html')).href, { waitUntil: 'load' });
  await page.waitForSelector('html.js-ready');

  await page.evaluate(() => window.scrollTo({ top: 1200, behavior: 'instant' }));
  await page.waitForTimeout(150);

  const geometry = await page.evaluate(() => {
    const toolbar = document.querySelector('.toolbar').getBoundingClientRect();
    const head = document.querySelector('#shots-table thead th').getBoundingClientRect();
    const table = document.getElementById('shots-table').getBoundingClientRect();
    return {
      toolbarTop: Math.round(toolbar.top),
      toolbarBottom: Math.round(toolbar.bottom),
      headTop: Math.round(head.top),
      tableTop: Math.round(table.top),
    };
  });

  assert.ok(geometry.tableTop < -100, 'Testaufbau: die Tabelle muss aus dem Viewport gescrollt sein');

  assert.ok(Math.abs(geometry.toolbarTop) <= 1, `Werkzeugleiste klebt nicht (top=${geometry.toolbarTop})`);
  assert.ok(
    Math.abs(geometry.headTop - geometry.toolbarBottom) <= 2,
    `Kopfzeile sitzt nicht bündig unter der Leiste (${geometry.headTop} vs ${geometry.toolbarBottom})`,
  );

  await context.close();
});

test('Taste "/" springt in die Suche, Escape leert sie wieder', async () => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  await page.goto(pathToFileURL(path.join(outDir, 'index.html')).href, { waitUntil: 'load' });
  await page.waitForSelector('html.js-ready');

  const rows = '#shots-table tbody tr:not(.empty-row)';
  await page.keyboard.press('/');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'search');

  await page.keyboard.type('quotes');
  await page.waitForTimeout(150);
  assert.equal(await page.locator(`${rows}:visible`).count(), 1);
  // Das "/" selbst darf nicht im Feld landen.
  assert.equal(await page.inputValue('#search'), 'quotes');

  await page.keyboard.press('Escape');
  await page.waitForTimeout(150);
  assert.equal(await page.inputValue('#search'), '');
  assert.equal(await page.locator(`${rows}:visible`).count(), 6);

  await context.close();
});

test('--init legt eine Vorlage an und überschreibt eine vorhandene Datei nicht', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'screenshotter-init-'));
  try {
    const first = await runCli(['--init', '--input', path.join(dir, 'urls.txt')], dir);
    assert.equal(first.code, 0, first.stderr);
    assert.match(first.stdout, /angelegt/);

    const template = await readFile(path.join(dir, 'urls.txt'), 'utf8');
    assert.match(template, /^# urls\.txt/);
    assert.match(template, /https:\/\/example\.com/);

    await writeFile(path.join(dir, 'urls.txt'), 'https://meine.example\n', 'utf8');
    const second = await runCli(['--init', '--input', path.join(dir, 'urls.txt')], dir);
    assert.equal(second.code, 0);
    assert.match(second.stdout, /gibt es schon/);
    assert.equal(await readFile(path.join(dir, 'urls.txt'), 'utf8'), 'https://meine.example\n');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('--preset mobile nimmt in Smartphone-Breite auf', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'screenshotter-preset-'));
  try {
    const result = await runCli(
      [
        '--out',
        dir,
        '--no-proxy',
        '--preset',
        'mobile',
        '--retries',
        '0',
        '--no-thumbnails',
        `${server.origin}/short`,
        `${server.origin}/legacy`,
      ],
      ROOT,
    );
    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stdout, /Smartphone 390×844 @2x/);

    const data = JSON.parse(await readFile(path.join(dir, 'report.json'), 'utf8'));
    assert.equal(data.options.preset, 'mobile');

    // Responsive Seite: 390 CSS-Pixel bei deviceScaleFactor 2 ergeben 780 Bildpunkte.
    const responsive = data.results.find((entry) => entry.url.endsWith('/short'));
    assert.equal(pngSize(await readFile(path.join(dir, responsive.file))).width, 780);

    // Ohne Viewport-Meta legt Chromium im Mobil-Modus 980 CSS-Pixel zugrunde —
    // dasselbe Verhalten wie auf einem echten Smartphone.
    const legacy = data.results.find((entry) => entry.url.endsWith('/legacy'));
    assert.equal(pngSize(await readFile(path.join(dir, legacy.file))).width, 1960);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
