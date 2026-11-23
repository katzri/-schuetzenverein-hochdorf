# Bestellsystem Schützenverein Hochdorf

Bestellen, Küche, Theke, Kasse und Verwaltung für Vereinsfeste – läuft **komplett ohne Internet** im WLAN der FRITZ!Box.
Ein PC oder Laptop ist der Server, Handys und Tablets öffnen die App einfach im Browser (oder per QR-Code).

## Auf dem Server-PC einrichten (Windows)

**Einmalig vorher – nur wenn Git noch fehlt:** Eingabeaufforderung öffnen (Windows-Taste, `cmd` tippen, Enter) und eingeben:

```
winget install --id Git.Git -e --source winget
```

Danach das Fenster schließen und ein **neues** öffnen.

**Dann nur noch diese eine Zeile** in die Eingabeaufforderung oder PowerShell kopieren und Enter drücken:

```
cmd /c "git clone https://github.com/katzri/schuetzenverein-hochdorf.git C:\Schuetzenverein && C:\Schuetzenverein\Einrichten.bat"
```

Das Repository ist privat: Beim ersten Mal erscheint ein GitHub-Anmeldefenster – mit dem Konto **katzri** anmelden
(„Sign in with your browser“). Danach erledigt die Einrichtung den Rest und fragt nur kurz nach:

1. installiert **Node.js**, falls es fehlt (Windows fragt dabei nach Erlaubnis),
2. übernimmt auf Wunsch die **bisherigen Daten** – z. B. den Backup-Ordner vom USB-Stick (Buchungen, Produkte, PINs),
3. legt **„Schützenverein Server starten“** auf den Desktop,
4. richtet auf Wunsch den **Autostart** ein,
5. startet den Server und zeigt die **Adresse für die Handys**.

Fragt Windows beim ersten Start, ob „Node.js“ im Netzwerk kommunizieren darf: **„Private Netzwerke“ anhaken und zulassen.**
Ohne übernommene Daten zeigt das Server-Fenster beim allerersten Start einmalig die **PINs** – aufschreiben!

`Einrichten.bat` darf jederzeit erneut gestartet werden; vorhandene Daten bleiben dabei unverändert.

## Linux (Ubuntu, Debian, Raspberry Pi OS)

```
git clone https://github.com/katzri/schuetzenverein-hochdorf.git ~/schuetzenverein && bash ~/schuetzenverein/scripts/einrichten.sh
```

Das Skript prüft Node.js (ab Version 18), übernimmt auf Wunsch Daten und richtet auf Wunsch einen Autostart-Dienst ein.

## Einrichten mit Claude Code

Falls etwas hakt: Auf dem Server-PC Claude installieren (Desktop-App von https://claude.ai/download, dort den Bereich
„Code“ öffnen) und den Ordner `C:\Schuetzenverein` wählen – oder im Terminal im Ordner `claude` starten. Dann einfach schreiben:

> Richte den Server ein. Alles steht in der CLAUDE.md.

Ist der Ordner noch gar nicht da:

> Klone https://github.com/katzri/schuetzenverein-hochdorf nach C:\Schuetzenverein und richte den Server nach der CLAUDE.md darin ein.

In der [CLAUDE.md](CLAUDE.md) steht alles, was Claude Code dafür wissen muss.

## Im Alltag

| Was | Wie |
|---|---|
| Server starten | Doppelklick auf **„Schützenverein Server starten“** (Desktop) – das Fenster offen lassen |
| Handys verbinden | Verwaltung → **QR-Codes** → Aushang drucken (WLAN + Anmeldung ohne PIN) |
| Neue Version holen | Doppelklick auf **`Aktualisieren.bat`** – die Daten bleiben unberührt |
| Zweites Backup | Verwaltung → **Sicherung** → USB-Stick-Ordner eintragen |
| Alles Weitere | [docs/Anleitung-Hosting.md](docs/Anleitung-Hosting.md) – Festtag, Firewall, FRITZ!Box, Probleme |

## Daten

Die echten Daten liegen in `server/data` (Buchungen und Zugänge) und werden bei jeder Buchung nach `backup` gespiegelt.
Beide Ordner sind **nicht** im Repository – sie bleiben auf dem Server-PC. Umzug auf einen anderen Rechner: in der
Verwaltung → Sicherung einen USB-Stick als Backup eintragen und den Stick-Ordner beim Einrichten auf dem neuen Rechner angeben.

## Für Entwickler

Node.js ab 18, keine npm-Pakete. Server: `server/server.js`, Oberfläche: `app/`, Tests:

```
node --test tests/server.test.js tests/gastro.test.js tests/qr.test.js
```
