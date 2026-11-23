'use strict';
// QR-Codes ohne fremde Pakete (nach ISO/IEC 18004), weil der Server ohne Internet läuft:
// Byte-Modus (UTF-8), Fehlerkorrektur-Stufe M, Version 1–10 – das reicht für bis zu 213 Zeichen,
// also für WLAN-Zugangsdaten und Anmelde-Links.

// Stufe M je Version: [Korrektur-Bytes pro Block, Anzahl Blöcke]
const BLOCKS = [null, [10, 1], [16, 1], [26, 1], [18, 2], [24, 2], [16, 4], [18, 4], [22, 4], [22, 5], [26, 5]];
const MAX_VERSION = BLOCKS.length - 1;
const MASKS = [
  (x, y) => (x + y) % 2 === 0, (x, y) => y % 2 === 0, (x, y) => x % 3 === 0, (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0, (x, y) => (x * y) % 2 + (x * y) % 3 === 0,
  (x, y) => ((x * y) % 2 + (x * y) % 3) % 2 === 0, (x, y) => ((x + y) % 2 + (x * y) % 3) % 2 === 0,
];

// ---------- Reed-Solomon-Fehlerkorrektur im Körper GF(2^8), Polynom x^8+x^4+x^3+x^2+1 ----------
function gfMul(x, y) {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z;
}
function rsDivisor(degree) {
  const r = new Array(degree).fill(0);
  r[degree - 1] = 1;
  for (let i = 0, root = 1; i < degree; i++, root = gfMul(root, 2)) {
    for (let j = 0; j < degree; j++) {
      r[j] = gfMul(r[j], root);
      if (j + 1 < degree) r[j] ^= r[j + 1];
    }
  }
  return r;
}
function rsRemainder(data, divisor) {
  const r = divisor.map(() => 0);
  for (const b of data) {
    const factor = b ^ r.shift();
    r.push(0);
    divisor.forEach((c, i) => { r[i] ^= gfMul(c, factor); });
  }
  return r;
}

// ---------- Platzbedarf ----------
// Module, die neben Suchmustern, Taktlinien und Formatangaben für Daten + Fehlerkorrektur bleiben
function rawModules(v) {
  let n = (16 * v + 128) * v + 64;
  if (v >= 2) {
    const a = Math.floor(v / 7) + 2;
    n -= (25 * a - 10) * a - 55;
    if (v >= 7) n -= 36;
  }
  return n;
}
const dataBytes = v => Math.floor(rawModules(v) / 8) - BLOCKS[v][0] * BLOCKS[v][1];
const countBits = v => (v < 10 ? 8 : 16);
const fits = (v, n) => 4 + countBits(v) + n * 8 <= dataBytes(v) * 8;

// Nutzdaten → Bytefolge mit Fehlerkorrektur, blockweise verschränkt
function codewords(bytes, v) {
  const cap = dataBytes(v) * 8, bits = [];
  const put = (val, len) => { for (let i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1); };
  put(4, 4); // Byte-Modus
  put(bytes.length, countBits(v));
  bytes.forEach(b => put(b, 8));
  put(0, Math.min(4, cap - bits.length)); // Abschluss
  put(0, (8 - bits.length % 8) % 8);
  for (let pad = 0xec; bits.length < cap; pad ^= 0xec ^ 0x11) put(pad, 8);
  const data = [];
  for (let i = 0; i < bits.length; i += 8) data.push(bits.slice(i, i + 8).reduce((a, b) => (a << 1) | b, 0));

  const [ecLen, numBlocks] = BLOCKS[v];
  const total = Math.floor(rawModules(v) / 8);
  const shortLen = Math.floor(total / numBlocks) - ecLen; // Datenbytes eines kurzen Blocks; lange haben eines mehr
  const numShort = numBlocks - total % numBlocks;
  const divisor = rsDivisor(ecLen), blocks = [];
  for (let i = 0, k = 0; i < numBlocks; i++) {
    const d = data.slice(k, k + shortLen + (i < numShort ? 0 : 1));
    k += d.length;
    blocks.push({ d, e: rsRemainder(d, divisor) });
  }
  const out = [];
  for (let i = 0; i <= shortLen; i++) blocks.forEach(b => { if (i < b.d.length) out.push(b.d[i]); });
  for (let i = 0; i < ecLen; i++) blocks.forEach(b => out.push(b.e[i]));
  return out;
}

// Bewertung eines maskierten Codes nach Norm – je kleiner, desto besser lesbar für die Kamera
function penalty(m) {
  const n = m.length;
  let p = 0, dark = 0;
  const lines = [];
  for (let i = 0; i < n; i++) {
    lines.push(m[i].map(c => (c ? 1 : 0)).join(''));
    lines.push(m.map(r => (r[i] ? 1 : 0)).join(''));
  }
  for (const s of lines) {
    for (const run of s.match(/0+|1+/g)) if (run.length >= 5) p += run.length - 2;
    for (const pat of ['10111010000', '00001011101']) for (let i = s.indexOf(pat); i >= 0; i = s.indexOf(pat, i + 1)) p += 40;
  }
  for (let y = 0; y < n - 1; y++) {
    for (let x = 0; x < n - 1; x++) {
      const c = m[y][x];
      if (c === m[y][x + 1] && c === m[y + 1][x] && c === m[y + 1][x + 1]) p += 3;
    }
  }
  m.forEach(r => r.forEach(c => { if (c) dark++; }));
  return p + (Math.ceil(Math.abs(dark * 20 - n * n * 10) / (n * n)) - 1) * 10;
}

// Liefert den QR-Code als Zeilen aus '1' (dunkel) und '0' (hell), ohne Rand.
// mask: nur für Tests – sonst wird die am besten lesbare Maske gewählt.
function qrMatrix(text, { mask = null } = {}) {
  const bytes = [...Buffer.from(String(text), 'utf8')];
  let v = 1;
  while (v <= MAX_VERSION && !fits(v, bytes.length)) v++;
  if (v > MAX_VERSION) throw new RangeError('Der Text ist zu lang für einen QR-Code');
  const size = 17 + 4 * v;
  const m = Array.from({ length: size }, () => new Array(size).fill(false));    // true = dunkel
  const fixed = Array.from({ length: size }, () => new Array(size).fill(false)); // Funktionsmuster – wird nicht maskiert
  const set = (x, y, dark) => { m[y][x] = dark; fixed[y][x] = true; };
  const bit = (val, i) => ((val >>> i) & 1) !== 0;

  // Taktlinien, drei Suchmuster mit Rand, Ausrichtungsmuster
  for (let i = 0; i < size; i++) { set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0); }
  for (const [cx, cy] of [[3, 3], [size - 4, 3], [3, size - 4]]) {
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const x = cx + dx, y = cy + dy, d = Math.max(Math.abs(dx), Math.abs(dy));
        if (x >= 0 && x < size && y >= 0 && y < size) set(x, y, d !== 2 && d !== 4);
      }
    }
  }
  const align = [];
  if (v > 1) {
    const count = Math.floor(v / 7) + 2, step = Math.ceil((v * 4 + 4) / (count * 2 - 2)) * 2;
    for (let pos = size - 7; align.length < count - 1; pos -= step) align.unshift(pos);
    align.unshift(6);
  }
  align.forEach((cy, i) => align.forEach((cx, j) => {
    const last = align.length - 1;
    if ((i === 0 && j === 0) || (i === 0 && j === last) || (i === last && j === 0)) return; // dort sitzen die Suchmuster
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) set(cx + dx, cy + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
  }));

  // Formatangabe (Fehlerkorrektur-Stufe M = 00 und Maske), doppelt abgelegt und selbst fehlergeschützt
  function drawFormat(k) {
    let rem = k;
    for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    const bits = ((k << 10) | rem) ^ 0x5412;
    for (let i = 0; i <= 5; i++) set(8, i, bit(bits, i));
    set(8, 7, bit(bits, 6));
    set(8, 8, bit(bits, 7));
    set(7, 8, bit(bits, 8));
    for (let i = 9; i < 15; i++) set(14 - i, 8, bit(bits, i));
    for (let i = 0; i < 8; i++) set(size - 1 - i, 8, bit(bits, i));
    for (let i = 8; i < 15; i++) set(8, size - 15 + i, bit(bits, i));
    set(8, size - 8, true);
  }
  drawFormat(0); // Platz reservieren, die echte Maske folgt unten
  if (v >= 7) { // Versionsangabe
    let rem = v;
    for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
    const bits = (v << 12) | rem;
    for (let i = 0; i < 18; i++) {
      const a = size - 11 + (i % 3), b = Math.floor(i / 3);
      set(a, b, bit(bits, i));
      set(b, a, bit(bits, i));
    }
  }

  // Daten im Zickzack von rechts unten nach links oben einfüllen
  const data = codewords(bytes, v);
  for (let right = size - 1, i = 0; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++) {
      for (let j = 0; j < 2; j++) {
        const x = right - j, y = ((right + 1) & 2) === 0 ? size - 1 - vert : vert;
        if (!fixed[y][x] && i < data.length * 8) { m[y][x] = bit(data[i >>> 3], 7 - (i & 7)); i++; }
      }
    }
  }

  const flip = k => { for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (!fixed[y][x] && MASKS[k](x, y)) m[y][x] = !m[y][x]; };
  let best = mask;
  if (best === null) {
    let min = Infinity;
    for (let k = 0; k < 8; k++) {
      flip(k);
      drawFormat(k);
      const p = penalty(m);
      if (p < min) { min = p; best = k; }
      flip(k);
    }
  }
  flip(best);
  drawFormat(best);
  return { size, version: v, mask: best, rows: m.map(r => r.map(c => (c ? '1' : '0')).join('')) };
}

// Inhalt eines WLAN-QR-Codes, wie ihn die Kamera-Apps von Android und iOS verstehen
const wifiEsc = s => String(s).replace(/([\\;,:"])/g, '\\$1');
const wifiText = ({ ssid, password }) => (password
  ? `WIFI:T:WPA;S:${wifiEsc(ssid)};P:${wifiEsc(password)};;`
  : `WIFI:T:nopass;S:${wifiEsc(ssid)};;`);

module.exports = { qrMatrix, wifiText, rsDivisor, rsRemainder, MAX_VERSION };
