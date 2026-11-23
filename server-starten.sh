#!/usr/bin/env bash
# Startet den Bestellserver (Linux). Fenster offen lassen, beenden mit Strg+C.
# Unter Windows stattdessen "Server starten.bat" verwenden.
cd "$(dirname "${BASH_SOURCE[0]}")/server" || exit 1
if ! command -v node >/dev/null 2>&1; then
  echo 'Node.js fehlt – bitte zuerst  bash scripts/einrichten.sh  ausführen.'
  exit 1
fi
exec node server.js "$@"
