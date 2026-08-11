<?php
/**
 * Liest screenshotter.conf — die Datei, die sich Shell und PHP teilen.
 *
 * Warum nicht parse_ini_file: dieselbe Datei wird von den Shell-Skripten mit
 * `.` eingelesen und braucht deshalb `#` als Kommentarzeichen. PHPs INI-Leser
 * kennt nur `;`, parst die `#`-Zeilen mit und wirft bei einer Klammer darin
 * einen Syntaxfehler. Zurück kommt `false` — und der Webhook meldet „nicht
 * eingerichtet", obwohl alles richtig dasteht. Das ist genau einmal passiert
 * und hat eine halbe Fehlersuche gekostet.
 *
 * Steht in einer eigenen Datei, damit ein Test die Funktion aufrufen kann,
 * ohne dass webhook.php dabei eine Antwort schickt.
 */

declare(strict_types=1);

/**
 * @return array<string,string>|false  false nur, wenn die Datei nicht lesbar ist
 */
function konfigurationLesen(string $pfad): array|false
{
    $roh = @file_get_contents($pfad);
    if ($roh === false) {
        return false;
    }

    $werte = [];
    foreach (preg_split('/\R/', $roh) ?: [] as $zeile) {
        // Nur KEY=wert zählt. Kommentare, Leerzeilen und alles Übrige fallen
        // durch — es wird nichts ausgewertet, was wie Shell aussieht.
        if (!preg_match('/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/', $zeile, $treffer)) {
            continue;
        }

        $wert = rtrim($treffer[2]);
        $laenge = strlen($wert);
        if ($laenge >= 2 && ($wert[0] === '"' || $wert[0] === "'") && $wert[$laenge - 1] === $wert[0]) {
            $wert = substr($wert, 1, -1);
        }

        $werte[$treffer[1]] = $wert;
    }

    return $werte;
}
