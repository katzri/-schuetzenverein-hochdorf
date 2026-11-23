// Küchen- und Thekenbildschirm: älteste Bestellung zuerst, Timer, Gesamtmengen, Ton bei neuen
// Bestellungen, „Rückgängig“ nach jedem Tippen, deutliche Warnung bei Stornos, Hinweise pro
// Position und „Ausverkauft“/Stückzahl für die eigenen Produkte.
import { $, esc, nb, setHtml, api, live, toast, ask, now, labelOf, STATIONS } from './core.js';

const WARN_MIN = 10, LATE_MIN = 15;
const DONE_TEXT = { arbeit: 'in Arbeit', fertig: 'fertig', abgeholt: 'abgeholt', neu: 'zurück auf neu' };

export const stationView = st => root => {
  root.innerHTML = `<section class="panel dark">
    <div class="k-head"><span class="station-title t-${st}">${STATIONS[st]}</span><div class="summary" id="s-sum"></div>
      <button class="tool-dark" id="s-offer">📦 Ausverkauft melden</button>
      <button class="tool-dark" id="s-awake">🔔 Ton & Bildschirm an</button></div>
    <div class="stock" id="s-stock" hidden></div>
    <div class="k-cols"><div class="queue" id="s-queue"></div>
      <div class="ready"><h3>Abholbereit</h3><div id="s-ready"></div></div></div>
  </section>`;
  const el = id => $(`#${id}`, root);
  let seen = null, inQueue = new Set(), audio = null, wake = null, showStock = false;
  const sig = new Map(); // Bestellung → Positionen, um Teil-Stornos zu bemerken
  const flash = new Map(); // neue Bestellung → blinkt bis zu diesem Zeitpunkt
  const itemsOf = o => o.items.filter(i => i.station === st && i.qty > 0);

  const minutes = ts => (now() - ts) / 60000;
  const ageClass = ts => (minutes(ts) >= LATE_MIN ? 'late' : minutes(ts) >= WARN_MIN ? 'warn' : '');
  const elapsed = ts => {
    const s = Math.max(0, Math.floor((now() - ts) / 1000));
    if (s >= 3600) return `${Math.floor(s / 3600)}:${String(Math.floor(s / 60) % 60).padStart(2, '0')} Std`;
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')} min`;
  };

  function render(state) {
    const mine = state.orders.filter(o => o.parts[st]);
    const queue = mine.filter(o => !o.cancelled && ['neu', 'arbeit'].includes(o.parts[st].status)).sort((a, b) => a.createdAt - b.createdAt);
    const ready = mine.filter(o => !o.cancelled && o.parts[st].status === 'fertig').sort((a, b) => a.parts[st].t - b.parts[st].t);

    // Storno einer Bestellung, die gerade in der Liste war → nicht übersehbar melden
    mine.filter(o => o.cancelled && inQueue.has(o.id)).forEach(o => {
      toast(`✖ Nr. ${o.nr} (${labelOf(o)}) wurde storniert – nicht mehr zubereiten!`, { kind: 'error', ms: 12000 });
      beep();
    });
    // Einzelne Position storniert, während die Bestellung in der Liste steht
    queue.forEach(o => {
      const now_ = itemsOf(o).map(i => `${i.qty}|${i.name}|${i.note || ''}|${i.seat || ''}`).join(';');
      if (sig.has(o.id) && sig.get(o.id) !== now_) {
        toast(`✖ Nr. ${o.nr} (${labelOf(o)}) wurde geändert – eine Position ist storniert!`, { kind: 'error', ms: 12000 });
        beep();
      }
      sig.set(o.id, now_);
    });
    inQueue = new Set(queue.map(o => o.id));
    // „neu“ ist nur, was nach den ersten echten Server-Daten dazukommt – sonst blinkt nach einem Start ohne Verbindung alles
    const fresh = seen ? queue.filter(o => !seen.has(o.id)) : [];
    if (live.loaded) seen = new Set([...(seen || []), ...queue.map(o => o.id)]);
    const t = Date.now();
    for (const [id, until] of flash) if (until <= t) flash.delete(id);
    fresh.forEach(o => flash.set(o.id, t + 3000));

    const totals = new Map();
    queue.forEach(o => itemsOf(o).forEach(i => totals.set(i.name, (totals.get(i.name) || 0) + i.qty)));
    setHtml(el('s-sum'), totals.size
      ? [...totals].sort((a, b) => b[1] - a[1]).map(([n, q]) => `<span><b>${q}×</b>${esc(nb(n))}</span>`).join('')
      : '<span class="muted">Nichts offen</span>');

    // Die laufende Zeit und die Warnfarben setzt tick() – stünden sie im HTML, würde jede Sekunde alles neu
    // aufgebaut, und ein Klick mit der Maus genau in diesem Moment ginge verloren.
    setHtml(el('s-queue'), queue.map((o, idx) => {
      const s = o.parts[st].status;
      return `<div class="card ${s} ${flash.has(o.id) ? 'flash' : ''}">
        <div class="ch"><div><div class="pos">#${idx + 1} · Nr. ${o.nr}${o.name ? ' · Abholung' : ''}</div>
          <div class="tblname ${o.name ? 'pickup' : ''}">${o.name ? `🛍️ ${esc(o.name)}` : esc(labelOf(o))}</div></div>
          <div class="time" data-since="${o.createdAt}"></div></div>
        <ul>${itemsOf(o).map(i => `<li><b>${i.qty}×</b> ${esc(nb(i.name))}${i.seat ? ` <span class="iseat">Platz ${i.seat}</span>` : ''}${i.note ? `<span class="inote">➜ ${esc(i.note)}</span>` : ''}</li>`).join('')}</ul>
        ${o.note ? `<div class="note">⚠ ${esc(o.note)}</div>` : ''}
        <button class="kbtn" data-status="${o.id}|${s === 'neu' ? 'arbeit' : 'fertig'}|${s}">${s === 'neu' ? 'Zubereitung starten' : 'Fertig ✓'}</button>
      </div>`;
    }).join('') || '<div class="k-empty">Keine offenen Bestellungen 👍</div>');

    setHtml(el('s-ready'), ready.map(o => `<div class="r"><span><b>${o.name ? '🛍️ ' : ''}${esc(labelOf(o))}</b> · Nr. ${o.nr}</span>
      <button data-status="${o.id}|abgeholt|fertig">Abgeholt</button></div>`).join('') || '<div class="muted">–</div>');

    tick();
    if (fresh.length) beep();
    drawStock(state);
  }

  // Laufende Wartezeit und Warnfarben (ab 10 Min. orange, ab 15 Min. rot) – jede Sekunde und nach jedem Zeichnen
  function tick() {
    root.querySelectorAll('[data-since]').forEach(box => {
      const ts = Number(box.dataset.since), age = ageClass(ts);
      box.textContent = elapsed(ts);
      box.className = `time ${age}`;
      box.closest('.card')?.classList.toggle('late', age === 'late');
    });
  }

  // Eigene Produkte: ausverkauft melden oder Stückzahl hinterlegen (zählt mit jeder Bestellung herunter)
  function drawStock(state) {
    const box = el('s-stock');
    const list = state.products.filter(p => p.active && p.station === st);
    const out = list.filter(p => p.soldOut).length;
    el('s-offer').textContent = out ? `📦 ${out} ausverkauft` : '📦 Ausverkauft melden';
    el('s-offer').classList.toggle('alarm', out > 0);
    box.hidden = !showStock;
    if (!showStock) return;
    setHtml(box, list.map(p => `<div class="sp ${p.soldOut ? 'out' : ''}"><span>${esc(nb(p.name))}<small>${p.soldOut ? 'ausverkauft' : p.stock !== null && p.stock !== undefined ? `noch ${p.stock} Stück` : 'verfügbar'}</small></span>
      <span><button data-count="${p.id}">Stückzahl</button><button data-out="${p.id}" class="${p.soldOut ? 'on' : ''}">${p.soldOut ? 'Wieder da' : 'Ausverkauft'}</button></span></div>`).join('')
      || '<span class="muted">Keine Produkte für diese Station.</span>');
  }

  async function availability(id, body) {
    try { await api('POST', `/api/products/${id}/availability`, body); } catch (e) { toast(e.message, { kind: 'error' }); }
  }
  async function setCount(id) {
    const p = live.state.products.find(x => x.id === id);
    if (!p) return;
    const v = await ask({ title: `Wie viele ${p.name} gibt es noch?`, text: 'Zählt mit jeder Bestellung herunter; bei 0 automatisch ausverkauft. Leer = unbegrenzt.', ok: 'Speichern',
      input: { placeholder: 'Stückzahl, z. B. 40', numeric: true, max: 4 } });
    if (v === false) return;
    availability(id, v === '' ? { soldOut: false, stock: null } : { stock: Number(v) });
  }

  // btn: der angetippte Knopf – bleibt gesperrt, bis der neue Stand da ist; bei einem Fehler wieder frei
  async function setStatus(id, status, prev, offerUndo, btn = null) {
    const o = live.state.orders.find(x => x.id === id);
    try {
      await api('POST', `/api/orders/${id}/status`, { station: st, status });
      if (offerUndo && o) {
        toast(`Nr. ${o.nr} (${labelOf(o)}) ${DONE_TEXT[status]}`, { action: 'Rückgängig', onAction: () => setStatus(id, prev, status, false), ms: 6000 });
      }
    } catch (e) {
      toast(e.message, { kind: 'error' });
      if (btn) btn.disabled = false;
      render(live.state);
    }
  }

  function beep() {
    try {
      audio ||= new (window.AudioContext || window.webkitAudioContext)();
      const osc = audio.createOscillator(), gain = audio.createGain();
      osc.frequency.value = 880;
      gain.gain.value = 0.2;
      osc.connect(gain).connect(audio.destination);
      osc.start();
      osc.stop(audio.currentTime + 0.3);
    } catch {}
  }

  // Ton freischalten (Browser erlauben ihn erst nach einem Tippen), Vollbild, Bildschirm wach halten
  async function awaken() {
    try { audio ||= new (window.AudioContext || window.webkitAudioContext)(); await audio.resume(); beep(); } catch {}
    try { if (!document.fullscreenElement) await document.documentElement.requestFullscreen(); } catch {}
    try { if ('wakeLock' in navigator) wake = await navigator.wakeLock.request('screen'); } catch {}
    el('s-awake').textContent = '🔔 Ton an';
    if (!wake) toast('Tipp: In den Geräte-Einstellungen die Bildschirm-Abschaltung auf „Nie“ stellen.', { ms: 8000 });
  }
  const onVisible = async () => {
    if (wake && document.visibilityState === 'visible') { try { wake = await navigator.wakeLock.request('screen'); } catch {} }
  };
  document.addEventListener('visibilitychange', onVisible);

  root.addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.id === 's-awake') { awaken(); return; }
    if (b.id === 's-offer') { showStock = !showStock; drawStock(live.state); return; }
    if (b.dataset.out) { const p = live.state.products.find(x => x.id === b.dataset.out); if (p) availability(p.id, { soldOut: !p.soldOut, stock: p.soldOut ? null : p.stock }); return; }
    if (b.dataset.count) { setCount(b.dataset.count); return; }
    if (b.dataset.status) {
      const [id, next, prev] = b.dataset.status.split('|');
      b.disabled = true;
      setStatus(id, next, prev, true, b);
    }
  });

  const timer = setInterval(tick, 1000);

  return {
    render,
    destroy() {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
      wake?.release?.().catch(() => {});
    },
  };
};
