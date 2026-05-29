// legalid.cz — js/klienti/klienti.js
// Vygenerováno refaktoringem z původního monolitického index.html.

import { navigate } from '../core/router.js';
import { updatePreview } from '../dolozka/dolozka.js';
import { esc, showToast } from '../core/ui.js';

// Klienti jsou plná stránka (route /klienti) — open/close jen přepínají route.
export function openKlientiPanel() {
  navigate('/klienti');
}

export function closeKlientiPanel() {
  navigate('/dolozka');
}

// Shell plné stránky Klienti. Po vložení do DOM zavolej renderKlientiList().
export function renderKlientiPage() {
  return `<div class="page"><div class="wrap view-lp">
    <div class="view-lp-head">
      <h1 class="view-lp-title">Klienti</h1>
      <span class="lp-badge" id="klientiBadge"></span>
    </div>
    <input class="lp-search" id="klientiSearch" type="search" placeholder="Hledat jméno, IČO…" oninput="renderKlientiList()">
    <div class="lp-list" id="klientiList"></div>
  </div></div>`;
}


export function getKlienti() {
  try { return JSON.parse(localStorage.getItem('legalid_klienti') || '[]'); }
  catch { return []; }
}


export function saveKlienti(data) {
  localStorage.setItem('legalid_klienti', JSON.stringify(data));
}


export function klientiLoad(id) {
  const k = getKlienti().find(k => k.id === id);
  if (!k) return;
  const set = (elId, val) => { const el = document.getElementById(elId); if (el) el.value = val || ''; };
  set('fJmeno', k.jmeno); set('fDatumNar', k.datumNar); set('fMistoNar', k.mistoNar);
  set('fAdresa', k.adresa); set('fCisloOp', k.cisloOp);
  updatePreview();
  closeKlientiPanel();
  showToast('Údaje klienta načteny');
}


export function klientiEditStart(id) {
  const el = document.getElementById(`lp-klnt-${id}`);
  if (!el) return;
  document.querySelectorAll('.lp-item.lp-editing, .lp-item.lp-confirming').forEach(e => {
    e.classList.remove('lp-editing', 'lp-confirming');
  });
  el.classList.add('lp-editing');
}


export function klientiEditCancel(id) {
  document.getElementById(`lp-klnt-${id}`)?.classList.remove('lp-editing');
}


export function klientiEditSave(id) {
  const get = suffix => document.getElementById(`lp-ke2-${suffix}-${id}`)?.value.trim() || '';
  const klienti = getKlienti();
  const idx = klienti.findIndex(k => k.id === id);
  if (idx < 0) return;
  klienti[idx] = { ...klienti[idx], jmeno: get('jmeno'), datumNar: get('datumnar'), mistoNar: get('mistonar'), adresa: get('adresa'), cisloOp: get('cisloop') };
  saveKlienti(klienti);
  renderKlientiList();
  showToast('Klient upraven');
}


export function klientiDeleteConfirm(id) {
  const el = document.getElementById(`lp-klnt-${id}`);
  if (!el) return;
  document.querySelectorAll('.lp-item.lp-editing, .lp-item.lp-confirming').forEach(e => {
    e.classList.remove('lp-editing', 'lp-confirming');
  });
  el.classList.add('lp-confirming');
}


export function klientiDeleteDismiss(id) {
  document.getElementById(`lp-klnt-${id}`)?.classList.remove('lp-confirming');
}


export function klientiDeleteDo(id) {
  saveKlienti(getKlienti().filter(k => k.id !== id));
  renderKlientiList();
}


export function renderKlientiList() {
  const list = document.getElementById('klientiList');
  if (!list) return;
  const query = (document.getElementById('klientiSearch')?.value || '').toLowerCase().trim();
  let data = getKlienti();
  if (query) data = data.filter(k =>
    (k.jmeno||'').toLowerCase().includes(query) ||
    (k.cisloOp||'').toLowerCase().includes(query) ||
    (k.adresa||'').toLowerCase().includes(query)
  );
  data.sort((a, b) => {
    const ln = s => { const p=(s||'').trim().split(/\s+/); return (p[p.length-1]||'').toLowerCase(); };
    return ln(a.jmeno).localeCompare(ln(b.jmeno), 'cs');
  });
  const badge = document.getElementById('klientiBadge');
  if (badge) badge.textContent = getKlienti().length || '';
  if (!data.length) {
    list.innerHTML = `<div class="lp-empty"><div class="lp-empty-title">${esc(query ? 'Žádný výsledek.' : 'Zatím nemáte uložené žádné klienty.')}</div></div>`;
    return;
  }
  list.innerHTML = data.map(k => `<div class="lp-item" id="lp-klnt-${k.id}">
    <div class="lp-item-view">
      <div class="lp-item-top">
        <span class="lp-item-name">${esc(k.jmeno || '—')}</span>
        <span class="lp-item-ref">${k.cisloOp ? 'OP '+esc(k.cisloOp) : ''}</span>
      </div>
      <div class="lp-item-det">nar. ${esc(k.datumNar || '—')}${k.mistoNar ? ', '+esc(k.mistoNar) : ''}</div>
      <div class="lp-item-actions">
        <button class="btn-lp-action" title="Načíst do formuláře" onclick="klientiLoad(${k.id})">↩</button>
        <button class="btn-lp-action" title="Upravit" onclick="klientiEditStart(${k.id})">&#x270E;</button>
        <button class="btn-lp-action danger" title="Smazat" onclick="klientiDeleteConfirm(${k.id})">&#xD7;</button>
      </div>
    </div>
    <div class="lp-item-edit">
      <div class="lp-edit-grid">
        <div class="lp-ef full"><label>Jméno</label><input id="lp-ke2-jmeno-${k.id}" value="${esc(k.jmeno||'')}"></div>
        <div class="lp-ef"><label>Datum nar.</label><input id="lp-ke2-datumnar-${k.id}" value="${esc(k.datumNar||'')}"></div>
        <div class="lp-ef"><label>Místo nar.</label><input id="lp-ke2-mistonar-${k.id}" value="${esc(k.mistoNar||'')}"></div>
        <div class="lp-ef full"><label>Adresa</label><input id="lp-ke2-adresa-${k.id}" value="${esc(k.adresa||'')}"></div>
        <div class="lp-ef full"><label>Číslo OP</label><input id="lp-ke2-cisloop-${k.id}" value="${esc(k.cisloOp||'')}"></div>
      </div>
      <div class="lp-edit-btns">
        <button class="btn-lp-save" onclick="klientiEditSave(${k.id})">Uložit</button>
        <button class="btn-lp-cancel-edit" onclick="klientiEditCancel(${k.id})">Zrušit</button>
      </div>
    </div>
    <div class="lp-item-confirm">
      <div class="lp-confirm-msg">Smazat klienta <strong>${esc(k.jmeno || 'tohoto klienta')}</strong>?</div>
      <div class="lp-confirm-btns">
        <button class="btn-lp-del" onclick="klientiDeleteDo(${k.id})">Smazat</button>
        <button class="btn-lp-cancel-edit" onclick="klientiDeleteDismiss(${k.id})">Zrušit</button>
      </div>
    </div>
  </div>`).join('');
}
