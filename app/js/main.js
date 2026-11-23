// Einstieg: Anmeldung prüfen, Live-Verbindung aufbauen, passende Ansicht für die Arbeitsgruppe zeigen.
import { $, esc, live, session, outbox, ROLES, ask, api, EMBLEM } from './core.js';
import { loginView } from './login.js';
import { waiterView } from './waiter.js';
import { stationView } from './station.js';
import { kasseView } from './kasse.js';
import { adminView } from './admin.js';

const VIEWS = { bedienung: waiterView, kueche: stationView('kueche'), theke: stationView('theke'), kasse: kasseView, admin: adminView };
let current = null, unsubscribe = null;

function header(s, key) {
  const nav = s.role === 'admin'
    ? `<nav class="seg">${Object.keys(VIEWS).map(k => `<button data-view="${k}" class="${k === key ? 'on' : ''}"><i>${ROLES[k].icon}</i> ${ROLES[k].label}</button>`).join('')}</nav>`
    : '';
  $('#top').innerHTML = `<div class="brand">${EMBLEM}<div>Schützenverein Hochdorf<small>${ROLES[s.role].icon} ${ROLES[s.role].label} · ${esc(s.device)}</small></div></div>
    ${nav}<span class="outbox" id="outboxBadge" hidden></span><span class="conn" id="conn"></span>
    <button class="tool" id="btnLogout">Abmelden</button>`;
  updateConn(live.online);
  updateOutbox();
}
function updateConn(ok) {
  const el = $('#conn');
  if (!el) return;
  // am Handy zeigt „verbunden“ nur den Punkt (spart Platz) – „keine Verbindung“ steht immer ausgeschrieben da
  el.innerHTML = ok ? '● <span>verbunden</span>' : '● keine Verbindung';
  el.className = `conn ${ok ? 'ok' : 'bad'}`;
  el.title = ok ? 'Mit dem Server verbunden' : 'Keine Verbindung zum Server';
}
function updateOutbox() {
  const el = $('#outboxBadge');
  if (!el) return;
  const n = outbox.list().length;
  el.hidden = !n;
  el.textContent = `⏳ ${n} wartet auf Versand`;
}

function show(key) {
  current?.destroy?.();
  unsubscribe?.();
  header(session.get(), key);
  const main = $('#view');
  main.innerHTML = '';
  current = VIEWS[key](main, session.get());
  unsubscribe = live.subscribe(st => current.render(st));
  current.render(live.state);
}

async function start() {
  const s = session.get();
  // QR-Code gescannt: Der Link bringt den Anmelde-Code der Arbeitsgruppe mit (#qr=…). Er wird sofort aus der
  // Adresszeile genommen. Ist das Gerät schon für diese Gruppe angemeldet, geht es einfach weiter.
  const code = location.hash.match(/^#qr=([a-z]+\.[\w-]+)$/)?.[1];
  if (code) history.replaceState(null, '', location.pathname);
  if (code && s?.role !== code.split('.')[0]) { loginView($('#view'), code); return; }
  if (!s || !ROLES[s.role]) { loginView($('#view')); return; }
  live.onConn(updateConn);
  outbox.onChange(updateOutbox);
  $('#view').innerHTML = '<p class="starting">Verbinde mit dem Server …</p>';
  await live.connect();
  const wanted = location.hash.slice(1);
  show(s.role === 'admin' && VIEWS[wanted] ? wanted : s.role);
}

document.addEventListener('click', async e => {
  const v = e.target.closest('[data-view]');
  if (v) { history.replaceState(null, '', `#${v.dataset.view}`); show(v.dataset.view); return; }
  if (!e.target.closest('#btnLogout')) return;
  const n = outbox.list().length;
  const ok = await ask({
    title: 'Abmelden?',
    text: n ? `Achtung: ${n} Auftrag/Aufträge sind noch nicht beim Server. Sie bleiben auf diesem Gerät gespeichert und werden nach der nächsten Anmeldung gesendet.` : 'Danach ist wieder eine PIN nötig.',
    ok: 'Abmelden', danger: n > 0,
  });
  if (!ok) return;
  await api('POST', '/api/logout').catch(() => {});
  session.clear();
  history.replaceState(null, '', location.pathname);
  location.reload();
});
// Öffnet das Handy den gescannten Link in einem schon offenen Fenster, ändert sich nur der Teil hinter „#“
addEventListener('hashchange', () => { if (location.hash.startsWith('#qr=')) location.reload(); });

start();
