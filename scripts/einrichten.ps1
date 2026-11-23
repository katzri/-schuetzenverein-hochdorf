<#
  Richtet das Bestellsystem des Schützenvereins Hochdorf auf diesem Windows-Rechner ein:
  Node.js, bisherige Daten, Desktop-Verknüpfung, Autostart – und startet den Server.

  Normal: Doppelklick auf "Einrichten.bat" im Programmordner. Alle Fragen kommen dann im Fenster.

  Ohne Rückfragen (z. B. durch Claude Code – vorher den Nutzer fragen!):
    powershell -NoProfile -ExecutionPolicy Bypass -File scripts\einrichten.ps1 -OhneFragen -Daten "" -Autostart nein -Starten ja

  -Daten <Ordner>            bisherige Daten übernehmen: Ordner mit journal.jsonl (Backup-Ordner auf dem USB-Stick,
                             alter Ordner server\data oder alter Programmordner). Leer = neu beginnen.
                             Geht nur, solange hier noch keine Daten liegen – vorhandene Daten werden nie überschrieben.
  -Autostart ja|nein         Server bei jeder Anmeldung an diesem PC automatisch starten
  -Starten ja|nein           Server am Ende starten (Standard: ja)
  -NodeInstallieren ja|nein  fehlendes Node.js über winget installieren
  -Desktop <Ordner>          wohin die Verknüpfung kommt (Standard: Desktop)
  -OhneFragen                keine Rückfragen, kein Warten am Ende
#>
param(
  [string]$Daten = '',
  [ValidateSet('', 'ja', 'nein')][string]$Autostart = '',
  [ValidateSet('ja', 'nein')][string]$Starten = 'ja',
  [ValidateSet('', 'ja', 'nein')][string]$NodeInstallieren = '',
  [string]$Desktop = '',
  [switch]$OhneFragen
)
. (Join-Path $PSScriptRoot 'gemeinsam.ps1')

Say ''
Say '  Bestellsystem Schützenverein Hochdorf – Einrichtung' 'White'
Say "  Programmordner: $Root"

# ---------- 1. Node.js ----------
Step '1. Node.js (führt den Server aus)'
$node = Find-Node
if ($node -and $node.Major -ge 18) { Ok "Node.js $($node.Version) ist installiert." }
else {
  if ($node) { Warn "Node.js $($node.Version) ist zu alt – nötig ist Version 18 oder neuer." } else { Warn 'Node.js ist noch nicht installiert.' }
  $winget = Get-Command winget.exe -ErrorAction SilentlyContinue
  $install = if ($NodeInstallieren) { $NodeInstallieren -eq 'ja' } elseif ($winget) { YesNo 'Node.js jetzt installieren? (braucht Internet; Windows fragt eventuell nach Erlaubnis)' 'j' } else { $false }
  if ($install -and $winget) {
    Say '     Node.js (LTS) wird über winget installiert …'
    & winget.exe install --id OpenJS.NodeJS.LTS -e --source winget
    $node = Find-Node
  }
  if (-not $node -or $node.Major -lt 18) {
    Warn 'Node.js fehlt noch. Bitte die LTS-Version von https://nodejs.org installieren und danach "Einrichten.bat" erneut starten.'
    Finish 1
  }
  Ok "Node.js $($node.Version) ist jetzt installiert."
}

# ---------- 2. Daten ----------
Step '2. Daten'
$dataDir = Join-Path $Root 'server\data'
if (Test-Path -LiteralPath (Join-Path $dataDir 'journal.jsonl')) {
  Ok 'Hier liegen schon Daten – sie bleiben unverändert.'
} else {
  if ($PSBoundParameters.ContainsKey('Daten')) { $src = $Daten }
  else {
    Say '     Gibt es Daten vom bisherigen Rechner (Buchungen, Produkte, PINs)? Zum Beispiel den Backup-Ordner'
    Say '     auf dem USB-Stick oder den Ordner "server\data" des alten Laptops.'
    $src = Ask 'Ordner angeben – oder einfach Enter für "neu beginnen":' ''
  }
  $src = "$src".Trim().Trim('"')
  if ($src) {
    $from = @($src, (Join-Path $src 'server\data'), (Join-Path $src 'data')) |
      Where-Object { Test-Path -LiteralPath (Join-Path $_ 'journal.jsonl') } | Select-Object -First 1
    if (-not $from) { Warn "In ""$src"" liegt keine journal.jsonl – es wird neu begonnen." }
    else {
      New-Item -ItemType Directory -Force -Path $dataDir | Out-Null
      foreach ($f in 'journal.jsonl', 'config.json') {
        $p = Join-Path $from $f
        if (Test-Path -LiteralPath $p) { Copy-Item -LiteralPath $p -Destination $dataDir }
      }
      Ok "Übernommen aus $from"
      & $node.Path (Join-Path $Root 'scripts\daten-pruefen.js') $dataDir | ForEach-Object { Say "     $_" }
    }
  } else { Ok 'Es wird neu begonnen – mit der Preisliste aus server\lib\default-products.js.' }
  if (-not (Test-Path -LiteralPath (Join-Path $dataDir 'config.json'))) { Warn 'Beim ersten Start zeigt das Server-Fenster einmalig die PINs – bitte aufschreiben!' }
}

# ---------- 3. Verknüpfung und Autostart ----------
Step '3. Verknüpfung'
$deskDir = if ($Desktop) { $Desktop } else { [Environment]::GetFolderPath('Desktop') }
New-Item -ItemType Directory -Force -Path $deskDir | Out-Null
New-Shortcut (Join-Path $deskDir 'Schützenverein Server starten.lnk') $node.Path
Ok 'Auf dem Desktop: "Schützenverein Server starten"'
$auto = Join-Path ([Environment]::GetFolderPath('Startup')) 'Schützenverein Server.lnk'
$wantAuto = if ($Autostart) { $Autostart -eq 'ja' } else { YesNo 'Server bei jeder Anmeldung an diesem PC automatisch starten?' 'n' }
if ($wantAuto) { New-Shortcut $auto $node.Path; Ok 'Autostart eingerichtet – der Server startet nach jeder Anmeldung an Windows.' }
elseif (Test-Path -LiteralPath $auto) { Remove-Item -LiteralPath $auto; Ok 'Autostart ausgeschaltet.' }
else { Ok 'Kein Autostart – gestartet wird per Doppelklick auf die Verknüpfung.' }

# ---------- 4. Netzwerk ----------
Step '4. Netzwerk'
$kind = @{ Private = 'Privat'; Public = 'Öffentlich'; DomainAuthenticated = 'Domäne' }
try {
  foreach ($p in (Get-NetConnectionProfile -ErrorAction Stop)) {
    $cat = "$($p.NetworkCategory)"
    if ($cat -eq 'Public') {
      Warn "Das Netzwerk ""$($p.Name)"" ist in Windows als ""Öffentlich"" eingestuft – dann lässt Windows die Handys nicht durch."
      Say  '         Ändern: Einstellungen > Netzwerk und Internet > WLAN (bzw. Ethernet) > Eigenschaften > "Privates Netzwerk".'
    } else { Ok "Netzwerk ""$($p.Name)"": $(if ($kind[$cat]) { $kind[$cat] } else { $cat })" }
  }
} catch { }
$urls = @(Get-Addresses)
if ($urls.Count) { $urls | ForEach-Object { Say "     Adresse für Handys und Tablets: $_" 'Cyan' } }
else { Warn 'Dieser PC ist mit keinem Netzwerk verbunden – bitte mit dem WLAN der FRITZ!Box verbinden.' }
Say '     Fragt Windows beim ersten Start, ob "Node.js" im Netzwerk kommunizieren darf:'
Say '     "Private Netzwerke" anhaken und "Zugriff zulassen" klicken.' 'Yellow'

# ---------- 5. Start ----------
if ($Starten -eq 'ja') {
  Step '5. Server starten'
  if (Get-ServerProcess) { Ok 'Der Server läuft bereits.' }
  elseif (Start-Server) { Ok 'Der Server läuft – das schwarze Server-Fenster bitte offen lassen.' }
  else { Warn 'Der Server hat sich noch nicht gemeldet – bitte ins Server-Fenster schauen.' }
}

Say ''
Say '  Fertig! Täglicher Start: Doppelklick auf "Schützenverein Server starten" auf dem Desktop.' 'Green'
Say '  Ausführliche Anleitung: docs\Anleitung-Hosting.md'
Finish 0
