// Schießauswertung – Rechenteil ohne Oberfläche (Zeit lesen/anzeigen, Rangliste, CSV).
// Läuft im Browser (window.Schiessen) und in Node (für die Tests).
(function (root) {
  'use strict';
  const SCHEIBEN = 5;

  // "1:23,4" → 83400 ms, "83,4" → 83400, "83" → 83000. Leer → null. Ungültig → NaN.
  function zeitLesen(text) {
    const t = String(text == null ? '' : text).trim().replace(/\s*s(ek)?\.?$/i, '').replace(',', '.');
    if (!t) return null;
    const m = /^(?:(\d+):)?(\d+(?:\.\d*)?)$/.exec(t);
    if (!m) return NaN;
    const min = m[1] ? Number(m[1]) : 0;
    const sek = Number(m[2]);
    if (m[1] && sek >= 60) return NaN;
    return Math.round((min * 60 + sek) * 1000);
  }

  // 83400 → "1:23,4", 9400 → "9,4 s"
  function zeitText(ms) {
    if (ms == null || !isFinite(ms)) return '–';
    const zehntel = Math.floor(ms / 100);
    const min = Math.floor(zehntel / 600);
    const sek = Math.floor((zehntel % 600) / 10);
    const z = zehntel % 10;
    return min > 0 ? `${min}:${String(sek).padStart(2, '0')},${z}` : `${sek},${z} s`;
  }

  const anzahl = e => (e.treffer || []).filter(Boolean).length;

  // Mehr Treffer zuerst, bei Gleichstand die schnellere Zeit (ohne Zeit ans Ende), dann wer früher geschossen hat.
  function vergleich(a, b) {
    return anzahl(b) - anzahl(a)
      || (a.zeit == null) - (b.zeit == null)
      || (a.zeit || 0) - (b.zeit || 0)
      || (a.datum || 0) - (b.datum || 0);
  }

  // Liefert sortierte Einträge mit Platz; gleiche Treffer und gleiche Zeit = gleicher Platz.
  function rangliste(eintraege, nurBester) {
    let liste = eintraege.slice().sort(vergleich);
    if (nurBester) {
      const gesehen = new Set();
      liste = liste.filter(e => {
        const k = e.name.trim().toLowerCase();
        if (gesehen.has(k)) return false;
        gesehen.add(k);
        return true;
      });
    }
    return liste.map((e, i) => {
      const vorher = liste[i - 1];
      const gleich = vorher && anzahl(vorher) === anzahl(e) && vorher.zeit === e.zeit;
      return { ...e, anzahl: anzahl(e), platz: gleich ? null : i + 1 };
    }).map((e, i, arr) => ({ ...e, platz: e.platz == null ? arr[i - 1].platz : e.platz }));
  }

  function csv(eintraege, nurBester) {
    const feld = v => /[";\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v);
    const zeilen = [['Platz', 'Name', 'Treffer', 'von', 'Zeit (s)', 'Zeit', ...Array.from({ length: SCHEIBEN }, (_, i) => `Scheibe ${i + 1}`), 'Datum']];
    for (const e of rangliste(eintraege, nurBester)) {
      const d = new Date(e.datum);
      zeilen.push([e.platz, e.name, e.anzahl, SCHEIBEN,
        e.zeit == null ? '' : (e.zeit / 1000).toFixed(1).replace('.', ','), e.zeit == null ? '' : zeitText(e.zeit).replace(' s', ''),
        ...Array.from({ length: SCHEIBEN }, (_, i) => (e.treffer[i] ? 'Treffer' : 'Fehler')),
        isNaN(d) ? '' : d.toLocaleString('de-DE')]);
    }
    return '﻿' + zeilen.map(z => z.map(feld).join(';')).join('\r\n') + '\r\n';
  }

  const api = { SCHEIBEN, zeitLesen, zeitText, anzahl, vergleich, rangliste, csv };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Schiessen = api;
})(typeof window !== 'undefined' ? window : globalThis);
