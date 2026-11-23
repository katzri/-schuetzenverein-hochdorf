'use strict';
// Preisliste für das nächste Fest. Beim allerersten Start wird sie automatisch angelegt;
// danach in der Verwaltung unter „Produkte“ → „Preisliste übernehmen“ mit einem Klick aktivierbar.
// Getränke: wie bei „Der Schützenverein Hochdorf trifft auf Schlachtplatte“ (16./17.10.2026).
// Sorten mit gleichem Preis sind eigene Produkte, damit Küche/Theke genau sehen, was gewünscht ist.
// [Name, Preis in Cent, Kategorie, Zubereitung ('kueche' | 'theke' | '' = keine)]
const TITLE = 'Preisliste nächstes Fest (Getränke wie Schlachtplatte 10/2026)';

const PRICE_LIST = [
  // Essen
  ['Schützen-Schnitzel mit Pommes und Salat', 1400, 'essen', 'kueche'],
  ['Pumuckl (kleines Schnitzel mit Pommes)', 900, 'essen', 'kueche'],
  ['Bratwurst mit Kartoffelsalat', 850, 'essen', 'kueche'],
  ['Bratwurst mit Pommes', 850, 'essen', 'kueche'],
  ['Portion Pommes frites', 300, 'essen', 'kueche'],
  // Bier
  ['Gold Krone / Fassbier 0,5 l', 370, 'bier', 'theke'],
  ['Pils Krone 0,33 l', 350, 'bier', 'theke'],
  ['Helles 0,5 l', 370, 'bier', 'theke'],
  ['Weizen Hefe 0,5 l', 370, 'bier', 'theke'],
  // Wein & Schnaps
  ['Heilbronner Riesling 0,25 l', 450, 'wein', 'theke'],
  ['Rotwein Württemberger 0,25 l', 450, 'wein', 'theke'],
  ['Weinschorle rot 0,25 l', 350, 'wein', 'theke'],
  ['Weinschorle weiß 0,25 l', 350, 'wein', 'theke'],
  ['Schnaps aus Hochdorf 2 cl', 200, 'wein', 'theke'],
  // Alkoholfrei
  ['Sportweizen 0,5 l', 350, 'alkfrei', 'theke'],
  ['Bier alkoholfrei 0,33 l', 300, 'alkfrei', 'theke'],
  ['Spezi 0,5 l', 220, 'alkfrei', 'theke'],
  ['Libella 0,5 l', 220, 'alkfrei', 'theke'],
  ['Coca Cola 0,5 l', 220, 'alkfrei', 'theke'],
  ['Apfelsaftschorle 0,5 l', 220, 'alkfrei', 'theke'],
  ['Sprudel süß 0,5 l', 220, 'alkfrei', 'theke'],
  ['Sprudel sauer 0,5 l', 220, 'alkfrei', 'theke'],
];

// Kein Pfand: ausgeschenkt wird nur im Haus. Beim Übernehmen der Preisliste werden alle
// Produkte, die hier nicht stehen (auch alte Pfand-Felder), deaktiviert.
module.exports = { TITLE, PRICE_LIST };
