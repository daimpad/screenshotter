/** Screenshot engine: launches Chromium once and captures every target page. */

import { existsSync } from 'node:fs';
import { mkdir, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

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

/** Run `worker` over `items` with at most `limit` running at the same time. */
export async function runPool(items, limit, worker) {
  const results = new Array(items.length);
  let cursor = 0;

  const runners = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    for (;;) {
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

export async function launchBrowser({ browserPath = '', sandbox = true, proxy = '' } = {}) {
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
  let lastError = null;

  for (const executablePath of attempts) {
    try {
      return await chromium.launch({ args, ...proxyOption, ...(executablePath ? { executablePath } : {}) });
    } catch (error) {
      lastError = error;
    }
  }

  throw new UserError(`Chromium konnte nicht gestartet werden: ${lastError?.message?.split('\n')[0] ?? 'unbekannter Fehler'}`, {
    hint: 'Browser installieren mit "npx playwright install chromium" (in Docker/CI zusätzlich "--with-deps") oder Pfad über --browser-path setzen.',
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
  };

  for (let attempt = 0; attempt <= options.retries; attempt += 1) {
    const startedAt = Date.now();
    base.attempts = attempt + 1;
    base.timestamp = new Date().toISOString();

    const context = await browser.newContext({
      viewport: { width: options.width, height: options.height },
      deviceScaleFactor: options.scale,
      ignoreHTTPSErrors: true,
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
      break;
    } catch (error) {
      base.durationMs = Date.now() - startedAt;
      base.error = String(error?.message ?? error).split('\n')[0].trim();
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
 * @param {object} options parsed CLI options
 * @param {{ outAbsolute: string }} paths
 * @param {(result: object, done: number, total: number) => void} [onProgress]
 */
export async function captureAll(targets, options, paths, onProgress = () => {}) {
  const shotsAbsolute = path.join(paths.outAbsolute, options.shotsDir);
  const thumbsAbsolute = path.join(shotsAbsolute, 'thumbs');

  await mkdir(shotsAbsolute, { recursive: true });
  if (options.thumbnails) await mkdir(thumbsAbsolute, { recursive: true });

  const browser = await launchBrowser({
    browserPath: options.browserPath,
    sandbox: options.sandbox,
    proxy: options.proxy,
  });
  const thumbContext = options.thumbnails
    ? await browser.newContext({ viewport: { width: options.thumbWidth, height: options.thumbHeight } })
    : null;

  const startedAt = Date.now();
  let done = 0;

  try {
    const results = await runPool(targets, options.concurrency, async (target, index) => {
      const result = await captureOne(browser, target, index, options, {
        shotsAbsolute,
        thumbsAbsolute,
        thumbContext,
      });
      done += 1;
      onProgress(result, done, targets.length);
      return result;
    });

    return { results, durationMs: Date.now() - startedAt };
  } finally {
    await thumbContext?.close().catch(() => {});
    await browser.close().catch(() => {});
  }
}
