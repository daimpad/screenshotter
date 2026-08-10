# Herkunft dieser Dateien

Dieser Ordner ist **übernommen, nicht geschrieben**. Er stammt aus dem
Corporate-Identity-Repository von nozilla:

* Quelle: <https://github.com/daimpad/nozilla-ci>
* Stand: Commit `513f017`, 7. August 2026
* CI-Portal: <https://daimpad.github.io/nozilla-ci/ci/>

Wer hier etwas ändert, ändert am falschen Ort. Korrekturen gehören ins
CI-Repository; von dort wird neu übernommen.

## Was übernommen wurde

| Datei | Quelle | Änderung |
|---|---|---|
| `design-system.css` | `design-system.css` | keine, Byte für Byte identisch |
| `fonts.css` | `project/fonts.css` | neu geschrieben: WOFF2 statt TTF, nur die benutzten Schnitte |
| `fonts/*.woff2` | `project/fonts/*.ttf` | dasselbe Schriftbild, webtauglich verpackt |
| `fonts/OFL.txt` | `project/fonts/OFL.txt` | keine |

## Warum WOFF2

Das CI-Repository liefert die Schriften als TTF aus. Für eine öffentliche Seite
ist das unnötig schwer: dieselben fünf Schnitte wiegen als WOFF2 **335 KB statt
1010 KB**. Das Format ändert nichts am Schriftbild, und die SIL Open Font
License 1.1 erlaubt die Umwandlung ausdrücklich — `OFL.txt` liegt deshalb daneben.

Übernommen sind nur die Schnitte, die diese Seite wirklich benutzt: Zilla Slab
Medium und Bold, Inter Regular und SemiBold, Space Mono Bold. Wer einen weiteren
braucht, wandelt ihn aus dem CI-Repository nach, statt den Browser einen
fehlenden Schnitt rechnen zu lassen.

## Kein Font-CDN

Die Schriften liegen bewusst hier und nicht bei Google Fonts. Das ist nozillas
eigene Vorgabe („self-contained assets"), und es passt zu diesem Projekt: eine
Seite, die ohne Dritte rendert, ist eine Seite weniger, die kaputtgeht.

## Lizenz

Die Schriften stehen unter der **SIL Open Font License 1.1** (`fonts/OFL.txt`).
`design-system.css` stammt aus dem CI-Repository desselben Urhebers; es trägt
dort keine eigene Lizenzangabe.
