'use strict';
// Tests für die Gastro-Funktionen: getrennt zahlen, Storno einzelner Positionen, Umsetzen,
// Ausverkauft/Bestand, Tischplan, Kassenabschluss und Lesbarkeit alter Protokolle.
// Start (im Programmordner): node --test tests/server.test.js tests/gastro.test.js tests/qr.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Journal } = require('../server/lib/journal');
const { createState, apply, salesReport } = require('../server/lib/state');
const { createCommands } = require('../server/lib/commands');
const { createAuth } = require('../server/lib/auth');

const WAITER = { role: 'bedienung', device: 'Handy 1' };
const KITCHEN = { role: 'kueche', device: 'Küche' };
const THEKE = { role: 'theke', device: 'Theke' };
const KASSE = { role: 'kasse', device: 'Kasse 1' };
const ADMIN = { role: 'admin', device: 'Laptop' };

function boot(dirs) {
  const journal = new Journal({ dir: dirs[0], backupDirs: dirs.slice(1) });
  const state = createState();
  journal.open().forEach(e => apply(state, e));
  return { journal, state };
}
function setup() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'svh-'));
  const dirs = [path.join(base, 'data'), path.join(base, 'backup')];
  const auth = createAuth({ dir: dirs[0], mirrorDirs: [dirs[1]] });
  auth.init();
  const { journal, state } = boot(dirs);
  const cmd = createCommands({ journal, state, can: auth.can });
  cmd.seed('test');
  return { dirs, journal, state, cmd };
}
const pid = (state, name) => state.products.find(p => p.name === name).id;
const cid = n => String(n).padStart(32, 'b');
const order = (t, body, actor = WAITER) => t.cmd.createOrder(actor, body);

test('Getrennt zahlen: Teilbeträge einzeln kassieren, Rest bleibt offen, nichts doppelt', () => {
  const t = setup();
  const p = name => pid(t.state, name);
  const { order: o } = order(t, { cid: cid(30), table: 3, items: [{ pid: p('Helles 0,5 l'), qty: 3 }, { pid: p('Portion Pommes frites'), qty: 1 }] }); // 11,10 + 3,00
  const part = { cid: cid(31), expected: 740, lines: [{ orderId: o.id, idx: 0, qty: 2 }] };
  const first = t.cmd.payTable(WAITER, 3, part);
  assert.equal(first.payment.amount, 740);
  assert.equal(first.left, 670);
  assert.equal(t.state.orders[0].paid, false);
  assert.equal(t.cmd.payTable(WAITER, 3, part).duplicate, true, 'doppelt gesendet = einmal gebucht');
  assert.throws(() => t.cmd.payTable(WAITER, 3, { lines: [{ orderId: o.id, idx: 0, qty: 2 }] }), e => e.status === 409, 'mehr als offen geht nicht');
  const rest = t.cmd.payTable(WAITER, 3, { expected: 670 });
  assert.equal(rest.left, 0);
  assert.equal(t.state.orders[0].paid, true);
  const r = salesReport(t.state);
  assert.equal(r.revenue, 1410);
  assert.equal(r.products.find(x => x.name === 'Helles 0,5 l').qty, 3);
  assert.deepEqual(r.staff.map(w => [w.device, w.count, w.amount]), [['Handy 1', 2, 1410]]);
  t.journal.closeAll();
  assert.equal(boot(t.dirs).state.orders[0].paid, true, 'Teilzahlungen überstehen den Neustart');
});

test('Storno einzelner Position: nur Unbezahltes, erscheint im Storno-Protokoll, Rückzahlung bei Teilzahlung', () => {
  const t = setup();
  const p = name => pid(t.state, name);
  const { order: o } = order(t, { cid: cid(32), table: 4, items: [{ pid: p('Helles 0,5 l'), qty: 2 }, { pid: p('Portion Pommes frites'), qty: 1 }] });
  t.cmd.cancelItem(WAITER, o.id, { idx: 0, qty: 1, reason: 'vertippt' });
  assert.equal(t.state.orders[0].items[0].qty, 1);
  t.cmd.payTable(WAITER, 4, { lines: [{ orderId: o.id, idx: 0, qty: 1 }] });
  assert.throws(() => t.cmd.cancelItem(WAITER, o.id, { idx: 0, qty: 1 }), e => e.status === 409, 'Bezahltes nicht als Position stornierbar');
  t.cmd.cancelItem(WAITER, o.id, { idx: 1, qty: 1, reason: 'Gast will doch nicht' });
  assert.equal(t.state.orders[0].parts.kueche.status, 'abgeholt', 'Küche hat nichts mehr zu tun');
  assert.equal(t.state.orders[0].paid, true);
  const r = salesReport(t.state);
  assert.equal(r.revenue, 370);
  assert.deepEqual(r.voids.map(v => [v.item, v.qty, v.reason]), [['Portion Pommes frites', 1, 'Gast will doch nicht'], ['Helles 0,5 l', 1, 'vertippt']]);
  // Ganze Bestellung mit Teilzahlung stornieren: nur das Bezahlte wird zurückgebucht
  const { order: o2 } = order(t, { cid: cid(33), table: 5, items: [{ pid: p('Spezi 0,5 l'), qty: 2 }] });
  t.cmd.payTable(WAITER, 5, { lines: [{ orderId: o2.id, idx: 0, qty: 1 }] });
  assert.equal(t.cmd.cancelOrder(WAITER, o2.id, { reason: 'Fehler' }).refund, 220);
  assert.equal(salesReport(t.state).revenue, 370);
});

test('Storno der letzten Position storniert die ganze Bestellung', () => {
  const t = setup();
  const { order: o } = order(t, { cid: cid(50), table: 8, items: [{ pid: pid(t.state, 'Spezi 0,5 l'), qty: 1 }] });
  t.cmd.cancelItem(WAITER, o.id, { idx: 0, qty: 1, reason: 'doppelt' });
  assert.ok(t.state.orders[0].cancelled);
  assert.equal(salesReport(t.state).voidAmount, 220);
});

test('Hinweis pro Position bleibt getrennt und kommt in der Küche an', () => {
  const t = setup();
  const b = pid(t.state, 'Bratwurst mit Pommes');
  const { order: o } = order(t, { cid: cid(34), table: 1, items: [{ pid: b, qty: 2 }, { pid: b, qty: 1, note: 'ohne  Senf <b>' }] });
  assert.deepEqual(o.items.map(i => [i.qty, i.note || '']), [[2, ''], [1, 'ohne Senf b']]);
});

test('Tisch umsetzen: offene Bestellungen wandern mit, Ziel muss im Tischplan stehen', () => {
  const t = setup();
  order(t, { cid: cid(35), table: 6, items: [{ pid: pid(t.state, 'Spezi 0,5 l'), qty: 1 }] });
  assert.throws(() => t.cmd.moveTable(WAITER, 6, { to: 77 }), e => e.status === 400);
  assert.throws(() => t.cmd.moveTable(KITCHEN, 6, { to: 7 }), e => e.status === 403);
  t.cmd.moveTable(WAITER, 6, { to: 7 });
  assert.equal(t.state.orders[0].table, 7);
  assert.equal(t.cmd.payTable(WAITER, 7, {}).payment.amount, 220);
});

test('Ausverkauft und Bestand: Küche sperrt eigene Produkte, Stückzahl zählt herunter und kommt bei Storno zurück', () => {
  const t = setup();
  const schnitzel = pid(t.state, 'Schützen-Schnitzel mit Pommes und Salat'), helles = pid(t.state, 'Helles 0,5 l');
  assert.throws(() => t.cmd.setAvailability(KITCHEN, helles, { soldOut: true }), e => e.status === 403, 'Küche sperrt kein Bier');
  t.cmd.setAvailability(THEKE, helles, { soldOut: true });
  assert.throws(() => order(t, { cid: cid(36), table: 1, items: [{ pid: helles, qty: 1 }] }), e => e.status === 409 && /ausverkauft/.test(e.message));
  assert.throws(() => t.cmd.kasseSale(KASSE, { cid: cid(51), items: [{ pid: helles, qty: 1 }] }), e => e.status === 409);
  t.cmd.setAvailability(KITCHEN, schnitzel, { stock: 3 });
  assert.throws(() => order(t, { cid: cid(37), table: 1, items: [{ pid: schnitzel, qty: 4 }] }), e => e.status === 409 && /nur noch 3/.test(e.message));
  const { order: o } = order(t, { cid: cid(38), table: 1, items: [{ pid: schnitzel, qty: 3 }] });
  const prod = () => t.state.products.find(x => x.id === schnitzel);
  assert.deepEqual([prod().stock, prod().soldOut], [0, true]);
  t.cmd.cancelItem(WAITER, o.id, { idx: 0, qty: 1 });
  assert.deepEqual([prod().stock, prod().soldOut], [1, false]);
  t.cmd.saveProduct(ADMIN, { id: schnitzel, name: prod().name, price: 1450, cat: 'essen', station: 'kueche' });
  assert.equal(prod().stock, 1, 'Preisänderung löscht den Bestand nicht');
  t.cmd.kasseSale(KASSE, { cid: cid(52), items: [{ pid: schnitzel, qty: 1 }] });
  assert.deepEqual([prod().stock, prod().soldOut], [0, true], 'auch Kassenverkäufe zählen herunter');
});

test('Tischplan: Bereiche und Sitzplätze speichern, doppelte Nummern und belegte Tische geschützt', () => {
  const t = setup();
  const std = t.state.layout.areas[0].tables;
  assert.equal(std.length, 10, 'Platzbelegungsplan des Schützenhauses bis zur ersten Änderung');
  assert.equal(std.reduce((n, x) => n + x.seats, 0), 64);
  assert.deepEqual(std.filter(x => x.name).map(x => [x.nr, x.name, x.seats]), [[8, 'Stammtisch', 11], [9, 'Dachs', 8], [10, 'Einzelplätze', 2]]);
  order(t, { cid: cid(39), table: 2, items: [{ pid: pid(t.state, 'Spezi 0,5 l'), qty: 1 }] });
  const plan = { areas: [{ name: 'Gastraum', tables: [{ nr: 1, seats: 6 }, { nr: 2, seats: 10 }] }, { name: 'Nebenzimmer', tables: [{ nr: 20, seats: 12, name: ' Jäger<b>stube ' }] }] };
  assert.throws(() => t.cmd.saveLayout(WAITER, plan), e => e.status === 403);
  assert.throws(() => t.cmd.saveLayout(ADMIN, { areas: [{ name: 'A', tables: [{ nr: 1, seats: 4 }, { nr: 1, seats: 4 }] }] }), e => e.status === 409);
  assert.throws(() => t.cmd.saveLayout(ADMIN, { areas: [{ name: 'A', tables: [{ nr: 1, seats: 4 }] }] }), e => e.status === 409 && /Tisch 2/.test(e.message));
  t.cmd.saveLayout(ADMIN, plan);
  assert.throws(() => order(t, { cid: cid(40), table: 9, items: [{ pid: pid(t.state, 'Spezi 0,5 l'), qty: 1 }] }), e => e.status === 400);
  order(t, { cid: cid(41), table: 20, items: [{ pid: pid(t.state, 'Spezi 0,5 l'), qty: 1 }] });
  t.journal.closeAll();
  assert.deepEqual(boot(t.dirs).state.layout.areas.map(a => [a.name, a.tables.length]), [['Gastraum', 2], ['Nebenzimmer', 1]]);
  assert.equal(t.state.layout.areas[1].tables[0].name, 'Jäger b stube', 'Tischname wird bereinigt');
  assert.ok(!('name' in t.state.layout.areas[0].tables[0]), 'ohne Namen bleibt es „Tisch <Nr.>“');
});

test('Kassenabschluss: Wechselgeld und gezähltes Bargeld stehen in der Auswertung', () => {
  const t = setup();
  t.cmd.kasseSale(KASSE, { cid: cid(42), items: [{ pid: pid(t.state, 'Spezi 0,5 l'), qty: 2 }] });
  assert.throws(() => t.cmd.cashCount(KASSE, { float: 10000, counted: 10440 }), e => e.status === 403);
  t.cmd.cashCount(ADMIN, { float: 10000, counted: 10400, note: '40 ct fehlen' });
  const r = salesReport(t.state);
  assert.deepEqual([r.cash.float, r.cash.counted, r.revenue], [10000, 10400, 440]);
});

test('Altes Protokoll (Zahlung ohne Einzelpositionen) wird weiter richtig gelesen', () => {
  const s = createState();
  const by = { role: 'bedienung', device: 'alt' };
  apply(s, { ts: 1, type: 'day.started', by, data: { label: 'Alt' } });
  apply(s, { ts: 2, type: 'order.created', by, data: { id: 'o1', nr: 1, cid: null, table: 2, name: '', note: '', items: [{ pid: 'x', name: 'Bier', price: 300, qty: 2, station: 'theke' }], parts: { theke: { status: 'neu', t: null } } } });
  apply(s, { ts: 3, type: 'payment.recorded', by, data: { id: 'z1', kind: 'tisch', table: 2, orderIds: ['o1'], amount: 600, items: [{ name: 'Bier', price: 300, qty: 2 }] } });
  assert.equal(s.orders[0].paid, true);
  assert.equal(salesReport(s).openTables.length, 0);
});

test('Pro Platz: Bestellung merkt sich den Platz, Platz wird einzeln kassiert, Umsetzen löscht die Plätze', () => {
  const t = setup();
  const helles = pid(t.state, 'Helles 0,5 l'), pommes = pid(t.state, 'Portion Pommes frites');
  // Stammtisch = Nr. 8 = Platz 44–54
  assert.throws(() => order(t, { cid: cid(50), table: 8, items: [{ pid: helles, qty: 1, seat: 43 }] }), e => e.status === 400 && /44–54/.test(e.message));
  assert.throws(() => order(t, { cid: cid(51), name: 'Huber', items: [{ pid: helles, qty: 1, seat: 44 }] }), e => e.status === 400);
  const { order: o } = order(t, { cid: cid(52), table: 8, items: [
    { pid: helles, qty: 1, seat: 44 }, { pid: helles, qty: 1, seat: 44 }, { pid: helles, qty: 1, seat: 46 }, { pid: pommes, qty: 1 }] });
  assert.deepEqual(o.items.map(i => [i.name, i.qty, i.seat ?? null]), [['Helles 0,5 l', 2, 44], ['Helles 0,5 l', 1, 46], ['Portion Pommes frites', 1, null]]);
  const r = t.cmd.payTable(WAITER, 8, { cid: cid(53), expected: 740, lines: [{ orderId: o.id, idx: 0, qty: 2 }] }); // Platz 44 zahlt
  assert.equal(r.left, 670);
  assert.equal(o.items[0].paid, 2);
  t.cmd.moveTable(WAITER, 8, { to: 9 });
  assert.ok(o.items.every(i => !('seat' in i)), 'Platznummern gelten nur am alten Tisch');
  t.journal.closeAll();
  const again = boot(t.dirs).state.orders[0];
  assert.equal(again.table, 9);
  assert.equal(again.items[0].paid, 2);
});

test('Aufs Haus: Freiverzehr braucht eine Angabe, ist kein Umsatz und wird bei Storno nicht zurückgezahlt', () => {
  const t = setup();
  const helles = pid(t.state, 'Helles 0,5 l');
  const { order: o } = order(t, { cid: cid(60), table: 2, items: [{ pid: helles, qty: 3 }] }); // 11,10
  const free = { cid: cid(61), expected: 370, lines: [{ orderId: o.id, idx: 0, qty: 1 }], house: true };
  assert.throws(() => t.cmd.payTable(WAITER, 2, free), e => e.status === 400, 'ohne „für wen“ geht es nicht');
  assert.throws(() => t.cmd.payTable(KITCHEN, 2, { ...free, reason: 'Helfer' }), e => e.status === 403);
  const h = t.cmd.payTable(WAITER, 2, { ...free, reason: 'Helfer' });
  assert.deepEqual([h.payment.kind, h.payment.amount, h.payment.value, h.left], ['haus', 0, 370, 740]);
  t.cmd.payTable(WAITER, 2, { cid: cid(62), expected: 370, lines: [{ orderId: o.id, idx: 0, qty: 1 }] }); // ein Bier bar
  t.cmd.kasseSale(KASSE, { cid: cid(63), items: [{ pid: helles, qty: 2 }], house: true, reason: 'Musik' });
  let r = salesReport(t.state);
  assert.equal(r.revenue, 370);
  assert.equal(r.payments, 1);
  assert.deepEqual([r.house.count, r.house.amount, r.house.products[0].qty], [2, 1110, 3]);
  assert.equal(r.products.find(x => x.name === 'Helles 0,5 l').qty, 1, 'Freiverzehr zählt nicht zu den Verkäufen');
  assert.deepEqual(r.staff.map(w => [w.device, w.count, w.amount, w.house]).sort(), [['Handy 1', 1, 370, 370], ['Kasse 1', 0, 0, 740]]);
  // Storno der ganzen Bestellung: nur das bar bezahlte Bier wird zurückgezahlt
  assert.equal(t.cmd.cancelOrder(ADMIN, o.id, { reason: 'Test' }).refund, 370);
  t.journal.closeAll();
  r = salesReport(boot(t.dirs).state);
  assert.equal(r.revenue, 0);
  assert.equal(r.house.amount, 1110, 'Freiverzehr übersteht den Neustart');
});
