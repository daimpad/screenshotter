/**
 * Terminal-Ausgabe: Farben, Symbole und eine Fortschrittszeile, die sich selbst
 * überschreibt. Ohne TTY (Datei, CI, Pipe) fällt alles auf schlichte Zeilen
 * zurück, damit Logdateien lesbar bleiben.
 */

const ESC = '\u001b';

/**
 * Alte Windows-Konsolen zeigen Kästchen statt Symbolen. Windows Terminal setzt
 * WT_SESSION, moderne Terminals TERM_PROGRAM — sonst lieber reines ASCII.
 */
export function supportsUnicode(env = process.env, platform = process.platform) {
  if (platform !== 'win32') return true;
  return Boolean(env.WT_SESSION || env.TERM_PROGRAM || env.ConEmuANSI === 'ON');
}

export function symbolSet(unicode = supportsUnicode()) {
  return unicode
    ? { ok: '✓', redirect: '↻', error: '✗', arrow: '→', barFull: '█', barEmpty: '░', bullet: '·' }
    : { ok: '+', redirect: '>', error: 'x', arrow: '->', barFull: '#', barEmpty: '-', bullet: '-' };
}

/** Balken der Breite `width` für einen Anteil zwischen 0 und 1. */
export function renderBar(fraction, width, symbols) {
  const clamped = Math.max(0, Math.min(1, Number.isFinite(fraction) ? fraction : 0));
  const filled = Math.round(clamped * width);
  return symbols.barFull.repeat(filled) + symbols.barEmpty.repeat(Math.max(0, width - filled));
}

/** Restdauer aus der bisherigen Durchschnittsgeschwindigkeit. */
export function estimateRemaining(elapsedMs, done, total) {
  if (done <= 0 || done >= total) return null;
  return Math.round((elapsedMs / done) * (total - done));
}

export class Reporter {
  /**
   * @param {object} [config]
   * @param {NodeJS.WriteStream} [config.stream]
   * @param {boolean} [config.quiet]  gar keine Ausgabe
   * @param {boolean} [config.color]  ANSI-Farben verwenden
   * @param {boolean} [config.live]   Fortschrittszeile zeichnen
   */
  constructor({ stream = process.stdout, quiet = false, color, live } = {}) {
    this.stream = stream;
    this.quiet = quiet;
    this.isTty = Boolean(stream.isTTY);
    this.color = color ?? (this.isTty && !process.env.NO_COLOR);
    this.live = live ?? (this.isTty && !quiet);
    this.symbols = symbolSet();
    this.barVisible = false;
    this.startedAt = 0;
  }

  paint(code, text) {
    return this.color ? `${ESC}[${code}m${text}${ESC}[0m` : text;
  }

  dim(text) {
    return this.paint('2', text);
  }

  bold(text) {
    return this.paint('1', text);
  }

  green(text) {
    return this.paint('32', text);
  }

  yellow(text) {
    return this.paint('33', text);
  }

  red(text) {
    return this.paint('31', text);
  }

  /** Zeile ausgeben, ohne die Fortschrittsanzeige zu zerhacken. */
  line(text = '') {
    if (this.quiet) return;
    this.clearBar();
    this.stream.write(`${text}\n`);
    this.drawBar();
  }

  clearBar() {
    if (!this.barVisible) return;
    this.stream.write(`\r${ESC}[2K`);
    this.barVisible = false;
  }

  startProgress(total) {
    this.total = total;
    this.done = 0;
    this.failed = 0;
    this.startedAt = Date.now();
    this.drawBar();
  }

  advance({ failed = false } = {}) {
    this.done += 1;
    if (failed) this.failed += 1;
    this.drawBar();
  }

  drawBar() {
    if (!this.live || this.quiet || !this.total || this.done >= this.total) return;

    const width = Math.max(10, Math.min(28, (this.stream.columns || 80) - 46));
    const bar = renderBar(this.done / this.total, width, this.symbols);
    const remaining = estimateRemaining(Date.now() - this.startedAt, this.done, this.total);

    const parts = [`${this.done}/${this.total}`];
    if (this.failed > 0) parts.push(`${this.failed} Fehler`);
    if (remaining !== null) parts.push(`noch ~${Math.max(1, Math.round(remaining / 1000))} s`);

    this.stream.write(`\r${ESC}[2K  ${this.dim(bar)}  ${this.dim(parts.join(` ${this.symbols.bullet} `))}`);
    this.barVisible = true;
  }

  stopProgress() {
    this.clearBar();
    this.total = 0;
  }
}
