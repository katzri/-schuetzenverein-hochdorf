'use strict';
// Tests für die Schießauswertung (app/schiessen): Zeit lesen und anzeigen, Wertung Preis-/Pokalschießen,
// Rangliste und CSV-Export.
// Start (im Programmordner): node --test tests/schiessen.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../app/schiessen/logic.js');

test('Zeit von Hand lesen', () => {
  assert.equal(S.zeitLesen('45,3'), 45300);
  assert.equal(S.zeitLesen('45.3'), 45300);
  assert.equal(S.zeitLesen('1:12,5'), 72500);
  assert.equal(S.zeitLesen(' 83 s '), 83000);
  assert.equal(S.zeitLesen(''), null);
  assert.ok(Number.isNaN(S.zeitLesen('abc')));
  assert.ok(Number.isNaN(S.zeitLesen('1:75')));
});

test('Zeit anzeigen', () => {
  assert.equal(S.zeitText(9400), '9,4 s');
  assert.equal(S.zeitText(72500), '1:12,5');
  assert.equal(S.zeitText(600000), '10:00,0');
  assert.equal(S.zeitText(null), '–');
});

test('Arten: Preisschießen 5 Schuss, Pokalschießen 3 Schuss mit 1–10 Ringen', () => {
  assert.equal(S.ARTEN.preis.schuesse, 5);
  assert.equal(S.ARTEN.pokal.schuesse, 3);
  assert.equal(S.ARTEN.pokal.ringeMax, 10);
  assert.equal(S.ARTEN.pokal.max, 30);
  assert.equal(S.wert({ art: 'preis', treffer: [true, false, true, true, false] }), 3);
  assert.equal(S.wert({ art: 'pokal', ringe: [10, 7, 9] }), 26);
  assert.equal(S.artVon({ treffer: [] }), 'preis', 'alte Einträge ohne Art zählen zum Preisschießen');
});

const t = n => Array.from({ length: 5 }, (_, i) => i < n);
const daten = [
  { id: 'a', name: 'Anna', treffer: t(4), zeit: 50000, datum: 1 }, // alter Eintrag ohne Art
  { id: 'b', art: 'preis', name: 'Bernd', treffer: t(5), zeit: 70000, datum: 2 },
  { id: 'c', art: 'preis', name: 'Clara', treffer: t(4), zeit: 40000, datum: 3 },
  { id: 'd', art: 'preis', name: 'anna ', treffer: t(5), zeit: 90000, datum: 4 },
  { id: 'e', art: 'preis', name: 'Emil', treffer: t(4), zeit: null, datum: 5 },
  { id: 'f', art: 'preis', name: 'Fritz', treffer: t(4), zeit: 50000, datum: 6 },
  { id: 'p1', art: 'pokal', name: 'Anna', ringe: [9, 9, 9], zeit: 30000, datum: 7 },
  { id: 'p2', art: 'pokal', name: 'Bernd', ringe: [10, 10, 7], zeit: 60000, datum: 8 },
  { id: 'p3', art: 'pokal', name: 'Clara', ringe: [10, 8, 9], zeit: 20000, datum: 9 },
  { id: 'p4', art: 'pokal', name: 'Dora', ringe: [8, 10, 9], zeit: 20000, datum: 10 },
  { id: 'p5', art: 'pokal', name: 'Emil', ringe: [10, 10, 10], zeit: 99000, datum: 11 },
];

test('Preisschießen: mehr Treffer vor schnellerer Zeit, Gleichstand teilt den Platz', () => {
  const r = S.rangliste(daten, 'preis', false);
  assert.deepEqual(r.map(e => e.id), ['b', 'd', 'c', 'a', 'f', 'e']);
  assert.deepEqual(r.map(e => e.platz), [1, 2, 3, 4, 4, 6]);
});

test('Pokalschießen: mehr Ringe, bei Gleichstand bessere Einzelschüsse, dann Zeit', () => {
  const r = S.rangliste(daten, 'pokal', false);
  // 30 Emil; 27: Bernd (10,10,7) vor Clara/Dora (10,9,8) vor Anna (9,9,9); Clara = Dora (gleiche Ringe, gleiche Zeit)
  assert.deepEqual(r.map(e => e.id), ['p5', 'p2', 'p3', 'p4', 'p1']);
  assert.deepEqual(r.map(e => e.wert), [30, 27, 27, 27, 27]);
  assert.deepEqual(r.map(e => e.platz), [1, 2, 3, 3, 5]);
});

test('Nur bester Versuch je Schütze (Groß-/Kleinschreibung egal), Arten getrennt', () => {
  assert.deepEqual(S.rangliste(daten, 'preis', true).map(e => e.id), ['b', 'd', 'c', 'f', 'e']);
  assert.equal(S.rangliste(daten, 'pokal', true).length, 5);
});

test('CSV für Excel: Semikolon, BOM, Anführungszeichen', () => {
  const preis = S.csv([{ id: 'x', art: 'preis', name: 'Meier; "Sepp"', treffer: t(3), zeit: 61200, datum: 0 }], 'preis');
  assert.ok(preis.startsWith('﻿Preisschießen\r\nPlatz;Name;Treffer;von;Zeit (s);Zeit;Schuss 1;'));
  assert.match(preis, /\r\n1;"Meier; ""Sepp""";3;5;61,2;1:01,2;Treffer;Treffer;Treffer;kein Treffer;kein Treffer;/);
  const pokal = S.csv(daten, 'pokal');
  assert.match(pokal, /Platz;Name;Ringe;von;Zeit \(s\);Zeit;Schuss 1;Schuss 2;Schuss 3;Datum/);
  assert.match(pokal, /\r\n1;Emil;30;30;99,0;1:39,0;10;10;10;/);
  assert.ok(!pokal.includes('Fritz'));
});
