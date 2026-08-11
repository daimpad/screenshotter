#!/bin/sh
# screenshotter — einen Lauf ausführen und den Report veröffentlichen.
#
#   ./lauf.sh
#
# Bewusst /bin/sh und POSIX: auf Shared Hosting ist nicht gesagt, dass bash
# unter /bin/bash liegt oder dass flock, jq oder GNU-Erweiterungen da sind.
#
# Zwei Dinge macht das Skript, die ein blanker Aufruf von screenshotter.js
# nicht macht:
#
#   1. Es lässt nur einen Lauf gleichzeitig zu. Zwei Chromium-Rudel auf einem
#      geteilten Server bringen das Paket zum Umfallen.
#   2. Es baut den Report daneben fertig und tauscht ihn erst dann ein.
#      Sonst sieht ein Besucher, der im falschen Moment kommt, einen halben
#      Report — Bilder ohne index.html oder umgekehrt.

set -eu

HIER=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
INSTANZ=$(dirname -- "$HIER")

if [ ! -f "$HIER/screenshotter.conf" ]; then
  echo "screenshotter.conf fehlt. Vorlage kopieren:" >&2
  echo "  cp $HIER/screenshotter.conf.beispiel $HIER/screenshotter.conf" >&2
  exit 2
fi

# shellcheck source=/dev/null
. "$HIER/screenshotter.conf"

: "${AUSGABE:?AUSGABE ist nicht gesetzt}"
TITEL=${TITEL:-screenshotter}
PARALLEL=${PARALLEL:-2}
PROFIL=${PROFIL:-desktop}
ZEITGRENZE=${ZEITGRENZE:-45000}
EXTRA=${EXTRA:-}

LOGVERZ="$INSTANZ/log"
SPERRE="$INSTANZ/sperre/lauf"
mkdir -p "$LOGVERZ" "$INSTANZ/sperre"

protokoll() {
  echo "$(date '+%Y-%m-%d %H:%M:%S') $*" >> "$LOGVERZ/lauf.log"
}

# mkdir ist atomar — anders als "wenn Datei fehlt, dann Datei anlegen", wo
# zwischen Prüfen und Anlegen ein zweiter Prozess dazwischenrutschen kann.
# flock wäre schöner, ist auf Shared Hosting aber oft nicht vorhanden.
if ! mkdir "$SPERRE" 2>/dev/null; then
  ALTER=$(( $(date +%s) - $(cat "$SPERRE/zeit" 2>/dev/null || echo 0) ))
  if [ "$ALTER" -gt 7200 ]; then
    protokoll "Sperre ist $ALTER s alt — vermutlich ein Absturz. Wird entfernt."
    rm -rf "$SPERRE"
    mkdir "$SPERRE" || { protokoll "Sperre nicht zu bekommen."; exit 1; }
  else
    protokoll "Es läuft bereits einer (Sperre $ALTER s alt). Abbruch."
    exit 75   # EX_TEMPFAIL: kein Fehler, nur gerade nicht möglich
  fi
fi
date +%s > "$SPERRE/zeit"
# Die Sperre muss auch bei Fehler und Abbruch wieder weg.
trap 'rm -rf "$SPERRE"' EXIT HUP INT TERM

AKTUELL="$INSTANZ/aktuell"
if [ ! -d "$AKTUELL" ]; then
  protokoll "Keine Version installiert. Erst ./aktualisieren.sh laufen lassen."
  exit 2
fi

if [ ! -f "$INSTANZ/urls.txt" ]; then
  protokoll "urls.txt fehlt in $INSTANZ."
  exit 2
fi

NEU="$AUSGABE.neu"
ALT="$AUSGABE.alt"
rm -rf "$NEU" "$ALT"

protokoll "Lauf beginnt (Version $(cat "$AKTUELL/package.json" 2>/dev/null | sed -n 's/.*"version": "\([^"]*\)".*/\1/p' | head -1))"

# --allow-failures: eine nicht erreichbare Seite soll den Report nicht
# verhindern. Der Exit-Code unterscheidet trotzdem, siehe unten.
set +e
# shellcheck disable=SC2086
node "$AKTUELL/screenshotter.js" \
  --input "$INSTANZ/urls.txt" \
  --out "$NEU" \
  --title "$TITEL" \
  --concurrency "$PARALLEL" \
  --preset "$PROFIL" \
  --timeout "$ZEITGRENZE" \
  --allow-failures \
  $EXTRA >> "$LOGVERZ/lauf.log" 2>&1
CODE=$?
set -e

if [ "$CODE" -ne 0 ] || [ ! -f "$NEU/index.html" ]; then
  protokoll "Lauf fehlgeschlagen (Code $CODE). Der alte Report bleibt stehen."
  rm -rf "$NEU"
  exit 1
fi

# Einwechseln. Zwischen den beiden mv liegt ein Wimpernschlag, in dem der
# Ordner fehlt; ein Verweis wäre lückenlos, aber nicht jeder Hoster folgt
# Symlinks im Webverzeichnis. Der kurze Moment ist der ehrlichere Kompromiss.
mkdir -p "$(dirname -- "$AUSGABE")"
if [ -d "$AUSGABE" ]; then
  mv "$AUSGABE" "$ALT"
fi
mv "$NEU" "$AUSGABE"
rm -rf "$ALT"

protokoll "Fertig. Report liegt in $AUSGABE"

# Protokoll kurz halten — auf Shared Hosting gibt es keine Logrotation.
if [ -f "$LOGVERZ/lauf.log" ]; then
  tail -n 2000 "$LOGVERZ/lauf.log" > "$LOGVERZ/lauf.log.neu" && mv "$LOGVERZ/lauf.log.neu" "$LOGVERZ/lauf.log"
fi
