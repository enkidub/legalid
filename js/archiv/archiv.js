// legalid.cz — js/archiv/archiv.js
// Archiv AML kontrol — dokončené i ukončené případy + regenerace PDF (bez příloh).
import { apiAmlListCases, apiAmlGetCase, apiAmlGetLookups, apiAmlGetDocuments } from '../core/api.js';
import { buildRecordPdf, buildTerminationPdf, fmtDateCs } from '../aml/pdf.js';
import { state } from '../core/state.js';
import { showToast, esc } from '../core/ui.js';
import { markLoginRedirect } from '../auth/auth.js';

let _cases = [];   // cache načtených případů

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
  root.addEventListener('click', (e) => {
    const t = e.target.closest('[data-act]');
    if (!t) return;
    if (t.dataset.act === 'archiv-retry') loadArchiv(root);
    if (t.dataset.act === 'regen') regenerate(root, +t.dataset.id);
    if (t.dataset.act === 'new-check' && window.navigate) window.navigate('/aml');
    if (t.dataset.act === 'resume-aml') {
      try { sessionStorage.setItem('legalid_aml_resume', t.dataset.id); } catch {}
      if (window.navigate) window.navigate('/aml');
    }
  });
  loadArchiv(root);
}

async function loadArchiv(root) {
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
  const inprog = _cases.filter(c => c.status === 'in_progress');
  const done = _cases.filter(c => c.status === 'completed' || c.status === 'terminated');
  root.innerHTML = archivHTML(inprog, done);
}

const RISK_CS = { nizke: 'Nízké', stredni: 'Střední', vysoke: 'Vysoké' };
const STEP_LABELS = ['Údaje klienta', 'Lustrace', 'Účel obchodu', 'Riziko', 'Záznam'];

function caseName(c) {
  return c.subject_type === 'po'
    ? (c.company_name || 'firma bez názvu')
    : ([c.client_name, c.client_surname].filter(Boolean).join(' ') || 'bez jména');
}

function progressRows(list) {
  return list.map(c => {
    const step = c.current_step || 0;
    const meta = [c.case_number, `krok ${step + 1} z 5 (${STEP_LABELS[step] || ''})`,
      c.created_at && `založeno ${fmtDateCs(c.created_at)}`].filter(Boolean).join(' · ');
    return `<div class="arch-row">
      <div class="arch-main">
        <div class="arch-name">${esc(caseName(c))} <span class="arch-badge arch-badge-prog">rozpracováno</span></div>
        <div class="arch-meta">${esc(meta)}</div>
      </div>
      <button class="aml-btn aml-btn-sm aml-btn-primary" data-act="resume-aml" data-id="${c.id}">Pokračovat</button>
    </div>`;
  }).join('');
}

function archivHTML(inprog, list) {
  const head = `<div class="view-lp-head">
    <div class="view-lp-title">Archiv AML kontrol</div>
    <button class="aml-btn aml-btn-sm" data-act="new-check" style="margin-left:auto">Nová kontrola</button>
  </div>`;
  const progSection = inprog.length
    ? `<div class="arch-section-title">Rozpracované</div><div class="arch-list">${progressRows(inprog)}</div>` : '';
  if (!list.length && !inprog.length) {
    return `<div class="view-archiv-wrap">${head}
      <div class="aml-card"><div class="aml-ai-note">Zatím nemáte žádné kontroly. Rozpracované i dokončené kontroly se objeví zde.</div></div></div>`;
  }
  const doneTitle = list.length ? `<div class="arch-section-title">Dokončené a ukončené</div>` : '';
  const rows = list.map(c => {
    const name = c.subject_type === 'po'
      ? (c.company_name || 'firma bez názvu')
      : ([c.client_name, c.client_surname].filter(Boolean).join(' ') || 'bez jména');
    const terminated = c.status === 'terminated';
    const badge = terminated
      ? `<span class="arch-badge arch-badge-term">ukončeno</span>`
      : `<span class="arch-badge arch-badge-done">dokončeno</span>`;
    const risk = (!terminated && c.final_risk_level)
      ? `<span class="arch-risk arch-risk-${esc(c.final_risk_level)}">${esc(RISK_CS[c.final_risk_level] || c.final_risk_level)} riziko</span>` : '';
    const meta = [
      c.case_number,
      c.completed_at && `${terminated ? 'ukončeno' : 'dokončeno'} ${fmtDateCs(c.completed_at)}`,
      (!terminated && c.next_review_due) && `revize do ${fmtDateCs(c.next_review_due)}`,
    ].filter(Boolean).join(' · ');
    return `<div class="arch-row">
      <div class="arch-main">
        <div class="arch-name">${esc(name)} ${badge} ${risk}</div>
        <div class="arch-meta">${esc(meta)}</div>
      </div>
      <button class="aml-btn aml-btn-sm" data-act="regen" data-id="${c.id}">Regenerovat PDF</button>
    </div>`;
  }).join('');
  const doneSection = list.length ? `${doneTitle}<div class="arch-list">${rows}</div>` : '';
  return `<div class="view-archiv-wrap">${head}${progSection}${doneSection}</div>`;
}

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

async function regenerate(root, id) {
  const btn = root.querySelector(`[data-act="regen"][data-id="${id}"]`);
  if (btn) { btn.disabled = true; btn.textContent = 'Generuji…'; }
  try {
    const cr = await apiAmlGetCase(id);
    const c = cr.case;
    if (!c) throw new Error('not_found');
    const profile = cr.profile || null;
    let bytes;
    if (c.status === 'terminated') {
      bytes = await buildTerminationPdf({
        caseNumber: c.case_number, povinnaOsoba: profile, dateISO: c.completed_at || c.created_at,
        clientName: [c.client_name, c.client_surname].filter(Boolean).join(' '),
        clientNameOriginal: c.client_name_original || '', clientBirthDate: c.client_birth_date || '',
        clientDocNumber: c.client_doc_number || '', reasonLabel: c.terminated_reason || 'Ukončeno', reasonText: '',
      });
    } else {
      let lookups = [], documents = [];
      try { const l = await apiAmlGetLookups(id); lookups = l.results || []; } catch {}
      try { const d = await apiAmlGetDocuments(id); documents = d.documents || []; } catch {}
      bytes = await buildRecordPdf(recordDataFromCase(c, lookups, documents, profile));
    }
    downloadPdf(bytes, `${c.case_number || 'AML'}-zaznam.pdf`);
  } catch {
    showToast('Regenerace PDF se nezdařila.');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Regenerovat PDF'; }
  }
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
