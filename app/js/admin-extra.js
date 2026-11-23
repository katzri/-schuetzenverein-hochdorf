// Verwaltung, Teil 2: Tischplan einrichten, Abrechnung pro Bedienung, Storno-Protokoll,
// Kassenabschluss und Tagesabschluss zum Ausdrucken.
import { esc, plural, eur, parseEur, centsText, api, live, toast, printDoc, tableName, seatRange, ROLES } from './core.js';

const who = w => `${ROLES[w.role]?.label || 'System'} · ${w.device}`;
const KIND = { tisch: 'Tische', abholung: 'Abholungen', kasse: 'Kasse', storno: 'Stornos (Rückzahlungen)' };

// ---------- Tischplan ----------
export function layoutEditor(body) {
  // Arbeitskopie – wird erst mit „Speichern“ auf allen Geräten aktiv
  const copy = v => JSON.parse(JSON.stringify(v)); // statt structuredClone: läuft auch auf älteren Tablets
  let areas = copy(live.state.layout?.areas || []), dirty = false;
  const nextNr = () => Math.max(0, ...areas.flatMap(a => a.tables.map(t => t.nr))) + 1;

  function draw() {
    const seats = areas.reduce((s, a) => s + a.tables.reduce((x, t) => x + (Number(t.seats) || 0), 0), 0);
    body.innerHTML = `<p class="muted">Hier wird festgelegt, welche Tische es gibt und wie viele Plätze jeder hat – genau so erscheint der Tischplan bei der Bedienung.
      Bereiche sind z. B. Gastraum, Nebenzimmer oder Terrasse. Tischnummern dürfen nur einmal vorkommen. Ein Name (z. B. „Stammtisch“) ist freiwillig –
      ohne Namen heißt der Tisch „Tisch ‹Nr.›“. Die Plätze werden in der Reihenfolge der Tische fortlaufend nummeriert.</p>
      <div class="kpis"><div class="kpi"><span>Bereiche</span><b>${areas.length}</b></div><div class="kpi"><span>Tische</span><b>${areas.reduce((s, a) => s + a.tables.length, 0)}</b></div>
        <div class="kpi"><span>Sitzplätze</span><b>${seats}</b></div></div>
      ${areas.map((a, i) => `<div class="area" data-area="${i}">
        <div class="area-head"><input class="field" data-l="name" value="${esc(a.name)}" maxlength="30" placeholder="Name des Bereichs" aria-label="Name des Bereichs">
          <button class="small" data-addtables="${i}">＋ Tische</button><button class="small danger" data-delarea="${i}">Bereich löschen</button></div>
        <div class="ltables">${a.tables.map((t, j) => `<div class="lt" data-t="${j}"><label>Tisch<input data-l="nr" inputmode="numeric" value="${t.nr}" aria-label="Tischnummer"></label>
          <label>Plätze<input data-l="seats" inputmode="numeric" value="${t.seats}" aria-label="Sitzplätze"></label>
          <label class="lname">Name<input data-l="name" maxlength="20" value="${esc(t.name || '')}" placeholder="–" aria-label="Name des Tisches"></label>
          <small class="lrange">${seatRange(t.nr, { areas })}</small>
          <button data-delt="${i}|${j}" aria-label="Tisch ${t.nr} entfernen">×</button></div>`).join('') || '<span class="muted">Noch keine Tische.</span>'}</div>
      </div>`).join('')}
      <div class="toolbar"><button class="small" data-addarea>＋ Bereich hinzufügen</button></div>
      <button class="btn" data-savelayout ${dirty ? '' : 'disabled'}>${dirty ? 'Tischplan speichern' : '✓ Tischplan ist gespeichert'}</button>`;
  }
  const touch = () => { dirty = true; draw(); };

  async function save() {
    try {
      const r = await api('POST', '/api/admin/layout', { areas: areas.map(a => ({ id: a.id, name: a.name, tables: a.tables.map(t => ({ nr: Number(t.nr), seats: Number(t.seats), name: t.name || '' })) })) });
      areas = copy(r.layout.areas);
      dirty = false;
      toast('Tischplan gespeichert – gilt sofort auf allen Geräten');
      draw();
    } catch (e) { toast(e.message, { kind: 'error', ms: 7000 }); }
  }

  // true = Klick gehörte zum Tischplan
  function click(b) {
    const d = b.dataset;
    if ('addarea' in d) { areas.push({ name: `Bereich ${areas.length + 1}`, tables: [] }); touch(); }
    else if (d.delarea) { areas.splice(Number(d.delarea), 1); touch(); }
    else if (d.addtables) {
      const a = areas[Number(d.addtables)], last = a.tables[a.tables.length - 1];
      for (let k = 0, nr = nextNr(); k < 4; k++) a.tables.push({ nr: nr + k, seats: last?.seats || 8 });
      touch();
    } else if (d.delt) { const [i, j] = d.delt.split('|').map(Number); areas[i].tables.splice(j, 1); touch(); }
    else if ('savelayout' in d) save();
    else return false;
    return true;
  }

  function change(input) {
    const a = areas[Number(input.closest('[data-area]')?.dataset.area)];
    if (!a || !input.dataset.l) return;
    const t = input.closest('[data-t]');
    if (t) a.tables[Number(t.dataset.t)][input.dataset.l] = input.dataset.l === 'name' ? input.value : Number(input.value.trim()) || 0;
    else a.name = input.value;
    // nicht neu zeichnen – sonst verliert das nächste Eingabefeld beim Weitertippen den Fokus
    dirty = true;
    const btn = body.querySelector('[data-savelayout]');
    btn.disabled = false;
    btn.textContent = 'Tischplan speichern';
  }

  return { draw, click, change };
}

// ---------- Auswertung ----------
export function staffTable(r) {
  if (!r.staff.length) return '<p class="muted">Noch keine Zahlungen.</p>';
  return `<p class="muted">So viel Bargeld hat jedes Gerät laut System eingenommen (Rückzahlungen bereits abgezogen) – damit wird der Geldbeutel jeder Bedienung abgerechnet.</p>
    <div class="table-wrap"><table class="tbl"><thead><tr><th>Arbeitsgruppe · Gerät</th><th class="r">Zahlungen</th><th class="r">Rückzahlungen</th><th class="r">Aufs Haus</th><th class="r">Abzuliefern</th></tr></thead>
    <tbody>${r.staff.map(w => `<tr><td>${esc(who(w))}</td><td class="r">${w.count}</td><td class="r">${w.refunds ? eur(w.refunds) : '–'}</td><td class="r">${w.house ? eur(w.house) : '–'}</td><td class="r"><b>${eur(w.amount)}</b></td></tr>`).join('')}</tbody>
    <tfoot><tr><td>Gesamt</td><td></td><td></td><td class="r">${r.house?.amount ? eur(r.house.amount) : ''}</td><td class="r">${eur(r.revenue)}</td></tr></tfoot></table></div>`;
}

// Freiverzehr: was ohne Bezahlung ausgegeben wurde – für wen, von welchem Gerät
export function houseTable(r) {
  const h = r.house, list = r.log.filter(p => p.kind === 'haus');
  if (!h?.count) return '<p class="muted">Nichts aufs Haus gebucht.</p>';
  return `<p class="muted">Ohne Bezahlung ausgegeben (Helfer, Musik …) – ${plural(h.count, 'Buchung', 'Buchungen')} im Wert von ${eur(h.amount)}. Zählt nicht zum Umsatz und nicht zu „Verkauft pro Produkt“.</p>
    <div class="table-wrap"><table class="tbl"><thead><tr><th>Produkt</th><th class="r">Menge</th><th class="r">Wert</th></tr></thead>
    <tbody>${h.products.map(p => `<tr><td>${esc(p.name)}</td><td class="r">${p.qty}</td><td class="r">${eur(p.amount)}</td></tr>`).join('')}</tbody></table></div>
    <div class="table-wrap"><table class="tbl"><thead><tr><th>Zeit</th><th>Für wen</th><th>Positionen</th><th class="r">Wert</th><th>Gerät</th></tr></thead><tbody>
    ${list.map(p => `<tr><td>${new Date(p.ts).toLocaleTimeString('de-DE')}</td><td>${esc(p.reason || '–')}${p.table ? ` · ${esc(tableName(p.table))}` : ''}</td>
      <td>${esc(p.items.map(i => `${i.qty}× ${i.name}`).join(', '))}</td><td class="r">${eur(p.value || 0)}</td><td>${esc(p.by ? who(p.by) : '')}</td></tr>`).join('')}
    </tbody></table></div>`;
}

export function voidTable(r) {
  if (!r.voids.length) return '<p class="muted">Keine Stornos.</p>';
  return `<p class="muted">Bestellte, aber vor dem Kassieren wieder gestrichene Positionen – zusammen ${eur(r.voidAmount)}. Sie zählen nicht zum Umsatz.</p>
    <div class="table-wrap"><table class="tbl"><thead><tr><th>Zeit</th><th>Für</th><th>Position</th><th class="r">Wert</th><th>Grund</th><th>Gerät</th></tr></thead><tbody>
    ${r.voids.map(v => `<tr><td>${new Date(v.ts).toLocaleTimeString('de-DE')}</td><td>${esc(v.table ? tableName(v.table) : `Abholung ${v.name}`)} · Nr. ${v.nr}</td>
      <td>${v.qty}× ${esc(v.item)}</td><td class="r">${eur(v.amount)}</td><td>${esc(v.reason || '–')}</td><td>${esc(v.by ? who(v.by) : '')}</td></tr>`).join('')}
    </tbody></table></div>`;
}

// Soll = Wechselgeld + Umsatz (alles Bargeld); Ist = gezählt
export function cashBox(r) {
  const c = r.cash, current = r.day && r.day.nr === r.days.length;
  const diff = c ? c.counted - c.float - r.revenue : null;
  return `<div class="cashbox">${c ? `<div class="kpis">
      <div class="kpi"><span>Wechselgeld zu Beginn</span><b>${eur(c.float)}</b></div>
      <div class="kpi"><span>Soll in der Kasse</span><b>${eur(c.float + r.revenue)}</b></div>
      <div class="kpi"><span>Gezählt</span><b>${eur(c.counted)}</b><small>${new Date(c.ts).toLocaleString('de-DE')}</small></div>
      <div class="kpi ${diff ? 'neg' : 'main'}"><span>Differenz</span><b>${diff > 0 ? '+' : ''}${eur(diff)}</b><small>${diff === 0 ? 'stimmt genau' : diff > 0 ? 'zu viel in der Kasse' : 'fehlt in der Kasse'}</small></div></div>
      ${c.note ? `<p class="muted">Bemerkung: ${esc(c.note)}</p>` : ''}` : '<p class="muted">Am Ende des Festtags das gesamte Bargeld zählen und hier eintragen – die Differenz zum Soll wird im Protokoll festgehalten.</p>'}
    ${current ? `<div class="cashform"><label>Wechselgeld zu Beginn €<input class="field" id="c-float" inputmode="decimal" value="${c ? centsText(c.float) : ''}" placeholder="z. B. 200,00"></label>
      <label>Gezähltes Bargeld €<input class="field" id="c-counted" inputmode="decimal" value="${c ? centsText(c.counted) : ''}" placeholder="z. B. 1.843,50"></label>
      <label>Bemerkung<input class="field" id="c-note" maxlength="200" value="${esc(c?.note || '')}" placeholder="optional"></label>
      <button class="btn" data-savecash>Kassenabschluss speichern</button></div>` : ''}</div>`;
}

export async function saveCash(body) {
  const money = id => parseEur(body.querySelector(id).value.replace(/\.(?=\d{3})/g, ''));
  const float = money('#c-float'), counted = money('#c-counted');
  if (Number.isNaN(float) || Number.isNaN(counted) || float < 0 || counted < 0) { toast('Bitte beide Beträge eingeben', { kind: 'error' }); return false; }
  try {
    await api('POST', '/api/admin/cash', { float, counted, note: body.querySelector('#c-note').value });
    toast('Kassenabschluss gespeichert');
    return true;
  } catch (e) { toast(e.message, { kind: 'error', ms: 6000 }); return false; }
}

// Tagesabschluss (Z-Bericht) als Ausdruck
export function printReport(r) {
  if (!r?.day) return;
  const k = r.byKind, c = r.cash;
  printDoc({
    title: 'Tagesabschluss', sub: `${r.day.label} · ab ${new Date(r.day.ts).toLocaleString('de-DE')}`, wide: true,
    rows: [
      ['Umsatz', '', 'h'],
      ...['tisch', 'abholung', 'kasse', 'storno'].map(x => [`${KIND[x]} (${k[x].count})`, eur(k[x].amount)]),
      ['Umsatz gesamt', eur(r.revenue), 'b'], ['', '', 'line'],
      ['Abrechnung pro Gerät', '', 'h'], ...r.staff.map(w => [who(w), eur(w.amount)]), ['', '', 'line'],
      ['Verkaufte Produkte', '', 'h'], ...r.products.map(p => [`${p.qty}× ${p.name}`, eur(p.amount)]), ['', '', 'line'],
      ...(r.house?.count ? [['Aufs Haus (kein Umsatz)', '', 'h'], ...r.house.products.map(p => [`${p.qty}× ${p.name}`, eur(p.amount)]), [`Aufs Haus gesamt (${r.house.count})`, eur(r.house.amount), 'b'], ['', '', 'line']] : []),
      ['Stornos vor der Zahlung', eur(r.voidAmount)],
      ...(r.openTables.length ? [['Noch nicht bezahlt', eur(r.openTables.reduce((s, t) => s + t.amount, 0)), 'b']] : []),
      ...(c ? [['', '', 'line'], ['Kassenabschluss', '', 'h'], ['Wechselgeld zu Beginn', eur(c.float)], ['Soll in der Kasse', eur(c.float + r.revenue)],
        ['Gezählt', eur(c.counted)], ['Differenz', eur(c.counted - c.float - r.revenue), 'b'], ...(c.note ? [[`Bemerkung: ${c.note}`, '']] : [])] : []),
      ['', '', 'line'], ['Unterschrift Kassier: ______________________', '', 'sign'], ['Unterschrift Vorstand: ____________________', '', 'sign'],
    ],
  });
}
