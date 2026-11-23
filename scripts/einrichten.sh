#!/usr/bin/env bash
# Richtet das Bestellsystem des Schützenvereins Hochdorf auf einem Linux-Rechner ein
# (Ubuntu, Debian, Raspberry Pi OS …). Aufruf im Programmordner:  bash scripts/einrichten.sh
#
# Ohne Rückfragen:  SVH_DATEN="" SVH_AUTOSTART=nein SVH_STARTEN=nein bash scripts/einrichten.sh
#   SVH_DATEN      Ordner mit journal.jsonl vom bisherigen Rechner (leer = neu beginnen)
#   SVH_AUTOSTART  ja|nein – Server beim Hochfahren per systemd starten (braucht sudo)
#   SVH_STARTEN    ja|nein – Server am Ende in diesem Fenster starten
set -u
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PORT="${PORT:-3000}"
ok()    { printf '   OK  %s\n' "$*"; }
warn()  { printf '   !   %s\n' "$*"; }
step()  { printf '\n  %s\n' "$*"; }
ask()   { local a=""; read -r -p "  $1 " a || true; printf '%s' "$a"; }
isyes() { case "${1:-}" in j|J|ja|Ja|y|Y|yes) return 0 ;; *) return 1 ;; esac; }

printf '\n  Bestellsystem Schützenverein Hochdorf – Einrichtung\n  Programmordner: %s\n' "$ROOT"

step '1. Node.js (führt den Server aus)'
major=0
if command -v node >/dev/null 2>&1; then major="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"; fi
if [ "${major:-0}" -ge 18 ] 2>/dev/null; then
  ok "Node.js $(node -v) ist installiert."
else
  warn 'Node.js 18 oder neuer fehlt. Bitte installieren und dieses Skript danach erneut starten:'
  echo '         Debian 12, Ubuntu 24.04, Raspberry Pi OS:  sudo apt install nodejs'
  echo '         Ubuntu 22.04 (dort ist das apt-Paket zu alt):  sudo snap install node --classic --channel=20'
  exit 1
fi

step '2. Daten'
DATA="$ROOT/server/data"
if [ -f "$DATA/journal.jsonl" ]; then
  ok 'Hier liegen schon Daten – sie bleiben unverändert.'
else
  if [ "${SVH_DATEN+gesetzt}" = gesetzt ]; then
    src="$SVH_DATEN"
  else
    echo '     Gibt es Daten vom bisherigen Rechner (Buchungen, Produkte, PINs)? Zum Beispiel den'
    echo '     Backup-Ordner auf dem USB-Stick oder den Ordner "server/data" des alten Laptops.'
    src="$(ask 'Ordner angeben – oder einfach Enter für "neu beginnen":')"
  fi
  if [ -n "$src" ]; then
    from=""
    for d in "$src" "$src/server/data" "$src/data"; do
      if [ -f "$d/journal.jsonl" ]; then from="$d"; break; fi
    done
    if [ -z "$from" ]; then
      warn "In \"$src\" liegt keine journal.jsonl – es wird neu begonnen."
    else
      mkdir -p "$DATA"
      cp "$from/journal.jsonl" "$DATA/"
      if [ -f "$from/config.json" ]; then cp "$from/config.json" "$DATA/"; fi
      ok "Übernommen aus $from"
      node "$ROOT/scripts/daten-pruefen.js" "$DATA" | sed 's/^/     /'
    fi
  else
    ok 'Es wird neu begonnen – mit der Preisliste aus server/lib/default-products.js.'
  fi
  [ -f "$DATA/config.json" ] || warn 'Beim ersten Start zeigt der Server einmalig die PINs – bitte aufschreiben!'
fi

step '3. Autostart'
auto="${SVH_AUTOSTART-}"
if ! command -v systemctl >/dev/null 2>&1; then
  auto=nein
elif [ -z "$auto" ]; then
  auto="$(ask 'Server beim Hochfahren automatisch starten? Braucht einmal das sudo-Passwort. (j/n)')"
fi
service=nein
if isyes "$auto"; then
  sudo tee /etc/systemd/system/schuetzenverein.service >/dev/null <<EOF
[Unit]
Description=Bestellsystem Schützenverein Hochdorf
After=network-online.target
Wants=network-online.target

[Service]
User=$(id -un)
WorkingDirectory=$ROOT/server
Environment=PORT=$PORT
ExecStart=$(command -v node) server.js
Restart=on-failure
RestartSec=3
# Exit-Code 1 = Startproblem (z. B. läuft schon) – erneutes Starten hilft dann nicht
RestartPreventExitStatus=1

[Install]
WantedBy=multi-user.target
EOF
  if sudo systemctl daemon-reload && sudo systemctl enable --now schuetzenverein; then
    service=ja
    ok 'Autostart eingerichtet. Zustand:  sudo systemctl status schuetzenverein'
    ok 'Meldungen und beim ersten Start die PINs:  journalctl -u schuetzenverein -n 40'
  else
    warn 'Autostart konnte nicht eingerichtet werden.'
  fi
else
  ok "Kein Autostart – gestartet wird mit:  $ROOT/server-starten.sh"
fi

step '4. Netzwerk'
ips="$(hostname -I 2>/dev/null || true)"
found=0
for ip in $ips; do
  # nur IPv4-Adressen (Ziffern und Punkte), keine IPv6- oder Fehlertexte
  case "$ip" in *[!0-9.]*|"") ;; *) printf '     Adresse für Handys und Tablets: http://%s:%s\n' "$ip" "$PORT"; found=1 ;; esac
done
[ "$found" = 1 ] || warn 'Keine Netzwerkadresse gefunden – bitte mit dem WLAN der FRITZ!Box verbinden (Adresse: ip addr).'
echo "     Falls eine Firewall aktiv ist (ufw):  sudo ufw allow $PORT/tcp"
echo '     Laptop als Server – Standby abschalten:  sudo systemctl mask sleep.target suspend.target hibernate.target hybrid-sleep.target'

if [ "$service" = ja ]; then printf '\n  Fertig – der Server läuft als Dienst.\n\n'; exit 0; fi
start="${SVH_STARTEN-}"
[ -n "$start" ] || start="$(ask 'Server jetzt in diesem Fenster starten? (j/n)')"
if isyes "$start"; then
  printf '\n  Der Server startet – dieses Fenster offen lassen, beenden mit Strg+C.\n'
  exec bash "$ROOT/server-starten.sh"
fi
printf '\n  Fertig. Starten mit:  %s/server-starten.sh\n\n' "$ROOT"
