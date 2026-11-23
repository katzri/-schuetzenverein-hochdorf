'use strict';
// Ereignis-Journal mit Echtzeit-Sicherung (append-only, eine JSON-Zeile pro Ereignis).
//
// - Jede Änderung wird angehängt und per fsync auf die Platte geschrieben, BEVOR das Gerät
//   eine Bestätigung bekommt. Was bestätigt ist, ist gespeichert.
// - Dieselbe Zeile geht synchron in alle Backup-Ordner (z. B. USB-Stick). Fällt ein Ziel aus,
//   läuft der Betrieb weiter; sobald es wieder erreichbar ist, wird es komplett nachgezogen.
// - Jede Zeile enthält den Hash der vorherigen (Hash-Kette). Nachträglich geänderte oder
//   gelöschte Einträge fallen bei der Prüfung auf.
// - Beim Start gewinnt die längste gültige Fassung aus Hauptdatei und Backups und wird überall
//   wiederhergestellt. Eine halb geschriebene letzte Zeile (z. B. Stromausfall) wird verworfen;
//   echte Abweichungen werden vorher als Kopie aufbewahrt.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { writeAtomic } = require('./util');

const FILE = 'journal.jsonl';
const GENESIS = '0'.repeat(64);
const RESYNC_MS = 5000;

const hashOf = (prev, e) => crypto.createHash('sha256')
  .update(prev + JSON.stringify([e.seq, e.ts, e.type, e.by, e.data])).digest('hex');

function parse(buf) {
  const events = [];
  let prev = GENESIS, pos = 0, error = null;
  while (pos < buf.length) {
    const nl = buf.indexOf(10, pos);
    if (nl === -1) { error = 'unvollständige letzte Zeile'; break; }
    let e = null;
    try { e = JSON.parse(buf.toString('utf8', pos, nl)); } catch {}
    if (!e || e.seq !== events.length + 1 || e.prev !== prev || e.hash !== hashOf(prev, e)) {
      error = `Eintrag ${events.length + 1} ist beschädigt oder wurde verändert`;
      break;
    }
    events.push(e);
    prev = e.hash;
    pos = nl + 1;
  }
  return { events, bytes: pos, error };
}

// Abweichung ist harmlos, wenn das Ziel nur im Rückstand war oder nur eine halbe letzte Zeile hat
const harmless = (cur, good) => good.subarray(0, cur.length).equals(cur)
  || (cur.subarray(0, good.length).equals(good) && !cur.subarray(good.length).includes(10));

function writeAll(fd, buf) {
  for (let off = 0; off < buf.length;) off += fs.writeSync(fd, buf, off, buf.length - off);
}

class Journal {
  constructor({ dir, backupDirs = [], log = () => {} }) {
    this.log = log;
    this.targets = [dir, ...backupDirs].map((d, i) => {
      const abs = path.resolve(d);
      return { dir: abs, file: path.join(abs, FILE), primary: i === 0, fd: null, ok: false, error: null, lastTry: 0 };
    });
    this.events = [];
    this.lastHash = GENESIS;
    this.lastWrite = null;
  }

  open() {
    const versions = this.targets.map(t => {
      let buf = null;
      try { buf = fs.readFileSync(t.file); } catch (e) { if (e.code !== 'ENOENT') this.log(`${t.file} nicht lesbar: ${e.message}`); }
      const parsed = buf ? parse(buf) : { events: [], bytes: 0, error: null };
      if (parsed.error) this.log(`${t.file}: ${parsed.error}`);
      return { t, buf, parsed };
    });
    // Hat die Hauptdatei schon Einträge, zählen nur Backups derselben Kette (gleicher erster Eintrag).
    // Ist sie leer oder verloren, wird aus dem längsten Backup wiederhergestellt.
    const root = versions[0].parsed.events[0]?.hash;
    const best = versions
      .filter(v => !root || !v.parsed.events.length || v.parsed.events[0].hash === root)
      .reduce((a, v) => (v.parsed.events.length > a.parsed.events.length ? v : a));
    const good = best.buf ? best.buf.subarray(0, best.parsed.bytes) : Buffer.alloc(0);
    this.events = best.parsed.events;
    this.lastHash = this.events.length ? this.events[this.events.length - 1].hash : GENESIS;
    if (best !== versions[0] && this.events.length) this.log(`Hauptspeicher aus Backup ${best.t.dir} wiederhergestellt`);
    versions.forEach(v => this.restore(v.t, good, v.buf));
    const p = this.targets[0];
    if (!p.ok) {
      const err = new Error(`Journal nicht beschreibbar: ${p.error}`);
      err.code = 'JOURNAL';
      throw err;
    }
    return this.events;
  }

  // Bringt ein Ziel exakt auf den Stand `good` und öffnet es zum Anhängen
  restore(t, good, current) {
    t.lastTry = Date.now();
    this.close(t);
    try {
      fs.mkdirSync(t.dir, { recursive: true });
      if (!current || !current.equals(good)) {
        if (current && current.length && !harmless(current, good)) {
          const copy = t.file.replace(/\.jsonl$/, `.vorher-${Date.now()}.jsonl`);
          fs.copyFileSync(t.file, copy);
          this.log(`${t.file} wich ab – alte Fassung aufbewahrt als ${path.basename(copy)}`);
        }
        writeAtomic(t.file, good);
      }
      t.fd = fs.openSync(t.file, 'a');
      t.ok = true;
      t.error = null;
    } catch (e) {
      this.close(t);
      t.ok = false;
      t.error = e.message;
    }
  }

  // entries: [{ type, data }] – werden gemeinsam (atomar in einer Schreiboperation) gespeichert
  append(entries, by = null) {
    const p = this.targets[0];
    if (!p.ok) this.open(); // erneuter Versuch inkl. Reparatur; wirft, wenn weiterhin nicht möglich
    const ts = Date.now();
    let prev = this.lastHash;
    const evs = entries.map((x, i) => {
      const e = { seq: this.events.length + i + 1, ts, type: x.type, by, data: x.data ?? null, prev };
      e.hash = hashOf(prev, e);
      prev = e.hash;
      return e;
    });
    const buf = Buffer.from(evs.map(e => JSON.stringify(e)).join('\n') + '\n');
    try {
      writeAll(p.fd, buf);
      fs.fsyncSync(p.fd);
    } catch (e) {
      this.close(p);
      p.ok = false;
      p.error = e.message;
      const err = new Error('Speichern fehlgeschlagen: ' + e.message);
      err.code = 'JOURNAL';
      throw err;
    }
    this.events.push(...evs);
    this.lastHash = prev;
    this.lastWrite = ts;
    for (const t of this.targets.slice(1)) {
      if (!t.ok) {
        if (Date.now() - t.lastTry > RESYNC_MS) this.resync(t);
        continue;
      }
      try {
        writeAll(t.fd, buf);
        fs.fsyncSync(t.fd);
      } catch (e) {
        this.close(t);
        t.ok = false;
        t.error = e.message;
        t.lastTry = Date.now();
        this.log(`Backup ${t.dir} ausgefallen: ${e.message}`);
      }
    }
    return evs;
  }

  // Ausgefallenes Backup komplett aus dem Hauptspeicher nachziehen
  resync(t) {
    let current = null;
    try { current = fs.readFileSync(t.file); } catch {}
    try {
      this.restore(t, fs.readFileSync(this.targets[0].file), current);
    } catch (e) {
      t.ok = false;
      t.error = e.message;
      t.lastTry = Date.now();
    }
    if (t.ok) this.log(`Backup ${t.dir} wieder aktiv und vollständig nachgezogen`);
  }

  heal() {
    this.targets.slice(1).filter(t => !t.ok && Date.now() - t.lastTry > RESYNC_MS).forEach(t => this.resync(t));
  }

  // Zusätzliches Backup-Ziel im laufenden Betrieb aufnehmen (z. B. USB-Stick) und sofort komplett nachziehen.
  // Liegt dort schon ein anderes Protokoll, bleibt es als Kopie „…vorher-…“ erhalten.
  addTarget(dir) {
    const abs = path.resolve(dir);
    let t = this.targets.find(x => x.dir === abs);
    if (t) return t;
    t = { dir: abs, file: path.join(abs, FILE), primary: false, fd: null, ok: false, error: null, lastTry: 0 };
    this.targets.push(t);
    this.resync(t);
    return t;
  }

  removeTarget(dir) {
    const abs = path.resolve(dir), i = this.targets.findIndex(t => !t.primary && t.dir === abs);
    if (i < 0) return false;
    this.close(this.targets[i]);
    this.targets.splice(i, 1);
    return true;
  }

  status() {
    return {
      events: this.events.length, lastWrite: this.lastWrite, head: this.lastHash.slice(0, 16),
      targets: this.targets.map(t => ({ dir: t.dir, primary: t.primary, ok: t.ok, error: t.error })),
    };
  }

  // Liest alle Speicherorte neu ein und prüft die komplette Hash-Kette
  verify() {
    return this.targets.map(t => {
      try {
        const r = parse(fs.readFileSync(t.file));
        const head = r.events.length ? r.events[r.events.length - 1].hash : GENESIS;
        const ok = !r.error && head === this.lastHash;
        return { dir: t.dir, primary: t.primary, ok, events: r.events.length, error: r.error || (ok ? null : 'nicht auf aktuellem Stand') };
      } catch (e) {
        return { dir: t.dir, primary: t.primary, ok: false, events: 0, error: e.message };
      }
    });
  }

  close(t) {
    if (t.fd !== null) { try { fs.closeSync(t.fd); } catch {} t.fd = null; }
  }

  closeAll() { this.targets.forEach(t => this.close(t)); }
}

module.exports = { Journal, parse, hashOf, GENESIS, FILE };
