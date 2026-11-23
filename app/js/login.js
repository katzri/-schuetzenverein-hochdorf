// Anmeldung: Arbeitsgruppe wählen, Gerät benennen, PIN über großes Ziffernfeld eingeben –
// oder den QR-Code der Arbeitsgruppe scannen: dann genügt der eigene Name, eine PIN ist nicht nötig.
import { $, esc, api, session, local, ROLES, EMBLEM } from './core.js';

// qr: Anmelde-Code aus dem gescannten Link (z. B. „bedienung.Ab3…“), sonst null
export function loginView(root, qr = null) {
  let role = null, pin = '';
  root.innerHTML = '<div class="login" id="login"></div>';
  const box = $('#login', root);

  // Wer Geld einnimmt, meldet sich mit Namen an: daran hängen die Abholhinweise und die Abrechnung der Geldbeutel.
  const NAMED = {
    bedienung: ['Dein Name (für deine Abholhinweise und die Abrechnung)', 'z. B. Lisa', 'Bitte deinen Namen eintragen'],
    kasse: ['Name dieser Kasse (für die Abrechnung)', 'z. B. Kasse 1', 'Bitte einen Namen für diese Kasse eintragen'],
  };
  const nameField = r => {
    const [label, hint] = NAMED[r] || ['Name dieses Geräts (erscheint im Protokoll)', 'z. B. Küchen-Tablet'];
    return `<label class="lbl">${label}
      <input id="device" class="field" maxlength="30" autocomplete="off" placeholder="${hint}" value="${esc(local.get('svh-device', ''))}"></label>`;
  };
  // true = Name fehlt noch (Hinweis wird angezeigt, es wird nichts gesendet)
  function nameMissing(r) {
    const input = $('#device', box);
    if (!NAMED[r] || input.value.trim().length >= 2) return false;
    $('#err', box).textContent = NAMED[r][2];
    input.focus();
    return true;
  }

  function byQr() {
    const r = qr.split('.')[0];
    box.innerHTML = `<div class="hero">${EMBLEM}<h1>${ROLES[r].icon} ${ROLES[r].label}</h1><p class="muted">QR-Code erkannt – eine PIN ist nicht nötig.</p></div>
      ${nameField(r)}
      <div class="err" id="err"></div>
      <button class="btn" data-qrgo>Los geht’s</button>
      <p class="alt"><button class="link" data-back>Stattdessen mit PIN anmelden</button></p>`;
  }
  async function submitQr() {
    if (nameMissing(qr.split('.')[0])) return;
    const device = $('#device', box).value.trim();
    try {
      const r = await api('POST', '/api/login/qr', { code: qr, device });
      local.set('svh-device', device);
      session.set(r);
      location.reload();
    } catch (e) { $('#err', box).textContent = e.message; }
  }

  function chooseRole() {
    role = null;
    pin = '';
    box.innerHTML = `<div class="hero">${EMBLEM}<h1>Schützenverein Hochdorf</h1><p class="muted">Wer arbeitet an diesem Gerät?</p></div>
      <div class="roles">${Object.entries(ROLES).map(([k, r]) => `<button data-role="${k}" class="r-${k}"><span>${r.icon}</span>${r.label}</button>`).join('')}</div>`;
  }
  function enterPin() {
    box.innerHTML = `<button class="link" data-back>← andere Arbeitsgruppe</button>
      <h1>${ROLES[role].icon} ${ROLES[role].label}</h1>
      ${nameField(role)}
      <div class="pin-dots" id="dots"></div>
      <div class="err" id="err"></div>
      <div class="pinpad">${[1, 2, 3, 4, 5, 6, 7, 8, 9].map(n => `<button data-key="${n}">${n}</button>`).join('')}
        <button data-key="del" aria-label="Ziffer löschen">⌫</button><button data-key="0">0</button><button data-key="ok" class="ok">OK</button></div>`;
    dots();
  }
  const dots = () => {
    $('#dots', box).innerHTML = Array.from({ length: Math.max(4, pin.length) }, (_, i) => `<i class="${i < pin.length ? 'on' : ''}"></i>`).join('');
  };

  async function submit() {
    if (nameMissing(role)) return;
    if (pin.length < 4) { $('#err', box).textContent = 'Bitte mindestens 4 Ziffern eingeben'; return; }
    const device = $('#device', box).value.trim();
    try {
      const r = await api('POST', '/api/login', { role, pin, device });
      local.set('svh-device', device);
      session.set(r);
      location.reload();
    } catch (e) {
      pin = '';
      dots();
      $('#err', box).textContent = e.message;
      const d = $('#dots', box);
      d.classList.remove('shake');
      void d.offsetWidth;
      d.classList.add('shake');
    }
  }
  function press(k) {
    if (k === 'ok') return submit();
    if (k === 'del') pin = pin.slice(0, -1);
    else if (pin.length < 8) pin += k;
    $('#err', box).textContent = '';
    dots();
  }

  box.addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.role) { role = b.dataset.role; enterPin(); }
    else if ('qrgo' in b.dataset) submitQr();
    else if ('back' in b.dataset) chooseRole();
    else if (b.dataset.key) press(b.dataset.key);
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Enter' && e.target.id === 'device' && box.querySelector('[data-qrgo]')) { submitQr(); return; }
    if (!role || e.target.id === 'device') return;
    if (/^\d$/.test(e.key)) press(e.key);
    else if (e.key === 'Backspace') press('del');
    else if (e.key === 'Enter') press('ok');
  });
  if (qr && ROLES[qr.split('.')[0]]) byQr(); else chooseRole();
}
