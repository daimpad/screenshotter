<?php
/**
 * screenshotter — Auslöser für einen Lauf.
 *
 * Diese Datei ist die EINZIGE, die ins öffentliche Verzeichnis gehört.
 * Alles andere — Instanz, Konfiguration, Geheimnis, Protokolle — bleibt
 * außerhalb.
 *
 * Aufruf:
 *   curl -X POST -H "X-Screenshotter-Token: <geheimnis>" \
 *        https://beispiel.de/screenshotter-webhook.php
 *
 * Antworten:
 *   202  angenommen, der Lauf ist gestartet
 *   401  Geheimnis fehlt oder passt nicht
 *   405  kein POST
 *   409  es läuft schon einer
 *   429  zu kurz nach dem letzten Lauf
 *   503  falsch eingerichtet
 *
 * Bewusste Entscheidungen:
 *
 * - Der Aufruf nimmt KEINE Parameter entgegen. Weder URLs noch Zielordner.
 *   Ein Auslöser, der sich sagen lässt, was er aufnehmen soll, ist ein
 *   offener Anfrage-Weiterleiter: jeder mit dem Geheimnis könnte deinen
 *   Server interne Adressen abrufen lassen. Was aufgenommen wird, steht in
 *   urls.txt auf dem Server.
 * - Verglichen wird mit hash_equals, nicht mit ===. Ein normaler Vergleich
 *   bricht beim ersten falschen Zeichen ab und verrät über die Laufzeit,
 *   wie viel vom Geheimnis stimmt.
 * - Fehlermeldungen nennen nie einen Pfad.
 */

declare(strict_types=1);

// ── Das Einzige, was du hier anpasst ──────────────────────────────────────
// Absoluter Pfad zum Instanzverzeichnis (dort liegt der Ordner deploy/).
$instanz = '/var/www/vhosts/beispiel.de/screenshotter';
// ──────────────────────────────────────────────────────────────────────────

header('Content-Type: text/plain; charset=utf-8');
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');

/** Antworten und Schluss — ohne je einen Pfad zu verraten. */
function ende(int $code, string $text): never
{
    http_response_code($code);
    echo $text, "\n";
    exit;
}

if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
    header('Allow: POST');
    ende(405, 'Nur POST.');
}

$konfig = $instanz . '/deploy/screenshotter.conf';
if (!is_readable($konfig)) {
    error_log('screenshotter-webhook: Konfiguration nicht lesbar');
    ende(503, 'Nicht eingerichtet.');
}

$conf = parse_ini_file($konfig, false, INI_SCANNER_TYPED);
if ($conf === false) {
    error_log('screenshotter-webhook: Konfiguration nicht lesbar');
    ende(503, 'Nicht eingerichtet.');
}

$geheimnis = (string) ($conf['WEBHOOK_GEHEIMNIS'] ?? '');
if ($geheimnis === '') {
    // Kein Geheimnis heißt nicht "offen für alle", sondern "zu".
    error_log('screenshotter-webhook: WEBHOOK_GEHEIMNIS ist leer');
    ende(503, 'Nicht eingerichtet.');
}

$gesendet = (string) ($_SERVER['HTTP_X_SCREENSHOTTER_TOKEN'] ?? '');
if ($gesendet === '' || !hash_equals($geheimnis, $gesendet)) {
    ende(401, 'Nicht berechtigt.');
}

// ── Flutschutz ────────────────────────────────────────────────────────────
$mindestabstand = (int) ($conf['WEBHOOK_MINDESTABSTAND'] ?? 300);
$stempel = $instanz . '/sperre/letzter-webhook';
if ($mindestabstand > 0 && is_file($stempel)) {
    $verstrichen = time() - (int) filemtime($stempel);
    if ($verstrichen < $mindestabstand) {
        header('Retry-After: ' . ($mindestabstand - $verstrichen));
        ende(429, 'Zu kurz nach dem letzten Lauf.');
    }
}

// ── Läuft schon einer? ────────────────────────────────────────────────────
// lauf.sh benutzt dasselbe Verzeichnis als Sperre. Hier wird nur
// nachgesehen; die eigentliche Entscheidung trifft das Skript atomar.
if (is_dir($instanz . '/sperre/lauf')) {
    ende(409, 'Es laeuft bereits einer.');
}

$skript = $instanz . '/deploy/lauf.sh';
if (!is_file($skript)) {
    error_log('screenshotter-webhook: lauf.sh fehlt');
    ende(503, 'Nicht eingerichtet.');
}

if (!function_exists('exec')) {
    // Auf manchen Paketen ist exec abgeschaltet. Dann bleibt der Umweg über
    // eine Marke, die ein Minutencron abholt — siehe deploy/README.md.
    @mkdir($instanz . '/sperre', 0o700, true);
    if (file_put_contents($instanz . '/sperre/angefordert', (string) time()) === false) {
        error_log('screenshotter-webhook: Marke nicht schreibbar');
        ende(503, 'Nicht eingerichtet.');
    }
    @touch($stempel);
    ende(202, 'Vorgemerkt.');
}

@mkdir($instanz . '/sperre', 0o700, true);
@touch($stempel);

// Loslösen, damit die Antwort sofort geht: der Lauf dauert Minuten, kein
// Aufrufer wartet so lange. Alle Argumente sind fest, nichts kommt aus der
// Anfrage — deshalb ist hier nichts zu maskieren außer den Pfaden selbst.
$befehl = 'nohup ' . escapeshellarg($skript)
    . ' >> ' . escapeshellarg($instanz . '/log/webhook.log') . ' 2>&1 &';
exec($befehl);

ende(202, 'Angenommen.');
