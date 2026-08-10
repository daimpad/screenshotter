/** Winziger Test-Webserver mit deterministischen Seiten für die E2E-Tests. */

import http from 'node:http';

const STYLE = `
  * { box-sizing: border-box; }
  body { margin: 0; font: 16px/1.5 system-ui, sans-serif; color: #16192b; background: #fff; }
  header { position: sticky; top: 0; background: #3b5bdb; color: #fff; padding: 1rem; font-weight: 700; }
  section { padding: 2rem 1.5rem; border-bottom: 1px solid #e2e6f2; }
  .block { height: 600px; background: linear-gradient(#eef1f8, #dfe3ee); margin: 1rem 0; }
  .spin { width: 60px; height: 60px; background: #b3261e; animation: spin 1s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }
`;

const PAGES = {
  '/tall': `<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Lange Testseite</title>
    <style>${STYLE}</style></head><body>
    <header>Sticky Header</header>
    <section><h1>Lange Testseite</h1><p>Diese Seite ist deutlich höher als der Viewport.</p><div class="spin"></div></section>
    <section><div class="block"></div></section>
    <section><div class="block"></div></section>
    <section><div class="block"></div></section>
    <section id="lazy"><p>Platzhalter</p></section>
    <script>
      // Inhalt, der erst beim Scrollen erscheint (Lazy-Loading-Simulation).
      var target = document.getElementById('lazy');
      new IntersectionObserver(function (entries, observer) {
        if (!entries[0].isIntersecting) return;
        observer.disconnect();
        var extra = document.createElement('div');
        extra.className = 'block';
        extra.id = 'lazy-loaded';
        target.appendChild(extra);
      }).observe(target);
    </script>
    </body></html>`,

  '/short': `<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Kurze Testseite</title>
    <style>${STYLE}</style></head><body>
    <header>Sticky Header</header>
    <section><h1>Kurze Testseite</h1><p>Passt komplett in den Viewport.</p></section>
    </body></html>`,

  '/missing': `<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Nicht gefunden</title>
    <style>${STYLE}</style></head><body><section><h1>404</h1><p>Diese Seite gibt es nicht.</p></section></body></html>`,

  // Bewusst ohne Viewport-Meta: solche Seiten rendert Chromium im Mobil-Modus
  // mit 980px Layoutbreite und skaliert sie herunter — genau wie ein echtes Handy.
  '/legacy': `<!doctype html><html lang="de"><head><meta charset="utf-8"><title>Alte Seite</title>
    <style>${STYLE}</style></head><body>
    <header>Sticky Header</header>
    <section><h1>Ohne Viewport-Meta</h1><p>Nicht für Mobilgeräte ausgelegt.</p></section>
    </body></html>`,

  '/quotes': `<!doctype html><html lang="de"><head><meta charset="utf-8">
    <title>&quot;&gt;&lt;img src=x onerror=alert(1)&gt; &amp; &#39;Anführungszeichen&#39;</title>
    <style>${STYLE}</style></head><body><section><h1>XSS-Test</h1></section></body></html>`,
};

/** Startet den Server auf einem freien Port und liefert `{ origin, close }`. */
export async function startServer() {
  const server = http.createServer((request, response) => {
    const url = new URL(request.url, 'http://localhost');

    if (url.pathname === '/slow') {
      setTimeout(() => {
        response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        response.end(PAGES['/short']);
      }, 1200);
      return;
    }

    if (url.pathname === '/redirect') {
      response.writeHead(302, { location: '/short' });
      response.end();
      return;
    }

    if (url.pathname === '/missing') {
      response.writeHead(404, { 'content-type': 'text/html; charset=utf-8' });
      response.end(PAGES['/missing']);
      return;
    }

    const body = PAGES[url.pathname];
    if (!body) {
      response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      response.end('not found');
      return;
    }

    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end(body);
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();

  return {
    origin: `http://127.0.0.1:${port}`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

/**
 * Liefert eine URL auf einen garantiert geschlossenen Port: kurz binden,
 * Port merken, wieder freigeben. Erzeugt einen reproduzierbaren Verbindungsfehler
 * ohne DNS-Abhängigkeit und ohne Chromiums gesperrte Ports zu treffen.
 */
export async function reservedDeadOrigin() {
  const probe = http.createServer();
  await new Promise((resolve) => probe.listen(0, '127.0.0.1', resolve));
  const { port } = probe.address();
  await new Promise((resolve) => probe.close(resolve));
  return `http://127.0.0.1:${port}`;
}

/** Einen garantiert freien Port ermitteln (kurz binden, wieder freigeben). */
export async function freePort() {
  const probe = http.createServer();
  await new Promise((resolve) => probe.listen(0, '127.0.0.1', resolve));
  const { port } = probe.address();
  await new Promise((resolve) => probe.close(resolve));
  return port;
}

/** Breite und Höhe eines PNG aus dem IHDR-Chunk lesen. */
export function pngSize(buffer) {
  if (buffer.length < 24 || buffer.readUInt32BE(0) !== 0x89504e47) {
    throw new Error('Keine gültige PNG-Datei');
  }
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}
