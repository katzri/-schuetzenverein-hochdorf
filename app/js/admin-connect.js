// Verwaltung, Teil 3 – „QR-Codes“: Handys in Sekunden einrichten. Der erste QR-Code verbindet mit dem
// WLAN, der zweite öffnet die App und meldet die Arbeitsgruppe ohne PIN an. Beides auch als Aushang.
import { esc, api, toast, local, ROLES, VEREIN } from './core.js';

const LINK = 'link'; // Auswahl „Nur Link“: App öffnen, Anmeldung wie gewohnt mit PIN

// QR-Code (Zeilen aus 0/1 vom Server) als Vektorgrafik, mit dem vorgeschriebenen hellen Rand von 4 Feldern
function qrSvg({ size, rows }) {
  const q = 4, n = size + 2 * q;
  let d = '';
  rows.forEach((row, y) => {
    for (let x = 0; x < size; x++) {
      if (row[x] !== '1') continue;
      let w = 1;
      while (row[x + w] === '1') w++;
      d += `M${x + q} ${y + q}h${w}v1h-${w}z`;
      x += w - 1;
    }
  });
  return `<svg class="qr" viewBox="0 0 ${n} ${n}" shape-rendering="crispEdges" role="img" aria-label="QR-Code"><rect width="${n}" height="${n}" fill="#fff"/><path d="${d}"/></svg>`;
}

export function connectPanel(body) {
  let info = null, base = null, role = local.get('svh-qr-role', 'bedienung');

  async function load() {
    info = await api('GET', `/api/admin/connect?base=${encodeURIComponent(base || location.origin)}`);
    base = info.base;
  }
  const login = () => info.logins.find(l => l.role === role) || null; // null = nur Link, Anmeldung mit PIN
  const target = () => login() || info.link;

  function draw() {
    if (!info) return;
    const w = info.wifi, t = target(), free = Boolean(login());
    body.innerHTML = `<div class="explain">Zwei QR-Codes machen ein Handy in Sekunden startklar: Der erste verbindet es mit dem WLAN, der zweite
        öffnet die App und meldet die gewählte Arbeitsgruppe <b>ohne PIN</b> an. Einfach mit der Kamera des Handys scannen – vom Bildschirm oder vom Ausdruck.</div>
      <h2>WLAN der FRITZ!Box</h2>
      <form class="wifiform" id="q-wifi">
        <label>WLAN-Name<input class="field" name="ssid" maxlength="32" autocomplete="off" spellcheck="false" value="${esc(w?.ssid || '')}" placeholder="z. B. FRITZ!Box 7530 AB"></label>
        <label>WLAN-Passwort<input class="field" name="password" maxlength="64" autocomplete="off" spellcheck="false" value="${esc(w?.password || '')}" placeholder="steht auf der Unterseite der FRITZ!Box"></label>
        <button class="btn">Speichern</button></form>
      <h2>Für wen ist der Code?</h2>
      <div class="seg2 qroles">${[...info.logins.map(l => l.role), LINK].map(k => `<button data-qrole="${k}" class="${k === (free ? role : LINK) ? 'on' : ''}">${k === LINK ? '🔗 Nur Link (mit PIN)' : `${ROLES[k].icon} ${ROLES[k].label}`}</button>`).join('')}</div>
      ${info.addresses.length > 1 ? `<label class="lbl">Adresse des Laptops im WLAN<select id="q-base" class="field">${info.addresses.map(a => `<option ${a === info.base ? 'selected' : ''}>${esc(a)}</option>`).join('')}</select></label>` : ''}
      <div class="qrs">
        <div class="qrcard"><h3>① Mit dem WLAN verbinden</h3>${w
          ? `${qrSvg(w.qr)}<p><b>${esc(w.ssid)}</b><br><small>${w.password ? `Passwort: ${esc(w.password)}` : 'offenes WLAN ohne Passwort'}</small></p>`
          : '<p class="muted">Oben WLAN-Name und Passwort eintragen und speichern – dann erscheint hier der QR-Code.</p>'}</div>
        <div class="qrcard"><h3>② App öffnen${free ? ' – ohne PIN' : ''}</h3>${t
          ? `${qrSvg(t.qr)}<p><b>${free ? `${ROLES[role].icon} ${ROLES[role].label}` : 'Anmeldung mit PIN'}</b><br><small>${esc(info.base)}</small></p>`
          : '<p class="alert">Der Server-Laptop ist mit keinem Netzwerk verbunden. Erst mit dem WLAN der FRITZ!Box verbinden, dann aktualisieren.</p>'}</div>
      </div>
      <div class="toolbar qrtools"><button class="btn" data-qrprint ${t ? '' : 'disabled'}>🖨 Aushang drucken</button><button class="small" data-reload>↻ Aktualisieren</button></div>
      <p class="muted">Der Anmelde-Code einer Arbeitsgruppe gilt, bis ihre PIN geändert wird („Zugänge“ → PIN ändern) – damit wird ein verlorener Ausdruck sofort wertlos.
        Wer scannt, trägt nur noch seinen Namen ein; die Anmeldung steht wie jede andere im Anmeldeprotokoll. Die Verwaltung meldet sich immer mit PIN an.</p>
      <p class="muted">Die Codes enthalten die Adresse dieses Laptops im aktuellen WLAN${info.base ? ` (<code>${esc(info.base)}</code>)` : ''}. In einem anderen WLAN oder nach einem Adresswechsel
        bitte neu drucken – am besten in der FRITZ!Box für den Laptop „Immer die gleiche IPv4-Adresse zuweisen“ einschalten.</p>`;
  }

  // Aushang: beide Codes untereinander mit kurzer Anleitung (passt auf A4 und auf den Bondrucker)
  function print() {
    const w = info.wifi, t = target(), free = Boolean(login());
    if (!t) return;
    const el = document.getElementById('print');
    el.className = 'sheet';
    el.innerHTML = `<h1>${esc(VEREIN)}</h1><h2>Handy einrichten${free ? ` – ${esc(ROLES[role].label)}` : ''}</h2>
      ${w ? `<div class="step"><b>1. Mit dem WLAN verbinden</b>${qrSvg(w.qr)}
        <p>Kamera öffnen, den Code scannen und „Verbinden“ antippen.<br>WLAN: <b>${esc(w.ssid)}</b>${w.password ? ` · Passwort: <b>${esc(w.password)}</b>` : ''}</p>
        <p class="hint">Meldet das Handy „Kein Internet“: „Verbunden bleiben“ bzw. „Trotzdem verwenden“ wählen – dieses WLAN hat absichtlich kein Internet.</p></div>` : ''}
      <div class="step"><b>${w ? '2. ' : ''}App öffnen</b>${qrSvg(t.qr)}
        <p>${free ? 'Den Code scannen, den Link öffnen und den eigenen Namen eintragen – fertig. Eine PIN ist nicht nötig.' : 'Den Code scannen, den Link öffnen, die Arbeitsgruppe wählen und die PIN eingeben.'}
        <br>Adresse: <b>${esc(info.base)}</b></p>
        ${w ? '' : '<p class="hint">Vorher das Handy mit dem WLAN der FRITZ!Box verbinden.</p>'}</div>
      <p class="foot">${free ? 'Nur für Helfer – bitte nicht öffentlich aushängen · ' : ''}${new Date().toLocaleDateString('de-DE')}</p>`;
    window.print();
  }

  async function saveWifi(form) {
    try {
      await api('POST', '/api/admin/wifi', { ssid: form.ssid.value, password: form.password.value });
      await load();
      toast(info.wifi ? 'WLAN-Daten gespeichert – der QR-Code ist fertig' : 'WLAN-Daten gelöscht');
      draw();
    } catch (e) { toast(e.message, { kind: 'error', ms: 6000 }); }
  }

  // true = Klick gehörte zu den QR-Codes
  function click(b) {
    const d = b.dataset;
    if (d.qrole) { role = d.qrole; local.set('svh-qr-role', role); draw(); }
    else if ('qrprint' in d) print();
    else return false;
    return true;
  }
  async function change(input) {
    if (input.id !== 'q-base') return;
    base = input.value;
    try { await load(); } catch (e) { toast(e.message, { kind: 'error' }); }
    draw();
  }

  return { load, draw, click, change, saveWifi };
}
