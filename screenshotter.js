#!/usr/bin/env node
/**
 * screenshotter — Full-Page-Screenshots für eine Liste von URLs plus
 * statischer HTML-Report (index.html) ohne Datenbank und ohne Framework.
 */

import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

import { captureAll } from './lib/capture.js';
import { helpText, parseCliArgs, VERSION } from './lib/cli.js';
import { UserError } from './lib/errors.js';
import { classify, formatBytes, formatDuration, writeReport } from './lib/report.js';
import { collectTargets } from './lib/urls.js';

const USE_COLOR = process.stdout.isTTY && !process.env.NO_COLOR;

const paint = (code, text) => (USE_COLOR ? `\u001b[${code}m${text}\u001b[0m` : text);
const dim = (text) => paint('2', text);
const bold = (text) => paint('1', text);
const green = (text) => paint('32', text);
const yellow = (text) => paint('33', text);
const red = (text) => paint('31', text);

function stateColor(state, text) {
  if (state === 'ok') return green(text);
  if (state === 'redirect') return yellow(text);
  return red(text);
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

  const log = options.quiet ? () => {} : (message = '') => process.stdout.write(`${message}\n`);

  const { targets, duplicates, source } = await collectTargets({
    inputFile: options.input,
    cliUrls: options.urls,
    inputWasExplicit: options.inputWasExplicit,
  });

  if (targets.length === 0) {
    throw new UserError(`Keine URLs gefunden (geprüft: ${options.input}, CLI-Argumente, stdin).`, {
      hint: `Lege eine ${options.input} an oder übergib URLs direkt: node screenshotter.js https://example.com`,
    });
  }
  if (duplicates.length > 0) {
    log(dim(`Hinweis: ${duplicates.length} doppelte URL(s) übersprungen.`));
  }

  const outAbsolute = path.resolve(process.cwd(), options.out);
  await mkdir(outAbsolute, { recursive: true });

  const outRelative = path.relative(process.cwd(), outAbsolute);
  const outLabel = !outRelative ? '.' : outRelative.startsWith('..') ? outAbsolute : outRelative;

  log(bold(`screenshotter v${VERSION}`));
  log(
    dim(
      `${targets.length} URL(s) aus ${source} · Viewport ${options.width}×${options.height}` +
        `${options.scale !== 1 ? `@${options.scale}x` : ''} · ${options.fullPage ? 'Full-Page' : 'Viewport'}` +
        ` · ${options.concurrency} parallel · Ziel ${outLabel}`,
    ),
  );
  log();

  const width = String(targets.length).length;
  const { results, durationMs } = await captureAll(targets, options, { outAbsolute }, (result, done, total) => {
    const state = classify(result);
    const counter = dim(`[${String(done).padStart(width)}/${total}]`);
    const status = stateColor(state, String(result.status ?? 'ERR').padEnd(4));
    const time = dim(formatDuration(result.durationMs).padStart(7));
    const tail = result.error ? red(result.error) : dim(`→ ${result.file}`);
    log(`${counter} ${status} ${time}  ${result.url}  ${tail}`);
  });

  const failed = results.filter((result) => classify(result) === 'error');
  const redirected = results.filter((result) => classify(result) === 'redirect');
  const succeeded = results.length - failed.length - redirected.length;
  const bytes = results.reduce((total, result) => total + (result.bytes || 0), 0);

  log();
  log(
    `${bold('Fertig')} in ${formatDuration(durationMs)} — ` +
      `${green(`${succeeded} OK`)}, ${yellow(`${redirected.length} Weiterleitung(en)`)}, ${red(`${failed.length} Fehler`)}` +
      ` · ${formatBytes(bytes)} Bilddaten`,
  );

  if (options.report) {
    const { indexPath, jsonPath } = await writeReport({ results, options, outAbsolute, durationMs, source });
    log(`Report: ${indexPath}`);
    log(`Daten:  ${jsonPath}`);
  }
  log(`Bilder: ${path.join(outAbsolute, options.shotsDir)}`);

  if (failed.length > 0 && !options.allowFailures) return 1;
  return 0;
}

main(process.argv.slice(2))
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error) => {
    if (error instanceof UserError) {
      process.stderr.write(`${red('Fehler:')} ${error.message}\n`);
      if (error.hint) process.stderr.write(`${dim(error.hint)}\n`);
      process.exitCode = 2;
      return;
    }
    process.stderr.write(`${red('Unerwarteter Fehler:')} ${error?.stack ?? error}\n`);
    process.exitCode = 2;
  });
