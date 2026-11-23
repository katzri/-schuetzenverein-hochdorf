@echo off
title Schuetzenverein Hochdorf - Bestellsystem
rem Startet den Bestellserver. Dieses Fenster offen lassen, solange das Fest laeuft.
rem Beenden: Strg+C druecken oder das Fenster schliessen.
cd /d "%~dp0server"
if not defined PORT set "PORT=3000"

rem Node.js suchen - direkt nach einer frischen Installation steht es noch nicht im Suchpfad
set "NODE=node"
where node >nul 2>nul
if errorlevel 1 set "NODE=%ProgramFiles%\nodejs\node.exe"
"%NODE%" -e "process.exit(Number(process.versions.node.split('.')[0]) >= 18 ? 0 : 1)" >nul 2>nul
if errorlevel 1 (
  echo.
  echo   Node.js fehlt oder ist zu alt - noetig ist Version 18 oder neuer.
  echo   Am einfachsten "Einrichten.bat" starten - oder Node.js LTS von https://nodejs.org installieren.
  echo.
  pause
  exit /b 1
)

rem Laeuft der Server schon? Dann kein zweites Mal starten - zwei Server duerfen nie gleichzeitig ins Protokoll schreiben.
powershell -NoProfile -Command "if (Get-NetTCPConnection -LocalPort %PORT% -State Listen -ErrorAction SilentlyContinue) { exit 0 } else { exit 1 }"
if not errorlevel 1 (
  echo.
  echo   Der Server laeuft bereits - ein zweiter Start ist nicht noetig.
  echo   Auf diesem Rechner: http://localhost:%PORT%
  echo.
  if not defined SVH_OHNE_BROWSER start "" http://localhost:%PORT%
  pause
  exit /b 0
)

rem Browser auf diesem Rechner nach zwei Sekunden oeffnen, wenn der Server bereit ist
if not defined SVH_OHNE_BROWSER start "" /min cmd /c "timeout /t 2 >nul & start "" http://localhost:%PORT%"
"%NODE%" server.js
echo.
echo   Der Server wurde beendet. Handys und Tablets koennen jetzt nichts mehr senden.
echo.
pause
