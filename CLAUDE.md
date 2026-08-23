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
npm test                    # alles (70 Tests)
npm run test:unit           # nur Unit-Tests, brauchen keinen Browser
npm run test:e2e            # kompletter CLI-Lauf + Report im echten Chromium
npm run test:ui             # Weboberfläche: Server, API, Absicherung, Browser
node --test test/units.test.js --test-name-pattern "diagnose"

node screenshotter.js --help
node screenshotter.js --init
node screenshotter.js https://example.com --out /tmp/probe --open
node screenshotter.js --serve --open

npm run demo                # baut den Demo-Report unter docs/ neu
npm run demo:bilder         # danach: docs/*.jpg für Vorschauseite und README
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

deploy/                Betrieb auf einem Webserver — liegt bewusst NICHT unter
                       tools/, denn das ist export-ignore. Der Server soll die
                       Skripte im Release-ZIP mitbekommen, sonst kann er sich
                       nicht selbst aktualisieren.
  aktualisieren.sh     neuestes Release holen, prüfen, einwechseln
  lauf.sh              aufnehmen, daneben bauen, atomar veröffentlichen
  abholen.sh           Rückfallweg, wenn PHP kein exec darf
  webhook.php          der einzige öffentlich erreichbare Teil
  konfiguration.php    liest screenshotter.conf — eigene Datei, damit ein
                       Test sie aufrufen kann, ohne dass der Webhook antwortet
```

**`parse_ini_file` kann `screenshotter.conf` nicht lesen.** Die Datei teilen
sich Shell und PHP; die Shell braucht `#` als Kommentarzeichen, PHPs INI-Leser
kennt nur `;`, parst die `#`-Zeilen mit und wirft bei einer Klammer darin einen
Syntaxfehler. Zurück kommt `false`, und der Webhook meldet „nicht eingerichtet",
obwohl alles richtig dasteht. Deshalb liest `konfiguration.php` selbst. Ein Test
hält das fest — er überspringt sich, wo kein `php` installiert ist.

Alles unter `deploy/` ist POSIX-`sh`: auf Shared Hosting ist weder gesagt, dass
`bash` unter `/bin/bash` liegt, noch dass `flock` oder `jq` da sind. Gesperrt
wird deshalb über `mkdir` (atomar), und JSON liest `node` — das ist ohnehin
Voraussetzung.

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

* `.github/workflows/static.yml` baut die Pages-Seite in einem Stück: `docs/`
  wird nach `seite/` kopiert, darunter entsteht unter `seite/report/` ein frisch
  aufgenommener Report der URLs aus `urls.txt`. Aufgenommen wird auf dem Läufer,
  veröffentlicht wird das Ergebnis — **ohne jedes Secret**. Zugangsdaten braucht
  erst `deploy.yml`, das dieselben Dateien auf einen fremden Webserver lädt.
* **Es kann pro Repository nur ein Pages-Deployment geben.** Ein zweiter
  Workflow, der ebenfalls nach Pages veröffentlicht, nimmt dem ersten die Hälfte
  wieder weg — wer zuletzt läuft, gewinnt. Deshalb liegt alles in `static.yml`.
* Die Aufnahme dort trägt `continue-on-error`. Eine Zielseite, die gerade nicht
  erreichbar ist, darf die eigene Vorschauseite nicht mit herunternehmen; der
  Schritt danach räumt ein halbes `seite/report` weg und warnt.
* Veröffentlicht wird **nur `docs/`** (plus der frische Report), nicht das
  Repository. Sonst würde die `index.html` eines lokalen Laufs die Vorschauseite
  überschreiben. Aus demselben Grund ignoriert `.gitignore` die Wurzelausgabe —
  mit führendem Schrägstrich, sonst verschwände auch `docs/demo/index.html`.
* `.github/workflows/release.yml` legt bei jedem Push auf `main` ein Release an,
  falls die Version aus `package.json` noch keines hat. Auslöser ist also die
  Versionsnummer, nicht der Commit.
* Das ZIP entsteht mit `git archive` und respektiert damit zwei Dinge, die eine
  handgebaute Zip-Datei verlöre: die `export-ignore`-Regeln aus `.gitattributes`
  und die CRLF-Zeilenenden von `screenshotter.cmd`.
* Die Bilder unter `docs/*.jpg` entstehen mit `npm run demo:bilder`
  (`tools/build-shots.mjs`) — **immer erst nach `npm run demo`**, sonst
  fotografiert es einen alten Demo-Report und Vorschauseite und README zeigen
  verschiedene Stände. Die beiden Bilder der Weboberfläche entstehen, indem das
  Skript `--serve` wirklich startet und das Formular bedient; deshalb stimmt
  darin auch die Versionsnummer in der Fußzeile. Beide Skripte teilen sich die
  Beispielseiten: `build-shots.mjs` importiert `startDemoSite()` aus
  `build-demo.mjs`, damit Report und Bilder dieselbe Welt zeigen.

### Der Weg auf einen fremden Webserver

`deploy.yml` nimmt genauso auf wie `static.yml`, lädt das Ergebnis aber per
lftp auf ein fremdes Paket. Alles, was daran teuer war, steckt in drei
Entscheidungen:

* **`DEPLOY_PFAD` ist relativ zum Anmeldeverzeichnis, nicht absolut.** Wo eine
  SSH-Anmeldung landet, ist von Paket zu Paket verschieden — auf einem
  Plesk-Paket im Vhost-Verzeichnis, an dessen Wurzel es gar kein `/httpdocs`
  gibt. Ein absoluter Pfad trifft daneben, sobald der Zugang eingesperrt ist.
  Deshalb listet der Lauf nach der Anmeldung das Verzeichnis ins Protokoll.
  **Kein `pwd`**: darauf gibt lftp nicht das Verzeichnis aus, sondern die
  Verbindungs-URL samt Benutzer — bei Passwort-Anmeldung nichts fürs Protokoll.
* **Hochgeladen heißt nicht angekommen.** `lftp` meldet Erfolg, sobald die
  Dateien irgendwo liegen. Ist `DEPLOY_URL` gesetzt, ruft der Lauf danach
  `report.json` unter dieser Adresse ab und vergleicht `generatedAt` mit der
  eigenen Laufzeit. Ohne diese Prüfung ist ein grüner Lauf kein Beweis — die
  Dateien können in einem Verzeichnis liegen, das der Webserver nie ausliefert.
* **Ein leeres Secret ist meistens ein verwechselter Reiter.** Kommt
  `secrets.DEPLOY_HOST` leer an, prüft der Lauf, ob derselbe Name unter
  *Variables* steht, und sagt das. Geprüft wird ausschließlich
  `vars.X != ''`, **nie der Wert**: Variables sind nicht maskiert, und den
  `env`-Block gibt der Läufer mit aus — ein versehentlich dort abgelegtes
  Passwort stünde sonst im Klartext im Protokoll.

Ein hinterlegtes Secret erscheint im `env`-Block des Protokolls als `***`.
Steht dort nichts, ist es nicht „falsch", sondern gar nicht angekommen.

### Alle drei Oberflächen tragen das nozilla-CI

`docs/index.html` und `docs/site.css` folgen dem Erscheinungsbild aus
[daimpad/nozilla-ci](https://github.com/daimpad/nozilla-ci). Die Grundlage liegt
unter `docs/nozilla/` und ist **übernommen, nicht geschrieben** — Herkunft und
Stand stehen in `docs/nozilla/HERKUNFT.md`. Wer dort etwas ändert, ändert am
falschen Ort.

Die vier Regeln, an denen sich das Layout entscheidet (vollständig in
`HAUSREGELN.md` des CI-Repositories):

1. **Fließtext steht auf Weiß**, nie direkt auf dem Papierton. Deshalb liegt
   jeder Abschnittstext in einem `.sheet`.
2. **Auf dem Papierton stehen nur Überschriften, Labels und Navigation.**
3. **Signalgrün ist ausschließlich Aktionsfarbe** — Schaltflächen und die
   `<mark class="g">`-Marker. Keine Flächen, keine Container.
6. **Vollflächige Bänder sind weiß; Schwarz genau einmal je Seite.** Das eine
   schwarze Band ist der Automatik-Abschnitt ganz unten. Ein zweites nimmt dem
   ersten die Wirkung.

Dazu: Radius immer 0, Schatten nur hart versetzt (nie weichgezeichnet), keine
Verläufe, keine Filter, **keine Emoji**.

**Report und Weboberfläche tragen dasselbe Erscheinungsbild**, und zwar über
denselben Tokenblock: `lib/assets/report.css` bringt die Farben mit,
`lib/assets/ui.css` verbraucht sie. Wer dort eine Farbe ändert, ändert beide
Oberflächen. Zwei Punkte, die dabei leicht untergehen:

* **Nur zwei Markenschnitte** liegen in `lib/assets/fonts/` — Zilla Slab Bold
  für Überschriften, Space Mono Bold für Labels. Der Fließtext bleibt
  Systemschrift. Alle drei Schnitte wären 335 KB in *jedem* erzeugten Report
  gewesen, so sind es 75.
* **Links laufen in Tintenfarbe**, nicht in Signalgrün. Grün ist die
  Aktionsfarbe, steht aber nur in der Unterstreichung beim Zeigen — grüner Text
  auf Weiß ist praktisch nicht zu lesen.

Der Umschalter für das Farbschema folgt Hausregel 19: Quadrat, weiße Fläche,
durchgezogene Linie, harter Schatten, **kein Wort**, und das Zeichen zeigt das
*Ziel* des nächsten Klicks (`☀` → hell, `☾` → dunkel, `◐` → System). Er steht an
drei Stellen mit drei eigenen Implementierungen — `docs/theme.js`,
`lib/assets/report.js` und `lib/assets/ui.js`. Wer die Reihenfolge ändert, muss
alle drei anfassen.

**`display: grid` auf einem Listenpunkt macht jedes Kind zur Zelle** — auch
nackte Textknoten. Die Schrittliste unter „In 60 Sekunden" brach dadurch nach
jedem Wort um, weil der Fließtext in der 32px-Spalte der Ziffer landete. Die
Ziffer wird deshalb positioniert, nicht gerastert.

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

**Der Server ist bewusst eng geschnürt.** Die vollständige Liste steht in
`SECURITY.md`; jede Maßnahme hat einen Test in `test/server.test.js`. Wer am
Server arbeitet, sollte beides gelesen haben, bevor er eine Prüfung lockert.

**Ein Formular-POST braucht keinen CORS-Preflight.** Mit `enctype="text/plain"`
und einem passend gebauten Feldnamen entsteht gültiges JSON — eine fremde Seite
konnte damit Läufe auslösen, Ziel-URL und Ausgabeordner frei wählen. Deshalb
verlangt `checkWriteRequest()` `application/json`, prüft `Origin` sowie
`Sec-Fetch-Site` und ein Sitzungsmerkmal. Der Test dazu fährt den Angriff im
echten Browser nach — er darf nicht entfernt werden.

**Zu große Anfragen nicht sofort abschneiden.** Wer den Lesestrom kappt, während
der Absender noch sendet, erzeugt beim Client einen Verbindungsabbruch statt
einer Fehlermeldung. `readBody()` nimmt weiter an, hebt aber nichts mehr auf,
und lehnt erst am Ende ab — mit einer harten Grenze dahinter.

**`screenshotter.js` darf beim Import nichts tun.** Bis v1.3.0 startete schon
ein `import` aus einem Test heraus einen kompletten Lauf und schrieb Dateien ins
Projektverzeichnis. `startedDirectly()` verhindert das.

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

**Eine neue Datei in `lib/assets/` reicht nicht.** Sie muss an zwei weiteren
Stellen nachgezogen werden, sonst fehlt sie zur Hälfte: in `PUBLIC_ASSETS`
(`lib/server.js`), sonst antwortet die Weboberfläche mit 404, und in der
Kopierliste von `writeReport()` (`lib/report.js`), sonst fehlt sie im erzeugten
Report. Beides hat jetzt einen Test — `logo.svg` ist der Fall, an dem es auffiel.

**Bildmaße im Test erst messen, wenn das Bild geladen ist.** Die eingepasste
Größe in der Lightbox entsteht rein über CSS (`max-width`/`max-height`); vorher
liefert `boundingBox()` die Breite 0. Lokal liegt das PNG im Cache und lädt
binnen eines Frames, auf einem kalten CI-Läufer nicht — dort nahm der Test 0 als
Bezugswert und verglich am Ende `205 !== 0`. Vor jeder Messung auf eine Breite
größer 0 warten. Das war der erste Fund der neuen CI.

## Tests

* `test/units.test.js` — reine Logik, kein Browser, läuft in Millisekunden.
* `test/e2e.test.js` — startet `test/fixtures/server.js`, ruft das CLI als
  Unterprozess auf und prüft den Report anschließend im echten Chromium.
* `test/server.test.js` — startet `--serve` als Unterprozess, bedient das
  Formular im Browser und klopft die API samt Absicherung ab. Enthält
  Angriffsversuche, die vor der Härtung funktioniert haben.
* `.github/workflows/ci.yml` — fährt dieselben Tests bei jedem Pull Request.
  Unit-Tests auf Node 18.17 (die zugesicherte Untergrenze aus `package.json`)
  und 22 sowie auf Windows; Browser-Tests einmal unter Linux. Wer `engines`
  anhebt, muss die Matrix mitziehen — sonst prüft niemand mehr, was
  versprochen wird.
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
