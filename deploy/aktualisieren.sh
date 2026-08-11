#!/bin/sh
# screenshotter — die neueste veröffentlichte Version holen und einwechseln.
#
#   ./aktualisieren.sh          nur bei neuer Version
#   ./aktualisieren.sh --zwang  auch wenn die Version schon installiert ist
#
# Der Server zieht sich damit selbst; hochladen musst du nichts mehr.
#
# Aufbau der Instanz danach:
#
#   versionen/1.5.1/    entpacktes Release
#   versionen/1.5.0/    die vorige, zum Zurückwechseln
#   aktuell -> versionen/1.5.1
#
# Die alte Version bleibt liegen. Geht mit der neuen etwas schief, ist
# Zurückwechseln ein Befehl:  ln -sfn versionen/1.5.0 aktuell

set -eu

HIER=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
INSTANZ=$(dirname -- "$HIER")
ZWANG=${1:-}

if [ -f "$HIER/screenshotter.conf" ]; then
  # shellcheck source=/dev/null
  . "$HIER/screenshotter.conf"
fi
REPO=${REPO:-daimpad/screenshotter}
VERSIONEN_BEHALTEN=${VERSIONEN_BEHALTEN:-3}

LOGVERZ="$INSTANZ/log"
SPERRE="$INSTANZ/sperre/update"
mkdir -p "$LOGVERZ" "$INSTANZ/sperre" "$INSTANZ/versionen"

protokoll() {
  echo "$(date '+%Y-%m-%d %H:%M:%S') $*" | tee -a "$LOGVERZ/update.log"
}

if ! mkdir "$SPERRE" 2>/dev/null; then
  protokoll "Eine Aktualisierung läuft bereits. Abbruch."
  exit 75
fi
trap 'rm -rf "$SPERRE"' EXIT HUP INT TERM

for werkzeug in node curl unzip; do
  command -v "$werkzeug" >/dev/null 2>&1 || {
    protokoll "$werkzeug fehlt — ohne das geht es nicht."
    exit 2
  }
done

# Welche Version ist draußen? Die Antwort ist JSON; jq ist auf Shared Hosting
# selten da, node dagegen zwingend — also parst node.
protokoll "Frage nach der neuesten Version von $REPO"
ANTWORT=$(curl -fsSL -H 'accept: application/vnd.github+json' \
  "https://api.github.com/repos/$REPO/releases/latest") || {
  protokoll "GitHub war nicht erreichbar."
  exit 1
}

NEUSTE=$(printf '%s' "$ANTWORT" | node -e '
  let roh = "";
  process.stdin.on("data", (t) => (roh += t));
  process.stdin.on("end", () => {
    try {
      const marke = JSON.parse(roh).tag_name || "";
      process.stdout.write(marke.replace(/^v/, ""));
    } catch {
      process.exit(1);
    }
  });
') || { protokoll "Antwort von GitHub war nicht lesbar."; exit 1; }

[ -n "$NEUSTE" ] || { protokoll "Keine Versionsnummer in der Antwort."; exit 1; }

INSTALLIERT=""
if [ -f "$INSTANZ/aktuell/package.json" ]; then
  INSTALLIERT=$(sed -n 's/.*"version": "\([^"]*\)".*/\1/p' "$INSTANZ/aktuell/package.json" | head -1)
fi

protokoll "installiert: ${INSTALLIERT:-keine} · verfügbar: $NEUSTE"

if [ "$INSTALLIERT" = "$NEUSTE" ] && [ "$ZWANG" != "--zwang" ]; then
  protokoll "Schon aktuell, nichts zu tun."
  exit 0
fi

ZIEL="$INSTANZ/versionen/$NEUSTE"
TMP="$INSTANZ/versionen/.entpackt.$$"
rm -rf "$TMP"
mkdir -p "$TMP"
# Auch bei Abbruch nichts Halbes stehen lassen.
trap 'rm -rf "$SPERRE" "$TMP"' EXIT HUP INT TERM

protokoll "Lade screenshotter.zip"
curl -fsSL -o "$TMP/paket.zip" \
  "https://github.com/$REPO/releases/download/v$NEUSTE/screenshotter.zip" || {
  protokoll "Download fehlgeschlagen."
  exit 1
}

unzip -q "$TMP/paket.zip" -d "$TMP" || { protokoll "ZIP nicht lesbar."; exit 1; }

# Nicht blind vertrauen: enthält das Paket wirklich die Version, die es soll?
GELIEFERT=$(sed -n 's/.*"version": "\([^"]*\)".*/\1/p' "$TMP/screenshotter/package.json" 2>/dev/null | head -1)
if [ "$GELIEFERT" != "$NEUSTE" ]; then
  protokoll "Paket meldet Version '${GELIEFERT:-keine}', erwartet war $NEUSTE. Abbruch."
  exit 1
fi

protokoll "Installiere Abhängigkeiten"
( cd "$TMP/screenshotter" && npm install --omit=dev --no-audit --no-fund ) \
  >> "$LOGVERZ/update.log" 2>&1 || {
  protokoll "npm install fehlgeschlagen. Die laufende Version bleibt unangetastet."
  exit 1
}

# Chromium liegt außerhalb der Version im Benutzerverzeichnis und wird nur
# beim ersten Mal geladen — deshalb hier ohne Abbruch bei Fehlschlag.
if ! ( cd "$TMP/screenshotter" && npx --yes playwright install chromium ) \
    >> "$LOGVERZ/update.log" 2>&1; then
  protokoll "Hinweis: Chromium konnte nicht geladen werden. Falls schon vorhanden, ist das egal."
fi

rm -rf "$ZIEL"
mv "$TMP/screenshotter" "$ZIEL"
rm -rf "$TMP"
trap 'rm -rf "$SPERRE"' EXIT HUP INT TERM

ln -sfn "$ZIEL" "$INSTANZ/aktuell"
protokoll "Eingewechselt: Version $NEUSTE"

# urls.txt gehört der Instanz, nicht der Version — beim ersten Mal anlegen.
if [ ! -f "$INSTANZ/urls.txt" ]; then
  cp "$ZIEL/urls.txt" "$INSTANZ/urls.txt" 2>/dev/null || : > "$INSTANZ/urls.txt"
  protokoll "urls.txt angelegt — bitte befüllen."
fi

# Alte Versionen aufräumen, die neueste zuerst behalten.
( cd "$INSTANZ/versionen" && ls -1dt -- */ 2>/dev/null | tail -n +"$((VERSIONEN_BEHALTEN + 1))" | while read -r weg; do
    echo "$(date '+%Y-%m-%d %H:%M:%S') entferne alte Version ${weg%/}" >> "$LOGVERZ/update.log"
    rm -rf -- "$weg"
  done ) || :

protokoll "Fertig."
