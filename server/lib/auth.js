'use strict';
// Zugänge: eine PIN pro Arbeitsgruppe, gespeichert nur als scrypt-Hash.
// Ein Gerät meldet sich einmal an und bekommt ein signiertes Token. Es bleibt 7 Tage gültig
// und wird ungültig, sobald die PIN der Gruppe geändert wird.
// Statt der PIN kann ein Gerät auch den QR-Code seiner Arbeitsgruppe scannen (nicht die Verwaltung):
// Der Code ist vom Server signiert und an die PIN gebunden – PIN ändern macht alte Ausdrucke wertlos.
// Die Zugangsdatei (config.json) wird bei jeder Änderung in alle Backup-Ordner gespiegelt
// und beim Start von dort wiederhergestellt, falls sie fehlt oder beschädigt ist.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { fail, cleanText, writeAtomic, HttpError } = require('./util');

const ROLES = { bedienung: 'Bedienung', kueche: 'Küche', theke: 'Theke', kasse: 'Kasse', admin: 'Verwaltung' };
const PERMS = {
  bedienung: ['order.create', 'order.pickup', 'order.cancel', 'table.pay', 'table.move', 'house'],
  kueche: ['status.kueche'], theke: ['status.theke'], kasse: ['kasse.sale', 'house'], admin: ['*'],
};
const QR_ROLES = ['bedienung', 'kueche', 'theke', 'kasse']; // die Verwaltung meldet sich bewusst nur mit PIN an
// Wer Geld einnimmt, meldet sich mit Namen an: Abrechnung und Abholhinweise hängen am Namen des Geräts.
// Ohne Namen hießen alle „Gerät“ und würden in der Abrechnung zu einem einzigen Geldbeutel verschmelzen.
const NAMED = { bedienung: 'Bitte deinen Namen eintragen', kasse: 'Bitte einen Namen für diese Kasse eintragen (z. B. Kasse 1)' };
const PIN_LEN = role => (role === 'admin' ? 6 : 4);
const TOKEN_MS = 7 * 24 * 3600e3;
const MAX_FAILS = 5, LOCK_MS = 5 * 60e3;
const CONFIG = 'config.json';

function createAuth({ dir, mirrorDirs = [], log = () => {} }) {
  const file = path.join(dir, CONFIG);
  let cfg = null;
  const fails = new Map(); // IP → Zeitpunkte der Fehlversuche

  const hashPin = (pin, salt) => crypto.scryptSync(pin, salt, 32).toString('hex');
  const mirrors = () => [...new Set([...mirrorDirs, ...cfg.backupDirs].map(d => path.resolve(dir, d)))];
  const read = f => JSON.parse(fs.readFileSync(f, 'utf8'));

  function save() {
    const data = JSON.stringify(cfg, null, 2);
    fs.mkdirSync(dir, { recursive: true });
    writeAtomic(file, data);
    for (const m of mirrors()) {
      try { fs.mkdirSync(m, { recursive: true }); writeAtomic(path.join(m, CONFIG), data); }
      catch (e) { log(`Zugangsdaten konnten nicht nach ${m} gesichert werden: ${e.message}`); }
    }
  }

  function setPin(role, pin) {
    const salt = crypto.randomBytes(16).toString('hex');
    cfg.pins[role] = { salt, hash: hashPin(pin, salt) };
  }

  // Lädt die Zugangsdaten (notfalls aus einem Backup) und vergibt fehlende PINs zufällig.
  // Gibt die neu vergebenen PINs zurück, damit sie einmalig angezeigt werden können.
  function init({ resetPins = false } = {}) {
    try { cfg = read(file); } catch (e) {
      cfg = null;
      for (const m of mirrorDirs) {
        try { cfg = read(path.join(path.resolve(dir, m), CONFIG)); log(`Zugangsdaten aus Backup ${m} wiederhergestellt`); break; } catch {}
      }
      if (!cfg && e.code !== 'ENOENT') throw new Error(`${file} ist beschädigt und kein Backup gefunden – bitte prüfen`);
    }
    cfg ||= { secret: crypto.randomBytes(32).toString('hex'), pins: {}, backupDirs: [] };
    cfg.pins ||= {};
    cfg.backupDirs ||= [];
    const fresh = {};
    for (const role of Object.keys(ROLES)) {
      if (resetPins || !cfg.pins[role]) {
        fresh[role] = String(crypto.randomInt(0, 10 ** PIN_LEN(role))).padStart(PIN_LEN(role), '0');
        setPin(role, fresh[role]);
      }
    }
    save();
    return fresh;
  }

  const mac = (payload, role) => crypto.createHmac('sha256', cfg.secret)
    .update(`${payload}|${cfg.pins[role].hash}`).digest('base64url');

  const same = (a, b) => {
    const x = Buffer.from(String(a)), y = Buffer.from(String(b));
    return x.length === y.length && crypto.timingSafeEqual(x, y);
  };

  // Gemeinsamer Ablauf für PIN und QR-Code: Sperre prüfen, Fehlversuche zählen, Sitzung ausstellen.
  // Wirft bei falscher Eingabe einen Fehler mit .audit ('access.failed' / 'access.locked') fürs Protokoll.
  function enter(ip, role, deviceName, ok, wrong, via) {
    const now = Date.now();
    const recent = (fails.get(ip) || []).filter(t => now - t < LOCK_MS);
    if (recent.length >= MAX_FAILS) {
      fail(429, `Zu viele Fehlversuche – bitte in ${Math.ceil((LOCK_MS - (now - recent[0])) / 60e3)} Min. erneut versuchen`);
    }
    const device = cleanText(deviceName, 30) || 'Gerät';
    if (NAMED[role] && cleanText(deviceName, 30).length < 2) fail(400, NAMED[role]);
    if (!ok()) {
      recent.push(now);
      fails.set(ip, recent);
      const locked = recent.length >= MAX_FAILS, left = MAX_FAILS - recent.length;
      const err = new HttpError(401, locked ? `${wrong} – Anmeldung für 5 Minuten gesperrt` : `${wrong} (noch ${left} ${left === 1 ? 'Versuch' : 'Versuche'})`);
      err.audit = { type: locked ? 'access.locked' : 'access.failed', by: { role, device }, data: { ip, ...(via ? { via } : {}) } };
      throw err;
    }
    fails.delete(ip);
    const payload = Buffer.from(JSON.stringify({ r: role, d: device, i: now })).toString('base64url');
    return { token: `${payload}.${mac(payload, role)}`, role, device };
  }

  function login(ip, body) {
    const role = body?.role;
    if (!ROLES[role]) fail(400, 'Unbekannte Arbeitsgruppe');
    const pin = body.pin, rec = cfg.pins[role];
    return enter(ip, role, body.device, () => typeof pin === 'string' && /^\d{4,8}$/.test(pin)
      && crypto.timingSafeEqual(Buffer.from(hashPin(pin, rec.salt), 'hex'), Buffer.from(rec.hash, 'hex')), 'Falsche PIN');
  }

  // Anmelde-Code im QR-Code einer Arbeitsgruppe, z. B. „bedienung.Ab3…“ (Signatur über Gruppe und PIN-Hash)
  const qrSig = role => crypto.createHmac('sha256', cfg.secret).update(`qr|${role}|${cfg.pins[role].hash}`).digest('base64url').slice(0, 22);
  function qrCode(role) {
    if (!QR_ROLES.includes(role)) fail(400, 'Für diese Arbeitsgruppe gibt es keinen QR-Code');
    return `${role}.${qrSig(role)}`;
  }
  function loginQr(ip, body) {
    const [role, sig] = typeof body?.code === 'string' ? body.code.split('.') : [];
    if (!QR_ROLES.includes(role)) fail(400, 'Dieser QR-Code passt nicht – bitte mit PIN anmelden');
    return enter(ip, role, body.device, () => same(sig, qrSig(role)), 'Dieser QR-Code gilt nicht mehr', 'qr');
  }

  // WLAN-Zugangsdaten für den QR-Code zum Verbinden. Anders als die PINs müssen sie lesbar gespeichert
  // sein, sonst ließe sich der Code nicht erzeugen – sie stehen ohnehin auf der Unterseite der FRITZ!Box.
  function setWifi(b) {
    const plain = v => typeof v === 'string' && !/[\u0000-\u001f\u007f]/.test(v);
    const ssid = b?.ssid, password = b?.password ?? '';
    if (!plain(ssid) || !plain(password)) fail(400, 'Ungültige Eingabe');
    if (!ssid && !password) { delete cfg.wifi; save(); return null; }
    if (!ssid.trim() || Buffer.byteLength(ssid) > 32) fail(400, 'Bitte den WLAN-Namen eintragen (höchstens 32 Zeichen)');
    if (password && (password.length < 8 || password.length > 64)) fail(400, 'Das WLAN-Passwort hat 8 bis 63 Zeichen – bei einem offenen WLAN leer lassen');
    cfg.wifi = { ssid, password };
    save();
    return cfg.wifi;
  }

  function verify(token) {
    if (typeof token !== 'string') return null;
    const [payload, sig] = token.split('.');
    if (!payload || !sig) return null;
    let p;
    try { p = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')); } catch { return null; }
    if (!ROLES[p?.r] || !cfg.pins[p.r]) return null;
    const expected = Buffer.from(mac(payload, p.r));
    const given = Buffer.from(sig);
    if (expected.length !== given.length || !crypto.timingSafeEqual(expected, given)) return null;
    if (!Number.isFinite(p.i) || Date.now() - p.i > TOKEN_MS) return null;
    return { role: p.r, device: String(p.d) };
  }

  const can = (actor, perm) => PERMS[actor.role]?.includes('*') || PERMS[actor.role]?.includes(perm);

  function changePin(role, pin) {
    if (!ROLES[role]) fail(400, 'Unbekannte Arbeitsgruppe');
    const min = PIN_LEN(role);
    if (typeof pin !== 'string' || !/^\d+$/.test(pin) || pin.length < min || pin.length > 8) fail(400, `Die PIN muss aus ${min} bis 8 Ziffern bestehen`);
    setPin(role, pin);
    save();
  }

  // Zusätzliche Backup-Ordner (z. B. auf einem USB-Stick) merken – sie gelten auch nach einem Neustart
  const backupDirs = () => cfg.backupDirs.map(d => path.resolve(dir, d));
  function addBackupDir(d) {
    const abs = path.resolve(dir, d);
    if (!backupDirs().includes(abs)) cfg.backupDirs.push(abs);
    save();
    return abs;
  }
  function removeBackupDir(d) {
    const abs = path.resolve(dir, d), before = cfg.backupDirs.length;
    cfg.backupDirs = cfg.backupDirs.filter(x => path.resolve(dir, x) !== abs);
    save();
    return cfg.backupDirs.length < before;
  }

  return { init, login, loginQr, qrCode, verify, can, changePin, wifi: () => cfg.wifi || null, setWifi,
    backupDirs, addBackupDir, removeBackupDir };
}

module.exports = { createAuth, ROLES, PERMS, QR_ROLES };
