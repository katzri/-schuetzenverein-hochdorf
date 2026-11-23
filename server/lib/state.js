'use strict';
// Baut aus den Journal-Ereignissen den aktuellen Zustand: Tischplan, Produkte (mit Bestand),
// Bestellungen des laufenden Festtags, alle Zahlungen, Stornos und das Anmeldeprotokoll.
// Dazu die Verkaufsauswertung mit Bedienungs-Abrechnung und Kassenabschluss.

const RECENT_MS = 60 * 60e3;
const ACCESS_TYPES = ['access.login', 'access.failed', 'access.locked', 'access.logout', 'access.changed'];
// Platzbelegungsplan des Schützenhauses (64 Plätze, fortlaufend nummeriert: Tisch 1 = Platz 1–5 …
// Einzelplätze = 63/64). Gilt, solange in der Verwaltung kein anderer Tischplan gespeichert wurde.
const DEFAULT_LAYOUT = { areas: [{ id: 'a1', name: 'Schützenhaus', tables: [
  ...[5, 5, 5, 5, 7, 8, 8].map((seats, i) => ({ nr: i + 1, seats })),
  { nr: 8, seats: 11, name: 'Stammtisch' }, { nr: 9, seats: 8, name: 'Dachs' }, { nr: 10, seats: 2, name: 'Einzelplätze' },
] }] };

const createState = () => ({
  nextNr: 1, orders: [], products: [], payments: [], days: [], access: [], starts: [], cids: new Map(),
  layout: structuredClone(DEFAULT_LAYOUT), voids: [], cash: {},
});
const orderTotal = o => o.items.reduce((s, i) => s + i.price * i.qty, 0);
const paidAmount = o => o.items.reduce((s, i) => s + i.price * (i.paid || 0), 0);
const openAmount = o => orderTotal(o) - paidAmount(o);
// Tatsächlich kassiertes Geld – ohne das, was „aufs Haus“ ging (free)
const cashPaid = o => o.items.reduce((s, i) => s + i.price * ((i.paid || 0) - (i.free || 0)), 0);
const isDone = o => Object.values(o.parts).every(p => p.status === 'abgeholt');
const findOrder = (s, id) => s.orders.find(o => o.id === id);
const tableOf = (s, nr) => s.layout.areas.flatMap(a => a.tables).find(t => t.nr === nr) || null;
// Plätze sind über den ganzen Plan fortlaufend nummeriert: erster und letzter Platz eines Tisches
function seatsOf(s, nr) {
  let from = 1;
  for (const t of s.layout.areas.flatMap(a => a.tables)) {
    if (t.nr === nr) return { from, to: from + t.seats - 1 };
    from += t.seats;
  }
  return null;
}
const refreshPaid = o => { o.paid = o.items.every(i => (i.paid || 0) >= i.qty); };

// Bestand mitzählen (nur bei Produkten mit begrenzter Stückzahl); 0 = automatisch ausverkauft
function adjustStock(s, pid, delta) {
  const p = s.products.find(x => x.id === pid);
  if (!p || p.stock === null || p.stock === undefined) return;
  p.stock = Math.max(0, p.stock + delta);
  if (p.stock === 0) p.soldOut = true;
  else if (delta > 0) p.soldOut = false;
}

function voidItem(s, e, o, item, qty, reason) {
  if (qty > 0) {
    s.voids.push({ ts: e.ts, by: e.by, day: s.days.length, nr: o.nr, table: o.table, name: o.name,
      item: item.name, price: item.price, qty, amount: item.price * qty, reason: reason || '' });
  }
}

function apply(s, e) {
  const d = e.data;
  switch (e.type) {
    case 'day.started':
      s.days.push({ nr: s.days.length + 1, label: d.label, ts: e.ts, by: e.by });
      s.orders = [];
      s.nextNr = 1;
      break;
    case 'layout.saved':
      s.layout = structuredClone(d);
      break;
    case 'product.saved': {
      const i = s.products.findIndex(p => p.id === d.id);
      const old = i >= 0 ? s.products[i] : null;
      const p = { soldOut: old?.soldOut || false, stock: old?.stock ?? null, ...d };
      if (i >= 0) s.products[i] = p; else s.products.push(p);
      break;
    }
    case 'product.availability': {
      const p = s.products.find(x => x.id === d.id);
      if (p) { p.soldOut = Boolean(d.soldOut); p.stock = d.stock ?? null; }
      break;
    }
    case 'order.created': {
      const o = structuredClone(d);
      Object.values(o.parts).forEach(p => { p.t = e.ts; });
      o.items.forEach(i => { i.paid = 0; adjustStock(s, i.pid, -i.qty); });
      Object.assign(o, { createdAt: e.ts, by: e.by, paid: false, cancelled: null });
      s.orders.push(o);
      s.nextNr = o.nr + 1;
      if (o.cid) s.cids.set(o.cid, { order: o.id });
      break;
    }
    case 'order.status': {
      const o = findOrder(s, d.id);
      if (o && o.parts[d.station]) o.parts[d.station] = { status: d.status, t: e.ts };
      break;
    }
    case 'order.cancelled': {
      const o = findOrder(s, d.id);
      if (!o) break;
      o.items.forEach(i => { voidItem(s, e, o, i, i.qty - (i.paid || 0), d.reason); adjustStock(s, i.pid, i.qty); });
      o.cancelled = { ts: e.ts, by: e.by, reason: d.reason };
      break;
    }
    // Einzelne (noch nicht bezahlte) Position stornieren
    case 'order.item.cancelled': {
      const o = findOrder(s, d.id);
      const it = o?.items[d.idx];
      if (!it) break;
      voidItem(s, e, o, it, d.qty, d.reason);
      it.qty -= d.qty;
      adjustStock(s, it.pid, d.qty);
      // Hat eine Station nichts mehr zu tun, gilt ihr Teil als erledigt
      for (const st of Object.keys(o.parts)) {
        if (!o.items.some(i => i.station === st && i.qty > 0)) o.parts[st] = { status: 'abgeholt', t: e.ts };
      }
      refreshPaid(o);
      break;
    }
    case 'table.moved':
      s.orders.filter(o => o.table === d.from && !o.paid && !o.cancelled).forEach(o => {
        o.table = d.to;
        o.items.forEach(i => { delete i.seat; }); // Platznummern gelten nur am alten Tisch
      });
      break;
    case 'payment.recorded':
    case 'payment.refunded': {
      const p = { ...structuredClone(d), ts: e.ts, by: e.by, day: s.days.length };
      s.payments.push(p);
      if (e.type === 'payment.recorded') {
        if (d.lines) {
          // Teilzahlung („getrennt zahlen“): genau diese Stückzahlen sind bezahlt
          d.lines.forEach(l => {
            const o = findOrder(s, l.orderId), it = o?.items[l.idx];
            if (!it) return;
            const n = Math.min(l.qty, it.qty - (it.paid || 0));
            it.paid = (it.paid || 0) + n;
            if (d.kind === 'haus') it.free = (it.free || 0) + n; // erledigt, aber ohne Geld
            refreshPaid(o);
          });
        } else {
          (d.orderIds || []).forEach(id => {
            const o = findOrder(s, id);
            if (o) { o.items.forEach(i => { i.paid = i.qty; }); o.paid = true; }
          });
        }
        (d.pids || []).forEach(x => adjustStock(s, x.pid, -x.qty));
      }
      if (d.cid) s.cids.set(d.cid, { payment: p.id });
      break;
    }
    case 'cash.counted':
      s.cash[s.days.length] = { ...d, ts: e.ts, by: e.by };
      break;
    case 'system.started':
      s.starts.push(e.ts);
      break;
    default:
      if (ACCESS_TYPES.includes(e.type)) s.access.push({ type: e.type, ts: e.ts, by: e.by, ...d });
  }
  return s;
}

// Was die Geräte live sehen: Tischplan, Produkte und die noch relevanten Bestellungen des Festtags
function publicState(s) {
  const t = Date.now();
  const show = o => (o.cancelled
    ? t - o.cancelled.ts < RECENT_MS
    : !isDone(o) || (o.table && !o.paid) || t - o.createdAt < RECENT_MS);
  return { nextNr: s.nextNr, day: s.days[s.days.length - 1] || null, layout: s.layout, products: s.products, orders: s.orders.filter(show) };
}

function salesReport(s, dayNr) {
  const day = s.days.find(d => d.nr === dayNr) || s.days[s.days.length - 1] || null;
  const pays = day ? s.payments.filter(p => p.day === day.nr) : [];
  const sum = list => list.reduce((a, p) => a + p.amount, 0);
  const byKind = {};
  for (const k of ['tisch', 'abholung', 'kasse', 'storno', 'haus']) {
    const list = pays.filter(p => p.kind === k);
    byKind[k] = { count: list.length, amount: sum(list) };
  }
  const products = new Map(), hours = new Map(), staff = new Map(), free = new Map();
  for (const p of pays) {
    // „Aufs Haus“ (Helfer, Musik …) ist kein Umsatz: eigene Liste, zählt nicht zu den verkauften Produkten
    const into = p.kind === 'haus' ? free : products;
    for (const i of p.items) {
      const k = `${i.name}|${i.price}`;
      const r = into.get(k) || { name: i.name, price: i.price, qty: 0, amount: 0 };
      r.qty += i.qty;
      r.amount += i.qty * i.price;
      into.set(k, r);
    }
    // Wer hat wie viel kassiert – Grundlage für die Abrechnung der Geldbeutel
    const k = `${p.by?.role}|${p.by?.device}`;
    const w = staff.get(k) || { role: p.by?.role || 'system', device: p.by?.device || '', count: 0, amount: 0, refunds: 0, house: 0 };
    staff.set(k, w);
    if (p.kind === 'haus') { w.house += p.value || 0; continue; }
    const h = new Date(p.ts).getHours();
    hours.set(h, (hours.get(h) || 0) + p.amount);
    if (p.kind === 'storno') w.refunds += p.amount; else w.count++;
    w.amount += p.amount;
  }
  const houseList = [...free.values()].sort((a, b) => b.amount - a.amount);
  const open = new Map();
  if (day && day.nr === s.days.length) {
    s.orders.filter(o => o.table && !o.paid && !o.cancelled)
      .forEach(o => open.set(o.table, (open.get(o.table) || 0) + openAmount(o)));
  }
  const voids = day ? s.voids.filter(v => v.day === day.nr) : [];
  return {
    day, days: s.days.map(({ nr, label, ts }) => ({ nr, label, ts })),
    revenue: sum(pays), payments: pays.length - byKind.storno.count - byKind.haus.count, byKind,
    house: { count: byKind.haus.count, amount: houseList.reduce((a, r) => a + r.amount, 0), products: houseList },
    products: [...products.values()].filter(r => r.qty !== 0).sort((a, b) => b.amount - a.amount),
    hours: [...hours].sort((a, b) => a[0] - b[0]).map(([hour, amount]) => ({ hour, amount })),
    staff: [...staff.values()].sort((a, b) => b.amount - a.amount),
    voids: voids.slice().reverse(), voidAmount: voids.reduce((a, v) => a + v.amount, 0),
    cash: (day && s.cash[day.nr]) || null,
    openTables: [...open].sort((a, b) => a[0] - b[0]).map(([table, amount]) => ({ table, amount })),
    log: pays.slice().reverse(),
  };
}

module.exports = { createState, apply, publicState, salesReport, orderTotal, paidAmount, cashPaid, openAmount, isDone, findOrder, tableOf, seatsOf, DEFAULT_LAYOUT };
