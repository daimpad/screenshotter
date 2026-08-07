# screenshotter

Ein schlankes CLI-Werkzeug, das eine Liste von URLs abarbeitet, von jeder Seite
einen **Full-Page-Screenshot** (gesamte Scrollhöhe) erstellt und daraus einen
**statischen HTML-Report** mit Vorschaubildern, Lightbox und Zusammenfassungs­tabelle
generiert.

* **Eine einzige Abhängigkeit** — [Playwright](https://playwright.dev) für den Chromium-Teil.
* **Kein Framework im Frontend** — der Report ist Vanilla HTML, CSS und JavaScript.
* **Keine Datenbank** — alles liegt flach im Dateisystem.
* **Läuft überall** — der fertige Ordner funktioniert auf jedem statischen Webserver
  (Apache/LAMP, nginx, GitHub Pages, S3) und sogar per Doppelklick über `file://`.

---

## Inhalt

1. [Windows: einfach doppelklicken](#windows-einfach-doppelklicken)
2. [Was dabei herauskommt](#was-dabei-herauskommt)
3. [Voraussetzungen](#voraussetzungen)
4. [Installation](#installation)
5. [Schnellstart](#schnellstart)
6. [Eingabe: woher die URLs kommen](#eingabe-woher-die-urls-kommen)
7. [Alle CLI-Optionen](#alle-cli-optionen)
8. [Rezepte](#rezepte)
9. [Der Report im Detail](#der-report-im-detail)
10. [report.json](#reportjson)
11. [Veröffentlichen](#veröffentlichen)
12. [Automatisieren](#automatisieren)
13. [Tests](#tests)
14. [Projektstruktur](#projektstruktur)
15. [Fehlerbehebung](#fehlerbehebung)
16. [Exit-Codes](#exit-codes)
17. [Grenzen](#grenzen)

---

## Windows: einfach doppelklicken

Wer nicht mit der Kommandozeile arbeiten möchte, startet alles über
**`screenshotter.cmd`** — Doppelklick genügt.

Der Starter erledigt der Reihe nach:

1. **Node.js prüfen.** Fehlt es, wird das erklärt und auf Wunsch die
   Downloadseite geöffnet. (Node ist die einzige Software, die man von Hand
   installieren muss — die LTS-Version mit Standardeinstellungen reicht.)
2. **Abhängigkeiten installieren** — nur beim allerersten Start, dauert ein bis
   zwei Minuten.
3. **Chromium herunterladen** — ebenfalls nur einmal, ca. 150 MB.
4. **Nach den URLs fragen.** Ein kleines Menü zeigt, wie viele URLs in `urls.txt`
   stehen, und bietet an, die Datei im Editor zu öffnen:

   ```
     In urls.txt stehen aktuell 3 URL(s).

       [1]  Screenshots jetzt erstellen
       [2]  urls.txt bearbeiten
       [3]  Beenden

       Auswahl:
   ```
5. **Screenshots erstellen** und **den Report im Browser öffnen.**

Ab dem zweiten Start entfallen die Schritte 2 und 3 — dann sind es nur noch
Doppelklick, `1` drücken, fertig.

**Praktisch:** Rechtsklick auf `screenshotter.cmd` → *Verknüpfung erstellen*, die
Verknüpfung auf den Desktop ziehen. Dann startet der ganze Ablauf von dort.

> **Falls Windows warnt.** Wurde das Projekt als ZIP heruntergeladen, markiert
> Windows die Dateien als „aus dem Internet“. Einmal Rechtsklick auf
> `screenshotter.cmd` → *Eigenschaften* → unten *Zulassen* ankreuzen → *OK*.
> Nach einem `git clone` passiert das nicht.

Der Starter ist für Windows 10 und 11 ausgelegt. Unter macOS und Linux läuft
dasselbe über `node screenshotter.js` (siehe [Schnellstart](#schnellstart)).

---

## Was dabei herauskommt

Nach einem Lauf liegt im Zielordner (Standard: das aktuelle Verzeichnis):

```
index.html                       ← der Report
report.json                      ← dieselben Daten maschinenlesbar
assets/
  report.css                     ← Vanilla CSS
  report.js                      ← Vanilla JS (Sortierung, Filter, Lightbox)
screenshots/
  001-example-com.png            ← Full-Page-Screenshot
  002-example-com-preise.png
  thumbs/
    001-example-com.png          ← Vorschaubild für die Tabelle
    002-example-com-preise.png
```

Die Dateinamen sind aus URL und Laufnummer abgeleitet (`001-`, `002-`, …), damit
sie stabil, eindeutig und alphabetisch sortierbar sind.

---

## Voraussetzungen

| | |
|---|---|
| **Node.js** | ab 18.17 (getestet mit 20 und 22) |
| **Chromium** | wird von Playwright mitgebracht (siehe Installation) |
| **Betriebssystem** | Linux, macOS oder Windows |
| **Plattenplatz** | ca. 300 MB für den Browser, plus die Screenshots |

Für den **Report selbst** wird nichts davon gebraucht — er ist reines HTML/CSS/JS.

---

## Installation

Unter Windows übernimmt das [`screenshotter.cmd`](#windows-einfach-doppelklicken)
von selbst. Von Hand geht es so:

```bash
git clone https://github.com/daimpad/screenshotter.git
cd screenshotter

npm install                       # installiert Playwright
npx playwright install chromium   # lädt den Browser herunter (einmalig)
```

Auf einem nackten Linux-Server fehlen Chromium oft noch Systembibliotheken.
Dann stattdessen (benötigt `sudo`):

```bash
npx playwright install --with-deps chromium
```

Optional lässt sich der Befehl global verfügbar machen:

```bash
npm link          # danach steht "screenshotter" im PATH
screenshotter --help
```

---

## Schnellstart

```bash
# 1) URLs in urls.txt eintragen (eine pro Zeile), dann:
node screenshotter.js

# 2) oder direkt URLs übergeben:
node screenshotter.js https://example.com https://example.org

# 3) Ergebnis ansehen:
xdg-open index.html      # Linux
open index.html          # macOS
start index.html         # Windows
```

Beispielausgabe:

```
screenshotter v1.0.0
3 URL(s) aus urls.txt · Viewport 1440×900 · Full-Page · 3 parallel · Ziel .

[1/3] 200    1,4 s  https://example.com/          → screenshots/001-example-com.png
[2/3] 200    2,1 s  https://example.com/preise    → screenshots/002-example-com-preise.png
[3/3] ERR   30,0 s  https://gibtsnicht.example    page.goto: net::ERR_NAME_NOT_RESOLVED

Fertig in 4,2 s — 2 OK, 0 Weiterleitung(en), 1 Fehler · 1,4 MB Bilddaten
Report: /home/user/screenshotter/index.html
Daten:  /home/user/screenshotter/report.json
Bilder: /home/user/screenshotter/screenshots
```

---

## Eingabe: woher die URLs kommen

Es gibt drei Quellen. Sie werden in dieser Reihenfolge geprüft:

### 1. Argumente auf der Kommandozeile

```bash
node screenshotter.js https://example.com example.org "https://example.net | Netzseite"
```

Werden URLs als Argumente übergeben, wird die Standarddatei `urls.txt` **nicht**
zusätzlich gelesen. Wer beides kombinieren will, gibt `--input` ausdrücklich an.

### 2. Eine Textdatei (Standard: `urls.txt`)

```text
# Kommentarzeilen beginnen mit "#" oder "//" und werden ignoriert.
# Leerzeilen ebenfalls.

https://example.com                 | Startseite
https://example.com/preise          | Preisübersicht
example.com/kontakt

# Ein "#" mitten in der URL bleibt ein Fragment und wird nicht als Kommentar gelesen:
https://example.com/docs#installation
```

Regeln:

* **Eine URL pro Zeile.**
* Fehlt das Schema, wird `https://` ergänzt (`example.com` → `https://example.com`).
* Erlaubt sind nur `http` und `https`; alles andere bricht mit einer Fehlermeldung
  samt Zeilennummer ab.
* Nach einem senkrechten Strich `|` darf ein **Label** stehen. Es taucht im Report
  als Badge auf und ist mitdurchsuchbar.
* **Doppelte URLs** werden übersprungen (mit Hinweis in der Konsole).

Eine andere Datei wählt man mit `--input`:

```bash
node screenshotter.js --input listen/produktion.txt
```

### 3. stdin

```bash
cat urls.txt | node screenshotter.js
grep -h '^https' sitemap-*.txt | node screenshotter.js --out public
```

---

## Alle CLI-Optionen

| Option | Standard | Bedeutung |
|---|---|---|
| `-i, --input <datei>` | `urls.txt` | Eingabedatei mit URLs |
| `-o, --out <ordner>` | `.` | Zielordner für Report und Bilder |
| `--shots-dir <name>` | `screenshots` | Unterordner für die Bilddateien |
| `-c, --concurrency <n>` | `3` | Wie viele Seiten gleichzeitig |
| `-w, --width <px>` | `1440` | Viewport-Breite = Screenshot-Breite |
| `--height <px>` | `900` | Viewport-Höhe (bei Full-Page nur die Mindesthöhe) |
| `--scale <n>` | `1` | `deviceScaleFactor`, `2` = Retina/2× |
| `-f, --format <png\|jpeg>` | `png` | Bildformat |
| `--quality <1-100>` | `80` | Nur für `--format jpeg` |
| `-t, --timeout <ms>` | `30000` | Timeout pro Seite |
| `--wait-until <state>` | `load` | `load`, `domcontentloaded`, `networkidle`, `commit` |
| `--delay <ms>` | `500` | Zusätzliche Wartezeit direkt vor dem Auslösen |
| `--retries <n>` | `1` | Wiederholungen pro URL bei Fehlern |
| `--thumb-width <px>` | `480` | Breite der Vorschaubilder |
| `--thumb-height <px>` | `360` | Höhe der Vorschaubilder (oberer Bildausschnitt) |
| `--hide <selektoren>` | – | CSS-Selektoren ausblenden, mehrfach oder kommagetrennt |
| `--user-agent <ua>` | – | Eigener User-Agent |
| `--color-scheme <s>` | – | `light`, `dark` oder `no-preference` erzwingen |
| `--proxy <server>` | `$HTTPS_PROXY` | Proxy für den Browser |
| `--title <text>` | `Screenshot-Report` | Überschrift und `<title>` des Reports |
| `--browser-path <pfad>` | – | Pfad zu einer eigenen Chromium-Binary |
| `--no-full-page` | – | Nur den sichtbaren Viewport aufnehmen |
| `--no-scroll` | – | Kein Vorab-Scrollen (Lazy-Loading wird nicht ausgelöst) |
| `--no-stabilize` | – | Animationen/Transitions **nicht** abschalten |
| `--no-thumbnails` | – | Keine Vorschaubilder (der Report nutzt dann die Vollbilder) |
| `--no-report` | – | Nur Screenshots, kein `index.html` |
| `--no-sandbox` | – | Chromium ohne Sandbox starten (Docker, CI als root) |
| `--no-proxy` | – | Proxy aus der Umgebung ignorieren |
| `--allow-failures` | – | Exit-Code 0, auch wenn URLs fehlschlagen |
| `-q, --quiet` | – | Nur Fehler ausgeben |
| `-h, --help` | – | Hilfe anzeigen |
| `-v, --version` | – | Version ausgeben |

`node screenshotter.js --help` zeigt dieselbe Liste im Terminal.

### Was für „fehlerfreie“ Screenshots automatisch passiert

Vor jeder Aufnahme läuft standardmäßig:

1. **Animationen einfrieren** — CSS-Animationen und -Transitions werden auf
   Dauer 0 gesetzt, der Text-Cursor unsichtbar gemacht (`--no-stabilize` schaltet das ab).
2. **Durchscrollen** — die Seite wird in Schritten bis zum Ende gescrollt, damit
   `loading="lazy"`-Bilder und IntersectionObserver-Inhalte tatsächlich laden, danach
   zurück nach oben (`--no-scroll` schaltet das ab).
3. **Ruhe abwarten** — auf `networkidle` (bis 5 s), auf `document.fonts.ready`
   und danach noch `--delay` Millisekunden.
4. **Erst dann** wird über die gesamte Dokumenthöhe ausgelöst.

---

## Rezepte

```bash
# Mobiler Viewport, 2× Auflösung
node screenshotter.js --width 390 --height 844 --scale 2

# Große Listen: mehr Parallelität, kleinere Dateien
node screenshotter.js -i urls.txt -c 8 --format jpeg --quality 75

# Cookie-Banner und Werbung wegblenden
node screenshotter.js --hide "#cookie-banner,.cmp-overlay" --hide ".ad-slot"

# Träge Seiten: länger warten, öfter probieren
node screenshotter.js --wait-until networkidle --delay 3000 --timeout 60000 --retries 3

# Dark-Mode-Variante der Seiten in einen eigenen Ordner
node screenshotter.js -o report-dark --color-scheme dark --title "Report (Dark Mode)"

# Nur Bilder, kein Report (z.B. für eine eigene Weiterverarbeitung)
node screenshotter.js --no-report --no-thumbnails -o rohbilder

# In Docker / als root
node screenshotter.js --no-sandbox
```

---

## Der Report im Detail

`index.html` besteht aus drei Teilen:

**Kopf** — Titel, Zeitpunkt, Viewport und sechs Kennzahlen: Seiten, Erfolgreich,
Weiterleitungen, Fehlgeschlagen, Laufzeit, Bilddaten.

**Screenshots** — die Haupttabelle, standardmäßig **alphabetisch nach URL sortiert**.
Pro Zeile: Laufnummer, Vorschaubild, Seitentitel + URL (+ Label, Weiterleitungsziel,
Fehlermeldung), Statuscode, Seitenmaße, Dauer und Dateiname mit Größe.

**Zusammenfassung** — am Seitenende die geforderte Übersichtstabelle mit genau
**URL, Statuscode, Zeitstempel und Dateiname**, in Aufrufreihenfolge, mit einer
Summenzeile darunter.

### Bedienung

| Aktion | Wie |
|---|---|
| Bild vergrößern | Vorschaubild anklicken → Lightbox |
| Im Vollbild blättern | `←` / `→` oder die Pfeil-Buttons |
| Originalgröße | Im Vollbild auf das Bild klicken (erneut klicken = zurück) |
| Lightbox schließen | `Esc`, das `✕` oder ein Klick auf den Hintergrund |
| Sortieren | Auf einen Spaltenkopf klicken (erneut = umgekehrt) |
| Suchen | Suchfeld — filtert über URL, Titel, Label, Dateiname und Fehlertext |
| Nach Status filtern | Die Chips *Alle / OK / Weiterleitung / Fehler* |
| Hell/Dunkel | Der Schalter oben rechts (System → Hell → Dunkel, in `localStorage` gemerkt) |

### Eigenschaften

* **Funktioniert ohne JavaScript.** Beide Tabellen stehen vollständig im HTML;
  JavaScript ergänzt nur Sortierung, Filter und Lightbox.
* **Statusfarben:** grün = 2xx, amber = 3xx *oder eine gefolgte Weiterleitung*
  (Endstatus 200, aber andere Ziel-URL — der Tooltip nennt das Ziel),
  rot = 4xx/5xx oder ein Netzwerkfehler.
* **Fehlgeschlagene URLs** bleiben mit Platzhalter und Fehlermeldung in der Tabelle.
* **Responsiv:** unter 1000 px werden die Tabellen zu Karten, ohne horizontales Scrollen.
* **Zugänglich:** `aria-sort` an den Spaltenköpfen, Tastaturbedienung, Fokus kehrt
  nach dem Schließen der Lightbox zurück, sinnvolle `alt`-Texte.
* **Ohne Netzwerk:** kein CDN, keine externen Fonts, keine Tracker.

---

## report.json

Dieselben Daten maschinenlesbar — praktisch für Diffs, Monitoring oder eine eigene
Weiterverarbeitung:

```json
{
  "generator": "screenshotter v1.0.0",
  "generatedAt": "2026-08-07T15:19:44.512Z",
  "source": "urls.txt",
  "options": { "width": 1440, "height": 900, "scale": 1, "fullPage": true, "format": "png", "…": "…" },
  "stats": { "total": 7, "ok": 4, "redirect": 1, "error": 2, "bytes": 918273, "durationMs": 3412 },
  "results": [
    {
      "index": 0,
      "url": "https://example.com/",
      "label": "Startseite",
      "file": "screenshots/001-example-com.png",
      "thumb": "screenshots/thumbs/001-example-com.png",
      "fileName": "001-example-com.png",
      "status": 200,
      "statusText": "OK",
      "ok": true,
      "state": "ok",
      "title": "Example Domain",
      "finalUrl": "https://example.com/",
      "timestamp": "2026-08-07T15:19:40.881Z",
      "durationMs": 1613,
      "bytes": 298122,
      "pageWidth": 1440,
      "pageHeight": 1682,
      "attempts": 1,
      "error": null
    }
  ]
}
```

Bei einem Fehler sind `file` und `thumb` `null`, `status` ist `null` und `error`
enthält die Meldung. Die Proxy-Einstellung wird bewusst **nicht** mitgeschrieben.

Beispiel: alle fehlgeschlagenen URLs herausziehen —

```bash
node -e "console.log(require('./report.json').results.filter(r=>r.state==='error').map(r=>r.url).join('\n'))"
```

---

## Veröffentlichen

Der Zielordner ist bereits eine fertige statische Website. Es wird **kein** PHP,
kein Node und keine Datenbank auf dem Server gebraucht.

### Klassischer LAMP-/Apache-Server

```bash
node screenshotter.js --out build --title "Kundenprojekt — Screenshots"
rsync -av --delete build/ user@server:/var/www/html/screenshots/
```

Aufruf dann unter `https://server/screenshots/`. `index.html` wird von Apache
automatisch als Verzeichnisindex ausgeliefert — es ist keine `.htaccess` nötig.

### nginx

```nginx
server {
    listen 80;
    server_name screenshots.example.com;
    root /var/www/screenshots;
    index index.html;
}
```

### GitHub Pages

Dieses Repository enthält bereits den Workflow
[`.github/workflows/static.yml`](.github/workflows/static.yml), der das gesamte
Repository nach jedem Push auf `main` als GitHub Page veröffentlicht. Es genügt also:

```bash
node screenshotter.js
git add index.html report.json assets screenshots
git commit -m "Screenshot-Report aktualisiert"
git push
```

> Screenshots sind Binärdateien — wer sie regelmäßig eincheckt, sollte die Historie
> im Blick behalten oder in `.gitignore` die vorbereiteten Zeilen aktivieren und
> stattdessen per rsync/Artefakt deployen.

### Lokal ansehen

`index.html` funktioniert per Doppelklick über `file://`. Wer lieber einen Server
möchte:

```bash
npx serve .            # oder:
python3 -m http.server 8080
```

---

## Automatisieren

### Täglich per cron

```cron
# Jeden Tag um 03:30 Uhr einen frischen Report bauen
30 3 * * * cd /opt/screenshotter && /usr/bin/node screenshotter.js --quiet --allow-failures --out /var/www/html/screenshots
```

### In einer CI-Pipeline

```yaml
- uses: actions/setup-node@v4
  with: { node-version: '22' }
- run: npm ci
- run: npx playwright install --with-deps chromium
- run: node screenshotter.js --input urls.txt --out public --allow-failures
- uses: actions/upload-artifact@v4
  with: { name: screenshot-report, path: public }
```

Ohne `--allow-failures` bricht der Schritt ab, sobald eine URL fehlschlägt — genau
das, was man für einen Erreichbarkeits-Check will.

---

## Tests

Das Projekt bringt eine Testsuite auf Basis des eingebauten `node:test` mit —
ohne zusätzliche Abhängigkeiten.

```bash
npm test          # alles
npm run test:unit # nur Unit-Tests (kein Browser nötig)
npm run test:e2e  # kompletter Lauf gegen einen lokalen Testserver + Report im Browser
```

Die E2E-Tests starten einen kleinen HTTP-Server mit vorbereiteten Seiten (lang,
kurz, Weiterleitung, 404, Sonderzeichen im Titel, toter Port), lassen das CLI
darüber laufen und prüfen anschließend Bildmaße, Statuslogik, HTML-Escaping sowie
Sortierung, Filter, Lightbox und das Kartenlayout im echten Chromium.

---

## Projektstruktur

```
screenshotter.cmd         Starter für Windows (Doppelklick, richtet alles ein)
screenshotter.js          Einstiegspunkt: Ablauf, Konsolenausgabe, Exit-Code
lib/
  cli.js                  Optionen, Validierung, Hilfetext
  urls.js                 Einlesen und Normalisieren der URL-Liste
  capture.js              Browserstart, Screenshot-Logik, Thumbnails, Parallelität
  report.js               Erzeugung von index.html und report.json
  errors.js               Fehlertyp für Bedienfehler
  assets/
    report.css            Stylesheet des Reports (wird nach assets/ kopiert)
    report.js             Interaktionen des Reports (wird nach assets/ kopiert)
test/
  units.test.js           Unit-Tests
  e2e.test.js             End-to-End-Tests
  fixtures/server.js      Testserver und PNG-Hilfsfunktionen
urls.txt                  Beispiel-Eingabedatei
```

Die Vorschaubilder entstehen ohne Bildbibliothek: das fertige PNG wird in einer
viewport­großen Seite dargestellt und erneut fotografiert. Das spart eine
Abhängigkeit wie `sharp` und liefert exakt die gewünschte Kachelgröße.

---

## Fehlerbehebung

### Rund um `screenshotter.cmd` (Windows)

**Das Fenster blinkt kurz auf und schließt sich sofort**
Bei Fehlern hält der Starter selbst an — schließt sich das Fenster trotzdem
sofort, hilft der direkte Blick auf die Meldung: Explorer öffnen, in die
Adressleiste `cmd` eintippen, Enter, dann `screenshotter.cmd` eingeben.

**`'node' ist nicht als interner oder externer Befehl erkannt`**
Node.js ist installiert, aber die Eingabeaufforderung kennt es noch nicht.
Einmal ab- und wieder anmelden oder den Rechner neu starten, dann greift der
neue Suchpfad.

**Windows meldet „Der Computer wurde durch Windows geschützt“**
Das betrifft Dateien, die als Download markiert sind: Rechtsklick auf
`screenshotter.cmd` → *Eigenschaften* → *Zulassen* → *OK*. Alternativ das
Projekt per `git clone` holen statt als ZIP.

**Umlaute erscheinen als Kästchen oder Fragezeichen**
Der Starter stellt die Konsole auf UTF-8 um. In der alten
Eingabeaufforderung fehlen manchen Schriftarten trotzdem Zeichen wie `→`.
Windows Terminal (unter Windows 11 der Standard) stellt alles korrekt dar.

### Allgemein

**`Chromium konnte nicht gestartet werden` / `Executable doesn't exist`**
Der Browser fehlt: `npx playwright install chromium`. Auf Servern zusätzlich die
Systembibliotheken: `npx playwright install --with-deps chromium`. Ein bereits
vorhandenes Chromium lässt sich mit `--browser-path /usr/bin/chromium` oder über
die Umgebungsvariable `SCREENSHOTTER_CHROMIUM` verwenden.

**In Docker oder als root bricht der Start ab**
`--no-sandbox` verwenden.

**Ein Cookie-Banner verdeckt die Seite**
`--hide "#cookie-banner,.cmp"` — die Selektoren werden per CSS auf
`visibility: hidden` gesetzt. Alternativ hilft manchmal ein längeres `--delay`.

**Untere Seitenteile sind leer oder Bilder fehlen**
Lazy-Loading braucht mehr Zeit: `--wait-until networkidle --delay 2000`. Prüfen,
dass `--no-scroll` **nicht** gesetzt ist.

**Die Seite scrollt endlos (Infinite Scroll) und der Screenshot wird riesig**
`--no-scroll` benutzen oder mit `--no-full-page` nur den Viewport aufnehmen.
Das Vorab-Scrollen bricht ohnehin nach 10 Sekunden ab.

**`Timeout 30000ms exceeded`**
`--timeout 60000 --retries 2`. Bei vielen langsamen Seiten zusätzlich die
Parallelität senken (`-c 2`), damit sich die Seiten nicht gegenseitig ausbremsen.

**Sticky-Header tauchen im Bild mehrfach auf**
Den Header für die Aufnahme ausblenden: `--hide "header.sticky"`.

**Die Screenshots sind sehr groß**
`--format jpeg --quality 75` reduziert die Dateigröße drastisch. `--scale 1`
(Standard) statt `2` halbiert die Kantenlänge.

**Hinter einem Firmenproxy erscheint `ERR_TUNNEL_CONNECTION_FAILED`**
`$HTTPS_PROXY` wird automatisch übernommen; explizit geht `--proxy http://proxy:3128`.
Soll der Proxy ignoriert werden: `--no-proxy`.

**Auf dem Server fehlen Schriften oder Emojis**
Auf dem System nachinstallieren, z.B.
`apt install fonts-liberation fonts-noto-color-emoji`.

**Der Report zeigt keine Bilder**
`index.html`, `assets/` und `screenshots/` gehören zusammen in denselben Ordner —
die Pfade im Report sind relativ.

---

## Exit-Codes

| Code | Bedeutung |
|---|---|
| `0` | Alle URLs erfolgreich (oder `--allow-failures` gesetzt) |
| `1` | Mindestens eine URL ist fehlgeschlagen (Netzwerkfehler oder Status ≥ 400) |
| `2` | Bedienfehler: unbekannte Option, ungültiger Wert, fehlende Eingabedatei, Browser startet nicht |

---

## Grenzen

* **Nur Chromium.** Firefox und WebKit wären eine Zeile Code, würden aber zwei
  weitere Browser-Downloads bedeuten.
* **Keine Logins.** Seiten hinter einer Anmeldung werden so aufgenommen, wie sie
  ein anonymer Besucher sieht. `--user-agent` hilft, Cookies/Sessions nicht.
* **Sehr hohe Seiten** (mehr als ca. 30.000 px) kann Chromium abschneiden — dann
  `--no-full-page` oder eine geringere `--scale` verwenden.
* **Kein Bildvergleich.** Das Werkzeug erstellt Bestandsaufnahmen, es diffed sie nicht.

---

## Lizenz

MIT
