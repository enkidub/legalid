// legalid.cz — js/archiv/archiv.js
// Archiv AML kontrol — kompaktní seznam: filtr · hledání · řazení, ~52px řádky,
// jedno outline tlačítko + „⋯" menu. Regenerace/zobrazení PDF (bez příloh).
import { apiAmlListCases, apiAmlGetCase, apiAmlGetLookups, apiAmlGetDocuments, apiAmlDeleteCase, apiAmlDeleteEmpty } from '../core/api.js';
import { buildRecordPdf, buildTerminationPdf, fmtDateCs } from '../aml/pdf.js';
import { state } from '../core/state.js';
import { showToast, esc } from '../core/ui.js';
import { markLoginRedirect } from '../auth/auth.js';

let _cases = [];            // cache načtených případů
let _filter = 'all';        // all | in_progress | completed | terminated
let _sort = 'newest';       // newest | review | risk
let _query = '';
let _limit = 50;            // stránkování (Načíst další)
const PAGE = 50;

export function renderArchiv() {
  return `<div class="view-archiv" id="archivRoot"><div class="aml-loading">Načítám archiv…</div></div>`;
}

export function initArchiv() {
  const root = document.getElementById('archivRoot');
  if (!root) return;
  if (!state.loggedIn) {
    markLoginRedirect();
    root.innerHTML = `<div class="view-placeholder">
      <div class="view-placeholder-icon"><i class="ti ti-archive"></i></div>
      <h1 class="view-placeholder-title">Archiv</h1>
      <p class="view-placeholder-text">Pro pokračování se přihlaste — data se ukládají k vašemu účtu.</p>
      <button class="aml-btn aml-btn-primary" style="margin-top:14px" onclick="openRegistrationModal()">Přihlásit se / Registrovat</button></div>`;
    return;
  }
  root.addEventListener('click', (e) => onClick(root, e));
  root.addEventListener('input', (e) => {
    if (e.target.id === 'archSearch') { _query = e.target.value; _limit = PAGE; renderList(root); }
  });
  root.addEventListener('change', (e) => {
    if (e.target.id === 'archSort') { _sort = e.target.value; _limit = PAGE; renderList(root); }
  });
  loadArchiv(root);
}

function onClick(root, e) {
  const t = e.target.closest('[data-act]');
  if (!t) { closeRowMenu(); return; }
  const act = t.dataset.act;
  const id = t.dataset.id ? +t.dataset.id : null;
  switch (act) {
    case 'archiv-retry': loadArchiv(root); break;
    case 'new-check': if (window.navigate) window.navigate('/aml'); break;
    case 'set-filter': _filter = t.dataset.filter; _limit = PAGE; closeRowMenu(); renderList(root); break;
    case 'load-more': _limit += PAGE; renderList(root); break;
    case 'copy-case': copyCase(t.dataset.num); break;
    case 'row-main': mainAction(root, id); break;
    case 'resume-aml': resumeCase(id); break;
    case 'view-pdf': viewPdf(root, id); break;
    case 'regen': regenerate(root, id); break;
    case 'del-draft': confirmDeleteDraft(root, id); break;
    case 'del-empty': confirmDeleteEmpty(root); break;
    case 'row-menu': toggleRowMenu(root, t, id); break;
    default: break;
  }
}

async function loadArchiv(root) {
  root.innerHTML = `<div class="view-archiv-wrap"><div class="aml-loading">Načítám archiv…</div></div>`;
  let error = false;
  try { const r = await apiAmlListCases(); _cases = r.cases || []; }
  catch { _cases = []; error = true; }
  if (error) {
    root.innerHTML = `<div class="view-archiv-wrap">
      <div class="view-lp-head"><div class="view-lp-title">Archiv AML kontrol</div></div>
      <div class="aml-card"><div class="aml-src-state aml-src-state--err">
        <span>Archiv se nepodařilo načíst.</span>
        <button class="aml-btn aml-btn-sm" data-act="archiv-retry">Zkusit znovu</button>
      </div></div></div>`;
    return;
  }
  _limit = PAGE;
  renderShell(root);
  renderList(root);
}

// ── Klasifikace stavu ────────────────────────────────────────────────
const RISK_CS = { nizke: 'Nízké', stredni: 'Střední', vysoke: 'Vysoké' };
const RISK_RANK = { vysoke: 3, stredni: 2, nizke: 1 };
const STEP_LABELS = ['Údaje klienta', 'Lustrace', 'Účel obchodu', 'Riziko', 'Záznam'];

function nameText(c) {
  const raw = c.subject_type === 'po'
    ? (c.company_name || '')
    : [c.client_name, c.client_surname].filter(Boolean).join(' ');
  return humanizeName(raw);
}
// Jméno nikdy verzálkami: OCR z dokladu často vrací CELÉ VELKÝMI → převeď na
// normální kapitalizaci u zdroje (ne CSS). Firmy s právní formou necháváme být.
function humanizeName(s) {
  if (!s) return '';
  if (c_isAllUpper(s)) {
    return s.toLowerCase().replace(/(^|[\s\-'’.])(\p{L})/gu, (m, p, ch) => p + ch.toUpperCase());
  }
  return s;
}
function c_isAllUpper(s) { return s === s.toUpperCase() && s !== s.toLowerCase(); }

function draftHasName(c) {
  return c.subject_type === 'po' ? !!c.company_name : !!(c.client_name || c.client_surname);
}
function draftHasLustrace(c) { return (c.lookup_count || 0) > 0; }
function isEmptyDraft(c) { return c.status === 'in_progress' && !draftHasName(c) && (c.current_step || 0) === 0 && !draftHasLustrace(c); }
// Rozhodnuto (krok 4) bez vygenerovaného PDF záznamu (krok 5) — § 16.
function isDecidedNoRecord(c) { return c.status === 'in_progress' && !!c.risk_decided_at; }

// ── Filtr / hledání / řazení ─────────────────────────────────────────
function statusMatchesFilter(c, f) {
  if (f === 'all') return true;
  if (f === 'in_progress') return c.status === 'in_progress';
  if (f === 'completed') return c.status === 'completed';
  if (f === 'terminated') return c.status === 'terminated';
  return true;
}
function norm(s) { return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''); }
function matchesQuery(c, q) {
  q = norm(q);
  if (!q) return true;
  const hay = norm([nameText(c), c.case_number, c.client_ico, c.company_name, c.client_name, c.client_surname].filter(Boolean).join(' '));
  return q.split(/\s+/).filter(Boolean).every(tok => hay.includes(tok));
}
function sortKey(c) { return c.completed_at || c.created_at || ''; }
function sortCases(list) {
  const arr = [...list];
  if (_sort === 'review') {
    // Revize nejdříve: dokončené s next_review_due vzestupně, ostatní na konec.
    arr.sort((a, b) => {
      const ra = a.next_review_due || '', rb = b.next_review_due || '';
      if (ra && rb) return ra < rb ? -1 : (ra > rb ? 1 : 0);
      if (ra) return -1;
      if (rb) return 1;
      return sortKey(b).localeCompare(sortKey(a));
    });
  } else if (_sort === 'risk') {
    arr.sort((a, b) => {
      const rd = (RISK_RANK[b.final_risk_level] || 0) - (RISK_RANK[a.final_risk_level] || 0);
      return rd !== 0 ? rd : sortKey(b).localeCompare(sortKey(a));
    });
  } else {
    arr.sort((a, b) => sortKey(b).localeCompare(sortKey(a)));
  }
  return arr;
}

// ── Render: lišta nástrojů (jednou) ──────────────────────────────────
function renderShell(root) {
  const n = {
    all: _cases.length,
    in_progress: _cases.filter(c => c.status === 'in_progress').length,
    completed: _cases.filter(c => c.status === 'completed').length,
    terminated: _cases.filter(c => c.status === 'terminated').length,
  };
  const seg = [
    ['all', 'Vše'], ['in_progress', 'Rozpracované'], ['completed', 'Dokončené'], ['terminated', 'Ukončené'],
  ].map(([k, l]) => `<button class="arch-seg-btn${_filter === k ? ' is-on' : ''}" data-act="set-filter" data-filter="${k}">${l} <span class="arch-seg-n">${n[k]}</span></button>`).join('');
  const sortOpts = [['newest', 'Nejnovější'], ['review', 'Revize nejdříve'], ['risk', 'Podle rizika']]
    .map(([v, l]) => `<option value="${v}"${_sort === v ? ' selected' : ''}>${l}</option>`).join('');
  root.innerHTML = `<div class="view-archiv-wrap">
    <div class="view-lp-head">
      <div class="view-lp-title">Archiv AML kontrol</div>
      <button class="aml-btn aml-btn-sm" data-act="new-check" style="margin-left:auto">Nová kontrola</button>
    </div>
    <div class="arch-toolbar">
      <div class="arch-seg" role="tablist">${seg}</div>
      <div class="arch-tools">
        <input class="arch-search" id="archSearch" type="search" placeholder="Hledat jméno, IČO, číslo případu…" value="${esc(_query)}">
        <select class="arch-sort" id="archSort" aria-label="Řazení">${sortOpts}</select>
      </div>
    </div>
    <div class="arch-list" id="archList"></div>
    <div class="arch-foot" id="archFoot"></div>
  </div>`;
}

// ── Render: seznam (opakovaně, bez sáhnutí na lištu → hledání drží fokus) ──
function renderList(root) {
  // aktualizuj aktivní segment (lišta se nepřekresluje)
  root.querySelectorAll('.arch-seg-btn').forEach(b => b.classList.toggle('is-on', b.dataset.filter === _filter));
  const listEl = root.querySelector('#archList');
  const footEl = root.querySelector('#archFoot');
  if (!listEl || !footEl) return;

  const filtered = sortCases(_cases.filter(c => statusMatchesFilter(c, _filter) && matchesQuery(c, _query)));
  if (!_cases.length) {
    listEl.innerHTML = `<div class="arch-empty">Zatím nemáte žádné kontroly. Rozpracované i dokončené kontroly se objeví zde.</div>`;
    footEl.innerHTML = '';
    return;
  }
  if (!filtered.length) {
    listEl.innerHTML = `<div class="arch-empty">Žádné záznamy neodpovídají hledání.</div>`;
    footEl.innerHTML = '';
    return;
  }
  const shown = filtered.slice(0, _limit);
  listEl.innerHTML = shown.map(rowHTML).join('');

  // Patička: počty + hromadné smazání prázdných rozpracovaných.
  const emptyCount = _cases.filter(isEmptyDraft).length;
  const more = filtered.length > _limit
    ? `<button class="aml-btn aml-btn-sm" data-act="load-more">Načíst další (${filtered.length - _limit})</button>` : '';
  const emptyPart = emptyCount
    ? ` · ${emptyCount} prázdných rozpracovaných <button class="arch-foot-del" data-act="del-empty">Smazat prázdné (${emptyCount})</button>` : '';
  footEl.innerHTML = `<div class="arch-foot-row"><span class="arch-foot-count">${filtered.length} záznamů${emptyPart}</span>${more}</div>`;
}

// ── Render: jeden řádek ──────────────────────────────────────────────
function rowHTML(c) {
  const decidedNoRecord = isDecidedNoRecord(c);
  const nm = nameText(c);
  const nameHTML = nm
    ? `<span class="arch-name">${esc(nm)}</span>`
    : `<span class="arch-name arch-name--empty">bez jména</span>`;

  // stavový badge (jedna barevná řeč)
  let badge;
  if (c.status === 'completed') badge = `<span class="arch-badge arch-badge-done">Dokončeno</span>`;
  else if (c.status === 'terminated') badge = `<span class="arch-badge arch-badge-term">Ukončeno § 15</span>`;
  else if (decidedNoRecord) badge = `<span class="arch-badge arch-badge-norecord">Rozhodnuto — chybí záznam</span>`;
  else badge = `<span class="arch-badge arch-badge-prog">Rozpracováno</span>`;

  // riziko odděleně (jen dokončené): barevná tečka + text
  const risk = (c.status === 'completed' && c.final_risk_level)
    ? `<span class="arch-riskdot arch-riskdot-${esc(c.final_risk_level)}"><span class="arch-dot"></span>${esc(RISK_CS[c.final_risk_level] || c.final_risk_level)}</span>` : '';

  // revize (jen dokončené)
  const review = (c.status === 'completed') ? reviewHTML(c.next_review_due) : '';

  // řádek 2 — meta
  const l2parts = [];
  if (c.case_number) l2parts.push(`<span class="arch-case" data-act="copy-case" data-num="${esc(c.case_number)}" title="Kopírovat číslo případu">${esc(c.case_number)}</span>`);
  if (c.status === 'in_progress') {
    l2parts.push(esc(decidedNoRecord ? 'dokončete krok 5 (Záznam)' : `krok ${(c.current_step || 0) + 1} z 5`));
  } else {
    const label = c.status === 'terminated' ? 'ukončeno' : 'dokončeno';
    if (c.completed_at) l2parts.push(esc(`${label} ${fmtDateCs(c.completed_at)}`));
  }
  const rel = relDate(c.completed_at || c.created_at);
  if (rel) l2parts.push(`<span class="arch-rel">${esc(rel)}</span>`);
  const l2 = l2parts.join('<span class="arch-mid-dot">·</span>');

  // akce vpravo — jedno outline tlačítko + ⋯
  const mainLabel = c.status === 'in_progress' ? (decidedNoRecord ? 'Dokončit' : 'Pokračovat') : 'Zobrazit';
  const mainAct = c.status === 'in_progress' ? 'resume-aml' : 'view-pdf';

  return `<div class="arch-row${decidedNoRecord ? ' arch-row--norecord' : ''}" data-act="row-main" data-id="${c.id}" role="button" tabindex="0">
    <div class="arch-row-main">
      <div class="arch-row-l1">${nameHTML}${badge}${risk}${review}</div>
      <div class="arch-row-l2">${l2}</div>
    </div>
    <div class="arch-row-actions">
      <button class="arch-act-main" data-act="${mainAct}" data-id="${c.id}">${mainLabel}</button>
      <button class="arch-act-more" data-act="row-menu" data-id="${c.id}" aria-label="Další akce" title="Další akce">⋯</button>
    </div>
  </div>`;
}

// Revize: pod 30 dní / po termínu → jantarově s ikonou hodin; jinak datum.
function reviewHTML(due) {
  if (!due) return '';
  const d = new Date(due);
  if (isNaN(d)) return '';
  const days = Math.ceil((d.getTime() - Date.now()) / 86400000);
  const clock = '<i class="ti ti-clock-hour-4"></i>';
  if (days < 0) return `<span class="arch-review arch-review--soon">${clock} revize po termínu</span>`;
  if (days === 0) return `<span class="arch-review arch-review--soon">${clock} revize dnes</span>`;
  if (days < 30) return `<span class="arch-review arch-review--soon">${clock} revize za ${days} ${days === 1 ? 'den' : (days < 5 ? 'dny' : 'dní')}</span>`;
  return `<span class="arch-review">revize ${esc(fmtDateCs(due))}</span>`;
}

// Relativní datum: dnes / včera, starší absolutně.
function relDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d)) return '';
  const startOf = (x) => { const y = new Date(x); y.setHours(0, 0, 0, 0); return y.getTime(); };
  const diff = Math.round((startOf(Date.now()) - startOf(d)) / 86400000);
  if (diff <= 0) return 'dnes';
  if (diff === 1) return 'včera';
  return fmtDateCs(iso);
}

// ── Akce ─────────────────────────────────────────────────────────────
function mainAction(root, id) {
  const c = _cases.find(x => x.id === id);
  if (!c) return;
  if (c.status === 'in_progress') resumeCase(id);
  else viewPdf(root, id);
}

function resumeCase(id) {
  try { sessionStorage.setItem('legalid_aml_resume', String(id)); } catch {}
  if (window.navigate) window.navigate('/aml');
}

function copyCase(num) {
  if (!num) return;
  const done = () => showToast('Číslo případu zkopírováno.');
  try {
    if (navigator.clipboard?.writeText) { navigator.clipboard.writeText(num).then(done).catch(() => fallbackCopy(num, done)); }
    else fallbackCopy(num, done);
  } catch { fallbackCopy(num, done); }
}
function fallbackCopy(text, done) {
  try {
    const ta = document.createElement('textarea');
    ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove(); done();
  } catch { showToast('Kopírování se nezdařilo.'); }
}

// ── „⋯" menu ─────────────────────────────────────────────────────────
let _menuEl = null;
function closeRowMenu() { if (_menuEl) { _menuEl.remove(); _menuEl = null; } }
function toggleRowMenu(root, btn, id) {
  if (_menuEl && _menuEl.dataset.id === String(id)) { closeRowMenu(); return; }
  closeRowMenu();
  const c = _cases.find(x => x.id === id);
  if (!c) return;
  const items = [];
  if (c.status === 'in_progress') {
    items.push({ act: 'resume-aml', label: 'Zobrazit detail' });
    items.push({ act: 'del-draft', label: 'Smazat', danger: true });
  } else {
    items.push({ act: 'view-pdf', label: 'Zobrazit detail' });
    items.push({ act: 'regen', label: 'Regenerovat PDF' });
  }
  const menu = document.createElement('div');
  menu.className = 'arch-menu'; menu.dataset.id = String(id);
  menu.innerHTML = items.map(it => `<button class="arch-menu-item${it.danger ? ' is-danger' : ''}" data-act="${it.act}" data-id="${id}">${esc(it.label)}</button>`).join('');
  document.body.appendChild(menu);
  const r = btn.getBoundingClientRect();
  const mw = 190;
  let left = r.right - mw + window.scrollX;
  if (left < 8) left = 8;
  menu.style.top = `${r.bottom + 4 + window.scrollY}px`;
  menu.style.left = `${left}px`;
  _menuEl = menu;
  // klik na položku menu → proveď akci a zavři
  menu.addEventListener('click', (e) => {
    const it = e.target.closest('[data-act]');
    if (!it) return;
    const act = it.dataset.act; const mid = +it.dataset.id;
    closeRowMenu();
    if (act === 'resume-aml') resumeCase(mid);
    else if (act === 'view-pdf') viewPdf(root, mid);
    else if (act === 'regen') regenerate(root, mid);
    else if (act === 'del-draft') confirmDeleteDraft(root, mid);
  });
}
document.addEventListener('click', (e) => {
  if (_menuEl && !e.target.closest('.arch-menu') && !e.target.closest('[data-act="row-menu"]')) closeRowMenu();
});
window.addEventListener('resize', closeRowMenu);
window.addEventListener('scroll', closeRowMenu, true);

// ── PDF (regenerace / zobrazení) ─────────────────────────────────────
function loadPovinnaOsoba() {
  try {
    const s = JSON.parse(localStorage.getItem('legalid_advokat') || 'null');
    return s ? { jmeno: s.jmeno || '', role: s.role || '', sidlo: s.sidlo || '', ev_cislo: s.ev_cislo || '' } : null;
  } catch { return null; }
}
function parse(s) { try { return s ? JSON.parse(s) : null; } catch { return null; } }

function downloadPdf(bytes, filename) {
  const blob = new Blob([bytes], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

// Sestaví PDF bajty případu (záznam / ukončení) — sdíleno pro stažení i zobrazení.
async function buildCasePdfBytes(id) {
  const cr = await apiAmlGetCase(id);
  const c = cr.case;
  if (!c) throw new Error('not_found');
  const profile = cr.profile || null;
  if (c.status === 'terminated') {
    const bytes = await buildTerminationPdf({
      caseNumber: c.case_number, povinnaOsoba: profile, dateISO: c.completed_at || c.created_at,
      clientName: [c.client_name, c.client_surname].filter(Boolean).join(' '),
      clientNameOriginal: c.client_name_original || '', clientBirthDate: c.client_birth_date || '',
      clientDocNumber: c.client_doc_number || '', reasonLabel: c.terminated_reason || 'Ukončeno', reasonText: '',
    });
    return { bytes, filename: `${c.case_number || 'AML'}-ukonceno.pdf` };
  }
  let lookups = [], documents = [];
  try { const l = await apiAmlGetLookups(id); lookups = l.results || []; } catch {}
  try { const d = await apiAmlGetDocuments(id); documents = d.documents || []; } catch {}
  const bytes = await buildRecordPdf(recordDataFromCase(c, lookups, documents, profile));
  return { bytes, filename: `${c.case_number || 'AML'}-zaznam.pdf` };
}

async function regenerate(root, id) {
  showToast('Generuji PDF…');
  try {
    const { bytes, filename } = await buildCasePdfBytes(id);
    downloadPdf(bytes, filename);
  } catch { showToast('Regenerace PDF se nezdařila.'); }
}

// Zobrazit PDF v nové kartě (blob URL) bez stažení. Okno se otevře hned v rámci
// klik-gesta (jinak by ho prohlížeč zablokoval), obsah se doplní po sestavení.
async function viewPdf(root, id) {
  const w = window.open('', '_blank');
  try {
    const { bytes } = await buildCasePdfBytes(id);
    const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
    if (w) w.location = url; else window.open(url, '_blank');
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  } catch {
    if (w) w.close();
    showToast('PDF se nepodařilo otevřít.');
  }
}

// ── Modal + mazání ───────────────────────────────────────────────────
function choiceModal({ title, body, buttons }) {
  return new Promise(resolve => {
    const ov = document.createElement('div');
    ov.className = 'arch-modal-ov';
    const btnHtml = buttons.map(b =>
      `<button class="aml-btn ${b.cls || ''}" data-k="${b.key}">${esc(b.label)}</button>`).join('');
    ov.innerHTML = `<div class="arch-modal" role="dialog" aria-modal="true">
      <div class="arch-modal-title">${esc(title)}</div>
      <div class="arch-modal-body">${body}</div>
      <div class="arch-modal-actions">${btnHtml}</div>
    </div>`;
    const onKey = (e) => { if (e.key === 'Escape') close(null); };
    function close(k) { ov.remove(); document.removeEventListener('keydown', onKey); resolve(k); }
    ov.addEventListener('click', (e) => {
      if (e.target === ov) return close(null);
      const b = e.target.closest('[data-k]');
      if (b) close(b.dataset.k);
    });
    document.addEventListener('keydown', onKey);
    document.body.appendChild(ov);
    const first = ov.querySelector('[data-k]');
    if (first) first.focus();
  });
}

async function confirmDeleteDraft(root, id) {
  const c = _cases.find(x => x.id === id);
  if (!c) return;
  const nm = nameText(c);
  const num = c.case_number ? ' — ' + esc(c.case_number) : '';
  const choice = await choiceModal({
    title: 'Smazat rozpracovanou kontrolu?',
    body: `<p><strong>${nm ? esc(nm) : 'bez jména'}</strong>${num}</p><p>Tato rozpracovaná kontrola bude trvale odstraněna.</p>`,
    buttons: [
      { key: 'delete', label: 'Smazat', cls: 'aml-btn-danger' },
      { key: 'cancel', label: 'Zpět', cls: '' },
    ],
  });
  if (choice !== 'delete') return;
  try {
    const r = await apiAmlDeleteCase(id);
    if (r && r.ok) {
      showToast(r.client_deleted ? 'Kontrola i klient smazáni.' : 'Rozpracovaná kontrola smazána.');
      await loadArchiv(root);
    } else showToast((r && r.message) || 'Smazání se nezdařilo.');
  } catch { showToast('Smazání se nezdařilo.'); }
}

async function confirmDeleteEmpty(root) {
  const empties = _cases.filter(isEmptyDraft);
  if (!empties.length) return;
  const choice = await choiceModal({
    title: 'Smazat prázdné rozpracované?',
    body: `<p>Bude odstraněno <strong>${empties.length}</strong> prázdných rozpracovaných kontrol (bez jména, krok 1, bez lustrace).</p>`,
    buttons: [
      { key: 'delete', label: 'Smazat', cls: 'aml-btn-danger' },
      { key: 'cancel', label: 'Zpět', cls: '' },
    ],
  });
  if (choice !== 'delete') return;
  try {
    const r = await apiAmlDeleteEmpty();
    if (r && r.ok) { showToast(`Smazáno ${r.deleted || 0} prázdných kontrol.`); await loadArchiv(root); }
    else showToast('Smazání se nezdařilo.');
  } catch { showToast('Smazání se nezdařilo.'); }
}

function recordDataFromCase(c, lookups, documents, profile) {
  return {
    caseNumber: c.case_number, povinnaOsoba: profile || null, dateISO: c.completed_at || c.created_at,
    subjectType: c.subject_type,
    client: {
      name: [c.client_name, c.client_surname].filter(Boolean).join(' '), nameOriginal: c.client_name_original || '',
      birthDate: c.client_birth_date || '', birthPlace: c.client_birth_place || '', address: c.client_address || '',
      nationality: c.client_nationality || '', docType: c.client_doc_type || '', docNumber: c.client_doc_number || '',
      rc: c.client_rc || '', occupation: c.client_occupation || '',
    },
    company: {
      name: c.company_name || '', ico: c.client_ico || '', address: c.company_address || '',
      actingRole: c.acting_person_role || '', actingNote: c.acting_person_note || '',
      esmChecked: !!c.esm_checked, esmNote: c.esm_note || '',
    },
    identification: { method: c.identification_method, verifier: parse(c.verifier_declaration_json) },
    deal: { relationType: c.relation_type, valueBand: c.deal_value_band, countries: c.deal_countries, category: c.purpose_category, purpose: c.business_purpose },
    source: { type: c.source_of_funds_type, detail: c.source_of_funds },
    consistency: parse(c.consistency_json),
    lookups: (lookups || []).map(l => ({ type: l.lookup_type, status: l.status, matched_against: l.matched_against, checked_at: l.checked_at, source: (l.details && l.details.source) || l.source || null })),
    documents: documents || [],
    risk: { suggestion: parse(c.ai_risk_reasoning), finalLevel: c.final_risk_level, justification: c.risk_justification, decidedAt: c.risk_decided_at },
    declaration: parse(c.client_declaration_json),
    recordSha: c.record_sha256 || null,
    regenerated: true,
  };
}
