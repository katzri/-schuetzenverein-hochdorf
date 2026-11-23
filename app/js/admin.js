// Verwaltung: Verkaufsauswertung & -protokoll, Anmeldeprotokoll und PINs, Produkte,
// Sicherungsstatus und Festtage. Tischplan, Abrechnung der Bedienungen, Storno-Protokoll und
// Kassenabschluss stecken in admin-extra.js, die QR-Codes zum Verbinden in admin-connect.js.
import { $, esc, plural, eur, parseEur, centsText, api, live, toast, ask, outbox, session, tableName, ROLES, STATIONS, CATS } from './core.js';
import { layoutEditor, staffTable, voidTable, houseTable, cashBox, saveCash, printReport } from './admin-extra.js';
import { connectPanel } from './admin-connect.js';

const TABS = { sales: 'Verkäufe', plan: 'Tischplan', products: 'Produkte', access: 'Zugänge', connect: 'QR-Codes', backup: 'Sicherung', day: 'Festtag' };
const KIND = { tisch: 'Tisch', abholung: 'Abholung', kasse: 'Kasse', storno: 'Storno', haus: 'Aufs Haus' };
const ACCESS = {
  'access.login': ['login', 'Anmeldung'], 'access.logout': ['logout', 'Abmeldung'], 'access.failed': ['failed', 'Falsche PIN'],
  'access.locked': ['locked', 'Gesperrt (5 Fehlversuche)'], 'access.changed': ['changed', 'PIN geändert'],
};
// Anmeldungen über den QR-Code der Arbeitsgruppe sind im Protokoll als solche erkennbar
const accessText = a => (a.via === 'qr' && a.type === 'access.login' ? 'Anmeldung per QR-Code'
  : a.via === 'qr' && a.type === 'access.failed' ? 'Ungültiger QR-Code' : (ACCESS[a.type] || [, a.type])[1]);

const dateTime = ts => new Date(ts).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' });
const byText = by => (by ? `${ROLES[by.role]?.label || 'System'} · ${by.device}` : '');
const target = p => (p.table ? tableName(p.table) : p.name ? `Abholung ${p.name}` : '–');
const opts = (map, sel) => Object.entries(map).map(([k, l]) => `<option value="${k}" ${k === sel ? 'selected' : ''}>${esc(l)}</option>`).join('');

// CSV für Excel: Semikolon, Dezimalkomma, UTF-8 mit BOM; Formel-Einschleusung verhindern
function downloadCsv(name, rows) {
  const cell = v => {
    let s = String(v ?? '');
    if (/^[=+@\t\r]|^-\D/.test(s)) s = `'${s}`;
    return `"${s.replace(/"/g, '""')}"`;
  };
  const text = '\uFEFF' + rows.map(r => r.map(cell).join(';')).join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
  a.download = `${name.replace(/[^\w.-]+/g, '_')}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

export function adminView(root) {
  let tab = 'sales', day = null, report = null, system = null, access = null, showAll = false, refresh = null, plan = null, editor = null, panel = null, prodSig = '';
  root.innerHTML = `<section class="panel"><div class="admin">
    <div class="tabs" id="a-tabs">${Object.entries(TABS).map(([k, l]) => `<button data-tab="${k}">${l}</button>`).join('')}</div>
    <div id="a-body"><p class="muted">Lade …</p></div></div></section>`;
  const body = $('#a-body', root);

  // quiet: Aufruf durch Live-Daten im Hintergrund – nur neu zeichnen, wenn sich die Auswertung geändert hat
  // (sonst ginge bei jeder fremden Bestellung ein gerade laufender Mausklick verloren)
  async function load(quiet = false) {
    const before = quiet ? JSON.stringify(report) : null;
    try {
      if (tab === 'sales') report = await api('GET', `/api/admin/sales${day ? `?day=${day}` : ''}`);
      if (tab === 'day') report = await api('GET', '/api/admin/sales');
      if (tab === 'access') access = await api('GET', '/api/admin/access');
      if (tab === 'backup') system = await api('GET', '/api/admin/system');
      if (tab === 'connect') { panel ||= connectPanel(body); await panel.load(); }
    } catch (e) { if (!quiet) toast(e.message, { kind: 'error' }); }
    if (quiet && JSON.stringify(report) === before) return;
    draw();
  }

  function draw() {
    root.querySelectorAll('#a-tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === tab));
    ({ sales: drawSales, plan: drawPlan, access: drawAccess, products: drawProducts, connect: () => panel?.draw(), backup: drawBackup, day: drawDay })[tab]();
  }
  function drawPlan() {
    editor ||= layoutEditor(body);
    editor.draw();
  }

  // ---------- Verkäufe ----------
  function drawSales() {
    if (!report) return;
    const r = report, k = r.byKind;
    const gross = r.revenue - k.storno.amount;
    body.innerHTML = `<div class="toolbar">
        <label>Festtag<select id="a-day">${r.days.slice().reverse().map(d => `<option value="${d.nr}" ${d.nr === r.day?.nr ? 'selected' : ''}>${esc(d.label)} – ab ${new Date(d.ts).toLocaleDateString('de-DE')}</option>`).join('')}</select></label>
        <button class="small" data-csv="log">⬇ Protokoll (CSV)</button>
        <button class="small" data-csv="products">⬇ Produkte (CSV)</button>
        <button class="small" data-printz>🖨 Tagesabschluss drucken</button>
        <button class="small" data-reload>↻ Aktualisieren</button>
      </div>
      <div class="kpis">
        <div class="kpi main"><span>Umsatz (nach Storno)</span><b>${eur(r.revenue)}</b></div>
        <div class="kpi"><span>Zahlungen</span><b>${r.payments}</b></div>
        <div class="kpi"><span>Ø pro Zahlung</span><b>${eur(r.payments ? Math.round(gross / r.payments) : 0)}</b></div>
        <div class="kpi ${k.storno.count ? 'neg' : ''}"><span>Stornos</span><b>${k.storno.count} · ${eur(k.storno.amount)}</b></div>
      </div>
      <div class="kinds">${['tisch', 'abholung', 'kasse'].map(x => `<div class="kpi"><span>${KIND[x]}</span><b>${eur(k[x].amount)}</b><small>${plural(k[x].count, 'Zahlung', 'Zahlungen')}</small></div>`).join('')}</div>
      ${r.openTables.length ? `<div class="alert">Noch nicht bezahlt: ${r.openTables.map(t => `${tableName(t.table)} (${eur(t.amount)})`).join(', ')}</div>` : ''}
      <h2>Abrechnung pro Bedienung / Gerät</h2>${staffTable(r)}
      <h2>Kassenabschluss</h2>${cashBox(r)}
      <h2>Umsatz pro Stunde</h2>${hoursChart(r.hours)}
      <h2>Verkauft pro Produkt</h2>${productTable(r.products)}
      <h2>Aufs Haus (Freiverzehr)</h2>${houseTable(r)}
      <h2>Stornos vor der Zahlung</h2>${voidTable(r)}
      <h2>Protokoll aller Zahlungen</h2>${logTable(r.log)}`;
  }

  function hoursChart(hours) {
    if (!hours.length) return '<p class="muted">Noch keine Verkäufe.</p>';
    const max = Math.max(...hours.map(h => h.amount), 1);
    return `<div class="bars">${hours.map(h => `<div class="bar-row"><span>${String(h.hour).padStart(2, '0')} Uhr</span>
      <div class="bar"><i style="width:${(Math.max(0, h.amount) / max * 100).toFixed(1)}%"></i></div><b>${eur(h.amount)}</b></div>`).join('')}</div>`;
  }

  function productTable(list) {
    if (!list.length) return '<p class="muted">Noch keine Verkäufe.</p>';
    const qty = list.reduce((s, p) => s + p.qty, 0), sum = list.reduce((s, p) => s + p.amount, 0);
    return `<div class="table-wrap"><table class="tbl"><thead><tr><th>Produkt</th><th class="r">Preis</th><th class="r">Menge</th><th class="r">Summe</th></tr></thead>
      <tbody>${list.map(p => `<tr><td>${esc(p.name)}</td><td class="r">${eur(p.price)}</td><td class="r">${p.qty}</td><td class="r">${eur(p.amount)}</td></tr>`).join('')}</tbody>
      <tfoot><tr><td>Gesamt</td><td></td><td class="r">${qty}</td><td class="r">${eur(sum)}</td></tr></tfoot></table></div>`;
  }

  function logTable(log) {
    if (!log.length) return '<p class="muted">Noch keine Zahlungen.</p>';
    const rows = showAll ? log : log.slice(0, 100);
    return `<div class="table-wrap"><table class="tbl"><thead><tr><th>Zeit</th><th>Art</th><th>Für</th><th>Positionen</th><th class="r">Betrag</th><th>Gerät</th></tr></thead><tbody>
      ${rows.map(p => `<tr class="${p.kind === 'storno' ? 'neg' : ''}"><td>${new Date(p.ts).toLocaleTimeString('de-DE')}</td>
        <td><span class="kind k-${p.kind}">${KIND[p.kind]}</span></td><td>${esc(target(p))}</td>
        <td>${esc(p.items.map(i => `${i.qty}× ${i.name}`).join(', '))}${p.reason ? `<br><small>${p.kind === 'haus' ? `Für: ${esc(p.reason)} · Wert ${eur(p.value || 0)}` : `Grund: ${esc(p.reason)}`}</small>` : ''}</td>
        <td class="r">${eur(p.amount)}</td><td>${esc(byText(p.by))}</td></tr>`).join('')}
    </tbody></table></div>${log.length > rows.length ? `<p><button class="small" data-showall>Alle ${log.length} Einträge anzeigen</button></p>` : ''}`;
  }

  function csv(kind) {
    const r = report, label = r.day?.label || 'Festtag';
    if (kind === 'log') {
      downloadCsv(`Verkaufsprotokoll ${label}`, [['Datum', 'Uhrzeit', 'Art', 'Für', 'Positionen', 'Betrag (€)', 'Gerät', 'Grund'],
        ...r.log.slice().reverse().map(p => [new Date(p.ts).toLocaleDateString('de-DE'), new Date(p.ts).toLocaleTimeString('de-DE'), KIND[p.kind],
          target(p), p.items.map(i => `${i.qty}x ${i.name}`).join(', '), centsText(p.amount), byText(p.by), p.kind === 'haus' ? `${p.reason} (Wert ${centsText(p.value || 0)} €)` : p.reason || ''])]);
    } else {
      downloadCsv(`Produktverkauf ${label}`, [['Produkt', 'Preis (€)', 'Menge', 'Summe (€)'],
        ...r.products.map(p => [p.name, centsText(p.price), p.qty, centsText(p.amount)])]);
    }
  }

  // ---------- Zugänge: PINs & Anmeldeprotokoll ----------
  function drawAccess() {
    const list = access || [];
    const rows = showAll ? list : list.slice(0, 100);
    body.innerHTML = `<p class="muted">Jede Arbeitsgruppe hat eine eigene PIN (gespeichert nur verschlüsselt). Nach einer Änderung müssen sich alle Geräte dieser Gruppe neu anmelden.
      Jede Anmeldung, Abmeldung, falsche PIN und PIN-Änderung wird mit Gerät und Uhrzeit im gesicherten Protokoll festgehalten.</p>
      <div class="access">${Object.entries(ROLES).map(([k, r]) => `<div class="acc"><span>${r.icon} ${r.label}</span><button class="small" data-pin="${k}">PIN ändern</button></div>`).join('')}</div>
      <p class="muted">PIN vergessen? Server mit <code>node server.js --neue-pins</code> starten – dann werden alle PINs neu vergeben und angezeigt.</p>
      <div class="row-head"><h2>Anmeldeprotokoll</h2><span><button class="small" data-csv="access">⬇ CSV</button> <button class="small" data-reload>↻</button></span></div>
      ${list.length ? `<div class="table-wrap"><table class="tbl"><thead><tr><th>Zeit</th><th>Ereignis</th><th>Arbeitsgruppe · Gerät</th><th>Details</th></tr></thead><tbody>
        ${rows.map(a => { const [cls] = ACCESS[a.type] || ['']; return `<tr class="${cls === 'failed' || cls === 'locked' ? 'neg' : ''}">
          <td>${dateTime(a.ts)}</td><td><span class="kind k-${cls}">${esc(accessText(a))}</span></td><td>${esc(byText(a.by))}</td>
          <td>${a.type === 'access.changed' ? `für ${esc(ROLES[a.role]?.label || a.role)}` : a.ip ? `IP ${esc(a.ip.replace('::ffff:', ''))}` : ''}</td></tr>`; }).join('')}
      </tbody></table></div>${list.length > rows.length ? `<p><button class="small" data-showall>Alle ${list.length} Einträge anzeigen</button></p>` : ''}`
      : '<p class="muted">Noch keine Einträge.</p>'}`;
  }

  async function changePin(role) {
    const min = role === 'admin' ? 6 : 4;
    const pin = await ask({ title: `Neue PIN für ${ROLES[role].label}`, text: `${min} bis 8 Ziffern`, ok: 'Speichern', input: { placeholder: 'Neue PIN', required: true, numeric: true, max: 8 } });
    if (!pin) return;
    try {
      await api('POST', '/api/admin/pin', { role, pin });
      toast(`PIN für ${ROLES[role].label} geändert`);
      if (role === 'admin') { toast('Bitte mit der neuen PIN neu anmelden'); setTimeout(() => { session.clear(); location.reload(); }, 1500); }
      else load();
    } catch (e) { toast(e.message, { kind: 'error', ms: 6000 }); }
  }

  // ---------- Produkte ----------
  function drawProducts() {
    prodSig = JSON.stringify(live.state.products);
    const ps = [...live.state.products].sort((a, b) => b.active - a.active); // aktive zuerst
    body.innerHTML = `${plan ? planBox() : `<div class="toolbar"><button class="small" data-plan>📋 Preisliste fürs nächste Fest prüfen &amp; übernehmen</button></div>`}
      <p class="muted">Jedes Produkt mit eigenem Preis hat ein eigenes Feld (z. B. „Bier 0,5 l“ und „Bier 0,3 l“). Änderungen gelten sofort auf allen Geräten und stehen im Protokoll.
      Deaktivierte Produkte verschwinden aus der Auswahl, bleiben aber in der Auswertung erhalten. „Bestand“ zählt mit jeder Bestellung herunter (leer = unbegrenzt); „Ausverk.“ sperrt ein Produkt sofort auf allen Geräten – das können auch Küche und Theke selbst.</p>
      <div class="table-wrap"><table class="tbl edit"><thead><tr><th>Name</th><th>Preis €</th><th>Kategorie</th><th>Zubereitung</th><th>Bestand</th><th>Ausverk.</th><th>Aktiv</th></tr></thead><tbody>
      ${ps.map(p => `<tr data-id="${p.id}" class="${p.active ? '' : 'off'}">
        <td><input data-f="name" value="${esc(p.name)}" maxlength="40"></td>
        <td><input data-f="price" class="price" inputmode="decimal" value="${centsText(p.price)}"></td>
        <td><select data-f="cat">${opts(CATS, p.cat)}</select></td>
        <td><select data-f="station">${opts({ '': '– keine –', ...STATIONS }, p.station)}</select></td>
        <td><input data-a="stock" class="price" inputmode="numeric" placeholder="∞" value="${p.stock ?? ''}" aria-label="Bestand"></td>
        <td><input type="checkbox" data-a="soldOut" ${p.soldOut ? 'checked' : ''} aria-label="ausverkauft"></td>
        <td><input type="checkbox" data-f="active" ${p.active ? 'checked' : ''} aria-label="aktiv"></td></tr>`).join('')}
      </tbody></table></div>
      <h2>Neues Produkt</h2>
      <form class="addform" id="a-add"><input name="name" class="field" placeholder="Name, z. B. Bier 0,3 l" maxlength="40" required>
        <input name="price" class="field" placeholder="Preis, z. B. 2,50" inputmode="decimal" required>
        <select name="cat" class="field">${opts(CATS, 'essen')}</select>
        <select name="station" class="field">${opts({ '': '– keine –', ...STATIONS }, 'kueche')}</select>
        <button class="btn">Hinzufügen</button></form>`;
  }

  // Vorschau der hinterlegten Preisliste: was neu kommt, was sich ändert, was ausgeblendet wird
  const PLAN = { neu: 'neu', preis: 'Preis ändert sich', geaendert: 'wird angepasst', gleich: 'unverändert' };
  function planBox() {
    const todo = plan.items.filter(i => i.change !== 'gleich').length + plan.deactivate.length;
    return `<div class="explain"><b>${esc(plan.title)}</b>
      <div class="table-wrap"><table class="tbl"><thead><tr><th>Produkt</th><th>Kategorie</th><th class="r">Preis</th><th>Änderung</th></tr></thead><tbody>
      ${plan.items.map(i => `<tr><td>${esc(i.name)}</td><td>${esc(CATS[i.cat])}</td><td class="r">${eur(i.price)}</td>
        <td class="pl-${i.change}">${PLAN[i.change]}${i.change === 'preis' ? ` (bisher ${eur(i.oldPrice)})` : ''}</td></tr>`).join('')}
      ${plan.deactivate.map(p => `<tr><td>${esc(p.name)}</td><td></td><td class="r">${eur(p.price)}</td><td class="pl-off">wird deaktiviert</td></tr>`).join('')}
      </tbody></table></div>
      <p class="muted">Deaktivierte Produkte bleiben in der Auswertung erhalten und können jederzeit wieder aktiviert werden.</p>
      <div class="toolbar">${todo ? `<button class="btn" data-applyplan>Preisliste übernehmen (${todo} Änderungen)</button>` : '<b>✓ Preisliste ist bereits aktiv.</b>'}
        <button class="small" data-closeplan>Schließen</button></div></div>`;
  }

  async function showPlan() {
    try { plan = await api('GET', '/api/admin/pricelist'); drawProducts(); } catch (e) { toast(e.message, { kind: 'error' }); }
  }

  async function applyPlan() {
    const ok = await ask({ title: 'Preisliste übernehmen?', text: 'Die Änderungen gelten sofort auf allen Geräten. Offene Tischbestellungen behalten ihre bisherigen Preise.', ok: 'Übernehmen' });
    if (!ok) return;
    try {
      const r = await api('POST', '/api/admin/pricelist');
      toast(`Preisliste übernommen: ${r.added} neu, ${r.updated} angepasst, ${r.deactivated} deaktiviert`, { ms: 6000 });
      plan = null;
      drawProducts();
    } catch (e) { toast(e.message, { kind: 'error', ms: 6000 }); }
  }

  async function saveRow(row) {
    const p = live.state.products.find(x => x.id === row.dataset.id);
    if (!p) return;
    const f = name => row.querySelector(`[data-f="${name}"]`);
    const price = parseEur(f('price').value);
    if (Number.isNaN(price)) { toast('Ungültiger Preis', { kind: 'error' }); f('price').value = centsText(p.price); return; }
    try {
      await api('POST', '/api/admin/products', { id: p.id, name: f('name').value, price, cat: f('cat').value, station: f('station').value, active: f('active').checked });
      toast(`„${f('name').value.trim()}“ gespeichert`);
    } catch (e) { toast(e.message, { kind: 'error', ms: 6000 }); drawProducts(); }
  }

  async function saveAvailability(row) {
    const stock = row.querySelector('[data-a="stock"]').value.trim();
    if (stock && !/^\d{1,4}$/.test(stock)) { toast('Bestand: bitte eine Stückzahl eingeben', { kind: 'error' }); drawProducts(); return; }
    try {
      await api('POST', `/api/products/${row.dataset.id}/availability`, { soldOut: row.querySelector('[data-a="soldOut"]').checked, stock: stock ? Number(stock) : null });
      toast('Verfügbarkeit gespeichert');
    } catch (e) { toast(e.message, { kind: 'error', ms: 6000 }); drawProducts(); }
  }

  async function addProduct(form) {
    const price = parseEur(form.price.value);
    if (Number.isNaN(price)) { toast('Ungültiger Preis', { kind: 'error' }); return; }
    try {
      await api('POST', '/api/admin/products', { name: form.name.value, price, cat: form.cat.value, station: form.station.value, active: true });
      toast(`„${form.name.value.trim()}“ angelegt`);
      form.reset();
    } catch (e) { toast(e.message, { kind: 'error', ms: 6000 }); }
  }

  // ---------- Sicherung ----------
  function drawBackup() {
    if (!system) return;
    const j = system.journal, v = system.verify, allOk = v.every(t => t.ok);
    const waiting = outbox.list().length;
    body.innerHTML = `<h2>Geräte verbinden</h2>
      <div class="explain urls">Handys und Tablets mit dem WLAN der FRITZ!Box verbinden (Internet ist nicht nötig) und im Browser öffnen:<br>
        ${(system.addresses || []).map(u => `<code>${esc(u)}</code>`).join('<br>') || '<b>Der Server-Laptop ist mit keinem Netzwerk verbunden.</b>'}
        <br><small>Meldet ein Handy „Kein Internet“: „WLAN beibehalten“ bzw. „Trotzdem verbinden“ wählen und mobile Daten ggf. ausschalten.</small>
        <br><button class="small" data-tab="connect">📱 QR-Codes fürs WLAN und zum Anmelden ohne PIN</button></div>
      ${system.awake === true
        ? '<div class="explain"><b>✓ Der Laptop bleibt wach,</b> solange der Server läuft – der automatische Standby ist so lange ausgesetzt. Trotzdem den Deckel offen lassen und das Netzteil anschließen: Zuklappen legt ihn weiterhin schlafen.</div>'
        : '<div class="alert"><b>Standby ausschalten:</b> Schläft der Server-Rechner ein, steht alles still. Bitte in den Energie-Einstellungen den Standby auf „Nie“ stellen, den Deckel offen lassen und das Netzteil anschließen.</div>'}
      <div class="explain"><b>Echtzeit-Sicherung:</b> Jede Buchung und jede Anmeldung wird sofort fest auf die Festplatte geschrieben und
      gleichzeitig in alle Backup-Ordner gespiegelt – erst danach bestätigt der Server dem Gerät. Ohne Verbindung bleiben Aufträge auf dem Gerät gesichert
      und werden automatisch nachgesendet. Eine Prüfsummen-Kette zeigt, ob das Protokoll nachträglich verändert wurde.</div>
      <div class="kpis">
        <div class="kpi ${allOk ? 'main' : 'neg'}"><span>Prüfung</span><b>${allOk ? '✓ alles in Ordnung' : '✖ Problem gefunden'}</b></div>
        <div class="kpi"><span>Einträge im Protokoll</span><b>${j.events}</b></div>
        <div class="kpi"><span>Letzte Speicherung</span><b>${j.lastWrite ? new Date(j.lastWrite).toLocaleTimeString('de-DE') : '–'}</b></div>
      </div>
      <h2>Speicherorte</h2>
      <div class="targets">${v.map(t => `<div class="target ${t.ok ? '' : 'bad'}"><b>${t.ok ? '✓' : '✖'} ${t.primary ? 'Hauptspeicher' : 'Backup'}</b>
        <code>${esc(t.dir)}</code><small>${t.ok ? `${t.events} Einträge · Prüfsummen-Kette lückenlos und unverändert` : esc(t.error || 'nicht erreichbar')}</small>
        ${(system.extraBackups || []).includes(t.dir) ? `<span><button class="small danger" data-delbackup="${esc(t.dir)}">Nicht mehr verwenden</button></span>` : ''}</div>`).join('')}</div>
      ${system.externalBackup ? '' : `<div class="alert">Das Backup liegt bisher auf derselben Festplatte wie die Hauptdaten. Für echten Schutz (z. B. bei Diebstahl oder Defekt des Laptops)
        einen USB-Stick einstecken und hier als zusätzliches Backup eintragen.</div>`}
      <form class="backupform" id="a-backup"><label>Zusätzliches Backup, z. B. auf einem USB-Stick
        <input class="field" name="folder" maxlength="240" autocomplete="off" spellcheck="false" placeholder="Ordner, z. B. E:\\Kasse-Backup"></label>
        <button class="btn">Als Backup verwenden</button></form>
      <p class="muted">Den Laufwerksbuchstaben des Sticks zeigt der Windows-Explorer unter „Dieser PC“. Der Ordner wird angelegt, das komplette Protokoll hineinkopiert
        und ab dann jede Buchung sofort mitgeschrieben. Wird der Stick abgezogen, läuft der Betrieb weiter – nach dem Einstecken wird er von selbst nachgezogen.</p>
      <p><button class="small" data-reload>↻ Jetzt prüfen</button></p>
      <h2>Dieses Gerät</h2><p>${waiting ? `⏳ ${waiting} Auftrag/Aufträge warten auf Versand.` : '✓ Keine wartenden Aufträge.'}</p>
      <h2>Letzte Server-Starts</h2><p class="muted">${system.starts.map(dateTime).join(' · ') || '–'} · Version ${esc(system.version)}</p>`;
  }

  async function changeBackup(change) {
    if (change.remove && !await ask({ title: 'Diesen Backup-Ordner nicht mehr verwenden?', text: `${change.dir}\n\nWas dort bisher gesichert wurde, bleibt auf dem Datenträger erhalten.`, ok: 'Nicht mehr verwenden', danger: true })) return;
    try {
      await api('POST', '/api/admin/backup', change);
      toast(change.remove ? 'Backup-Ordner wird nicht mehr verwendet' : 'Backup eingerichtet – das Protokoll wurde vollständig kopiert', { ms: 5000 });
      load();
    } catch (e) { toast(e.message, { kind: 'error', ms: 8000 }); }
  }

  // ---------- Festtag ----------
  function drawDay() {
    const d = live.state.day, open = report?.openTables || [];
    body.innerHTML = `<div class="kpis"><div class="kpi main"><span>Aktueller Festtag</span><b>${esc(d?.label || '–')}</b><small>seit ${d ? dateTime(d.ts) : '–'}</small></div></div>
      <p class="muted">Ein neuer Festtag beginnt mit leerer Bestellliste und Bestellnummer 1. Alle Verkäufe der bisherigen Tage bleiben vollständig erhalten
      und können unter „Verkäufe“ ausgewählt werden.</p>
      ${open.length ? `<div class="alert">Achtung – noch nicht bezahlt: ${open.map(t => `${tableName(t.table)} (${eur(t.amount)})`).join(', ')}</div>` : ''}
      <button class="btn danger" data-newday>Neuen Festtag starten</button>`;
  }

  async function newDay() {
    const open = report?.openTables || [];
    const label = await ask({
      title: 'Neuen Festtag starten?', danger: true, ok: 'Starten',
      text: open.length ? `Noch offen: ${open.map(t => `${tableName(t.table)} (${eur(t.amount)})`).join(', ')}. Diese Bestellungen verschwinden aus der Bedienung.` : 'Die Bestellliste wird geleert, die Verkäufe bleiben erhalten.',
      input: { placeholder: `Bezeichnung, z. B. Festtag ${new Date().toLocaleDateString('de-DE')}`, max: 60 },
    });
    if (label === false) return;
    try {
      await api('POST', '/api/admin/day', { label });
      toast('Neuer Festtag gestartet');
      day = null;
      load();
    } catch (e) { toast(e.message, { kind: 'error' }); }
  }

  // ---------- Bedienelemente ----------
  root.addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b) return;
    const d = b.dataset;
    if (tab === 'plan' && editor?.click(b)) return;
    if (tab === 'connect' && panel?.click(b)) return;
    if ('printz' in d) { printReport(report); return; }
    if ('savecash' in d) { saveCash(body).then(ok => ok && load()); return; }
    if (d.tab) { tab = d.tab; showAll = false; editor = null; panel = null; body.innerHTML = '<p class="muted">Lade …</p>'; load(); }
    else if (d.csv === 'access') downloadCsv('Anmeldeprotokoll', [['Datum', 'Uhrzeit', 'Ereignis', 'Arbeitsgruppe', 'Gerät', 'Details'],
      ...(access || []).slice().reverse().map(a => [new Date(a.ts).toLocaleDateString('de-DE'), new Date(a.ts).toLocaleTimeString('de-DE'),
        accessText(a), ROLES[a.by?.role]?.label || '', a.by?.device || '', a.type === 'access.changed' ? `für ${ROLES[a.role]?.label || a.role}` : a.ip || ''])]);
    else if (d.csv) csv(d.csv);
    else if ('showall' in d) { showAll = true; draw(); }
    else if ('reload' in d) load();
    else if (d.pin) changePin(d.pin);
    else if ('newday' in d) newDay();
    else if ('plan' in d) showPlan();
    else if ('applyplan' in d) applyPlan();
    else if ('closeplan' in d) { plan = null; drawProducts(); }
    else if (d.delbackup) changeBackup({ dir: d.delbackup, remove: true });
  });
  body.addEventListener('change', e => {
    if (e.target.id === 'a-day') { day = Number(e.target.value); showAll = false; load(); return; }
    if (tab === 'plan') { editor?.change(e.target); return; }
    if (tab === 'connect') { panel?.change(e.target); return; }
    const row = e.target.closest('tr[data-id]');
    if (row && e.target.dataset.a) saveAvailability(row);
    else if (row) saveRow(row);
  });
  body.addEventListener('submit', e => {
    if (e.target.id === 'q-wifi') { e.preventDefault(); panel?.saveWifi(e.target); return; }
    if (e.target.id === 'a-backup') { e.preventDefault(); changeBackup({ dir: e.target.elements.folder.value }); return; }
    if (e.target.id !== 'a-add') return;
    e.preventDefault();
    addProduct(e.target);
  });

  // Live-Änderungen: Auswertung leicht verzögert neu laden, Produktliste nur wenn gerade nichts bearbeitet wird
  function render() {
    // Produktliste nur neu aufbauen, wenn sich an den Produkten etwas geändert hat – sonst ginge bei jeder
    // fremden Bestellung ein gerade laufender Mausklick (z. B. auf ein Häkchen) verloren
    if (tab === 'products' && !body.contains(document.activeElement) && JSON.stringify(live.state.products) !== prodSig) drawProducts();
    if ((tab === 'sales' && !body.contains(document.activeElement?.closest?.('.cashbox'))) || tab === 'day') { clearTimeout(refresh); refresh = setTimeout(() => load(true), 1500); }
  }

  load();
  return { render, destroy: () => clearTimeout(refresh) };
}
