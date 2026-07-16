// legalid.cz — js/archiv/archiv.js
// Archiv AML kontrol — sdílený sloupcový seznam (viz js/core/rowlist.js).
import { apiAmlListCases, apiAmlGetCase, apiAmlGetLookups, apiAmlGetDocuments, apiAmlDeleteCase, apiAmlDeleteEmpty } from '../core/api.js';
import { buildRecordPdf, buildTerminationPdf } from '../aml/pdf.js';
import { state } from '../core/state.js';
import { showToast, esc } from '../core/ui.js';
import { markLoginRedirect } from '../auth/auth.js';
import {
  RISK_RANK, EMPTY_CELL, humanizeName, norm, relDate, fmtDateCs, dayWord,
  riskDotHTML, amberBadge, copyToClipboard, choiceModal,
  openRowMenu, closeRowMenu, bindRowMenuGlobalClose,
} from '../core/rowlist.js';

let _cases = [];
let _filter = 'all';        // all | in_progress | completed | terminated
let _sort = 'newest';       // newest | review | risk
let _query = '';
let _limit = 50;
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
  bindRowMenuGlobalClose();
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
    case 'copy-case': copyToClipboard(t.dataset.num, 'Číslo případu zkopírováno.'); break;
    case 'row-main': mainAction(root, id); break;
    case 'resume-aml': resumeCase(id); break;
    case 'view-pdf': viewPdf(root, id); break;
    case 'regen': regenerate(root, id); break;
    case 'del-draft': confirmDeleteDraft(root, id); break;
    case 'del-empty': confirmDeleteEmpty(root); break;
    case 'row-menu': openArchMenu(root, t, id); break;
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

const STEP_LABELS = ['Údaje klienta', 'Lustrace', 'Účel obchodu', 'Riziko', 'Záznam'];

function nameText(c) {
  return humanizeName(c.subject_type === 'po'
    ? (c.company_name || '')
    : [c.client_name, c.client_surname].filter(Boolean).join(' '));
}
function draftHasName(c) { return c.subject_type === 'po' ? !!c.company_name : !!(c.client_name || c.client_surname); }
function draftHasLustrace(c) { return (c.lookup_count || 0) > 0; }
function isEmptyDraft(c) { return c.status === 'in_progress' && !draftHasName(c) && (c.current_step || 0) === 0 && !draftHasLustrace(c); }
function isDecidedNoRecord(c) { return c.status === 'in_progress' && !!c.risk_decided_at; }
function isVisible(c) { return c.status === 'in_progress' || c.status === 'completed' || c.status === 'terminated'; }

function statusMatchesFilter(c, f) { return f === 'all' ? isVisible(c) : c.status === f; }
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
    arr.sort((a, b) => {
      const ra = a.next_review_due || '', rb = b.next_review_due || '';
      if (ra && rb) return ra < rb ? -1 : (ra > rb ? 1 : 0);
      if (ra) return -1; if (rb) return 1;
      return sortKey(b).localeCompare(sortKey(a));
    });
  } else if (_sort === 'risk') {
    arr.sort((a, b) => (RISK_RANK[b.final_risk_level] || 0) - (RISK_RANK[a.final_risk_level] || 0) || sortKey(b).localeCompare(sortKey(a)));
  } else {
    arr.sort((a, b) => sortKey(b).localeCompare(sortKey(a)));
  }
  return arr;
}

function renderShell(root) {
  const n = {
    all: _cases.filter(isVisible).length,
    in_progress: _cases.filter(c => c.status === 'in_progress').length,
    completed: _cases.filter(c => c.status === 'completed').length,
    terminated: _cases.filter(c => c.status === 'terminated').length,
  };
  const seg = [['all', 'Vše'], ['in_progress', 'Rozpracované'], ['completed', 'Dokončené'], ['terminated', 'Ukončené']]
    .map(([k, l]) => `<button class="rl-seg-btn${_filter === k ? ' is-on' : ''}" data-act="set-filter" data-filter="${k}">${l} <span class="rl-seg-n">${n[k]}</span></button>`).join('');
  const sortOpts = [['newest', 'Nejnovější'], ['review', 'Revize nejdříve'], ['risk', 'Podle rizika']]
    .map(([v, l]) => `<option value="${v}"${_sort === v ? ' selected' : ''}>${l}</option>`).join('');
  root.innerHTML = `<div class="view-archiv-wrap">
    <div class="view-lp-head">
      <div class="view-lp-title">Archiv AML kontrol</div>
      <button class="aml-btn aml-btn-sm" data-act="new-check" style="margin-left:auto">Nová kontrola</button>
    </div>
    <div class="rl-toolbar">
      <div class="rl-seg" role="tablist">${seg}</div>
      <div class="rl-tools">
        <input class="rl-search" id="archSearch" type="search" placeholder="Hledat jméno, IČO, číslo případu…" value="${esc(_query)}">
        <select class="rl-sort" id="archSort" aria-label="Řazení">${sortOpts}</select>
      </div>
    </div>
    <div class="rl-list" id="archList"></div>
    <div class="rl-foot" id="archFoot"></div>
  </div>`;
}

function headHTML() {
  return `<div class="rl-head">
    <div class="rl-c1">Klient</div><div class="rl-c2">Stav</div><div class="rl-c3">Riziko</div>
    <div class="rl-c4">Revize</div><div class="rl-act"></div><div class="rl-more"></div>
  </div>`;
}

function renderList(root) {
  root.querySelectorAll('.rl-seg-btn').forEach(b => b.classList.toggle('is-on', b.dataset.filter === _filter));
  const listEl = root.querySelector('#archList');
  const footEl = root.querySelector('#archFoot');
  if (!listEl || !footEl) return;

  const filtered = sortCases(_cases.filter(c => statusMatchesFilter(c, _filter) && matchesQuery(c, _query)));
  if (!_cases.filter(isVisible).length) {
    listEl.innerHTML = `<div class="rl-empty">Zatím nemáte žádné kontroly. Rozpracované i dokončené kontroly se objeví zde.</div>`;
    footEl.innerHTML = ''; return;
  }
  if (!filtered.length) {
    listEl.innerHTML = `<div class="rl-empty">Žádné záznamy neodpovídají hledání.</div>`;
    footEl.innerHTML = ''; return;
  }
  const shown = filtered.slice(0, _limit);
  listEl.innerHTML = headHTML() + shown.map(rowHTML).join('');

  const emptyCount = _cases.filter(isEmptyDraft).length;
  const more = filtered.length > _limit
    ? `<button class="aml-btn aml-btn-sm" data-act="load-more">Načíst další (${filtered.length - _limit})</button>` : '';
  const emptyPart = emptyCount
    ? ` · ${emptyCount} prázdných rozpracovaných <button class="rl-foot-del" data-act="del-empty">Smazat prázdné (${emptyCount})</button>` : '';
  footEl.innerHTML = `<div class="rl-foot-row"><span class="rl-foot-count">${filtered.length} záznamů${emptyPart}</span>${more}</div>`;
}

function rowHTML(c) {
  const decidedNoRecord = isDecidedNoRecord(c);
  const nm = nameText(c);
  const nameHTML = nm ? `<span class="rl-name">${esc(nm)}</span>` : `<span class="rl-name rl-name--empty">bez jména</span>`;

  let stav;
  if (c.status === 'completed') stav = `<span class="rl-stav"><i class="ti ti-check rl-stav-ok"></i> Dokončeno</span>`;
  else if (c.status === 'terminated') stav = `<span class="rl-stav">Ukončeno § 15</span>`;
  else if (decidedNoRecord) stav = amberBadge('Chybí záznam', 'Rozhodnuto — chybí záznam');
  else stav = `<span class="rl-stav">Rozpracováno</span>`;

  const risk = c.status === 'completed' ? riskDotHTML(c.final_risk_level) : EMPTY_CELL;
  const review = c.status === 'completed' ? (reviewHTML(c.next_review_due) || EMPTY_CELL) : EMPTY_CELL;

  const iso = c.completed_at || c.created_at;
  const rel = relDate(iso);
  const dateSpan = rel ? `<span class="rl-rel" title="${esc(fmtDateCs(iso))}">${esc(rel)}</span>` : '';
  const l2 = [];
  if (c.case_number) l2.push(`<span class="rl-mono" data-act="copy-case" data-num="${esc(c.case_number)}" title="Kopírovat číslo případu">${esc(c.case_number)}</span>`);
  if (c.status === 'in_progress') {
    l2.push(esc(decidedNoRecord ? 'dokončete krok 5' : `krok ${(c.current_step || 0) + 1} z 5`));
    if (dateSpan) l2.push(dateSpan);
  } else {
    const label = c.status === 'terminated' ? 'ukončeno' : 'dokončeno';
    l2.push(dateSpan ? `${esc(label)} ${dateSpan}` : esc(label));
  }
  const l2html = l2.join('<span class="rl-mid-dot">·</span>');

  const mainLabel = c.status === 'in_progress' ? (decidedNoRecord ? 'Dokončit' : 'Pokračovat') : 'Zobrazit';
  const mainAct = c.status === 'in_progress' ? 'resume-aml' : 'view-pdf';

  return `<div class="rl-row" data-act="row-main" data-id="${c.id}" role="button" tabindex="0">
    <div class="rl-c1"><div class="rl-l1">${nameHTML}</div><div class="rl-l2">${l2html}</div></div>
    <div class="rl-c2">${stav}</div>
    <div class="rl-c3">${risk}</div>
    <div class="rl-c4">${review}</div>
    <div class="rl-act"><button class="rl-act-main" data-act="${mainAct}" data-id="${c.id}">${mainLabel}</button></div>
    <div class="rl-more"><button class="rl-act-more" data-act="row-menu" data-id="${c.id}" aria-label="Další akce" title="Další akce">⋯</button></div>
  </div>`;
}

function reviewHTML(due) {
  if (!due) return '';
  const d = new Date(due);
  if (isNaN(d)) return '';
  const days = Math.ceil((d.getTime() - Date.now()) / 86400000);
  const clock = '<i class="ti ti-clock-hour-4"></i>';
  const full = esc(fmtDateCs(due));
  if (days < 0) return `<span class="rl-review rl-review--soon" title="${full}">${clock} po termínu</span>`;
  if (days === 0) return `<span class="rl-review rl-review--soon" title="${full}">${clock} dnes</span>`;
  if (days < 30) return `<span class="rl-review rl-review--soon" title="${full}">${clock} za ${days} ${dayWord(days)}</span>`;
  return `<span class="rl-review" title="${full}">${full}</span>`;
}

function mainAction(root, id) {
  const c = _cases.find(x => x.id === id);
  if (!c) return;
  if (c.status === 'in_progress') resumeCase(id); else viewPdf(root, id);
}
function resumeCase(id) {
  try { sessionStorage.setItem('legalid_aml_resume', String(id)); } catch {}
  if (window.navigate) window.navigate('/aml');
}

function openArchMenu(root, btn, id) {
  const c = _cases.find(x => x.id === id);
  if (!c) return;
  const items = c.status === 'in_progress'
    ? [{ act: 'resume-aml', label: 'Zobrazit detail' }, { act: 'del-draft', label: 'Smazat', danger: true }]
    : [{ act: 'view-pdf', label: 'Zobrazit detail' }, { act: 'regen', label: 'Regenerovat PDF' }];
  openRowMenu(btn, id, items, (act, mid) => {
    if (act === 'resume-aml') resumeCase(mid);
    else if (act === 'view-pdf') viewPdf(root, mid);
    else if (act === 'regen') regenerate(root, mid);
    else if (act === 'del-draft') confirmDeleteDraft(root, mid);
  });
}

// ── PDF ──
function parse(s) { try { return s ? JSON.parse(s) : null; } catch { return null; } }
function downloadPdf(bytes, filename) {
  const blob = new Blob([bytes], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
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
  try { const { bytes, filename } = await buildCasePdfBytes(id); downloadPdf(bytes, filename); }
  catch { showToast('Regenerace PDF se nezdařila.'); }
}
async function viewPdf(root, id) {
  const w = window.open('', '_blank');
  try {
    const { bytes } = await buildCasePdfBytes(id);
    const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
    if (w) w.location = url; else window.open(url, '_blank');
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  } catch { if (w) w.close(); showToast('PDF se nepodařilo otevřít.'); }
}

// ── Mazání ──
async function confirmDeleteDraft(root, id) {
  const c = _cases.find(x => x.id === id);
  if (!c) return;
  const nm = nameText(c);
  const num = c.case_number ? ' — ' + esc(c.case_number) : '';
  const choice = await choiceModal({
    title: 'Smazat rozpracovanou kontrolu?',
    body: `<p><strong>${nm ? esc(nm) : 'bez jména'}</strong>${num}</p><p>Tato rozpracovaná kontrola bude trvale odstraněna.</p>`,
    buttons: [{ key: 'delete', label: 'Smazat', cls: 'aml-btn-danger' }, { key: 'cancel', label: 'Zpět', cls: '' }],
  });
  if (choice !== 'delete') return;
  try {
    const r = await apiAmlDeleteCase(id);
    if (r && r.ok) { showToast(r.client_deleted ? 'Kontrola i klient smazáni.' : 'Rozpracovaná kontrola smazána.'); await loadArchiv(root); }
    else showToast((r && r.message) || 'Smazání se nezdařilo.');
  } catch { showToast('Smazání se nezdařilo.'); }
}
async function confirmDeleteEmpty(root) {
  const empties = _cases.filter(isEmptyDraft);
  if (!empties.length) return;
  const choice = await choiceModal({
    title: 'Smazat prázdné rozpracované?',
    body: `<p>Bude odstraněno <strong>${empties.length}</strong> prázdných rozpracovaných kontrol (bez jména, krok 1, bez lustrace).</p>`,
    buttons: [{ key: 'delete', label: 'Smazat', cls: 'aml-btn-danger' }, { key: 'cancel', label: 'Zpět', cls: '' }],
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
