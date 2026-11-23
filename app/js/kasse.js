// Kasse (früher Kassenrechner): Produkte antippen, Summe und Rückgeld, Verkauf wird im
// Verkaufsprotokoll gespeichert – ohne Verbindung zuerst sicher auf dem Gerät.
import { $, esc, nb, setHtml, eur, parseEur, outbox, toast, ask, uid, CATS, CAT_ICONS } from './core.js';

export function kasseView(root) {
  let st = { products: [] }, order = {}, given = null;

  root.innerHTML = `<div class="kasse" id="k-root">
    <section class="panel k-products" id="k-products"></section>
    <aside class="bon">
      <div class="bon-head"><h2>Aktueller Verkauf</h2><button class="x" id="k-close" aria-label="Schließen">×</button></div>
      <div class="bon-list" id="k-list"></div>
      <div class="bon-foot">
        <div class="total"><span>Summe</span><b id="k-total">0,00 €</b></div>
        <div class="given" id="k-given"></div>
        <input id="k-custom" class="field" inputmode="decimal" autocomplete="off" placeholder="Anderer Betrag gegeben, z. B. 23,50">
        <div class="change" id="k-change" hidden><span></span><b></b></div>
        <div class="actions"><button class="btn sec" id="k-clear">Löschen</button><button class="btn" id="k-paid">Bezahlt ✓</button></div>
        <button class="small k-house" id="k-house">🎁 Aufs Haus (Helfer, Musik …)</button>
      </div>
    </aside>
    <button class="mobilebar" id="k-bar"><span id="k-count"></span><b id="k-bartotal"></b></button>
  </div>`;
  const el = id => $(`#${id}`, root);

  const products = () => st.products.filter(p => p.active);
  const byId = id => products().find(p => p.id === id);
  const total = () => Object.entries(order).reduce((s, [id, q]) => s + (byId(id)?.price || 0) * q, 0);
  const count = () => Object.values(order).reduce((s, q) => s + q, 0);

  function render(state) {
    st = state;
    for (const id of Object.keys(order)) if (!byId(id)) delete order[id];
    draw();
  }

  function draw() {
    setHtml(el('k-products'), Object.entries(CATS).map(([cat, label]) => {
      const list = products().filter(p => p.cat === cat);
      if (!list.length) return '';
      return `<h2 class="cat-h c-${cat}"><span class="ico">${CAT_ICONS[cat] || ''}</span>${label}</h2><div class="grid">${list.map(p => {
        const q = order[p.id] || 0;
        return `<div class="ktile ${q ? 'on' : ''} ${p.soldOut ? 'out' : ''}">
          <button class="add c-${cat}" data-add="${p.id}" ${p.soldOut ? 'disabled' : ''}><span class="name">${esc(nb(p.name))}</span><span class="price">${p.soldOut ? 'ausverkauft' : eur(p.price)}</span></button>
          ${q ? `<span class="badge">${q}</span><button class="minus" data-sub="${p.id}" aria-label="Eins weniger">−</button>` : ''}
        </div>`;
      }).join('')}</div>`;
    }).join('') || '<p class="muted">Noch keine Produkte – bitte in der Verwaltung anlegen.</p>');

    const lines = products().filter(p => order[p.id]);
    setHtml(el('k-list'), lines.map(p => `<div class="line">
        <div>${esc(nb(p.name))}<small>${eur(p.price)} / Stück</small></div>
        <div class="q"><button class="qbtn" data-sub="${p.id}">−</button><b>${order[p.id]}</b><button class="qbtn" data-add="${p.id}">+</button></div>
        <div class="sum">${eur(p.price * order[p.id])}</div></div>`).join('')
      || '<div class="empty">Noch nichts ausgewählt.<br>Tippe auf ein Produkt.</div>');

    const sum = total(), n = count();
    el('k-total').textContent = eur(sum);
    el('k-bartotal').textContent = eur(sum);
    el('k-count').textContent = n ? `${n} Artikel · Bon anzeigen` : 'Keine Artikel';
    el('k-paid').disabled = el('k-clear').disabled = el('k-house').disabled = !n;
    const custom = el('k-custom').value.trim();
    const opts = [['Passend', 'exact'], ...[500, 1000, 2000, 5000].map(v => [eur(v).replace(',00', ''), v])];
    setHtml(el('k-given'), opts.map(([l, v]) => `<button data-given="${v}" class="${!custom && String(given) === String(v) ? 'on' : ''}">${l}</button>`).join(''));

    const g = given === 'exact' ? sum : given;
    const show = n > 0 && g !== null && !Number.isNaN(g);
    el('k-change').hidden = !show;
    if (show) {
      const diff = g - sum;
      el('k-change').className = `change ${diff < 0 ? 'neg' : ''}`;
      el('k-change').firstElementChild.textContent = diff < 0 ? 'Fehlt noch' : 'Rückgeld';
      el('k-change').lastElementChild.textContent = eur(Math.abs(diff));
    }
  }

  const reset = () => { order = {}; given = null; el('k-custom').value = ''; el('k-root').classList.remove('bon-open'); draw(); };

  // house = Freiverzehr: kein Geld, aber mit Angabe für wen in der Auswertung
  async function paid(house = false) {
    const items = Object.entries(order).map(([pid, qty]) => ({ pid, qty }));
    if (!items.length) return;
    const sum = total();
    const summary = products().filter(p => order[p.id]).map(p => `${order[p.id]}× ${p.name}`).join(', ');
    let reason = '';
    if (house) {
      reason = await ask({ title: `${eur(sum)} aufs Haus?`, text: `${summary}\n\nEs wird kein Geld kassiert. Die Buchung steht mit diesem Gerät in der Auswertung.`, ok: 'Aufs Haus buchen',
        input: { placeholder: 'Für wen? z. B. Helfer, Musik', required: true, max: 60 } });
      if (!reason) return;
    }
    el('k-paid').disabled = true;
    const what = house ? `Aufs Haus (${reason})` : 'Verkauf';
    const r = await outbox.submit('/api/kasse/sale', { cid: uid(), items, ...(house ? { house: true, reason } : {}) }, { label: `${house ? 'Aufs Haus' : 'Kasse'} ${eur(sum)}`, summary });
    if (r.error) { toast(r.error, { kind: 'error', ms: 7000 }); el('k-paid').disabled = false; return; }
    reset();
    if (r.sent) toast(`✓ ${what} über ${eur(sum)} gespeichert`);
    else toast(`${what} über ${eur(sum)} auf dem Gerät gesichert – wird gesendet, sobald Verbindung da ist`, { kind: 'warn', ms: 6000 });
  }

  root.addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b) return;
    const d = b.dataset;
    if (d.add) { order[d.add] = (order[d.add] || 0) + 1; draw(); }
    else if (d.sub) { if (--order[d.sub] <= 0) delete order[d.sub]; draw(); }
    else if (d.given) { given = d.given === 'exact' ? 'exact' : Number(d.given); el('k-custom').value = ''; draw(); }
    else if (b.id === 'k-clear') reset();
    else if (b.id === 'k-paid') paid();
    else if (b.id === 'k-house') paid(true);
    else if (b.id === 'k-bar') el('k-root').classList.add('bon-open');
    else if (b.id === 'k-close') el('k-root').classList.remove('bon-open');
  });
  el('k-custom').addEventListener('input', e => {
    const v = e.target.value.trim();
    given = v ? parseEur(v) : null;
    draw();
  });

  return { render };
}
