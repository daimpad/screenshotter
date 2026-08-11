# Sicherheit

`screenshotter` läuft auf dem eigenen Rechner und lädt auf Zuruf beliebige
Webseiten. Das ist der Zweck des Werkzeugs — und zugleich der Grund, warum ein
paar Dinge bewusst eng geschnürt sind.

## Was schützenswert ist

Das Werkzeug kann zwei Dinge, die in falschen Händen schaden:

1. **Es holt URLs ab.** Wer bestimmt, welche URL geladen wird, kann den Browser
   auf dem Rechner des Nutzers Adressen aufrufen lassen, die von außen nicht
   erreichbar sind — Router-Oberflächen, Intranet, `localhost`-Dienste.
2. **Es schreibt Dateien.** Screenshots und ein `index.html` landen in einem
   frei wählbaren Ordner.

Solange **der Nutzer** bestimmt, ist beides gewollt. Gefährlich wird es erst,
wenn jemand anders bestimmen kann.

## Die Weboberfläche

`--serve` startet einen HTTP-Dienst ohne Anmeldung. Dagegen stehen:

| Maßnahme | Wogegen |
|---|---|
| Bindung nur an `127.0.0.1` | Zugriff aus dem Netz |
| Prüfung des `Host`-Headers | DNS-Rebinding: eine fremde Seite lässt ihren Namen auf `127.0.0.1` zeigen |
| Sitzungsmerkmal je Serverstart, verlangt bei jedem `POST` | Cross-Site Request Forgery |
| Nur `application/json` bei `POST` | Formular-POSTs fremder Seiten (die lösen keinen CORS-Preflight aus) |
| Abgleich von `Origin` und `Sec-Fetch-Site` | dasselbe, zweite Linie |
| `frame-ancestors 'none'` und `X-Frame-Options` | Clickjacking über einen unsichtbaren Rahmen |
| `resolveWithin()` beim Ausliefern des Reports | Pfad-Traversal, auch prozentkodiert und mit Null-Bytes |
| Allowlist der Asset-Dateien | Ausliefern von Quelltext |
| 1 MB je Anfrage, 12 Ereignisströme, 2000 URLs je Auftrag, ein Lauf zur Zeit | Erschöpfung von Speicher und Verbindungen |
| Proxy-Adresse nicht in `/api/state` | interne Adressen im Browser |
| Alle Formularwerte serverseitig geprüft | manipulierte Anfragen |

Jede dieser Maßnahmen hat einen Test in
[`test/server.test.js`](test/server.test.js) — darunter ein echter
Angriffsversuch: eine fremde Seite, die per Formular einen Lauf auszulösen
versucht.

**Wer `--host` umstellt**, hebt die erste Linie auf. Der Dienst warnt dann beim
Start. Das Sitzungsmerkmal schützt weiterhin vor fremden Seiten, aber jeder im
selben Netz kann die Oberfläche bedienen. Nur in vertrauenswürdigen Netzen
verwenden.

## Der Auslöser auf dem Webserver

`deploy/webhook.php` ist der einzige Teil dieses Werkzeugs, der öffentlich
erreichbar sein soll. Entsprechend eng ist er geschnürt:

| Maßnahme | Wogegen |
|---|---|
| Nimmt **keine** Parameter entgegen | Ein Auslöser, dem man sagen kann, *was* er aufnehmen soll, ist ein offener Anfrage-Weiterleiter — er würde fremde und interne Adressen für den Aufrufer abrufen |
| `hash_equals` statt `===` | Ein abbrechender Vergleich verrät über die Laufzeit, wie viele Zeichen des Geheimnisses stimmen |
| Leeres Geheimnis lehnt **alles** ab | Eine halbfertige Einrichtung soll kein offenes Tor sein |
| Nur `POST` | Ein Lauf ist kein Abruf; Vorschaudienste und Crawler lösen nichts aus |
| Mindestabstand zwischen Läufen | Flut durch jemanden, der das Geheimnis hat |
| Sperrverzeichnis per `mkdir` (atomar) | Zwei Chromium-Rudel gleichzeitig |
| Meldungen ohne Pfadangaben | Verrät die Verzeichnisstruktur nicht |

Das Geheimnis steht in `deploy/screenshotter.conf`, und die gehört **außerhalb
des Webverzeichnisses** und auf `600`. Die Anleitung in
[`deploy/README.md`](deploy/README.md) sagt, wie man das nachprüft.

Wer den Webhook nicht braucht, lädt `webhook.php` einfach nicht ins
Webverzeichnis hoch — dann gibt es diese Angriffsfläche nicht.

## Der erzeugte Report

`index.html` enthält Seitentitel und URLs der aufgenommenen Seiten — also Text
aus fremder Quelle. Alles davon wird HTML-escaped; ein
[Test](test/e2e.test.js) prüft das mit einem echten Ausbruchsversuch als
Seitentitel und stellt sicher, dass im Browser kein Element daraus entsteht.

Die Proxy-Adresse wird bewusst **nicht** in `report.json` geschrieben, damit
interne Adressen nicht in einem veröffentlichten Report landen.

## Beim Aufnehmen

* Nur `http` und `https` sind erlaubt. `file://` und `javascript:` werden mit
  Zeilennummer abgelehnt — sonst ließe sich die Weboberfläche zum Auslesen
  lokaler Dateien missbrauchen.
* Downloads sind abgeschaltet (`acceptDownloads: false`); eine URL kann so keine
  beliebig große Datei auf die Platte schreiben.
* Dialoge (`alert`, `confirm`) werden automatisch weggeklickt, damit eine Seite
  den Lauf nicht anhalten kann.
* Jede Seite läuft in einem eigenen Browser-Kontext — keine geteilten Cookies.

## Was das Werkzeug **nicht** leistet

* **Keine Sandbox für fremde Seiten.** Es startet einen echten Browser. Wer eine
  bösartige Seite fotografiert, setzt ihr denselben Browser aus wie beim
  normalen Surfen. Chromiums eigene Sandbox greift; `--no-sandbox` schaltet sie
  ab und gehört nur in Wegwerf-Container.
* **Keine Rechteverwaltung.** Alles läuft mit den Rechten des aufrufenden
  Nutzers und kann in jeden Ordner schreiben, in den dieser schreiben darf.
* **Keine Verschlüsselung im Transport.** Die Oberfläche spricht `http` — auf
  `127.0.0.1` verlässt nichts den Rechner.

## Eine Lücke melden

Bitte über [GitHub Issues](https://github.com/daimpad/screenshotter/issues) —
oder, wenn die Meldung nicht öffentlich sein soll, über die private
Sicherheitsmeldung von GitHub im Reiter *Security* des Repositories.
