// Schießauswertung – Oberfläche. Alle Ergebnisse bleiben auf diesem Gerät (Speicher des Browsers),
// nichts wird ins Internet geschickt.
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

  // ---------- Art: Preisschießen / Pokalschießen ----------
  let art = laden('svh-schiessen-art', 'preis') === 'pokal' ? 'pokal' : 'preis';
  document.querySelectorAll('[data-art]').forEach(b => b.addEventListener('click', () => {
    if (b.dataset.art === art) return;
    art = b.dataset.art;
    sichern('svh-schiessen-art', art);
    vibrieren();
    artZeigen();
  }));
  function artZeigen() {
    document.querySelectorAll('[data-art]').forEach(b => { b.classList.toggle('an', b.dataset.art === art); b.setAttribute('aria-pressed', String(b.dataset.art === art)); });
    document.body.dataset.art = art;
    $('kartePreis').hidden = art !== 'preis';
    $('kartePokal').hidden = art !== 'pokal';
    $('alleLoeschen').textContent = `Alle Ergebnisse vom ${S.ARTEN[art].name} löschen …`;
    namenAuffrischen();
    if (!$('rangliste').hidden) zeigeListe();
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

  // ---------- Preisschießen: 5 Schuss, Treffer ja/nein ----------
  const SCHUSS_PREIS = S.ARTEN.preis.schuesse;
  let treffer = Array(SCHUSS_PREIS).fill(false);
  const scheibenKnoepfe = treffer.map((_, i) => el('button', {
    type: 'button', class: 'scheibe', 'aria-pressed': 'false', 'aria-label': `Schuss ${i + 1}`,
    onclick: () => { treffer[i] = !treffer[i]; vibrieren(); trefferZeigen(); },
  }, el('span', {}, String(i + 1))));
  $('scheiben').append(...scheibenKnoepfe);
  // Schnellwahl: Anzahl direkt antippen (füllt die Scheiben von links)
  for (let n = 0; n <= SCHUSS_PREIS; n++) {
    $('schnell').append(el('button', {
      type: 'button', class: 'knopf mini',
      onclick: () => { treffer = treffer.map((_, i) => i < n); vibrieren(); trefferZeigen(); },
    }, `${n}`));
  }
  function trefferZeigen() {
    scheibenKnoepfe.forEach((b, i) => { b.classList.toggle('getroffen', treffer[i]); b.setAttribute('aria-pressed', String(treffer[i])); });
    $('trefferZahl').textContent = `${treffer.filter(Boolean).length} / ${SCHUSS_PREIS}`;
  }
  trefferZeigen();

  // ---------- Pokalschießen: 3 Schuss, je 1–10 Ringe ----------
  const P = S.ARTEN.pokal;
  let ringe = Array(P.schuesse).fill(null);
  let aktiv = 0;
  const schussFelder = ringe.map((_, i) => el('button', {
    type: 'button', class: 'schuss', 'aria-label': `Schuss ${i + 1}`,
    onclick: () => { aktiv = i; vibrieren(); ringeZeigen(); },
  }, el('small', {}, `Schuss ${i + 1}`), el('b', {}, '–')));
  $('schuesse').append(...schussFelder);
  const tasten = [];
  for (let n = 1; n <= P.ringeMax; n++) tasten.push(el('button', { type: 'button', class: 'knopf taste', onclick: () => ringSetzen(n) }, String(n)));
  tasten.push(el('button', { type: 'button', class: 'knopf taste breit', onclick: () => ringSetzen(0) }, '0 · vorbei'));
  tasten.push(el('button', { type: 'button', class: 'knopf taste breit', onclick: () => { ringe[aktiv] = null; ringeZeigen(); } }, '⌫ löschen'));
  $('tasten').append(...tasten);
  function ringSetzen(n) {
    ringe[aktiv] = n;
    vibrieren();
    // Weiter zum nächsten leeren Schuss
    const frei = ringe.findIndex(r => r == null);
    if (frei >= 0) aktiv = frei;
    ringeZeigen();
  }
  function ringeZeigen() {
    schussFelder.forEach((f, i) => {
      f.classList.toggle('aktiv', i === aktiv);
      f.classList.toggle('voll', ringe[i] != null);
      f.querySelector('b').textContent = ringe[i] == null ? '–' : String(ringe[i]);
    });
    $('ringeSumme').textContent = `${ringe.reduce((s, r) => s + (r || 0), 0)} / ${P.max}`;
  }
  ringeZeigen();

  // ---------- Namen-Vorschläge ----------
  const dieserArt = () => eintraege.filter(e => S.artVon(e) === art);
  function namenAuffrischen() {
    const namen = [...new Set(eintraege.map(e => e.name))].sort((a, b) => a.localeCompare(b, 'de'));
    $('namen').replaceChildren(...namen.map(n => el('option', { value: n })));
    const n = dieserArt().length;
    $('anzahl').textContent = n ? `(${n})` : '';
  }

  // ---------- Speichern ----------
  $('form').addEventListener('submit', ev => {
    ev.preventDefault();
    const name = $('name').value.trim().replace(/\s+/g, ' ');
    if (!name) { melden('Bitte einen Namen eintragen.', true); $('name').focus(); return; }
    if (uhr.start) { melden('Die Stoppuhr läuft noch – erst „Stopp“ drücken.', true); return; }
    let zeit = S.zeitLesen($('zeit').value);
    if (zeit === null && uhr.stand) zeit = uhr.stand;
    if (Number.isNaN(zeit)) { $('zeit').classList.add('falsch'); melden('Die Zeit verstehe ich nicht – z. B. 45,3 oder 1:12,5', true); return; }
    if (art === 'pokal' && ringe.some(r => r == null)) {
      aktiv = ringe.findIndex(r => r == null); ringeZeigen();
      melden(`Bitte alle ${P.schuesse} Schuss eintragen (vorbei = 0).`, true); return;
    }
    if (zeit === null && !confirm('Ohne Zeit speichern?')) return;
    const eintrag = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), art, name, zeit, datum: Date.now() };
    if (art === 'pokal') eintrag.ringe = ringe.slice(); else eintrag.treffer = treffer.slice();
    eintraege.push(eintrag);
    speichern();
    namenAuffrischen();
    const platz = S.rangliste(eintraege, art, false).find(e => e.id === eintrag.id).platz;
    melden(`Gespeichert: ${name} – ${S.wert(eintrag)} ${S.ARTEN[art].einheit}, ${S.zeitText(zeit)} (Platz ${platz} im ${S.ARTEN[art].name})`);
    // Formular für den nächsten Schützen leeren
    $('name').value = '';
    $('zeit').value = '';
    zeitVonHand = false;
    treffer = treffer.map(() => false);
    trefferZeigen();
    ringe = ringe.map(() => null);
    aktiv = 0;
    ringeZeigen();
    uhrNull();
  });

  // ---------- Rangliste ----------
  $('nurBester').checked = !!laden('svh-schiessen-bester', false);
  $('nurBester').addEventListener('change', () => { sichern('svh-schiessen-bester', $('nurBester').checked); zeigeListe(); });

  function punkte(t) {
    return el('span', { class: 'punkte', 'aria-hidden': 'true' }, ...t.map(x => el('i', { class: x ? 'voll' : '' })));
  }
  function ergebnis(e) {
    return art === 'pokal'
      ? el('span', { class: 'ergebnis' }, el('b', {}, String(e.wert)), el('small', { class: 'einzel' }, e.ringe.join(' · ')))
      : el('span', { class: 'ergebnis' }, el('b', {}, `${e.wert}/${SCHUSS_PREIS}`), punkte(e.treffer));
  }
  function zeigeListe() {
    const liste = S.rangliste(eintraege, art, $('nurBester').checked);
    $('leer').textContent = `Noch keine Ergebnisse im ${S.ARTEN[art].name}.`;
    $('leer').hidden = liste.length > 0;
    $('alleLoeschen').hidden = liste.length === 0;
    $('liste').replaceChildren(...liste.map(e => el('li', { class: 'zeile' + (e.platz <= 3 ? ` p${e.platz}` : ''), onclick: () => details(e) },
      el('span', { class: 'platz' }, `${e.platz}.`),
      el('span', { class: 'wer' }, el('b', {}, e.name),
        el('small', {}, new Date(e.datum).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }))),
      ergebnis(e),
      el('span', { class: 'zeit' }, S.zeitText(e.zeit)),
    )));
  }

  const dlg = $('dlg');
  function details(e) {
    dlg.replaceChildren(el('form', { method: 'dialog' },
      el('h3', {}, e.name),
      el('p', { class: 'klein' }, S.ARTEN[art].name),
      el('p', {}, art === 'pokal'
        ? `${e.wert} von ${P.max} Ringen · Zeit ${S.zeitText(e.zeit)}`
        : `${e.wert} von ${SCHUSS_PREIS} Treffern · Zeit ${S.zeitText(e.zeit)}`),
      el('p', { class: 'klein' }, art === 'pokal'
        ? e.ringe.map((r, i) => `Schuss ${i + 1}: ${r}`).join('   ')
        : e.treffer.map((t, i) => `Schuss ${i + 1} ${t ? '✔' : '✘'}`).join('   ')),
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
    const n = dieserArt().length;
    if (!confirm(`Alle ${n} Ergebnisse vom ${S.ARTEN[art].name} löschen? Tipp: vorher „Teilen / Exportieren“ zur Sicherung.`)) return;
    if (!confirm('Wirklich? Das lässt sich nicht rückgängig machen.')) return;
    eintraege = eintraege.filter(e => S.artVon(e) !== art);
    speichern(); namenAuffrischen(); zeigeListe(); melden('Alle Ergebnisse gelöscht.');
  });

  // ---------- Export ----------
  $('teilen').addEventListener('click', async () => {
    if (!dieserArt().length) return melden('Noch nichts zum Exportieren.', true);
    const tag = new Date().toISOString().slice(0, 10);
    const name = `${art === 'pokal' ? 'Pokalschiessen' : 'Preisschiessen'}-${tag}.csv`;
    const blob = new Blob([S.csv(eintraege, art, $('nurBester').checked)], { type: 'text/csv' });
    try {
      const datei = new File([blob], name, { type: 'text/csv' });
      if (navigator.canShare && navigator.canShare({ files: [datei] })) {
        await navigator.share({ files: [datei], title: S.ARTEN[art].name });
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

  artZeigen();

  // ---------- Offline-Betrieb: App auf dem Handy vorhalten (braucht https, also GitHub Pages) ----------
  if ('serviceWorker' in navigator && window.isSecureContext) {
    navigator.serviceWorker.register('sw.js').catch(() => { /* ohne Offline-Speicher geht es trotzdem */ });
  }
  // Den Browser bitten, die Ergebnisse nicht von sich aus aufzuräumen
  try { navigator.storage && navigator.storage.persist && navigator.storage.persist(); } catch { /* egal */ }
  // Wird die Seite fürs Drucken vorbereitet, die Rangliste zeigen
  window.addEventListener('beforeprint', () => { if ($('rangliste').hidden) zeigeReiter('rangliste'); });
})();
