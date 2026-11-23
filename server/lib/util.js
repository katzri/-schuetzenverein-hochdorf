'use strict';
// Kleine gemeinsame Hilfen für den Server.
const fs = require('fs');
const crypto = require('crypto');

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const fail = (status, message) => { throw new HttpError(status, message); };
const isInt = (v, min, max) => Number.isInteger(v) && v >= min && v <= max;
// Steuerzeichen und spitze Klammern entfernen, Leerraum zusammenfassen, kürzen
const cleanText = (v, max) => (typeof v === 'string'
  ? v.replace(/[\u0000-\u001f\u007f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max)
  : '');
const newId = prefix => prefix + crypto.randomBytes(8).toString('hex');

// Datei sicher ersetzen: erst vollständig in eine Hilfsdatei schreiben und auf die Platte
// zwingen, dann umbenennen – so gibt es nie eine halb geschriebene Datei.
function writeAtomic(file, data) {
  const tmp = file + '.tmp';
  const fd = fs.openSync(tmp, 'w');
  try { fs.writeSync(fd, data); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  fs.renameSync(tmp, file);
}

module.exports = { HttpError, fail, isInt, cleanText, newId, writeAtomic };
