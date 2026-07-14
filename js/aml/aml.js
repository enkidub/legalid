// legalid.cz — js/aml/aml.js
// AML kontrola — wizard (týden 2: kostra 0–5 + krok 0 + krok 1 sken dokladu).
// Architektura: žádné inline onclick → jeden delegovaný listener na #amlRoot (data-act).
// Tím odpadá fragilní window-bridge (chybějící bridge byl zdroj minulých ReferenceError).

import { apiAmlCreateCase, apiAmlGetCase, apiAmlPatchCase, apiAmlAddDocument, apiAmlListCases, apiAmlListClients, apiAmlAres, apiAmlGetLookups, apiAmlRunLookup, apiOcr } from '../core/api.js';
import { state } from '../core/state.js';
import { showToast, esc } from '../core/ui.js';
import { openRegistrationModal } from '../auth/auth.js';

// Wizard: 5 kroků (0-index), zobrazeno jako 1–5. Krátké labely pro mobil (<640px).
const STEP_LABELS = ['Údaje klienta', 'Lustrace', 'Účel obchodu', 'Riziko', 'Záznam'];
const STEP_LABELS_SHORT = ['Údaje', 'Lustrace', 'Účel', 'Riziko', 'Záznam'];

// Mapování OCR: DB sloupec ← klíč z AML OCR. (RČ/IČO OCR nevrací — jen ve formuláři.)
const FIELD_MAP = [
  ['client_name', 'jmeno'],
  ['client_surname', 'prijmeni'],
  ['client_birth_date', 'datum_narozeni'],
  ['client_birth_place', 'misto_narozeni'],
  ['client_address', 'adresa_trvaleho_pobytu'],
  ['client_doc_type', 'typ_dokladu'],
  ['client_doc_number', 'cislo_dokladu'],
  ['client_doc_issued_at', 'datum_vydani'],
  ['client_doc_valid_until', 'datum_platnosti'],
  ['client_gender', 'pohlavi'],
  ['client_nationality', 'statni_obcanstvi'],
];

// Sloučený formulář kroku Údaje klienta. req = povinné (*).
const DOC_TYPES = [['OP', 'Občanský průkaz'], ['Pas', 'Cestovní pas'], ['ŘP', 'Řidičský průkaz'], ['Jiné', 'Jiné']];
const GENDERS = [['', '—'], ['M', 'Muž'], ['Ž', 'Žena']];
const FORM_FIELDS = [
  { col: 'client_name', label: 'Jméno', req: true },
  { col: 'client_surname', label: 'Příjmení', req: true },
  { col: 'client_birth_date', label: 'Datum narození', req: true, ph: 'DD.MM.RRRR' },
  { col: 'client_doc_type', label: 'Typ dokladu', req: true, type: 'select', opts: DOC_TYPES },
  { col: 'client_doc_number', label: 'Číslo dokladu', req: true },
  { col: 'client_doc_issued_at', label: 'Datum vydání dokladu', ph: 'DD.MM.RRRR' },
  { col: 'client_doc_valid_until', label: 'Datum platnosti dokladu', req: true, ph: 'DD.MM.RRRR' },
  { col: 'client_rc', label: 'Rodné číslo' },
  { col: 'client_address', label: 'Adresa trvalého pobytu' },
  { col: 'client_nationality', label: 'Státní občanství', req: true },
  { col: 'client_gender', label: 'Pohlaví', type: 'select', opts: GENDERS },
  { col: 'client_ico', label: 'IČO (podnikající FO)' },
];
const REQUIRED_COLS = FORM_FIELDS.filter(f => f.req).map(f => f.col);

// Cesty získání dat (horní dlaždice). SVG line ikony ve stylu landingu (stroke, bez fill).
// Rozměry i barva přímo v atributech → ikony se zobrazí i bez CSS (odolné vůči staré cachi).
const ICO = 'width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"';
const SVG = {
  camera: `<svg ${ICO}><path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/><circle cx="12" cy="13" r="3"/></svg>`,
  upload: `<svg ${ICO}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M12 18v-6"/><path d="m9 15 3-3 3 3"/></svg>`,
  manual: `<svg ${ICO}><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>`,
  list: `<svg ${ICO}><circle cx="10" cy="7" r="4"/><path d="M10.3 15H7a4 4 0 0 0-4 4v2"/><circle cx="17" cy="17" r="3"/><path d="m21 21-1.9-1.9"/></svg>`,
  close: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>',
};
const SOURCES = [
  { id: 'camera', svg: SVG.camera, title: 'Vyfotit doklad' },
  { id: 'upload', svg: SVG.upload, title: 'Nahrát soubor' },
  { id: 'manual', svg: SVG.manual, title: 'Zadat ručně' },
  { id: 'list', svg: SVG.list, title: 'Ze seznamu' },
];
const LAST_METHOD_KEY = 'legalid_aml_lastMethod';
function loadLastMethod() {
  try { const v = localStorage.getItem(LAST_METHOD_KEY); return SOURCES.some(s => s.id === v) ? v : 'camera'; }
  catch { return 'camera'; }
}

// Typ subjektu (segmentový přepínač nad dlaždicemi).
const SUBJECT_TYPES = [['fo', 'Fyzická osoba'], ['fo_podnikatel', 'Podnikající FO'], ['po', 'Právnická osoba']];
// Role jednající osoby (jen u PO).
const ROLE_OPTIONS = [['', '—'], ['jednatel', 'Jednatel'], ['clen_predstavenstva', 'Člen představenstva'], ['zmocnenec', 'Zmocněnec'], ['jine', 'Jiné']];

// Způsoby potvrzení totožnosti (dolní radia). Jen 'personal' aktivní v MVP.
const METHODS = [
  { id: 'personal', enabled: true, title: 'Osobní setkání' },
  { id: 'video', enabled: false, title: 'Video hovor' },
  { id: 'bankid', enabled: false, title: 'BankID' },
  { id: 'micropayment', enabled: false, title: 'Mikroplatba' },
];

// Pracovní stav wizardu (v paměti, persistuje se přes PATCH na server).
const wiz = {
  caseId: null,
  step: 0,
  source: 'camera',    // krok 0: 'camera' | 'upload' | 'manual' | 'list'
  subject_type: 'fo',  // 'fo' | 'fo_podnikatel' | 'po'
  method: 'personal',  // identification_method
  aresLoading: false, aresStatus: null,   // stav načítání firmy z ARES (PO)
  data: {},            // client_* hodnoty
  frontImg: null, backImg: null,
  frontExtracted: null, backExtracted: null,
  uploadFiles: [],     // source 'upload': [{ dataUrl, media_type, name }] max 3
  ocrLoading: null,    // null | 'front' | 'back' | 'multi'
  camStream: null, camSide: 'front',
  clients: null,       // cache uložených klientů (source 'list')
  clientQuery: '',
  lookups: null,            // pole výsledků lustrací (krok Lustrace), null = ještě neběželo
  lookupStatus: 'idle',     // 'idle' | 'running' | 'loading' | 'done'
  maxStep: 0,               // nejdál dosažený krok (pro klikatelnost indikátoru)
  forceRun: false,          // true = na kroku Lustrace spustit nově (ne načíst uložené)
};

// Popisky lustrací.
const LOOKUP_LABELS = {
  mvcr: 'Neplatné doklady (MVČR)',
  isir: 'Insolvenční rejstřík (ISIR)',
  ares: 'ARES (podnikatelský subjekt)',
  sanctions: 'Sankční seznam EU',
  pep: 'PEP databáze',
  isir_po: 'Insolvenční rejstřík (firma)',
  sanctions_entity: 'Sankční seznam EU (firmy)',
};
// FO: plochý seznam 5 lustrací. PO: skupiny Společnost / Jednající osoba.
const FO_LOOKUP_TYPES = ['mvcr', 'isir', 'ares', 'sanctions', 'pep'];
const PO_GROUP_COMPANY = ['ares', 'isir_po', 'sanctions_entity'];
const PO_GROUP_PERSON = ['mvcr', 'isir', 'sanctions', 'pep'];
function lookupTypeList() {
  return wiz.subject_type === 'po'
    ? [...PO_GROUP_COMPANY, ...PO_GROUP_PERSON]
    : FO_LOOKUP_TYPES;
}

const $ = (id) => document.getElementById(id);

export function renderAml() {
  return `
<div class="aml" id="amlRoot">
  <div class="aml-steps" id="amlSteps"></div>
  <div class="aml-main" id="amlMain"><div class="aml-loading">Načítám…</div></div>
  <div class="aml-foot" id="amlFoot"></div>
</div>`;
}

// Volá se po mountu /aml (z app.js). Naváže delegaci a rozjede wizard.
let _resizeBound = false;
export function initAml() {
  const root = $('amlRoot');
  if (!root) return;
  bindRoot(root);
  if (!_resizeBound) { _resizeBound = true; window.addEventListener('resize', () => renderSteps()); }
  if (!state.loggedIn) { renderLoginRequired(); return; }
  startAml(root);
}

// ── Delegace událostí ───────────────────────────────────────────────
function bindRoot(root) {
  root.addEventListener('click', (e) => {
    const t = e.target.closest('[data-act]');
    if (!t || !root.contains(t)) return;
    handleAction(root, t.dataset.act, t.dataset);
  });
  root.addEventListener('change', (e) => {
    if (e.target.id === 'amlUploadInput') {
      addUploadFiles(root, e.target.files); e.target.value = ''; return;
    }
    if (e.target.matches('input[type="file"]')) {   // kamera — jedna strana
      const side = e.target.dataset.side || 'front';
      const f = e.target.files && e.target.files[0];
      if (f) handleFile(root, f, side);
      e.target.value = '';
    }
    if (e.target.matches('input[name="amlMethod"]')) setMethod(e.target.value);
    // select / checkbox / textarea polí formuláře (typ dokladu, role, ESM, pohlaví)
    if (e.target.id && e.target.id.startsWith('aml_f_')) { readFieldsFromForm(); refreshContinue(); }
  });
  // Live validace formuláře + průběžné čtení do wiz.data (bez re-renderu → nezahodí fokus).
  root.addEventListener('input', (e) => {
    if (e.target.id && e.target.id.startsWith('aml_f_')) { readFieldsFromForm(); refreshContinue(); }
    if (e.target.id === 'amlClientSearch') { wiz.clientQuery = e.target.value; renderClientList(); }
  });
  // Drag & drop na dropzóny (source 'upload').
  root.addEventListener('dragover', (e) => {
    const dz = e.target.closest('.aml-dropzone');
    if (dz) { e.preventDefault(); dz.classList.add('aml-dropzone--over'); }
  });
  root.addEventListener('dragleave', (e) => {
    const dz = e.target.closest('.aml-dropzone');
    if (dz) dz.classList.remove('aml-dropzone--over');
  });
  root.addEventListener('drop', (e) => {
    const dz = e.target.closest('.aml-dropzone');
    if (!dz) return;
    e.preventDefault();
    dz.classList.remove('aml-dropzone--over');
    const files = e.dataTransfer?.files;
    if (files && files.length) addUploadFiles(root, files);
  });
}

function handleAction(root, act, ds) {
  switch (act) {
    case 'resume': resumeCase(root, +ds.id); break;
    case 'new': createNewCase(root); break;
    case 'login': openRegistrationModal(); break;
    case 'set-subject': setSubjectType(root, ds.subject); break;
    case 'ares-load': aresLoad(root); break;
    case 'pick-source': pickSource(root, ds.source); break;
    case 'capture': onCapture(root, ds.side); break;
    case 'add-upload': $('amlUploadInput')?.click(); break;
    case 'remove-upload': removeUpload(root, +ds.idx); break;
    case 'remove-side': removeSide(root, ds.side); break;
    case 'restart-step': restartStep(root); break;
    case 'cam-shoot': shootCamera(root); break;
    case 'cam-cancel': closeCamera(); break;
    case 'pick-client': pickClient(root, ds.key); break;
    case 'continue-lustrace': continueToLustrace(root); break;
    case 'next': goNext(root); break;
    case 'back': goBack(root); break;
    case 'goto-step': goToStep(root, +ds.idx); break;
    case 'toggle-detail': toggleLookupDetail(ds.type); break;
    case 'rerun-lookups': wiz.lookupStatus = 'idle'; wiz.lookups = null; renderLustrace(root); break;
    default: break;
  }
}

// ── Start / resume / new ─────────────────────────────────────────────
async function startAml(root) {
  if (wiz.caseId) { renderStep(root); return; }   // už rozpracováno v této relaci
  renderLoading('Načítám…');
  let cases = [];
  try { const r = await apiAmlListCases(); cases = r.cases || []; } catch {}
  const inProgress = cases.find(c => c.status === 'in_progress');
  if (inProgress) renderResume(root, inProgress);
  else await createNewCase(root);
}

async function createNewCase(root) {
  renderLoading('Zakládám případ…');
  try {
    const r = await apiAmlCreateCase();
    if (!r.case_id) throw new Error(r.error || 'create_failed');
    wiz.caseId = r.case_id; state.amlCurrentCaseId = r.case_id;
    wiz.step = 0; wiz.source = loadLastMethod(); wiz.method = 'personal'; wiz.data = {};
    wiz.subject_type = 'fo'; wiz.aresStatus = null; wiz.aresLoading = false;
    wiz.frontImg = wiz.backImg = wiz.frontExtracted = wiz.backExtracted = null;
    wiz.uploadFiles = []; wiz.ocrLoading = null; wiz.clients = null; wiz.clientQuery = '';
    wiz.lookups = null; wiz.lookupStatus = 'idle'; wiz.maxStep = 0; wiz.forceRun = false;
    if (wiz.source === 'list') loadClients(root);
    renderStep(root);
  } catch {
    renderError('Nepodařilo se založit AML případ. Zkuste to prosím znovu.');
  }
}

// Všechny datové sloupce klienta (formulář + místo narození z OCR).
const DATA_COLS = [...FORM_FIELDS.map(f => f.col), 'client_birth_place',
  'company_name', 'company_address', 'acting_person_role', 'acting_person_note', 'esm_checked', 'esm_note'];

async function resumeCase(root, id) {
  renderLoading('Načítám případ…');
  try {
    const r = await apiAmlGetCase(id);
    const c = r.case;
    if (!c) throw new Error('not_found');
    wiz.caseId = c.id; state.amlCurrentCaseId = c.id;
    wiz.method = c.identification_method || 'personal';
    wiz.subject_type = c.subject_type || 'fo';
    wiz.data = {};
    DATA_COLS.forEach(col => { if (c[col] != null && c[col] !== '') wiz.data[col] = c[col]; });
    wiz.step = c.current_step || 0;   // DB je již v novém schématu (migrace v4)
    wiz.maxStep = wiz.step; wiz.forceRun = false;
    wiz.source = hasClientData() ? 'manual' : 'camera';   // s daty rovnou ukaž formulář
    wiz.lookups = null; wiz.lookupStatus = 'idle';
    renderStep(root);
  } catch {
    renderError('Případ se nepodařilo načíst.');
  }
}

function hasClientData() {
  return FORM_FIELDS.some(f => (wiz.data[f.col] || '').trim());
}

// ── Krok Údaje klienta — výběr cesty získání dat ─────────────────────
function pickSource(root, id) {
  if (!SOURCES.some(s => s.id === id)) return;
  wiz.source = id;
  try { localStorage.setItem(LAST_METHOD_KEY, id); } catch {}
  if (id === 'list' && wiz.clients === null) loadClients(root);
  renderStep(root);
}

// Segmentový přepínač typu subjektu (FO / Podnikající FO / PO).
function setSubjectType(root, id) {
  if (!SUBJECT_TYPES.some(([v]) => v === id)) return;
  readFieldsFromForm();
  wiz.subject_type = id;
  patchCase({ subject_type: id });
  renderStep(root);
}

// Načtení firmy z ARES podle IČO (subject_type='po').
async function aresLoad(root) {
  readFieldsFromForm();
  const ico = (wiz.data.client_ico || '').replace(/\s/g, '');
  if (!/^\d{6,8}$/.test(ico)) { showToast('Zadejte platné IČO (6–8 číslic).'); return; }
  wiz.aresLoading = true; wiz.aresStatus = null; renderStep(root);
  try {
    const s = await apiAmlAres(ico);
    if (s && s.found) {
      if (s.name) wiz.data.company_name = s.name;
      if (s.address) wiz.data.company_address = s.address;
      wiz.aresStatus = { ok: true, active: s.active, text: s.active ? 'Aktivní subjekt' : `Zaniklý subjekt${s.zanik ? ` (${s.zanik})` : ''}` };
    } else {
      wiz.aresStatus = { ok: false, text: 'Subjekt s tímto IČO nebyl v ARES nalezen.' };
    }
  } catch {
    wiz.aresStatus = { ok: false, text: 'ARES nedostupný — vyplňte údaje ručně.' };
  } finally {
    wiz.aresLoading = false; renderStep(root);
  }
}

// ── Navigace ─────────────────────────────────────────────────────────
async function patchCase(fields) {
  if (!wiz.caseId) return;
  try { await apiAmlPatchCase(wiz.caseId, fields); }
  catch { showToast('Nepodařilo se uložit stav.'); }
}

// Kroky 1–4 (Lustrace, Účel, Riziko, Hotovo). Krok 0 vede vlastní tlačítko v kartě.
async function goNext(root) {
  if (wiz.step >= 1 && wiz.step <= 3) {
    wiz.step += 1;
    wiz.maxStep = Math.max(wiz.maxStep, wiz.step);
    await patchCase({ current_step: wiz.maxStep });
  }
  renderStep(root);
}

async function goBack(root) {
  if (wiz.step > 0) {
    wiz.step -= 1;   // pohyb zpět nezmenšuje dosažený pokrok (maxStep drží klikatelnost)
    if (wiz.step === 0) wiz.source = hasClientData() ? 'manual' : 'camera';
  }
  renderStep(root);
}

// Klik na dokončený krok v indikátoru — návrat bez ztráty dat (data se čtou z case).
async function goToStep(root, idx) {
  if (idx === wiz.step || idx > wiz.maxStep) return;
  wiz.step = idx;
  if (idx === 0) wiz.source = hasClientData() ? 'manual' : 'camera';
  if (idx === 1) { wiz.lookupStatus = 'idle'; wiz.forceRun = false; }   // Lustrace → načti uložené
  renderStep(root);
}

// Uloží data klienta a přejde na Lustraci (krok 0 → 1). Vždy čerstvý běh lustrace.
async function continueToLustrace(root) {
  readFieldsFromForm();
  if (!formValid()) { showToast('Vyplňte prosím všechna povinná pole (*).'); return; }
  // PO: bez ověření skutečných majitelů nelze pokračovat.
  if (wiz.subject_type === 'po' && !wiz.data.esm_checked) {
    showToast('U právnické osoby nejdřív ověřte skutečné majitele v ESM a zaškrtněte potvrzení.');
    return;
  }
  const patch = { current_step: 1, identification_method: wiz.method, subject_type: wiz.subject_type };
  DATA_COLS.forEach(col => { patch[col] = (wiz.data[col] === '' || wiz.data[col] == null) ? null : wiz.data[col]; });
  await patchCase(patch);
  wiz.step = 1; wiz.maxStep = Math.max(wiz.maxStep, 1);
  wiz.lookupStatus = 'idle'; wiz.lookups = null; wiz.forceRun = true;   // nová data → čerstvá lustrace
  renderStep(root);
}

function setMethod(id) {
  const m = METHODS.find(x => x.id === id);
  if (m && m.enabled) wiz.method = id;
}

// ── Kamera / soubor / OCR ────────────────────────────────────────────
function onCapture(root, side) {
  wiz.camSide = side || 'front';
  const isMobile = matchMedia('(max-width: 800px)').matches || 'ontouchstart' in window;
  if (isMobile) { $('amlCapture_' + wiz.camSide)?.click(); return; }
  openCamera(root);
}

// Smazání jedné strany kamerového snímku (× na miniatuře) — bez potvrzení (malý zásah).
function removeSide(root, side) {
  if (side === 'back') { wiz.backImg = null; wiz.backExtracted = null; }
  else { wiz.frontImg = null; wiz.frontExtracted = null; }
  renderStep(root);
}

// Reset celého kroku 1 (upload/foto + formulář + způsob ověření). Nemaže aml_case.
function restartStep(root) {
  if (!confirm('Opravdu vymazat všechna nahraná data a údaje?')) return;
  wiz.data = {};
  wiz.frontImg = wiz.backImg = wiz.frontExtracted = wiz.backExtracted = null;
  wiz.uploadFiles = []; wiz.ocrLoading = null; wiz.method = 'personal';
  renderStep(root);
}

function handleFile(root, file, side) {
  const r = new FileReader();
  r.onload = () => handleImageDataUrl(root, r.result, side || 'front');
  r.onerror = () => showToast('Soubor se nepodařilo načíst.');
  r.readAsDataURL(file);
}

const MAX_UPLOAD = 3, MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

// Přidá 1–N souborů do upload zóny (max 3, ≤10 MB, JPG/PNG/PDF) a spustí sloučenou AI extrakci.
async function addUploadFiles(root, fileList) {
  const files = Array.from(fileList || []);
  for (const f of files) {
    if (wiz.uploadFiles.length >= MAX_UPLOAD) { showToast(`Max. ${MAX_UPLOAD} soubory.`); break; }
    const isPdf = f.type === 'application/pdf';
    const isImg = f.type.startsWith('image/');
    if (!isPdf && !isImg) { showToast('Podporujeme jen JPG, PNG a PDF.'); continue; }
    if (f.size > MAX_UPLOAD_BYTES) { showToast(`${f.name}: přesahuje 10 MB.`); continue; }
    const dataUrl = await new Promise((res, rej) => {
      const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(f);
    }).catch(() => null);
    if (!dataUrl) { showToast('Soubor se nepodařilo načíst.'); continue; }
    const small = isPdf ? dataUrl : await downscale(dataUrl);
    wiz.uploadFiles.push({ dataUrl: small, media_type: isPdf ? 'application/pdf' : 'image/jpeg', name: f.name, isPdf });
  }
  renderStep(root);
  if (wiz.uploadFiles.length) runMultiOcr(root);
}

function removeUpload(root, idx) {
  wiz.uploadFiles.splice(idx, 1);   // × maže jeden soubor bez potvrzení (malý zásah)
  renderStep(root);
}

// Pošle všechna nahraná média najednou do /ocr (multi) a sloučí výsledek do formuláře.
async function runMultiOcr(root) {
  wiz.ocrLoading = 'multi'; renderStep(root);
  try {
    const payload = wiz.uploadFiles.map(u => ({ data: u.dataUrl.split(',')[1], media_type: u.media_type }));
    const data = await apiOcr(payload, 'aml', null, true);
    if (data.error) throw new Error(data.message || 'ocr_failed');
    mergeExtracted(data, false);
    for (const u of wiz.uploadFiles) saveDoc('doklad_upload', u.dataUrl, u.isPdf ? null : data);
  } catch {
    showToast('AI rozpoznání selhalo — vyplňte údaje ručně.');
  } finally {
    wiz.ocrLoading = null; renderStep(root);
  }
}

function downscale(dataUrl, maxDim = 1400, quality = 0.82) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
      const cw = Math.round(img.width * scale), ch = Math.round(img.height * scale);
      const c = document.createElement('canvas');
      c.width = cw; c.height = ch;
      c.getContext('2d').drawImage(img, 0, 0, cw, ch);
      resolve(c.toDataURL('image/jpeg', quality));
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
}

async function handleImageDataUrl(root, dataUrl, side) {
  const isBack = side === 'back';
  const small = await downscale(dataUrl);
  if (isBack) wiz.backImg = small; else wiz.frontImg = small;
  wiz.ocrLoading = side; renderStep(root);
  let extracted = null;
  try {
    const base64 = small.split(',')[1];
    const data = await apiOcr([{ data: base64, media_type: 'image/jpeg' }], 'aml', isBack ? 'back' : 'front');
    if (data.error) throw new Error(data.message || 'ocr_failed');
    mergeExtracted(data, isBack);
    extracted = data;
    if (isBack) wiz.backExtracted = data; else wiz.frontExtracted = data;
  } catch {
    showToast('AI rozpoznání selhalo — vyplňte údaje ručně.');
    const failed = { __failed: true };
    if (isBack) wiz.backExtracted = failed; else wiz.frontExtracted = failed;
  } finally {
    wiz.ocrLoading = null; renderStep(root);
  }
  saveDoc(isBack ? 'doklad_back' : 'doklad_front', isBack ? wiz.backImg : wiz.frontImg, extracted);
}

function mergeExtracted(data, isBack) {
  FIELD_MAP.forEach(([col, from]) => {
    const v = data[from];
    if (v == null || v === '') return;
    if (isBack) { if (!wiz.data[col]) wiz.data[col] = v; }   // zadní strana jen doplní chybějící
    else wiz.data[col] = v;
  });
}

// Přečte všechna pole formuláře (osobní + firma + role + ESM) dle id „aml_f_<col>".
function readFieldsFromForm() {
  document.querySelectorAll('#amlMain [id^="aml_f_"]').forEach(el => {
    const col = el.id.slice(6);
    wiz.data[col] = el.type === 'checkbox' ? (el.checked ? 1 : 0) : el.value.trim();
  });
}

function formValid() {
  const req = [...REQUIRED_COLS];
  if (wiz.subject_type === 'fo_podnikatel' || wiz.subject_type === 'po') req.push('client_ico');
  return req.every(col => String(wiz.data[col] ?? '').trim());
}

// Přepne stav tlačítka „pokračovat na lustraci" bez re-renderu (nezahodí fokus).
function refreshContinue() {
  const btn = $('amlContinue');
  if (btn) btn.disabled = !formValid();
}

async function saveDoc(type, img, extracted) {
  if (!img) return;
  try {
    await apiAmlAddDocument(wiz.caseId, {
      doc_type: type,
      filename: type + '.jpg',
      content_base64: img.split(',')[1],
      ai_extracted_data: (extracted && !extracted.__failed) ? extracted : null,
    });
  } catch { showToast('Foto se nepodařilo uložit.'); }
}

// ── Ze seznamu (uložení klienti z předchozích případů) ───────────────
async function loadClients(root) {
  try {
    const r = await apiAmlListClients();
    wiz.clients = r.clients || [];
  } catch { wiz.clients = []; }
  if (wiz.step === 0 && wiz.source === 'list') renderStep(root);
}

function clientKey(c) {
  return (c.client_doc_number || '') || `${c.client_name}|${c.client_surname}|${c.client_birth_date || ''}`;
}

function pickClient(root, key) {
  const c = (wiz.clients || []).find(x => clientKey(x) === key);
  if (!c) return;
  DATA_COLS.forEach(col => { if (c[col]) wiz.data[col] = c[col]; });
  renderStep(root);
}

// ── Kamera (desktop, getUserMedia) ───────────────────────────────────
function openCamera(root) {
  if (!navigator.mediaDevices?.getUserMedia) {
    showToast('Kamera není dostupná — použijte „Z galerie".');
    return;
  }
  const ov = document.createElement('div');
  ov.className = 'aml-cam'; ov.id = 'amlCam';
  ov.innerHTML = `<div class="aml-cam-box">
    <video id="amlCamVideo" autoplay playsinline muted></video>
    <div class="aml-cam-btns">
      <button class="aml-btn" data-act="cam-cancel">Zrušit</button>
      <button class="aml-btn aml-btn-primary" data-act="cam-shoot">Pořídit snímek</button>
    </div>
  </div>`;
  root.appendChild(ov);
  navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })
    .then(s => { wiz.camStream = s; const v = $('amlCamVideo'); if (v) v.srcObject = s; })
    .catch(() => { showToast('Kameru se nepodařilo otevřít — použijte „Z galerie".'); closeCamera(); });
}

function closeCamera() {
  if (wiz.camStream) { wiz.camStream.getTracks().forEach(t => t.stop()); wiz.camStream = null; }
  $('amlCam')?.remove();
}

function shootCamera(root) {
  const v = $('amlCamVideo');
  if (!v || !v.videoWidth) { showToast('Snímek se nepodařil, zkuste to znovu.'); return; }
  const c = document.createElement('canvas');
  c.width = v.videoWidth; c.height = v.videoHeight;
  c.getContext('2d').drawImage(v, 0, 0);
  const dataUrl = c.toDataURL('image/jpeg', 0.85);
  closeCamera();
  handleImageDataUrl(root, dataUrl);
}

// ── Rendering ────────────────────────────────────────────────────────
function renderLoading(msg) { const m = $('amlMain'); if (m) m.innerHTML = `<div class="aml-loading">${esc(msg)}</div>`; }
function renderError(msg) { const m = $('amlMain'); if (m) m.innerHTML = `<div class="aml-card"><div class="aml-ai-note">${esc(msg)}</div><button class="aml-btn aml-btn-primary" data-act="new">Začít novou kontrolu</button></div>`; }

function renderLoginRequired() {
  const steps = $('amlSteps'); if (steps) steps.innerHTML = '';
  const foot = $('amlFoot'); if (foot) foot.innerHTML = '';
  const m = $('amlMain');
  if (m) m.innerHTML = `<div class="aml-card aml-login">
    <div class="aml-h">AML kontrola</div>
    <div class="aml-ai-note">Pro vedení AML kontroly klienta se přihlaste — případy se ukládají k vašemu účtu.</div>
    <button class="aml-btn aml-btn-primary" data-act="login">Přihlásit se / Registrovat</button>
  </div>`;
}

function renderResume(root, c) {
  renderSteps();
  const name = [c.client_name, c.client_surname].filter(Boolean).join(' ') || 'bez jména';
  $('amlMain').innerHTML = `<div class="aml-card">
    <div class="aml-h">Rozdělaná kontrola</div>
    <div class="aml-ai-note">Máte rozpracovaný případ #${c.id} (${esc(name)}, krok ${(c.current_step || 0) + 1}). Chcete pokračovat, nebo začít novou?</div>
    <div class="aml-upload-btns">
      <button class="aml-btn aml-btn-primary" data-act="resume" data-id="${c.id}">Pokračovat v rozdělané kontrole</button>
      <button class="aml-btn" data-act="new">Začít novou</button>
    </div>
  </div>`;
  $('amlFoot').innerHTML = '';
}

function renderSteps() {
  const wrap = $('amlSteps');
  if (!wrap) return;
  // Jeden label podle šířky (bez CSS toggle → nemůže vzniknout duplicita).
  const short = matchMedia('(max-width: 640px)').matches;
  const labels = short ? STEP_LABELS_SHORT : STEP_LABELS;
  wrap.innerHTML = STEP_LABELS.map((_, i) => {
    const reachable = i <= wiz.maxStep;
    const cls = i === wiz.step ? 'active' : (reachable ? 'done' : 'future');
    const clickable = i !== wiz.step && reachable;   // dokončené/navštívené kroky jsou klikatelné
    const mark = i < wiz.step ? '✓' : String(i + 1);   // zobrazeno 1–5
    const act = clickable ? ` data-act="goto-step" data-idx="${i}" role="button" tabindex="0"` : '';
    return `<div class="aml-step ${cls}${clickable ? ' aml-step--click' : ''}"${act}>` +
      `<span class="aml-step-dot">${mark}</span>` +
      `<span class="aml-step-label">${labels[i]}</span></div>`;
  }).join('');
}

function renderStep(root) {
  renderSteps();
  if (wiz.step === 0) renderClientStep(root);
  else if (wiz.step === 1) renderLustrace(root);
  else renderPlaceholder();
  renderFoot();
}

// ── Krok 1 (index 0) — Údaje klienta ─────────────────────────────────
function renderClientStep(root) {
  const tiles = SOURCES.map(s => {
    const sel = wiz.source === s.id ? ' aml-tile--selected' : '';
    return `<button class="aml-tile aml-tile-src${sel}" data-act="pick-source" data-source="${s.id}">
      <span class="aml-tile-ico">${s.svg}</span>
      <span class="aml-tile-title">${esc(s.title)}</span>
    </button>`;
  }).join('');

  const showForm = wiz.source === 'manual' || hasClientData()
    || !!wiz.frontImg || !!wiz.backImg || wiz.uploadFiles.length > 0;
  const methods = METHODS.map(m => {
    const checked = wiz.method === m.id ? ' checked' : '';
    const dis = m.enabled ? '' : ' disabled';
    const badge = m.enabled ? '' : ' <span class="aml-radio-badge">brzy</span>';
    return `<label class="aml-radio${m.enabled ? '' : ' aml-radio--disabled'}">
      <input type="radio" name="amlMethod" value="${m.id}"${checked}${dis}>
      <span>${esc(m.title)}${badge}</span>
    </label>`;
  }).join('');

  const isPo = wiz.subject_type === 'po';
  const seg = SUBJECT_TYPES.map(([id, label]) =>
    `<button class="aml-seg${wiz.subject_type === id ? ' aml-seg--on' : ''}" data-act="set-subject" data-subject="${id}">${esc(label)}</button>`
  ).join('');

  const hasAnything = showForm || wiz.uploadFiles.length || !!wiz.frontImg || !!wiz.backImg || isPo;
  const formShown = showForm || isPo;   // u PO jednající osobu ukazuj vždy
  $('amlMain').innerHTML = `<div class="aml-card">
    ${hasAnything ? `<button class="aml-reset-top" data-act="restart-step">Vymazat vše</button>` : ''}
    <div class="aml-h">Údaje klienta</div>
    <div class="aml-sub">Vyplňte údaje klienta a zvolte, jak byla potvrzena jeho totožnost.</div>
    <div class="aml-seg-wrap">${seg}</div>
    ${isPo ? companyBlockHTML() : ''}
    ${isPo ? `<div class="aml-sec-title">Jednající osoba</div>` : ''}
    <div class="aml-tiles aml-tiles-src">${tiles}</div>
    <div class="aml-src-area">${sourceAreaHTML()}</div>
    ${formShown ? `<div class="aml-form-wrap" id="amlClientForm">${clientFormHTML()}</div>` : ''}
    ${isPo ? actingRoleHTML() : ''}
    ${isPo ? esmBlockHTML() : ''}
    <div class="aml-method">
      <div class="aml-method-title">Jak byla potvrzena totožnost klienta?</div>
      <div class="aml-radios">${methods}</div>
    </div>
    <button class="aml-btn aml-btn-primary aml-btn-block" id="amlContinue" data-act="continue-lustrace"${formValid() ? '' : ' disabled'}>
      Údaje jsou úplné, pokračovat na lustraci →
    </button>
  </div>`;
}

// Blok Společnost (PO) — IČO + načtení z ARES + název/sídlo.
function companyBlockHTML() {
  const st = wiz.aresStatus;
  const status = wiz.aresLoading
    ? `<div class="aml-ai-loading"><span class="aml-spinner"></span> Načítám z ARES…</div>`
    : st ? `<div class="aml-ares-status ${st.ok ? (st.active ? 'is-ok' : 'is-warn') : 'is-warn'}">${esc(st.text)}</div>` : '';
  return `<div class="aml-company">
    <div class="aml-sec-title">Společnost</div>
    <div class="aml-company-ico">
      <label class="aml-field"><span>IČO <span class="aml-req">*</span></span>
        <input id="aml_f_client_ico" value="${esc(wiz.data.client_ico || '')}" placeholder="12345678"></label>
      <button class="aml-btn aml-btn-sm" data-act="ares-load">Načíst z ARES</button>
    </div>
    ${status}
    <div class="aml-fields">
      <label class="aml-field"><span>Název společnosti</span><input id="aml_f_company_name" value="${esc(wiz.data.company_name || '')}"></label>
      <label class="aml-field"><span>Sídlo</span><input id="aml_f_company_address" value="${esc(wiz.data.company_address || '')}"></label>
    </div>
  </div>`;
}

// Role jednající osoby + poznámka (PO).
function actingRoleHTML() {
  const opts = ROLE_OPTIONS.map(([v, l]) => `<option value="${esc(v)}"${v === (wiz.data.acting_person_role || '') ? ' selected' : ''}>${esc(l)}</option>`).join('');
  return `<div class="aml-fields">
    <label class="aml-field"><span>Role jednající osoby</span><select id="aml_f_acting_person_role">${opts}</select></label>
    <label class="aml-field"><span>Poznámka (nepovinné)</span><input id="aml_f_acting_person_note" value="${esc(wiz.data.acting_person_note || '')}"></label>
  </div>`;
}

// Skuteční majitelé (ESM) — gate pro pokračování.
function esmBlockHTML() {
  const checked = wiz.data.esm_checked ? ' checked' : '';
  return `<div class="aml-esm">
    <div class="aml-sec-title">Skuteční majitelé (ESM)</div>
    <label class="aml-check"><input type="checkbox" id="aml_f_esm_checked"${checked}>
      <span>Ověřil jsem skutečné majitele v evidenci skutečných majitelů</span></label>
    <a class="aml-lk-link" href="https://esm.justice.cz" target="_blank" rel="noopener">Otevřít evidenci skutečných majitelů ↗</a>
    <label class="aml-field"><span>Poznámka (nepovinné)</span>
      <textarea id="aml_f_esm_note" rows="2">${esc(wiz.data.esm_note || '')}</textarea></label>
  </div>`;
}

// Prostřední část podle zvolené dlaždice.
function sourceAreaHTML() {
  if (wiz.source === 'camera') return cameraSlotsHTML();
  if (wiz.source === 'upload') return uploadZoneHTML();
  if (wiz.source === 'manual') return `<div class="aml-src-hint">Vyplňte údaje klienta ručně ve formuláři níže.</div>`;
  if (wiz.source === 'list') return clientListHTML();
  return '';
}

// Kamera — dvoukrokový flow (přední → zadní zvlášť), × na miniatuře.
function cameraSlotsHTML() {
  return `<div class="aml-slots">${['front', 'back'].map(side => {
    const img = side === 'back' ? wiz.backImg : wiz.frontImg;
    const label = side === 'back' ? 'Zadní strana' : 'Přední strana';
    const loading = wiz.ocrLoading === side;
    if (img) {
      return `<div class="aml-slot">
        <div class="aml-slot-label">${label}</div>
        <div class="aml-thumb-wrap">
          <img class="aml-thumb" src="${img}" alt="${label}">
          <button class="aml-thumb-x" data-act="remove-side" data-side="${side}" aria-label="Odstranit">${SVG.close}</button>
        </div>
        ${loading ? `<div class="aml-ai-loading"><span class="aml-spinner"></span> AI rozpoznává…</div>` : ''}
      </div>`;
    }
    return `<div class="aml-slot">
      <div class="aml-slot-label">${label}</div>
      <button class="aml-slot-capture" data-act="capture" data-side="${side}">
        <span class="aml-dz-ico">${SVG.camera}</span><span>Vyfotit ${label.toLowerCase()}</span>
      </button>
      <input type="file" id="amlCapture_${side}" data-side="${side}" accept="image/*" capture="environment" hidden>
    </div>`;
  }).join('')}</div>`;
}

// Nahrát soubor — jedna inteligentní zóna, 1–3 soubory (přední/zadní/další), sloučená AI extrakce.
function uploadZoneHTML() {
  const previews = wiz.uploadFiles.map((u, i) => {
    const thumb = u.isPdf
      ? `<div class="aml-up-pdf"><span>PDF</span><span class="aml-up-name">${esc(u.name)}</span></div>`
      : `<img class="aml-thumb" src="${u.dataUrl}" alt="${esc(u.name)}">`;
    return `<div class="aml-up-item"><div class="aml-thumb-wrap">${thumb}
      <button class="aml-thumb-x" data-act="remove-upload" data-idx="${i}" aria-label="Odstranit">${SVG.close}</button>
    </div></div>`;
  }).join('');
  const zone = wiz.uploadFiles.length < MAX_UPLOAD
    ? `<div class="aml-dropzone" data-act="add-upload">
        <span class="aml-dz-ico">${SVG.upload}</span>
        <span>Přetáhněte foto nebo PDF sem, nebo klikněte pro výběr</span>
        <span class="aml-dz-sub">Podporujeme občanku, pas, řidičský průkaz nebo jiný doklad totožnosti. Můžete nahrát jednu stranu i obě strany najednou (JPG, PNG, PDF).</span>
      </div>
      <input type="file" id="amlUploadInput" accept="image/*,application/pdf" multiple hidden>
      <div class="aml-upload-hint">Občanka, pas nebo řidičák · JPG, PNG, PDF · max 10 MB</div>`
    : '';
  const loading = wiz.ocrLoading === 'multi'
    ? `<div class="aml-ai-loading"><span class="aml-spinner"></span> AI rozpoznává údaje ze všech stran…</div>` : '';
  return `<div class="aml-upload">${previews ? `<div class="aml-up-grid">${previews}</div>` : ''}${zone}${loading}</div>`;
}

// Formulář klienta (společný pro všechny 4 cesty).
// U PO se IČO vynechá (je v bloku Společnost). U podnikající FO je IČO povinné.
function clientFormHTML() {
  const fields = FORM_FIELDS.filter(f => !(f.col === 'client_ico' && wiz.subject_type === 'po'));
  return `<div class="aml-fields">` + fields.map(f => {
    const val = wiz.data[f.col] || '';
    const req = f.req || (f.col === 'client_ico' && wiz.subject_type === 'fo_podnikatel');
    const star = req ? ' <span class="aml-req">*</span>' : '';
    let input;
    if (f.type === 'select') {
      const opts = f.opts.map(([v, l]) => `<option value="${esc(v)}"${v === val ? ' selected' : ''}>${esc(l)}</option>`).join('');
      input = `<select id="aml_f_${f.col}">${opts}</select>`;
    } else {
      input = `<input id="aml_f_${f.col}" value="${esc(val)}"${f.ph ? ` placeholder="${esc(f.ph)}"` : ''}>`;
    }
    return `<label class="aml-field"><span>${esc(f.label)}${star}</span>${input}</label>`;
  }).join('') + `</div>`;
}

// Seznam uložených klientů (source 'list').
function clientListHTML() {
  if (wiz.clients === null) return `<div class="aml-src-hint"><span class="aml-spinner"></span> Načítám uložené klienty…</div>`;
  if (wiz.clients.length === 0) return `<div class="aml-src-hint">Zatím nemáte uložené klienty. Použijte jinou cestu.</div>`;
  return `<input class="aml-client-search" id="amlClientSearch" placeholder="Hledat jméno, IČO nebo číslo dokladu…" value="${esc(wiz.clientQuery)}">
    <div class="aml-client-list" id="amlClientList">${clientRowsHTML()}</div>`;
}

function clientRowsHTML() {
  const q = wiz.clientQuery.trim().toLowerCase();
  const list = (wiz.clients || []).filter(c => {
    if (!q) return true;
    return [c.client_name, c.client_surname, c.client_ico, c.client_doc_number]
      .filter(Boolean).some(v => String(v).toLowerCase().includes(q));
  });
  if (!list.length) return `<div class="aml-src-hint">Nic nenalezeno.</div>`;
  return list.map(c => {
    const name = [c.client_name, c.client_surname].filter(Boolean).join(' ') || 'bez jména';
    const meta = [c.client_birth_date && `nar. ${esc(c.client_birth_date)}`,
      c.client_doc_number && `doklad ${esc(c.client_doc_number)}`,
      c.client_ico && `IČO ${esc(c.client_ico)}`].filter(Boolean).join(' · ');
    return `<button class="aml-client-row" data-act="pick-client" data-key="${esc(clientKey(c))}">
      <span class="aml-client-name">${esc(name)}</span>
      <span class="aml-client-meta">${meta}</span>
    </button>`;
  }).join('');
}

// Re-render jen seznamu (při psaní do vyhledávání) — nezahodí fokus inputu.
function renderClientList() {
  const el = $('amlClientList');
  if (el) el.innerHTML = clientRowsHTML();
}

function renderPlaceholder() {
  $('amlMain').innerHTML = `<div class="aml-card aml-placeholder">
    <div class="aml-h">${wiz.step + 1} — ${esc(STEP_LABELS[wiz.step] || '')}</div>
    <div class="aml-ai-note">Tento krok bude doplněn v dalších týdnech vývoje.</div>
  </div>`;
}

// ── Krok 2 — automatická lustrace ────────────────────────────────────
// Ikona + třída + text podle stavu jedné lustrace.
function lookupView(lk) {
  if (!lk) return { icon: '⏳', cls: 'pending', text: 'probíhá…' };
  const pct = lk.match_score ? `${Math.round(lk.match_score * 100)} %` : '';
  switch (lk.status) {
    case 'clean':   return { icon: '✓', cls: 'ok',    text: 'v pořádku' };
    case 'warning': return { icon: '⚠', cls: 'warn',  text: pct ? `možná shoda ${pct}` : 'ke kontrole' };
    case 'match':   return { icon: '⚠', cls: 'match', text: pct ? `SHODA ${pct}` : 'SHODA' };
    case 'manual':  return { icon: '↗', cls: 'manual', text: 'ověřte ručně' };
    case 'error':   return { icon: '✕', cls: 'err',   text: 'nedostupné' };
    default:        return { icon: '⏳', cls: 'pending', text: 'probíhá…' };
  }
}

// Překladové slovníky pro OpenSanctions kódy → český popis.
const OS_DATASETS = {
  us_cia_world_leaders: 'CIA World Leaders', wikidata: 'Wikidata', wd_peps: 'Wikidata (PEP index)',
  fr_hatvp_declarations: 'HATVP (FR registr funkcionářů)',
  un_ga_protocol: 'OSN – protokol Valného shromáždění', everypolitician: 'EveryPolitician',
  eu_meps: 'Europarlament (poslanci)', gb_hmt_sanctions: 'HM Treasury (UK)',
};
// Interní/technické datasety OpenSanctions — pro advokáta bez hodnoty, skryjeme.
const OS_DATASET_NOISE = new Set(['wd_categories', 'ann_pep_positions', 'wd_positions', 'ext_wikidata', 'wikidata_categories']);
const OS_TOPICS = {
  'role.pep': 'politicky exponovaná osoba', 'role.pol': 'politik',
  'role.rca': 'osoba blízká funkcionáři', 'gov.national': 'státní správa',
  'role.judge': 'soudce', 'role.diplo': 'diplomat', 'gov.muni': 'komunální politika',
};
const COUNTRY_CS = {
  fr: 'Francie', cz: 'Česko', sk: 'Slovensko', de: 'Německo', us: 'USA', gb: 'Spojené království',
  ru: 'Rusko', ua: 'Ukrajina', pl: 'Polsko', at: 'Rakousko', it: 'Itálie', es: 'Španělsko',
  hu: 'Maďarsko', be: 'Belgie', nl: 'Nizozemsko', cn: 'Čína',
};
const arr = v => Array.isArray(v) ? v : (v == null ? [] : [v]);
const transList = (v, map) => arr(v).map(x => map[x] || map[String(x).toLowerCase()] || x);
const transCountry = v => arr(v).map(c => COUNTRY_CS[String(c).toLowerCase()] || String(c).toUpperCase());

// "1979-05-18(Z)" → "18. 5. 1979"
function fmtDate(s) {
  const m = String(s || '').match(/(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${+m[3]}. ${+m[2]}. ${m[1]}` : String(s || '');
}
// "(2018-)" → "(od 2018)", "(2010-2018)" → "(2010–2018)"
const normYears = s => s.replace(/\((\d{4})-\)/g, '(od $1)').replace(/\((\d{4})-(\d{4})\)/g, '($1–$2)');
// Časté anglické názvy funkcí z OpenSanctions → česky (jinak ponech originál).
const POS_PATTERNS = [
  [/deputy mayor of a place in the czech republic/i, 'místostarosta obce (ČR)'],
  [/mayor of a place in the czech republic/i, 'starosta obce (ČR)'],
  [/member of a czech municipal council/i, 'člen obecního zastupitelstva (ČR)'],
  [/member of the chamber of deputies/i, 'poslanec Poslanecké sněmovny'],
  [/member of the senate/i, 'senátor'],
  [/president of the czech republic/i, 'prezident ČR'],
  [/prime minister/i, 'předseda vlády'],
  [/minister/i, 'ministr'], [/senator/i, 'senátor'], [/governor/i, 'guvernér'],
  [/president/i, 'prezident'], [/ambassador/i, 'velvyslanec'],
];
function translatePosition(p) {
  const yr = (String(p).match(/\([^)]*\)\s*$/) || [''])[0];
  const base = yr ? String(p).slice(0, p.length - yr.length).trim() : String(p);
  for (const [re, cs] of POS_PATTERNS) if (re.test(base)) return normYears(`${cs} ${yr}`.trim());
  return normYears(String(p));
}

// Speciální, advokátovi srozumitelný detail PEP shody z OpenSanctions.
function pepDetailHTML(lk) {
  const d = lk.details || {};
  const row = (label, val) => val && val.length
    ? `<div><span class="aml-lk-dk">${label}:</span> ${esc(Array.isArray(val) ? val.join('; ') : String(val))}</div>` : '';
  const countries = transCountry(d.countries);
  const positions = arr(d.positions).map(translatePosition);
  const datasets = [...new Set(arr(d.datasets).filter(x => !OS_DATASET_NOISE.has(x)).map(x => OS_DATASETS[x] || x))];
  const topics = transList(d.topics, OS_TOPICS);
  const bd = arr(d.birth_date).map(fmtDate);
  return `<div class="aml-lk-detail" id="aml-lk-det-pep" hidden>` +
    row('Shoda s', lk.matched_against || d.caption) +
    `<div><span class="aml-lk-dk">Zdroj:</span> OpenSanctions (globální PEP databáze)</div>` +
    row('Datum narození', bd) +
    row('Země', countries) +
    row('Funkce', positions) +
    row('Typ', topics) +
    row('Zdrojové databáze', datasets) +
    `</div>`;
}

const CS_KEYS = {
  note: 'Poznámka', doc_number: 'Číslo dokladu', name: 'Jméno', birthdate: 'Datum narození',
  birth_date: 'Datum narození', source: 'Zdroj', full_name: 'Celé jméno', nationality: 'Národnost',
  reason: 'Důvod', position: 'Funkce', organization: 'Organizace', active_since: 'Ve funkci od',
  active_until: 'Ve funkci do', ico: 'IČO', address: 'Adresa', vysledek: 'Výsledek',
  client_birth_date: 'Datum narození klienta', checked: 'Prověřeno záznamů',
};

// Stav insolvenčního řízení (druhStavKonkursu) → česky.
const ISIR_STAV = {
  ODSKRTNUTA: 'skončeno (vyškrtnuto z evidence)', PROHLASENY: 'konkurs prohlášen',
  POVOLENE_ODDLUZENI: 'povolené oddlužení', POVOLENA_REORGANIZACE: 'povolená reorganizace',
  ZRUSENY: 'zrušeno', UKONCENA: 'ukončeno', MORATORIUM: 'moratorium', UPADEK: 'úpadek',
};
const isirStav = s => s ? (ISIR_STAV[s] || String(s).toLowerCase().replace(/_/g, ' ')) : '';

// ISIR — seznam nalezených insolvenčních řízení, hodnotný pro advokáta:
// probíhající řízení nahoře + zvýrazněná, český stav, formátovaná data.
function isirDetailHTML(lk) {
  const d = lk.details || {};
  const list = (d.rizeni || []).slice()
    .sort((a, b) => (a.ukonceni ? 1 : 0) - (b.ukonceni ? 1 : 0)
      || String(b.zahajeni || '').localeCompare(String(a.zahajeni || '')));
  const rows = list.slice(0, 10).map(r => {
    const aktivni = !r.ukonceni;
    const badge = aktivni
      ? `<span class="aml-lk-badge aml-lk-badge-live">PROBÍHÁ</span>`
      : `<span class="aml-lk-badge">skončeno ${esc(fmtDate(r.ukonceni))}</span>`;
    const meta = [
      r.soud,
      r.nar && `nar. ${fmtDate(r.nar)}`,
      r.zahajeni && `zahájeno ${fmtDate(r.zahajeni)}`,
      isirStav(r.stav) && `stav: ${isirStav(r.stav)}`,
    ].filter(Boolean).join(' · ');
    const spis = r.url
      ? `<a class="aml-lk-link" href="${esc(r.url)}" target="_blank" rel="noopener">${esc(r.spis || 'řízení')} ↗</a>`
      : esc(r.spis || 'řízení');
    return `<div class="aml-lk-rizeni"><div class="aml-lk-spis">${spis} ${badge}</div><div class="aml-lk-rmeta">${esc(meta)}</div></div>`;
  }).join('');
  const more = list.length > 10 ? `<div class="aml-lk-rmeta">… a dalších ${list.length - 10} řízení</div>` : '';
  return `<div class="aml-lk-detail" id="aml-lk-det-${lk.lookup_type}" hidden>` +
    (d.note ? `<div class="aml-lk-rnote">${esc(d.note)}</div>` : '') + rows + more + `</div>`;
}

function lookupDetailHTML(lk) {
  // PEP z OpenSanctions má vlastní srozumitelný render.
  if (lk.lookup_type === 'pep' && lk.source === 'opensanctions') return pepDetailHTML(lk);
  // ISIR (osoba i firma) nalezená řízení mají vlastní render.
  if ((lk.lookup_type === 'isir' || lk.lookup_type === 'isir_po') && lk.details && lk.details.rizeni) return isirDetailHTML(lk);

  const d = lk.details;
  // Nedostupný rejstřík — jasná výzva k ruční kontrole + přímý odkaz.
  if (lk.status === 'error') {
    const links = {
      mvcr: 'https://aplikace.mv.gov.cz/neplatne-doklady/',
      isir: 'https://isir.justice.cz', isir_po: 'https://isir.justice.cz',
      ares: 'https://ares.gov.cz',
    };
    const url = links[lk.lookup_type];
    const msg = typeof d === 'string' ? d : (d && d.note) || '';
    return `<div class="aml-lk-detail" id="aml-lk-det-${lk.lookup_type}" hidden>` +
      (msg ? `<div>${esc(msg)}</div>` : '') +
      `<div>Rejstřík nedostupný — ověřte ručně${url ? `: <a class="aml-lk-link" href="${esc(url)}" target="_blank" rel="noopener">otevřít rejstřík ↗</a>` : '.'}</div>` +
      `</div>`;
  }
  // ISIR / obecný ruční fallback — odkaz na ověření.
  if (lk.status === 'manual') {
    const url = d && d.url;
    return `<div class="aml-lk-detail" id="aml-lk-det-${lk.lookup_type}" hidden>` +
      `<div>${esc(d?.note || 'Ověřte ručně.')}</div>` +
      (url ? `<div><a class="aml-lk-link" href="${esc(url)}" target="_blank" rel="noopener">Otevřít insolvenční rejstřík ↗</a></div>` : '') +
      `</div>`;
  }

  let inner = '';
  if (typeof d === 'string') inner = esc(d);
  else if (d && typeof d === 'object') {
    inner = Object.entries(d)
      .filter(([, v]) => v != null && v !== '')
      .map(([k, v]) => `<div><span class="aml-lk-dk">${esc(CS_KEYS[k] || k)}:</span> ${esc(String(typeof v === 'object' ? JSON.stringify(v) : v))}</div>`)
      .join('');
  }
  const matched = lk.matched_against ? `<div><span class="aml-lk-dk">Shoda s:</span> ${esc(lk.matched_against)}</div>` : '';
  return `<div class="aml-lk-detail" id="aml-lk-det-${lk.lookup_type}" hidden>${matched}${inner}</div>`;
}

// "2026-07-14T09:32:00Z" → "ověřeno 14. 7. 2026 v 9:32" (cs-CZ, Europe/Prague)
function fmtCheckedAt(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d)) return '';
  try {
    const s = d.toLocaleString('cs-CZ', { timeZone: 'Europe/Prague', day: 'numeric', month: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    return `ověřeno ${s.replace(', ', ' v ')}`;
  } catch { return ''; }
}

function lookupRowHTML(type) {
  const lk = wiz.lookups?.find(x => x.lookup_type === type) || null;
  const v = lookupView(lk);
  const expandable = lk && ['warning', 'match', 'error', 'manual'].includes(lk.status);
  const act = expandable ? ` data-act="toggle-detail" data-type="${type}" role="button" tabindex="0"` : '';
  const when = lk && lk.checked_at ? `<span class="aml-lk-when">${esc(fmtCheckedAt(lk.checked_at))}</span>` : '';
  const row = `<div class="aml-lk-row aml-lk-${v.cls}"${act}>
      <span class="aml-lk-ico">${v.icon}</span>
      <span class="aml-lk-label">${esc(LOOKUP_LABELS[type] || type)}${when}</span>
      <span class="aml-lk-status">${esc(v.text)}${expandable ? ' <span class="aml-lk-caret">▾</span>' : ''}</span>
    </div>`;
  return row + (expandable ? lookupDetailHTML(lk) : '');
}

function renderLustrace(root) {
  let inner;
  if (wiz.subject_type === 'po') {
    // Dvě skupiny: Společnost / Jednající osoba.
    inner =
      `<div class="aml-lk-group-title">Společnost</div>` +
      `<div class="aml-lookups">${PO_GROUP_COMPANY.map(lookupRowHTML).join('')}</div>` +
      `<div class="aml-lk-group-title">Jednající osoba</div>` +
      `<div class="aml-lookups">${PO_GROUP_PERSON.map(lookupRowHTML).join('')}</div>`;
  } else {
    inner = `<div class="aml-lookups">${FO_LOOKUP_TYPES.map(lookupRowHTML).join('')}</div>`;
  }
  const rerun = wiz.lookupStatus === 'done'
    ? `<button class="aml-btn aml-btn-sm" data-act="rerun-lookups">Spustit lustraci znovu</button>`
    : '';
  $('amlMain').innerHTML = `<div class="aml-card">
    <div class="aml-h">Automatická lustrace</div>
    <div class="aml-sub">Prověřujeme klienta ve veřejných rejstřících a sankčních seznamech.</div>
    ${inner}
    <div class="aml-lk-note">Sankční kontrola: EU (OFAC/OSN připravujeme).</div>
    ${rerun}
  </div>`;
  if (wiz.lookupStatus === 'idle') initLustrace(root);
}

// Vstup na krok Lustrace: čerstvý běh (po zadání dat) NEBO načtení uložených výsledků.
async function initLustrace(root) {
  if (wiz.forceRun) { wiz.forceRun = false; return runLookups(root); }
  wiz.lookupStatus = 'loading';
  const ok = await loadStoredLookups(root);
  if (!ok) return runLookups(root);
}

// Načte uložené výsledky lustrací (GET /lookups) bez nového běhu. Vrací true, když jsou.
async function loadStoredLookups(root) {
  const types = lookupTypeList();
  try {
    const r = await apiAmlGetLookups(wiz.caseId);
    const res = r.results || [];
    if (!types.some(t => res.find(x => x.lookup_type === t))) { wiz.lookupStatus = 'idle'; return false; }
    wiz.lookups = types.map(t => res.find(x => x.lookup_type === t)
      || { lookup_type: t, status: 'error', details: 'Bez odpovědi.' });
    wiz.lookupStatus = 'done';
    if (wiz.step === 1) { renderLustrace(root); renderFoot(); }
    return true;
  } catch { wiz.lookupStatus = 'idle'; return false; }
}

async function runLookups(root) {
  const types = lookupTypeList();
  wiz.lookupStatus = 'running';
  wiz.lookups = [];
  renderLustrace(root);       // řádky ve stavu „probíhá"
  renderFoot();               // Další zůstává disabled
  let res;
  try {
    const r = await apiAmlRunLookup(wiz.caseId);
    res = r.results || [];
  } catch {
    res = types.map(t => ({ lookup_type: t, status: 'error', details: 'Lustrace se nezdařila.' }));
  }
  if (wiz.step !== 1) { wiz.lookupStatus = 'done'; return; }   // uživatel mezitím odešel
  // staggered reveal — řádky naskakují postupně
  for (const t of types) {
    const found = res.find(x => x.lookup_type === t)
      || { lookup_type: t, status: 'error', details: 'Bez odpovědi.' };
    wiz.lookups.push(found);
    await new Promise(r => setTimeout(r, 220));
    if (wiz.step === 1) renderLustrace(root);
  }
  wiz.lookupStatus = 'done';
  if (wiz.step === 1) { renderLustrace(root); renderFoot(); }
}

function toggleLookupDetail(type) {
  const el = document.getElementById(`aml-lk-det-${type}`);
  if (el) el.hidden = !el.hidden;
}

function renderFoot() {
  const foot = $('amlFoot');
  if (!foot) return;
  let html = '';
  if (wiz.step === 0) {
    html = '';   // krok Údaje klienta má vlastní tlačítko „pokračovat na lustraci" v kartě
  } else if (wiz.step >= 1 && wiz.step <= 3) {
    // Lustrace (krok 1): Další je aktivní až po dokončení všech 5 lustrací.
    const dis = (wiz.step === 1 && wiz.lookupStatus !== 'done') ? ' disabled' : '';
    html = `<button class="aml-btn" data-act="back">Zpět</button>
            <button class="aml-btn aml-btn-primary" data-act="next"${dis}>Další</button>`;
  } else { // Hotovo (krok 4)
    html = `<button class="aml-btn" data-act="back">Zpět</button>`;
  }
  foot.innerHTML = html;
}
