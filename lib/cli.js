/** CLI argument parsing, defaults and `--help` output. */

import { parseArgs } from 'node:util';

import { UserError } from './errors.js';

export const VERSION = '1.5.1';

/**
 * Fertige Geräteprofile. Ersparen das Merken von Viewport-Zahlen; einzeln
 * gesetzte --width/--height/--scale haben trotzdem Vorrang.
 */
export const PRESETS = {
  desktop: { width: 1440, height: 900, scale: 1, mobile: false, label: 'Desktop' },
  laptop: { width: 1280, height: 800, scale: 1, mobile: false, label: 'Laptop' },
  tablet: { width: 820, height: 1180, scale: 2, mobile: true, label: 'Tablet' },
  mobile: { width: 390, height: 844, scale: 2, mobile: true, label: 'Smartphone' },
};

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
  port: 8080,
  host: '127.0.0.1',
};

// `node:util.parseArgs` has no built-in negation that is stable across Node 18/20/22,
// so every switchable default gets an explicit `--no-*` counterpart.
const OPTIONS = {
  input: { type: 'string', short: 'i' },
  out: { type: 'string', short: 'o' },
  preset: { type: 'string', short: 'p' },
  open: { type: 'boolean' },
  init: { type: 'boolean' },
  serve: { type: 'boolean', short: 's' },
  port: { type: 'string' },
  host: { type: 'string' },
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

  const presetName = values.preset ? oneOf(values.preset, 'preset', Object.keys(PRESETS)) : '';
  const preset = presetName ? PRESETS[presetName] : {};

  const options = {
    help: Boolean(values.help),
    version: Boolean(values.version),
    init: Boolean(values.init),
    open: Boolean(values.open),
    serve: Boolean(values.serve),
    port: values.port ? toInt(values.port, 'port', { min: 1024, max: 65535 }) : DEFAULTS.port,
    host: values.host ?? DEFAULTS.host,
    preset: presetName,
    emulateMobile: Boolean(preset.mobile),
    urls: positionals,
    input: values.input ?? DEFAULTS.input,
    inputWasExplicit: values.input !== undefined,
    out: values.out ?? DEFAULTS.out,
    shotsDir: values['shots-dir'] ?? DEFAULTS.shotsDir,
    concurrency: values.concurrency ? toInt(values.concurrency, 'concurrency', { min: 1, max: 32 }) : DEFAULTS.concurrency,
    width: values.width ? toInt(values.width, 'width', { min: 200, max: 5000 }) : (preset.width ?? DEFAULTS.width),
    height: values.height ? toInt(values.height, 'height', { min: 200, max: 5000 }) : (preset.height ?? DEFAULTS.height),
    scale: values.scale ? toNumber(values.scale, 'scale', { min: 0.1, max: 4 }) : (preset.scale ?? DEFAULTS.scale),
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
  if (options.open && !options.report) {
    throw new UserError('--open und --no-report schließen sich aus: ohne Report gibt es nichts zu öffnen.');
  }
  if (options.serve && options.init) {
    throw new UserError('--serve und --init schließen sich aus.');
  }
  return options;
}

/**
 * Übernimmt Werte aus der Weboberfläche in ein bestehendes Optionsobjekt —
 * mit denselben Prüfungen wie auf der Kommandozeile. Alles, was der Browser
 * schickt, läuft hier durch; ungültige Werte lösen eine UserError aus.
 *
 * @param {object} base    Ausgangsoptionen (die des laufenden Servers)
 * @param {object} [patch] Rohwerte aus dem Formular
 */
export function applyRunOptions(base, patch = {}) {
  const next = { ...base };
  const given = (key) => patch[key] !== undefined && patch[key] !== null && patch[key] !== '';

  // Zuerst das Profil, damit einzelne Angaben es danach überschreiben können.
  if (given('preset')) {
    const name = oneOf(String(patch.preset), 'preset', Object.keys(PRESETS));
    const preset = PRESETS[name];
    next.preset = name;
    next.width = preset.width;
    next.height = preset.height;
    next.scale = preset.scale;
    next.emulateMobile = preset.mobile;
  }

  if (given('width')) next.width = toInt(patch.width, 'width', { min: 200, max: 5000 });
  if (given('height')) next.height = toInt(patch.height, 'height', { min: 200, max: 5000 });
  if (given('scale')) next.scale = toNumber(patch.scale, 'scale', { min: 0.1, max: 4 });
  if (given('format')) next.format = oneOf(String(patch.format), 'format', FORMATS);
  if (given('quality')) next.quality = toInt(patch.quality, 'quality', { min: 1, max: 100 });
  if (given('concurrency')) next.concurrency = toInt(patch.concurrency, 'concurrency', { min: 1, max: 32 });
  if (given('timeout')) next.timeout = toInt(patch.timeout, 'timeout', { min: 1000, max: 600000 });
  if (given('delay')) next.delay = toInt(patch.delay, 'delay', { min: 0, max: 60000 });
  if (given('retries')) next.retries = toInt(patch.retries, 'retries', { min: 0, max: 10 });
  if (given('waitUntil')) next.waitUntil = oneOf(String(patch.waitUntil), 'wait-until', WAIT_STATES);
  if (given('colorScheme')) next.colorScheme = oneOf(String(patch.colorScheme), 'color-scheme', COLOR_SCHEMES);
  if (given('title')) next.title = String(patch.title).slice(0, 200);
  if (given('out')) next.out = String(patch.out).slice(0, 500);
  if (given('userAgent')) next.userAgent = String(patch.userAgent).slice(0, 500);

  if (patch.hide !== undefined) {
    const raw = Array.isArray(patch.hide) ? patch.hide : String(patch.hide).split(/[,\n]/);
    next.hide = raw.map((entry) => String(entry).trim()).filter(Boolean).slice(0, 50);
  }

  for (const flag of ['fullPage', 'autoScroll', 'stabilize', 'thumbnails']) {
    if (patch[flag] !== undefined) next[flag] = Boolean(patch[flag]);
  }

  return next;
}

export function helpText() {
  const presets = Object.entries(PRESETS)
    .map(([name, p]) => `      ${name.padEnd(9)} ${String(p.width).padStart(4)} x ${String(p.height).padEnd(4)} @${p.scale}x  ${p.label}`)
    .join('\n');

  return `
screenshotter v${VERSION} — Full-Page-Screenshots + statischer HTML-Report

SO GEHT ES LOS
  node screenshotter.js --serve                Weboberfläche im Browser öffnen
  node screenshotter.js --init                 urls.txt anlegen
  node screenshotter.js                        urls.txt abarbeiten
  node screenshotter.js --open                 ... und den Report gleich öffnen
  node screenshotter.js https://example.com    einzelne URLs direkt übergeben

EINGABE
  Ohne URL-Argumente wird ${DEFAULTS.input} gelesen. Eine URL pro Zeile,
  leere Zeilen und Zeilen ab "#" oder "//" werden ignoriert.
  Optionales Label:  https://example.com | Startseite

DIE WICHTIGSTEN OPTIONEN
  -s, --serve               Weboberfläche starten (keine Kommandozeile mehr nötig)
      --port <n>            Port der Weboberfläche          (Standard: ${DEFAULTS.port})
      --host <adresse>      Adresse der Weboberfläche       (Standard: ${DEFAULTS.host})
  -p, --preset <gerät>      Fertiges Geräteprofil, siehe unten
      --open                Report nach dem Lauf im Browser öffnen
  -o, --out <ordner>        Zielordner für den Report       (Standard: ${DEFAULTS.out})
  -i, --input <datei>       Eingabedatei mit URLs            (Standard: ${DEFAULTS.input})
  -c, --concurrency <n>     Parallele Seiten                 (Standard: ${DEFAULTS.concurrency})
  -f, --format <png|jpeg>   Bildformat, jpeg spart Platz     (Standard: ${DEFAULTS.format})
      --hide <selektoren>   Cookie-Banner & Co. ausblenden (mehrfach/kommagetrennt)
      --title <text>        Titel des Reports                (Standard: ${DEFAULTS.title})
      --init                urls.txt-Vorlage anlegen und beenden

GERÄTEPROFILE (-p)
${presets}
      Einzelne --width/--height/--scale überschreiben das Profil.

FEINEINSTELLUNG
  -w, --width <px>          Viewport-Breite                  (Standard: ${DEFAULTS.width})
      --height <px>         Viewport-Höhe                   (Standard: ${DEFAULTS.height})
      --scale <n>           deviceScaleFactor, 2 = Retina    (Standard: ${DEFAULTS.scale})
      --quality <1-100>     JPEG-Qualität                   (Standard: ${DEFAULTS.quality})
  -t, --timeout <ms>        Timeout pro Seite                (Standard: ${DEFAULTS.timeout})
      --wait-until <state>  load|domcontentloaded|networkidle|commit (Standard: ${DEFAULTS.waitUntil})
      --delay <ms>          Zusätzliche Wartezeit vor dem Shot (Standard: ${DEFAULTS.delay})
      --retries <n>         Wiederholungen bei Fehlern       (Standard: ${DEFAULTS.retries})
      --shots-dir <name>    Unterordner für Bilder          (Standard: ${DEFAULTS.shotsDir})
      --thumb-width <px>    Thumbnail-Breite                 (Standard: ${DEFAULTS.thumbWidth})
      --thumb-height <px>   Thumbnail-Höhe                  (Standard: ${DEFAULTS.thumbHeight})
      --user-agent <ua>     Eigener User-Agent
      --color-scheme <s>    light|dark|no-preference
      --proxy <server>      Proxy, z.B. http://127.0.0.1:8080 (Standard: $HTTPS_PROXY)
      --browser-path <pfad> Pfad zur Chromium-Binary

SCHALTER
      --no-full-page        Nur den sichtbaren Viewport aufnehmen
      --no-scroll           Kein Vorab-Scrollen (Lazy-Loading nicht auslösen)
      --no-stabilize        Animationen/Transitions nicht abschalten
      --no-thumbnails       Keine Thumbnails (Report nutzt die Vollbilder)
      --no-report           Nur Screenshots, kein index.html
      --no-sandbox          Chromium ohne Sandbox starten (Docker/CI)
      --no-proxy            Proxy aus der Umgebung ignorieren
      --allow-failures      Exit-Code 0, auch wenn URLs fehlschlagen
  -q, --quiet               Nur Fehler ausgeben
  -h, --help                Diese Hilfe
  -v, --version             Version ausgeben

BEISPIELE
  node screenshotter.js --preset mobile --open
  node screenshotter.js -o public --format jpeg --quality 75
  node screenshotter.js --hide "#cookie-banner,.ad" --delay 1500
  node screenshotter.js -c 8 --retries 3 --timeout 60000

EXIT-CODES
  0  alles erfolgreich (oder --allow-failures)
  1  mindestens eine URL fehlgeschlagen
  2  Bedienfehler (falsche Option, fehlende Datei, ...)
`.trimStart();
}
