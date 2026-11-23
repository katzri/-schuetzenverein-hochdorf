# Bestellsystem Schützenverein Hochdorf – Hinweise für Claude Code

Sprich Deutsch und einfach: Der Nutzer ist Vereinsmitglied, kein Programmierer. Erkläre Schritte kurz und ohne Fachwörter.

## Was das ist

- Bestellsystem für Vereinsfeste: Bedienung (Handy) → Küche/Theke (Tablet) → Kasse; Verwaltung mit Auswertung,
  Produkten, Tischplan, PINs, QR-Codes, Sicherung und Festtagen.
- Läuft **ohne Internet** im WLAN einer FRITZ!Box. Server: `server/server.js` (Node.js ab 18, **keine npm-Pakete**),
  Oberfläche: `app/` (reines HTML/JS/CSS, Live-Daten per Server-Sent Events).
- Daten: `server/data/journal.jsonl` (lückenloses Ereignis-Protokoll mit Hash-Kette, wird sofort per fsync geschrieben)
  und `server/data/config.json` (PIN-Hashes, Schlüssel, WLAN-Daten für den QR-Code, zusätzliche Backup-Ordner).
  Jede Buchung wird sofort nach `backup/` und in eingetragene Zusatz-Ordner (USB-Stick) gespiegelt.

## Feste Regeln

- `server/data/` und `backup/` sind **echte Daten**: nie löschen, nie von Hand bearbeiten, nie ins Repository
  (stehen in `.gitignore`). Vor jedem Eingriff eine Kopie anlegen und den Nutzer fragen.
- Nie zwei Server gleichzeitig auf denselben Daten. Der Server belegt erst den Port und öffnet dann die Daten –
  ein zweiter Start auf demselben Port bricht ohne Schreibzugriff ab.
- Alles muss offline laufen: keine CDNs, keine Webfonts, keine externen Dienste, keine npm-Pakete.
- Kein Pfand (Ausschank nur im Haus). Preisliste für ein neues Fest: `server/lib/default-products.js`;
  übernommen wird sie in der Verwaltung → Produkte → „Preisliste … übernehmen“.
- `.bat`-Dateien nur ASCII mit CRLF (sonst zerlegt cmd sie), `.ps1` als UTF-8 mit BOM. `.gitattributes` regelt die Zeilenenden.
- Nach jeder Änderung: `node --test tests/server.test.js tests/gastro.test.js tests/qr.test.js` – alles muss grün sein.
- Zum Ausprobieren eine Kopie von `app/` und `server/` (ohne `server/data`) in einen Temp-Ordner legen und mit
  anderem Port starten (`PORT=3100`). Den echten Server nie zum Testen verwenden.

## Einrichtung auf einem neuen Server-PC

Ziel: Server läuft im eigenen Fenster, Desktop-Verknüpfung ist da, Handys erreichen `http://<IP-des-PCs>:3000`.

### Windows

1. Prüfen: `git --version` und `node -v` (ab 18). Fehlt Git: `winget install --id Git.Git -e --source winget`
   (danach neues Terminal). Repository klonen nach `C:\Schuetzenverein`, falls noch nicht geschehen.
2. Am einfachsten den Nutzer **`Einrichten.bat` doppelklicken** lassen – das Skript fragt alles im Fenster ab
   (Node.js-Installation, Datenübernahme, Desktop-Verknüpfung, Autostart) und startet den Server.
3. Ohne Rückfragen geht es auch – aber nur nach Zustimmung des Nutzers zu jedem Punkt:
   ```
   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\einrichten.ps1 -OhneFragen -Daten "" -Autostart nein -Starten ja
   ```
   - Fehlt Node.js: den Nutzer fragen. Installation mit `winget install --id OpenJS.NodeJS.LTS -e --source winget`;
     Lizenzbestätigung und Windows-Rückfrage erledigt der Nutzer selbst.
   - Bisherige Daten: `-Daten <Ordner>` mit dem Ordner, in dem `journal.jsonl` und `config.json` liegen
     (USB-Backup-Ordner oder alter `server\data`). Geht nur, solange `server\data` hier noch leer ist.
     Prüfen lässt sich ein Daten-Ordner vorher mit `node scripts\daten-pruefen.js <Ordner>`.
4. Den Server immer über **`Server starten.bat`** (bzw. die Desktop-Verknüpfung) starten, also im eigenen Fenster –
   nicht aus der Claude-Sitzung heraus, sonst endet er mit der Sitzung. Ohne übernommene Daten stehen beim allerersten
   Start die **PINs einmalig im Server-Fenster**: den Nutzer bitten, sie aufzuschreiben.
5. Windows-Firewall: Beim ersten Start fragt Windows – „Private Netzwerke“ zulassen. Das WLAN muss in Windows als
   „Privat“ eingestuft sein (`Get-NetConnectionProfile`); bei „Öffentlich“ kommen die Handys nicht durch.
6. Prüfen: `curl -s -o NUL -w "%{http_code}" http://localhost:3000` ergibt 200; die Adresse(n) aus `ipconfig`
   nennen und den Nutzer bitten, sie auf einem Handy im FRITZ!Box-WLAN zu öffnen.
7. Empfehlen: In der FRITZ!Box dem PC immer dieselbe IPv4-Adresse geben; in der Verwaltung → QR-Codes die
   WLAN-Daten eintragen und den Aushang drucken; in der Verwaltung → Sicherung einen USB-Stick als Backup eintragen.

### Linux

`bash scripts/einrichten.sh` – prüft Node.js, übernimmt Daten, richtet auf Wunsch den systemd-Dienst
`schuetzenverein` ein. Node.js ab 18: Debian 12, Ubuntu 24.04, Raspberry Pi OS `sudo apt install nodejs`;
Ubuntu 22.04 `sudo snap install node --classic --channel=20`. Start ohne Dienst: `./server-starten.sh`.
PINs beim ersten Start als Dienst: `journalctl -u schuetzenverein -n 40`. Firewall: `sudo ufw allow 3000/tcp`.

## Aktualisieren

`Aktualisieren.bat` (Windows) bzw. `bash scripts/aktualisieren.sh` (Linux): `git pull --ff-only`, danach Server
neu starten. Die Daten bleiben unberührt. Nicht mitten in einem Fest aktualisieren.

## Häufige Fragen

- **Verwaltungs-PIN vergessen:** Server beenden, im Ordner `server` `node server.js --neue-pins` ausführen –
  alle PINs werden neu vergeben und im Fenster angezeigt. Danach mit Strg+C beenden und normal starten.
- **Handys erreichen den Server nicht:** gleiches WLAN (nicht Gastnetz), Firewall-Freigabe, Netzwerkprofil „Privat“,
  Adresse mit `http://` und `:3000`. Siehe Tabelle in `docs/Anleitung-Hosting.md`.
- **Warum PINs?** Wer den QR-Code seiner Arbeitsgruppe scannt, braucht keine PIN. Die PIN schützt vor Gästen im
  selben WLAN und ist der Ersatzweg; die Verwaltung meldet sich immer mit PIN an.
