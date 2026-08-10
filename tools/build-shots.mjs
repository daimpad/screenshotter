/**
 * Erzeugt die Bilder für Vorschauseite und README unter docs/*.jpg.
 *
 *   npm run demo:bilder
 *
 * Vorher `npm run demo` laufen lassen: die drei Report-Bilder fotografieren
 * docs/demo/index.html, und ein alter Demo-Report ergäbe alte Bilder.
 *
 * Die Weboberfläche wird für die beiden anderen Bilder wirklich gestartet und
 * bedient — deshalb stimmen Versionsnummer, Beschriftungen und Ergebnisliste
 * darin immer mit dem aktuellen Stand überein.
 */
import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { launchBrowser } from '../lib/capture.js';
import { DEMO_PAGES, startDemoSite } from './build-demo.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const DOCS = path.join(ROOT, 'docs');
const DEMO = path.join(DOCS, 'demo', 'index.html');

// Maße wie bisher, damit Vorschauseite und README ihr Layout behalten.
const REPORT_VIEWPORT = { width: 1280, height: 820 };
const UI_VIEWPORT = { width: 1180, height: 760 };
const UI_RUN_VIEWPORT = { width: 1180, height: 900 };
const QUALITY = 88;

/** Einen garantiert freien Port ermitteln (kurz binden, wieder freigeben). */
async function freePort() {
  const probe = http.createServer();
  await new Promise((resolve) => probe.listen(0, '127.0.0.1', resolve));
  const { port } = probe.address();
  await new Promise((resolve) => probe.close(resolve));
  return port;
}

async function shoot(page, name) {
  const file = path.join(DOCS, name);
  await page.screenshot({ path: file, type: 'jpeg', quality: QUALITY });
  console.log('  ', name);
}

/** Die drei Report-Bilder: Tabelle, Galerie, dunkles Farbschema. */
async function reportShots(browser) {
  const context = await browser.newContext({ viewport: REPORT_VIEWPORT });
  const page = await context.newPage();

  await page.goto(pathToFileURL(DEMO).href, { waitUntil: 'load' });
  await page.waitForSelector('html.js-ready');
  // Die Vorschaubilder müssen geladen sein, sonst zeigt das Bild leere Kästen.
  await page.waitForFunction(() => Array.from(document.images).every((img) => img.complete));

  await shoot(page, 'report-tabelle.jpg');

  await page.locator('.chip[data-view="grid"]').click();
  await shoot(page, 'report-galerie.jpg');

  // Zurück in die Tabelle: das dunkle Bild soll dieselbe Ansicht zeigen.
  await page.locator('.chip[data-view="table"]').click();
  // Der Umschalter läuft System → Hell → Dunkel, also zweimal klicken.
  await page.locator('#theme-toggle').click();
  await page.locator('#theme-toggle').click();
  await page.waitForFunction(() => document.documentElement.getAttribute('data-theme') === 'dark');
  await shoot(page, 'report-dunkel.jpg');

  await context.close();
}

/** Die beiden Bilder der Weboberfläche: Formular und abgeschlossener Lauf. */
async function uiShots(browser, siteOrigin) {
  // Der Lauf schreibt echte Dateien. Ein eigenes Verzeichnis als
  // Arbeitsordner heißt: im Formular steht ein schlichtes "." und im
  // Projektordner landet nichts.
  const workDir = await mkdtemp(path.join(os.tmpdir(), 'screenshotter-shots-'));
  await writeFile(path.join(workDir, 'urls.txt'), '');

  const port = await freePort();
  const server = spawn(
    process.execPath,
    [path.join(ROOT, 'screenshotter.js'), '--serve', '--port', String(port), '--no-proxy'],
    { cwd: workDir, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, NO_COLOR: '1' } },
  );

  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Server startet nicht')), 20_000);
      server.stdout.on('data', (chunk) => {
        if (String(chunk).includes(String(port))) {
          clearTimeout(timer);
          resolve();
        }
      });
      server.on('close', (code) => reject(new Error(`Server beendet mit Code ${code}`)));
    });

    const context = await browser.newContext({ viewport: UI_VIEWPORT });
    const page = await context.newPage();
    await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'load' });

    const urls = DEMO_PAGES.slice(0, 4).map((entry) => `${siteOrigin}${entry}`);
    urls.push(`${siteOrigin}/gibtsnicht`);

    await page.fill('#urls', urls.join('\n'));
    await page.fill('#title', 'Nordlicht Studio — Abnahme');
    // Blur, damit kein Feld einen Fokusrahmen trägt.
    await page.locator('h1').click();
    await shoot(page, 'oberflaeche.jpg');

    await page.setViewportSize(UI_RUN_VIEWPORT);
    await page.locator('#start').click();
    // Warten, bis der Lauf fertig ist: dann stehen Fortschrittsbalken,
    // Ergebnisliste und Zusammenfassung gleichzeitig im Bild.
    await page.waitForSelector('#run-footer:not([hidden])', { timeout: 120_000 });
    // Ans Seitenende: so stehen Ergebnisliste und Fußzeile mit der
    // Versionsnummer zusammen im Bild. Über scrollingElement, weil body hier
    // nicht der Scrollcontainer ist — window.scrollTo(0, body.scrollHeight)
    // bewegt die Seite deshalb keinen Pixel.
    await page.evaluate(() => {
      const scroller = document.scrollingElement || document.documentElement;
      scroller.scrollTop = scroller.scrollHeight;
    });
    await page.waitForFunction(() => {
      const scroller = document.scrollingElement || document.documentElement;
      return scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 2;
    });
    await shoot(page, 'oberflaeche-lauf.jpg');

    await context.close();
  } finally {
    server.kill();
    await rm(workDir, { recursive: true, force: true });
  }
}

const site = await startDemoSite();
console.log('Beispielseiten:', site.origin);

const browser = await launchBrowser({ proxy: '' });
try {
  console.log('Bilder:');
  await reportShots(browser);
  await uiShots(browser, site.origin);
} finally {
  await browser.close();
  await site.close();
}

console.log(`\nBilder liegen in ${DOCS}`);
