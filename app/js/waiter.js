// Bedienung: Tischplan mit Status, Bestellung aufnehmen (pro Platz, mit Hinweis pro Position), Abholung,
// Status verfolgen, stornieren. Die Rechnung eines Tisches (auch getrennt zahlen) steckt in bill.js.
import { $, esc, nb, plural, setHtml, eur, api, live, outbox, local, toast, ask, uid, signal, isDone, labelOf, tableName, seatRange, seatNumbers, timeOf, openAmount, itemText, now, GIVEN, STATIONS, STATUS, CATS, CAT_ICONS } from './core.js';
import { billView } from './bill.js';

const PICKUP = 'abholung';
const SEEN = 'svh-ready-seen'; // schon gemeldete „fertig“-Teile – bleibt auf dem Gerät, gilt auch nach Neuladen
const NEWS_MS = 30 * 60e3;     // was länger fertig ist, wird nicht mehr als Neuigkeit gemeldet

export function waiterView(root, me) {
  let st = { orders: [], products: [], layout: { areas: [] } };
  let screen = 'plan', table = null, cart = [], given = null, cat = 'alle', bill = null, seat = null; // seat: gewählter Platz, null = ganzer Tisch
  let onlyMine = local.get('svh-only-mine', false);
  let readySeen = null, savedSeen = null; // schon gemeldete „fertig“-Teile, damit jede Abholung nur einmal klingelt
  let news = [], newsToast = null;        // gerade angezeigter Abhol-Hinweis: kommt etwas dazu, wird er ergänzt statt gestapelt
  const isMine = o => o.by?.device === me.device && o.by?.role === me.role;

  root.innerHTML = `<section class="panel"><div class="narrow">
    <div id="w-plan">
      <div id="w-areas"></div>
      <button class="btn sec" data-table="${PICKUP}">🛍️ Abholung (sofort bezahlen)</button>
      <div class="row-head"><h2>Offene Bestellungen</h2><label class="check"><input type="checkbox" id="w-mine"> nur meine</label></div>
      <div id="w-orders"></div>
    </div>
    <div id="w-order" hidden>
      <div class="w-head"><button class="small" data-back>← Tischplan</button><div class="w-title" id="w-title"></div></div>
      <input id="w-name" class="field strong" maxlength="40" autocomplete="off" placeholder="Name für die Abholung, z. B. Müller" hidden>
      <div id="w-tablesum"></div>
      <div class="seatbar" id="w-seats"></div>
      <div class="catbar" id="w-cats"></div>
      <div id="w-tiles"></div>
      <div class="cart" id="w-cart"></div>
      <div class="paybox" id="w-pay" hidden></div>
      <textarea id="w-note" class="field" rows="2" maxlength="200" placeholder="Hinweis für die ganze Bestellung, z. B. „alles zusammen bringen“"></textarea>
      <button class="btn" id="w-send"></button>
    </div>
    <div id="w-bill" hidden></div>
  </div></section>`;
  const el = id => $(`#${id}`, root);

  const products = () => st.products.filter(p => p.active);
  const byId = pid => products().find(p => p.id === pid);
  const cartTotal = () => cart.reduce((s, l) => s + (byId(l.pid)?.price ?? 0) * l.qty, 0);
  const cartQty = pid => cart.filter(l => l.pid === pid).reduce((s, l) => s + l.qty, 0);
  const change = () => (given === null ? 0 : (given === 'exact' ? cartTotal() : given) - cartTotal());
  const tables = () => (st.layout?.areas || []).flatMap(a => a.tables);
  const seatsOf = n => tables().find(t => t.nr === n)?.seats;
  function destination() {
    if (table === PICKUP) { const name = el('w-name').value.trim(); return name ? { name } : null; }
    return table ? { table } : null;
  }
  // Zustand eines Tisches für den Plan: offen, wie lange schon, wartet auf etwas, etwas abholbereit
  function tableInfo(n) {
    const orders = st.orders.filter(o => o.table === n && !o.cancelled);
    const open = orders.filter(o => !o.paid), active = orders.filter(o => !isDone(o));
    const has = (...s) => active.some(o => Object.values(o.parts).some(p => s.includes(p.status)));
    return { busy: open.length > 0, amount: open.reduce((s, o) => s + openAmount(o), 0),
      since: open.length ? Math.min(...open.map(o => o.createdAt)) : null, ready: has('fertig'), waiting: has('neu', 'arbeit') };
  }
  const duration = ts => { const m = Math.max(0, Math.floor((now() - ts) / 60000)); return m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min`; };

  function render(state) {
    st = state;
    cart = cart.filter(l => byId(l.pid)); // inzwischen deaktivierte Produkte aus dem Warenkorb nehmen
    notifyReady();
    if (screen === 'bill') bill?.render(st);
    draw();
  }

  // Küche/Theke meldet „fertig“ → die Bedienung, die bestellt hat, bekommt Ton, Vibration und EINEN Hinweis.
  // Jeder Teil wird genau einmal gemeldet – auch wenn die Seite neu lädt oder die Verbindung kurz weg war.
  // Steckt das Handy in der Tasche (Seite unsichtbar), wird gesammelt und beim Aufwecken einmal gemeldet.
  function notifyReady() {
    if (!live.loaded || document.hidden) return; // ohne echte Server-Daten nichts merken, sonst käme später alles Alte auf einmal
    const ready = st.orders.filter(o => !o.cancelled).flatMap(o => Object.entries(o.parts).filter(([, p]) => p.status === 'fertig').map(([s, p]) => ({ o, s, t: p.t, key: `${o.id}|${s}` })));
    if (!readySeen) { const stored = local.get(SEEN); readySeen = Array.isArray(stored) ? new Set(stored) : null; }
    // allererster Start auf diesem Gerät: was schon dasteht, still übernehmen
    const fresh = readySeen ? ready.filter(r => !readySeen.has(r.key) && isMine(r.o) && now() - r.t < NEWS_MS) : [];
    readySeen = new Set(ready.map(r => r.key));
    const keys = [...readySeen].join();
    if (keys !== savedSeen) { local.set(SEEN, [...readySeen]); savedSeen = keys; }
    if (!fresh.length) return;
    const at = Date.now(), where = r => `${labelOf(r.o)} · Nr. ${r.o.nr}`;
    news = [...news.filter(n => at - n.at < 9000 && readySeen.has(n.r.key)), ...fresh.map(r => ({ r, at }))];
    const list = news.map(n => n.r);
    newsToast?.remove();
    newsToast = toast(list.length === 1
      ? `🔔 ${where(list[0])}: ${STATIONS[list[0].s]} fertig – bitte abholen`
      : `🔔 ${list.length}× fertig – bitte abholen: ${list.slice(0, 3).map(r => `${where(r)} (${STATIONS[r.s]})`).join(', ')}${list.length > 3 ? ` und ${list.length - 3} weitere` : ''}`, { ms: 9000 });
    signal();
  }
  const onVisible = () => notifyReady();
  document.addEventListener('visibilitychange', onVisible);

  // „Nochmal dasselbe“: die letzte Bestellrunde dieses Tisches in die Auswahl legen (Plätze bleiben)
  function repeatRound() {
    const last = st.orders.filter(o => o.table === table && !o.cancelled).sort((a, b) => b.createdAt - a.createdAt)[0];
    const nums = seatNumbers(table, st.layout);
    const items = (last?.items || []).filter(i => i.qty > 0);
    const ok = items.filter(i => byId(i.pid) && !byId(i.pid).soldOut);
    if (!ok.length) { toast('Die letzte Runde ist nicht mehr im Angebot', { kind: 'warn' }); return; }
    ok.forEach(i => cart.push({ pid: i.pid, qty: i.qty, note: i.note || '', seat: nums.includes(i.seat) ? i.seat : null }));
    mergeCart();
    toast(ok.length < items.length ? 'Letzte Runde übernommen – ein Teil ist ausverkauft' : 'Letzte Runde übernommen – prüfen und senden', { kind: ok.length < items.length ? 'warn' : '' });
    renderForm();
  }

  function draw() {
    el('w-plan').hidden = screen !== 'plan';
    el('w-order').hidden = screen !== 'order';
    el('w-bill').hidden = screen !== 'bill';
    if (screen === 'plan') { renderPlan(); renderOrders(); }
    if (screen === 'order') renderForm();
  }

  function renderPlan() {
    const all = tables().map(t => tableInfo(t.nr));
    const busy = all.filter(i => i.busy);
    setHtml(el('w-areas'), `<div class="plan-sum"><span><b>${busy.length}</b> von ${all.length} Tischen besetzt</span><span>offen <b>${eur(busy.reduce((s, i) => s + i.amount, 0))}</b></span></div>`
      + (st.layout?.areas || []).map(a => `<h2>${esc(a.name)} <span class="muted">· ${a.tables.reduce((s, t) => s + t.seats, 0)} Plätze</span></h2>
        <div class="plan">${a.tables.map(t => {
          const i = tableInfo(t.nr);
          return `<button data-table="${t.nr}" class="ptile ${i.busy ? 'busy' : ''} ${i.ready ? 'ready' : i.waiting ? 'waiting' : ''}">
            <b class="${t.name ? 'named' : ''}">${esc(t.name || t.nr)}</b><small>${i.ready ? 'abholbereit' : i.waiting ? 'in Arbeit' : seatRange(t.nr, st.layout)}</small>
            ${i.busy ? `<span class="amt">${eur(i.amount)}</span><span class="dur">${duration(i.since)}</span>` : ''}</button>`;
        }).join('')}</div>`).join('')
      + '<div class="legend"><span><i></i>frei</span><span><i class="busy"></i>besetzt</span><span><i class="waiting"></i>in Arbeit</span><span><i class="ready"></i>abholbereit</span></div>');
  }

  function renderForm() {
    const pickup = table === PICKUP;
    setHtml(el('w-title'), pickup ? '🛍️ Abholung' : `${esc(tableName(table))} <small>${seatsOf(table) ? `${seatRange(table, st.layout)} · ${plural(seatsOf(table), 'Platz', 'Plätze')}` : ''}</small>`);
    el('w-name').hidden = !pickup;
    const info = pickup ? null : tableInfo(table);
    setHtml(el('w-tablesum'), info?.busy
      ? `<div class="tablesum"><span>Offen seit ${duration(info.since)}<br><b>${eur(info.amount)}</b></span>
         <span class="ts-btns"><button class="small" data-repeat>↻ Letzte Runde nochmal</button><button class="small strong" data-bill>Rechnung / Kassieren</button></span></div>`
      : '');
    // Platz wählen: alles, was danach angetippt wird, gehört zu diesem Platz
    const nums = pickup ? [] : seatNumbers(table, st.layout);
    if (!nums.includes(seat)) seat = null;
    const openSeats = new Set(st.orders.filter(o => o.table === table && !o.paid && !o.cancelled).flatMap(o => o.items.filter(i => i.seat && i.qty > (i.paid || 0)).map(i => i.seat)));
    el('w-seats').hidden = !nums.length;
    setHtml(el('w-seats'), `<span class="lbl">Für Platz</span><button data-seat="0" class="${seat === null ? 'on' : ''}">Tisch</button>`
      + nums.map(n => `<button data-seat="${n}" class="${seat === n ? 'on' : ''} ${openSeats.has(n) || cart.some(l => l.seat === n) ? 'has' : ''}">${n}</button>`).join(''));
    const cats = Object.keys(CATS).filter(c => products().some(p => p.cat === c));
    if (cat !== 'alle' && !cats.includes(cat)) cat = 'alle';
    setHtml(el('w-cats'), `<button data-cat="alle" class="${cat === 'alle' ? 'on' : ''}">Alle</button>`
      + cats.map(c => `<button data-cat="${c}" class="c-${c} ${cat === c ? 'on' : ''}">${CAT_ICONS[c] || ''} ${CATS[c]}</button>`).join(''));
    setHtml(el('w-tiles'), cats.filter(c => cat === 'alle' || cat === c).map(c => {
      const list = products().filter(p => p.cat === c);
      return `<h2 class="cat-h c-${c}"><span class="ico">${CAT_ICONS[c] || ''}</span>${CATS[c]}</h2><div class="grid">${list.map(p => {
        const q = cartQty(p.id), left = p.stock !== null && p.stock !== undefined ? p.stock : null;
        return `<button class="tile c-${c} ${q ? 'on' : ''} ${p.soldOut ? 'out' : ''}" data-add="${p.id}" ${p.soldOut ? 'disabled' : ''}>
        <span class="name">${esc(nb(p.name))}</span><span class="meta"><span class="price">${eur(p.price)}</span>${p.soldOut ? '<span class="st soldout">ausverkauft</span>'
          : left !== null && left <= 10 ? `<span class="st low">noch ${left}</span>` : p.station ? `<span class="st">${STATIONS[p.station]}</span>` : ''}</span>
        ${q ? `<span class="badge">${q}</span>` : ''}</button>`;
      }).join('')}</div>`;
    }).join('') || '<p class="muted">Noch keine Produkte – bitte in der Verwaltung anlegen.</p>');
    setHtml(el('w-cart'), cart.length
      ? cart.map((l, i) => `<div class="row"><span>${l.qty}× ${esc(nb(byId(l.pid).name))}${l.seat ? `<small class="lseat">Platz ${l.seat}</small>` : ''}${l.note ? `<small class="lnote">✎ ${esc(l.note)}</small>` : ''}</span>
          <span><button class="qbtn note" data-note="${i}" aria-label="Hinweis zu dieser Position">✎</button>
          <button class="qbtn" data-dec="${i}" aria-label="weniger">−</button> <button class="qbtn" data-inc="${i}" aria-label="mehr">+</button></span></div>`).join('')
        + `<div class="row total"><b>Summe</b><b>${eur(cartTotal())}</b></div>`
      : '<div class="muted">Noch keine Produkte ausgewählt. ✎ = Hinweis zu einer Position, z. B. „ohne Zwiebeln“.</div>');
    renderPay(cart.length > 0);
    updateSend();
  }

  function renderPay(hasItems) {
    const box = el('w-pay');
    box.hidden = table !== PICKUP || !hasItems;
    if (box.hidden) return;
    const diff = change();
    setHtml(box, `<div class="row"><span>Abholung – jetzt kassieren</span><b>${eur(cartTotal())}</b></div>
      <div class="given">${GIVEN.map(([l, v]) => `<button data-given="${v}" class="${String(given) === String(v) ? 'on' : ''}">${l}</button>`).join('')}</div>
      ${given !== null ? `<div class="row ${diff < 0 ? 'neg' : ''}"><span>${diff < 0 ? 'Fehlt noch' : 'Rückgeld'}</span><b>${eur(Math.abs(diff))}</b></div>` : ''}`);
  }

  function updateSend() {
    const dest = destination(), n = cart.length, short = table === PICKUP && change() < 0;
    const b = el('w-send');
    b.disabled = !n || !dest || short;
    b.textContent = !dest ? 'Name für die Abholung eingeben'
      : !n ? 'Produkte auswählen'
      : short ? 'Gegebener Betrag reicht nicht'
      : table === PICKUP ? `Kassiert ✓ – ${labelOf(dest)} senden`
      : `Bestellung für ${labelOf(dest)} senden · ${eur(cartTotal())}`;
  }

  function renderOrders() {
    const mine = isMine;
    const ready = o => Object.values(o.parts).some(p => p.status === 'fertig');
    const list = st.orders.filter(o => !o.cancelled && !isDone(o) && (!onlyMine || mine(o)))
      .sort((a, b) => ready(b) - ready(a) || b.createdAt - a.createdAt); // Abholbereites zuerst
    const pending = outbox.list().filter(e => e.url === '/api/orders');
    setHtml(el('w-orders'), pending.map(e => `<div class="my pending">
        <div class="top"><span>⏳ ${esc(e.info.label)}</span><span class="muted">${timeOf(e.ts)}</span></div>
        <div class="muted">${esc(e.info.summary)}</div>
        <div class="chips"><span class="chip st-wait">Auf dem Gerät gesichert – wird automatisch gesendet</span></div></div>`).join('')
      + (list.map(orderCard).join('') || (pending.length ? '' : '<div class="muted">Keine offenen Bestellungen.</div>')));
  }

  function orderCard(o) {
    const ready = Object.values(o.parts).some(p => p.status === 'fertig');
    const untouched = Object.values(o.parts).every(p => p.status === 'neu');
    return `<div class="my ${ready ? 'ready' : ''}">
      <div class="top"><span>${o.name ? '🛍️ ' : ''}${esc(labelOf(o))} · Nr. ${o.nr}${o.name && o.paid ? ' <span class="paid">✓ bezahlt</span>' : ''}</span>
        <span class="muted">${timeOf(o.createdAt)}</span></div>
      <div class="muted">${o.items.filter(i => i.qty > 0).map(i => esc(itemText(i))).join(', ')}</div>
      ${o.note ? `<div class="mnote">⚠ ${esc(o.note)}</div>` : ''}
      <div class="chips">${Object.entries(o.parts).filter(([, p]) => p.status !== 'abgeholt').map(([s, p]) => `<span class="chip st-${p.status}">${STATIONS[s]}: ${STATUS[p.status]}${p.status === 'fertig' ? ` <button data-pick="${o.id}|${s}">abgeholt</button>` : ''}</span>`).join('')}
        ${untouched ? `<button class="chip-btn" data-cancel="${o.id}">Stornieren</button>` : ''}</div>
    </div>`;
  }

  async function send() {
    const dest = destination();
    if (!dest || !cart.length) return;
    const items = cart.map(({ pid, qty, note, seat: s }) => ({ pid, qty, ...(note ? { note } : {}), ...(s ? { seat: s } : {}) }));
    const label = labelOf(dest);
    const summary = cart.map(l => itemText({ ...l, name: byId(l.pid).name })).join(', ');
    el('w-send').disabled = true;
    const r = await outbox.submit('/api/orders', { cid: uid(), ...dest, items, note: el('w-note').value.trim() }, { label, summary });
    if (r.error) { toast(r.error, { kind: 'error', ms: 7000 }); updateSend(); return; }
    cart = [];
    seat = null;
    given = null;
    el('w-note').value = '';
    el('w-name').value = '';
    if (r.sent) toast(`✓ Nr. ${r.result.order?.nr ?? ''} für ${label} gesendet`);
    else toast('Keine Verbindung – die Bestellung ist auf dem Gerät gesichert und wird automatisch gesendet.', { kind: 'warn', ms: 6000 });
    goPlan();
  }

  // Hinweis gilt für EIN Stück: bei mehreren wird eines als eigene Zeile abgetrennt
  async function noteLine(i) {
    const l = cart[i];
    if (!l) return;
    const text = await ask({ title: `Hinweis zu 1× ${byId(l.pid).name}`, text: 'Leer lassen, um den Hinweis zu entfernen.', ok: 'Übernehmen',
      input: { placeholder: 'z. B. ohne Zwiebeln, extra Soße', max: 60 } });
    if (text === false) return;
    if (l.qty > 1 && text && !l.note) { l.qty--; cart.splice(i + 1, 0, { pid: l.pid, qty: 1, note: text, seat: l.seat }); }
    else l.note = text;
    mergeCart();
    renderForm();
  }
  function mergeCart() {
    const out = [];
    for (const l of cart) {
      const same = out.find(x => x.pid === l.pid && x.note === l.note && x.seat === l.seat);
      if (same) same.qty += l.qty; else out.push(l);
    }
    cart = out;
  }

  async function cancel(id) {
    const o = st.orders.find(x => x.id === id);
    if (!o) return;
    const back = o.items.reduce((s, i) => s + i.price * ((i.paid || 0) - (i.free || 0)), 0);
    const reason = await ask({
      title: `Nr. ${o.nr} stornieren?`,
      text: `${labelOf(o)}: ${o.items.map(itemText).join(', ')}${back ? `\n\nBitte ${eur(back)} zurückgeben.` : ''}`,
      ok: 'Stornieren', danger: true, input: { placeholder: 'Grund (optional), z. B. falsch eingegeben' },
    });
    if (reason === false) return;
    try {
      await api('POST', `/api/orders/${id}/cancel`, { reason });
      toast(`Nr. ${o.nr} storniert`);
    } catch (e) { toast(e.message, { kind: 'error', ms: 7000 }); }
  }

  function goPlan() { screen = 'plan'; bill = null; draw(); }
  function openBill() {
    screen = 'bill';
    bill = billView(el('w-bill'), { table, onClose: goPlan, onOrder: () => { screen = 'order'; bill = null; draw(); } });
    bill.render(st);
    draw();
  }

  root.addEventListener('click', async e => {
    const b = e.target.closest('button');
    if (!b || screen === 'bill') return;
    const d = b.dataset;
    if (d.table) {
      const next = d.table === PICKUP ? PICKUP : Number(d.table);
      if (next !== table) { cart = []; seat = null; el('w-note').value = ''; }
      table = next;
      given = null;
      cat = 'alle';
      screen = 'order';
      draw();
      root.querySelector('.panel').scrollTop = 0;
      if (table === PICKUP) el('w-name').focus();
    } else if ('back' in d) goPlan();
    else if ('bill' in d) openBill();
    else if ('repeat' in d) repeatRound();
    else if (d.cat) { cat = d.cat; renderForm(); }
    else if (d.seat) { seat = Number(d.seat) || null; renderForm(); }
    else if (d.given) { given = d.given === 'exact' ? 'exact' : Number(d.given); renderForm(); }
    else if (d.add) {
      const l = cart.find(x => x.pid === d.add && !x.note && x.seat === seat);
      if (l) l.qty++; else cart.push({ pid: d.add, qty: 1, note: '', seat });
      renderForm();
    } else if (d.inc) { cart[d.inc].qty++; renderForm(); }
    else if (d.dec) { if (--cart[d.dec].qty <= 0) cart.splice(d.dec, 1); renderForm(); }
    else if (d.note) noteLine(Number(d.note));
    else if (d.pick) {
      const [id, s] = d.pick.split('|');
      try { await api('POST', `/api/orders/${id}/status`, { station: s, status: 'abgeholt' }); } catch (err) { toast(err.message, { kind: 'error' }); }
    } else if (d.cancel) cancel(d.cancel);
    else if (b.id === 'w-send') send();
  });
  el('w-name').addEventListener('input', updateSend);
  el('w-name').addEventListener('keydown', e => { if (e.key === 'Enter' && !el('w-send').disabled) send(); });
  el('w-mine').checked = onlyMine;
  el('w-mine').addEventListener('change', e => { onlyMine = e.target.checked; local.set('svh-only-mine', onlyMine); renderOrders(); });
  const offOutbox = outbox.onChange(() => { if (screen === 'plan') renderOrders(); });
  const timer = setInterval(() => { if (screen === 'plan') renderPlan(); }, 30000); // Verweildauer aktuell halten

  return { render, destroy() { offOutbox(); clearInterval(timer); document.removeEventListener('visibilitychange', onVisible); } };
}
