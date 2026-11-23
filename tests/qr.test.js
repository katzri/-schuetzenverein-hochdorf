'use strict';
// Tests für die QR-Codes: der eigene Erzeuger (ohne fremde Pakete), der Inhalt des WLAN-Codes,
// die Anmeldung per QR-Code ohne PIN und die gespeicherten WLAN-Daten.
// Start (im Programmordner): node --test tests/server.test.js tests/gastro.test.js tests/qr.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { qrMatrix, wifiText, rsDivisor, rsRemainder } = require('../server/lib/qr');
const { createAuth, QR_ROLES } = require('../server/lib/auth');

const CAP = [0, 14, 26, 42, 62, 84, 106, 122, 152, 180, 213]; // Zeichen je Version bei Fehlerkorrektur M
const filler = n => Array.from({ length: n }, (_, i) => String.fromCharCode(33 + (i * 7) % 90)).join('');
function setup() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'svh-qr-'));
  const dirs = [path.join(base, 'data'), path.join(base, 'backup')];
  const auth = createAuth({ dir: dirs[0], mirrorDirs: [dirs[1]] });
  return { dirs, auth, pins: auth.init() };
}

test('Fehlerkorrektur rechnet richtig (bekanntes Beispiel „HELLO WORLD“, Version 1-M)', () => {
  const data = [32, 91, 11, 120, 209, 114, 220, 77, 67, 64, 236, 17, 236, 17, 236, 17];
  assert.deepEqual(rsRemainder(data, rsDivisor(10)), [196, 35, 39, 119, 235, 215, 231, 226, 93, 23]);
});

test('QR-Code: Größe wächst mit dem Text, zu langer Text wird abgelehnt', () => {
  for (let v = 1; v <= 10; v++) {
    const q = qrMatrix(filler(CAP[v]));
    assert.equal(q.version, v);
    assert.equal(q.size, 17 + 4 * v);
    assert.equal(q.rows.length, q.size);
    assert.ok(q.rows.every(r => r.length === q.size && /^[01]+$/.test(r)));
    if (v < 10) assert.equal(qrMatrix(filler(CAP[v] + 1)).version, v + 1, 'ein Zeichen mehr braucht die nächste Größe');
  }
  assert.throws(() => qrMatrix(filler(214)), RangeError);
  assert.equal(qrMatrix('Grüße').version, 1, 'Umlaute zählen als UTF-8-Bytes');
});

test('QR-Code: Suchmuster, Taktlinien und Formatangabe stehen an der richtigen Stelle', () => {
  for (const text of ['http://192.168.178.54:3000', filler(100), filler(200)]) {
    const { size, rows, mask } = qrMatrix(text);
    const at = (x, y) => rows[y][x] === '1';
    for (const [cx, cy] of [[3, 3], [size - 4, 3], [3, size - 4]]) {
      for (let dy = -3; dy <= 3; dy++) {
        for (let dx = -3; dx <= 3; dx++) assert.equal(at(cx + dx, cy + dy), Math.max(Math.abs(dx), Math.abs(dy)) !== 2, 'Suchmuster');
      }
    }
    for (let i = 8; i < size - 8; i++) { assert.equal(at(i, 6), i % 2 === 0, 'Taktlinie'); assert.equal(at(6, i), i % 2 === 0, 'Taktlinie'); }
    assert.equal(at(8, size - 8), true, 'festes dunkles Feld');
    // Formatangabe zurücklesen: 15 Bits, fehlergeschützt, enthält Stufe M (00) und die verwendete Maske
    let bits = 0;
    for (let i = 0; i <= 5; i++) bits |= at(8, i) << i;
    bits |= at(8, 7) << 6 | at(8, 8) << 7 | at(7, 8) << 8;
    for (let i = 9; i < 15; i++) bits |= at(14 - i, 8) << i;
    const raw = bits ^ 0x5412;
    let rem = raw >>> 10;
    for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    assert.equal(rem, raw & 0x3ff, 'Prüfbits der Formatangabe');
    assert.equal(raw >>> 13, 0, 'Fehlerkorrektur-Stufe M');
    assert.equal((raw >>> 10) & 7, mask);
  }
});

test('QR-Code: Ergebnis bleibt Feld für Feld gleich (mit unabhängiger Umsetzung abgeglichene Prüfsummen)', () => {
  // Diese Prüfsummen stammen von Codes, die Feld für Feld mit einer zweiten, unabhängigen QR-Umsetzung
  // übereinstimmten (alle Größen 1–10). Ändert sich hier etwas, ist der Erzeuger nicht mehr derselbe.
  const golden = ['15d8547e7182777d', '96b5e23cc9c2048a', 'd5240fc82e48d052', 'c78cfdfad3fd3fd2', 'b7324654e448aae9',
    '800b5efa61f0ed8b', '52a37e02091e6531', '97f57fde43c3d282', '2e6af2d9adb48122', '86db4a6fd8bddf92'];
  const hash = t => crypto.createHash('sha256').update(qrMatrix(t).rows.join('\n')).digest('hex').slice(0, 16);
  assert.deepEqual(CAP.slice(1).map(n => hash(filler(n))), golden);
});

test('WLAN-Code: Format für die Handy-Kamera, Sonderzeichen werden geschützt', () => {
  assert.equal(wifiText({ ssid: 'FRITZ!Box 7530 AB', password: '12345678901234567890' }), 'WIFI:T:WPA;S:FRITZ!Box 7530 AB;P:12345678901234567890;;');
  assert.equal(wifiText({ ssid: 'Haus; "Gäste"', password: 'a:b\\c,d' }), 'WIFI:T:WPA;S:Haus\\; \\"Gäste\\";P:a\\:b\\\\c\\,d;;');
  assert.equal(wifiText({ ssid: 'Offen', password: '' }), 'WIFI:T:nopass;S:Offen;;');
  assert.ok(qrMatrix(wifiText({ ssid: 'ä'.repeat(16), password: ';'.repeat(64) })).version <= 10, 'auch der längste erlaubte Inhalt passt');
});

test('Anmeldung per QR-Code: ohne PIN, aber nur mit gültigem Code der Arbeitsgruppe', () => {
  const t = setup();
  assert.deepEqual(QR_ROLES, ['bedienung', 'kueche', 'theke', 'kasse']);
  const code = t.auth.qrCode('bedienung');
  assert.match(code, /^bedienung\.[\w-]{22}$/);
  const s = t.auth.loginQr('1.1.1.1', { code, device: 'Lisa' });
  assert.deepEqual(t.auth.verify(s.token), { role: 'bedienung', device: 'Lisa' });
  assert.equal(t.auth.can(s, 'order.create'), true);
  assert.equal(t.auth.can(s, '*'), false);
  // Bedienung braucht einen Namen (Abholhinweise und Abrechnung hängen daran), Küche nicht
  assert.throws(() => t.auth.loginQr('1.1.1.1', { code, device: ' ' }), e => e.status === 400 && /Namen/.test(e.message));
  assert.equal(t.auth.loginQr('1.1.1.1', { code: t.auth.qrCode('kueche') }).device, 'Gerät');
  // Code einer anderen Gruppe, veränderter Code, Verwaltung
  const wrong = [code.replace('bedienung', 'kasse'), `${code.slice(0, -1)}${code.endsWith('A') ? 'B' : 'A'}`, 'bedienung.', 'bedienung'];
  for (const c of wrong) assert.throws(() => t.auth.loginQr('2.2.2.2', { code: c, device: 'Max' }), e => e.status === 401 && e.audit.type === 'access.failed' && e.audit.data.via === 'qr');
  assert.throws(() => t.auth.qrCode('admin'), e => e.status === 400, 'für die Verwaltung gibt es keinen Code');
  assert.throws(() => t.auth.loginQr('3.3.3.3', { code: 'admin.abc', device: 'x' }), e => e.status === 400 && !e.audit);
  assert.throws(() => t.auth.loginQr('3.3.3.3', {}), e => e.status === 400);
});

test('Anmeldung per QR-Code: Sperre nach 5 Fehlversuchen, PIN-Wechsel entwertet alte Ausdrucke', () => {
  const t = setup();
  const code = t.auth.qrCode('theke');
  for (let i = 0; i < 5; i++) assert.throws(() => t.auth.loginQr('4.4.4.4', { code: 'theke.falsch' }), e => e.status === 401);
  assert.throws(() => t.auth.loginQr('4.4.4.4', { code }), e => e.status === 429, 'gesperrt – auch mit richtigem Code');
  assert.throws(() => t.auth.login('4.4.4.4', { role: 'theke', pin: t.pins.theke }), e => e.status === 429, 'die Sperre gilt auch für die PIN');
  const s = t.auth.loginQr('5.5.5.5', { code, device: 'Theke 1' });
  t.auth.changePin('theke', '4711');
  assert.equal(t.auth.verify(s.token), null, 'angemeldete Geräte fliegen raus');
  assert.throws(() => t.auth.loginQr('6.6.6.6', { code }), e => e.status === 401, 'alter Code gilt nicht mehr');
  assert.notEqual(t.auth.qrCode('theke'), code);
  assert.equal(t.auth.loginQr('6.6.6.6', { code: t.auth.qrCode('theke') }).role, 'theke');
});

test('WLAN-Daten: geprüft gespeichert, im Backup gesichert, überstehen einen Neustart', () => {
  const t = setup();
  assert.equal(t.auth.wifi(), null);
  assert.throws(() => t.auth.setWifi({ ssid: '', password: '12345678' }), e => e.status === 400);
  assert.throws(() => t.auth.setWifi({ ssid: 'Box', password: 'kurz' }), e => e.status === 400);
  assert.throws(() => t.auth.setWifi({ ssid: 'x'.repeat(33), password: '12345678' }), e => e.status === 400);
  assert.throws(() => t.auth.setWifi({ ssid: 'Box\n', password: '12345678' }), e => e.status === 400);
  assert.throws(() => t.auth.setWifi({ ssid: 42 }), e => e.status === 400);
  const wifi = { ssid: 'FRITZ!Box 7530 AB', password: 'geheim <1234> ' };
  assert.deepEqual(t.auth.setWifi(wifi), wifi, 'Passwort bleibt Zeichen für Zeichen erhalten');
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(t.dirs[1], 'config.json'), 'utf8')).wifi, wifi);
  const again = createAuth({ dir: t.dirs[0], mirrorDirs: [t.dirs[1]] });
  assert.deepEqual(again.init(), {}, 'keine neuen PINs');
  assert.deepEqual(again.wifi(), wifi);
  assert.equal(again.setWifi({ ssid: '', password: '' }), null, 'beides leer = löschen');
  assert.equal(again.wifi(), null);
});
