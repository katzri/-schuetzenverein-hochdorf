'use strict';
// Prüft die Aufträge der Geräte (Rechte, Eingaben) und schreibt daraus Ereignisse ins Journal.
// - Preise kommen immer aus dem Produktkatalog des Servers, nie vom Gerät.
// - Jeder Auftrag trägt eine Auftrags-ID vom Gerät (cid). Wird er wegen schlechter Verbindung
//   doppelt geschickt, wird er trotzdem nur einmal gebucht.
const { apply, orderTotal, paidAmount, cashPaid, findOrder, tableOf, seatsOf } = require('./state');
const { fail, cleanText, isInt, newId } = require('./util');
const { TITLE, PRICE_LIST } = require('./default-products');

const STATIONS = ['kueche', 'theke'];
const STATUSES = ['neu', 'arbeit', 'fertig', 'abgeholt'];
const CATS = ['essen', 'bier', 'wein', 'alkfrei', 'getraenke', 'kaffee', 'pfand'];
const CID = /^[a-f0-9]{16,64}$/;
const SYSTEM = { role: 'system', device: 'Server' };
const toLine = i => ({ name: i.name, price: i.price, qty: i.qty });
const isAdmin = (can, actor) => can(actor, '*');
const euro = c => `${(c / 100).toFixed(2).replace('.', ',')} €`;

function createCommands({ journal, state, can }) {
  function commit(entries, actor) {
    const evs = journal.append(entries, { role: actor.role, device: actor.device });
    evs.forEach(e => apply(state, e));
    return evs;
  }
  const need = (actor, perm) => { if (!can(actor, perm)) fail(403, 'Dafür hat diese Arbeitsgruppe keine Berechtigung'); };
  const checkCid = cid => {
    if (cid !== undefined && cid !== null && (typeof cid !== 'string' || !CID.test(cid))) fail(400, 'Ungültige Auftrags-ID');
    return cid || null;
  };
  const findProduct = id => state.products.find(p => p.id === id && p.active);
  // „Aufs Haus“ (Freiverzehr für Helfer, Musik …): kein Geld, aber mit Pflicht-Angabe für wen –
  // steht mit Gerät und Wert in der Auswertung. amount = 0, value = Warenwert.
  function houseOf(actor, b, value) {
    if (!b.house) return null;
    need(actor, 'house');
    const reason = cleanText(b.reason, 60);
    if (!reason) fail(400, 'Bitte angeben, für wen es aufs Haus geht (z. B. Helfer, Musik)');
    return { kind: 'haus', amount: 0, value, reason };
  }

  // Positionen prüfen und zusammenfassen. Gleiche Produkte mit unterschiedlichem Hinweis
  // („ohne Zwiebeln“) oder für unterschiedliche Plätze bleiben getrennte Zeilen, damit Küche/Theke
  // sie einzeln sehen und jeder Platz für sich kassiert werden kann.
  function lineItems(items, seats = null) {
    if (!Array.isArray(items) || !items.length || items.length > 60) fail(400, 'Keine Produkte ausgewählt');
    const lines = new Map(), perProduct = new Map();
    for (const it of items) {
      if (!isInt(it?.qty, 1, 99)) fail(400, 'Ungültige Menge');
      const p = findProduct(it.pid);
      if (!p) fail(409, 'Ein Produkt ist nicht mehr im Angebot – bitte Auswahl prüfen');
      if (p.soldOut) fail(409, `„${p.name}“ ist ausverkauft – bitte aus der Auswahl nehmen`);
      const note = cleanText(it.note, 60);
      const seat = it.seat ?? null;
      if (seat !== null && (!seats || !isInt(seat, seats.from, seats.to))) fail(400, seats ? `Platz ${seat} gehört nicht zu diesem Tisch (Platz ${seats.from}–${seats.to})` : 'Plätze gibt es nur an Tischen');
      const key = `${it.pid}|${note}|${seat}`;
      const line = lines.get(key) || { pid: it.pid, name: p.name, price: p.price, qty: 0, station: p.station, ...(note ? { note } : {}), ...(seat ? { seat } : {}) };
      line.qty += it.qty;
      lines.set(key, line);
      perProduct.set(it.pid, (perProduct.get(it.pid) || 0) + it.qty);
    }
    for (const [pid, n] of perProduct) {
      const p = findProduct(pid);
      if (n > 99) fail(400, 'Ungültige Menge');
      if (p.stock !== null && p.stock !== undefined && n > p.stock) fail(409, `Von „${p.name}“ sind nur noch ${p.stock} da`);
    }
    return [...lines.values()];
  }

  function createOrder(actor, b) {
    need(actor, 'order.create');
    const cid = checkCid(b.cid);
    const dup = cid && state.cids.get(cid);
    if (dup) return { order: findOrder(state, dup.order) || null, duplicate: true };
    const table = isInt(b.table, 1, 999) ? b.table : null;
    const name = table ? '' : cleanText(b.name, 40);
    if (!table && !name) fail(400, 'Bitte Tisch wählen oder Namen für die Abholung eingeben');
    if (table && !tableOf(state, table)) fail(400, `Tisch ${table} gibt es im Tischplan nicht`);
    const items = lineItems(b.items, table ? seatsOf(state, table) : null);
    const parts = {};
    items.forEach(i => { if (i.station) parts[i.station] = { status: 'neu', t: null }; });
    const order = { id: newId('o'), nr: state.nextNr, cid, table, name, note: cleanText(b.note, 200), items, parts };
    const entries = [{ type: 'order.created', data: order }];
    // Abholungen werden beim Bestellen bezahlt – Bestellung und Zahlung werden gemeinsam gespeichert
    if (!table) {
      entries.push({ type: 'payment.recorded', data: { id: newId('z'), kind: 'abholung', name, orderIds: [order.id], amount: orderTotal(order), items: items.map(toLine) } });
    }
    commit(entries, actor);
    return { order: findOrder(state, order.id) };
  }

  function setStatus(actor, id, b) {
    const o = findOrder(state, id);
    if (!o) fail(404, 'Bestellung nicht gefunden');
    if (o.cancelled) fail(409, 'Diese Bestellung wurde storniert');
    const { station, status } = b;
    if (!STATIONS.includes(station) || !o.parts[station] || !STATUSES.includes(status)) fail(400, 'Ungültiger Status');
    if (!can(actor, `status.${station}`) && !(status === 'abgeholt' && can(actor, 'order.pickup'))) {
      fail(403, 'Dafür hat diese Arbeitsgruppe keine Berechtigung');
    }
    if (o.parts[station].status !== status) commit([{ type: 'order.status', data: { id, station, status } }], actor);
    return { order: o };
  }

  function cancelOrder(actor, id, b) {
    need(actor, 'order.cancel');
    const o = findOrder(state, id);
    if (!o) fail(404, 'Bestellung nicht gefunden');
    if (o.cancelled) fail(409, 'Diese Bestellung ist bereits storniert');
    const untouched = Object.values(o.parts).every(p => p.status === 'neu');
    if (!untouched && !can(actor, '*')) fail(403, 'Die Zubereitung hat schon begonnen – Storno nur über die Verwaltung');
    const reason = cleanText(b.reason, 120);
    const entries = [{ type: 'order.cancelled', data: { id, reason } }];
    // Bereits Bezahltes (auch Teilzahlungen) wird als Rückzahlung gebucht – nicht, was aufs Haus ging
    const refund = cashPaid(o);
    if (refund > 0) {
      const cash = i => (i.paid || 0) - (i.free || 0);
      entries.push({ type: 'payment.refunded', data: {
        id: newId('z'), kind: 'storno', orderId: id, nr: o.nr, table: o.table, name: o.name, reason,
        amount: -refund, items: o.items.filter(i => cash(i) > 0).map(i => ({ name: i.name, price: i.price, qty: -cash(i) })),
      } });
    }
    commit(entries, actor);
    return { order: o, refund };
  }

  // Einzelne, noch nicht bezahlte Position stornieren (z. B. ein Bier zu viel getippt)
  function cancelItem(actor, id, b) {
    need(actor, 'order.cancel');
    const o = findOrder(state, id);
    if (!o) fail(404, 'Bestellung nicht gefunden');
    if (o.cancelled) fail(409, 'Diese Bestellung ist bereits storniert');
    const it = isInt(b.idx, 0, o.items.length - 1) ? o.items[b.idx] : null;
    if (!it) fail(400, 'Position nicht gefunden');
    const free = it.qty - (it.paid || 0);
    if (!isInt(b.qty, 1, 99) || b.qty > free) fail(409, free > 0 ? `Davon sind nur noch ${free} offen` : 'Diese Position ist schon bezahlt – Storno nur über die Verwaltung');
    const started = it.station && o.parts[it.station] && o.parts[it.station].status !== 'neu';
    if (started && !isAdmin(can, actor)) fail(403, 'Die Zubereitung hat schon begonnen – Storno nur über die Verwaltung');
    const rest = o.items.reduce((sum, i) => sum + i.qty, 0) - b.qty;
    if (rest === 0) return cancelOrder(actor, id, b);
    commit([{ type: 'order.item.cancelled', data: { id, idx: b.idx, qty: b.qty, reason: cleanText(b.reason, 120) } }], actor);
    return { order: o, refund: 0 };
  }

  // Tisch abrechnen – komplett oder getrennt: b.lines = [{ orderId, idx, qty }] nennt die
  // Stückzahlen, die dieser Gast zahlt. Ohne lines wird alles Offene des Tisches kassiert.
  function payTable(actor, table, b) {
    need(actor, 'table.pay');
    const cid = checkCid(b.cid);
    const dup = cid && state.cids.get(cid);
    if (dup) return { payment: state.payments.find(p => p.id === dup.payment) || null, duplicate: true };
    const openOrders = () => state.orders.filter(o => o.table === table && !o.paid && !o.cancelled);
    const open = openOrders();
    if (!open.length) fail(409, `Für Tisch ${table} ist nichts mehr offen`);
    const rest = (o, idx) => o.items[idx].qty - (o.items[idx].paid || 0);
    let lines;
    if (Array.isArray(b.lines) && b.lines.length) {
      if (b.lines.length > 200) fail(400, 'Zu viele Positionen');
      const want = new Map();
      for (const l of b.lines) {
        const o = open.find(x => x.id === l?.orderId);
        if (!o || !isInt(l.idx, 0, o.items.length - 1) || !isInt(l.qty, 1, 99)) fail(409, 'Die Rechnung hat sich geändert – bitte neu prüfen');
        const k = `${o.id}|${l.idx}`;
        want.set(k, { orderId: o.id, idx: l.idx, qty: (want.get(k)?.qty || 0) + l.qty });
      }
      lines = [...want.values()];
      if (lines.some(l => l.qty > rest(open.find(o => o.id === l.orderId), l.idx))) fail(409, 'Die Rechnung hat sich geändert – bitte neu prüfen');
    } else {
      lines = open.flatMap(o => o.items.map((i, idx) => ({ orderId: o.id, idx, qty: rest(o, idx) }))).filter(l => l.qty > 0);
    }
    const merged = new Map();
    let amount = 0;
    for (const l of lines) {
      const i = open.find(o => o.id === l.orderId).items[l.idx];
      amount += i.price * l.qty;
      const k = `${i.name}|${i.price}`;
      const r = merged.get(k) || { name: i.name, price: i.price, qty: 0 };
      r.qty += l.qty;
      merged.set(k, r);
    }
    if (b.expected !== undefined && b.expected !== amount) fail(409, `Der Betrag hat sich geändert: jetzt ${euro(amount)} – bitte neu prüfen`);
    const payment = { id: newId('z'), kind: 'tisch', cid, table, lines, amount, items: [...merged.values()], ...houseOf(actor, b, amount) };
    commit([{ type: 'payment.recorded', data: payment }], actor);
    return { payment, left: openOrders().reduce((sum, o) => sum + orderTotal(o) - paidAmount(o), 0) };
  }

  // Gäste setzen sich um: alles Offene wandert an den neuen Tisch
  function moveTable(actor, from, b) {
    need(actor, 'table.move');
    const to = b.to;
    if (!isInt(to, 1, 999) || !tableOf(state, to)) fail(400, 'Diesen Tisch gibt es im Tischplan nicht');
    if (to === from) fail(400, 'Das ist derselbe Tisch');
    const open = state.orders.filter(o => o.table === from && !o.paid && !o.cancelled);
    if (!open.length) fail(409, `Für Tisch ${from} ist nichts offen`);
    commit([{ type: 'table.moved', data: { from, to, orderIds: open.map(o => o.id) } }], actor);
    return { moved: open.length, to };
  }

  function kasseSale(actor, b) {
    need(actor, 'kasse.sale');
    const cid = checkCid(b.cid);
    const dup = cid && state.cids.get(cid);
    if (dup) return { payment: state.payments.find(p => p.id === dup.payment) || null, duplicate: true };
    const lines = lineItems(b.items);
    const items = lines.map(toLine);
    const amount = items.reduce((s, i) => s + i.price * i.qty, 0);
    const payment = { id: newId('z'), kind: 'kasse', cid, amount, items, pids: lines.map(i => ({ pid: i.pid, qty: i.qty })), ...houseOf(actor, b, amount) };
    commit([{ type: 'payment.recorded', data: payment }], actor);
    return { payment };
  }

  function saveProduct(actor, b) {
    need(actor, '*');
    const existing = b.id ? state.products.find(p => p.id === b.id) : null;
    if (b.id && !existing) fail(404, 'Produkt nicht gefunden');
    const name = cleanText(b.name, 40);
    if (!name) fail(400, 'Bitte einen Namen eingeben');
    if (!isInt(b.price, -100000, 100000)) fail(400, 'Ungültiger Preis');
    if (!CATS.includes(b.cat)) fail(400, 'Ungültige Kategorie');
    const station = STATIONS.includes(b.station) ? b.station : '';
    const active = b.active !== false;
    if (active && state.products.some(p => p.id !== b.id && p.active && p.name.toLowerCase() === name.toLowerCase())) {
      fail(409, `„${name}“ gibt es schon – bitte eindeutigen Namen wählen (z. B. mit Größe)`);
    }
    const product = { id: existing?.id || newId('p'), name, price: b.price, cat: b.cat, station, active };
    commit([{ type: 'product.saved', data: product }], actor);
    return { product };
  }

  // „Ausverkauft“ melden oder eine Stückzahl hinterlegen, die mit jeder Bestellung herunterzählt.
  // Küche und Theke dürfen das für ihre eigenen Produkte, die Verwaltung für alle.
  function setAvailability(actor, id, b) {
    const p = state.products.find(x => x.id === id);
    if (!p) fail(404, 'Produkt nicht gefunden');
    if (!isAdmin(can, actor) && !(p.station && can(actor, `status.${p.station}`))) fail(403, 'Dafür hat diese Arbeitsgruppe keine Berechtigung');
    const stock = b.stock === null || b.stock === undefined || b.stock === '' ? null : b.stock;
    if (stock !== null && !isInt(stock, 0, 9999)) fail(400, 'Ungültige Stückzahl');
    const soldOut = stock === 0 ? true : Boolean(b.soldOut);
    commit([{ type: 'product.availability', data: { id, name: p.name, soldOut, stock } }], actor);
    return { product: p };
  }

  // Tischplan: Bereiche (z. B. Gastraum, Nebenzimmer, Terrasse) mit Tischen und Sitzplätzen
  function saveLayout(actor, b) {
    need(actor, '*');
    if (!Array.isArray(b.areas) || !b.areas.length || b.areas.length > 12) fail(400, 'Bitte mindestens einen Bereich anlegen');
    const seen = new Set();
    const areas = b.areas.map(a => {
      const name = cleanText(a?.name, 30);
      if (!name) fail(400, 'Jeder Bereich braucht einen Namen');
      if (!Array.isArray(a.tables) || a.tables.length > 200) fail(400, `Ungültige Tische in „${name}“`);
      const tables = a.tables.map(t => {
        if (!isInt(t?.nr, 1, 999)) fail(400, `Ungültige Tischnummer in „${name}“`);
        if (seen.has(t.nr)) fail(409, `Tisch ${t.nr} gibt es doppelt – jede Nummer nur einmal vergeben`);
        seen.add(t.nr);
        if (!isInt(t.seats, 1, 99)) fail(400, `Tisch ${t.nr}: Sitzplätze zwischen 1 und 99 angeben`);
        const tn = cleanText(t.name, 20); // z. B. „Stammtisch“ – sonst heißt er „Tisch <Nr.>“
        return { nr: t.nr, seats: t.seats, ...(tn ? { name: tn } : {}) };
      }).sort((x, y) => x.nr - y.nr);
      return { id: typeof a.id === 'string' && /^\w{1,24}$/.test(a.id) ? a.id : newId('a'), name, tables };
    });
    if (!seen.size) fail(400, 'Bitte mindestens einen Tisch anlegen');
    const lost = [...new Set(state.orders.filter(o => o.table && !o.paid && !o.cancelled && !seen.has(o.table)).map(o => o.table))];
    if (lost.length) fail(409, `Tisch ${lost.join(', ')} hat noch offene Bestellungen und kann nicht entfernt werden`);
    commit([{ type: 'layout.saved', data: { areas } }], actor);
    return { layout: state.layout };
  }

  // Kassenabschluss: Wechselgeld zu Beginn und gezähltes Bargeld am Ende festhalten
  function cashCount(actor, b) {
    need(actor, '*');
    if (!isInt(b.float, 0, 10000000) || !isInt(b.counted, 0, 100000000)) fail(400, 'Bitte gültige Beträge eingeben');
    commit([{ type: 'cash.counted', data: { float: b.float, counted: b.counted, note: cleanText(b.note, 200) } }], actor);
    return { cash: state.cash[state.days.length] };
  }

  function startDay(actor, b) {
    need(actor, '*');
    const label = cleanText(b.label, 60) || `Festtag ${new Date().toLocaleDateString('de-DE')}`;
    commit([{ type: 'day.started', data: { label } }], actor);
    return { day: state.days[state.days.length - 1] };
  }

  // Preisliste: Vorschau, was sich ändern würde – Abgleich über den Namen (ohne Groß-/Kleinschreibung).
  // Bestehende Produkte werden aktualisiert (ID bleibt, Auswertung bleibt zusammenhängend), fehlende
  // angelegt, alle übrigen aktiven Produkte (auch alte Pfand-Felder) deaktiviert.
  function priceListPlan() {
    const key = n => n.toLowerCase();
    const listed = new Set(PRICE_LIST.map(([n]) => key(n)));
    const items = PRICE_LIST.map(([name, price, cat, station]) => {
      const old = state.products.find(p => p.active && key(p.name) === key(name)) || state.products.find(p => key(p.name) === key(name));
      const same = old && old.active && old.price === price && old.cat === cat && old.station === station && old.name === name;
      return { name, price, cat, station, id: old?.id || null, oldPrice: old?.price ?? null,
        change: !old ? 'neu' : same ? 'gleich' : old.price !== price ? 'preis' : 'geaendert' };
    });
    const off = state.products.filter(p => p.active && !listed.has(key(p.name)));
    return { title: TITLE, items, deactivate: off.map(({ id, name, price }) => ({ id, name, price })) };
  }

  function applyPriceList(actor) {
    need(actor, '*');
    const plan = priceListPlan();
    const entries = [
      ...plan.items.filter(i => i.change !== 'gleich').map(({ id, name, price, cat, station }) => (
        { type: 'product.saved', data: { id: id || newId('p'), name, price, cat, station, active: true } })),
      ...plan.deactivate.map(({ id }) => ({ type: 'product.saved', data: { ...state.products.find(p => p.id === id), active: false } })),
    ];
    if (entries.length) commit(entries, actor);
    const count = c => plan.items.filter(i => i.change === c).length;
    return { added: count('neu'), updated: count('preis') + count('geaendert'), unchanged: count('gleich'), deactivated: plan.deactivate.length };
  }

  // Protokolleintrag ohne fachliche Wirkung (Anmeldungen, PIN-Änderungen)
  const audit = (actor, type, data) => { commit([{ type, data }], actor); };

  function seed(version) {
    const entries = [];
    if (!state.products.length) {
      PRICE_LIST.forEach(([name, price, cat, station]) => entries.push({ type: 'product.saved', data: { id: newId('p'), name, price, cat, station, active: true } }));
    }
    if (!state.days.length) entries.push({ type: 'day.started', data: { label: `Festtag ${new Date().toLocaleDateString('de-DE')}` } });
    entries.push({ type: 'system.started', data: { version } });
    commit(entries, SYSTEM);
  }

  return { createOrder, setStatus, cancelOrder, cancelItem, payTable, moveTable, kasseSale, saveProduct, setAvailability, saveLayout, cashCount, startDay, priceListPlan, applyPriceList, audit, seed };
}

module.exports = { createCommands };
