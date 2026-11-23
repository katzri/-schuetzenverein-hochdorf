<#
  Holt die neueste Version des Bestellsystems (git pull) und startet den Server auf Wunsch neu.
  Die Daten (server\data, backup) bleiben unberührt – sie sind nicht Teil des Repositorys.

  Normal: Doppelklick auf "Aktualisieren.bat" im Programmordner.
  Ohne Rückfragen: powershell -NoProfile -ExecutionPolicy Bypass -File scripts\aktualisieren.ps1 -OhneFragen -Neustart ja
#>
param(
  [ValidateSet('', 'ja', 'nein')][string]$Neustart = '',
  [switch]$OhneFragen
)
. (Join-Path $PSScriptRoot 'gemeinsam.ps1')

Say ''
Say '  Bestellsystem Schützenverein Hochdorf – Aktualisieren' 'White'
if (-not (Get-Command git.exe -ErrorAction SilentlyContinue)) {
  Warn 'Git ist nicht installiert. Installieren mit: winget install --id Git.Git -e --source winget'
  Finish 1
}
$before = & git.exe -C $Root rev-parse --short HEAD 2>$null
& git.exe -C $Root pull --ff-only
if ($LASTEXITCODE -ne 0) { Warn 'Aktualisieren hat nicht geklappt (Meldung oben). Die Daten sind davon nicht betroffen.'; Finish 1 }
$after = & git.exe -C $Root rev-parse --short HEAD 2>$null
if ($before -eq $after) { Ok 'Es ist bereits die neueste Version installiert.'; Finish 0 }

Ok "Neue Version installiert ($before -> $after). Neu dabei:"
& git.exe -C $Root log --format='       - %s' "$before..$after"
if (Get-ServerProcess) {
  $restart = if ($Neustart) { $Neustart -eq 'ja' } else { YesNo 'Der Server läuft gerade. Jetzt neu starten, damit die neue Version gilt? (dauert ein paar Sekunden)' 'j' }
  if ($restart) {
    if ((Stop-Server) -and (Start-Server)) { Ok 'Server neu gestartet. Handys und Tablets verbinden sich von selbst wieder.' }
    else { Warn 'Neustart hat nicht geklappt – bitte das Server-Fenster schließen und per Verknüpfung neu starten.' }
  } else { Say '     Die neue Version gilt nach dem nächsten Start des Servers.' }
}
Finish 0
