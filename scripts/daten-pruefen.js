'use strict';
// Prüft einen Daten-Ordner (journal.jsonl + config.json), z. B. bevor er vom alten Rechner übernommen wird.
// Aufruf im Programmordner:  node scripts/daten-pruefen.js [Ordner]   (ohne Angabe: server/data)
// Exit-Code 0 = alles in Ordnung, 1 = Protokoll beschädigt, 2 = keine Daten gefunden.
const fs = require('fs');
const path = require('path');
const { parse } = require('../server/lib/journal');

const dir = path.resolve(process.argv[2] || path.join(__dirname, '..', 'server', 'data'));
const file = path.join(dir, 'journal.jsonl');
if (!fs.existsSync(file)) {
  console.log(`Keine journal.jsonl in ${dir}`);
  process.exit(2);
}
const r = parse(fs.readFileSync(file));
const last = r.events[r.events.length - 1];
let cfg = null;
try { cfg = JSON.parse(fs.readFileSync(path.join(dir, 'config.json'), 'utf8')); } catch {}

console.log(`${r.events.length} Einträge${last ? `, letzter vom ${new Date(last.ts).toLocaleString('de-DE')}` : ''}.`);
console.log(r.error ? `Achtung: ${r.error} – der Server übernimmt beim Start nur den gültigen Teil.` : 'Prüfsummen-Kette lückenlos und unverändert.');
console.log(cfg?.pins ? 'Zugänge vorhanden – die bisherigen PINs gelten weiter.' : 'Keine Zugänge (config.json) – beim ersten Start werden neue PINs vergeben.');
process.exit(r.error ? 1 : 0);
