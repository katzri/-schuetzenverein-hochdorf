// Rechnung eines Tisches: alles zusammen, pro Platz oder frei getrennt zahlen, Rückgeld, Storno einzelner
// Positionen, Zwischenrechnung und Beleg drucken, Tisch umsetzen.
import { $, esc, nb, setHtml, eur, parseEur, api, live, toast, ask, uid, printDoc, tableName, GIVEN } from './core.js';

export function billView(root, { table, onClose, onOrder }) {
  let st = { orders: [] }, split = false, given = null, busy = false, closed = false;
  const sel = new Map(); // getrennt zahlen: Zeile → gewählte Stückzahl

  root.innerHTML = `<div class="w-head"><button class="small" data-close>← Tischplan</button><div class="w-title">${esc(tableName(table))} · Rechnung</div>
      <button class="small" data-order>＋ Nachbestellen</button></div>
    <div class="seg2"><button data-mode="all">Alles zusammen</button><button data-mode="split">Getrennt zahlen</button></div>
    <div class="cart" id="b-lines"></div>
    <div class="paybox"><div class="row"><span id="b-sumlabel"></span><b id="b-sum"></b></div>
      <div class="given" id="b-given"></div>
      <input id="b-custom" class="field" inputmode="decimal" autocomplete="off" placeholder="Anderer Betrag gegeben, z. B. 23,50">
      <div class="row" id="b-change" hidden><span></span><b></b></div></div>
    <button class="btn" id="b-pay"></button>
    <div class="toolbar bill-tools"><button class="small" data-print>🖨 Zwischenrechnung</button><button class="small" data-move>⇄ Tisch umsetzen</button>
      <button class="small" data-house>🎁 Aufs Haus</button></div>`;
  const el = id => $(`#${id}`, root);

  // Gleiche Artikel aus mehreren Bestellrunden werden zu einer Zeile zusammengefasst
  function rows() {
    const m = new Map();
    st.orders.filter(o => o.table === table && !o.paid && !o.cancelled).forEach(o => o.items.forEach((i, idx) => {
      const rem = i.qty - (i.paid || 0);
      if (rem <= 0) return;
      const seat = i.seat || 0;
      const key = `${seat}|${i.name}|${i.price}`;
      const r = m.get(key) || { key, seat, name: i.name, price: i.price, rem: 0, parts: [] };
      r.rem += rem;
      r.parts.push({ order: o, idx, rem, item: i });
      m.set(key, r);
    }));
    // nach Platz sortiert; was für den ganzen Tisch bestellt wurde, steht am Ende
    return [...m.values()].sort((a, b) => (a.seat || 1e9) - (b.seat || 1e9));
  }
  const seatLabel = n => (n ? `Platz ${n}` : 'Ganzer Tisch');
  const qtyOf = r => (split ? Math.min(sel.get(r.key) || 0, r.rem) : r.rem);
  const total = rs => rs.reduce((s, r) => s + qtyOf(r) * r.price, 0);
  const givenAmount = sum => (given === 'exact' ? sum : given);

  function render(state) {
    st = state;
    if (closed) return;
    if (!rows().length) { close(); return; } // z. B. von einem anderen Gerät abgerechnet
    draw();
  }

  function draw() {
    const rs = rows(), sum = total(rs), all = rs.reduce((s, r) => s + r.rem * r.price, 0);
    root.querySelectorAll('[data-mode]').forEach(b => b.classList.toggle('on', (b.dataset.mode === 'split') === split));
    const bySeat = rs.some(r => r.seat);
    const head = (r, i) => (bySeat && (!i || rs[i - 1].seat !== r.seat)
      ? `<div class="row seat-h"><b>${seatLabel(r.seat)}</b><span>${eur(rs.filter(x => x.seat === r.seat).reduce((s, x) => s + x.rem * x.price, 0))}
          <button class="chip-btn pay" data-payseat="${r.seat}">kassieren</button></span></div>` : '');
    setHtml(el('b-lines'), rs.map((r, i) => `${head(r, i)}<div class="row ${split && qtyOf(r) ? 'sel' : ''}">
        <span class="grow" ${split ? `data-inc="${esc(r.key)}"` : ''}>${r.rem}× ${esc(nb(r.name))}<small>à ${eur(r.price)} · ${eur(r.rem * r.price)}</small></span>
        ${split
          ? `<span class="q"><button class="qbtn" data-dec="${esc(r.key)}" aria-label="weniger">−</button><b>${qtyOf(r)}</b><button class="qbtn" data-inc="${esc(r.key)}" aria-label="mehr">+</button></span>`
          : `<span><button class="chip-btn" data-void="${esc(r.key)}">1× Storno</button></span>`}</div>`).join('')
      + `<div class="row total"><b>${split ? 'Tisch gesamt' : 'Summe'}</b><b>${eur(all)}</b></div>`);
    const one = paySeats(rs);
    el('b-sumlabel').textContent = !split ? 'Zu kassieren' : one.length === 1 && bySeat ? `${seatLabel(one[0])} zahlt` : 'Dieser Gast zahlt';
    el('b-sum').textContent = eur(sum);
    const custom = el('b-custom').value.trim();
    setHtml(el('b-given'), GIVEN.map(([l, v]) => `<button data-given="${v}" class="${!custom && String(given) === String(v) ? 'on' : ''}">${l}</button>`).join(''));
    const g = givenAmount(sum), show = sum > 0 && g !== null && !Number.isNaN(g);
    const diff = show ? g - sum : 0;
    el('b-change').hidden = !show;
    el('b-change').className = `row ${diff < 0 ? 'neg' : ''}`;
    el('b-change').firstElementChild.textContent = diff < 0 ? 'Fehlt noch' : 'Rückgeld';
    el('b-change').lastElementChild.textContent = eur(Math.abs(diff));
    const b = el('b-pay');
    b.disabled = busy || !sum || diff < 0;
    b.textContent = !sum ? 'Positionen für diesen Gast antippen' : diff < 0 ? 'Gegebener Betrag reicht nicht' : `${eur(sum)} kassiert ✓`;
  }

  function close() { if (!closed) { closed = true; onClose(); } }

  // Plätze, von denen gerade etwas kassiert wird (genau einer = Rechnung für diesen Platz)
  const paySeats = rs => [...new Set(rs.filter(r => qtyOf(r)).map(r => r.seat))];
  const seatTitle = rs => { const p = paySeats(rs); return split && p.length === 1 && p[0] ? ` · Platz ${p[0]}` : ''; };

  function billRows(rs) {
    const many = paySeats(rs).length > 1;
    return [...rs.filter(r => qtyOf(r)).map(r => [`${qtyOf(r)}× ${r.name}${many && r.seat ? ` (Pl. ${r.seat})` : ''}`, eur(qtyOf(r) * r.price)]), ['', '', 'line'], ['Summe', eur(total(rs)), 'b']];
  }

  // Gewählte Stückzahlen auf die einzelnen Bestellrunden verteilen (älteste zuerst)
  const linesOf = rs => rs.flatMap(r => {
    let n = qtyOf(r);
    return r.parts.map(p => { const q = Math.min(n, p.rem); n -= q; return q ? { orderId: p.order.id, idx: p.idx, qty: q } : null; }).filter(Boolean);
  });

  // Freiverzehr (Helfer, Musik …): nichts kassieren, aber mit Angabe für wen in der Auswertung festhalten
  async function house() {
    const rs = rows(), amount = total(rs);
    if (busy) return;
    if (!amount) { toast('Erst die Positionen antippen, die aufs Haus gehen', { kind: 'warn' }); return; }
    const reason = await ask({ title: `${eur(amount)} aufs Haus?`, ok: 'Aufs Haus buchen',
      text: `${rs.filter(r => qtyOf(r)).map(r => `${qtyOf(r)}× ${r.name}`).join(', ')}\n\nEs wird kein Geld kassiert. Die Buchung steht mit diesem Gerät in der Auswertung.`,
      input: { placeholder: 'Für wen? z. B. Helfer, Musik', required: true, max: 60 } });
    if (!reason) return;
    try {
      const r = await api('POST', `/api/tables/${table}/pay`, { cid: uid(), expected: amount, lines: linesOf(rs), house: true, reason });
      toast(`🎁 ${eur(amount)} aufs Haus (${reason})${r.left ? ` · noch offen ${eur(r.left)}` : ''}`, { ms: 5000 });
      sel.clear();
      if (!r.left) close();
    } catch (e) { toast(e.message, { kind: 'error', ms: 7000 }); }
    if (!closed) draw();
  }

  async function pay() {
    const rs = rows(), amount = total(rs);
    if (!amount || busy) return;
    const lines = linesOf(rs);
    const g = givenAmount(amount);
    const receipt = { title: `Beleg ${tableName(table)}${seatTitle(rs)}`, rows: [...billRows(rs),
      ...(g !== null && !Number.isNaN(g) && g !== amount ? [['Gegeben', eur(g)], ['Rückgeld', eur(g - amount)]] : []),
      ['', '', 'line'], ['Vielen Dank für Ihren Besuch!', '', 'c']] };
    busy = true;
    draw();
    try {
      const r = await api('POST', `/api/tables/${table}/pay`, { cid: uid(), expected: amount, lines });
      toast(`✓ ${tableName(table)}${seatTitle(rs)}: ${eur(amount)} kassiert${r.left ? ` · noch offen ${eur(r.left)}` : ''}`, { action: '🖨 Beleg', onAction: () => printDoc(receipt), ms: 7000 });
      sel.clear();
      given = null;
      el('b-custom').value = '';
      if (!r.left) close();
    } catch (e) { toast(e.message, { kind: 'error', ms: 7000 }); }
    busy = false;
    if (!closed) draw();
  }

  async function voidOne(key) {
    const r = rows().find(x => x.key === key);
    if (!r) return;
    const p = r.parts[r.parts.length - 1]; // die zuletzt bestellte Runde
    const reason = await ask({ title: `1× ${r.name} stornieren?`, text: `${tableName(table)}${r.seat ? ` · Platz ${r.seat}` : ''} · Nr. ${p.order.nr} · ${eur(r.price)}`, ok: 'Stornieren', danger: true,
      input: { placeholder: 'Grund (optional), z. B. vertippt' } });
    if (reason === false) return;
    try {
      await api('POST', `/api/orders/${p.order.id}/items/cancel`, { idx: p.idx, qty: 1, reason });
      toast(`1× ${r.name} storniert`);
    } catch (e) { toast(e.message, { kind: 'error', ms: 7000 }); }
  }

  // Tische mit Namen haben trotzdem eine Nummer – beim Umsetzen dazusagen
  const named = () => { const n = (live.state.layout?.areas || []).flatMap(a => a.tables).filter(t => t.name).map(t => `${t.name} = ${t.nr}`); return n.length ? `\n${n.join(', ')}` : ''; };

  async function move() {
    const to = await ask({ title: `${tableName(table)} umsetzen`, text: `Alle offenen Bestellungen wandern an den neuen Tisch.${named()}`, ok: 'Umsetzen',
      input: { placeholder: 'Neue Tischnummer', numeric: true, required: true, max: 3 } });
    if (!to) return;
    try {
      await api('POST', `/api/tables/${table}/move`, { to: Number(to) });
      toast(`${tableName(table)} → ${tableName(to)} umgesetzt`);
      close();
    } catch (e) { toast(e.message, { kind: 'error', ms: 7000 }); }
  }

  root.onclick = e => {
    const t = e.target.closest('[data-inc],button');
    if (!t) return;
    const d = t.dataset;
    if ('close' in d) close();
    else if ('order' in d) { closed = true; onOrder(); }
    else if (d.mode) { split = d.mode === 'split'; sel.clear(); draw(); }
    else if (d.payseat) { split = true; sel.clear(); rows().filter(r => r.seat === Number(d.payseat)).forEach(r => sel.set(r.key, r.rem)); draw(); }
    else if (d.inc) { const r = rows().find(x => x.key === d.inc); if (r) { sel.set(r.key, Math.min(r.rem, (sel.get(r.key) || 0) + 1)); draw(); } }
    else if (d.dec) { sel.set(d.dec, Math.max(0, (sel.get(d.dec) || 0) - 1)); draw(); }
    else if (d.given) { given = d.given === 'exact' ? 'exact' : Number(d.given); el('b-custom').value = ''; draw(); }
    else if (d.void) voidOne(d.void);
    else if ('print' in d) { const rs = rows(); if (total(rs)) printDoc({ title: `${tableName(table)}${seatTitle(rs)} – Zwischenrechnung`, sub: 'Noch nicht bezahlt', rows: billRows(rs) }); }
    else if ('move' in d) move();
    else if ('house' in d) house();
    else if (t.id === 'b-pay') pay();
  };
  el('b-custom').oninput = e => { const v = e.target.value.trim(); given = v ? parseEur(v) : null; draw(); };

  return { render };
}
