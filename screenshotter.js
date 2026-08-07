#!/usr/bin/env node
/**
 * screenshotter — Full-Page-Screenshots für eine Liste von URLs plus
 * statischer HTML-Report (index.html) ohne Datenbank und ohne Framework.
 */

import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

import { captureAll } from './lib/capture.js';
import { helpText, parseCliArgs, PRESETS, VERSION } from './lib/cli.js';
import { UserError } from './lib/errors.js';
import { openInDefaultApp } from './lib/open.js';
import { Reporter } from './lib/progress.js';
import { classify, formatBytes, formatDuration, writeReport } from './lib/report.js';
import { collectTargets } from './lib/urls.js';

const URLS_TEMPLATE = `# urls.txt — eine URL pro Zeile.
#
#   * Zeilen ab "#" oder "//" sind Kommentare, leere Zeilen werden übersprungen.
#   * Fehlt das Schema, wird https:// ergänzt (example.com -> https://example.com).
#   * Optionaler Anzeigename nach einem senkrechten Strich: URL | Name
#   * Doppelte URLs werden automatisch nur einmal aufgenommen.

https://example.com | Beispielseite
`;

/** Legt eine urls.txt-Vorlage an, ohne eine vorhandene zu überschreiben. */
async function initUrlsFile(filePath, reporter) {
  if (existsSync(filePath)) {
    reporter.line(`  ${filePath} gibt es schon — nichts geändert.`);
    return 0;
  }
  await writeFile(filePath, URLS_TEMPLATE, 'utf8');
  reporter.line(`  ${reporter.green(reporter.symbols.ok)} ${filePath} angelegt.`);
  reporter.line('');
  reporter.line('  Jetzt die Datei mit deinen URLs füllen und dann starten:');
  reporter.line(`  ${reporter.bold('node screenshotter.js --open')}`);
  return 0;
}

/** Startet die Weboberfläche und bleibt offen, bis der Nutzer abbricht. */
async function serve(options, reporter) {
  const { startServer } = await import('./lib/server.js');
  const server = await startServer(options, reporter);

  const local = options.host === '127.0.0.1' || options.host === 'localhost' || options.host === '::1';
  reporter.line(`  Weboberfläche läuft: ${reporter.bold(server.url)}`);
  if (!local) {
    reporter.line('');
    reporter.line(`  ${reporter.yellow('Achtung:')} der Dienst ist im Netz erreichbar und hat keine Anmeldung.`);
    reporter.line(reporter.dim('  Er lädt beliebige URLs auf Zuruf — nur in vertrauenswürdigen Netzen einsetzen.'));
  }
  reporter.line(reporter.dim('  Beenden mit Strg+C.'));
  reporter.line('');

  if (options.open) await openInDefaultApp(server.url);

  await new Promise((resolve) => {
    const stop = async (signal) => {
      reporter.line('');
      reporter.line(reporter.dim(`  Weboberfläche beendet (${signal}).`));
      await server.close();
      resolve();
    };
    process.once('SIGINT', () => stop('SIGINT'));
    process.once('SIGTERM', () => stop('SIGTERM'));
    process.once('SIGHUP', () => stop('SIGHUP'));
  });

  return 0;
}

/** Eine abgeschlossene URL als Konsolenzeile. */
function resultLine(reporter, result) {
  const state = classify(result);
  const symbol =
    state === 'ok'
      ? reporter.green(reporter.symbols.ok)
      : state === 'redirect'
        ? reporter.yellow(reporter.symbols.redirect)
        : reporter.red(reporter.symbols.error);

  const status = String(result.status ?? '---').padEnd(3);
  const duration = formatDuration(result.durationMs).padStart(7);
  const label = result.label ? reporter.dim(`  [${result.label}]`) : '';

  reporter.line(`  ${symbol} ${reporter.dim(status)} ${reporter.dim(duration)}  ${result.url}${label}`);

  if (result.error) {
    reporter.line(`      ${reporter.red(result.error)}`);
    if (result.errorHint) reporter.line(`      ${reporter.dim(`${reporter.symbols.arrow} ${result.errorHint}`)}`);
  }
}

async function main(argv) {
  const options = parseCliArgs(argv);

  if (options.help) {
    process.stdout.write(helpText());
    return 0;
  }
  if (options.version) {
    process.stdout.write(`${VERSION}\n`);
    return 0;
  }

  const reporter = new Reporter({ quiet: options.quiet });

  reporter.line('');
  reporter.line(`  ${reporter.bold(`screenshotter v${VERSION}`)}`);
  reporter.line('');

  if (options.init) return initUrlsFile(options.input, reporter);
  if (options.serve) return serve(options, reporter);

  const { targets, duplicates, source } = await collectTargets({
    inputFile: options.input,
    cliUrls: options.urls,
    inputWasExplicit: options.inputWasExplicit,
  });

  if (targets.length === 0) {
    throw new UserError(`Keine URLs gefunden (geprüft: ${options.input}, CLI-Argumente, stdin).`, {
      hint: `Mit "node screenshotter.js --init" eine ${options.input} anlegen oder URLs direkt übergeben: node screenshotter.js https://example.com`,
    });
  }

  const outAbsolute = path.resolve(process.cwd(), options.out);
  await mkdir(outAbsolute, { recursive: true });

  const outRelative = path.relative(process.cwd(), outAbsolute);
  const outLabel = !outRelative ? '.' : outRelative.startsWith('..') ? outAbsolute : outRelative;
  const device = options.preset ? PRESETS[options.preset].label : 'Viewport';
  const dot = ` ${reporter.symbols.bullet} `;

  reporter.line(
    reporter.dim(
      [
        `  ${targets.length} URL(s) aus ${source}`,
        `${device} ${options.width}×${options.height}${options.scale !== 1 ? ` @${options.scale}x` : ''}`,
        options.fullPage ? 'Full-Page' : 'nur Viewport',
        `${options.concurrency} parallel`,
        `Ziel ${outLabel}`,
      ].join(dot),
    ),
  );
  if (duplicates.length > 0) {
    reporter.line(reporter.dim(`  ${duplicates.length} doppelte URL(s) übersprungen.`));
  }
  reporter.line('');

  reporter.startProgress(targets.length);
  const { results, durationMs } = await captureAll(
    targets,
    options,
    { outAbsolute },
    (result) => {
      resultLine(reporter, result);
      reporter.advance({ failed: classify(result) === 'error' });
    },
    (message) => reporter.line(reporter.dim(`  ${message}`)),
  );
  reporter.stopProgress();

  const failed = results.filter((result) => classify(result) === 'error');
  const redirected = results.filter((result) => classify(result) === 'redirect');
  const succeeded = results.length - failed.length - redirected.length;
  const bytes = results.reduce((total, result) => total + (result.bytes || 0), 0);

  reporter.line('');
  reporter.line(`  ${reporter.bold(`Fertig in ${formatDuration(durationMs)}`)}`);
  reporter.line(
    [
      `    ${reporter.green(`${succeeded} erfolgreich`)}`,
      redirected.length > 0 ? reporter.yellow(`${redirected.length} weitergeleitet`) : null,
      failed.length > 0 ? reporter.red(`${failed.length} fehlgeschlagen`) : null,
      reporter.dim(formatBytes(bytes)),
    ]
      .filter(Boolean)
      .join(dot),
  );

  if (failed.length > 0) {
    reporter.line('');
    reporter.line(`  ${reporter.red(`Fehlgeschlagen (${failed.length}):`)}`);
    for (const result of failed) {
      const reason = result.error ?? `HTTP ${result.status}`;
      reporter.line(`    ${reporter.red(reporter.symbols.error)} ${result.url}`);
      reporter.line(`      ${reporter.dim(reason)}`);
    }
  }

  reporter.line('');
  let indexPath = '';
  if (options.report) {
    const written = await writeReport({ results, options, outAbsolute, durationMs, source });
    indexPath = written.indexPath;
    reporter.line(`  Report: ${reporter.bold(indexPath)}`);
    reporter.line(`  Daten:  ${written.jsonPath}`);
  }
  reporter.line(`  Bilder: ${path.join(outAbsolute, options.shotsDir)}`);
  reporter.line('');

  if (options.open && indexPath) {
    const opened = await openInDefaultApp(indexPath);
    if (!opened) reporter.line(reporter.dim('  Report konnte nicht automatisch geöffnet werden.'));
  } else if (!options.open && indexPath && reporter.isTty) {
    // Nur für Menschen am Terminal — in cron- und CI-Logs wäre das nur Rauschen.
    reporter.line(reporter.dim('  Tipp: mit --open öffnet sich der Report künftig von selbst.'));
    reporter.line('');
  }

  if (failed.length > 0 && !options.allowFailures) return 1;
  return 0;
}

main(process.argv.slice(2))
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error) => {
    const reporter = new Reporter({ stream: process.stderr });
    if (error instanceof UserError) {
      process.stderr.write(`\n  ${reporter.red('Fehler:')} ${error.message}\n`);
      if (error.hint) process.stderr.write(`  ${reporter.dim(`${reporter.symbols.arrow} ${error.hint}`)}\n\n`);
      process.exitCode = 2;
      return;
    }
    process.stderr.write(`\n  ${reporter.red('Unerwarteter Fehler:')} ${error?.stack ?? error}\n\n`);
    process.exitCode = 2;
  });
