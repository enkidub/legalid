// legalid.cz — js/kniha/kniha.js
// Vygenerováno refaktoringem z původního monolitického index.html.

import { state } from '../core/state.js';
import { navigate } from '../core/router.js';
import { openDolozkaPreview, updatePreview } from '../dolozka/dolozka.js';
import { getKlienti, renderKlientiList, saveKlienti } from '../klienti/klienti.js';
import { apiClientCreate } from '../core/api.js';
import { esc, showActionToast, showToast } from '../core/ui.js';

export function autoSaveRecord() {
  const v = id => document.getElementById(id)?.value.trim() || '';
  const jmeno = v('fJmeno');
  if (!jmeno && !v('fDatumOver')) return;

  // Save to Knjia
  const record = {
    id: Date.now(),
    datum: v('fDatumOver'), cisloRadku: v('fCisloRadku'), rok: v('fRok'),
    jmeno, datumNar: v('fDatumNar'), mistoNar: v('fMistoNar'),
    adresa: v('fAdresa'), cisloOp: v('fCisloOp'),
    listina: v('fListina'), pocet: v('fPocetVyh'),
    advokat: { ...state.advokat },
  };
  const kniha = getKniha();
  kniha.unshift(record);
  saveKniha(kniha);
  const kb = document.getElementById('knihaBadge');
  if (kb) kb.textContent = kniha.length;

  // Save to Klienti (skip if no name)
  if (!jmeno) return;
  const cisloOp = v('fCisloOp');

  // Přihlášený → centrální evidence v D1 (dedup ve workeru). Generování doložky se nemění.
  if (state.loggedIn) {
    apiClientCreate({
      subject_type: 'fo', name: jmeno, birth_date: v('fDatumNar'), birth_place: v('fMistoNar'),
      address: v('fAdresa'), doc_number: cisloOp, doc_type: cisloOp ? 'OP' : '',
      created_from: 'dolozka',
    }).catch(() => { /* selhání zápisu klienta nesmí ovlivnit doložku */ });
    return;
  }

  // Host (nepřihlášený) — zachováno dnešní chování: localStorage.
  const klientData = {
    jmeno, datumNar: v('fDatumNar'), mistoNar: v('fMistoNar'),
    adresa: v('fAdresa'), cisloOp, posledniOvereni: v('fDatumOver'),
  };
  const klienti = getKlienti();
  const dupIdx = cisloOp ? klienti.findIndex(k => k.cisloOp === cisloOp) : -1;
  if (dupIdx >= 0) {
    const dupId = klienti[dupIdx].id;
    showActionToast(`Klient již evidován. Aktualizovat údaje pro ${jmeno}?`, () => {
      const list = getKlienti();
      const i = list.findIndex(k => k.id === dupId);
      if (i >= 0) { list[i] = { ...list[i], ...klientData }; saveKlienti(list); renderKlientiList(); }
      showToast('Klient aktualizován');
    });
  } else {
    klienti.push({ id: Date.now() + 1, ...klientData });
    saveKlienti(klienti);
    const kb2 = document.getElementById('klientiBadge');
    if (kb2) kb2.textContent = klienti.length + 1;
  }
}

// ── KNIHA PROHLÁŠENÍ ──────────────────────────────────────────────

// Kniha je plná stránka (route /kniha) — open/close jen přepínají route.
export function openKnihaPanel() {
  navigate('/kniha');
}

export function closeKnihaPanel() {
  navigate('/dolozka');
}

// Shell plné stránky Kniha. Po vložení do DOM zavolej renderKnihaList().
export function renderKnihaPage() {
  return `<div class="page"><div class="wrap view-lp">
    <div class="view-lp-head">
      <h1 class="view-lp-title">Kniha prohlášení</h1>
      <span class="lp-badge" id="knihaBadge"></span>
    </div>
    <div class="lp-list" id="knihaList"></div>
  </div></div>`;
}


export function getKniha() {
  try { return JSON.parse(localStorage.getItem('legalid_kniha') || '[]'); }
  catch { return []; }
}


export function saveKniha(data) {
  localStorage.setItem('legalid_kniha', JSON.stringify(data));
}


export function knihaLoad(id) {
  const r = getKniha().find(r => r.id === id);
  if (!r) return;
  const set = (elId, val) => { const el = document.getElementById(elId); if (el) el.value = val || ''; };
  set('fDatumOver', r.datum); set('fCisloRadku', r.cisloRadku); set('fRok', r.rok);
  set('fJmeno', r.jmeno); set('fDatumNar', r.datumNar); set('fMistoNar', r.mistoNar);
  set('fAdresa', r.adresa); set('fCisloOp', r.cisloOp);
  set('fListina', r.listina); set('fPocetVyh', r.pocet);
  updatePreview();
  closeKnihaPanel();
  showToast('Záznam načten do formuláře');
}


export function knihaReprint(id) {
  const r = getKniha().find(r => r.id === id);
  if (!r) return;
  const set = (elId, val) => { const el = document.getElementById(elId); if (el) el.value = val || ''; };
  set('fDatumOver', r.datum); set('fCisloRadku', r.cisloRadku); set('fRok', r.rok);
  set('fJmeno', r.jmeno); set('fDatumNar', r.datumNar); set('fMistoNar', r.mistoNar);
  set('fAdresa', r.adresa); set('fCisloOp', r.cisloOp);
  set('fListina', r.listina); set('fPocetVyh', r.pocet);
  updatePreview();
  closeKnihaPanel();
  openDolozkaPreview();
}


export function knihaEditStart(id) {
  const el = document.getElementById(`lp-knjia-${id}`);
  if (!el) return;
  document.querySelectorAll('.lp-item.lp-editing, .lp-item.lp-confirming').forEach(e => {
    e.classList.remove('lp-editing', 'lp-confirming');
  });
  el.classList.add('lp-editing');
}


export function knihaEditCancel(id) {
  document.getElementById(`lp-knjia-${id}`)?.classList.remove('lp-editing');
}


export function knihaEditSave(id) {
  const get = suffix => document.getElementById(`lp-ke-${suffix}-${id}`)?.value.trim() || '';
  const kniha = getKniha();
  const idx = kniha.findIndex(r => r.id === id);
  if (idx < 0) return;
  kniha[idx] = { ...kniha[idx], datum: get('datum'), cisloRadku: get('cislo'), jmeno: get('jmeno'), listina: get('listina') };
  saveKniha(kniha);
  renderKnihaList();
  showToast('Záznam upraven');
}


export function knihaDeleteConfirm(id) {
  const el = document.getElementById(`lp-knjia-${id}`);
  if (!el) return;
  document.querySelectorAll('.lp-item.lp-editing, .lp-item.lp-confirming').forEach(e => {
    e.classList.remove('lp-editing', 'lp-confirming');
  });
  el.classList.add('lp-confirming');
}


export function knihaDeleteDismiss(id) {
  document.getElementById(`lp-knjia-${id}`)?.classList.remove('lp-confirming');
}


export function knihaDeleteDo(id) {
  saveKniha(getKniha().filter(r => r.id !== id));
  renderKnihaList();
}


export function renderKnihaList() {
  const list = document.getElementById('knihaList');
  if (!list) return;
  const data = getKniha();
  const badge = document.getElementById('knihaBadge');
  if (badge) badge.textContent = data.length || '';
  if (!data.length) {
    list.innerHTML = `<div class="lp-empty">
      <div class="lp-empty-title">Zatím žádné záznamy.</div>
      <div class="lp-empty-sub">Záznamy se ukládají automaticky při tisku nebo stažení.</div>
    </div>`;
    return;
  }
  list.innerHTML = data.map(r => `<div class="lp-item" id="lp-knjia-${r.id}">
    <div class="lp-item-view">
      <div class="lp-item-top">
        <span class="lp-item-name">${esc(r.jmeno || '—')}</span>
        <span class="lp-item-ref">${esc(r.datum || '')}${r.cisloRadku ? ' · ř.'+esc(r.cisloRadku) : ''}</span>
      </div>
      <div class="lp-item-det">${esc(r.listina || '')}</div>
      <div class="lp-item-actions">
        <button class="btn-lp-action" title="Načíst do formuláře" onclick="knihaLoad(${r.id})">↩</button>
        <button class="btn-lp-action" title="Tisknout" onclick="knihaReprint(${r.id})">&#x1F5A8;</button>
        <button class="btn-lp-action" title="Upravit" onclick="knihaEditStart(${r.id})">&#x270E;</button>
        <button class="btn-lp-action danger" title="Smazat" onclick="knihaDeleteConfirm(${r.id})">&#xD7;</button>
      </div>
    </div>
    <div class="lp-item-edit">
      <div class="lp-edit-grid">
        <div class="lp-ef"><label>Datum ověření</label><input id="lp-ke-datum-${r.id}" value="${esc(r.datum||'')}"></div>
        <div class="lp-ef"><label>Č. řádku</label><input id="lp-ke-cislo-${r.id}" value="${esc(r.cisloRadku||'')}"></div>
        <div class="lp-ef full"><label>Jméno</label><input id="lp-ke-jmeno-${r.id}" value="${esc(r.jmeno||'')}"></div>
        <div class="lp-ef full"><label>Listina</label><input id="lp-ke-listina-${r.id}" value="${esc(r.listina||'')}"></div>
      </div>
      <div class="lp-edit-btns">
        <button class="btn-lp-save" onclick="knihaEditSave(${r.id})">Uložit</button>
        <button class="btn-lp-cancel-edit" onclick="knihaEditCancel(${r.id})">Zrušit</button>
      </div>
    </div>
    <div class="lp-item-confirm">
      <div class="lp-confirm-msg">Smazat záznam <strong>${esc(r.jmeno || r.datum || 'tento záznam')}</strong>?</div>
      <div class="lp-confirm-btns">
        <button class="btn-lp-del" onclick="knihaDeleteDo(${r.id})">Smazat</button>
        <button class="btn-lp-cancel-edit" onclick="knihaDeleteDismiss(${r.id})">Zrušit</button>
      </div>
    </div>
  </div>`).join('');
}

// ── KLIENTI ───────────────────────────────────────────────────────
