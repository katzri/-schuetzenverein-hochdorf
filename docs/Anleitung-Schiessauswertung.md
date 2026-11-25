# Schießauswertung aufs iPhone

Eine kleine App zum Eintragen von **Name, Zeit und Ergebnis** mit automatischer Rangliste – getrennt für
**Preisschießen** und **Pokalschießen**.
Sie läuft im Browser des iPhones und wird wie eine App auf den Home-Bildschirm gelegt – ohne App Store.

## Öffnen

Der Vereins-Server liefert sie mit aus: im FRITZ!Box-WLAN auf dem iPhone in **Safari**
`http://<IP-des-Server-PCs>:3000/schiessen` öffnen.

## Als App auf den Home-Bildschirm

1. In Safari unten auf **Teilen** (Quadrat mit Pfeil nach oben) tippen.
2. **„Zum Home-Bildschirm“** wählen, dann **„Hinzufügen“**.
3. Ab jetzt startet „Schießen“ mit dem Vereinswappen wie eine normale App – ohne Adressleiste.

## Bedienung

Oben **Preisschießen** oder **Pokalschießen** wählen (gelb = ausgewählt). Jede Art hat ihre eigene Rangliste.

| | Preisschießen | Pokalschießen |
|---|---|---|
| Schuss | 5 | 3 |
| Pro Schuss | Treffer oder kein Treffer | 1 bis 10 Ringe (vorbei = 0) |
| Ergebnis | Anzahl Treffer (höchstens 5) | Ringe zusammen (höchstens 30) |
| Bei Gleichstand | schnellere Zeit | bessere Einzelschüsse (mehr Zehner, dann Neuner …), danach schnellere Zeit |

- **Name** eintippen (bekannte Namen werden vorgeschlagen).
- **Zeit:** mit **Start / Stopp** messen oder von Hand eintragen (z. B. `45,3` oder `1:12,5`).
- **Preisschießen:** jeden Schuss antippen, der getroffen hat – oder unten die Anzahl 0–5 direkt wählen.
- **Pokalschießen:** die Ringzahl für Schuss 1 antippen, dann geht es automatisch zu Schuss 2 und 3.
  Zum Ändern einen Schuss antippen und neue Zahl wählen.
- **Ergebnis speichern** – das Formular ist danach leer für den nächsten Schützen.
- **Rangliste:** „Nur bester Versuch je Schütze“ blendet Wiederholungen aus. Ein Ergebnis antippen zum Löschen.
- **Teilen / Exportieren** erzeugt eine Tabelle der gerade gewählten Art (CSV, öffnet in Excel/Numbers),
  z. B. per Mail oder AirDrop.

## Wichtig

- Die Ergebnisse liegen **nur auf diesem Handy**. Jedes Gerät hat seine eigene Liste.
  Nach dem Wettbewerb über **Teilen / Exportieren** sichern.
- Safari löscht Daten von Webseiten, die man mehrere Wochen nicht öffnet. Darum: nach jedem Wettbewerb exportieren.
- Über `http://…:3000` braucht die App beim Öffnen das Vereins-WLAN. Die Stoppuhr läuft auch weiter,
  wenn das Display kurz ausgeht.
