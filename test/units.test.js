/** Unit-Tests ohne Browser: node --test test/units.test.js */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { fileNameFor, runPool } from '../lib/capture.js';
import { parseCliArgs } from '../lib/cli.js';
import { classify, esc, formatBytes, formatDuration } from '../lib/report.js';
import { normaliseUrl, parseLine, parseUrlList } from '../lib/urls.js';

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
