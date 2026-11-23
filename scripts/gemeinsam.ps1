# Gemeinsame Hilfen für einrichten.ps1 und aktualisieren.ps1 (Windows PowerShell 5.1 und neuer).
# Wird per Punkt eingebunden (". gemeinsam.ps1") und kennt deshalb den Schalter -OhneFragen des Aufrufers.
$ErrorActionPreference = 'Continue'
$Root = Split-Path -Parent $PSScriptRoot
$Port = if ($env:PORT) { [int]$env:PORT } else { 3000 }
$Bat = Join-Path $Root 'Server starten.bat'

function Say([string]$Text = '', [string]$Color = 'Gray') { Write-Host $Text -ForegroundColor $Color }
function Ok([string]$Text) { Write-Host "   OK  $Text" -ForegroundColor Green }
function Warn([string]$Text) { Write-Host "   !   $Text" -ForegroundColor Yellow }
function Step([string]$Text) { Write-Host ''; Write-Host "  $Text" -ForegroundColor White }

function Ask([string]$Question, [string]$Default = '') {
  if ($OhneFragen) { return $Default }
  $a = Read-Host "  $Question"
  if ([string]::IsNullOrWhiteSpace($a)) { return $Default }
  return $a.Trim()
}
function YesNo([string]$Question, [string]$Default = 'n') { return (Ask "$Question (j/n)" $Default) -match '^(j|ja|y|yes)$' }
function Finish([int]$Code = 0) {
  if (-not $OhneFragen) { Write-Host ''; [void](Read-Host '  Enter drücken, um dieses Fenster zu schließen') }
  exit $Code
}

# Node.js suchen – auch direkt nach einer Installation, wenn es noch nicht im Suchpfad steht
function Find-Node {
  $list = @()
  $cmd = Get-Command node.exe -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($cmd) { $list += $cmd.Source }
  $list += (Join-Path $env:ProgramFiles 'nodejs\node.exe')
  foreach ($path in $list) {
    if (-not $path -or -not (Test-Path -LiteralPath $path)) { continue }
    $v = & $path -p 'process.versions.node' 2>$null | Select-Object -First 1
    if ("$v" -match '^(\d+)\.') { return [pscustomobject]@{ Path = $path; Version = "$v"; Major = [int]$Matches[1] } }
  }
  return $null
}

# Verknüpfung auf "Server starten.bat" (Desktop bzw. Autostart)
function New-Shortcut([string]$Path, [string]$Icon) {
  $s = (New-Object -ComObject WScript.Shell).CreateShortcut($Path)
  $s.TargetPath = $Bat
  $s.WorkingDirectory = $Root
  $s.Description = 'Bestellsystem Schützenverein Hochdorf starten'
  if ($Icon) { $s.IconLocation = "$Icon,0" }
  $s.Save()
}

# Der Prozess, der den Server-Port belegt – oder $null
function Get-ServerProcess {
  $c = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
  if (-not $c) { return $null }
  return Get-CimInstance Win32_Process -Filter "ProcessId=$($c.OwningProcess)"
}

# Startet "Server starten.bat" in einem eigenen Fenster und wartet, bis der Server antwortet
function Start-Server {
  Start-Process -FilePath $env:ComSpec -ArgumentList "/c `"`"$Bat`"`"" -WorkingDirectory $Root
  for ($i = 0; $i -lt 40; $i++) { Start-Sleep -Milliseconds 500; if (Get-ServerProcess) { return $true } }
  return $false
}

# Beendet nur unseren Server (node … server.js) samt Fenster – nie ein anderes Programm auf dem Port
function Stop-Server {
  $p = Get-ServerProcess
  if (-not $p) { return $true }
  if ($p.Name -ne 'node.exe' -or $p.CommandLine -notlike '*server.js*') { Warn "Auf Port $Port läuft ein anderes Programm – es wird nicht beendet."; return $false }
  $parent = Get-CimInstance Win32_Process -Filter "ProcessId=$($p.ParentProcessId)" -ErrorAction SilentlyContinue
  if ($parent -and $parent.Name -eq 'cmd.exe' -and $parent.CommandLine -like '*Server starten.bat*') { & taskkill.exe /PID $parent.ProcessId /T /F | Out-Null }
  else { Stop-Process -Id $p.ProcessId -Force }
  for ($i = 0; $i -lt 20; $i++) { Start-Sleep -Milliseconds 300; if (-not (Get-ServerProcess)) { return $true } }
  return $false
}

# Adressen, unter denen Handys und Tablets den Server erreichen
function Get-Addresses {
  Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
    Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' } |
    ForEach-Object { "http://$($_.IPAddress):$Port" }
}
