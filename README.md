# Schießauswertung – Schützenverein Hochdorf

Web-App fürs Handy zum Eintragen von **Name, Zeit und Ergebnis** mit automatischer Rangliste.
Liegt auf **GitHub Pages**, unabhängig vom Bestellsystem (das steht im Zweig `main`).

**Adresse:** https://katzri.github.io/-schuetzenverein-hochdorf/

| | Preisschießen | Pokalschießen |
|---|---|---|
| Schuss | 5 | 3 |
| Pro Schuss | Treffer oder kein Treffer | 1 bis 10 Ringe (vorbei = 0) |
| Ergebnis | Anzahl Treffer (höchstens 5) | Ringe zusammen (höchstens 30) |
| Bei Gleichstand | schnellere Zeit | mehr Zehner, dann Neuner …, danach schnellere Zeit |

## Aufs iPhone

1. Die Adresse oben in **Safari** öffnen (einmal mit Internet).
2. Unten auf **Teilen** tippen (Quadrat mit Pfeil nach oben) → **„Zum Home-Bildschirm“** → **„Hinzufügen“**.
3. Ab jetzt „Schießen“ immer über das Symbol auf dem Home-Bildschirm starten. Dann läuft die App
   **auch ohne Internet**, z. B. am Schießstand.

Auf Android: Adresse in Chrome öffnen → Menü (⋮) → **„Zum Startbildschirm hinzufügen“**.

## Bedienung

- Oben **Preisschießen** oder **Pokalschießen** wählen (gelb = ausgewählt). Jede Art hat ihre eigene Rangliste.
- **Name** eintippen (bekannte Namen werden vorgeschlagen).
- **Zeit** mit **Start / Stopp** messen oder von Hand eintragen (`45,3` oder `1:12,5`).
- Preisschießen: jeden Schuss antippen, der getroffen hat, oder die Anzahl 0–5 direkt wählen.
- Pokalschießen: Ringzahl für Schuss 1 antippen, die App springt zu Schuss 2 und 3.
- **Ergebnis speichern.** Danach ist das Formular leer für den nächsten Schützen.
- **Rangliste:** Ein Ergebnis antippen, um es zu löschen. **Teilen / Exportieren** erzeugt eine Tabelle
  für Excel oder Numbers, die man per Mail, AirDrop oder WhatsApp verschicken kann. **Drucken** druckt die Rangliste.

## Wichtig zu den Daten

- Die Ergebnisse bleiben **nur auf dem Handy**, auf dem sie eingetragen wurden. Nichts geht ins Internet.
  Jedes Handy hat seine eigene Liste.
- Die App immer über das **Symbol auf dem Home-Bildschirm** öffnen. In Safari direkt geöffnet ist es eine
  getrennte Liste, und Safari löscht sie, wenn man die Seite länger nicht besucht.
- Nach jedem Wettbewerb **Teilen / Exportieren** zur Sicherung.

## Für Entwickler

Reines HTML/JS/CSS ohne fremde Pakete. Regeln und Rangliste: `logic.js` (Tests: `node --test tests/logic.test.js`),
Oberfläche: `index.html`, `schiessen.js`, `schiessen.css`. Offline-Speicher: `sw.js`. Nach jeder Änderung dort die
Versionsnummer (`CACHE`) erhöhen, sonst sehen die Handys die neue Fassung nicht.
Neue Fassungen erscheinen auf den Handys beim übernächsten Start der App.
