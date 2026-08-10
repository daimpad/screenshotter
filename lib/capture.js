/** Screenshot engine: launches Chromium once and captures every target page. */

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, rm, stat, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { diagnose } from './diagnose.js';
import { UserError } from './errors.js';

/** CSS injected before the shot so animations/carets cannot blur the result. */
const STABILIZE_CSS = `
*, *::before, *::after {
  animation-delay: -0.0001s !important;
  animation-duration: 0s !important;
  animation-iteration-count: 1 !important;
  transition-delay: 0s !important;
  transition-duration: 0s !important;
  caret-color: transparent !important;
}
html { scroll-behavior: auto !important; }
`;

/** Fallback binaries tried when Playwright's own browser download is missing. */
const BROWSER_FALLBACKS = [
  process.env.PLAYWRIGHT_BROWSERS_PATH ? path.join(process.env.PLAYWRIGHT_BROWSERS_PATH, 'chromium') : null,
  '/opt/pw-browsers/chromium',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].filter(Boolean);

/** Build a stable, filesystem-safe file name for a URL. */
export function fileNameFor(url, index, extension) {
  let slug = '';
  try {
    const parsed = new URL(url);
    slug = `${parsed.hostname}${parsed.pathname}${parsed.search}`;
  } catch {
    slug = String(url);
  }
  slug = slug
    .toLowerCase()
    .replace(/^www\./, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
    .replace(/-+$/g, '');
  if (!slug) slug = 'seite';
  return `${String(index + 1).padStart(3, '0')}-${slug}.${extension}`;
}

/**
 * Run `worker` over `items` with at most `limit` running at the same time.
 *
 * Ein ausgelöstes `signal` stoppt die Vergabe neuer Aufgaben; bereits laufende
 * dürfen zu Ende gehen. Deren Plätze bleiben leer, damit kein halb erfasstes
 * Ergebnis in den Report rutscht.
 */
export async function runPool(items, limit, worker, signal) {
  const results = new Array(items.length);
  let cursor = 0;

  const runners = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    for (;;) {
      if (signal?.aborted) return;
      const index = cursor++;
      if (index >= items.length) return;
      results[index] = await worker(items[index], index);
    }
  });

  await Promise.all(runners);
  return results;
}

async function importPlaywright() {
  try {
    return await import('playwright');
  } catch {
    throw new UserError('Playwright ist nicht installiert.', {
      hint: 'Bitte "npm install" und danach "npx playwright install chromium" ausführen.',
    });
  }
}

/**
 * Kommando, das Playwrights Chromium nachinstalliert. Die Datei cli.js steht
 * nicht in den package-exports, deshalb der Umweg über die package.json.
 */
export function chromiumInstallCommand() {
  const require = createRequire(import.meta.url);
  const packageJson = require.resolve('playwright/package.json');
  return { command: process.execPath, args: [path.join(path.dirname(packageJson), 'cli.js'), 'install', 'chromium'] };
}

/** Soll der Browser bei Bedarf automatisch geholt werden? */
export function shouldAutoInstall() {
  return process.env.PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD !== '1' && process.env.SCREENSHOTTER_NO_INSTALL !== '1';
}

async function installChromium() {
  let spec;
  try {
    spec = chromiumInstallCommand();
  } catch {
    return false;
  }

  return new Promise((resolve) => {
    const child = spawn(spec.command, spec.args, { stdio: 'inherit' });
    child.on('close', (code) => resolve(code === 0));
    child.on('error', () => resolve(false));
  });
}

export async function launchBrowser({ browserPath = '', sandbox = true, proxy = '', onSetup = () => {} } = {}) {
  const { chromium } = await importPlaywright();

  const args = ['--hide-scrollbars', '--disable-dev-shm-usage', '--force-color-profile=srgb'];
  if (!sandbox) args.push('--no-sandbox', '--disable-setuid-sandbox');

  const proxyOption = proxy
    ? {
        proxy: {
          server: proxy,
          bypass: ['localhost', '127.0.0.1', '::1', ...(process.env.NO_PROXY ?? process.env.no_proxy ?? '').split(',')]
            .map((entry) => entry.trim())
            .filter(Boolean)
            .join(','),
        },
      }
    : {};

  // Ein ausdrücklich gesetzter Pfad gewinnt; sonst zuerst Playwrights eigener
  // Download, danach übliche Systempfade.
  const explicit = browserPath || process.env.SCREENSHOTTER_CHROMIUM || '';
  const attempts = explicit ? [explicit] : [null, ...BROWSER_FALLBACKS.filter((candidate) => existsSync(candidate))];

  const tryLaunch = async () => {
    let lastError = null;
    for (const executablePath of attempts) {
      try {
        return { browser: await chromium.launch({ args, ...proxyOption, ...(executablePath ? { executablePath } : {}) }) };
      } catch (error) {
        lastError = error;
      }
    }
    return { error: lastError };
  };

  let result = await tryLaunch();
  if (result.browser) return result.browser;

  // Fehlt nur der Browser selbst, wird er einmalig nachgeladen statt den
  // Nutzer mit einem Installationsbefehl wegzuschicken.
  const missingBinary = /Executable doesn't exist|please run the following command|browserType\.launch/i.test(
    result.error?.message ?? '',
  );

  if (missingBinary && !explicit && shouldAutoInstall()) {
    onSetup('Chromium fehlt noch und wird jetzt einmalig heruntergeladen (ca. 150 MB).');
    if (await installChromium()) {
      onSetup('Download abgeschlossen.');
      result = await tryLaunch();
      if (result.browser) return result.browser;
    }
  }

  const details = diagnose(result.error?.message ?? '');
  throw new UserError(`Chromium konnte nicht gestartet werden: ${details.raw || 'unbekannter Fehler'}`, {
    hint: 'Browser von Hand installieren: "npx playwright install chromium" (in Docker/CI zusätzlich "--with-deps") oder den Pfad über --browser-path setzen.',
  });
}

/** Scroll to the bottom in steps so lazy-loaded media renders, then return to the top. */
async function autoScroll(page, { maxDuration = 10000, step = 800 } = {}) {
  await page.evaluate(
    async ({ maxDuration: budget, step: stepSize }) => {
      const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      const docHeight = () =>
        Math.max(document.documentElement.scrollHeight, document.body ? document.body.scrollHeight : 0);

      const startedAt = Date.now();
      let position = 0;

      while (Date.now() - startedAt < budget) {
        const height = docHeight();
        position = Math.min(position + stepSize, height);
        window.scrollTo(0, position);
        await sleep(70);
        if (position >= height) {
          await sleep(150);
          if (docHeight() <= height) break;
        }
      }
      window.scrollTo(0, 0);
    },
    { maxDuration, step },
  );
}

/** Wait for web fonts, ignoring pages that do not expose the API. */
async function waitForFonts(page) {
  await page.evaluate(() => (document.fonts ? document.fonts.ready.then(() => undefined) : undefined));
}

async function hideSelectors(page, selectors) {
  if (selectors.length === 0) return;
  await page.addStyleTag({ content: `${selectors.join(',\n')} { visibility: hidden !important; }` });
}

/**
 * Render `<image>` inside a viewport-sized page and screenshot it — a dependency
 * free way to downscale, using the browser we already have running.
 */
async function createThumbnail(context, { sourcePath, targetPath, width, height, format, quality }) {
  const helperPath = path.join(path.dirname(sourcePath), `.thumb-${path.basename(sourcePath)}.html`);
  const page = await context.newPage();

  try {
    await writeFile(
      helperPath,
      `<!doctype html><meta charset="utf-8">` +
        `<style>html,body{margin:0;padding:0;background:#ffffff;overflow:hidden}` +
        `img{display:block;width:100%;height:auto}</style>` +
        `<img src="${encodeURIComponent(path.basename(sourcePath))}" alt="">`,
      'utf8',
    );

    await page.setViewportSize({ width, height });
    await page.goto(pathToFileURL(helperPath).href, { waitUntil: 'load', timeout: 30000 });
    await page.evaluate(async () => {
      const image = document.images[0];
      if (!image || image.complete) return;
      await new Promise((resolve) => {
        image.addEventListener('load', resolve, { once: true });
        image.addEventListener('error', resolve, { once: true });
      });
    });

    await page.screenshot({
      path: targetPath,
      type: format,
      ...(format === 'jpeg' ? { quality } : {}),
    });
    return true;
  } finally {
    await page.close().catch(() => {});
    await rm(helperPath, { force: true }).catch(() => {});
  }
}

/** Capture one URL. Never throws — failures are reported in the result object. */
async function captureOne(browser, target, index, options, paths) {
  const extension = options.format === 'jpeg' ? 'jpg' : 'png';
  const fileName = fileNameFor(target.url, index, extension);
  const absoluteFile = path.join(paths.shotsAbsolute, fileName);
  const relativeFile = `${options.shotsDir}/${fileName}`;
  const relativeThumb = `${options.shotsDir}/thumbs/${fileName}`;

  const base = {
    index,
    url: target.url,
    label: target.label || '',
    file: null,
    thumb: null,
    fileName,
    status: null,
    statusText: '',
    ok: false,
    title: '',
    finalUrl: '',
    timestamp: new Date().toISOString(),
    durationMs: 0,
    bytes: 0,
    pageWidth: 0,
    pageHeight: 0,
    attempts: 0,
    error: null,
    errorHint: '',
    errorCode: '',
    errorRaw: '',
  };

  for (let attempt = 0; attempt <= options.retries; attempt += 1) {
    const startedAt = Date.now();
    base.attempts = attempt + 1;
    base.timestamp = new Date().toISOString();

    const context = await browser.newContext({
      viewport: { width: options.width, height: options.height },
      deviceScaleFactor: options.scale,
      ignoreHTTPSErrors: true,
      // Eine URL, die einen Download auslöst, würde sonst still eine beliebig
      // große Datei auf die Platte schreiben. Screenshots braucht es dafür nicht.
      acceptDownloads: false,
      // Bei --preset mobile/tablet liefern viele Seiten sonst die Desktop-Variante aus.
      ...(options.emulateMobile ? { isMobile: true, hasTouch: true } : {}),
      ...(options.userAgent ? { userAgent: options.userAgent } : {}),
      ...(options.colorScheme ? { colorScheme: options.colorScheme } : {}),
    });

    try {
      const page = await context.newPage();
      page.setDefaultTimeout(options.timeout);
      page.on('dialog', (dialog) => dialog.dismiss().catch(() => {}));

      const response = await page.goto(target.url, { waitUntil: options.waitUntil, timeout: options.timeout });

      if (options.stabilize) await page.addStyleTag({ content: STABILIZE_CSS }).catch(() => {});
      if (options.hide.length > 0) await hideSelectors(page, options.hide).catch(() => {});
      if (options.autoScroll && options.fullPage) {
        await autoScroll(page, { maxDuration: Math.min(10000, options.timeout) }).catch(() => {});
      }
      if (options.waitUntil !== 'networkidle') {
        await page.waitForLoadState('networkidle', { timeout: Math.min(5000, options.timeout) }).catch(() => {});
      }
      await waitForFonts(page).catch(() => {});
      if (options.delay > 0) await page.waitForTimeout(options.delay);

      const metrics = await page
        .evaluate(() => ({
          title: document.title || '',
          width: Math.max(document.documentElement.scrollWidth, document.body ? document.body.scrollWidth : 0),
          height: Math.max(document.documentElement.scrollHeight, document.body ? document.body.scrollHeight : 0),
        }))
        .catch(() => ({ title: '', width: 0, height: 0 }));

      await page.screenshot({
        path: absoluteFile,
        fullPage: options.fullPage,
        type: options.format,
        ...(options.format === 'jpeg' ? { quality: options.quality } : {}),
      });

      const fileStat = await stat(absoluteFile);

      base.status = response ? response.status() : null;
      base.statusText = response ? response.statusText() : '';
      base.ok = base.status === null ? true : base.status < 400;
      base.title = metrics.title;
      base.finalUrl = response ? response.url() : target.url;
      base.pageWidth = metrics.width;
      base.pageHeight = metrics.height;
      base.bytes = fileStat.size;
      base.file = relativeFile;
      base.durationMs = Date.now() - startedAt;
      base.error = null;
      base.errorHint = '';
      base.errorCode = '';
      base.errorRaw = '';
      break;
    } catch (error) {
      const details = diagnose(error?.message ?? error, { timeout: options.timeout });
      base.durationMs = Date.now() - startedAt;
      base.error = details.message;
      base.errorHint = details.hint;
      base.errorCode = details.code;
      base.errorRaw = details.raw;
      base.ok = false;
      base.file = null;
      if (attempt === options.retries) break;
      await new Promise((resolve) => setTimeout(resolve, 750 * (attempt + 1)));
    } finally {
      await context.close().catch(() => {});
    }
  }

  if (base.file && options.thumbnails) {
    try {
      await createThumbnail(paths.thumbContext, {
        sourcePath: absoluteFile,
        targetPath: path.join(paths.thumbsAbsolute, fileName),
        width: options.thumbWidth,
        height: options.thumbHeight,
        format: options.format,
        quality: options.quality,
      });
      base.thumb = relativeThumb;
    } catch {
      // A failed thumbnail is not fatal — the report falls back to the full image.
      base.thumb = null;
    }
  }

  return base;
}

/**
 * Capture every target.
 *
 * @param {Array<{url: string, label: string}>} targets
 * @param {object} options parsed CLI options; `options.signal` bricht den Lauf ab
 * @param {{ outAbsolute: string }} paths
 * @param {(result: object, done: number, total: number) => void} [onProgress]
 * @param {(message: string) => void} [onSetup]
 * @returns {Promise<{ results: object[], durationMs: number, cancelled: boolean }>}
 */
export async function captureAll(targets, options, paths, onProgress = () => {}, onSetup = () => {}) {
  const shotsAbsolute = path.join(paths.outAbsolute, options.shotsDir);
  const thumbsAbsolute = path.join(shotsAbsolute, 'thumbs');

  await mkdir(shotsAbsolute, { recursive: true });
  if (options.thumbnails) await mkdir(thumbsAbsolute, { recursive: true });

  const browser = await launchBrowser({
    browserPath: options.browserPath,
    sandbox: options.sandbox,
    proxy: options.proxy,
    onSetup,
  });
  const thumbContext = options.thumbnails
    ? await browser.newContext({ viewport: { width: options.thumbWidth, height: options.thumbHeight } })
    : null;

  const startedAt = Date.now();
  let done = 0;

  try {
    const collected = await runPool(
      targets,
      options.concurrency,
      async (target, index) => {
        const result = await captureOne(browser, target, index, options, {
          shotsAbsolute,
          thumbsAbsolute,
          thumbContext,
        });
        done += 1;
        onProgress(result, done, targets.length);
        return result;
      },
      options.signal,
    );

    // Abgebrochene Läufe hinterlassen Lücken — die gehören nicht in den Report.
    const results = collected.filter(Boolean);
    return { results, durationMs: Date.now() - startedAt, cancelled: Boolean(options.signal?.aborted) };
  } finally {
    await thumbContext?.close().catch(() => {});
    await browser.close().catch(() => {});
  }
}
