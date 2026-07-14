// legalid.cz — js/aml/aml.js
// AML kontrola — wizard (týden 2: kostra 0–5 + krok 0 + krok 1 sken dokladu).
// Architektura: žádné inline onclick → jeden delegovaný listener na #amlRoot (data-act).
// Tím odpadá fragilní window-bridge (chybějící bridge byl zdroj minulých ReferenceError).

import { apiAmlCreateCase, apiAmlGetCase, apiAmlPatchCase, apiAmlAddDocument, apiAmlListCases, apiOcr } from '../core/api.js';
import { state } from '../core/state.js';
import { showToast, esc } from '../core/ui.js';
import { openRegistrationModal } from '../auth/auth.js';

const STEP_LABELS = ['Způsob', 'Doklad', 'Lustrace', 'Účel', 'Riziko', 'Hotovo'];

// Mapování: DB sloupec ← klíč z AML OCR ← popisek pole ve formuláři.
const FIELD_MAP = [
  ['client_name', 'jmeno', 'Jméno'],
  ['client_surname', 'prijmeni', 'Příjmení'],
  ['client_birth_date', 'datum_narozeni', 'Datum narození'],
  ['client_birth_place', 'misto_narozeni', 'Místo narození'],
  ['client_address', 'adresa_trvaleho_pobytu', 'Adresa trvalého pobytu'],
  ['client_doc_type', 'typ_dokladu', 'Typ dokladu'],
  ['client_doc_number', 'cislo_dokladu', 'Číslo dokladu'],
  ['client_doc_issued_at', 'datum_vydani', 'Doklad vydán'],
  ['client_doc_valid_until', 'datum_platnosti', 'Doklad platný do'],
  ['client_gender', 'pohlavi', 'Pohlaví'],
  ['client_nationality', 'statni_obcanstvi', 'Státní občanství'],
];

const METHODS = [
  { id: 'personal', enabled: true, title: 'Osobně', desc: 'Advokát klienta vidí na schůzce a sám naskenuje doklad.' },
  { id: 'remote', enabled: false, title: 'Vzdáleně přes odkaz', desc: 'Klient dostane e-mail, sám nahraje doklad a selfie.' },
  { id: 'bankid', enabled: false, title: 'Bank iD', desc: 'Klient se ověří přihlášením do internetbankingu.' },
  { id: 'micropayment', enabled: false, title: 'Mikroplatba', desc: 'Ověření přes platbu 1 Kč z účtu klienta.' },
];

// Pracovní stav wizardu (v paměti, persistuje se přes PATCH na server).
const wiz = {
  caseId: null,
  step: 0,
  sub: 'a',            // krok 1: 'a' přední | 'b' zadní | 'c' revize
  method: null,
  data: {},            // client_* hodnoty
  frontImg: null, backImg: null,
  frontExtracted: null, backExtracted: null,
  ocrLoading: false,
  camStream: null,
};

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
export function initAml() {
  const root = $('amlRoot');
  if (!root) return;
  bindRoot(root);
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
    if (e.target.matches('input[type="file"]')) {
      const f = e.target.files && e.target.files[0];
      if (f) handleFile(root, f);
      e.target.value = '';
    }
  });
}

function handleAction(root, act, ds) {
  switch (act) {
    case 'resume': resumeCase(root, +ds.id); break;
    case 'new': createNewCase(root); break;
    case 'login': openRegistrationModal(); break;
    case 'pick-method': pickMethod(root, ds.method); break;
    case 'next': goNext(root); break;
    case 'back': goBack(root); break;
    case 'gallery': $('amlGallery')?.click(); break;
    case 'capture': onCapture(root); break;
    case 'cam-shoot': shootCamera(root); break;
    case 'cam-cancel': closeCamera(); break;
    case 'retake': retake(root); break;
    case 'confirm-front': confirmFront(root); break;
    case 'confirm-back': confirmBack(root); break;
    case 'confirm-review': confirmReview(root); break;
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
    wiz.step = 0; wiz.sub = 'a'; wiz.method = 'personal'; wiz.data = {};
    wiz.frontImg = wiz.backImg = wiz.frontExtracted = wiz.backExtracted = null;
    renderStep(root);
  } catch {
    renderError('Nepodařilo se založit AML případ. Zkuste to prosím znovu.');
  }
}

async function resumeCase(root, id) {
  renderLoading('Načítám případ…');
  try {
    const r = await apiAmlGetCase(id);
    const c = r.case;
    if (!c) throw new Error('not_found');
    wiz.caseId = c.id; state.amlCurrentCaseId = c.id;
    wiz.method = c.identification_method || 'personal';
    wiz.data = {};
    FIELD_MAP.forEach(([col]) => { if (c[col]) wiz.data[col] = c[col]; });
    wiz.step = c.current_step || 0;
    if (wiz.step === 1) wiz.sub = (c.client_name || c.client_surname) ? 'c' : 'a';
    renderStep(root);
  } catch {
    renderError('Případ se nepodařilo načíst.');
  }
}

// ── Krok 0 ───────────────────────────────────────────────────────────
function pickMethod(root, id) {
  const m = METHODS.find(x => x.id === id);
  if (!m || !m.enabled) return;
  wiz.method = id;
  renderStep(root);
}

// ── Navigace ─────────────────────────────────────────────────────────
async function patchCase(fields) {
  if (!wiz.caseId) return;
  try { await apiAmlPatchCase(wiz.caseId, fields); }
  catch { showToast('Nepodařilo se uložit stav.'); }
}

async function goNext(root) {
  if (wiz.step === 0) {
    if (!wiz.method) return;
    await patchCase({ identification_method: wiz.method, current_step: 1 });
    wiz.step = 1; wiz.sub = 'a';
  } else if (wiz.step >= 2 && wiz.step <= 4) {
    wiz.step += 1;
    await patchCase({ current_step: wiz.step });
  }
  renderStep(root);
}

async function goBack(root) {
  if (wiz.step === 1) {
    if (wiz.sub === 'c') { wiz.sub = 'b'; renderStep(root); return; }
    if (wiz.sub === 'b') { wiz.sub = 'a'; renderStep(root); return; }
    wiz.step = 0; await patchCase({ current_step: 0 });   // sub 'a' → krok 0
  } else if (wiz.step > 0) {
    wiz.step -= 1; await patchCase({ current_step: wiz.step });
  }
  renderStep(root);
}

// ── Krok 1 — foto + OCR ──────────────────────────────────────────────
function onCapture(root) {
  const isMobile = matchMedia('(max-width: 800px)').matches || 'ontouchstart' in window;
  if (isMobile) { $('amlCapture')?.click(); return; }
  openCamera(root);
}

function retake(root) {
  if (wiz.sub === 'b') { wiz.backImg = null; wiz.backExtracted = null; }
  else { wiz.frontImg = null; wiz.frontExtracted = null; }
  renderStep(root);
}

function handleFile(root, file) {
  const r = new FileReader();
  r.onload = () => handleImageDataUrl(root, r.result);
  r.onerror = () => showToast('Soubor se nepodařilo načíst.');
  r.readAsDataURL(file);
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

async function handleImageDataUrl(root, dataUrl) {
  const small = await downscale(dataUrl);
  const isBack = wiz.sub === 'b';
  if (isBack) wiz.backImg = small; else wiz.frontImg = small;
  wiz.ocrLoading = true; renderStep(root);
  try {
    const base64 = small.split(',')[1];
    const data = await apiOcr([{ data: base64, media_type: 'image/jpeg' }], 'aml', isBack ? 'back' : 'front');
    if (data.error) throw new Error(data.message || 'ocr_failed');
    mergeExtracted(data, isBack);
    if (isBack) wiz.backExtracted = data; else wiz.frontExtracted = data;
  } catch {
    showToast('AI rozpoznání selhalo — vyplňte údaje ručně.');
    const failed = { __failed: true };
    if (isBack) wiz.backExtracted = failed; else wiz.frontExtracted = failed;
  } finally {
    wiz.ocrLoading = false; renderStep(root);
  }
}

function mergeExtracted(data, isBack) {
  FIELD_MAP.forEach(([col, from]) => {
    const v = data[from];
    if (v == null || v === '') return;
    if (isBack) { if (!wiz.data[col]) wiz.data[col] = v; }   // zadní strana jen doplní chybějící
    else wiz.data[col] = v;
  });
}

function readFieldsFromForm() {
  FIELD_MAP.forEach(([col]) => {
    const i = $('aml_f_' + col);
    if (i) wiz.data[col] = i.value.trim();
  });
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

async function confirmFront(root) {
  readFieldsFromForm();
  await saveDoc('doklad_front', wiz.frontImg, wiz.frontExtracted);
  wiz.sub = 'b'; renderStep(root);
}

async function confirmBack(root) {
  readFieldsFromForm();
  await saveDoc('doklad_back', wiz.backImg, wiz.backExtracted);
  wiz.sub = 'c'; renderStep(root);
}

async function confirmReview(root) {
  readFieldsFromForm();
  const patch = { current_step: 2 };
  FIELD_MAP.forEach(([col]) => { patch[col] = wiz.data[col] || null; });
  await patchCase(patch);
  wiz.step = 2; renderStep(root);
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
    <div class="aml-ai-note">Máte rozpracovaný případ #${c.id} (${esc(name)}, krok ${c.current_step}). Chcete pokračovat, nebo začít novou?</div>
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
  wrap.innerHTML = STEP_LABELS.map((label, i) => {
    const cls = i < wiz.step ? 'done' : (i === wiz.step ? 'active' : 'future');
    const mark = i < wiz.step ? '✓' : String(i);
    return `<div class="aml-step ${cls}"><span class="aml-step-dot">${mark}</span><span class="aml-step-label">${label}</span></div>`;
  }).join('');
}

function renderStep(root) {
  renderSteps();
  if (wiz.step === 0) renderStep0();
  else if (wiz.step === 1) renderStep1();
  else renderPlaceholder();
  renderFoot();
}

function renderStep0() {
  if (!wiz.method) wiz.method = 'personal';
  const tiles = METHODS.map(m => {
    const sel = wiz.method === m.id ? ' aml-tile--selected' : '';
    const dis = m.enabled ? '' : ' aml-tile--disabled';
    const act = m.enabled ? ` data-act="pick-method" data-method="${m.id}"` : '';
    const badge = m.enabled ? '' : '<span class="aml-tile-badge">brzy</span>';
    return `<button class="aml-tile${sel}${dis}"${act}${m.enabled ? '' : ' disabled'}>
      <span class="aml-tile-title">${esc(m.title)}${badge}</span>
      <span class="aml-tile-desc">${esc(m.desc)}</span>
    </button>`;
  }).join('');
  $('amlMain').innerHTML = `<div class="aml-card">
    <div class="aml-h">Způsob identifikace klienta</div>
    <div class="aml-sub">Jak ověříte totožnost klienta?</div>
    <div class="aml-tiles">${tiles}</div>
  </div>`;
}

function fieldsFormHTML() {
  return `<div class="aml-fields">` + FIELD_MAP.map(([col, , label]) =>
    `<label class="aml-field"><span>${esc(label)}</span>
      <input id="aml_f_${col}" value="${esc(wiz.data[col] || '')}"></label>`
  ).join('') + `</div>`;
}

function renderStep1() {
  if (wiz.sub === 'c') return renderReview();
  const isBack = wiz.sub === 'b';
  const img = isBack ? wiz.backImg : wiz.frontImg;
  const extracted = isBack ? wiz.backExtracted : wiz.frontExtracted;
  const sideWord = isBack ? 'zadní' : 'přední';
  const stepNo = isBack ? '2' : '1';

  let main = `<div class="aml-card">
    <div class="aml-h">Krok ${stepNo} z 2 — ${sideWord} strana dokladu</div>
    <div class="aml-sub">Vyfoťte nebo nahrajte ${sideWord} stranu občanského průkazu.</div>`;

  if (!img) {
    main += `<div class="aml-upload-btns">
      <button class="aml-btn aml-btn-primary" data-act="capture">📷 Vyfotit</button>
      <button class="aml-btn" data-act="gallery">🖼️ Z galerie</button>
    </div>
    <input type="file" id="amlGallery" accept="image/*" hidden>
    <input type="file" id="amlCapture" accept="image/*" capture="environment" hidden>`;
  } else {
    main += `<div class="aml-shot">
      <img class="aml-thumb" src="${img}" alt="náhled ${sideWord} strany">
      <button class="aml-btn aml-btn-sm" data-act="retake">Vyfotit znovu</button>
    </div>`;
    if (wiz.ocrLoading) {
      main += `<div class="aml-ai-loading"><span class="aml-spinner"></span> AI rozpoznává údaje…</div>`;
    } else {
      const failed = extracted && extracted.__failed;
      main += `<div class="aml-ai-note">${failed ? 'AI údaje nerozpoznala — vyplňte je prosím ručně.' : 'Zkontrolujte a případně opravte rozpoznané údaje:'}</div>`;
      main += fieldsFormHTML();
      main += `<button class="aml-btn aml-btn-primary aml-btn-block" data-act="${isBack ? 'confirm-back' : 'confirm-front'}">
        ${isBack ? 'Údaje jsou OK, pokračovat na revizi' : 'Údaje jsou OK, pokračovat na zadní stranu'}</button>`;
    }
  }
  main += `</div>`;
  $('amlMain').innerHTML = main;
}

function renderReview() {
  $('amlMain').innerHTML = `<div class="aml-card">
    <div class="aml-h">Revize údajů</div>
    <div class="aml-sub">Zkontrolujte všechny údaje klienta před lustrací.</div>
    ${fieldsFormHTML()}
    <button class="aml-btn aml-btn-primary aml-btn-block" data-act="confirm-review">Údaje jsou OK, pokračovat na lustraci</button>
  </div>`;
}

function renderPlaceholder() {
  $('amlMain').innerHTML = `<div class="aml-card aml-placeholder">
    <div class="aml-h">${wiz.step} — ${esc(STEP_LABELS[wiz.step] || '')}</div>
    <div class="aml-ai-note">Tento krok bude doplněn v dalších týdnech vývoje.</div>
  </div>`;
}

function renderFoot() {
  const foot = $('amlFoot');
  if (!foot) return;
  let html = '';
  if (wiz.step === 0) {
    html = `<button class="aml-btn" data-act="back" disabled>Zpět</button>
            <button class="aml-btn aml-btn-primary" data-act="next"${wiz.method ? '' : ' disabled'}>Další</button>`;
  } else if (wiz.step === 1) {
    html = `<button class="aml-btn" data-act="back">Zpět</button>`;   // dopředu vedou potvrzovací tlačítka v kroku
  } else if (wiz.step >= 2 && wiz.step <= 4) {
    html = `<button class="aml-btn" data-act="back">Zpět</button>
            <button class="aml-btn aml-btn-primary" data-act="next">Další</button>`;
  } else { // krok 5
    html = `<button class="aml-btn" data-act="back">Zpět</button>`;
  }
  foot.innerHTML = html;
}
