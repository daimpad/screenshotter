/**
 * Erzeugt den anklickbaren Demo-Report unter docs/demo/ — die Vorschau auf
 * GitHub Pages.
 *
 *   npm run demo
 *
 * Die Beispielseiten werden lokal ausgeliefert. Damit im Report lesbare URLs
 * stehen statt "127.0.0.1:49321", läuft der Server möglichst unter der für
 * Tests reservierten Domain demo.screenshotter.test. Das braucht einen Eintrag
 * in /etc/hosts und Port 80, also Administratorrechte. Fehlen die, weicht das
 * Skript auf 127.0.0.1 aus — der Report sieht dann genauso aus, nur die URLs
 * sind weniger hübsch.
 */
import { spawn } from 'node:child_process';
import { appendFileSync, readFileSync } from 'node:fs';
import { mkdir, rm } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const OUT = path.join(ROOT, 'docs', 'demo');
const PRETTY_HOST = 'demo.screenshotter.test';

/** Versucht den hübschen Hostnamen; meldet zurück, ob es geklappt hat. */
function tryPrettyHost() {
  try {
    if (!readFileSync('/etc/hosts', 'utf8').includes(PRETTY_HOST)) {
      appendFileSync('/etc/hosts', `\n127.0.0.1 ${PRETTY_HOST}\n`);
    }
    return true;
  } catch {
    return false;
  }
}

const CSS = `
  *{box-sizing:border-box}
  body{margin:0;font:16px/1.65 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;color:#1d2333;background:#fff}
  a{color:inherit}
  .top{position:sticky;top:0;z-index:5;display:flex;align-items:center;gap:2.5rem;
       padding:1.1rem 3rem;background:#0e1424;color:#fff}
  .top b{font-size:1.15rem;letter-spacing:-.02em}
  .top nav{display:flex;gap:1.6rem;font-size:.9rem;color:#a9b3cc}
  .hero{padding:6rem 3rem;background:linear-gradient(120deg,#2f4bd6 0%,#7048e8 60%,#9c36b5 100%);color:#fff}
  .hero h1{margin:0 0 1rem;font-size:3.4rem;line-height:1.1;letter-spacing:-.035em;max-width:22ch}
  .hero p{margin:0;font-size:1.25rem;opacity:.92;max-width:46ch}
  .hero .cta{display:inline-block;margin-top:2.2rem;padding:.85rem 1.6rem;border-radius:10px;
             background:#fff;color:#2f4bd6;font-weight:650}
  main{max-width:74rem;margin:0 auto;padding:4rem 3rem}
  h2{font-size:2rem;letter-spacing:-.025em;margin:0 0 1.5rem}
  h3{margin:0 0 .5rem;font-size:1.05rem}
  p{color:#4a5268}
  .cards{display:grid;grid-template-columns:repeat(3,1fr);gap:1.5rem;margin:2rem 0 3.5rem}
  .card{padding:1.8rem;border:1px solid #e3e7f0;border-radius:14px;background:#fafbfe}
  .card .dot{width:2.4rem;height:2.4rem;border-radius:9px;background:#2f4bd6;margin-bottom:1rem;opacity:.15}
  .band{padding:3.5rem 3rem;background:#f5f7fc;border-top:1px solid #e3e7f0;border-bottom:1px solid #e3e7f0}
  .band .inner{max-width:74rem;margin:0 auto}
  table{width:100%;border-collapse:collapse;margin:2rem 0}
  th,td{padding:.9rem 1rem;border-bottom:1px solid #e3e7f0;text-align:left}
  th{background:#f5f7fc;font-size:.8rem;text-transform:uppercase;letter-spacing:.06em;color:#5d6479}
  .tiles{display:grid;grid-template-columns:repeat(4,1fr);gap:1.2rem}
  .tile{aspect-ratio:4/3;border-radius:12px;background:linear-gradient(135deg,#dfe5f6,#eef1f9)}
  .price{display:grid;grid-template-columns:repeat(3,1fr);gap:1.5rem;margin:2.5rem 0}
  .price div{padding:2rem;border:1px solid #e3e7f0;border-radius:14px;text-align:center}
  .price .big{font-size:2.4rem;font-weight:700;letter-spacing:-.03em;margin:.6rem 0}
  .price .featured{border-color:#2f4bd6;box-shadow:0 12px 36px rgba(47,75,214,.14)}
  footer{padding:3.5rem 3rem;background:#0e1424;color:#8f99b3;font-size:.9rem}
`;

const shell = (title, body) => `<!doctype html><html lang="de"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>
<style>${CSS}</style></head><body>
<div class="top"><b>Nordlicht Studio</b><nav><a href="/">Start</a><a href="/leistungen">Leistungen</a>
<a href="/referenzen">Referenzen</a><a href="/preise">Preise</a><a href="/team">Team</a>
<a href="/journal">Journal</a><a href="/kontakt">Kontakt</a></nav></div>
${body}
<footer>© 2026 Nordlicht Studio · Impressum · Datenschutz · Diese Seiten dienen nur der Demonstration.</footer>
</body></html>`;

const card = (t, d) => `<div class="card"><div class="dot"></div><h3>${t}</h3><p>${d}</p></div>`;
const rows = (n, prefix) =>
  Array.from({ length: n }, (_, i) => `<tr><td>${prefix} ${i + 1}</td><td>Beschreibung des Eintrags ${i + 1}</td><td>${(i + 1) * 340} €</td></tr>`).join('');
const tiles = (n) => Array.from({ length: n }, () => '<div class="tile"></div>').join('');

const PAGES = {
  '/': shell('Nordlicht Studio — Digitale Produkte aus Kiel', `
    <div class="hero"><h1>Digitale Produkte, die man gerne benutzt.</h1>
    <p>Wir gestalten und bauen Websites, Portale und Anwendungen — von der ersten Skizze bis zum Betrieb.</p>
    <a class="cta" href="/kontakt">Projekt anfragen</a></div>
    <main><h2>Was wir machen</h2>
    <div class="cards">${card('Strategie', 'Positionierung, Informationsarchitektur und ein Plan, der trägt.')}
    ${card('Gestaltung', 'Designsysteme, die auch nach dem dritten Relaunch noch zusammenpassen.')}
    ${card('Umsetzung', 'Sauberer Code, messbare Ladezeiten, dokumentierte Übergabe.')}</div>
    <h2>Ausgewählte Arbeiten</h2><div class="tiles">${tiles(8)}</div></main>
    <div class="band"><div class="inner"><h2>Zahlen</h2><table>
    <tr><th>Leistung</th><th>Beschreibung</th><th>ab</th></tr>${rows(6, 'Paket')}</table></div></div>
    <main><h2>Kundenstimmen</h2><div class="cards">
    ${card('Stadtwerke Nord', '„Termin gehalten, Budget gehalten, Ergebnis besser als geplant."')}
    ${card('Verlag Küste', '„Die Übergabe war so gut dokumentiert, dass wir sofort weiterarbeiten konnten."')}
    ${card('Werft & Co.', '„Endlich eine Seite, die auf dem Handy funktioniert."')}</div></main>`),

  '/leistungen': shell('Leistungen — Nordlicht Studio', `
    <main><h2>Leistungen</h2><p>Vier Bereiche, die aufeinander aufbauen.</p>
    <div class="cards">${card('Discovery', 'Interviews, Analyse, Zieldefinition.')}
    ${card('Designsystem', 'Komponenten, Raster, Farben, Dokumentation.')}
    ${card('Entwicklung', 'Frontend, Backend, Schnittstellen.')}
    ${card('Betrieb', 'Monitoring, Updates, Weiterentwicklung.')}
    ${card('Barrierefreiheit', 'Prüfung nach WCAG 2.2 und Nachbesserung.')}
    ${card('Schulung', 'Damit euer Team selbst weitermachen kann.')}</div>
    <table><tr><th>Baustein</th><th>Beschreibung</th><th>ab</th></tr>${rows(8, 'Baustein')}</table></main>`),

  '/referenzen': shell('Referenzen — Nordlicht Studio', `
    <main><h2>Referenzen</h2><p>Eine Auswahl der letzten drei Jahre.</p>
    <div class="tiles">${tiles(12)}</div></main>
    <div class="band"><div class="inner"><div class="tiles">${tiles(4)}</div></div></div>`),

  '/preise': shell('Preise — Nordlicht Studio', `
    <main><h2>Preise</h2><p>Transparent, ohne Kleingedrucktes.</p>
    <div class="price">
    <div><h3>Kompakt</h3><div class="big">4.900 €</div><p>Für einen klaren Auftritt mit bis zu zehn Seiten.</p></div>
    <div class="featured"><h3>Standard</h3><div class="big">12.400 €</div><p>Designsystem, Redaktionssystem, Schulung.</p></div>
    <div><h3>Individuell</h3><div class="big">nach Aufwand</div><p>Portale, Anwendungen, Schnittstellen.</p></div></div>
    <table><tr><th>Position</th><th>Beschreibung</th><th>Preis</th></tr>${rows(5, 'Position')}</table></main>`),

  '/team': shell('Team — Nordlicht Studio', `
    <main><h2>Team</h2><p>Neun Menschen, ein Büro am Hafen.</p>
    <div class="cards">${card('Anke R.', 'Strategie und Projektleitung')}${card('Bendix M.', 'Gestaltung')}
    ${card('Clara S.', 'Frontend')}${card('Deniz K.', 'Backend')}${card('Elif T.', 'Barrierefreiheit')}
    ${card('Finn O.', 'Betrieb')}</div></main>`),

  '/journal': shell('Journal — Nordlicht Studio', `
    <main><h2>Journal</h2><p>Gedanken zu Gestaltung und Handwerk.</p>
    <table><tr><th>Datum</th><th>Beitrag</th><th>Lesezeit</th></tr>
    <tr><td>04.08.2026</td><td>Warum Designsysteme scheitern</td><td>6 min</td></tr>
    <tr><td>21.07.2026</td><td>Ladezeit ist ein Gestaltungsthema</td><td>4 min</td></tr>
    <tr><td>02.07.2026</td><td>Was eine gute Übergabe ausmacht</td><td>8 min</td></tr>
    <tr><td>15.06.2026</td><td>Kontrast richtig prüfen</td><td>5 min</td></tr></table></main>`),

  '/kontakt': shell('Kontakt — Nordlicht Studio', `
    <main><h2>Kontakt</h2><p>Wir melden uns innerhalb eines Werktags.</p>
    <p>Nordlicht Studio · Hafenstraße 12 · 24103 Kiel<br>hallo@nordlicht.example · 0431 123456</p></main>`),
};

const server = http.createServer((request, response) => {
  const { pathname } = new URL(request.url, 'http://x');

  if (pathname === '/karriere') {
    response.writeHead(301, { location: '/team' });
    return response.end();
  }
  if (pathname === '/alt-produkt') {
    response.writeHead(410, { 'content-type': 'text/html; charset=utf-8' });
    return response.end(shell('Nicht mehr verfügbar', '<main><h2>410 — dieses Angebot gibt es nicht mehr</h2><p>Bitte die aktuelle Leistungsübersicht ansehen.</p></main>'));
  }

  const body = PAGES[pathname];
  response.writeHead(body ? 200 : 404, { 'content-type': 'text/html; charset=utf-8' });
  response.end(body ?? shell('Seite nicht gefunden', '<main><h2>404 — Seite nicht gefunden</h2></main>'));
});

let origin;
if (tryPrettyHost()) {
  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(80, '127.0.0.1', resolve);
    });
    origin = `http://${PRETTY_HOST}`;
  } catch {
    server.removeAllListeners('error');
  }
}

if (!origin) {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
  console.log('Hinweis: ohne Administratorrechte laufen die Beispielseiten unter', origin);
}
console.log('Beispielseiten:', origin);

await rm(OUT, { recursive: true, force: true });
await mkdir(OUT, { recursive: true });

const urls = ['/', '/leistungen', '/referenzen', '/preise', '/team', '/journal', '/kontakt', '/karriere', '/alt-produkt']
  .map((page) => `${origin}${page}`);
// Absichtlich unerreichbar: zeigt im Report den Fehlerzustand samt Hinweis.
urls.push('http://nicht-erreichbar.screenshotter.test/');

const child = spawn(
  process.execPath,
  [path.join(ROOT, 'screenshotter.js'), '--out', OUT, '--no-proxy', '--retries', '0',
    '--title', 'Demo-Report — Nordlicht Studio', '--allow-failures', ...urls],
  { stdio: 'inherit', env: { ...process.env, NO_COLOR: '1' } },
);
const code = await new Promise((resolve) => child.on('close', resolve));
await new Promise((resolve) => server.close(resolve));

console.log(code === 0 ? `\nDemo-Report liegt in ${OUT}` : `\nAbgebrochen mit Code ${code}`);
process.exitCode = code === 0 ? 0 : 1;
