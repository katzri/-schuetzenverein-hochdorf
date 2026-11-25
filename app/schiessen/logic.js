// Schießauswertung – Rechenteil ohne Oberfläche (Zeit lesen/anzeigen, Wertung, Rangliste, CSV).
// Läuft im Browser (window.Schiessen) und in Node (für die Tests).
//   Preisschießen: 5 Schuss, jeder Schuss Treffer oder kein Treffer  → Wertung = Anzahl Treffer (max. 5)
//   Pokalschießen: 3 Schuss, jeder Schuss 1–10 Ringe (0 = vorbei)    → Wertung = Summe der Ringe (max. 30)
(function (root) {
  'use strict';
  const ARTEN = {
    preis: { name: 'Preisschießen', schuesse: 5, einheit: 'Treffer', max: 5 },
    pokal: { name: 'Pokalschießen', schuesse: 3, einheit: 'Ringe', max: 30, ringeMax: 10 },
  };
  const artVon = e => (e.art === 'pokal' ? 'pokal' : 'preis'); // alte Einträge ohne Art = Preisschießen

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

  // Wertung: Preisschießen = Anzahl Treffer, Pokalschießen = Ringe zusammen
  function wert(e) {
    return artVon(e) === 'pokal'
      ? (e.ringe || []).reduce((s, r) => s + (Number(r) || 0), 0)
      : (e.treffer || []).filter(Boolean).length;
  }
  // Pokal-Gleichstand: wer die besseren Einzelschüsse hat (mehr Zehner, dann Neuner …)
  const absteigend = e => (e.ringe || []).map(r => Number(r) || 0).sort((a, b) => b - a);
  function einzelVergleich(a, b) {
    const x = absteigend(a), y = absteigend(b);
    for (let i = 0; i < Math.max(x.length, y.length); i++) if ((y[i] || 0) !== (x[i] || 0)) return (y[i] || 0) - (x[i] || 0);
    return 0;
  }

  // Höhere Wertung zuerst, dann (Pokal) bessere Einzelschüsse, dann schnellere Zeit (ohne Zeit ans Ende).
  function gleichauf(a, b) {
    return wert(b) - wert(a)
      || (artVon(a) === 'pokal' ? einzelVergleich(a, b) : 0)
      || (a.zeit == null) - (b.zeit == null)
      || (a.zeit || 0) - (b.zeit || 0);
  }
  const vergleich = (a, b) => gleichauf(a, b) || (a.datum || 0) - (b.datum || 0);

  // Sortierte Einträge einer Art mit Platz; echter Gleichstand = gleicher Platz.
  function rangliste(eintraege, art, nurBester) {
    let liste = eintraege.filter(e => artVon(e) === art).sort(vergleich);
    if (nurBester) {
      const gesehen = new Set();
      liste = liste.filter(e => {
        const k = e.name.trim().toLowerCase();
        if (gesehen.has(k)) return false;
        gesehen.add(k);
        return true;
      });
    }
    const out = [];
    liste.forEach((e, i) => {
      const platz = i > 0 && gleichauf(liste[i - 1], e) === 0 ? out[i - 1].platz : i + 1;
      out.push({ ...e, wert: wert(e), platz });
    });
    return out;
  }

  function csv(eintraege, art, nurBester) {
    const A = ARTEN[art];
    const feld = v => /[";\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v);
    const schuss = Array.from({ length: A.schuesse }, (_, i) => `Schuss ${i + 1}`);
    const zeilen = [[A.name], ['Platz', 'Name', A.einheit, 'von', 'Zeit (s)', 'Zeit', ...schuss, 'Datum']];
    for (const e of rangliste(eintraege, art, nurBester)) {
      const d = new Date(e.datum);
      const einzel = schuss.map((_, i) => art === 'pokal' ? (e.ringe[i] == null ? '' : e.ringe[i]) : (e.treffer[i] ? 'Treffer' : 'kein Treffer'));
      zeilen.push([e.platz, e.name, e.wert, A.max,
        e.zeit == null ? '' : (e.zeit / 1000).toFixed(1).replace('.', ','), e.zeit == null ? '' : zeitText(e.zeit).replace(' s', ''),
        ...einzel, isNaN(d) ? '' : d.toLocaleString('de-DE')]);
    }
    return '﻿' + zeilen.map(z => z.map(feld).join(';')).join('\r\n') + '\r\n';
  }

  const api = { ARTEN, artVon, zeitLesen, zeitText, wert, vergleich, rangliste, csv };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Schiessen = api;
})(typeof window !== 'undefined' ? window : globalThis);
