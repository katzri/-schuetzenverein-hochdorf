// Schießauswertung – Oberfläche. Alle Ergebnisse bleiben auf diesem Gerät (Speicher des Browsers).
(function () {
  'use strict';
  const S = window.Schiessen;
  const $ = id => document.getElementById(id);
  const SPEICHER = 'svh-schiessen-v1';
  const UHR = 'svh-schiessen-uhr';

  // ---------- Speicher ----------
  function laden(key, ersatz) {
    try { const v = JSON.parse(localStorage.getItem(key)); return v == null ? ersatz : v; } catch { return ersatz; }
  }
  function sichern(key, wert) {
    try { localStorage.setItem(key, JSON.stringify(wert)); return true; } catch { return false; }
  }
  let eintraege = laden(SPEICHER, []);
  if (!Array.isArray(eintraege)) eintraege = [];
  const speichern = () => sichern(SPEICHER, eintraege) || melden('Achtung: Speichern auf dem Gerät hat nicht geklappt!', true);

  // ---------- Kleinigkeiten ----------
  let meldTimer;
  function melden(text, fehler) {
    const m = $('meldung');
    m.textContent = text;
    m.className = 'meldung sichtbar' + (fehler ? ' fehler' : '');
    clearTimeout(meldTimer);
    meldTimer = setTimeout(() => { m.className = 'meldung'; }, 2600);
  }
  const vibrieren = () => { try { navigator.vibrate && navigator.vibrate(15); } catch { /* egal */ } };
  const el = (tag, attrs = {}, ...kinder) => {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'class') e.className = v; else if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else e.setAttribute(k, v);
    }
    for (const k of kinder) if (k != null) e.append(k);
    return e;
  };

  // ---------- Reiter ----------
  document.querySelectorAll('[data-tab]').forEach(b => b.addEventListener('click', () => zeigeReiter(b.dataset.tab)));
  function zeigeReiter(name) {
    document.querySelectorAll('[data-tab]').forEach(b => b.classList.toggle('an', b.dataset.tab === name));
    $('eintragen').hidden = name !== 'eintragen';
    $('rangliste').hidden = name !== 'rangliste';
    if (name === 'rangliste') zeigeListe();
    window.scrollTo(0, 0);
  }

  // ---------- Stoppuhr (läuft weiter, auch wenn das Handy kurz gesperrt wird) ----------
  let uhr = laden(UHR, { start: null, stand: 0 });
  let zeitVonHand = false;
  const uhrMs = () => uhr.stand + (uhr.start ? Date.now() - uhr.start : 0);
  function uhrZeigen() {
    $('uhr').textContent = S.zeitText(uhrMs());
    $('uhr').classList.toggle('laeuft', !!uhr.start);
    $('startStopp').textContent = uhr.start ? 'Stopp' : (uhr.stand ? 'Weiter' : 'Start');
    $('startStopp').classList.toggle('rot', !!uhr.start);
    $('startStopp').classList.toggle('gruen', !uhr.start);
  }
  function tick() { uhrZeigen(); if (uhr.start) requestAnimationFrame(tick); }
  $('startStopp').addEventListener('click', () => {
    vibrieren();
    if (uhr.start) {
      uhr = { start: null, stand: uhrMs() };
      $('zeit').value = S.zeitText(uhr.stand).replace(' s', '');
      zeitVonHand = false;
    } else {
      uhr = { start: Date.now(), stand: uhr.stand };
      requestAnimationFrame(tick);
    }
    sichern(UHR, uhr);
    uhrZeigen();
  });
  function uhrNull() {
    uhr = { start: null, stand: 0 };
    sichern(UHR, uhr);
    uhrZeigen();
  }
  $('uhrNull').addEventListener('click', () => { uhrNull(); if (!zeitVonHand) $('zeit').value = ''; });
  $('zeit').addEventListener('input', () => { zeitVonHand = true; $('zeit').classList.remove('falsch'); });
  uhrZeigen();
  if (uhr.start) requestAnimationFrame(tick);

  // ---------- Scheiben 1–5 ----------
  let treffer = Array(S.SCHEIBEN).fill(false);
  const scheibenKnoepfe = treffer.map((_, i) => el('button', {
    type: 'button', class: 'scheibe', 'aria-pressed': 'false', 'aria-label': `Scheibe ${i + 1}`,
    onclick: () => { treffer[i] = !treffer[i]; vibrieren(); trefferZeigen(); },
  }, el('span', {}, String(i + 1))));
  $('scheiben').append(...scheibenKnoepfe);
  // Schnellwahl: Anzahl direkt antippen (füllt die Scheiben von links)
  for (let n = 0; n <= S.SCHEIBEN; n++) {
    $('schnell').append(el('button', {
      type: 'button', class: 'knopf mini',
      onclick: () => { treffer = treffer.map((_, i) => i < n); vibrieren(); trefferZeigen(); },
    }, `${n}`));
  }
  function trefferZeigen() {
    scheibenKnoepfe.forEach((b, i) => { b.classList.toggle('getroffen', treffer[i]); b.setAttribute('aria-pressed', String(treffer[i])); });
    $('trefferZahl').textContent = `${treffer.filter(Boolean).length} / ${S.SCHEIBEN}`;
  }
  trefferZeigen();

  // ---------- Namen-Vorschläge ----------
  function namenAuffrischen() {
    const namen = [...new Set(eintraege.map(e => e.name))].sort((a, b) => a.localeCompare(b, 'de'));
    $('namen').replaceChildren(...namen.map(n => el('option', { value: n })));
    $('anzahl').textContent = eintraege.length ? `(${eintraege.length})` : '';
  }
  namenAuffrischen();

  // ---------- Speichern ----------
  $('form').addEventListener('submit', ev => {
    ev.preventDefault();
    const name = $('name').value.trim().replace(/\s+/g, ' ');
    if (!name) { melden('Bitte einen Namen eintragen.', true); $('name').focus(); return; }
    if (uhr.start) { melden('Die Stoppuhr läuft noch – erst „Stopp“ drücken.', true); return; }
    let zeit = S.zeitLesen($('zeit').value);
    if (zeit === null && uhr.stand) zeit = uhr.stand;
    if (Number.isNaN(zeit)) { $('zeit').classList.add('falsch'); melden('Die Zeit verstehe ich nicht – z. B. 45,3 oder 1:12,5', true); return; }
    if (zeit === null && !confirm('Ohne Zeit speichern?')) return;
    const eintrag = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), name, zeit, treffer: treffer.slice(), datum: Date.now() };
    eintraege.push(eintrag);
    speichern();
    namenAuffrischen();
    const platz = S.rangliste(eintraege, false).find(e => e.id === eintrag.id).platz;
    melden(`Gespeichert: ${name} – ${S.anzahl(eintrag)}/${S.SCHEIBEN} Treffer, ${S.zeitText(zeit)} (Platz ${platz})`);
    // Formular für den nächsten Schützen leeren
    $('name').value = '';
    $('zeit').value = '';
    zeitVonHand = false;
    treffer = treffer.map(() => false);
    trefferZeigen();
    uhrNull();
  });

  // ---------- Rangliste ----------
  $('nurBester').checked = !!laden('svh-schiessen-bester', false);
  $('nurBester').addEventListener('change', () => { sichern('svh-schiessen-bester', $('nurBester').checked); zeigeListe(); });

  function punkte(t) {
    return el('span', { class: 'punkte', 'aria-hidden': 'true' }, ...t.map(x => el('i', { class: x ? 'voll' : '' })));
  }
  function zeigeListe() {
    const liste = S.rangliste(eintraege, $('nurBester').checked);
    $('leer').hidden = liste.length > 0;
    $('alleLoeschen').hidden = eintraege.length === 0;
    $('liste').replaceChildren(...liste.map(e => el('li', { class: 'zeile' + (e.platz <= 3 ? ` p${e.platz}` : ''), onclick: () => details(e) },
      el('span', { class: 'platz' }, `${e.platz}.`),
      el('span', { class: 'wer' }, el('b', {}, e.name),
        el('small', {}, new Date(e.datum).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }))),
      el('span', { class: 'ergebnis' }, el('b', {}, `${e.anzahl}/${S.SCHEIBEN}`), punkte(e.treffer)),
      el('span', { class: 'zeit' }, S.zeitText(e.zeit)),
    )));
  }

  const dlg = $('dlg');
  function details(e) {
    dlg.replaceChildren(el('form', { method: 'dialog' },
      el('h3', {}, e.name),
      el('p', {}, `${e.anzahl} von ${S.SCHEIBEN} Treffern · Zeit ${S.zeitText(e.zeit)}`),
      el('p', { class: 'klein' }, 'Scheiben: ' + e.treffer.map((t, i) => `${i + 1} ${t ? '✔' : '✘'}`).join('  ')),
      el('p', { class: 'klein' }, new Date(e.datum).toLocaleString('de-DE')),
      el('div', { class: 'reihe' },
        el('button', { class: 'knopf rot', value: 'weg', onclick: ev => {
          ev.preventDefault();
          if (!confirm(`Ergebnis von ${e.name} wirklich löschen?`)) return;
          eintraege = eintraege.filter(x => x.id !== e.id);
          speichern(); namenAuffrischen(); dlg.close(); zeigeListe(); melden('Ergebnis gelöscht.');
        } }, 'Löschen'),
        el('button', { class: 'knopf', value: 'zu' }, 'Schließen'))));
    dlg.showModal();
  }

  $('alleLoeschen').addEventListener('click', () => {
    if (!confirm(`Alle ${eintraege.length} Ergebnisse löschen? Tipp: vorher „Teilen / Exportieren“ zur Sicherung.`)) return;
    if (!confirm('Wirklich? Das lässt sich nicht rückgängig machen.')) return;
    eintraege = [];
    speichern(); namenAuffrischen(); zeigeListe(); melden('Alle Ergebnisse gelöscht.');
  });

  // ---------- Export ----------
  $('teilen').addEventListener('click', async () => {
    if (!eintraege.length) return melden('Noch nichts zum Exportieren.', true);
    const tag = new Date().toISOString().slice(0, 10);
    const name = `Schiessauswertung-${tag}.csv`;
    const blob = new Blob([S.csv(eintraege, $('nurBester').checked)], { type: 'text/csv' });
    try {
      const datei = new File([blob], name, { type: 'text/csv' });
      if (navigator.canShare && navigator.canShare({ files: [datei] })) {
        await navigator.share({ files: [datei], title: 'Schießauswertung' });
        return;
      }
    } catch (err) {
      if (err && err.name === 'AbortError') return;
    }
    const a = el('a', { href: URL.createObjectURL(blob), download: name });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  });
  $('drucken').addEventListener('click', () => { zeigeListe(); window.print(); });

  // ---------- Offline-Betrieb (geht nur über https, z. B. GitHub Pages) ----------
  if ('serviceWorker' in navigator && window.isSecureContext) {
    navigator.serviceWorker.register('sw.js').catch(() => { /* ohne Offline-Speicher geht es trotzdem */ });
  }
  // Wird die Seite fürs Drucken vorbereitet, die Rangliste zeigen
  window.addEventListener('beforeprint', () => { if ($('rangliste').hidden) zeigeReiter('rangliste'); });
})();
