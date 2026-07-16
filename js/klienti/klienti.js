// legalid.cz — js/klienti/klienti.js
// Centrální evidence klientů (D1) — sdílený sloupcový seznam (js/core/rowlist.js).
import { navigate } from '../core/router.js';
import { updatePreview } from '../dolozka/dolozka.js';
import { esc, showToast } from '../core/ui.js';
import { state } from '../core/state.js';
import { apiClientsSearch, apiClientGet, apiClientUpdate, apiClientDelete, apiClientsImport, apiClientMerge } from '../core/api.js';
import { markLoginRedirect } from '../auth/auth.js';
import {
  EMPTY_CELL, humanizeName, norm, fmtDateCs, riskDotHTML, amberBadge, choiceModal,
  openRowMenu, closeRowMenu, bindRowMenuGlobalClose,
} from '../core/rowlist.js';

export function openKlientiPanel() { navigate('/klienti'); }
export function closeKlientiPanel() { navigate('/dolozka'); }

// localStorage (host + migrace z doložek)
export function getKlienti() { try { return JSON.parse(localStorage.getItem('legalid_klienti') || '[]'); } catch { return []; } }
export function saveKlienti(data) { localStorage.setItem('legalid_klienti', JSON.stringify(data)); }

let _clients = [];
let _filter = 'all';      // all | no_check | overdue
let _query = '';
let _bannerDismissed = false;
let _dupIds = new Set();       // klienti s možnou duplicitou
let _dupGroups = new Map();    // klíč → [id,...]

export function renderKlientiPage() {
  return `<div class="page"><div class="wrap view-klienti-wrap" id="klientiRoot">
    <div class="view-lp-head"><h1 class="view-lp-title">Klienti</h1></div>
    <div class="aml-loading">Načítám…</div>
  </div></div>`;
}

// Volá se z app.js po vložení stránky do DOM.
export function initKlienti() {
  const root = document.getElementById('klientiRoot');
  if (!root) return;
  bindRowMenuGlobalClose();
  root.addEventListener('input', (e) => {
    if (e.target.id === 'klientiSearch') { _query = e.target.value; renderList(root); }
  });
  root.addEventListener('click', (e) => onClick(root, e));
  loadClients(root);
}
// zpětná kompat. (app.js po přihlášení volá renderKlientiList)
export function renderKlientiList() { const root = document.getElementById('klientiRoot'); if (root) loadClients(root); }

function onClick(root, e) {
  const t = e.target.closest('[data-act]');
  if (!t) { closeRowMenu(); return; }
  const act = t.dataset.act;
  const id = t.dataset.id ? +t.dataset.id : null;
  switch (act) {
    case 'retry': loadClients(root); break;
    case 'set-filter': _filter = t.dataset.filter; closeRowMenu(); renderList(root); break;
    case 'row-main': openHistory(id); break;
    case 'new-aml': newAml(id); break;
    case 'row-menu': openClientMenu(root, t, id); break;
    case 'dup': openMergeDialog(root, id); break;
    case 'import': doImport(root); break;
    case 'import-dismiss': _bannerDismissed = true; renderBanner(root); break;
    default: break;
  }
}

async function loadClients(root) {
  if (!state.loggedIn) {
    markLoginRedirect();
    root.innerHTML = `<div class="view-lp-head"><h1 class="view-lp-title">Klienti</h1></div>
      <div class="rl-empty">Pro pokračování se přihlaste — data se ukládají k vašemu účtu.
      <div style="margin-top:14px"><button class="aml-btn aml-btn-primary" onclick="openRegistrationModal()">Přihlásit se / Registrovat</button></div></div>`;
    return;
  }
  let error = false;
  try { const r = await apiClientsSearch(''); _clients = r.clients || []; }
  catch { _clients = []; error = true; }
  if (error) {
    root.innerHTML = `<div class="view-lp-head"><h1 class="view-lp-title">Klienti</h1></div>
      <div class="rl-empty">Klienty se nepodařilo načíst. <button class="aml-btn aml-btn-sm" data-act="retry" style="margin-left:8px">Zkusit znovu</button></div>`;
    return;
  }
  computeDuplicates();
  renderShell(root);
  renderList(root);
}

// ── Duplicity (jen čteme dedup pravidla: rč → doklad → IČO → jméno+narození) ──
function dupKey(c) {
  if (c.rc) return 'rc:' + norm(c.rc);
  if (c.doc_number) return 'doc:' + norm(c.doc_number);
  if (c.ico) return 'ico:' + norm(c.ico);
  const nm = norm([c.name, c.surname].filter(Boolean).join(' '));
  if (nm && c.birth_date) return 'nb:' + nm + '|' + c.birth_date;
  return null;
}
function computeDuplicates() {
  _dupIds = new Set(); _dupGroups = new Map();
  const groups = new Map();
  for (const c of _clients) {
    const k = dupKey(c);
    if (!k) continue;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(c.id);
  }
  for (const [k, ids] of groups) {
    if (ids.length > 1) { _dupGroups.set(k, ids); ids.forEach(id => _dupIds.add(id)); }
  }
}
function groupOf(id) {
  for (const ids of _dupGroups.values()) if (ids.includes(id)) return ids;
  return [id];
}

// ── Filtr / hledání ──
function isOverdue(c) { return c.next_review_due && new Date(c.next_review_due).getTime() < Date.now(); }
function hasNoCheck(c) { return !c.last_aml_date; }
function matchesFilter(c) {
  if (_filter === 'no_check') return hasNoCheck(c);
  if (_filter === 'overdue') return isOverdue(c);
  return true;
}
function matchesQuery(c) {
  const q = norm(_query);
  if (!q) return true;
  const hay = norm([clientName(c), c.ico, c.doc_number, c.rc, c.name, c.surname, c.company_name].filter(Boolean).join(' '));
  return q.split(/\s+/).filter(Boolean).every(tok => hay.includes(tok));
}

function clientName(c) {
  return humanizeName(c.subject_type === 'po' ? (c.company_name || '') : [c.name, c.surname].filter(Boolean).join(' '));
}

function renderShell(root) {
  const n = {
    all: _clients.length,
    no_check: _clients.filter(hasNoCheck).length,
    overdue: _clients.filter(isOverdue).length,
  };
  const seg = [['all', 'Vše'], ['no_check', 'Bez kontroly'], ['overdue', 'Po termínu']]
    .map(([k, l]) => `<button class="rl-seg-btn${_filter === k ? ' is-on' : ''}" data-act="set-filter" data-filter="${k}">${l} <span class="rl-seg-n">${n[k]}</span></button>`).join('');
  root.innerHTML = `<div class="view-lp-head"><h1 class="view-lp-title">Klienti</h1></div>
    <div id="klientiBanner"></div>
    <div class="rl-toolbar">
      <div class="rl-seg" role="tablist">${seg}</div>
      <div class="rl-tools">
        <input class="rl-search" id="klientiSearch" type="search" placeholder="Hledat jméno, IČO, doklad…" value="${esc(_query)}">
      </div>
    </div>
    ${headHTML()}
    <div class="rl-list" id="klientiList"></div>
    <div class="rl-foot" id="klientiFoot"></div>`;
  renderBanner(root);
}

function headHTML() {
  return `<div class="rl-head" id="klientiHead">
    <div class="rl-c1">Klient</div><div class="rl-c2">Poslední kontrola</div><div class="rl-c3">Riziko</div>
    <div class="rl-c4">Revalidace</div><div class="rl-act"></div><div class="rl-more"></div>
  </div>`;
}

function renderList(root) {
  root.querySelectorAll('.rl-seg-btn').forEach(b => b.classList.toggle('is-on', b.dataset.filter === _filter));
  const listEl = root.querySelector('#klientiList');
  const footEl = root.querySelector('#klientiFoot');
  if (!listEl || !footEl) return;
  const head = root.querySelector('#klientiHead');
  if (!_clients.length) {
    if (head) head.style.display = 'none';
    listEl.innerHTML = `<div class="rl-empty">Zatím nemáte uložené žádné klienty.</div>`;
    footEl.innerHTML = ''; return;
  }
  const filtered = _clients.filter(c => matchesFilter(c) && matchesQuery(c));
  if (!filtered.length) {
    if (head) head.style.display = 'none';
    listEl.innerHTML = `<div class="rl-empty">Žádné záznamy neodpovídají hledání.</div>`;
    footEl.innerHTML = ''; return;
  }
  if (head) head.style.display = '';
  listEl.innerHTML = filtered.map(rowHTML).join('');
  footEl.innerHTML = `<div class="rl-foot-row"><span class="rl-foot-count">${filtered.length} klientů</span></div>`;
}

function rowHTML(c) {
  const isPo = c.subject_type === 'po';
  const nm = clientName(c);
  const nameHTML = nm ? `<span class="rl-name">${esc(nm)}</span>` : `<span class="rl-name rl-name--empty">bez jména</span>`;
  const dup = _dupIds.has(c.id)
    ? ` <button class="rl-badge rl-badge-amber" data-act="dup" data-id="${c.id}" title="V evidenci je jiný záznam se shodnou identitou — klikněte pro sloučení">Možná duplicita</button>` : '';

  // meta: nar./IČO · doklad
  const metaParts = [];
  if (isPo) { if (c.ico) metaParts.push('IČO ' + esc(c.ico)); }
  else { metaParts.push('nar. ' + (c.birth_date ? esc(c.birth_date) : '—')); if (c.doc_number) metaParts.push('doklad ' + esc(c.doc_number)); }
  const meta = metaParts.join('<span class="rl-mid-dot">·</span>');

  const last = c.last_aml_date ? `<span class="rl-date" title="${esc(fmtDateCs(c.last_aml_date))}">${esc(fmtDateCs(c.last_aml_date))}</span>` : EMPTY_CELL;
  const risk = c.last_aml_date ? riskDotHTML(c.last_risk_level) : EMPTY_CELL;
  const reval = revalHTML(c);

  const overdue = isOverdue(c);
  const mainLabel = overdue ? 'Revalidovat' : '+ AML';

  return `<div class="rl-row" data-act="row-main" data-id="${c.id}" role="button" tabindex="0">
    <div class="rl-c1"><div class="rl-l1">${nameHTML}${dup}</div><div class="rl-l2 rl-l2-ell">${meta}</div></div>
    <div class="rl-c2">${last}</div>
    <div class="rl-c3">${risk}</div>
    <div class="rl-c4">${reval}</div>
    <div class="rl-act"><button class="rl-act-main" data-act="new-aml" data-id="${c.id}">${esc(mainLabel)}</button></div>
    <div class="rl-more"><button class="rl-act-more" data-act="row-menu" data-id="${c.id}" aria-label="Další akce" title="Další akce">⋯</button></div>
  </div>`;
}

function revalHTML(c) {
  if (!c.next_review_due) return EMPTY_CELL;
  const full = esc(fmtDateCs(c.next_review_due));
  if (isOverdue(c)) return `<span class="rl-review--over" title="${full}"><i class="ti ti-clock-hour-4"></i> po termínu ${full}</span>`;
  return `<span class="rl-review" title="${full}">${full}</span>`;
}

// ── Akce ──
function newAml(id) {
  const c = _clients.find(x => x.id === id);
  if (!c) return;
  try { sessionStorage.setItem('legalid_aml_prefill', JSON.stringify(c)); } catch {}
  navigate('/aml');
}
export function klientiNewAml(id) { newAml(id); }

// „+ Doložka" — předvyplní formulář doložky a přejde na /dolozka.
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

function openClientMenu(root, btn, id) {
  const items = [
    { act: 'history', label: 'Historie kontrol' },
    { act: 'dolozka', label: '+ Doložka' },
    { act: 'edit', label: 'Upravit' },
    { act: 'delete', label: 'Smazat', danger: true },
  ];
  openRowMenu(btn, id, items, (act, mid) => {
    if (act === 'history') openHistory(mid);
    else if (act === 'dolozka') klientiLoad(mid);
    else if (act === 'edit') openEdit(root, mid);
    else if (act === 'delete') confirmDelete(root, mid);
  });
}

// ── Historie kontrol (modal) ──
const RISK_CS = { nizke: 'Nízké', stredni: 'Střední', vysoke: 'Vysoké' };
async function openHistory(id) {
  const c = _clients.find(x => x.id === id);
  const ov = openModal(`<div class="rl-modal-title">Historie kontrol — ${esc(clientName(c) || 'klient')}</div>
    <div class="rl-modal-body" id="kliHistBody"><div class="lp-hist-loading">Načítám historii…</div></div>
    <div class="rl-modal-actions"><button class="aml-btn" data-close>Zavřít</button></div>`);
  try {
    const r = await apiClientGet(id);
    const cases = r.aml_cases || [];
    const body = document.getElementById('kliHistBody');
    if (!body) return;
    if (!cases.length) { body.innerHTML = `<div class="lp-hist-empty">Žádné AML kontroly.</div>`; return; }
    body.innerHTML = cases.map(k => {
      const risk = k.final_risk_level ? ` · ${esc(RISK_CS[k.final_risk_level] || k.final_risk_level)} riziko` : '';
      const decidedNoRecord = k.status === 'in_progress' && !!k.risk_decided_at;
      const st = k.status === 'completed' ? 'dokončeno'
        : (k.status === 'terminated' ? 'ukončeno'
        : (decidedNoRecord ? 'kontrola rozpracována, záznam nevystaven'
        : (k.status === 'in_progress' ? 'rozpracováno' : k.status)));
      const when = k.completed_at || k.created_at;
      return `<div class="lp-hist-row"><span class="lp-hist-num">${esc(k.case_number || 'bez čísla')}</span>
        <span class="lp-hist-meta${decidedNoRecord ? ' lp-hist-meta--warn' : ''}">${esc(st)} ${esc(fmtDateCs(when))}${risk}</span></div>`;
    }).join('') + `<div style="margin-top:10px"><button class="aml-btn aml-btn-sm" onclick="navigate('/archiv')">Otevřít archiv</button></div>`;
  } catch { const body = document.getElementById('kliHistBody'); if (body) body.innerHTML = `<div class="lp-hist-empty">Historii se nepodařilo načíst.</div>`; }
}

// ── Upravit (modal) ──
function openEdit(root, id) {
  const c = _clients.find(x => x.id === id);
  if (!c) return;
  const isPo = c.subject_type === 'po';
  const f = (label, key, val) => `<label class="lp-ef full"><span>${esc(label)}</span><input id="kliEdit-${key}" value="${esc(val || '')}"></label>`;
  const fields = isPo
    ? f('Firma', 'company_name', c.company_name) + f('IČO', 'ico', c.ico) + f('Adresa', 'address', c.address)
    : f('Jméno', 'name', c.name) + f('Příjmení', 'surname', c.surname) + f('Datum narození', 'birth_date', c.birth_date) + f('Číslo dokladu', 'doc_number', c.doc_number) + f('Adresa', 'address', c.address);
  const ov = openModal(`<div class="rl-modal-title">Upravit klienta</div>
    <div class="rl-modal-body"><div class="kli-edit-grid">${fields}</div></div>
    <div class="rl-modal-actions"><button class="aml-btn" data-close>Zrušit</button><button class="aml-btn aml-btn-primary" id="kliEditSave">Uložit</button></div>`);
  ov.querySelector('#kliEditSave').addEventListener('click', async () => {
    const keys = isPo ? ['company_name', 'ico', 'address'] : ['name', 'surname', 'birth_date', 'doc_number', 'address'];
    const patch = {};
    keys.forEach(k => { const el = document.getElementById('kliEdit-' + k); if (el) patch[k] = el.value.trim(); });
    try {
      const r = await apiClientUpdate(id, patch);
      if (r && r.client) { const i = _clients.findIndex(x => x.id === id); if (i >= 0) _clients[i] = r.client; }
      showToast('Klient upraven'); ov.close(); computeDuplicates(); renderShell(root); renderList(root);
    } catch { showToast('Úpravu se nepodařilo uložit.'); }
  });
}

// ── Smazat (§ 16 — karta se smaže, záznamy v Archivu zůstanou) ──
async function confirmDelete(root, id) {
  const c = _clients.find(x => x.id === id);
  if (!c) return;
  const nm = clientName(c) || 'klient';
  const hasCompleted = !!c.last_aml_date;
  const body = hasCompleted
    ? `<p>Smazat kartu klienta <strong>${esc(nm)}</strong>?</p>
       <p class="rl-modal-warn">Klient má dokončené kontroly — <strong>záznamy v Archivu zůstanou zachovány (§ 16)</strong>, smaže se jen karta klienta.</p>`
    : `<p>Smazat kartu klienta <strong>${esc(nm)}</strong>?</p>`;
  const choice = await choiceModal({
    title: 'Smazat klienta?', body,
    buttons: [{ key: 'delete', label: 'Smazat kartu', cls: 'aml-btn-danger' }, { key: 'cancel', label: 'Zpět', cls: '' }],
  });
  if (choice !== 'delete') return;
  try {
    const r = await apiClientDelete(id);
    if (!r.ok) { showToast('Smazání se nezdařilo.'); return; }
    _clients = _clients.filter(x => x.id !== id);
    showToast('Karta klienta smazána.'); computeDuplicates(); renderShell(root); renderList(root);
  } catch { showToast('Smazání se nezdařilo.'); }
}

// ── Sloučení duplicit ──
async function openMergeDialog(root, id) {
  const ids = groupOf(id);
  const members = ids.map(i => _clients.find(x => x.id === i)).filter(Boolean);
  if (members.length < 2) return;
  // výchozí hlavní: první s dokončenou kontrolou, jinak první
  const defaultPrimary = (members.find(m => m.last_aml_date) || members[0]).id;
  const opts = members.map(m => `<label class="rl-merge-opt">
      <input type="radio" name="kliMergePrimary" value="${m.id}"${m.id === defaultPrimary ? ' checked' : ''}>
      <span><strong>${esc(clientName(m) || 'bez jména')}</strong><br>
      <span style="font-size:12px;color:var(--ink-lt)">${esc([m.birth_date ? 'nar. ' + m.birth_date : '', m.ico ? 'IČO ' + m.ico : '', m.doc_number ? 'doklad ' + m.doc_number : '', m.last_aml_date ? 'poslední kontrola ' + fmtDateCs(m.last_aml_date) : 'bez kontroly'].filter(Boolean).join(' · '))}</span></span>
    </label>`).join('');
  const ov = openModal(`<div class="rl-modal-title">Sloučit duplicitní klienty</div>
    <div class="rl-modal-body">
      <p>Vyberte hlavní záznam. Historie kontrol i doložek se přepojí na něj, ostatní karty se smažou.</p>
      ${opts}
    </div>
    <div class="rl-modal-actions"><button class="aml-btn" data-close>Zrušit</button><button class="aml-btn aml-btn-primary" id="kliMergeDo">Sloučit</button></div>`);
  ov.querySelector('#kliMergeDo').addEventListener('click', async () => {
    const sel = ov.querySelector('input[name="kliMergePrimary"]:checked');
    if (!sel) return;
    const primaryId = +sel.value;
    const secondaries = ids.filter(i => i !== primaryId);
    ov.querySelector('#kliMergeDo').disabled = true;
    try {
      for (const sid of secondaries) { const r = await apiClientMerge(primaryId, sid); if (!r.ok) throw new Error('merge_failed'); }
      showToast('Klienti sloučeni.'); ov.close();
      await loadClients(root);
    } catch { showToast('Sloučení se nezdařilo.'); ov.close(); }
  });
}

// ── lehký modal (vlastní obsah + tlačítka) ──
function openModal(innerHTML) {
  const ov = document.createElement('div');
  ov.className = 'rl-modal-ov';
  ov.innerHTML = `<div class="rl-modal" role="dialog" aria-modal="true">${innerHTML}</div>`;
  ov.close = () => { ov.remove(); document.removeEventListener('keydown', onKey); };
  function onKey(e) { if (e.key === 'Escape') ov.close(); }
  ov.addEventListener('click', (e) => { if (e.target === ov || e.target.closest('[data-close]')) ov.close(); });
  document.addEventListener('keydown', onKey);
  document.body.appendChild(ov);
  return ov;
}

// ── Migrace z localStorage (banner) ──
function renderBanner(root) {
  const el = (root || document).querySelector('#klientiBanner');
  if (!el) return;
  const local = getKlienti();
  const showAuto = !_bannerDismissed && _clients.length === 0 && local.length > 0;
  if (showAuto) {
    el.innerHTML = `<div class="lp-banner">
      <div class="lp-banner-text">Nalezli jsme <strong>${local.length}</strong> klientů z doložek na tomto zařízení. Přenést do centrální evidence?</div>
      <div class="lp-banner-btns">
        <button class="btn-lp-save" data-act="import">Přenést</button>
        <button class="btn-lp-cancel-edit" data-act="import-dismiss">Teď ne</button>
      </div></div>`;
  } else if (local.length > 0) {
    el.innerHTML = `<button class="lp-import-link" data-act="import">Importovat klienty z tohoto zařízení (${local.length})</button>`;
  } else { el.innerHTML = ''; }
}

async function doImport(root) {
  const local = getKlienti();
  if (!local.length) return;
  const clients = local.map(k => ({
    subject_type: 'fo', name: k.jmeno, birth_date: k.datumNar, birth_place: k.mistoNar,
    address: k.adresa, doc_number: k.cisloOp, doc_type: k.cisloOp ? 'OP' : '', created_from: 'dolozka',
  }));
  try {
    const r = await apiClientsImport(clients);
    try { localStorage.setItem('legalid_klienti_migrated', localStorage.getItem('legalid_klienti') || '[]'); localStorage.removeItem('legalid_klienti'); } catch {}
    _bannerDismissed = true;
    showToast(`Přeneseno: ${r.created || 0} nových, ${r.merged || 0} sloučeno.`);
    await loadClients(root);
  } catch { showToast('Import se nezdařil.'); }
}
