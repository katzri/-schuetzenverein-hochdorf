'use strict';
// Server für das Bestellsystem des Schützenvereins Hochdorf – läuft ohne Internet im Vereins-WLAN.
//
// Start:  node server.js              (Node.js 18 oder neuer, keine weiteren Pakete nötig)
//         node server.js --neue-pins  (vergibt alle PINs neu, z. B. wenn die Verwaltungs-PIN vergessen wurde)
//
// Daten:  server/data/journal.jsonl   – lückenloses Protokoll aller Buchungen und Anmeldungen
//         server/data/config.json     – Zugangsdaten (PINs nur als Hash), WLAN-Daten für den QR-Code
//                                       und zusätzliche Backup-Ordner
// Backup: alles wird in Echtzeit nach ../backup gespiegelt; weitere Ziele (z. B. USB-Stick)
//         in config.json unter "backupDirs" eintragen oder per Umgebungsvariable BACKUP_DIR.
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');
const { Journal } = require('./lib/journal');
const { createState, apply, publicState, salesReport } = require('./lib/state');
const { createCommands } = require('./lib/commands');
const { createAuth, ROLES, QR_ROLES } = require('./lib/auth');
const { qrMatrix, wifiText } = require('./lib/qr');
const { HttpError, fail } = require('./lib/util');

const VERSION = '3.4.0';
const PORT = Number(process.env.PORT) || 3000;
const ROOT = path.join(__dirname, '..', 'app');
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(__dirname, 'data'));
const FIXED_BACKUPS = [path.join(__dirname, '..', 'backup'), ...(process.env.BACKUP_DIR || '').split(';').filter(Boolean)];
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
};
const SECURITY_HEADERS = {
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
};
// Adressen, unter denen Handys/Tablets im Vereins-WLAN den Server erreichen
const addresses = () => Object.values(os.networkInterfaces()).flat()
  .filter(a => a && a.family === 'IPv4' && !a.internal).map(a => `http://${a.address}:${PORT}`);
const warn = m => console.warn(`⚠ ${new Date().toLocaleTimeString('de-DE')} ${m}`);

// ---------- Start: Zugänge laden, Journal wiederherstellen und abspielen ----------
// Wird erst aufgerufen, NACHDEM der Server seinen Port belegt hat (siehe ganz unten). Läuft der Server
// schon in einem anderen Fenster, scheitert das Belegen – bevor irgendeine Datei angefasst wird.
// Zwei Server dürfen nie gleichzeitig ins selbe Protokoll schreiben.
let auth, journal, state, cmd, newPins = {}, started = false;
function boot() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  auth = createAuth({ dir: DATA_DIR, mirrorDirs: FIXED_BACKUPS, log: warn });
  newPins = auth.init({ resetPins: process.argv.includes('--neue-pins') });
  const backupDirs = [...new Set([...FIXED_BACKUPS.map(d => path.resolve(d)), ...auth.backupDirs()])];
  journal = new Journal({ dir: DATA_DIR, backupDirs, log: warn });
  state = createState();
  journal.open().forEach(e => apply(state, e));
  cmd = createCommands({ journal, state, can: auth.can });
  cmd.seed(VERSION);
}

// ---------- Windows: Standby verhindern, solange der Server läuft ----------
// Schläft der Laptop mitten im Fest ein, steht alles still. Es wird KEINE Einstellung geändert: Ein kleiner
// Hilfsprozess meldet beim System an „bitte wach bleiben“ und endet von selbst, sobald der Server endet.
// Zuklappen oder der Ein/Aus-Knopf legen den Laptop weiterhin schlafen. Abschalten: Umgebungsvariable SVH_STANDBY=erlaubt
let awake = null; // null = hier nicht möglich (kein Windows), false = nicht gelungen, true = aktiv
function keepAwake() {
  if (process.platform !== 'win32' || process.env.SVH_STANDBY === 'erlaubt') return;
  awake = false;
  const script = '$t = Add-Type -PassThru -Name Power -Namespace Svh -MemberDefinition \'[DllImport("kernel32.dll")] public static extern uint SetThreadExecutionState(uint flags);\'; '
    + '[void]$t::SetThreadExecutionState(2147483649); if ($t::SetThreadExecutionState(2147483649) -band 1) { \'wach\' }; '
    + `try { Wait-Process -Id ${process.pid} -ErrorAction Stop } catch {}`;
  try {
    const helper = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true });
    helper.on('error', () => {});
    helper.stdout.on('data', d => {
      if (awake || !String(d).includes('wach')) return;
      awake = true;
      console.log('  Der Laptop bleibt wach, solange dieses Fenster offen ist (Deckel offen lassen, Netzteil anschließen).\n');
    });
    helper.unref();
  } catch {}
}

// ---------- Live-Updates an alle Geräte (Server-Sent Events) ----------
const clients = new Set();
const snapshot = () => JSON.stringify({ ...publicState(state), serverNow: Date.now() });
function broadcast() {
  const msg = `data: ${snapshot()}\n\n`;
  clients.forEach(res => res.write(msg));
}

// ---------- API ----------
const ipOf = req => req.socket.remoteAddress;
// Anmeldung per PIN oder QR-Code – jeder Versuch, auch ein falscher, steht im Anmeldeprotokoll
function signIn(req, attempt, how = {}) {
  try {
    const r = attempt();
    cmd.audit(r, 'access.login', { ip: ipOf(req), ...how });
    return r;
  } catch (e) {
    if (e.audit) { try { cmd.audit(e.audit.by, e.audit.type, e.audit.data); } catch (err) { warn(err.message); } }
    throw e;
  }
}
// Alles für „Handy einrichten“: QR-Code fürs WLAN, Link zur App und Anmelde-Codes der Arbeitsgruppen.
// Die Codes enthalten die Adresse des Servers – sie gelten für das WLAN, in dem der Laptop gerade ist.
function connectInfo(wanted) {
  const list = addresses();
  const base = list.includes(wanted) ? wanted : list[0] || null;
  const wifi = auth.wifi();
  return {
    addresses: list, base,
    wifi: wifi && { ...wifi, qr: qrMatrix(wifiText(wifi)) },
    link: base && { url: base, qr: qrMatrix(base) },
    logins: base ? QR_ROLES.map(role => { const url = `${base}/#qr=${auth.qrCode(role)}`; return { role, url, qr: qrMatrix(url) }; }) : [],
  };
}
// Zusätzlichen Backup-Ordner (z. B. USB-Stick) im laufenden Betrieb aufnehmen oder wieder entfernen.
// Aufnehmen heißt: Ordner anlegen, das komplette Protokoll hineinschreiben, ab dann jede Buchung mitschreiben.
function changeBackup(actor, b) {
  const raw = typeof b.dir === 'string' ? b.dir.trim() : '';
  if (!raw || raw.length > 240 || /[\u0000-\u001f"<>|?*]/.test(raw) || !path.isAbsolute(raw)) {
    fail(400, 'Bitte den vollständigen Ordner angeben, z. B. E:\\Kasse-Backup');
  }
  const dir = path.resolve(raw);
  if (b.remove) {
    if (!auth.removeBackupDir(dir)) fail(404, 'Dieser Ordner ist nicht als zusätzliches Backup eingetragen');
    journal.removeTarget(dir);
  } else {
    if (journal.targets.some(t => t.dir === dir)) fail(409, 'Dieser Ordner wird bereits verwendet');
    const t = journal.addTarget(dir);
    if (!t.ok) {
      journal.removeTarget(dir);
      fail(400, `In diesen Ordner kann nicht geschrieben werden – steckt der USB-Stick? (${t.error})`);
    }
    auth.addBackupDir(dir);
  }
  cmd.audit(actor, 'backup.changed', { dir, action: b.remove ? 'entfernt' : 'aufgenommen' });
  return { ok: true };
}
// [Methode, Pfad, wer darf (null = ohne Anmeldung, 'any' = angemeldet, 'admin'), Funktion, ändert Live-Daten]
const routes = [
  ['POST', /^\/api\/login$/, null, ({ body, req }) => signIn(req, () => auth.login(ipOf(req), body))],
  ['POST', /^\/api\/login\/qr$/, null, ({ body, req }) => signIn(req, () => auth.loginQr(ipOf(req), body), { via: 'qr' })],
  ['POST', /^\/api\/logout$/, 'any', ({ actor, req }) => { cmd.audit(actor, 'access.logout', { ip: ipOf(req) }); return { ok: true }; }],
  ['GET', /^\/api\/me$/, 'any', ({ actor }) => actor],
  ['GET', /^\/api\/state$/, 'any', () => snapshot()],
  ['POST', /^\/api\/orders$/, 'any', ({ actor, body }) => cmd.createOrder(actor, body), true],
  ['POST', /^\/api\/orders\/(\w+)\/status$/, 'any', ({ actor, body, m }) => cmd.setStatus(actor, m[1], body), true],
  ['POST', /^\/api\/orders\/(\w+)\/cancel$/, 'any', ({ actor, body, m }) => cmd.cancelOrder(actor, m[1], body), true],
  ['POST', /^\/api\/orders\/(\w+)\/items\/cancel$/, 'any', ({ actor, body, m }) => cmd.cancelItem(actor, m[1], body), true],
  ['POST', /^\/api\/tables\/(\d{1,3})\/move$/, 'any', ({ actor, body, m }) => cmd.moveTable(actor, Number(m[1]), body), true],
  ['POST', /^\/api\/products\/(\w+)\/availability$/, 'any', ({ actor, body, m }) => cmd.setAvailability(actor, m[1], body), true],
  ['POST', /^\/api\/tables\/(\d{1,3})\/pay$/, 'any', ({ actor, body, m }) => cmd.payTable(actor, Number(m[1]), body), true],
  ['POST', /^\/api\/kasse\/sale$/, 'any', ({ actor, body }) => cmd.kasseSale(actor, body), true],
  ['GET', /^\/api\/admin\/sales$/, 'admin', ({ url }) => salesReport(state, Number(url.searchParams.get('day')))],
  ['GET', /^\/api\/admin\/access$/, 'admin', () => state.access.slice(-500).reverse()],
  ['GET', /^\/api\/admin\/system$/, 'admin', () => ({
    version: VERSION, addresses: addresses(), journal: journal.status(), verify: journal.verify(), starts: state.starts.slice(-5).reverse(),
    externalBackup: auth.backupDirs().length > 0 || FIXED_BACKUPS.length > 1, extraBackups: auth.backupDirs(), awake,
  })],
  ['POST', /^\/api\/admin\/backup$/, 'admin', ({ actor, body }) => changeBackup(actor, body)],
  ['POST', /^\/api\/admin\/products$/, 'admin', ({ actor, body }) => cmd.saveProduct(actor, body), true],
  ['GET', /^\/api\/admin\/pricelist$/, 'admin', () => cmd.priceListPlan()],
  ['POST', /^\/api\/admin\/pricelist$/, 'admin', ({ actor }) => cmd.applyPriceList(actor), true],
  ['POST', /^\/api\/admin\/pin$/, 'admin', ({ actor, body }) => {
    auth.changePin(body.role, body.pin);
    cmd.audit(actor, 'access.changed', { role: body.role });
    return { ok: true };
  }],
  ['GET', /^\/api\/admin\/connect$/, 'admin', ({ url }) => connectInfo(url.searchParams.get('base'))],
  ['POST', /^\/api\/admin\/wifi$/, 'admin', ({ body }) => ({ wifi: auth.setWifi(body) })],
  ['POST', /^\/api\/admin\/layout$/, 'admin', ({ actor, body }) => cmd.saveLayout(actor, body), true],
  ['POST', /^\/api\/admin\/cash$/, 'admin', ({ actor, body }) => cmd.cashCount(actor, body)],
  ['POST', /^\/api\/admin\/day$/, 'admin', ({ actor, body }) => cmd.startDay(actor, body), true],
];

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.setEncoding('utf8');
    req.on('data', c => { raw += c; if (raw.length > 64 * 1024) { reject(new HttpError(413, 'Anfrage zu groß')); req.destroy(); } });
    req.on('end', () => {
      try {
        const v = raw ? JSON.parse(raw) : {};
        if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error();
        resolve(v);
      } catch { reject(new HttpError(400, 'Ungültige Anfrage')); }
    });
    req.on('error', reject);
  });
}

async function handleApi(req, url) {
  const route = routes.find(([m, re]) => m === req.method && re.test(url.pathname));
  if (!route) fail(404, 'Unbekannte Anfrage');
  const [, re, who, fn, mutates] = route;
  const bearer = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const actor = who ? auth.verify(bearer) : null;
  if (who && !actor) fail(401, 'Bitte neu anmelden');
  if (who === 'admin' && !auth.can(actor, '*')) fail(403, 'Nur für die Verwaltung');
  const body = req.method === 'POST' ? await readBody(req) : {};
  const result = fn({ actor, body, req, url, m: url.pathname.match(re) });
  if (mutates) broadcast();
  return result;
}

function send(res, code, payload) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(typeof payload === 'string' ? payload : JSON.stringify(payload));
}

function events(req, res, url) {
  if (!auth.verify(url.searchParams.get('t'))) return send(res, 401, { error: 'Bitte neu anmelden' });
  res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
  res.write(`retry: 3000\n\ndata: ${snapshot()}\n\n`);
  clients.add(res);
  // Lebenszeichen alle 10 s: Bleibt es aus (WLAN abgerissen), baut das Gerät die Verbindung von sich aus neu auf
  const ping = setInterval(() => res.write('event: ping\ndata: 1\n\n'), 10000);
  req.on('close', () => { clearInterval(ping); clients.delete(res); });
}

function serveFile(pathname, res) {
  let rel;
  try { rel = decodeURIComponent(pathname === '/' ? '/index.html' : pathname); } catch { res.writeHead(400); return res.end(); }
  const file = path.normalize(path.join(ROOT, rel));
  if (!file.startsWith(ROOT + path.sep)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('Nicht gefunden'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) res.setHeader(k, v);
  const url = new URL(req.url, 'http://localhost');
  if (!url.pathname.startsWith('/api/')) return serveFile(url.pathname, res);
  if (req.method === 'GET' && url.pathname === '/api/events') return events(req, res, url);
  try {
    send(res, 200, await handleApi(req, url));
  } catch (err) {
    if (err instanceof HttpError) return send(res, err.status, { error: err.message });
    if (err.code === 'JOURNAL') {
      warn(err.message);
      return send(res, 503, { error: 'Speichern auf dem Server fehlgeschlagen – der Auftrag bleibt auf dem Gerät und wird erneut gesendet' });
    }
    console.error(err);
    send(res, 500, { error: 'Interner Fehler' });
  }
});

// Ausgefallene Backup-Ziele (z. B. abgezogener USB-Stick) regelmäßig wieder nachziehen
setInterval(() => journal?.heal(), 10000).unref();
const stop = () => { journal?.closeAll(); process.exit(0); };
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
// Sicherheitsnetz für den Festbetrieb: Ein unerwarteter Fehler außerhalb einer Anfrage beendet den Server nicht.
// Alles Gebuchte liegt ohnehin schon sicher auf der Platte; der Fehler wird angezeigt, der Betrieb geht weiter.
process.on('uncaughtException', err => {
  if (!started) { console.error(`\n  Start nicht möglich: ${err.message}\n`); process.exit(1); }
  console.error(`⚠ ${new Date().toLocaleTimeString('de-DE')} Unerwarteter Fehler – der Server läuft weiter:`, err);
});
server.on('error', e => {
  if (started) { warn(`Netzwerkfehler: ${e.message}`); return; }
  console.error(e.code === 'EADDRINUSE'
    ? `\n  Der Server läuft bereits (Port ${PORT} ist belegt). Ein zweiter Start ist nicht nötig – die Daten wurden nicht angefasst.\n`
    : `\n  Start nicht möglich: ${e.message}\n`);
  process.exit(1);
});

server.listen(PORT, '0.0.0.0', () => {
  boot();
  started = true;
  keepAwake();
  const urls = addresses();
  console.log(`\n  Bestellsystem Schützenverein Hochdorf ${VERSION}\n`);
  console.log('  Auf Handys/Tablets im Vereins-WLAN (FRITZ!Box – Internet wird nicht gebraucht) öffnen:');
  (urls.length ? urls : [`http://localhost:${PORT}   (Laptop noch nicht mit dem WLAN verbunden?)`]).forEach(u => console.log(`    ${u}`));
  console.log('  QR-Codes fürs WLAN und zum Anmelden ohne PIN: Verwaltung → „QR-Codes“.');
  if (Object.keys(newPins).length) {
    console.log('\n  NEUE PINs – bitte notieren, sie werden nur jetzt angezeigt:');
    for (const [role, pin] of Object.entries(newPins)) console.log(`    ${ROLES[role].padEnd(11)} ${pin}`);
  }
  console.log('\n  Echtzeit-Sicherung:');
  journal.status().targets.forEach(t => console.log(`    ${t.ok ? '✔' : '✖'} ${t.primary ? 'Haupt ' : 'Backup'}  ${t.dir}${t.error ? `  – ${t.error}` : ''}`));
  if (!auth.backupDirs().length) console.log('    Tipp: USB-Stick als zusätzliches Backup in data/config.json unter "backupDirs" eintragen.');
  console.log(`\n  ${journal.status().events} Einträge im Protokoll. Beenden mit Strg+C.\n`);
});
