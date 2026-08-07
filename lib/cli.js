/** CLI argument parsing, defaults and `--help` output. */

import { parseArgs } from 'node:util';

import { UserError } from './errors.js';

export const VERSION = '1.0.0';

export const DEFAULTS = {
  input: 'urls.txt',
  out: '.',
  shotsDir: 'screenshots',
  concurrency: 3,
  width: 1440,
  height: 900,
  scale: 1,
  format: 'png',
  quality: 80,
  timeout: 30000,
  waitUntil: 'load',
  delay: 500,
  retries: 1,
  thumbWidth: 480,
  thumbHeight: 360,
  title: 'Screenshot-Report',
};

// `node:util.parseArgs` has no built-in negation that is stable across Node 18/20/22,
// so every switchable default gets an explicit `--no-*` counterpart.
const OPTIONS = {
  input: { type: 'string', short: 'i' },
  out: { type: 'string', short: 'o' },
  'shots-dir': { type: 'string' },
  concurrency: { type: 'string', short: 'c' },
  width: { type: 'string', short: 'w' },
  height: { type: 'string' },
  scale: { type: 'string' },
  format: { type: 'string', short: 'f' },
  quality: { type: 'string' },
  timeout: { type: 'string', short: 't' },
  'wait-until': { type: 'string' },
  delay: { type: 'string' },
  retries: { type: 'string' },
  'thumb-width': { type: 'string' },
  'thumb-height': { type: 'string' },
  hide: { type: 'string', multiple: true },
  'user-agent': { type: 'string' },
  'color-scheme': { type: 'string' },
  proxy: { type: 'string' },
  title: { type: 'string' },
  'browser-path': { type: 'string' },
  'no-full-page': { type: 'boolean' },
  'no-scroll': { type: 'boolean' },
  'no-stabilize': { type: 'boolean' },
  'no-thumbnails': { type: 'boolean' },
  'no-report': { type: 'boolean' },
  'no-sandbox': { type: 'boolean' },
  'no-proxy': { type: 'boolean' },
  'allow-failures': { type: 'boolean' },
  quiet: { type: 'boolean', short: 'q' },
  help: { type: 'boolean', short: 'h' },
  version: { type: 'boolean', short: 'v' },
};

const WAIT_STATES = ['load', 'domcontentloaded', 'networkidle', 'commit'];
const COLOR_SCHEMES = ['light', 'dark', 'no-preference'];
const FORMATS = ['png', 'jpeg'];

function toInt(value, name, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed)) {
    throw new UserError(`--${name} erwartet eine ganze Zahl, bekam "${value}".`);
  }
  if (parsed < min || parsed > max) {
    throw new UserError(`--${name} muss zwischen ${min} und ${max} liegen, bekam ${parsed}.`);
  }
  return parsed;
}

function toNumber(value, name, { min, max }) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new UserError(`--${name} erwartet eine Zahl, bekam "${value}".`);
  }
  if (parsed < min || parsed > max) {
    throw new UserError(`--${name} muss zwischen ${min} und ${max} liegen, bekam ${parsed}.`);
  }
  return parsed;
}

function oneOf(value, name, allowed) {
  if (!allowed.includes(value)) {
    throw new UserError(`--${name} muss einer von [${allowed.join(', ')}] sein, bekam "${value}".`);
  }
  return value;
}

export function parseCliArgs(argv) {
  let parsed;
  try {
    parsed = parseArgs({ args: argv, options: OPTIONS, allowPositionals: true, strict: true });
  } catch (error) {
    throw new UserError(error.message, { hint: 'Alle Optionen zeigt "screenshotter --help".' });
  }

  const { values, positionals } = parsed;

  const options = {
    help: Boolean(values.help),
    version: Boolean(values.version),
    urls: positionals,
    input: values.input ?? DEFAULTS.input,
    inputWasExplicit: values.input !== undefined,
    out: values.out ?? DEFAULTS.out,
    shotsDir: values['shots-dir'] ?? DEFAULTS.shotsDir,
    concurrency: values.concurrency ? toInt(values.concurrency, 'concurrency', { min: 1, max: 32 }) : DEFAULTS.concurrency,
    width: values.width ? toInt(values.width, 'width', { min: 200, max: 5000 }) : DEFAULTS.width,
    height: values.height ? toInt(values.height, 'height', { min: 200, max: 5000 }) : DEFAULTS.height,
    scale: values.scale ? toNumber(values.scale, 'scale', { min: 0.1, max: 4 }) : DEFAULTS.scale,
    format: values.format ? oneOf(values.format, 'format', FORMATS) : DEFAULTS.format,
    quality: values.quality ? toInt(values.quality, 'quality', { min: 1, max: 100 }) : DEFAULTS.quality,
    timeout: values.timeout ? toInt(values.timeout, 'timeout', { min: 1000, max: 600000 }) : DEFAULTS.timeout,
    waitUntil: values['wait-until'] ? oneOf(values['wait-until'], 'wait-until', WAIT_STATES) : DEFAULTS.waitUntil,
    delay: values.delay ? toInt(values.delay, 'delay', { min: 0, max: 60000 }) : DEFAULTS.delay,
    retries: values.retries ? toInt(values.retries, 'retries', { min: 0, max: 10 }) : DEFAULTS.retries,
    thumbWidth: values['thumb-width'] ? toInt(values['thumb-width'], 'thumb-width', { min: 80, max: 2000 }) : DEFAULTS.thumbWidth,
    thumbHeight: values['thumb-height'] ? toInt(values['thumb-height'], 'thumb-height', { min: 60, max: 2000 }) : DEFAULTS.thumbHeight,
    hide: (values.hide ?? []).flatMap((value) => value.split(',')).map((s) => s.trim()).filter(Boolean),
    userAgent: values['user-agent'] ?? '',
    colorScheme: values['color-scheme'] ? oneOf(values['color-scheme'], 'color-scheme', COLOR_SCHEMES) : '',
    proxy: values['no-proxy'] ? '' : (values.proxy ?? process.env.HTTPS_PROXY ?? process.env.HTTP_PROXY ?? ''),
    title: values.title ?? DEFAULTS.title,
    browserPath: values['browser-path'] ?? '',
    fullPage: !values['no-full-page'],
    autoScroll: !values['no-scroll'],
    stabilize: !values['no-stabilize'],
    thumbnails: !values['no-thumbnails'],
    report: !values['no-report'],
    sandbox: !values['no-sandbox'],
    allowFailures: Boolean(values['allow-failures']),
    quiet: Boolean(values.quiet),
  };

  if (options.format === 'png' && values.quality) {
    throw new UserError('--quality gilt nur für --format jpeg.');
  }
  return options;
}

export function helpText() {
  return `
screenshotter v${VERSION} — Full-Page-Screenshots + statischer HTML-Report

VERWENDUNG
  node screenshotter.js [optionen] [url ...]
  node screenshotter.js --input urls.txt
  cat urls.txt | node screenshotter.js

EINGABE
  Ohne URL-Argumente wird ${DEFAULTS.input} gelesen. Eine URL pro Zeile,
  leere Zeilen und Zeilen ab "#" oder "//" werden ignoriert.
  Optionales Label:  https://example.com | Startseite

OPTIONEN
  -i, --input <datei>       Eingabedatei mit URLs            (Standard: ${DEFAULTS.input})
  -o, --out <ordner>        Zielordner für den Report        (Standard: ${DEFAULTS.out})
      --shots-dir <name>    Unterordner für Bilder           (Standard: ${DEFAULTS.shotsDir})
  -c, --concurrency <n>     Parallele Seiten                 (Standard: ${DEFAULTS.concurrency})
  -w, --width <px>          Viewport-Breite                  (Standard: ${DEFAULTS.width})
      --height <px>         Viewport-Höhe                    (Standard: ${DEFAULTS.height})
      --scale <n>           deviceScaleFactor, z.B. 2 = Retina (Standard: ${DEFAULTS.scale})
  -f, --format <png|jpeg>   Bildformat                       (Standard: ${DEFAULTS.format})
      --quality <1-100>     JPEG-Qualität                    (Standard: ${DEFAULTS.quality})
  -t, --timeout <ms>        Timeout pro Seite                (Standard: ${DEFAULTS.timeout})
      --wait-until <state>  load|domcontentloaded|networkidle|commit (Standard: ${DEFAULTS.waitUntil})
      --delay <ms>          Zusätzliche Wartezeit vor dem Shot (Standard: ${DEFAULTS.delay})
      --retries <n>         Wiederholungen bei Fehlern       (Standard: ${DEFAULTS.retries})
      --thumb-width <px>    Thumbnail-Breite                 (Standard: ${DEFAULTS.thumbWidth})
      --thumb-height <px>   Thumbnail-Höhe                   (Standard: ${DEFAULTS.thumbHeight})
      --hide <selektoren>   CSS-Selektoren ausblenden (mehrfach/kommagetrennt)
      --user-agent <ua>     Eigener User-Agent
      --color-scheme <s>    light|dark|no-preference
      --proxy <server>      Proxy, z.B. http://127.0.0.1:8080 (Standard: $HTTPS_PROXY)
      --title <text>        Titel des Reports                (Standard: ${DEFAULTS.title})
      --browser-path <pfad> Pfad zur Chromium-Binary
      --no-full-page        Nur den sichtbaren Viewport aufnehmen
      --no-scroll           Kein Vorab-Scrollen (Lazy-Loading nicht auslösen)
      --no-stabilize        Animationen/Transitions nicht abschalten
      --no-thumbnails       Keine Thumbnails erzeugen (Report nutzt Vollbilder)
      --no-report           Nur Screenshots, kein index.html
      --no-sandbox          Chromium ohne Sandbox starten (Docker/CI)
      --no-proxy            Proxy aus der Umgebung ignorieren
      --allow-failures      Exit-Code 0, auch wenn URLs fehlschlagen
  -q, --quiet               Nur Fehler ausgeben
  -h, --help                Diese Hilfe
  -v, --version             Version ausgeben

BEISPIELE
  node screenshotter.js https://example.com https://example.org
  node screenshotter.js -i urls.txt -o public --width 1280 -c 5
  node screenshotter.js -i urls.txt --format jpeg --quality 75 --scale 2
  node screenshotter.js -i urls.txt --hide "#cookie-banner,.ad" --delay 1500

EXIT-CODES
  0  alles erfolgreich (oder --allow-failures)
  1  mindestens eine URL fehlgeschlagen
  2  Bedienfehler (falsche Option, fehlende Datei, ...)
`.trimStart();
}
