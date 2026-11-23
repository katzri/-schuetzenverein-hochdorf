// Gemeinsame Bausteine: Anmeldung, Server-Anfragen, Live-Daten, sichere Warteschlange
// für Aufträge ohne Verbindung, Hinweise und Dialoge.

export const $ = (sel, root = document) => root.querySelector(sel);
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// Zahl und Einheit zusammenhalten: „0,33 l“ zerfällt am Zeilenende sonst in „0,33“ und ein einsames „l“
export const nb = s => String(s ?? '').replace(/(\d) (?=(?:l|cl|ml)(?![a-zäöüß]))/g, '$1 ');
export const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
// Schreibt HTML nur, wenn es sich geändert hat. Sonst baut jede Live-Nachricht alle Knöpfe neu auf – und ein
// Mausklick, der gerade läuft (gedrückt, noch nicht losgelassen), geht verloren. Nur für Bereiche verwenden,
// die ausschließlich hierüber gefüllt werden.
const drawn = new WeakMap();
export function setHtml(el, html) {
  if (drawn.get(el) === html) return false;
  drawn.set(el, html);
  el.innerHTML = html;
  return true;
}
export const eur = c => (c / 100).toLocaleString('de-DE', { style: 'currency', currency: 'EUR' });
export const parseEur = s => {
  const t = String(s).trim().replace(/\s|€/g, '').replace(',', '.');
  const n = Number(t);
  return t && Number.isFinite(n) ? Math.round(n * 100) : NaN;
};
export const centsText = c => (c / 100).toFixed(2).replace('.', ',');
export const timeOf = (ts, sec = false) => new Date(ts).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', ...(sec ? { second: '2-digit' } : {}) });
export const orderTotal = o => o.items.reduce((s, i) => s + i.price * i.qty, 0);
export const openAmount = o => o.items.reduce((s, i) => s + i.price * (i.qty - (i.paid || 0)), 0);
export const itemText = i => `${i.qty}× ${nb(i.name)}${i.seat ? ` · Pl. ${i.seat}` : ''}${i.note ? ` (${i.note})` : ''}`;
export const VEREIN = 'Schützenverein Hochdorf';
// Schnellwahl „gegeben“: passend und gängige Scheine
export const GIVEN = [['Passend', 'exact'], ['5 €', 500], ['10 €', 1000], ['20 €', 2000], ['50 €', 5000]];

// Druckt einen Beleg oder Bericht über den Browser (Bondrucker oder normaler Drucker am Laptop).
// rows: [links, rechts, Klasse?] · Klassen: 'h' Überschrift, 'b' fett, 'line' Trennlinie, 'c' zentriert
export function printDoc({ title, sub = '', rows, wide = false }) {
  const el = document.getElementById('print');
  el.className = wide ? 'wide' : '';
  el.innerHTML = `<h1>${esc(VEREIN)}</h1><h2>${esc(title)}</h2>${sub ? `<p class="c">${esc(sub)}</p>` : ''}
    ${rows.map(([l, r = '', cls = '']) => (cls === 'line' ? '<hr>' : `<div class="pr ${cls}"><span>${esc(l)}</span><span>${esc(r)}</span></div>`)).join('')}
    <p class="c small">${new Date().toLocaleString('de-DE')}</p>`;
  window.print();
}
// Kurzer Signalton + Vibration (Handy). Der Browser erlaubt Ton erst, nachdem einmal getippt wurde.
let audio = null;
export function signal() {
  try { navigator.vibrate?.([200, 100, 200]); } catch {}
  try {
    audio ||= new (window.AudioContext || window.webkitAudioContext)(); // webkit…: ältere iPhones
    audio.resume?.();
    const osc = audio.createOscillator(), gain = audio.createGain();
    osc.frequency.value = 880;
    gain.gain.value = 0.2;
    osc.connect(gain).connect(audio.destination);
    osc.start();
    osc.stop(audio.currentTime + 0.3);
  } catch {}
}
export const isDone = o => Object.values(o.parts).every(p => p.status === 'abgeholt');
const allTables = layout => (layout?.areas || []).flatMap(a => a.tables);
// Tische mit eigenem Namen (Stammtisch, Dachs) heißen überall so, alle anderen „Tisch <Nr.>“
export const tableName = nr => allTables(live.state.layout).find(t => t.nr === Number(nr))?.name || `Tisch ${nr}`;
export const labelOf = o => (o.name ? `Abholung ${o.name}` : tableName(o.table));
// Plätze sind über den ganzen Plan fortlaufend nummeriert – wie auf dem Platzbelegungsplan
export function seatNumbers(nr, layout = live.state.layout) {
  let from = 1;
  for (const t of allTables(layout)) {
    const n = Number(t.seats) || 0;
    if (t.nr === Number(nr)) return Array.from({ length: n }, (_, i) => from + i);
    from += n;
  }
  return [];
}
export function seatRange(nr, layout) {
  const n = seatNumbers(nr, layout);
  return !n.length ? '' : n.length > 1 ? `Platz ${n[0]}–${n[n.length - 1]}` : `Platz ${n[0]}`;
}
// Zufällige ID – crypto.randomUUID gibt es im Vereins-WLAN (http) nicht, getRandomValues schon
export const uid = () => [...crypto.getRandomValues(new Uint8Array(16))].map(b => b.toString(16).padStart(2, '0')).join('');

export const ROLES = {
  bedienung: { label: 'Bedienung', icon: '🧾' }, kueche: { label: 'Küche', icon: '🍳' },
  theke: { label: 'Theke', icon: '🍺' }, kasse: { label: 'Kasse', icon: '💶' }, admin: { label: 'Verwaltung', icon: '🔒' },
};
export const STATIONS = { kueche: 'Küche', theke: 'Theke' };
export const CATS = {
  essen: 'Essen', bier: 'Bier', wein: 'Wein & Schnaps', alkfrei: 'Alkoholfrei',
  getraenke: 'Sonstige Getränke', kaffee: 'Kaffee & Kuchen', pfand: 'Pfand',
};
export const CAT_ICONS = { essen: '🍽️', bier: '🍺', wein: '🍷', alkfrei: '🥤', getraenke: '🥛', kaffee: '☕', pfand: '♻️' };
// Vereinsemblem (Zielscheibe in Vereinsfarben) – inline, damit es ohne Internet funktioniert
export const EMBLEM = `<svg class="emblem" viewBox="0 0 64 64" aria-hidden="true"><circle cx="32" cy="32" r="31" fill="#c8102e"/>
  <circle cx="32" cy="32" r="25" fill="#fff"/><circle cx="32" cy="32" r="19.5" fill="none" stroke="#1f6b3a" stroke-width="2.5"/>
  <circle cx="32" cy="32" r="13" fill="#1f6b3a"/><circle cx="32" cy="32" r="5.5" fill="#e0a800"/></svg>`;
export const STATUS = { neu: 'Neu', arbeit: 'In Arbeit', fertig: 'Fertig – abholen', abgeholt: 'Abgeholt' };

export const local = {
  get(k, d = null) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
  del(k) { try { localStorage.removeItem(k); } catch {} },
};
export const session = {
  get: () => local.get('svh-session'),
  set: s => local.set('svh-session', s),
  clear: () => local.del('svh-session'),
};

// ---------- Server-Anfragen ----------
export class ApiError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
// Abbruch nach Zeit. AbortSignal.timeout fehlt auf älteren iPhones (iOS 15) – ohne diesen Ersatz hieße es
// dort bei jeder Anfrage „Keine Verbindung“.
function timeoutSignal(ms) {
  if (typeof AbortSignal.timeout === 'function') return AbortSignal.timeout(ms);
  const c = new AbortController();
  setTimeout(() => c.abort(), ms);
  return c.signal;
}
export async function api(method, url, body) {
  const s = session.get();
  let r;
  try {
    r = await fetch(url, {
      method, cache: 'no-store', signal: timeoutSignal(8000),
      headers: { 'Content-Type': 'application/json', ...(s ? { Authorization: `Bearer ${s.token}` } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch { throw new ApiError(0, 'Keine Verbindung zum Server'); }
  const data = await r.json().catch(() => ({}));
  if (r.status === 401 && s && !url.startsWith('/api/login')) { session.clear(); location.reload(); }
  if (!r.ok) throw new ApiError(r.status, data.error || `Fehler ${r.status}`);
  return data;
}

// ---------- Hinweise & Dialoge ----------
// Hinweise laufen nach der Uhrzeit ab, nicht nur per Timer: Steckt das Handy in der Tasche, stehen die
// Timer des Browsers still – sonst tauchen beim Aufwecken längst erledigte Hinweise gesammelt wieder auf.
// Ein Hinweis, der bei ausgeschaltetem Bildschirm entsteht, beginnt seine Zeit erst beim Hinsehen.
const MAX_TOASTS = 4;
function sweepToasts() {
  const t = Date.now();
  document.querySelectorAll('#toasts .toast').forEach(el => {
    if (el.dataset.until) { if (t >= Number(el.dataset.until)) el.remove(); return; }
    if (document.hidden) return;
    el.dataset.until = t + Number(el.dataset.ms);
    setTimeout(sweepToasts, Number(el.dataset.ms) + 20);
  });
}
document.addEventListener('visibilitychange', sweepToasts);
addEventListener('pageshow', sweepToasts);

export function toast(msg, { kind = '', ms = 2800, action = null, onAction = null } = {}) {
  const box = $('#toasts');
  sweepToasts();
  [...box.children].filter(x => x.firstChild.textContent === msg).forEach(x => x.remove()); // derselbe Hinweis nie doppelt
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.setAttribute('role', 'status');
  el.dataset.ms = ms;
  const text = document.createElement('span');
  text.textContent = msg;
  el.append(text);
  if (action) {
    const b = document.createElement('button');
    b.textContent = action;
    b.onclick = () => { el.remove(); onAction?.(); };
    el.append(b);
  }
  box.append(el);
  // nie mehr als vier gleichzeitig: der älteste weicht, Fehlermeldungen zuletzt
  while (box.children.length > MAX_TOASTS) ([...box.children].find(x => x !== el && !x.classList.contains('error')) || box.firstElementChild).remove();
  sweepToasts();
  return el;
}

// Gibt false (abgebrochen), true (bestätigt) oder bei Eingabefeld den eingegebenen Text zurück
export function ask({ title, text = '', ok = 'OK', cancel = 'Abbrechen', danger = false, input = null }) {
  // Sehr alte Browser (iOS vor 15.4) kennen <dialog> noch nicht – dort die schlichte Rückfrage des Browsers nehmen
  if (typeof $('#dlg').showModal !== 'function') {
    const question = `${title}${text ? `\n\n${text}` : ''}`;
    const answer = input ? prompt(question, '') : confirm(question);
    return Promise.resolve(input ? (answer === null ? false : answer.trim()) : answer);
  }
  return new Promise(resolve => {
    const d = $('#dlg');
    d.innerHTML = `<form method="dialog" class="dlg"><h3>${esc(title)}</h3>${text ? `<p>${esc(text)}</p>` : ''}
      ${input ? `<input name="v" class="field" autocomplete="off" maxlength="${input.max || 120}" placeholder="${esc(input.placeholder || '')}"
        ${input.numeric ? 'inputmode="numeric" pattern="[0-9]*"' : ''} ${input.required ? 'required' : ''}>` : ''}
      <div class="dlg-actions"><button value="cancel" class="btn sec" formnovalidate>${esc(cancel)}</button>
      <button value="ok" class="btn ${danger ? 'danger' : ''}">${esc(ok)}</button></div></form>`;
    // Direkt auf Tippen/Escape reagieren statt auf das (teils verzögerte) close-Ereignis
    const finish = v => { d.onsubmit = d.oncancel = null; d.close(); resolve(v); };
    d.onsubmit = e => {
      e.preventDefault();
      finish(e.submitter?.value === 'ok' ? (input ? d.querySelector('[name=v]').value.trim() : true) : false);
    };
    d.oncancel = e => { e.preventDefault(); finish(false); };
    d.showModal();
    (d.querySelector('[name=v]') || d.querySelector('button[value=ok]')).focus();
  });
}

// ---------- Warteschlange: kein Auftrag geht verloren ----------
// Bestellungen und Kassenverkäufe werden ZUERST auf dem Gerät gespeichert und dann gesendet.
// Ohne Verbindung bleiben sie gespeichert (auch nach Neuladen) und werden automatisch nachgesendet.
// Die Auftrags-ID sorgt dafür, dass der Server einen doppelt angekommenen Auftrag nur einmal bucht.
const OUTBOX = 'svh-outbox';
const outboxListeners = new Set();
const results = new Map(), failures = new Map(), awaited = new Set();
let flushing = null;
const retryLater = s => s === 0 || s === 401 || s === 403 || s === 429 || s >= 500;

export const outbox = {
  list: () => local.get(OUTBOX, []),
  save(list) { local.set(OUTBOX, list); outboxListeners.forEach(f => f()); },
  onChange(fn) { outboxListeners.add(fn); return () => outboxListeners.delete(fn); },
  async submit(url, body, info) {
    const id = body.cid;
    awaited.add(id);
    this.save([...this.list(), { id, url, body, info, ts: Date.now() }]);
    await this.flush();
    if (this.list().some(e => e.id === id)) await this.flush();
    awaited.delete(id);
    if (failures.has(id)) { const error = failures.get(id); failures.delete(id); return { error }; }
    if (results.has(id)) { const result = results.get(id); results.delete(id); return { sent: true, result }; }
    return { queued: true };
  },
  flush() {
    if (flushing) return flushing;
    flushing = (async () => {
      for (let next; (next = this.list()[0]);) {
        try {
          results.set(next.id, await api('POST', next.url, next.body));
        } catch (e) {
          if (retryLater(e.status)) break;
          failures.set(next.id, e.message);
          if (!awaited.has(next.id)) toast(`Nicht übernommen: ${next.info?.label || 'Auftrag'} – ${e.message}`, { kind: 'error', ms: 9000 });
        }
        this.save(this.list().filter(x => x.id !== next.id));
        if (!awaited.has(next.id)) { results.delete(next.id); failures.delete(next.id); }
      }
    })().finally(() => { flushing = null; });
    return flushing;
  },
};
setInterval(() => { if (outbox.list().length && session.get()) outbox.flush(); }, 4000);
addEventListener('online', () => outbox.flush());

// ---------- Live-Daten vom Server ----------
const CACHE = 'svh-cache';
export const live = {
  state: { orders: [], nextNr: 1, layout: { areas: [] }, ...local.get(CACHE, { products: [], day: null }) },
  offset: 0,
  online: false,
  loaded: false, // erst true, wenn echte Daten vom Server da sind (vorher: leerer Platzhalter aus dem Gerätespeicher)
  listeners: new Set(),
  connListeners: new Set(),
  subscribe(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); },
  onConn(fn) { this.connListeners.add(fn); fn(this.online); },
  setOnline(v) { if (this.online !== v) { this.online = v; this.connListeners.forEach(f => f(v)); } },
  apply(s) {
    this.offset = s.serverNow - Date.now();
    this.state = s;
    this.loaded = true;
    // Produkte für den Notfall merken: so kann auch ohne Verbindung bestellt werden
    local.set(CACHE, { products: s.products, day: s.day, layout: s.layout });
    this.listeners.forEach(f => f(s));
  },
  async connect() {
    try { this.apply(await api('GET', '/api/state')); this.setOnline(true); } catch {}
    this.listen();
    // Wächter: Reißt das WLAN ab, merkt der Browser das oft minutenlang nicht – die Anzeige stünde weiter auf
    // „verbunden“, obwohl nichts mehr ankommt. Der Server meldet sich alle 10 s; bleibt das 25 s lang aus,
    // gilt die Verbindung als verloren und wird neu aufgebaut. Auch gleich beim Aufwecken des Handys.
    const check = () => { if (Date.now() - this.beat > STALE_MS) { this.setOnline(false); this.listen(); } };
    setInterval(check, 5000);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) check(); });
  },
  listen() {
    this.es?.close();
    this.beat = Date.now();
    const es = this.es = new EventSource(`/api/events?t=${encodeURIComponent(session.get()?.token || '')}`);
    const alive = () => { this.beat = Date.now(); this.setOnline(true); };
    es.onopen = () => { alive(); outbox.flush(); };
    es.onmessage = e => { alive(); this.apply(JSON.parse(e.data)); };
    es.addEventListener('ping', alive);
    es.onerror = () => { this.setOnline(false); api('GET', '/api/me').catch(() => {}); }; // verbindet sich selbst neu
  },
};
const STALE_MS = 25000;
export const now = () => Date.now() + live.offset;
