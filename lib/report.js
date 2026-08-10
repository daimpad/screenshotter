/** Static report generation: index.html, report.json and the frontend assets. */

import { copyFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { VERSION } from './cli.js';

const ASSETS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'assets');

const HTML_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

/** Escape a value for use in HTML text and attributes. */
export function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => HTML_ESCAPES[character]);
}

export function formatBytes(bytes) {
  if (!bytes || bytes < 0) return '–';
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toLocaleString('de-DE', { maximumFractionDigits: value < 10 ? 1 : 0 })} ${units[unitIndex]}`;
}

export function formatDuration(ms) {
  if (!Number.isFinite(ms) || ms < 0) return '–';
  if (ms < 1000) return `${Math.round(ms)} ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toLocaleString('de-DE', { maximumFractionDigits: 1 })} s`;
  const minutes = Math.floor(seconds / 60);
  const rest = Math.round(seconds % 60);
  return `${minutes} min ${String(rest).padStart(2, '0')} s`;
}

export function formatTimestamp(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '–';
  return date.toLocaleString('de-DE', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

/**
 * Classify a capture result into one of the three report states.
 * A followed redirect counts as `redirect` too — the final status is 200, but the
 * requested URL is not the one that was rendered, and that is worth surfacing.
 */
export function classify(result) {
  if (result.error || !result.file) return 'error';
  if (result.status !== null && result.status >= 400) return 'error';
  if (result.finalUrl && result.finalUrl !== result.url) return 'redirect';
  if (result.status !== null && result.status >= 300) return 'redirect';
  return 'ok';
}

const BADGE_CLASS = { ok: 'badge--ok', redirect: 'badge--warn', error: 'badge--error' };

/** Tooltip for a status badge — explains an orange 200 after a redirect. */
function badgeTitle(result, state) {
  if (state === 'redirect' && result.finalUrl && result.finalUrl !== result.url) {
    return ` title="Weiterleitung nach ${esc(result.finalUrl)}"`;
  }
  return result.statusText ? ` title="${esc(result.statusText)}"` : '';
}

export function summarise(results, durationMs) {
  const counts = { total: results.length, ok: 0, redirect: 0, error: 0 };
  let bytes = 0;

  for (const result of results) {
    counts[classify(result)] += 1;
    bytes += result.bytes || 0;
  }
  return { ...counts, bytes, durationMs };
}

function statCard(value, label, modifier = '') {
  return `        <li class="stat${modifier ? ` stat--${modifier}` : ''}">
          <span class="stat__value">${esc(value)}</span>
          <span class="stat__label">${esc(label)}</span>
        </li>`;
}

function previewCell(result, state) {
  if (!result.file) {
    return `          <td class="col-preview" data-label="Vorschau">
            <div class="shot-missing">Kein Screenshot</div>
          </td>`;
  }

  const image = result.thumb || result.file;
  const statusLabel = result.status === null ? 'kein Status' : `HTTP ${result.status}`;
  const caption = result.title || result.label || result.url;

  return `          <td class="col-preview" data-label="Vorschau">
            <a class="shot-link" href="${esc(result.file)}"
               data-url="${esc(result.url)}"
               data-title="${esc(caption)}"
               data-status="${esc(state === 'error' ? `${statusLabel} · Fehler` : statusLabel)}"
               data-time="${esc(formatTimestamp(result.timestamp))}">
              <img src="${esc(image)}" alt="Screenshot von ${esc(result.url)}" loading="lazy" decoding="async">
            </a>
          </td>`;
}

function galleryRow(result) {
  const state = classify(result);
  const badgeText = result.status === null ? (state === 'error' ? 'Fehler' : '–') : String(result.status);
  const searchIndex = [result.url, result.title, result.label, result.fileName, result.status, result.error]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  const pageParts = [];
  if (result.title) pageParts.push(`            <p class="page-title">${esc(result.title)}</p>`);
  pageParts.push(
    `            <a class="page-url" href="${esc(result.url)}" target="_blank" rel="noopener noreferrer">${esc(result.url)}</a>`,
  );
  if (result.label) pageParts.push(`            <span class="page-label">${esc(result.label)}</span>`);
  if (result.finalUrl && result.finalUrl !== result.url) {
    pageParts.push(`            <p class="page-redirect">→ ${esc(result.finalUrl)}</p>`);
  }
  if (result.error) {
    pageParts.push(`            <p class="page-error">${esc(result.error)}</p>`);
    if (result.errorHint) pageParts.push(`            <p class="page-hint">${esc(result.errorHint)}</p>`);
  }

  const dimensions = result.pageHeight
    ? `${result.pageWidth.toLocaleString('de-DE')} × ${result.pageHeight.toLocaleString('de-DE')} px`
    : '–';

  const fileCell = result.file
    ? `<a class="file-link" href="${esc(result.file)}" target="_blank" rel="noopener">${esc(result.fileName)}</a>
            <span class="file-meta">${esc(formatBytes(result.bytes))}</span>`
    : '<span class="file-meta">–</span>';

  return `        <tr data-state="${state}" data-search="${esc(searchIndex)}">
          <td class="col-index" data-label="#" data-sort-value="${result.index + 1}">${result.index + 1}</td>
${previewCell(result, state)}
          <td class="page-cell" data-label="Seite" data-sort-value="${esc(result.url)}">
${pageParts.join('\n')}
          </td>
          <td data-label="Status" data-sort-value="${result.status ?? (state === 'error' ? 999 : 0)}">
            <span class="badge ${BADGE_CLASS[state]}"${badgeTitle(result, state)}>${esc(badgeText)}</span>
          </td>
          <td class="num" data-label="Seitenhöhe" data-sort-value="${result.pageHeight || 0}">${esc(dimensions)}</td>
          <td class="num" data-label="Dauer" data-sort-value="${result.durationMs || 0}">${esc(formatDuration(result.durationMs))}</td>
          <td data-label="Datei" data-sort-value="${esc(result.fileName)}">${fileCell}</td>
        </tr>`;
}

function summaryRow(result) {
  const state = classify(result);
  const badgeText = result.status === null ? (state === 'error' ? 'Fehler' : '–') : String(result.status);
  const statusTitle = badgeTitle(result, state);

  return `        <tr data-state="${state}">
          <td data-label="URL" data-sort-value="${esc(result.url)}">
            <a class="page-url" href="${esc(result.url)}" target="_blank" rel="noopener noreferrer">${esc(result.url)}</a>
          </td>
          <td data-label="Statuscode" data-sort-value="${result.status ?? (state === 'error' ? 999 : 0)}">
            <span class="badge ${BADGE_CLASS[state]}"${statusTitle}>${esc(badgeText)}</span>
          </td>
          <td class="num" data-label="Zeitstempel" data-sort-value="${esc(result.timestamp)}">
            <time datetime="${esc(result.timestamp)}">${esc(formatTimestamp(result.timestamp))}</time>
          </td>
          <td data-label="Dateiname" data-sort-value="${esc(result.fileName)}">${
            result.file
              ? `<a class="file-link" href="${esc(result.file)}" target="_blank" rel="noopener">${esc(result.fileName)}</a>`
              : '<span class="file-meta">–</span>'
          }</td>
        </tr>`;
}

/** Build the complete `index.html` document. */
export function renderHtml({ results, options, stats, generatedAt, source }) {
  // Gallery: alphabetically by URL. Summary: in run order.
  const gallery = [...results].sort((a, b) => a.url.localeCompare(b.url, 'de'));
  const summary = [...results].sort((a, b) => a.index - b.index);

  const viewport = `${options.width} × ${options.height} px`;
  const emptyState =
    results.length === 0
      ? `        <tr class="empty-row"><td colspan="7">Keine URLs erfasst.</td></tr>\n`
      : '';

  return `<!doctype html>
<html lang="de">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex, nofollow">
  <meta name="generator" content="screenshotter v${esc(VERSION)}">
  <title>${esc(options.title)}</title>
  <link rel="icon" href="assets/logo.svg" type="image/svg+xml">
  <link rel="stylesheet" href="assets/report.css">
  <script>
    // Gespeichertes Farbschema vor dem ersten Paint anwenden (kein Flackern).
    try { var t = localStorage.getItem('screenshotter-theme'); if (t) document.documentElement.setAttribute('data-theme', t); } catch (e) {}
  </script>
</head>
<body>
  <header class="site-header">
    <div class="wrap">
      <div class="site-header__top">
        <div>
          <h1 class="site-title">${esc(options.title)}</h1>
          <p class="site-subtitle">
            Erstellt am ${esc(formatTimestamp(generatedAt))} · Quelle: ${esc(source)} · Viewport ${esc(viewport)}${
              options.scale !== 1 ? ` @${esc(String(options.scale))}x` : ''
            } · <a href="#summary">Zur Zusammenfassung</a>
          </p>
        </div>
        <button type="button" class="theme-toggle" id="theme-toggle">
          <span aria-hidden="true">◐</span><span data-theme-label>System</span>
        </button>
      </div>

      <ul class="stats">
${[
  statCard(stats.total.toLocaleString('de-DE'), 'Seiten'),
  statCard(stats.ok.toLocaleString('de-DE'), 'Erfolgreich', 'ok'),
  statCard(stats.redirect.toLocaleString('de-DE'), 'Weiterleitungen', 'warn'),
  statCard(stats.error.toLocaleString('de-DE'), 'Fehlgeschlagen', 'error'),
  statCard(formatDuration(stats.durationMs), 'Laufzeit'),
  statCard(formatBytes(stats.bytes), 'Bilddaten'),
].join('\n')}
      </ul>
    </div>
  </header>

  <main class="wrap">
    <section class="section" id="gallery" aria-labelledby="gallery-title">
      <div class="section__head">
        <h2 class="section__title" id="gallery-title">Screenshots</h2>
        <p class="section__hint">Vorschaubild anklicken für die Lightbox · Spaltenköpfe sortieren · <kbd>/</kbd> springt in die Suche</p>
      </div>

      <div class="toolbar">
        <input type="search" id="search" class="search" placeholder="Suchen …  (Taste /)" aria-label="Tabelle durchsuchen">
        <div class="filters" role="group" aria-label="Nach Status filtern">
          <button type="button" class="chip" data-filter="all" aria-pressed="true">Alle</button>
          <button type="button" class="chip" data-filter="ok" aria-pressed="false">OK</button>
          <button type="button" class="chip" data-filter="redirect" aria-pressed="false">Weiterleitung</button>
          <button type="button" class="chip" data-filter="error" aria-pressed="false">Fehler</button>
        </div>
        <div class="views" role="group" aria-label="Ansicht wählen">
          <button type="button" class="chip" data-view="table" aria-pressed="true">Tabelle</button>
          <button type="button" class="chip" data-view="grid" aria-pressed="false">Galerie</button>
        </div>
        <span class="result-count" id="result-count" aria-live="polite">${stats.total.toLocaleString('de-DE')} Einträge</span>
      </div>

      <div class="table-card" id="shots-card">
        <div class="table-scroll">
          <table id="shots-table" data-sortable>
            <caption class="visually-hidden">Alle erfassten Seiten mit Vorschaubild, Status, Seitenhöhe, Dauer und Dateiname</caption>
            <thead>
              <tr>
                <th class="sortable col-index" data-column="0" data-sort-type="number" scope="col">#</th>
                <th class="col-preview" scope="col">Vorschau</th>
                <th class="sortable" data-column="2" data-sort-type="text" aria-sort="ascending" scope="col">Seite</th>
                <th class="sortable" data-column="3" data-sort-type="number" scope="col">Status</th>
                <th class="sortable" data-column="4" data-sort-type="number" scope="col">Seitenhöhe</th>
                <th class="sortable" data-column="5" data-sort-type="number" scope="col">Dauer</th>
                <th class="sortable" data-column="6" data-sort-type="text" scope="col">Datei</th>
              </tr>
            </thead>
            <tbody>
${gallery.map(galleryRow).join('\n')}
${emptyState}        <tr class="empty-row" id="no-results" hidden><td colspan="7">Keine Treffer für den aktuellen Filter.</td></tr>
            </tbody>
          </table>
        </div>
      </div>
    </section>

    <section class="section" id="summary" aria-labelledby="summary-title">
      <div class="section__head">
        <h2 class="section__title" id="summary-title">Zusammenfassung</h2>
        <p class="section__hint">Alle Ergebnisse in Aufrufreihenfolge · <a href="report.json">report.json</a></p>
      </div>

      <div class="table-card">
        <div class="table-scroll">
          <table id="summary-table" data-sortable>
            <caption class="visually-hidden">Übersicht über URL, Statuscode, Zeitstempel und Dateiname</caption>
            <thead>
              <tr>
                <th class="sortable" data-column="0" data-sort-type="text" scope="col">URL</th>
                <th class="sortable" data-column="1" data-sort-type="number" scope="col">Statuscode</th>
                <th class="sortable" data-column="2" data-sort-type="text" scope="col">Zeitstempel</th>
                <th class="sortable" data-column="3" data-sort-type="text" scope="col">Dateiname</th>
              </tr>
            </thead>
            <tbody>
${summary.map(summaryRow).join('\n')}
            </tbody>
            <tfoot>
              <tr>
                <td data-label="URL"><strong>${stats.total.toLocaleString('de-DE')} URLs</strong></td>
                <td data-label="Statuscode">${stats.ok.toLocaleString('de-DE')} OK · ${stats.redirect.toLocaleString('de-DE')} Redirect · ${stats.error.toLocaleString('de-DE')} Fehler</td>
                <td class="num" data-label="Zeitstempel">${esc(formatDuration(stats.durationMs))}</td>
                <td class="num" data-label="Dateiname">${esc(formatBytes(stats.bytes))}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    </section>
  </main>

  <footer class="site-footer">
    <div class="wrap">
      Erzeugt mit <img class="footer-logo" src="assets/logo.svg" alt="" width="18" height="16"><strong>screenshotter</strong> v${esc(VERSION)} · Chromium via Playwright ·
      ${esc(options.fullPage ? 'Full-Page-Screenshots' : 'Viewport-Screenshots')} ·
      Rohdaten: <a href="report.json">report.json</a>
    </div>
  </footer>

  <div class="lightbox" id="lightbox" hidden role="dialog" aria-modal="true" aria-label="Screenshot-Vorschau">
    <div class="lightbox__bar">
      <span class="lightbox__meta">
        <span class="lightbox__title"></span>
        <span class="lightbox__sub"></span>
      </span>
      <span class="lightbox__actions">
        <button type="button" class="lb-btn" data-lb="prev" aria-label="Vorheriger Screenshot">←</button>
        <span class="lightbox__counter"></span>
        <button type="button" class="lb-btn" data-lb="next" aria-label="Nächster Screenshot">→</button>
        <a class="lb-btn" data-lb="open" href="#" target="_blank" rel="noopener">Original</a>
        <button type="button" class="lb-btn" data-lb="close" aria-label="Schließen">✕</button>
      </span>
    </div>
    <div class="lightbox__stage">
      <img class="lightbox__img" data-lb="image" alt="" title="Klicken für Originalgröße">
    </div>
  </div>

  <script src="assets/report.js" defer></script>
</body>
</html>
`;
}

/** Write index.html, report.json and the assets folder into the output directory. */
export async function writeReport({ results, options, outAbsolute, durationMs, source }) {
  const generatedAt = new Date().toISOString();
  const stats = summarise(results, durationMs);

  const assetsTarget = path.join(outAbsolute, 'assets');
  await mkdir(assetsTarget, { recursive: true });
  await copyFile(path.join(ASSETS_DIR, 'report.css'), path.join(assetsTarget, 'report.css'));
  await copyFile(path.join(ASSETS_DIR, 'report.js'), path.join(assetsTarget, 'report.js'));
  await copyFile(path.join(ASSETS_DIR, 'logo.svg'), path.join(assetsTarget, 'logo.svg'));

  const html = renderHtml({ results, options, stats, generatedAt, source });
  const indexPath = path.join(outAbsolute, 'index.html');
  await writeFile(indexPath, html, 'utf8');

  const jsonPath = path.join(outAbsolute, 'report.json');
  await writeFile(
    jsonPath,
    `${JSON.stringify(
      {
        generator: `screenshotter v${VERSION}`,
        generatedAt,
        source,
        options: {
          preset: options.preset || null,
          width: options.width,
          height: options.height,
          scale: options.scale,
          fullPage: options.fullPage,
          format: options.format,
          waitUntil: options.waitUntil,
          delay: options.delay,
          timeout: options.timeout,
          retries: options.retries,
          concurrency: options.concurrency,
          hide: options.hide,
        },
        stats,
        results: results.map((result) => ({ ...result, state: classify(result) })),
      },
      null,
      2,
    )}\n`,
    'utf8',
  );

  return { indexPath, jsonPath, stats };
}
