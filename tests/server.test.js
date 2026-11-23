'use strict';
// Tests für Echtzeit-Sicherung, Wiederherstellung, Hash-Kette, Buchungsregeln und Zugänge.
// Start (im Programmordner): node --test tests/server.test.js tests/gastro.test.js tests/qr.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const net = require('net');
const path = require('path');
const { spawn } = require('child_process');
const { Journal, FILE } = require('../server/lib/journal');
const { createState, apply, salesReport } = require('../server/lib/state');
const { createCommands } = require('../server/lib/commands');
const { createAuth } = require('../server/lib/auth');

const WAITER = { role: 'bedienung', device: 'Handy 1' };
const KITCHEN = { role: 'kueche', device: 'Küche' };
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
  const pins = auth.init();
  const { journal, state } = boot(dirs);
  const cmd = createCommands({ journal, state, can: auth.can });
  cmd.seed('test');
  return { base, dirs, auth, pins, journal, state, cmd };
}
const pid = (state, name) => state.products.find(p => p.name === name).id;
const cid = n => String(n).padStart(32, 'a');
const order = (t, body, actor = WAITER) => t.cmd.createOrder(actor, body);
const fileOf = dir => path.join(dir, FILE);

test('Buchungen überstehen einen Neustart, Backup ist identisch', () => {
  const t = setup();
  order(t, { cid: cid(1), table: 4, items: [{ pid: pid(t.state, 'Portion Pommes frites'), qty: 2 }] });
  t.journal.closeAll();
  const again = boot(t.dirs);
  assert.equal(again.state.orders.length, 1);
  assert.equal(again.state.orders[0].items[0].qty, 2);
  assert.ok(again.journal.verify().every(v => v.ok));
  assert.deepEqual(fs.readFileSync(fileOf(t.dirs[0])), fs.readFileSync(fileOf(t.dirs[1])));
});

test('Halb geschriebene letzte Zeile (Stromausfall) wird verworfen, danach geht es normal weiter', () => {
  const t = setup();
  const count = t.journal.events.length;
  t.journal.closeAll();
  fs.appendFileSync(fileOf(t.dirs[0]), '{"seq":999,"type":"order.cre');
  const again = boot(t.dirs);
  assert.equal(again.journal.events.length, count);
  again.journal.append([{ type: 'system.started', data: {} }]);
  assert.ok(again.journal.verify().every(v => v.ok));
  assert.equal(fs.readdirSync(t.dirs[0]).filter(f => f.includes('vorher')).length, 0, 'harmloser Rest braucht keine Kopie');
});

test('Beschädigte Hauptdatei wird aus dem Backup wiederhergestellt, alte Fassung bleibt als Kopie', () => {
  const t = setup();
  order(t, { cid: cid(2), table: 1, items: [{ pid: pid(t.state, 'Bratwurst mit Pommes'), qty: 1 }] });
  const count = t.journal.events.length;
  t.journal.closeAll();
  const f = fileOf(t.dirs[0]);
  fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replace('"Helles 0,5 l"', '"Helles 0,5 x"'));
  const again = boot(t.dirs);
  assert.equal(again.journal.events.length, count);
  assert.equal(again.state.orders.length, 1);
  assert.ok(again.journal.verify().every(v => v.ok));
  assert.equal(fs.readdirSync(t.dirs[0]).filter(f => f.includes('vorher')).length, 1);
});

test('Verlorene Hauptdatei wird komplett aus dem Backup geholt', () => {
  const t = setup();
  order(t, { cid: cid(3), table: 2, items: [{ pid: pid(t.state, 'Schnaps aus Hochdorf 2 cl'), qty: 1 }] });
  const count = t.journal.events.length;
  t.journal.closeAll();
  fs.rmSync(fileOf(t.dirs[0]));
  const again = boot(t.dirs);
  assert.equal(again.journal.events.length, count);
  assert.equal(again.state.orders.length, 1);
});

test('Ausgefallenes Backup (z. B. USB-Stick gezogen) wird automatisch nachgezogen', () => {
  const t = setup();
  fs.closeSync(t.journal.targets[1].fd); // Ausfall simulieren
  order(t, { cid: cid(4), table: 3, items: [{ pid: pid(t.state, 'Portion Pommes frites'), qty: 1 }] });
  assert.equal(t.journal.targets[0].ok, true, 'Hauptspeicher läuft weiter');
  assert.equal(t.journal.targets[1].ok, false);
  t.journal.targets[1].lastTry = 0;
  t.journal.heal();
  assert.equal(t.journal.targets[1].ok, true);
  assert.ok(t.journal.verify().every(v => v.ok));
});

test('Nachträgliche Änderung eines Betrags im Protokoll wird erkannt', () => {
  const t = setup();
  t.cmd.kasseSale(KASSE, { cid: cid(5), items: [{ pid: pid(t.state, 'Sportweizen 0,5 l'), qty: 2 }] });
  const f = fileOf(t.dirs[0]);
  fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replace('"amount":700', '"amount":100'));
  const [primary, backup] = t.journal.verify();
  assert.equal(primary.ok, false);
  assert.match(primary.error, /verändert/);
  assert.equal(backup.ok, true);
});

test('Doppelt gesendeter Auftrag wird nur einmal gebucht', () => {
  const t = setup();
  const body = { cid: cid(6), table: 5, items: [{ pid: pid(t.state, 'Helles 0,5 l'), qty: 1 }] };
  const a = order(t, body), b = order(t, body);
  assert.equal(a.order.id, b.order.id);
  assert.equal(b.duplicate, true);
  assert.equal(t.state.orders.length, 1);
  const sale = { cid: cid(7), items: [{ pid: pid(t.state, 'Spezi 0,5 l'), qty: 1 }] };
  t.cmd.kasseSale(KASSE, sale);
  t.cmd.kasseSale(KASSE, sale);
  assert.equal(t.state.payments.filter(p => p.kind === 'kasse').length, 1);
});

test('Preise kommen vom Server, nicht vom Gerät', () => {
  const t = setup();
  const r = order(t, { cid: cid(8), table: 6, items: [{ pid: pid(t.state, 'Pumuckl (kleines Schnitzel mit Pommes)'), qty: 1, price: 1, name: 'Gratis' }] });
  assert.equal(r.order.items[0].price, 900);
  assert.equal(r.order.items[0].name, 'Pumuckl (kleines Schnitzel mit Pommes)');
});

test('Rechte: Küche nur Küche, Bedienung storniert nichts Begonnenes, Kasse bestellt nicht', () => {
  const t = setup();
  const { order: o } = order(t, { cid: cid(9), table: 7, items: [{ pid: pid(t.state, 'Portion Pommes frites'), qty: 1 }, { pid: pid(t.state, 'Spezi 0,5 l'), qty: 1 }] });
  assert.throws(() => t.cmd.setStatus(KITCHEN, o.id, { station: 'theke', status: 'fertig' }), e => e.status === 403);
  t.cmd.setStatus(KITCHEN, o.id, { station: 'kueche', status: 'arbeit' });
  assert.throws(() => t.cmd.cancelOrder(WAITER, o.id, {}), e => e.status === 403);
  assert.throws(() => order(t, { cid: cid(10), table: 1, items: [{ pid: pid(t.state, 'Portion Pommes frites'), qty: 1 }] }, KASSE), e => e.status === 403);
  t.cmd.cancelOrder(ADMIN, o.id, { reason: 'Gast gegangen' });
  assert.ok(t.state.orders[0].cancelled);
});

test('Verkaufsauswertung: Tisch, Abholung (sofort bezahlt), Kasse und Storno', () => {
  const t = setup();
  const p = name => pid(t.state, name);
  order(t, { cid: cid(11), table: 2, items: [{ pid: p('Sportweizen 0,5 l'), qty: 2 }] });          // 7,00
  order(t, { cid: cid(12), table: 2, items: [{ pid: p('Pils Krone 0,33 l'), qty: 1 }] });          // 3,50
  t.cmd.payTable(WAITER, 2, { expected: 1050 });
  const pick = order(t, { cid: cid(13), name: 'Müller', items: [{ pid: p('Portion Pommes frites'), qty: 1 }] }); // 3,00
  t.cmd.kasseSale(KASSE, { cid: cid(14), items: [{ pid: p('Schnaps aus Hochdorf 2 cl'), qty: 3 }] });           // 6,00
  t.cmd.cancelOrder(WAITER, pick.order.id, { reason: 'falsch eingegeben' });                 // −3,00
  const r = salesReport(t.state);
  assert.equal(r.revenue, 1050 + 300 + 600 - 300);
  assert.equal(r.payments, 3);
  assert.deepEqual([r.byKind.tisch.amount, r.byKind.abholung.amount, r.byKind.kasse.amount, r.byKind.storno.amount], [1050, 300, 600, -300]);
  assert.equal(r.products.find(x => x.name === 'Portion Pommes frites'), undefined, 'stornierte Pommes zählen netto 0');
  assert.equal(r.openTables.length, 0);
});

test('Tischabrechnung lehnt einen veralteten Betrag ab', () => {
  const t = setup();
  order(t, { cid: cid(15), table: 9, items: [{ pid: pid(t.state, 'Portion Pommes frites'), qty: 1 }] });
  assert.throws(() => t.cmd.payTable(WAITER, 9, { expected: 100 }), e => e.status === 409);
  t.cmd.payTable(WAITER, 9, { expected: 300 });
  assert.throws(() => t.cmd.payTable(WAITER, 9, { expected: 300 }), e => e.status === 409, 'zweimal kassieren geht nicht');
});

test('Neuer Festtag: Bestellungen leer, Nummer 1, Verkäufe bleiben pro Tag abrufbar', () => {
  const t = setup();
  t.cmd.kasseSale(KASSE, { cid: cid(16), items: [{ pid: pid(t.state, 'Spezi 0,5 l'), qty: 2 }] });
  t.cmd.startDay(ADMIN, { label: 'Sonntag' });
  assert.equal(t.state.orders.length, 0);
  assert.equal(t.state.nextNr, 1);
  assert.equal(salesReport(t.state).revenue, 0);
  assert.equal(salesReport(t.state, 1).revenue, 440);
});

test('Zugänge: Sperre nach 5 Fehlversuchen, Token ungültig nach PIN-Wechsel, Daten im Backup', () => {
  const t = setup();
  for (let i = 0; i < 5; i++) {
    assert.throws(() => t.auth.login('1.2.3.4', { role: 'kueche', pin: '0000' === t.pins.kueche ? '1111' : '0000' }), e => e.status === 401 && Boolean(e.audit));
  }
  assert.throws(() => t.auth.login('1.2.3.4', { role: 'kueche', pin: t.pins.kueche }), e => e.status === 429);
  const ok = t.auth.login('5.6.7.8', { role: 'kueche', pin: t.pins.kueche, device: 'Tablet' });
  assert.deepEqual(t.auth.verify(ok.token), { role: 'kueche', device: 'Tablet' });
  t.auth.changePin('kueche', '4321');
  assert.equal(t.auth.verify(ok.token), null);
  assert.throws(() => t.auth.changePin('admin', '1234'), e => e.status === 400, 'Verwaltung braucht 6 Stellen');
  const cfg = JSON.parse(fs.readFileSync(path.join(t.dirs[1], 'config.json'), 'utf8'));
  assert.ok(cfg.pins.kueche.hash && !JSON.stringify(cfg).includes('"4321"'), 'Backup enthält nur Hashes');
});

test('Zugänge: Bedienung und Kasse melden sich mit Namen an, der Hinweis zählt die Versuche richtig herunter', () => {
  const t = setup();
  assert.throws(() => t.auth.login('7.7.7.7', { role: 'bedienung', pin: t.pins.bedienung }), e => e.status === 400 && /Namen/.test(e.message) && !e.audit);
  assert.throws(() => t.auth.login('7.7.7.7', { role: 'kasse', pin: t.pins.kasse, device: ' x ' }), e => e.status === 400 && /Kasse/.test(e.message));
  assert.equal(t.auth.login('7.7.7.7', { role: 'bedienung', pin: t.pins.bedienung, device: 'Lisa' }).device, 'Lisa');
  assert.equal(t.auth.login('7.7.7.7', { role: 'kueche', pin: t.pins.kueche }).device, 'Gerät', 'Küche und Theke brauchen keinen Namen');
  const wrong = t.pins.theke === '0000' ? '1111' : '0000', texts = [];
  for (let i = 0; i < 5; i++) { try { t.auth.login('8.8.8.8', { role: 'theke', pin: wrong }); } catch (e) { texts.push(e.message); } }
  assert.match(texts[0], /noch 4 Versuche\)/);
  assert.match(texts[3], /noch 1 Versuch\)/);
  assert.match(texts[4], /gesperrt/);
});

// Startet den echten Server als eigenen Prozess – aus einer Kopie in einem Wegwerf-Ordner, damit weder die
// echten Daten noch der echte Backup-Ordner berührt werden.
async function startCopy() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'svh-srv-'));
  fs.cpSync(path.join(__dirname, '..', 'server', 'lib'), path.join(base, 'server', 'lib'), { recursive: true });
  fs.copyFileSync(path.join(__dirname, '..', 'server', 'server.js'), path.join(base, 'server', 'server.js'));
  const port = await new Promise(resolve => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); }); });
  const env = { ...process.env, PORT: String(port), DATA_DIR: '', BACKUP_DIR: '', SVH_STANDBY: 'erlaubt' };
  const spawnIt = () => spawn(process.execPath, [path.join(base, 'server', 'server.js')], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  const proc = spawnIt(), url = `http://127.0.0.1:${port}`;
  let out = '';
  proc.stdout.on('data', d => { out += d; });
  for (let i = 0, up = false; i < 100 && !(up && /Verwaltung\s+\d{6}/.test(out)); i++) {
    await new Promise(r => setTimeout(r, 100));
    up = await fetch(`${url}/api/me`).then(r => r.status === 401, () => false);
  }
  const pins = { admin: /Verwaltung\s+(\d{6})/.exec(out)?.[1], bedienung: /Bedienung\s+(\d{4})/.exec(out)?.[1] };
  assert.ok(pins.admin && pins.bedienung, 'Server läuft und hat die PINs angezeigt');
  const post = (p, body, token) => fetch(url + p, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) })
    .then(async r => ({ status: r.status, ...(await r.json()) }));
  return { base, url, pins, post, spawnIt, journal: path.join(base, 'server', 'data', 'journal.jsonl'),
    stop: async () => { proc.kill(); await new Promise(r => proc.on('exit', r)); } };
}

test('Zweiter Start desselben Servers wird abgewiesen, ohne das Protokoll anzufassen', async () => {
  const s = await startCopy();
  try {
    const before = fs.readFileSync(s.journal);
    const second = s.spawnIt();
    let err = '';
    second.stderr.on('data', d => { err += d; });
    const code = await new Promise(r => second.on('exit', r));
    assert.equal(code, 1);
    assert.match(err, /läuft bereits/);
    assert.deepEqual(fs.readFileSync(s.journal), before, 'kein einziger Eintrag vom zweiten Start');
    assert.equal(await fetch(`${s.url}/api/me`).then(r => r.status), 401, 'erster Server läuft ungestört weiter');
  } finally { await s.stop(); }
});

test('Server: USB-Stick als Backup eintragen und wieder entfernen – nur die Verwaltung, im laufenden Betrieb', async () => {
  const s = await startCopy();
  try {
    const admin = await s.post('/api/login', { role: 'admin', pin: s.pins.admin, device: 'Laptop' });
    const waiter = await s.post('/api/login', { role: 'bedienung', pin: s.pins.bedienung, device: 'Lisa' });
    const usb = path.join(s.base, 'stick', 'Kasse-Backup');
    assert.equal((await s.post('/api/admin/backup', { dir: usb }, waiter.token)).status, 403);
    assert.equal((await s.post('/api/admin/backup', { dir: 'Kasse-Backup' }, admin.token)).status, 400, 'nur vollständige Pfade');
    assert.equal((await s.post('/api/admin/backup', { dir: path.join(s.journal, 'unmöglich') }, admin.token)).status, 400, 'nicht beschreibbar');
    assert.equal((await s.post('/api/admin/backup', { dir: usb }, admin.token)).status, 200);
    assert.deepEqual(fs.readFileSync(path.join(usb, 'journal.jsonl')), fs.readFileSync(s.journal), 'Stick hat sofort das komplette Protokoll');
    assert.equal((await s.post('/api/admin/backup', { dir: usb }, admin.token)).status, 409, 'nicht doppelt');
    const sys = await fetch(`${s.url}/api/admin/system`, { headers: { Authorization: `Bearer ${admin.token}` } }).then(r => r.json());
    assert.deepEqual(sys.extraBackups, [usb]);
    assert.equal(sys.externalBackup, true);
    assert.deepEqual(sys.verify.map(v => v.ok), [true, true, true], 'Hauptspeicher, Backup und Stick stimmen überein');
    assert.equal((await s.post('/api/admin/backup', { dir: usb, remove: true }, admin.token)).status, 200);
    assert.equal((await s.post('/api/admin/backup', { dir: usb, remove: true }, admin.token)).status, 404);
    assert.ok(fs.existsSync(path.join(usb, 'journal.jsonl')), 'bereits Gesichertes bleibt auf dem Stick');
  } finally { await s.stop(); }
});

test('Zusätzliches Backup: wird komplett nachgezogen, mitgeschrieben und in den Zugangsdaten gemerkt', () => {
  const t = setup();
  order(t, { cid: cid(70), table: 1, items: [{ pid: pid(t.state, 'Spezi 0,5 l'), qty: 1 }] });
  const usb = path.join(t.base, 'usb', 'Kasse-Backup');
  const target = t.journal.addTarget(usb);
  assert.equal(target.ok, true);
  assert.deepEqual(fs.readFileSync(fileOf(usb)), fs.readFileSync(fileOf(t.dirs[0])), 'sofort vollständig kopiert');
  order(t, { cid: cid(71), table: 2, items: [{ pid: pid(t.state, 'Spezi 0,5 l'), qty: 1 }] });
  assert.deepEqual(fs.readFileSync(fileOf(usb)), fs.readFileSync(fileOf(t.dirs[0])), 'neue Buchungen werden mitgeschrieben');
  assert.deepEqual(t.journal.verify().map(v => v.ok), [true, true, true]);
  assert.equal(t.journal.addTarget(usb), target, 'derselbe Ordner wird nicht doppelt aufgenommen');
  t.auth.addBackupDir(usb);
  assert.ok(fs.existsSync(path.join(usb, 'config.json')), 'auch die Zugangsdaten liegen auf dem Stick');
  const again = createAuth({ dir: t.dirs[0], mirrorDirs: [t.dirs[1]] });
  again.init();
  assert.deepEqual(again.backupDirs(), [path.resolve(usb)], 'gilt nach einem Neustart weiter');
  // Liegt auf dem Stick schon ein anderes Protokoll, bleibt es als Kopie erhalten
  const other = path.join(t.base, 'usb2');
  fs.mkdirSync(other, { recursive: true });
  fs.writeFileSync(fileOf(other), '{"altes":"Protokoll"}\n');
  assert.equal(t.journal.addTarget(other).ok, true);
  assert.equal(fs.readdirSync(other).filter(f => f.includes('vorher')).length, 1);
  // Stick fehlt / Ordner nicht beschreibbar
  const bad = t.journal.addTarget(path.join(fileOf(t.dirs[0]), 'geht-nicht'));
  assert.equal(bad.ok, false);
  assert.equal(t.journal.removeTarget(bad.dir), true);
  assert.equal(t.journal.removeTarget(usb), true);
  assert.equal(t.auth.removeBackupDir(usb), true);
  assert.deepEqual(t.auth.backupDirs(), []);
  assert.equal(t.journal.removeTarget(t.dirs[0]), false, 'der Hauptspeicher lässt sich nicht entfernen');
  order(t, { cid: cid(72), table: 3, items: [{ pid: pid(t.state, 'Spezi 0,5 l'), qty: 1 }] });
  assert.ok(t.journal.verify().every(v => v.ok), 'danach läuft alles normal weiter');
});

test('Verlorene Zugangsdaten werden aus dem Backup wiederhergestellt', () => {
  const t = setup();
  const token = t.auth.login('9.9.9.9', { role: 'admin', pin: t.pins.admin }).token;
  fs.rmSync(path.join(t.dirs[0], 'config.json'));
  const auth2 = createAuth({ dir: t.dirs[0], mirrorDirs: [t.dirs[1]] });
  assert.deepEqual(auth2.init(), {}, 'keine neuen PINs nötig');
  assert.equal(auth2.verify(token).role, 'admin');
});

test('Preisliste: neues Fest startet mit den geplanten Preisen', () => {
  const t = setup();
  const price = name => t.state.products.find(p => p.name === name && p.active).price;
  assert.equal(price('Schützen-Schnitzel mit Pommes und Salat'), 1400);
  assert.equal(price('Pumuckl (kleines Schnitzel mit Pommes)'), 900);
  assert.equal(price('Bratwurst mit Kartoffelsalat'), 850);
  assert.equal(price('Gold Krone / Fassbier 0,5 l'), 370);
  assert.equal(price('Coca Cola 0,5 l'), 220);
  assert.equal(t.cmd.priceListPlan().items.every(i => i.change === 'gleich'), true, 'frisch angelegt = nichts zu tun');
});

test('Preisliste übernehmen: alte Produkte und altes Pfand aus, Preise angepasst, Verkäufe bleiben', () => {
  const t = setup();
  const p = name => t.state.products.find(x => x.name === name);
  t.cmd.kasseSale(KASSE, { cid: cid(20), items: [{ pid: p('Spezi 0,5 l').id, qty: 1 }] });
  t.cmd.saveProduct(ADMIN, { id: p('Spezi 0,5 l').id, name: 'spezi 0,5 l', price: 250, cat: 'getraenke', station: 'theke' });
  t.cmd.saveProduct(ADMIN, { name: 'Currywurst', price: 450, cat: 'essen', station: 'kueche' });
  t.cmd.saveProduct(ADMIN, { name: 'Pfand', price: 200, cat: 'pfand', station: '' });
  const spezi = p('spezi 0,5 l').id;
  const plan = t.cmd.priceListPlan();
  assert.equal(plan.items.find(i => i.name === 'Spezi 0,5 l').change, 'preis');
  assert.deepEqual(plan.deactivate.map(x => x.name), ['Currywurst', 'Pfand']);
  assert.throws(() => t.cmd.applyPriceList(WAITER), e => e.status === 403);
  const r = t.cmd.applyPriceList(ADMIN);
  assert.deepEqual([r.added, r.updated, r.deactivated], [0, 1, 2]);
  assert.equal(p('Spezi 0,5 l').id, spezi, 'gleiche ID – Auswertung bleibt zusammenhängend');
  assert.deepEqual([p('Spezi 0,5 l').price, p('Spezi 0,5 l').cat, p('Currywurst').active, p('Pfand').active], [220, 'alkfrei', false, false]);
  assert.equal(salesReport(t.state).revenue, 220, 'bereits gebuchte Verkäufe bleiben unverändert');
  assert.deepEqual(t.cmd.applyPriceList(ADMIN), { added: 0, updated: 0, unchanged: 22, deactivated: 0 });
  t.journal.closeAll();
  assert.equal(boot(t.dirs).state.products.find(x => x.name === 'Currywurst').active, false, 'übersteht Neustart');
});
