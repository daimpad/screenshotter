# Betrieb auf einem Webserver

> **Zwei Wege — der obere ist für Shared Hosting meist der bessere.**
>
> **A. GitHub nimmt auf, der Server bekommt nur Dateien**
> → [`.github/workflows/deploy.yml`](../.github/workflows/deploy.yml),
> Anleitung unten unter „Ohne Node auf dem Server".
> Auf dem Paket läuft nichts außer dem Webserver. Kein Node, kein Chromium,
> keine Speichergrenzen.
>
> **B. Der Server nimmt selbst auf** → der Rest dieser Datei.
> Braucht Node **und** ein Chromium, das startet. Auf günstigen Paketen fehlt
> dafür oft der Arbeitsspeicher oder eine Systembibliothek.

## Es erscheint die Seite des Hosters statt des Reports

Bevor du irgendetwas umbaust, diese drei Dinge der Reihe nach:

1. **Liegt überhaupt etwas da?** Auf dem Server nachsehen:
   ```bash
   ls -la /pfad/zu/httpdocs/
   ```
   Steht dort nur die `index.html` des Hosters, ist noch nie ein Lauf
   angekommen — dann ist es kein Anzeigeproblem, sondern der Lauf fehlt.

2. **Liegt der Report in einem Unterordner?** Mit
   `AUSGABE=".../httpdocs/screenshots"` erreichst du ihn unter
   `https://deine-domain.de/screenshots/`, **nicht** unter `/`.

3. **Überdeckt die Platzhalterdatei des Hosters deine?** Apache nimmt die
   erste Datei aus `DirectoryIndex`. Liegt neben deiner `index.html` noch eine
   `index.php` des Hosters, gewinnt oft die PHP-Datei. Die Platzhalterdatei
   löschen oder umbenennen:
   ```bash
   mv /pfad/zu/httpdocs/index.php /pfad/zu/httpdocs/index.php.aus
   ```

Der Report selbst braucht nichts weiter: er ist reines HTML, CSS, JS und PNG.
Wenn die Dateien im richtigen Ordner liegen, wird er ausgeliefert.

## Ohne Node auf dem Server

Der Weg, der auf Shared Hosting am wenigsten schiefgehen kann: die Aufnahme
passiert bei GitHub, auf den Server wandert nur das Ergebnis.

Unter **Settings → Secrets and variables → Actions** eintragen:

| Art | Name | Inhalt |
|---|---|---|
| Secret | `DEPLOY_HOST` | z.B. `hosting123456.abcd.netcup.net` |
| Secret | `DEPLOY_USER` | SSH-/FTP-Benutzer des Pakets |
| Secret | `DEPLOY_SSH_KEY` | privater Schlüssel — **oder** stattdessen: |
| Secret | `DEPLOY_PASSWORT` | Passwort |
| Variable | `DEPLOY_PFAD` | Zielordner, **relativ zum Anmeldeverzeichnis**. Ohne Angabe: `httpdocs/screenshots` |
| Variable | `DEPLOY_PROTOKOLL` | `sftp` (Vorgabe) oder `ftps` |
| Variable | `DEPLOY_HOSTKEY` | Rechnerschlüssel des Servers, siehe unten |
| Variable | `DEPLOY_QUELLE` | `report` (Vorgabe) oder `docs` |
| Variable | `DEPLOY_TITEL` | Überschrift im Report, Vorgabe `Screenshots` |

Den Rechnerschlüssel holst du dir einmal:

```bash
ssh-keyscan -t ed25519 hosting123456.abcd.netcup.net
```

Die ganze Ausgabezeile kommt in `DEPLOY_HOSTKEY`. **Ohne diese Variable
funktioniert es zwar auch**, dann wird der Server aber beim ersten Kontakt
ungeprüft angenommen — und ein Läufer ist jedes Mal neu, also ist es jedes Mal
der erste Kontakt. Der Workflow warnt dann im Protokoll.

Danach: **Actions → Deploy → Run workflow**. Nachts um 3:20 UTC läuft er
zusätzlich von allein.

`DEPLOY_PFAD` muss ein **eigener Ordner** sein: der Workflow spiegelt mit
`--delete`, damit Bilder gelöschter Seiten verschwinden. Zeigt der Pfad auf ein
Verzeichnis, in dem noch anderes liegt, wäre das andere danach weg. Deshalb
steht dort `httpdocs/screenshots` und nicht `httpdocs`.

Und der Pfad ist **relativ**, nicht absolut. Wo eine SSH-Anmeldung landet, ist
von Paket zu Paket verschieden: auf einem Plesk-Paket im Vhost-Verzeichnis, an
dessen Wurzel es gar kein `/httpdocs` gibt. Wo du landest, verrät:

```bash
ssh dein-benutzer@dein-host pwd
```

Steht dort etwas anderes als das Verzeichnis, in dem `httpdocs` liegt, gehört
der Rest des Weges in `DEPLOY_PFAD`.

---

## Der Server nimmt selbst auf

Für Shared Hosting (Plesk, cPanel) und alles andere, wo Node läuft, aber kein
Dauerprozess erlaubt ist. Der Server holt sich die neuen Versionen selbst, und
ein Lauf lässt sich von außen anstoßen.

Alles hier ist POSIX-`sh` und PHP — keine weiteren Abhängigkeiten. `bash`, `jq`
oder `flock` werden **nicht** vorausgesetzt, weil die auf geteilten Paketen
gern fehlen.

## Der Aufbau

```
screenshotter/                 ← die Instanz, NICHT im Webverzeichnis
  deploy/                      ← diese Dateien
  versionen/1.5.1/             ← entpacktes Release
  versionen/1.5.0/             ← die vorige, zum Zurückwechseln
  aktuell -> versionen/1.5.1
  urls.txt                     ← deine Liste, überlebt Aktualisierungen
  log/                         ← Protokolle
  sperre/                      ← Sperren gegen Doppelläufe

httpdocs/
  screenshots/                 ← der fertige Report (wird ersetzt)
  screenshotter-webhook.php    ← Kopie von deploy/webhook.php
```

Die Instanz liegt **neben** dem Webverzeichnis, nicht darin. Sonst wären
`urls.txt`, Protokolle und das Webhook-Geheimnis über den Browser abrufbar.

## Einrichten

**1. Instanz anlegen** — irgendwo außerhalb von `httpdocs`:

```bash
mkdir -p ~/screenshotter && cd ~/screenshotter
curl -fsSL -o paket.zip https://github.com/daimpad/screenshotter/releases/latest/download/screenshotter.zip
unzip -q paket.zip && mv screenshotter/deploy . && rm -rf screenshotter paket.zip
```

**2. Einstellungen setzen:**

```bash
cd deploy
cp screenshotter.conf.beispiel screenshotter.conf
chmod 600 screenshotter.conf
```

In `screenshotter.conf` mindestens `AUSGABE` auf dein öffentliches
Zielverzeichnis setzen und ein Geheimnis erzeugen:

```bash
head -c 32 /dev/urandom | base64 | tr -d '=+/'
```

**3. Erste Version holen:**

```bash
chmod +x *.sh
./aktualisieren.sh
```

Das lädt das Release, installiert die Abhängigkeiten, holt Chromium und legt
`urls.txt` an. Dort deine URLs eintragen, eine pro Zeile.

**4. Probelauf:**

```bash
./lauf.sh
tail -n 30 ../log/lauf.log
```

**5. Webhook einhängen** — `webhook.php` ins Webverzeichnis kopieren und darin
den Pfad zur Instanz eintragen:

```bash
cp webhook.php ~/httpdocs/screenshotter-webhook.php
```

Auslösen:

```bash
curl -X POST -H "X-Screenshotter-Token: <dein-geheimnis>" \
     https://beispiel.de/screenshotter-webhook.php
```

## Selbstaktualisierung als Cron

Im Panel unter *Geplante Aufgaben* eintragen, z.B. nachts um vier:

```
0 4 * * *  /home/kunde/screenshotter/deploy/aktualisieren.sh
```

Das Skript prüft erst die Version und tut nichts, wenn schon alles aktuell ist.
Ein Fehlschlag lässt die laufende Version unangetastet — es wird erst
eingewechselt, wenn das neue Paket vollständig entpackt, geprüft und
installiert ist.

Zurückwechseln, falls eine neue Version Ärger macht:

```bash
ln -sfn versionen/1.5.0 aktuell
```

## Wenn PHP kein `exec` darf

Manche Pakete schalten `exec` ab. `webhook.php` merkt das und legt statt eines
Starts eine Marke ab. Ein Minutencron holt sie:

```
* * * * *  /home/kunde/screenshotter/deploy/abholen.sh
```

Ohne Marke ist das ein Verzeichnistest und Schluss — es kostet praktisch nichts.

## Was abgesichert ist

| Maßnahme | Wogegen |
|---|---|
| Der Webhook nimmt **keine** Parameter entgegen | Sonst könnte jeder mit dem Geheimnis deinen Server beliebige Adressen abrufen lassen — auch interne |
| `hash_equals` beim Vergleich | Zeitunterschiede verraten sonst Zeichen für Zeichen, wie viel vom Geheimnis stimmt |
| Leeres Geheimnis heißt „zu", nicht „offen" | Eine halbfertige Einrichtung ist sonst ein offenes Tor |
| Nur `POST` | Ein Lauf ist kein Abruf; Suchmaschinen und Vorschaudienste lösen so nichts aus |
| Mindestabstand zwischen Läufen | Flut mit gültigem Geheimnis |
| Sperrverzeichnis (`mkdir`, atomar) | Zwei Chromium-Rudel gleichzeitig bringen ein geteiltes Paket zum Umfallen |
| Instanz außerhalb von `httpdocs` | `urls.txt`, Protokolle und Geheimnis sind nicht abrufbar |
| Fehlermeldungen ohne Pfade | Verrät die Verzeichnisstruktur nicht |
| Bei einem Fehlschlag bleibt der alte Report stehen | Ein kaputter Lauf löscht nicht das, was funktioniert hat |

Das Geheimnis steht in `screenshotter.conf`. Die Datei gehört auf `600` und
außerhalb des Webverzeichnisses — beides macht die Anleitung oben, aber es
lohnt, das nach dem Einrichten einmal nachzusehen:

```bash
ls -l deploy/screenshotter.conf
curl -sI https://beispiel.de/../screenshotter/deploy/screenshotter.conf
```

Der zweite Befehl muss 403 oder 404 liefern, keinesfalls 200.

## Warum der Report daneben gebaut wird

`lauf.sh` schreibt nach `<AUSGABE>.neu` und tauscht erst am Ende. Sonst sieht
ein Besucher, der im falschen Moment kommt, einen halben Report — Bilder ohne
`index.html` oder umgekehrt. Zwischen den beiden Umbenennungen liegt ein
Wimpernschlag, in dem der Ordner fehlt; ein Symlink wäre lückenlos, aber nicht
jeder Hoster folgt Verweisen im Webverzeichnis.
