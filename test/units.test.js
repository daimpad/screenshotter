/** Unit-Tests ohne Browser: node --test test/units.test.js */

import assert from 'node:assert/strict';
import path from 'node:path';
import { test } from 'node:test';

import { fileNameFor, runPool } from '../lib/capture.js';
import { parseCliArgs, VERSION } from '../lib/cli.js';
import { classify, esc, formatBytes, formatDuration } from '../lib/report.js';
import { normaliseUrl, parseLine, parseUrlList } from '../lib/urls.js';

test('die Versionsnummer steht in package.json und lib/cli.js gleich', async () => {
  // Sie lebt an zwei Stellen: package.json löst das Release aus, VERSION steht
  // im Hilfetext, in der Fußzeile des Reports und in report.json. Laufen die
  // beiden auseinander, meldet ein Release eine andere Nummer als das Werkzeug
  // darin — genau das ist beim Umziehen eines Branches schon passiert.
  const { readFile } = await import('node:fs/promises');
  const { fileURLToPath } = await import('node:url');
  const wurzel = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
  const paket = JSON.parse(await readFile(path.join(wurzel, 'package.json'), 'utf8'));

  assert.equal(VERSION, paket.version, `package.json ${paket.version} ≠ cli.js ${VERSION}`);
});

test('parseLine ignoriert Kommentare und Leerzeilen', () => {
  assert.equal(parseLine(''), null);
  assert.equal(parseLine('   '), null);
  assert.equal(parseLine('# Kommentar'), null);
  assert.equal(parseLine('// auch ein Kommentar'), null);
  assert.deepEqual(parseLine('https://example.com'), { url: 'https://example.com', label: '' });
});

test('parseLine liest optionale Labels', () => {
  assert.deepEqual(parseLine('https://example.com | Startseite'), {
    url: 'https://example.com',
    label: 'Startseite',
  });
});

test('parseLine behandelt "#" in der URL als Fragment, nicht als Kommentar', () => {
  assert.deepEqual(parseLine('https://example.com/docs#anchor'), {
    url: 'https://example.com/docs#anchor',
    label: '',
  });
});

test('normaliseUrl ergänzt fehlende Schemata und lehnt fremde Protokolle ab', () => {
  assert.equal(normaliseUrl('example.com'), 'https://example.com/');
  assert.equal(normaliseUrl('http://example.com/a'), 'http://example.com/a');
  assert.throws(() => normaliseUrl('ftp://example.com'), /Protokoll/);
  assert.throws(() => normaliseUrl('http://'), /Ungültige URL/);
});

test('parseUrlList meldet die fehlerhafte Zeilennummer', () => {
  assert.throws(() => parseUrlList('https://ok.example\n\nftp://nope.example\n'), /Zeile 3/);
});

test('fileNameFor erzeugt stabile, eindeutige Dateinamen', () => {
  assert.equal(fileNameFor('https://www.example.com/preise?x=1', 0, 'png'), '001-example-com-preise-x-1.png');
  assert.equal(fileNameFor('https://example.com', 11, 'jpg'), '012-example-com.jpg');
  // Gleicher Slug, anderer Index -> trotzdem eindeutig.
  assert.notEqual(fileNameFor('https://example.com/', 0, 'png'), fileNameFor('https://example.com/', 1, 'png'));
});

test('fileNameFor kürzt sehr lange URLs und endet nicht auf einem Trennzeichen', () => {
  const name = fileNameFor(`https://example.com/${'a-'.repeat(200)}`, 0, 'png');
  assert.ok(name.length <= 4 + 80 + 4, `zu lang: ${name.length}`);
  assert.ok(!name.includes('-.png'), name);
});

test('runPool hält das Parallelitätslimit ein und behält die Reihenfolge', async () => {
  const items = Array.from({ length: 12 }, (_, index) => index);
  let running = 0;
  let peak = 0;

  const results = await runPool(items, 3, async (item) => {
    running += 1;
    peak = Math.max(peak, running);
    await new Promise((resolve) => setTimeout(resolve, 5));
    running -= 1;
    return item * 2;
  });

  assert.equal(peak, 3);
  assert.deepEqual(results, items.map((item) => item * 2));
});

test('esc maskiert alle HTML-kritischen Zeichen', () => {
  assert.equal(esc(`<img src=x onerror="alert('1')">`), '&lt;img src=x onerror=&quot;alert(&#39;1&#39;)&quot;&gt;');
  assert.equal(esc(null), '');
});

test('classify unterscheidet OK, Weiterleitung und Fehler', () => {
  assert.equal(classify({ status: 200, file: 'a.png' }), 'ok');
  assert.equal(classify({ status: 302, file: 'a.png' }), 'redirect');
  assert.equal(classify({ status: 404, file: 'a.png' }), 'error');
  assert.equal(classify({ status: 200, file: null }), 'error');
  assert.equal(classify({ status: null, file: null, error: 'boom' }), 'error');
});

test('classify erkennt gefolgte Weiterleitungen am abweichenden Ziel', () => {
  const base = { status: 200, file: 'a.png', url: 'https://a.example/x' };
  assert.equal(classify({ ...base, finalUrl: 'https://a.example/x' }), 'ok');
  assert.equal(classify({ ...base, finalUrl: 'https://a.example/y' }), 'redirect');
  // Ein Fehlerstatus wiegt schwerer als die Weiterleitung.
  assert.equal(classify({ ...base, status: 404, finalUrl: 'https://a.example/y' }), 'error');
});

test('Formatierer liefern lesbare Werte', () => {
  assert.equal(formatBytes(0), '–');
  assert.equal(formatBytes(512), '512 B');
  assert.match(formatBytes(1536), /1,5 KB/);
  assert.equal(formatDuration(250), '250 ms');
  assert.match(formatDuration(2500), /2,5 s/);
  assert.match(formatDuration(125000), /2 min 05 s/);
});

test('parseCliArgs übernimmt Defaults und Negationen', () => {
  const defaults = parseCliArgs([]);
  assert.equal(defaults.width, 1440);
  assert.equal(defaults.fullPage, true);
  assert.equal(defaults.thumbnails, true);

  const custom = parseCliArgs(['--width', '800', '--no-full-page', '--no-thumbnails', '-c', '7', 'https://a.example']);
  assert.equal(custom.width, 800);
  assert.equal(custom.fullPage, false);
  assert.equal(custom.thumbnails, false);
  assert.equal(custom.concurrency, 7);
  assert.deepEqual(custom.urls, ['https://a.example']);
});

test('parseCliArgs validiert Werte', () => {
  assert.throws(() => parseCliArgs(['--width', 'breit']), /ganze Zahl/);
  assert.throws(() => parseCliArgs(['--concurrency', '0']), /zwischen 1 und 32/);
  assert.throws(() => parseCliArgs(['--format', 'webp']), /png, jpeg/);
  assert.throws(() => parseCliArgs(['--quality', '50']), /nur für --format jpeg/);
  assert.throws(() => parseCliArgs(['--gibtsnicht']), /Unknown option|Unbekannt/);
});

test('--hide akzeptiert mehrfach und kommagetrennt', () => {
  const options = parseCliArgs(['--hide', '#a,.b', '--hide', '.c']);
  assert.deepEqual(options.hide, ['#a', '.b', '.c']);
});

test('CLI-URLs haben Vorrang vor der Standard-Eingabedatei', async () => {
  const { collectTargets } = await import('../lib/urls.js');

  const cliOnly = await collectTargets({
    inputFile: 'urls.txt',
    cliUrls: ['https://cli.example'],
    inputWasExplicit: false,
  });
  assert.deepEqual(cliOnly.targets.map((target) => target.url), ['https://cli.example/']);
  assert.equal(cliOnly.source, 'CLI-Argumente');

  // Ein ausdrückliches --input kombiniert dagegen bewusst mit den CLI-URLs.
  const combined = await collectTargets({
    inputFile: 'urls.txt',
    cliUrls: ['https://cli.example'],
    inputWasExplicit: true,
  });
  assert.ok(combined.targets.length > 1);
  assert.match(combined.source, /CLI-Argumente \+ urls\.txt/);
});

test('doppelte URLs werden nur einmal erfasst', async () => {
  const { collectTargets } = await import('../lib/urls.js');
  const result = await collectTargets({
    inputFile: '',
    cliUrls: ['https://a.example', 'https://a.example/', 'https://b.example'],
  });
  assert.equal(result.targets.length, 2);
  assert.equal(result.duplicates.length, 1);
});

/* ------------------------------------------------ Klartext-Fehlermeldungen */

test('diagnose übersetzt Chromium-Fehler in Klartext mit Hinweis', async () => {
  const { diagnose } = await import('../lib/diagnose.js');

  const dns = diagnose('page.goto: net::ERR_NAME_NOT_RESOLVED at https://gibtsnicht.example/');
  assert.equal(dns.code, 'ERR_NAME_NOT_RESOLVED');
  assert.equal(dns.message, 'Domain nicht gefunden');
  assert.match(dns.hint, /Schreibweise/);
  // Präfix und Ziel-URL sind aus dem Rohtext entfernt.
  assert.equal(dns.raw, 'ERR_NAME_NOT_RESOLVED');

  assert.equal(diagnose('net::ERR_CONNECTION_REFUSED').code, 'ERR_CONNECTION_REFUSED');
  assert.equal(diagnose('net::ERR_TUNNEL_CONNECTION_FAILED').code, 'ERR_PROXY');
  assert.equal(diagnose('net::ERR_CERT_AUTHORITY_INVALID').code, 'ERR_CERT');
  assert.equal(diagnose('net::ERR_TOO_MANY_REDIRECTS').code, 'ERR_TOO_MANY_REDIRECTS');
  assert.equal(diagnose('net::ERR_UNSAFE_PORT').code, 'ERR_UNSAFE_PORT');
});

test('diagnose rechnet Timeouts in Sekunden um und schlägt einen höheren Wert vor', async () => {
  const { diagnose } = await import('../lib/diagnose.js');

  const result = diagnose('page.goto: Timeout 30000ms exceeded.');
  assert.equal(result.code, 'TIMEOUT');
  assert.equal(result.message, 'Zeitüberschreitung nach 30 s');
  assert.match(result.hint, /--timeout 60000/);
});

test('diagnose behält unbekannte Meldungen bei, aber ohne Playwright-Rauschen', async () => {
  const { diagnose } = await import('../lib/diagnose.js');

  const result = diagnose('page.goto: Etwas ganz Neues ist passiert at https://example.com/x\nCall log:\n  - foo');
  assert.equal(result.code, 'UNKNOWN');
  assert.equal(result.message, 'Etwas ganz Neues ist passiert');
  assert.equal(diagnose(null).message, 'Unbekannter Fehler');
});

/* ---------------------------------------------------- Terminal-Darstellung */

test('Fortschrittsbalken und Restzeit rechnen korrekt', async () => {
  const { renderBar, estimateRemaining, symbolSet, supportsUnicode } = await import('../lib/progress.js');

  const symbols = symbolSet(true);
  assert.equal(renderBar(0, 10, symbols), '░'.repeat(10));
  assert.equal(renderBar(1, 10, symbols), '█'.repeat(10));
  assert.equal(renderBar(0.5, 10, symbols), '█████░░░░░');
  // Werte ausserhalb von 0..1 dürfen den Balken nicht sprengen.
  assert.equal(renderBar(5, 4, symbols).length, 4);
  assert.equal(renderBar(Number.NaN, 4, symbols), '░░░░');

  assert.equal(estimateRemaining(4000, 2, 10), 16000);
  assert.equal(estimateRemaining(4000, 0, 10), null);
  assert.equal(estimateRemaining(4000, 10, 10), null);

  // Alte Windows-Konsolen bekommen ASCII.
  assert.equal(supportsUnicode({}, 'linux'), true);
  assert.equal(supportsUnicode({}, 'win32'), false);
  assert.equal(supportsUnicode({ WT_SESSION: '1' }, 'win32'), true);
  assert.equal(symbolSet(false).ok, '+');
});

test('Reporter schreibt nichts, wenn --quiet gesetzt ist', async () => {
  const { Reporter } = await import('../lib/progress.js');
  const written = [];
  const stream = { write: (text) => written.push(text), isTTY: false, columns: 80 };

  const loud = new Reporter({ stream, quiet: false });
  loud.line('hallo');
  assert.deepEqual(written, ['hallo\n']);

  const quiet = new Reporter({ stream, quiet: true });
  quiet.line('still');
  quiet.startProgress(5);
  quiet.advance();
  assert.deepEqual(written, ['hallo\n'], 'im Quiet-Modus darf nichts dazukommen');
});

test('ohne TTY wird keine Fortschrittszeile gezeichnet', async () => {
  const { Reporter } = await import('../lib/progress.js');
  const written = [];
  const reporter = new Reporter({ stream: { write: (t) => written.push(t), isTTY: false, columns: 80 } });

  reporter.startProgress(4);
  reporter.advance();
  reporter.line('fertig');
  assert.deepEqual(written, ['fertig\n']);
});

/* ------------------------------------------------------------ Öffnen-Hilfe */

test('openCommand wählt das richtige Kommando je Plattform', async () => {
  const { openCommand } = await import('../lib/open.js');

  assert.deepEqual(openCommand('a.html', 'win32'), { command: 'cmd', args: ['/c', 'start', '', 'a.html'] });
  assert.deepEqual(openCommand('a.html', 'darwin'), { command: 'open', args: ['a.html'] });
  assert.deepEqual(openCommand('a.html', 'linux'), { command: 'xdg-open', args: ['a.html'] });
});

/* -------------------------------------------------------------- Geräteprofile */

test('--preset setzt Viewport, Skalierung und Mobil-Emulation', () => {
  const mobile = parseCliArgs(['--preset', 'mobile']);
  assert.equal(mobile.width, 390);
  assert.equal(mobile.height, 844);
  assert.equal(mobile.scale, 2);
  assert.equal(mobile.emulateMobile, true);

  const desktop = parseCliArgs(['-p', 'desktop']);
  assert.equal(desktop.width, 1440);
  assert.equal(desktop.emulateMobile, false);

  assert.throws(() => parseCliArgs(['--preset', 'fernseher']), /desktop, laptop, tablet, mobile/);
});

test('einzelne Viewport-Angaben schlagen das Geräteprofil', () => {
  const options = parseCliArgs(['--preset', 'mobile', '--width', '500']);
  assert.equal(options.width, 500, 'explizite Breite gewinnt');
  assert.equal(options.height, 844, 'der Rest kommt weiter aus dem Profil');
  assert.equal(options.scale, 2);
});

test('--init und --open werden erkannt', () => {
  assert.equal(parseCliArgs(['--init']).init, true);
  assert.equal(parseCliArgs(['--open']).open, true);
  assert.equal(parseCliArgs([]).init, false);
  assert.equal(parseCliArgs([]).open, false);
});

test('der Hilfetext nennt Schnellstart, Profile und Exit-Codes', async () => {
  const { helpText } = await import('../lib/cli.js');
  const text = helpText();

  for (const marker of ['SO GEHT ES LOS', 'GERÄTEPROFILE', '--open', '--init', 'EXIT-CODES']) {
    assert.ok(text.includes(marker), `"${marker}" fehlt in der Hilfe`);
  }
});

test('das Install-Kommando für Chromium zeigt auf eine vorhandene Datei', async () => {
  const { chromiumInstallCommand } = await import('../lib/capture.js');
  const { existsSync } = await import('node:fs');

  const spec = chromiumInstallCommand();
  assert.equal(spec.command, process.execPath);
  assert.deepEqual(spec.args.slice(1), ['install', 'chromium']);
  assert.ok(existsSync(spec.args[0]), `Playwright-CLI nicht gefunden: ${spec.args[0]}`);
});

test('--open zusammen mit --no-report wird abgelehnt', () => {
  assert.throws(() => parseCliArgs(['--open', '--no-report']), /schließen sich aus/);
});

/* ------------------------------------------------------- Absicherung (rein) */

test('checkWriteRequest lässt nur Anfragen der eigenen Oberfläche durch', async () => {
  const { checkWriteRequest } = await import('../lib/server.js');
  const token = 'geheim';
  const host = '127.0.0.1:8080';
  const gut = { 'content-type': 'application/json', 'x-screenshotter-token': token };

  // Lesen ist immer erlaubt.
  assert.equal(checkWriteRequest({ method: 'GET', headers: {}, token, host }).ok, true);

  assert.equal(checkWriteRequest({ method: 'POST', headers: gut, token, host }).ok, true);
  assert.equal(
    checkWriteRequest({ method: 'POST', headers: { ...gut, 'content-type': 'application/json; charset=utf-8' }, token, host }).ok,
    true,
    'ein angehängtes charset darf nicht stören',
  );

  // Ein Formular kommt ohne Preflight nur mit diesen Typen durch — alle abgelehnt.
  for (const typ of ['text/plain', 'application/x-www-form-urlencoded', 'multipart/form-data', '']) {
    const ergebnis = checkWriteRequest({ method: 'POST', headers: { ...gut, 'content-type': typ }, token, host });
    assert.equal(ergebnis.ok, false, `${typ || '(leer)'} müsste abgelehnt werden`);
  }

  assert.equal(checkWriteRequest({ method: 'POST', headers: { 'content-type': 'application/json' }, token, host }).ok, false);
  assert.equal(checkWriteRequest({ method: 'POST', headers: { ...gut, 'x-screenshotter-token': 'falsch' }, token, host }).ok, false);
  assert.equal(checkWriteRequest({ method: 'POST', headers: { ...gut, origin: 'http://boese.example' }, token, host }).ok, false);
  assert.equal(checkWriteRequest({ method: 'POST', headers: { ...gut, 'sec-fetch-site': 'cross-site' }, token, host }).ok, false);

  // Die eigene Herkunft ist in Ordnung.
  assert.equal(checkWriteRequest({ method: 'POST', headers: { ...gut, origin: `http://${host}` }, token, host }).ok, true);
  assert.equal(checkWriteRequest({ method: 'POST', headers: { ...gut, 'sec-fetch-site': 'same-origin' }, token, host }).ok, true);
});

test('resolveWithin verkraftet kaputte Kodierung und Null-Bytes', async () => {
  const { resolveWithin } = await import('../lib/server.js');

  // Darf nicht werfen — sonst antwortet der Server mit 500 statt 400.
  assert.equal(resolveWithin('/var/report', '/%zz'), null);
  assert.equal(resolveWithin('/var/report', '/%'), null);
  assert.equal(resolveWithin('/var/report', '/a%00b'), null);
  assert.equal(resolveWithin('/var/report', '/gut.html'), path.resolve('/var/report/gut.html'));
});

test('ensureOutputDir übersetzt Dateisystemfehler in Klartext', async () => {
  const { ensureOutputDir } = await import('../screenshotter.js');
  const { mkdtemp, writeFile } = await import('node:fs/promises');
  const os = await import('node:os');

  const dir = await mkdtemp(path.join(os.tmpdir(), 'screenshotter-out-'));
  const datei = path.join(dir, 'eine-datei');
  await writeFile(datei, 'x');

  await assert.rejects(() => ensureOutputDir(datei), /ist eine Datei, kein Ordner/);
  await assert.rejects(() => ensureOutputDir(path.join(datei, 'darunter')), /ist eine Datei, kein Ordner/);
  // Ein gültiger Ordner geht durch.
  await ensureOutputDir(path.join(dir, 'neu', 'tiefer'));
});
