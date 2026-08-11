#!/bin/sh
# screenshotter — Rückfallweg, wenn PHP kein exec darf.
#
# Manche Pakete schalten exec/shell_exec ab. Dann kann webhook.php den Lauf
# nicht selbst starten und legt stattdessen eine Marke ab. Dieses Skript
# gehört in einen Minutencron und holt sie ab:
#
#   * * * * * /pfad/zur/instanz/deploy/abholen.sh
#
# Kostet fast nichts: ohne Marke ist es ein Verzeichnistest und Schluss.

set -eu

HIER=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
INSTANZ=$(dirname -- "$HIER")
MARKE="$INSTANZ/sperre/angefordert"

[ -f "$MARKE" ] || exit 0

# Erst wegnehmen, dann laufen: sonst löst dieselbe Marke beim nächsten
# Minutentakt noch einmal aus, während der erste Lauf noch arbeitet.
rm -f "$MARKE"

exec "$HIER/lauf.sh"
