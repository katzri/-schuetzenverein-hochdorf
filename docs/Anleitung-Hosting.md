# Bestellsystem selbst betreiben

Das Bestellsystem läuft komplett auf einem PC oder Laptop im Vereins-WLAN. Es braucht kein Internet,
keine Cloud und keine Hilfe von außen. Diese Anleitung beschreibt alles, was zum Betrieb nötig ist.
Wie das Programm auf einen neuen Rechner kommt, steht in der [README](../README.md).

## Kurzfassung für den Festtag

1. Server-PC ans Stromnetz, mit dem Vereins-WLAN (FRITZ!Box) verbinden.
2. Auf dem Desktop **„Schützenverein Server starten“** doppelklicken (oder `Server starten.bat` im Programmordner).
   Das schwarze Fenster **offen lassen**.
3. Handys und Tablets: den **QR-Code-Aushang** scannen (erst WLAN, dann App) – oder die Adresse aus dem Fenster,
   z. B. `http://192.168.178.20:3000`, im Browser öffnen.
4. Anmelden: Wer den QR-Code seiner Arbeitsgruppe scannt, trägt nur seinen Namen ein – ohne PIN. Sonst Arbeitsgruppe
   wählen und PIN eingeben. Bedienung und Kasse tragen immer einen Namen ein, daran hängt die Abrechnung.
5. Nach dem Fest: in der Verwaltung den Tagesabschluss drucken, dann das Fenster schließen.

## Was gebraucht wird

- Ein Windows-PC oder -Laptop, der während des Fests durchläuft (Linux geht auch, siehe README).
- **Node.js** ab Version 18 – `Einrichten.bat` installiert es bei Bedarf. Weitere Programme oder Pakete sind nicht nötig.
- Die FRITZ!Box als WLAN. Ein Internetanschluss muss nicht dranhängen.
- Der Programmordner, z. B. `C:\Schuetzenverein`:

| Ordner | Inhalt |
|---|---|
| `app` | Die Oberfläche für Handys und Tablets |
| `server` | Das Serverprogramm |
| `server/data` | **Die echten Daten**: `journal.jsonl` (alle Buchungen) und `config.json` (Zugänge, WLAN-Daten für den QR-Code) |
| `backup` | Automatische Kopie der Daten, wird bei jeder Buchung mitgeschrieben |
| `scripts` | Einrichten, Aktualisieren, Daten prüfen |

`server/data` und `backup` sind **nicht** im Git-Repository – sie bleiben auf dem Server-PC.

## Einmalig einrichten

### 1. Windows-Firewall

Beim allerersten Start fragt Windows, ob „Node.js“ im Netzwerk kommunizieren darf.
Dort **„Private Netzwerke“ anhaken und zulassen**. Ohne das erreichen die Handys den Server nicht.
Außerdem muss das WLAN in Windows als **„Privates Netzwerk“** eingestuft sein (Einstellungen → Netzwerk und Internet →
WLAN → Eigenschaften). `Einrichten.bat` prüft das und warnt, wenn es auf „Öffentlich“ steht.

Falls die Frage weggeklickt wurde: Eingabeaufforderung **als Administrator** öffnen und eingeben:

```
netsh advfirewall firewall add rule name="Bestellsystem" dir=in action=allow protocol=TCP localport=3000
```

### 2. Feste Adresse in der FRITZ!Box

Damit die Adresse bei jedem Fest gleich bleibt (und die gedruckten QR-Codes gültig bleiben):

1. Am Server-PC `http://fritz.box` öffnen und anmelden.
2. **Heimnetz → Netzwerk**, beim Server-PC auf den Stift klicken.
3. **„Diesem Netzwerkgerät immer die gleiche IPv4-Adresse zuweisen“** anhaken, speichern.

Zusätzlich prüfen:

- **WLAN → Sicherheit**: „Die unten angezeigten aktiven WLAN-Geräte dürfen untereinander kommunizieren“ muss angehakt sein.
- Handys müssen ins **normale WLAN**, nicht in den Gastzugang. Aus dem Gastnetz ist der Server nicht erreichbar.

### 3. Der Rechner darf nicht einschlafen

Solange das Server-Fenster offen ist, hält der Server den Rechner **von selbst wach** – die Verwaltung zeigt unter
**Sicherung** „Der Laptop bleibt wach“. Zuklappen oder der Ein/Aus-Knopf legen einen Laptop trotzdem schlafen. Darum:
Netzteil anschließen und Deckel offen lassen – oder in der Systemsteuerung unter Energieoptionen
„Beim Zuklappen: Nichts unternehmen“ wählen.

### 4. QR-Codes für Handys und Tablets

Verwaltung → **QR-Codes**: WLAN-Name und -Passwort der FRITZ!Box eintragen, Arbeitsgruppe wählen, **Aushang drucken**.
Der erste Code verbindet das Handy mit dem WLAN, der zweite öffnet die App und meldet die Arbeitsgruppe ohne PIN an.

- Den Aushang nur für Helfer aufhängen, nicht für Gäste.
- Wird die PIN einer Arbeitsgruppe geändert, ist ihr alter QR-Code ungültig – neu drucken.
- Die Codes enthalten die Adresse des Servers. Ändert sie sich, neu drucken (deshalb die feste Adresse, siehe oben).
- Tipp: die App einmal über das Browser-Menü **„Zum Startbildschirm hinzufügen“** – dann startet sie wie eine App.

### 5. Zweites Backup auf USB-Stick (empfohlen)

Der Ordner `backup` liegt auf derselben Festplatte wie die Daten. Geht der Rechner kaputt, ist beides weg. Darum:

1. USB-Stick einstecken. Den Laufwerksbuchstaben zeigt der Explorer unter „Dieser PC“ (z. B. `E:`).
2. Verwaltung → **Sicherung** → „Zusätzliches Backup“: einen Ordner auf dem Stick eintragen, z. B. `E:\Kasse-Backup`,
   und **„Als Backup verwenden“** klicken.

Das komplette Protokoll wird sofort hineinkopiert und ab dann jede Buchung mitgeschrieben – auch nach einem Neustart.
Wird der Stick im Betrieb abgezogen, läuft alles weiter; nach dem Einstecken wird er von selbst nachgezogen.

## Zugänge und PINs

- Beim **allerersten Start** vergibt der Server die PINs und zeigt sie **einmalig** im schwarzen Fenster an. Aufschreiben.
- Wer den **QR-Code** seiner Arbeitsgruppe scannt, braucht keine PIN. Die Verwaltung meldet sich immer mit PIN an.
- **Bedienung und Kasse** melden sich mit Namen an – daran hängen die Abholhinweise und die Abrechnung der Geldbeutel.
- PINs ändern: als Verwaltung anmelden → **Zugänge → PIN ändern**. Alle Geräte dieser Gruppe müssen sich danach neu
  anmelden, und ihr alter QR-Code gilt nicht mehr.
- Eine Anmeldung gilt 7 Tage. Nach 5 falschen Versuchen ist das Gerät 5 Minuten gesperrt.
- **Verwaltungs-PIN vergessen:** Server beenden, im Ordner `server` in die Adresszeile des Explorers `cmd` tippen
  und Enter drücken, dann eingeben:

  ```
  node server.js --neue-pins
  ```

  Alle PINs werden neu vergeben und angezeigt. Danach mit Strg+C beenden und wie gewohnt starten.

## Im Betrieb

- **Fenster versehentlich geschlossen oder Rechner abgestürzt:** einfach wieder starten. Es geht nichts verloren,
  jede Buchung liegt sofort auf der Festplatte. Bestellungen, die Handys in der Zwischenzeit aufgenommen haben,
  werden automatisch nachgesendet.
- **Nie zwei Server gleichzeitig** auf denselben Daten laufen lassen. Ein zweiter Start auf demselben Rechner wird
  abgewiesen, ohne die Daten anzufassen.
- Bricht das WLAN kurz ab, zeigt jedes Gerät oben „keine Verbindung“ und verbindet sich danach von selbst wieder.
- Preise, Produkte, Tischplan und Festtage werden in der Verwaltung gepflegt, nicht in Dateien.
- Den Stand der Sicherung zeigt die Verwaltung unter **Sicherung**.

## Aktualisieren

**`Aktualisieren.bat`** doppelklicken: holt die neueste Version aus dem Repository und startet den Server auf Wunsch neu.
Die Daten bleiben dabei unberührt. Am besten vor dem Fest aktualisieren, nicht mittendrin.

## Wenn etwas nicht geht

| Problem | Ursache und Lösung |
|---|---|
| Handy zeigt „Seite nicht erreichbar“ | Handy im falschen WLAN oder im Gastnetz; Firewall oder Netzwerk auf „Öffentlich“ (siehe oben); Adresse falsch abgetippt (`http://`, nicht `https://`, und `:3000` am Ende). |
| Ging gerade noch, jetzt nicht mehr | Handy ist auf mobile Daten gewechselt, weil das WLAN kein Internet hat. Beim Hinweis „WLAN ohne Internet“ **„Verbunden bleiben“** wählen, notfalls mobile Daten ausschalten. |
| Adresse hat sich geändert | Feste Adresse in der FRITZ!Box einrichten (siehe oben) und die QR-Codes neu drucken. Die aktuelle Adresse steht immer im schwarzen Fenster. |
| „Dieser QR-Code gilt nicht mehr“ | Die PIN der Arbeitsgruppe wurde geändert. Verwaltung → QR-Codes → neu drucken. |
| „Node.js fehlt oder ist zu alt“ | `Einrichten.bat` starten – es installiert Node.js. |
| „Der Server läuft bereits“ | Es ist schon ein Server-Fenster offen. Dieses weiterverwenden. |
| ✖ vor einem Backup-Ziel | Stick nicht eingesteckt oder anderer Laufwerksbuchstabe. Der Betrieb läuft trotzdem weiter. |
| Kein Ton beim Abhol-Signal | Ton kommt erst, nachdem auf dem Handy einmal getippt wurde, und nur bei eingeschaltetem Ton. iPhones vibrieren im Browser nicht. |

## Umzug auf einen anderen Rechner

1. Alter Rechner: Verwaltung → **Sicherung** → einen USB-Stick als Backup eintragen (siehe oben). Danach den Server beenden.
   Alternativ den Server beenden und den Ordner `server\data` auf einen Stick kopieren.
2. Neuer Rechner: einrichten wie in der [README](../README.md) beschrieben. Bei der Frage nach den bisherigen Daten
   den Ordner auf dem Stick angeben – Buchungen, Produkte, PINs und WLAN-Daten werden übernommen.
3. FRITZ!Box: dem neuen Rechner die feste Adresse geben. Ändert sich die Adresse, die QR-Codes neu drucken.
4. Den alten Rechner danach nicht mehr mit diesen Daten starten.

## Wiederherstellen nach einem Defekt

- **Daten im Ordner `server/data` beschädigt oder gelöscht:** einfach starten. Der Server holt sich Buchungen
  und Zugänge selbst aus dem Ordner `backup` oder vom USB-Stick zurück.
- **Rechner kaputt, nur der USB-Stick ist übrig:** auf einem neuen Rechner einrichten wie in der README und bei der
  Frage nach den bisherigen Daten den Ordner auf dem Stick angeben.

## Was man nicht tun sollte

- `journal.jsonl` nicht von Hand bearbeiten. Die Einträge sind miteinander verkettet; der Server erkennt Änderungen.
- `server/data` und `backup` nie ins Git-Repository hochladen oder weitergeben. `config.json` enthält die Zugänge und
  das WLAN-Passwort.
- Den Server nicht direkt aus dem Internet erreichbar machen (keine Portfreigabe in der FRITZ!Box).
  Das System ist für das eigene WLAN gedacht und überträgt unverschlüsselt.
