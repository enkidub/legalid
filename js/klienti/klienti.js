// legalid.cz — js/klienti/klienti.js
// Centrální evidence klientů (D1). Přihlášený uživatel čte/píše přes /api/clients;
// localStorage 'legalid_klienti' zůstává jen pro migraci a hosta (doložka bez loginu).

import { navigate } from '../core/router.js';
import { updatePreview } from '../dolozka/dolozka.js';
import { esc, showToast } from '../core/ui.js';
import { state } from '../core/state.js';
import { apiClientsSearch, apiClientGet, apiClientUpdate, apiClientDelete, apiClientsImport } from '../core/api.js';

// Klienti jsou plná stránka (route /klienti) — open/close jen přepínají route.
export function openKlientiPanel() { navigate('/klienti'); }
export function closeKlientiPanel() { navigate('/dolozka'); }

// ── localStorage (host + migrace) ──
export function getKlienti() {
  try { return JSON.parse(localStorage.getItem('legalid_klienti') || '[]'); }
  catch { return []; }
}
export function saveKlienti(data) { localStorage.setItem('legalid_klienti', JSON.stringify(data)); }

// ── stav modulu ──
let _clients = [];
let _searchTimer = null;
let _bannerDismissed = false;

const RISK_CS = { nizke: 'Nízké', stredni: 'Střední', vysoke: 'Vysoké' };
function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d)) return String(iso);
  try { return d.toLocaleDateString('cs-CZ', { day: 'numeric', month: 'numeric', year: 'numeric' }); } catch { return String(iso); }
}

// Shell plné stránky Klienti. Po vložení do DOM zavolej renderKlientiList().
export function renderKlientiPage() {
  return `<div class="page"><div class="wrap view-lp">
    <div class="view-lp-head">
      <h1 class="view-lp-title">Klienti</h1>
      <span class="lp-badge" id="klientiBadge"></span>
    </div>
    <input class="lp-search" id="klientiSearch" type="search" placeholder="Hledat jméno, IČO, doklad…" oninput="klientiSearch()">
    <div id="klientiBanner"></div>
    <div class="lp-list" id="klientiList"></div>
  </div></div>`;
}

// Debounced hledání (oninput).
export function klientiSearch() {
  clearTimeout(_searchTimer);
  _searchTimer = setTimeout(() => renderKlientiList(), 250);
}

export async function renderKlientiList() {
  const list = document.getElementById('klientiList');
  if (!list) return;
  if (!state.loggedIn) {
    list.innerHTML = `<div class="lp-empty"><div class="lp-empty-title">Pro evidenci klientů se přihlaste.</div>
      <div class="lp-empty-sub">Klienti se ukládají k vašemu účtu a jsou dostupní na všech zařízeních.</div></div>`;
    const b = document.getElementById('klientiBadge'); if (b) b.textContent = '';
    return;
  }
  const q = (document.getElementById('klientiSearch')?.value || '').trim();
  if (!q) list.innerHTML = `<div class="lp-empty"><div class="lp-empty-title">Načítám…</div></div>`;
  try { const r = await apiClientsSearch(q); _clients = r.clients || []; }
  catch { _clients = []; }
  const badge = document.getElementById('klientiBadge');
  if (badge) badge.textContent = _clients.length || '';
  renderBanner();
  if (!_clients.length) {
    list.innerHTML = `<div class="lp-empty"><div class="lp-empty-title">${esc(q ? 'Žádný výsledek.' : 'Zatím nemáte uložené žádné klienty.')}</div></div>`;
    return;
  }
  list.innerHTML = _clients.map(renderCard).join('');
}

function renderCard(c) {
  const isPo = c.subject_type === 'po';
  const name = isPo ? (c.company_name || 'firma bez názvu') : ([c.name, c.surname].filter(Boolean).join(' ') || 'bez jména');
  const ref = c.doc_number ? 'doklad ' + esc(c.doc_number) : (c.ico ? 'IČO ' + esc(c.ico) : '');
  const amlLine = c.last_aml_date
    ? `poslední AML ${esc(fmtDate(c.last_aml_date))}${c.last_risk_level ? ' · ' + esc(RISK_CS[c.last_risk_level] || c.last_risk_level) + ' riziko' : ''}${c.next_review_due ? ' · revalidace do ' + esc(fmtDate(c.next_review_due)) : ''}`
    : 'AML kontrola zatím neproběhla';
  const det = isPo
    ? `${c.ico ? 'IČO ' + esc(c.ico) : ''}`
    : `nar. ${esc(c.birth_date || '—')}${c.birth_place ? ', ' + esc(c.birth_place) : ''}`;

  const editGrid = isPo
    ? `<div class="lp-ef full"><label>Firma</label><input id="lp-ke2-company_name-${c.id}" value="${esc(c.company_name || '')}"></div>
       <div class="lp-ef"><label>IČO</label><input id="lp-ke2-ico-${c.id}" value="${esc(c.ico || '')}"></div>
       <div class="lp-ef full"><label>Adresa</label><input id="lp-ke2-address-${c.id}" value="${esc(c.address || '')}"></div>`
    : `<div class="lp-ef"><label>Jméno</label><input id="lp-ke2-name-${c.id}" value="${esc(c.name || '')}"></div>
       <div class="lp-ef"><label>Příjmení</label><input id="lp-ke2-surname-${c.id}" value="${esc(c.surname || '')}"></div>
       <div class="lp-ef"><label>Datum nar.</label><input id="lp-ke2-birth_date-${c.id}" value="${esc(c.birth_date || '')}"></div>
       <div class="lp-ef"><label>Číslo dokladu</label><input id="lp-ke2-doc_number-${c.id}" value="${esc(c.doc_number || '')}"></div>
       <div class="lp-ef full"><label>Adresa</label><input id="lp-ke2-address-${c.id}" value="${esc(c.address || '')}"></div>`;

  return `<div class="lp-item" id="lp-klnt-${c.id}">
    <div class="lp-item-view">
      <div class="lp-item-top">
        <span class="lp-item-name">${esc(name)}</span>
        <span class="lp-item-ref">${ref}</span>
      </div>
      <div class="lp-item-det">${det}</div>
      <div class="lp-item-aml-line ${c.last_aml_date ? '' : 'is-none'}">${esc(amlLine)}</div>
      <div class="lp-item-actions">
        <button class="btn-lp-action btn-lp-action--txt" title="Historie AML" onclick="klientiToggle(${c.id})">Historie</button>
        <button class="btn-lp-action btn-lp-action--txt" title="Nová AML kontrola" onclick="klientiNewAml(${c.id})">+ AML</button>
        <button class="btn-lp-action btn-lp-action--txt" title="Nová doložka" onclick="klientiLoad(${c.id})">+ Doložka</button>
        <button class="btn-lp-action" title="Upravit" onclick="klientiEditStart(${c.id})">&#x270E;</button>
        <button class="btn-lp-action danger" title="Smazat" onclick="klientiDeleteConfirm(${c.id})">&#xD7;</button>
      </div>
      <div class="lp-item-history" id="lp-aml-${c.id}" hidden></div>
    </div>
    <div class="lp-item-edit">
      <div class="lp-edit-grid">${editGrid}</div>
      <div class="lp-edit-btns">
        <button class="btn-lp-save" onclick="klientiEditSave(${c.id})">Uložit</button>
        <button class="btn-lp-cancel-edit" onclick="klientiEditCancel(${c.id})">Zrušit</button>
      </div>
    </div>
    <div class="lp-item-confirm">
      <div class="lp-confirm-msg">Smazat klienta <strong>${esc(name)}</strong>?</div>
      <div class="lp-confirm-btns">
        <button class="btn-lp-del" onclick="klientiDeleteDo(${c.id})">Smazat</button>
        <button class="btn-lp-cancel-edit" onclick="klientiDeleteDismiss(${c.id})">Zrušit</button>
      </div>
    </div>
  </div>`;
}

// Rozbalení historie AML případů (lazy GET /api/clients/:id).
export async function klientiToggle(id) {
  const box = document.getElementById(`lp-aml-${id}`);
  if (!box) return;
  if (!box.hidden) { box.hidden = true; return; }
  box.hidden = false;
  if (box.dataset.loaded) return;
  box.innerHTML = `<div class="lp-hist-loading">Načítám historii…</div>`;
  try {
    const r = await apiClientGet(id);
    const cases = r.aml_cases || [];
    box.dataset.loaded = '1';
    if (!cases.length) { box.innerHTML = `<div class="lp-hist-empty">Žádné AML kontroly.</div>`; return; }
    box.innerHTML = cases.map(k => {
      const risk = k.final_risk_level ? ` · ${esc(RISK_CS[k.final_risk_level] || k.final_risk_level)} riziko` : '';
      const st = k.status === 'completed' ? 'dokončeno' : (k.status === 'terminated' ? 'ukončeno' : k.status);
      const when = k.completed_at || k.created_at;
      return `<div class="lp-hist-row"><span class="lp-hist-num">${esc(k.case_number || ('#' + k.id))}</span>
        <span class="lp-hist-meta">${esc(st)} ${esc(fmtDate(when))}${risk}</span></div>`;
    }).join('') + `<button class="btn-lp-action" onclick="navigate('/archiv')" style="margin-top:8px">Otevřít archiv</button>`;
  } catch { box.innerHTML = `<div class="lp-hist-empty">Historii se nepodařilo načíst.</div>`; }
}

// Nová AML kontrola s předvyplněním (prefill přes sessionStorage → čte aml.js).
export function klientiNewAml(id) {
  const c = _clients.find(x => x.id === id);
  if (!c) return;
  try { sessionStorage.setItem('legalid_aml_prefill', JSON.stringify(c)); } catch {}
  navigate('/aml');
}

// „Nová doložka" / „Načíst" — předvyplní formulář doložky a přejde na /dolozka.
export function klientiLoad(id) {
  const c = _clients.find(x => x.id === id);
  if (!c) return;
  const set = (elId, val) => { const el = document.getElementById(elId); if (el) el.value = val || ''; };
  set('fJmeno', [c.name, c.surname].filter(Boolean).join(' '));
  set('fDatumNar', c.birth_date); set('fMistoNar', c.birth_place);
  set('fAdresa', c.address); set('fCisloOp', c.doc_number);
  updatePreview();
  closeKlientiPanel();
  showToast('Údaje klienta načteny');
}

// ── Edit / delete (DOM toggly beze změny, ukládání přes API) ──
export function klientiEditStart(id) {
  const el = document.getElementById(`lp-klnt-${id}`);
  if (!el) return;
  document.querySelectorAll('.lp-item.lp-editing, .lp-item.lp-confirming').forEach(e => e.classList.remove('lp-editing', 'lp-confirming'));
  el.classList.add('lp-editing');
}
export function klientiEditCancel(id) { document.getElementById(`lp-klnt-${id}`)?.classList.remove('lp-editing'); }

export async function klientiEditSave(id) {
  const c = _clients.find(x => x.id === id);
  if (!c) return;
  const get = field => document.getElementById(`lp-ke2-${field}-${id}`)?.value.trim();
  const fields = c.subject_type === 'po' ? ['company_name', 'ico', 'address'] : ['name', 'surname', 'birth_date', 'doc_number', 'address'];
  const patch = {};
  fields.forEach(f => { const v = get(f); if (v !== undefined) patch[f] = v; });
  try {
    const r = await apiClientUpdate(id, patch);
    if (r && r.client) { const i = _clients.findIndex(x => x.id === id); if (i >= 0) _clients[i] = r.client; }
    showToast('Klient upraven');
    renderKlientiList();
  } catch { showToast('Úpravu se nepodařilo uložit.'); }
}

export function klientiDeleteConfirm(id) {
  const el = document.getElementById(`lp-klnt-${id}`);
  if (!el) return;
  document.querySelectorAll('.lp-item.lp-editing, .lp-item.lp-confirming').forEach(e => e.classList.remove('lp-editing', 'lp-confirming'));
  el.classList.add('lp-confirming');
}
export function klientiDeleteDismiss(id) { document.getElementById(`lp-klnt-${id}`)?.classList.remove('lp-confirming'); }

export async function klientiDeleteDo(id) {
  try {
    const r = await apiClientDelete(id);
    if (!r.ok) {
      if (r.status === 409) showToast(r.data?.message || 'Klienta nelze smazat — má navázané AML kontroly.');
      else showToast('Smazání se nezdařilo.');
      klientiDeleteDismiss(id);
      return;
    }
    _clients = _clients.filter(x => x.id !== id);
    showToast('Klient smazán');
    renderKlientiList();
  } catch { showToast('Smazání se nezdařilo.'); klientiDeleteDismiss(id); }
}

// ── C3 — migrace z localStorage ──
function renderBanner() {
  const el = document.getElementById('klientiBanner');
  if (!el) return;
  const local = getKlienti();
  // Auto-banner jen když D1 prázdná a lokálně něco je a uživatel banner neodmítl.
  const showAuto = !_bannerDismissed && _clients.length === 0 && local.length > 0;
  if (showAuto) {
    el.innerHTML = `<div class="lp-banner">
      <div class="lp-banner-text">Nalezli jsme <strong>${local.length}</strong> klientů z doložek na tomto zařízení. Přenést do centrální evidence?</div>
      <div class="lp-banner-btns">
        <button class="btn-lp-save" onclick="klientiImport()">Přenést</button>
        <button class="btn-lp-cancel-edit" onclick="klientiImportDismiss()">Teď ne</button>
      </div></div>`;
  } else if (local.length > 0) {
    // Manuální import (i pro víc zařízení s různým localStorage).
    el.innerHTML = `<button class="lp-import-link" onclick="klientiImport()">Importovat klienty z tohoto zařízení (${local.length})</button>`;
  } else {
    el.innerHTML = '';
  }
}

export function klientiImportDismiss() {
  _bannerDismissed = true;
  renderBanner();
}

export async function klientiImport() {
  const local = getKlienti();
  if (!local.length) return;
  const clients = local.map(k => ({
    subject_type: 'fo', name: k.jmeno, birth_date: k.datumNar, birth_place: k.mistoNar,
    address: k.adresa, doc_number: k.cisloOp, doc_type: k.cisloOp ? 'OP' : '', created_from: 'dolozka',
  }));
  try {
    const r = await apiClientsImport(clients);
    // Přejmenuj klíč (záloha, už se nečte).
    try {
      localStorage.setItem('legalid_klienti_migrated', localStorage.getItem('legalid_klienti') || '[]');
      localStorage.removeItem('legalid_klienti');
    } catch {}
    _bannerDismissed = true;
    showToast(`Přeneseno: ${r.created || 0} nových, ${r.merged || 0} sloučeno.`);
    renderKlientiList();
  } catch { showToast('Import se nezdařil.'); }
}
