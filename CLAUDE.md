# CLAUDE.md

Hinweise für Claude Code und andere Beitragende zu diesem Repository.

## Worum es geht

`screenshotter` ist ein CLI, das eine URL-Liste abarbeitet, von jeder Seite
einen Full-Page-Screenshot erstellt und daraus einen statischen HTML-Report
generiert. Zielgruppe sind Menschen, die eine Website abnehmen oder
dokumentieren — nicht zwingend Entwickler.

Die drei Leitplanken, die jede Änderung respektieren muss:

1. **Genau eine Laufzeit-Abhängigkeit** (`playwright`). Alles andere sind
   Node-Bordmittel. Vor `npm install <paket>` erst überlegen, ob es ohne geht —
   die Thumbnails etwa entstehen ohne `sharp`, indem der schon laufende Browser
   das PNG neu rendert.
2. **Kein Build-Schritt.** `lib/assets/report.css` und `lib/assets/report.js`
   werden unverändert in den Ausgabeordner kopiert. Kein Bundler, kein
   Transpiler, kein Postprozessor.
3. **Der Report funktioniert ohne JavaScript.** Beide Tabellen werden
   serverseitig in `lib/report.js` gerendert; `report.js` ergänzt nur
   Sortierung, Filter, Lightbox, Ansichtswechsel und Theme.

## Befehle

```bash
npm test                    # alles (59 Tests)
npm run test:unit           # nur Unit-Tests, brauchen keinen Browser
npm run test:e2e            # kompletter CLI-Lauf + Report im echten Chromium
npm run test:ui             # Weboberfläche: Server, API, Absicherung, Browser
node --test test/units.test.js --test-name-pattern "diagnose"

node screenshotter.js --help
node screenshotter.js --init
node screenshotter.js https://example.com --out /tmp/probe --open
node screenshotter.js --serve --open

npm run demo                # baut den Demo-Report unter docs/ neu
```

`node --test test/` funktioniert **nicht** — Node hält das Verzeichnis für einen
Dateipfad. Immer das Glob verwenden: `node --test "test/*.test.js"`.

## Architektur

```
screenshotter.js       Ablaufsteuerung, Konsolenausgabe, Exit-Codes
  lib/cli.js           parseArgs, Geräteprofile, Validierung, Hilfetext
  lib/urls.js          Eingaben (CLI, Datei, stdin) → [{ url, label }]
  lib/capture.js       Browserstart, Screenshot-Schleife, Thumbnails, Worker-Pool
  lib/diagnose.js      Chromium-Fehlercode → Klartext + Lösungshinweis
  lib/progress.js      Reporter: Farben, Symbole, Fortschrittsbalken
  lib/report.js        index.html + report.json, kopiert lib/assets/*
  lib/server.js        Weboberfläche: HTTP-API, SSE-Fortschritt, Absicherung
  lib/open.js          Datei im Standardprogramm öffnen
  lib/errors.js        UserError (führt zu Exit-Code 2)
```

Es gibt zwei Einstiege in denselben Motor: die Kommandozeile und
`--serve`. Der Server ruft `captureAll()` und `writeReport()` genauso auf wie
`screenshotter.js` — neue Funktionen gehören deshalb in `lib/`, nicht in einen
der beiden Einstiege, sonst kennt sie nur die Hälfte der Nutzer.

Datenfluss: `collectTargets()` → `captureAll()` → Ergebnisobjekte →
`writeReport()`. Das Ergebnisobjekt pro URL ist der zentrale Vertrag; seine
Felder tauchen unverändert in `report.json` auf. Wer ein Feld hinzufügt, sollte
es in `lib/capture.js` (`base`), im Report und in der README-Beschreibung von
`report.json` gleichzeitig nachziehen.

`captureOne()` wirft nie — Fehler landen im Ergebnisobjekt, damit ein
kaputter Link den Lauf nicht abbricht.

## Vorschauseite und Releases

`docs/` ist zweierlei zugleich: Bildquelle für die README **und** Wurzel der
GitHub-Pages-Seite. Deshalb liegen dort `index.html`, `site.css`, die
JPG-Screenshots und unter `demo/` ein echter, eingecheckter Report.

* `.github/workflows/static.yml` veröffentlicht **nur `docs/`**, nicht das
  Repository. Sonst würde die `index.html` eines lokalen Laufs die Vorschauseite
  überschreiben. Aus demselben Grund ignoriert `.gitignore` die Wurzelausgabe —
  mit führendem Schrägstrich, sonst verschwände auch `docs/demo/index.html`.
* `.github/workflows/release.yml` legt bei jedem Push auf `main` ein Release an,
  falls die Version aus `package.json` noch keines hat. Auslöser ist also die
  Versionsnummer, nicht der Commit.
* Das ZIP entsteht mit `git archive` und respektiert damit zwei Dinge, die eine
  handgebaute Zip-Datei verlöre: die `export-ignore`-Regeln aus `.gitattributes`
  und die CRLF-Zeilenenden von `screenshotter.cmd`.
* Wer die Bilder unter `docs/*.jpg` erneuert, sollte vorher `npm run demo`
  laufen lassen — sonst zeigen Vorschauseite und README verschiedene Stände.

## Konventionen

* **Benutzertexte auf Deutsch**: Hilfetext, Konsolenausgabe, Fehlermeldungen,
  Report-Beschriftungen, README. Auch Testnamen sind deutsch.
* **Code-Kommentare** sind historisch gemischt (ältere Module englisch, neuere
  deutsch). Neue Kommentare an die jeweilige Datei anpassen, nicht
  flächendeckend umschreiben.
* Kommentare erklären **warum**, nicht was. Besonders bei den CSS-Fallstricken
  unten hängt an jedem ein Kommentar — der muss bleiben.
* Neue Optionen gehören an drei Stellen gleichzeitig: `OPTIONS`, das
  `options`-Objekt und `helpText()` in `lib/cli.js`.
* `node:util.parseArgs` kann keine `--no-*`-Negation über alle Node-Versionen
  hinweg. Jeder abschaltbare Standard bekommt deshalb einen eigenen
  `no-*`-Booleschalter.

## Fallstricke, die dieses Projekt schon gekostet haben

Jeder Punkt hier hat einen Test. Wer die Stelle anfasst, sollte den Test kennen.

**CSS: `overflow` zerstört `position: sticky`.** Ein Container mit
`overflow: hidden` oder `overflow-x: auto` wird selbst zum Bezugspunkt für
`sticky` — die Tabellenkopfzeile klebt dann an ihm statt am Viewport und wirkt
wirkungslos. Deshalb hat `.table-card` **kein** `overflow: hidden` (die runden
Ecken kommen über die Eckzellen) und `.table-scroll` bekommt `overflow-x` nur
unterhalb von 1000 px, wo die Kopfzeile ohnehin ausgeblendet ist.

**CSS: `display` überstimmt `[hidden]`.** Im Kartenlayout steht
`tbody tr { display: grid }` — das hebelt das HTML-Attribut `hidden` aus, mit dem
JavaScript filtert. Jede Regel, die `display` auf Zeilen setzt, braucht
daneben ein `tr[hidden] { display: none }`.

**CSS: Breitenangaben aus dem Tabellenlayout wirken weiter.** `.col-preview`
hat `width: 1%` für die Tabelle; im Kartenlayout ließ das die Vorschaubilder auf
1 % zusammenfallen. Solche Regeln in den Kartenmodi zurücksetzen.

**CLI-Argumente haben Vorrang vor `urls.txt`.** Werden URLs als Argumente
übergeben, darf die Standarddatei nicht zusätzlich gelesen werden — sonst
verarbeitet man ungewollt beide Listen. Ein ausdrückliches `--input` kombiniert
dagegen bewusst.

**Mobil-Emulation ändert die Bildbreite.** Mit `isMobile: true` (Profile
`tablet`/`mobile`) rendert Chromium Seiten **ohne** `<meta name="viewport">` mit
980 CSS-Pixeln Breite. `--preset mobile` liefert dann nicht 780, sondern 1960
Bildpunkte. Das ist korrektes Verhalten, kein Fehler — und getestet.

**Weiterleitungen haben Endstatus 200.** Playwright folgt ihnen. `classify()`
erkennt sie daran, dass `finalUrl` von `url` abweicht; sonst wäre die Kennzahl
„Weiterleitungen“ immer 0.

**`screenshotter.cmd` ist empfindlich.** Reines ASCII (Umlaute brechen auf
fremden Windows-Codepages), CRLF-Zeilenenden (per `.gitattributes` erzwungen,
mit LF verschluckt sich `cmd.exe` an Labels) und ausschließlich `goto` statt
`( … )`-Blöcken, weil Klammern in Meldungen sonst den Parser zerlegen. Die Datei
lässt sich hier nicht ausführen — Änderungen daran immer statisch prüfen:
Sprungziele, ausgeglichene Anführungszeichen, escapte Klammern.

**`display` überstimmt `[hidden]` — überall.** Deshalb steht in `report.css`
und `ui.css` je ein `[hidden] { display: none !important; }` ganz oben. Ohne das
blieben Felder und Bereiche sichtbar, die das JavaScript ausblendet; die
Weboberfläche zeigte anfangs das JPEG-Qualitätsfeld und den Abbrechen-Knopf
dauerhaft an.

**`step` an Zahlenfeldern ist eine Falle.** Ein Vorgabewert, der nicht auf das
Raster passt (z.B. `value="80"` bei `min="1" step="5"`), macht das Formular
ungültig. Liegt das Feld dann in einem ausgeblendeten Bereich, blockiert der
Browser das Absenden **ohne sichtbare Meldung**. Das Formular trägt deshalb
`novalidate`, nicht benutzte Felder werden `disabled`, und geprüft wird
serverseitig in `applyRunOptions()`.

**Der Server ist bewusst eng geschnürt.** Bindung an `127.0.0.1`, Prüfung des
`Host`-Headers gegen DNS-Rebinding, `resolveWithin()` gegen Pfad-Traversal,
Allowlist für ausgelieferte Assets, 1-MB-Grenze für Anfragen, ein Lauf zur Zeit
und keine Proxy-Angabe in `/api/state`. Wer hier etwas ändert, sollte
`test/server.test.js` gelesen haben.

**`fetch` kann den `Host`-Header nicht setzen.** Für Tests gegen die
Rebinding-Prüfung muss `node:http` direkt verwendet werden — sonst prüft der
Test nichts.

**Heredocs in GitHub-Workflows.** In einem `run: |`-Block entfernt YAML die
gemeinsame Einrückung. Der Terminator eines Heredocs landet dadurch auf Spalte 0
und funktioniert — aber nur, wenn er genauso eingerückt ist wie der Rest. Solche
Skripte lassen sich lokal prüfen: YAML parsen, `run` herausziehen, mit `bash -e`
ausführen. Genau so wurde `release.yml` verifiziert.

**Keine rohen ESC-Bytes im Quelltext.** ANSI-Sequenzen als `\u001b` schreiben,
nicht als literales Steuerzeichen.

## Tests

* `test/units.test.js` — reine Logik, kein Browser, läuft in Millisekunden.
* `test/e2e.test.js` — startet `test/fixtures/server.js`, ruft das CLI als
  Unterprozess auf und prüft den Report anschließend im echten Chromium.
* `test/server.test.js` — startet `--serve` als Unterprozess, bedient das
  Formular im Browser und klopft die API ab.
* `test/fixtures/server.js` — deterministische Seiten: lang mit Lazy-Loading,
  kurz, Weiterleitung, 404, ohne Viewport-Meta, Sonderzeichen im Titel. Dazu
  `reservedDeadOrigin()` für einen reproduzierbaren Verbindungsfehler und
  `pngSize()` zum Auslesen der Bildmaße.

Testserver immer auf einen über `freePort()` ermittelten Port legen, nie auf
eine feste Nummer: ein abgestürzter Testlauf hinterlässt sonst einen Prozess,
und der nächste Lauf redet unbemerkt mit dem alten Server.

Für einen Fehlerfall nie auf DNS oder Ports wie 1 setzen — Chromium sperrt
bestimmte Ports (`ERR_UNSAFE_PORT`). `reservedDeadOrigin()` bindet stattdessen
kurz einen freien Port und gibt ihn wieder frei.

Neue UI-Funktion im Report? Dann gehört ein E2E-Test dazu, der sie im Browser
bedient. Die vier bisher gefundenen Layoutfehler wären durch reine
HTML-Zeichenkettenprüfungen alle durchgerutscht.

## Was hier nicht hingehört

* Frontend-Frameworks, CSS-Präprozessoren, Bundler.
* Weitere Laufzeit-Abhängigkeiten ohne sehr guten Grund.
* Generierte Ausgaben eines Laufs im Projektordner (`index.html`, `report.json`,
  `assets/`, `screenshots/`) — die ignoriert `.gitignore`. Der Demo-Report unter
  `docs/demo/` ist die bewusste Ausnahme: er ist die Vorschau auf GitHub Pages.
* Die Proxy-URL in `report.json`: sie wird bewusst weggelassen, damit interne
  Adressen nicht in einem veröffentlichten Report landen.
