#!/usr/bin/env bash
# Holt die neueste Version des Bestellsystems (git pull) und startet den Dienst neu (Linux).
# Die Daten (server/data, backup) bleiben unberührt – sie sind nicht Teil des Repositorys.
set -u
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
before="$(git -C "$ROOT" rev-parse --short HEAD)"
if ! git -C "$ROOT" pull --ff-only; then
  echo '   !   Aktualisieren hat nicht geklappt (Meldung oben). Die Daten sind davon nicht betroffen.'
  exit 1
fi
after="$(git -C "$ROOT" rev-parse --short HEAD)"
if [ "$before" = "$after" ]; then echo '   OK  Es ist bereits die neueste Version installiert.'; exit 0; fi
echo "   OK  Neue Version installiert ($before -> $after). Neu dabei:"
git -C "$ROOT" log --format='       - %s' "$before..$after"
if command -v systemctl >/dev/null 2>&1 && systemctl is-active --quiet schuetzenverein 2>/dev/null; then
  sudo systemctl restart schuetzenverein && echo '   OK  Server neu gestartet. Handys und Tablets verbinden sich von selbst wieder.'
else
  echo '   Die neue Version gilt nach dem nächsten Start des Servers (Strg+C im Server-Fenster, dann ./server-starten.sh).'
fi
