/**
 * Übersetzt technische Playwright-/Chromium-Fehler in Klartext plus Hinweis,
 * was dagegen hilft. Rohtext wie
 *
 *   page.goto: net::ERR_NAME_NOT_RESOLVED at https://gibtsnicht.example/
 *
 * wird zu "Domain nicht gefunden" + "Schreibweise der URL prüfen ...".
 */

/** Reihenfolge zählt: die erste passende Regel gewinnt. */
const RULES = [
  {
    code: 'ERR_NAME_NOT_RESOLVED',
    match: /ERR_NAME_NOT_RESOLVED/,
    message: 'Domain nicht gefunden',
    hint: 'Schreibweise der URL prüfen. Existiert die Domain und ist DNS erreichbar?',
  },
  {
    code: 'ERR_CONNECTION_REFUSED',
    match: /ERR_CONNECTION_REFUSED/,
    message: 'Server nimmt keine Verbindung an',
    hint: 'Läuft der Server und stimmt der Port? Bei lokalen Adressen den Dienst starten.',
  },
  {
    code: 'ERR_CONNECTION_TIMED_OUT',
    match: /ERR_CONNECTION_TIMED_OUT|ERR_ADDRESS_UNREACHABLE/,
    message: 'Server antwortet nicht',
    hint: 'Firewall oder VPN im Weg? Mit --timeout mehr Zeit geben.',
  },
  {
    code: 'ERR_CONNECTION_CLOSED',
    match: /ERR_CONNECTION_CLOSED|ERR_CONNECTION_RESET|ERR_EMPTY_RESPONSE/,
    message: 'Server hat die Verbindung abgebrochen',
    hint: 'Oft eine Schutzfunktion gegen viele parallele Zugriffe: mit -c 1 erneut versuchen.',
  },
  {
    code: 'ERR_INTERNET_DISCONNECTED',
    match: /ERR_INTERNET_DISCONNECTED|ERR_NETWORK_CHANGED/,
    message: 'Keine Internetverbindung',
    hint: 'Netzwerkverbindung prüfen und den Lauf wiederholen.',
  },
  {
    code: 'ERR_PROXY',
    match: /ERR_TUNNEL_CONNECTION_FAILED|ERR_PROXY_CONNECTION_FAILED|ERR_PROXY_AUTH/,
    message: 'Proxy hat die Verbindung abgelehnt',
    hint: 'Mit --proxy den richtigen Server setzen oder mit --no-proxy den Proxy umgehen.',
  },
  {
    code: 'ERR_CERT',
    match: /ERR_CERT_|ERR_SSL_|SSL_ERROR|ERR_BAD_SSL/,
    message: 'Problem mit dem HTTPS-Zertifikat',
    hint: 'Zeigt die Seite wirklich https an? Ein http:// in der Liste hilft bei Testservern.',
  },
  {
    code: 'ERR_TOO_MANY_REDIRECTS',
    match: /ERR_TOO_MANY_REDIRECTS/,
    message: 'Weiterleitungsschleife',
    hint: 'Die Seite leitet endlos im Kreis. Meist fehlt ein Cookie oder eine Anmeldung.',
  },
  {
    code: 'ERR_BLOCKED',
    match: /ERR_BLOCKED_BY_|ERR_ACCESS_DENIED/,
    message: 'Zugriff wurde blockiert',
    hint: 'Bot-Schutz oder Geoblocking. Ein eigener --user-agent hilft manchmal.',
  },
  {
    code: 'ERR_UNSAFE_PORT',
    match: /ERR_UNSAFE_PORT/,
    message: 'Port von Chromium gesperrt',
    hint: 'Chromium blockiert bestimmte Ports wie 1, 22 oder 25. Anderen Port verwenden.',
  },
  {
    code: 'ERR_HTTP2',
    match: /ERR_HTTP2_|ERR_SPDY_/,
    message: 'Protokollfehler beim Laden',
    hint: 'Meist vorübergehend. Mit --retries 3 erneut versuchen.',
  },
  {
    code: 'ERR_ABORTED',
    match: /ERR_ABORTED/,
    message: 'Laden wurde abgebrochen',
    hint: 'Häufig eine sofortige Weiterleitung per JavaScript. --wait-until domcontentloaded hilft oft.',
  },
];

/** Playwright-Rauschen entfernen: Präfix, Ziel-URL, Call-Log. */
function tidy(raw) {
  return String(raw ?? '')
    .split('\n')[0]
    .replace(/^(page|browserType|browserContext|locator)\.\w+:\s*/, '')
    .replace(/\s+at\s+https?:\/\/\S+$/, '')
    .replace(/^net::/, '')
    .trim();
}

/**
 * @param {string} raw       Originalmeldung
 * @param {{ timeout?: number }} [context]
 * @returns {{ code: string, message: string, hint: string, raw: string }}
 */
export function diagnose(raw, context = {}) {
  const text = String(raw ?? '');
  const cleaned = tidy(text);

  for (const rule of RULES) {
    if (rule.match.test(text)) {
      return { code: rule.code, message: rule.message, hint: rule.hint, raw: cleaned };
    }
  }

  const timeoutMatch = text.match(/Timeout\s+(\d+)\s*ms\s+exceeded/i);
  if (timeoutMatch) {
    const seconds = Math.round(Number(timeoutMatch[1]) / 1000);
    const next = Math.max(60000, Number(timeoutMatch[1]) * 2);
    return {
      code: 'TIMEOUT',
      message: `Zeitüberschreitung nach ${seconds} s`,
      hint: `Seite braucht länger: --timeout ${next} setzen, notfalls zusätzlich --wait-until domcontentloaded.`,
      raw: cleaned,
    };
  }

  if (/Executable doesn't exist|Failed to launch|browserType\.launch/i.test(text)) {
    return {
      code: 'BROWSER',
      message: 'Browser konnte nicht gestartet werden',
      hint: 'Einmalig "npx playwright install chromium" ausführen.',
      raw: cleaned,
    };
  }

  return {
    code: 'UNKNOWN',
    message: cleaned || 'Unbekannter Fehler',
    hint: context.timeout ? 'Mit --retries 2 erneut versuchen; bleibt es dabei, die URL im Browser öffnen.' : '',
    raw: cleaned,
  };
}
