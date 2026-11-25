'use strict';
// Tests für die Schießauswertung (app/schiessen): Zeit lesen und anzeigen, Rangliste, CSV-Export.
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

const t = n => Array.from({ length: 5 }, (_, i) => i < n);
const daten = [
  { id: 'a', name: 'Anna', treffer: t(4), zeit: 50000, datum: 1 },
  { id: 'b', name: 'Bernd', treffer: t(5), zeit: 70000, datum: 2 },
  { id: 'c', name: 'Clara', treffer: t(4), zeit: 40000, datum: 3 },
  { id: 'd', name: 'anna ', treffer: t(5), zeit: 90000, datum: 4 },
  { id: 'e', name: 'Emil', treffer: t(4), zeit: null, datum: 5 },
  { id: 'f', name: 'Fritz', treffer: t(4), zeit: 50000, datum: 6 },
];

test('Rangliste: mehr Treffer vor schnellerer Zeit, Gleichstand teilt den Platz', () => {
  const r = S.rangliste(daten, false);
  assert.deepEqual(r.map(e => e.id), ['b', 'd', 'c', 'a', 'f', 'e']);
  assert.deepEqual(r.map(e => e.platz), [1, 2, 3, 4, 4, 6]);
});

test('Rangliste: nur bester Versuch je Schütze (Groß-/Kleinschreibung egal)', () => {
  const r = S.rangliste(daten, true);
  assert.deepEqual(r.map(e => e.id), ['b', 'd', 'c', 'f', 'e']);
});

test('CSV für Excel: Semikolon, BOM, Anführungszeichen', () => {
  const text = S.csv([{ id: 'x', name: 'Meier; "Sepp"', treffer: t(3), zeit: 61200, datum: 0 }]);
  assert.ok(text.startsWith('﻿Platz;Name;Treffer;von;Zeit (s);Zeit;Scheibe 1'));
  assert.match(text, /\r\n1;"Meier; ""Sepp""";3;5;61,2;1:01,2;Treffer;Treffer;Treffer;Fehler;Fehler;/);
});
