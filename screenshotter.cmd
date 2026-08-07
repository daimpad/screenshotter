@echo off
REM ===========================================================================
REM  screenshotter - Starter fuer Windows
REM
REM  Einfach doppelklicken. Beim ersten Start werden Node-Abhaengigkeiten und
REM  der Browser eingerichtet, danach geht es direkt los.
REM
REM  Diese Datei bewusst ohne Umlaute, damit sie auf jeder Windows-Codepage
REM  korrekt angezeigt wird.
REM ===========================================================================

setlocal EnableExtensions
chcp 65001 >nul 2>&1
title screenshotter - Screenshots und HTML-Report
cd /d "%~dp0"

cls
echo.
echo   ==========================================================
echo    screenshotter - Full-Page-Screenshots + HTML-Report
echo   ==========================================================
echo.

REM --------------------------------------------------------------- Node.js
where node >nul 2>&1
if errorlevel 1 goto NO_NODE

REM ------------------------------------------------------- Abhaengigkeiten
if exist "node_modules\playwright\package.json" goto DEPS_OK
echo   Erster Start: die Abhaengigkeiten werden installiert.
echo   Das dauert ein bis zwei Minuten und passiert nur einmal.
echo.
call npm install --no-audit --no-fund
if errorlevel 1 goto FAIL_NPM
echo.
:DEPS_OK

REM --------------------------------------------------------------- Browser
node -e "const fs=require('fs');process.exit(fs.existsSync(require('playwright').chromium.executablePath())?0:1)" >nul 2>&1
if not errorlevel 1 goto BROWSER_OK
echo   Der Browser Chromium wird heruntergeladen ^(einmalig, ca. 150 MB^).
echo.
call npx --yes playwright install chromium
if errorlevel 1 goto FAIL_BROWSER
echo.
:BROWSER_OK

REM -------------------------------------------------------------- urls.txt
if not exist "urls.txt" goto MAKE_URLS

:MENU
echo.
node -e "const fs=require('fs');const l=fs.readFileSync('urls.txt','utf8').split(/\r?\n/).map(s=>s.trim()).filter(s=>s&&!s.startsWith('#')&&!s.startsWith('//'));console.log('   In urls.txt stehen aktuell '+l.length+' URL(s).');process.exit(l.length?0:1)"
if errorlevel 1 goto NO_URLS
echo.
echo     [1]  Screenshots jetzt erstellen
echo     [2]  urls.txt bearbeiten
echo     [3]  Beenden
echo.
choice /c 123 /n /m "   Auswahl: "
if errorlevel 3 goto ENDE
if errorlevel 2 goto EDIT
goto RUN

:NO_URLS
echo.
echo   In urls.txt steht noch keine URL.
goto EDIT

:MAKE_URLS
REM Die Vorlage liegt im CLI, damit sie nur an einer Stelle gepflegt wird.
node screenshotter.js --init >nul 2>&1
if not exist "urls.txt" goto FAIL_INIT
goto EDIT

:EDIT
echo.
echo   Der Editor wird geoeffnet. Trage dort eine URL pro Zeile ein,
echo   speichere mit Strg+S und komme dann in dieses Fenster zurueck.
echo.
start "" notepad.exe "urls.txt"
echo   Weiter mit einer beliebigen Taste...
pause >nul
goto MENU

:RUN
echo.
echo   Die Screenshots werden erstellt. Je nach Anzahl der URLs
echo   dauert das einen Moment...
echo.
node screenshotter.js
set "RC=%ERRORLEVEL%"
echo.
if "%RC%"=="2" goto FAIL_RUN
if not "%RC%"=="1" goto OPEN
echo   Hinweis: Mindestens eine URL ist fehlgeschlagen. Sie steht
echo   mit Fehlermeldung im Report.
echo.

:OPEN
if not exist "index.html" goto FAIL_RUN
start "" "index.html"
echo   Fertig. Der Report wurde im Browser geoeffnet:
echo     %CD%\index.html
echo.
echo   Fenster schliessen mit einer beliebigen Taste...
pause >nul
goto ENDE

REM ----------------------------------------------------------- Fehlerfaelle
:NO_NODE
echo   Node.js wurde auf diesem Rechner nicht gefunden.
echo.
echo   Bitte einmalig installieren - die LTS-Version mit den
echo   Standardeinstellungen genuegt. Danach diese Datei erneut starten.
echo.
choice /c JN /n /m "   Downloadseite jetzt oeffnen? [J/N] "
if errorlevel 2 goto ENDE
start "" "https://nodejs.org/de/download"
goto ENDE

:FAIL_NPM
echo.
echo   Die Installation der Abhaengigkeiten ist fehlgeschlagen.
echo   Haeufigste Ursache: keine Internetverbindung oder ein Firmenproxy.
echo   Die genaue Meldung steht oben in der Ausgabe von npm.
goto HALT

:FAIL_BROWSER
echo.
echo   Der Download des Browsers ist fehlgeschlagen.
echo   Bitte die Internetverbindung pruefen und diese Datei
echo   danach erneut starten.
goto HALT

:FAIL_INIT
echo.
echo   urls.txt konnte nicht angelegt werden.
echo   Fehlt die Schreibberechtigung in diesem Ordner?
goto HALT

:FAIL_RUN
echo.
echo   Der Lauf wurde nicht erfolgreich beendet.
echo   Die Meldung oben nennt die Ursache, zum Beispiel eine
echo   ungueltige Zeile in urls.txt.
goto HALT

:HALT
echo.
echo   Fenster schliessen mit einer beliebigen Taste...
pause >nul
goto ENDE

:ENDE
endlocal
exit /b
