// legalid.cz — js/dolozka/dolozka.js
// Vygenerováno refaktoringem z původního monolitického index.html.

import { buildDolozkaPreviewContent, printStitky, scalePrintPreview } from './generate.js';
import { runOcr } from './ocr.js';
import { FORMAT_DEFAULTS, MM, SCALE, getDolozkaSettings, getSettings, state } from '../core/state.js';
import { _closeAllSidePanels, _closePanelToMenu, _openPanelFromMenu, showToast } from '../core/ui.js';

export function updateAdvokat() {
  state.advokat.jmeno       = document.getElementById('aJmeno').value.trim();
  state.advokat.role        = document.getElementById('aRole').value.trim();
  state.advokat.ev_cislo    = document.getElementById('aEvCislo').value.trim();
  state.advokat.cislo_knihy = document.getElementById('aCisloKnihy').value.trim();
  state.advokat.sidlo       = document.getElementById('aSidlo').value.trim();
  localStorage.setItem('legalid_advokat', JSON.stringify({
    jmeno: state.advokat.jmeno, role: state.advokat.role, ev_cislo: state.advokat.ev_cislo,
    cislo_knihy: state.advokat.cislo_knihy, sidlo: state.advokat.sidlo,
  }));
  updatePreview();
}


export function clearAdvokatStorage() {
  localStorage.removeItem('legalid_advokat');
  ['aJmeno','aRole','aEvCislo','aCisloKnihy','aSidlo'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
    const cfg = document.getElementById('cfg_' + id);
    if (cfg) cfg.value = '';
  });
  state.advokat = { jmeno: '', role: '', ev_cislo: '', cislo_knihy: '', sidlo: '' };
  updatePreview();
  showToast('Uložené údaje advokáta smazány');
}


export function toggleAdvokat() {
  const body = document.getElementById('advokatBody');
  const arrow = document.getElementById('advokatArrow');
  const isOpen = body.classList.contains('open');
  body.classList.toggle('open', !isOpen);
  if (arrow) arrow.classList.toggle('open', !isOpen);
}

// ── Upload ────────────────────────────────────────────────────────

export function triggerUpload() {
  document.getElementById('fileInput').click();
}


export function handleFiles(files) {
  const allowed = ['image/jpeg', 'image/png', 'image/heic', 'image/heif', 'image/webp'];
  const newFiles = Array.from(files).filter(f => allowed.includes(f.type) || f.name.toLowerCase().endsWith('.heic'));
  const remaining = 2 - state.uploadedImages.length;
  if (remaining <= 0) { showToast('Maximálně 2 fotografie.'); return; }
  let loaded = 0;
  newFiles.slice(0, remaining).forEach(file => {
    const reader = new FileReader();
    reader.onload = e => {
      state.uploadedImages.push({ file, dataUrl: e.target.result, mediaType: file.type || 'image/jpeg' });
      loaded++;
      renderChips();
      if (loaded === Math.min(newFiles.length, remaining)) {
        state.ocrDone = false;
        runOcr();
      }
    };
    reader.readAsDataURL(file);
  });
  document.getElementById('fileInput').value = '';
}


export function renderChips() {
  document.getElementById('photoChips').innerHTML = state.uploadedImages.map((img, i) => `
    <div class="photo-chip">
      <img src="${img.dataUrl}" alt="foto ${i+1}">
      <button class="photo-chip-x" onclick="removePhoto(${i})" title="Odstranit">×</button>
    </div>`).join('');
  updateProgress();
}


export function removePhoto(index) {
  state.uploadedImages.splice(index, 1);
  state.ocrDone = false;
  renderChips();
}

// ── OCR ───────────────────────────────────────────────────────────

export function ph(val, fb) {
  return (val && val.trim()) ? val : `<span class="dolozka-placeholder">${fb}</span>`;
}

export function togglePreview() {
  document.getElementById('previewBody').classList.toggle('open');
  document.getElementById('previewArrow').classList.toggle('open');
}

export function openPreview() {
  document.getElementById('previewBody').classList.add('open');
  document.getElementById('previewArrow').classList.add('open');
}

export function updatePreview() {
  const a = state.advokat;
  const v = id => document.getElementById(id).value.trim();
  const jmeno = v('fJmeno'), datumNar = v('fDatumNar'), mistoNar = v('fMistoNar');
  const adresa = v('fAdresa'), cisloOp = v('fCisloOp');
  const cisloRadku = v('fCisloRadku'), rok = v('fRok');
  const datumOver = v('fDatumOver'), pocet = v('fPocetVyh'), listina = v('fListina');
  const aJ = a.jmeno||null, aR = a.role||null, aK = a.cislo_knihy||null;
  const aE = a.ev_cislo||null, aS = a.sidlo||null;
  const kniha = (cisloRadku && rok)
    ? `${ph(aK,'[č.knihy]')}/${cisloRadku}/${rok}`
    : `${ph(aK,'[č.knihy]')}/${ph(cisloRadku,'[č.řádku]')}/${ph(rok,'[rok]')}`;
  document.getElementById('dolozkaPreview').innerHTML = `
    <div class="dolozka-title">Prohlášení o pravosti podpisu</div>
    <div class="dolozka-p">Běžné číslo knihy o prohlášeních o pravosti podpisu ${kniha}</div>
    <div class="dolozka-p">${ph(aJ,'[advokát]')}, ${ph(aR,'[role]')}, ev. č. ${ph(aE,'[č.ev.]')}, se sídlem ${ph(aS,'[sídlo]')};</div>
    <div class="dolozka-p">Prohlašuji, že ${ph(jmeno,'[JMÉNO]')}, nar. ${ph(datumNar,'[DATUM NAR.]')}, místo narození ${ph(mistoNar,'[MÍSTO]')}, bytem ${ph(adresa,'[ADRESA]')}, jehož/jejíž totožnost byla prokázána z občanského průkazu č. ${ph(cisloOp,'[ČÍSLO OP]')},</div>
    <div class="dolozka-p">tuto listinu v ${ph(pocet,'[POČET]')} vyhotovení(ch) přede mnou vlastnoručně podepsal/a.</div>
    <div class="dolozka-sig">V Praze dne ${ph(datumOver,'[DATUM]')}<br><br>${ph(aJ,'[advokát]')}, ${ph(aR,'[role]')}</div>
    <table class="dolozka-table">
      <tr>
        <td>V Praze, ${ph(aS,'[sídlo]')} dne ${ph(datumOver,'[datum]')}</td>
        <td>${ph(jmeno,'[JMÉNO]')} nar. ${ph(datumNar,'[DATUM]')}, místo narození ${ph(mistoNar,'[MÍSTO]')}, bytem ${ph(adresa,'[ADRESA]')}</td>
      </tr>
      <tr>
        <td>OP: ${ph(cisloOp,'[ČÍSLO OP]')}</td>
        <td>${ph(pocet,'[počet]')}x ${ph(listina,'[LISTINA]')}</td>
      </tr>
    </table>`;
  updateStitek();
  updateProgress();
}

// ── Dates ─────────────────────────────────────────────────────────

export function prefillDates() {
  const t = new Date();
  const dd = String(t.getDate()).padStart(2,'0');
  const mm = String(t.getMonth()+1).padStart(2,'0');
  const yyyy = t.getFullYear();
  document.getElementById('fDatumOver').value = `${dd}.${mm}.${yyyy}`;
  document.getElementById('fRok').value = yyyy;
}

// ── OCR SUCCESS ───────────────────────────────────────────────────

export function showOcrSuccess() {
  const el = document.getElementById('ocrSuccess');
  if (!el) return;
  el.classList.add('visible');
  clearTimeout(el._timer);
  el._timer = setTimeout(() => el.classList.remove('visible'), 5000);
}

export function hideOcrSuccess() {
  const el = document.getElementById('ocrSuccess');
  if (el) { clearTimeout(el._timer); el.classList.remove('visible'); }
}

// ── PROGRESS ──────────────────────────────────────────────────────

export function countErrors() {
  const a = state.advokat;
  let n = (!a.jmeno || !a.role || !a.ev_cislo || !a.cislo_knihy || !a.sidlo) ? 1 : 0;
  const fields = [
    ['fJmeno', null],
    ['fDatumNar', v => /^\d{2}\.\d{2}\.\d{4}$/.test(v)],
    ['fMistoNar', null], ['fAdresa', null],
    ['fCisloOp', v => /^\d{9}$/.test(v)],
    ['fCisloRadku', v => parseInt(v) > 0],
    ['fRok', v => /^\d{4}$/.test(v)],
    ['fDatumOver', v => /^\d{2}\.\d{2}\.\d{4}$/.test(v)],
    ['fPocetVyh', v => parseInt(v) > 0],
    ['fListina', null],
  ];
  fields.forEach(([id, validator]) => {
    const el = document.getElementById(id);
    if (!el) return;
    const val = el.value.trim();
    if (!val || (validator && !validator(val))) n++;
  });
  return n;
}


export function updateProgress() {
  const hasPhotos = state.uploadedImages.length > 0;
  const formOk = countErrors() === 0;
  let s1, s2, s3;
  if (!hasPhotos)      { s1 = 'active'; s2 = 'future'; s3 = 'future'; }
  else if (!formOk)    { s1 = 'done';   s2 = 'active'; s3 = 'future'; }
  else                 { s1 = 'done';   s2 = 'done';   s3 = 'active'; }
  [['fp1',s1],['fp2',s2],['fp3',s3]].forEach(([id, state]) => {
    const el = document.getElementById(id);
    if (el) el.className = 'fp-step ' + state;
  });
}

// ── Validation ────────────────────────────────────────────────────

export function validateForm() {
  document.querySelectorAll('.form-input.warn, .form-input.invalid').forEach(el => el.classList.remove('warn', 'invalid'));
  let hasIssues = false;
  const a = state.advokat;
  [['aJmeno', a.jmeno], ['aRole', a.role], ['aEvCislo', a.ev_cislo], ['aCisloKnihy', a.cislo_knihy], ['aSidlo', a.sidlo]]
    .forEach(([id, val]) => { if (!val) { const el = document.getElementById(id); if (el) { el.classList.add('warn'); hasIssues = true; } } });
  const checks = [
    ['fJmeno', null],
    ['fDatumNar', v => /^\d{2}\.\d{2}\.\d{4}$/.test(v)],
    ['fMistoNar', null],
    ['fAdresa', null],
    ['fCisloOp', v => /^\d{9}$/.test(v)],
    ['fCisloRadku', v => parseInt(v) > 0],
    ['fRok', v => /^\d{4}$/.test(v)],
    ['fDatumOver', v => /^\d{2}\.\d{2}\.\d{4}$/.test(v)],
    ['fPocetVyh', v => parseInt(v) > 0],
    ['fListina', null],
  ];
  checks.forEach(([id, validator]) => {
    const el = document.getElementById(id);
    if (!el) return;
    const val = el.value.trim();
    if (!val || (validator && !validator(val))) { el.classList.add('warn'); hasIssues = true; }
  });
  return hasIssues;
}


export function softValidate() {
  const hasIssues = validateForm();
  const errBox = document.getElementById('validationErrors');
  if (hasIssues) {
    errBox.classList.add('visible');
    errBox.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  } else {
    errBox.classList.remove('visible');
  }
  return hasIssues;
}


export function slugify(s) {
  return (s||'').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/[^a-z0-9]+/g,'_').replace(/^_|_$/g,'');
}

export function dateToYMD(s) {
  const p = s.split('.'); return p.length===3 ? `${p[2]}${p[1]}${p[0]}` : s;
}

export function getPrijmeni(s) { const p=(s||'').trim().split(/\s+/); return p[p.length-1]||'klient'; }

// ── DOCX ──────────────────────────────────────────────────────────

export function openPrintFlow() {
  const saved = localStorage.getItem('legalid_format');
  if (saved) {
    showStitkPreview();
  } else {
    document.getElementById('formatPanel').classList.toggle('open');
    document.querySelectorAll('.format-card').forEach(c => c.classList.remove('selected'));
  }
}


export function selectCustomFormat() {
  localStorage.setItem('legalid_format', 'custom');
  document.querySelectorAll('.format-card').forEach(c => {
    c.classList.toggle('selected', c.dataset.format === 'custom');
  });
  closeFormatPanel();
  openSettings();
}


export function selectFormat(key) {
  localStorage.setItem('legalid_format', key);
  document.querySelectorAll('.format-card').forEach(c => {
    c.classList.toggle('selected', c.dataset.format === key);
  });
  setTimeout(() => { closeFormatPanel(); showStitkPreview(); }, 220);
}


export function closeFormatPanel() {
  document.getElementById('formatPanel').classList.remove('open');
}


export function showStitkPreview() {
  document.getElementById('stitkPreview').classList.add('visible');
  requestAnimationFrame(() => updateStitek());
}



export function zmenFormat() {
  localStorage.removeItem('legalid_format');
  document.getElementById('stitkPreview').classList.remove('visible');
  document.getElementById('formatPanel').classList.add('open');
  document.querySelectorAll('.format-card').forEach(c => c.classList.remove('selected'));
}


export function extractCity(sidlo) {
  if (!sidlo) return '';
  const parts = sidlo.split(',');
  return (parts[1] || parts[0]).trim().replace(/\s+\d+$/, '').trim();
}


export function sph(val, placeholder) {
  return (val && val.trim()) ? val.trim() : `<span class="st-ph">${placeholder}</span>`;
}


export function renderStitek(s) {
  const preview = document.getElementById('stitkPreview');
  if (!preview || !preview.classList.contains('visible')) return;
  const totalW = s.W1 + s.W2 + s.W3 + s.W4;
  const stitek = document.getElementById('stitek');
  const outer = document.getElementById('stitkScaleOuter');

  const containerW = outer.parentElement ? outer.parentElement.clientWidth : 0;
  const naturalW = totalW * MM;
  const scale = containerW > 10 ? Math.min(SCALE, containerW / naturalW) : SCALE;

  stitek.style.width = `${naturalW}px`;
  stitek.style.height = `${s.H * MM}px`;
  stitek.style.gridTemplateColumns = `${s.W1*MM}px ${s.W2*MM}px ${s.W3*MM}px ${s.W4*MM}px`;
  stitek.style.transform = `scale(${scale})`;
  stitek.style.border = s.border !== false ? '0.3mm solid rgba(11,25,41,.4)' : 'none';
  stitek.classList.toggle('no-lines', s.lines === false);
  outer.style.width = `${naturalW * scale}px`;
  outer.style.height = `${s.H * MM * scale}px`;

  const p = `${s.PY * MM}px ${s.PX * MM}px`;
  ['stCol1','stCol3','stCol4'].forEach(id => { document.getElementById(id).style.padding = p; });
  const col2top = document.getElementById('stCol2top');
  const col2bot = document.getElementById('stCol2bot');
  col2top.style.height = `${s.H1 * MM}px`;
  col2top.style.padding = p;
  col2bot.style.padding = p;

  const v = id => document.getElementById(id)?.value.trim() || '';
  const datumOver = v('fDatumOver'), jmeno = v('fJmeno');
  const datumNar = v('fDatumNar'), mistoNar = v('fMistoNar');
  const adresa = v('fAdresa'), cisloOp = v('fCisloOp');
  const listina = v('fListina'), pocet = v('fPocetVyh');
  const city = extractCity(state.advokat.sidlo);

  document.getElementById('stCol1').innerHTML =
    `${sph(datumOver,'datum')}<br>${sph(city,'místo')}`;

  const narLine = [datumNar && `nar. ${datumNar}`, mistoNar].filter(Boolean).join(', ');
  col2top.innerHTML =
    `<div style="font-weight:600">${sph(jmeno,'Jméno Příjmení')}</div>` +
    `<div>${narLine || '<span class="st-ph">nar. datum, místo</span>'}</div>` +
    `<div>${sph(adresa,'adresa')}</div>`;

  document.getElementById('stCol2bot').innerHTML = `OP: ${sph(cisloOp,'000000000')}`;

  document.getElementById('stCol3').innerHTML =
    `${sph(listina,'specifikace listiny')}<br><br>Počet: ${sph(pocet,'1')}x`;

  document.getElementById('stCol4').innerHTML =
    `<div style="font-weight:600">${sph(state.advokat.jmeno,'Jméno advokáta')}</div>` +
    `<div>${sph(state.advokat.role,'role')}</div>` +
    `<div>ev.č. ČAK: ${sph(state.advokat.ev_cislo,'00000')}</div>`;
}


export function updateStitek() {
  const s = getSettings();
  renderStitek(s);
  const lbl = document.getElementById('stitkPreviewLbl');
  if (lbl) {
    const totalW = (s.W1||0) + (s.W2||0) + (s.W3||0) + (s.W4||0);
    lbl.textContent = `Náhled štítku · ${totalW} × ${s.H} mm`;
  }
}

// ── PRINT ─────────────────────────────────────────────────────────

export function syncDolozkaInputs() {
  const ds = getDolozkaSettings();
  const el = id => document.getElementById(id);
  if (el('ds_horni')) el('ds_horni').value = ds.horni_cast_mm;
  if (el('ds_dolni')) el('ds_dolni').value = ds.dolni_cast_mm;
  if (el('ds_okraj')) el('ds_okraj').value = ds.okraj_mm;
  if (el('ds_px'))    el('ds_px').value    = ds.px_mm;
  if (el('ds_py'))    el('ds_py').value    = ds.py_mm;
}


export function readDolozkaInputs() {
  const n = id => parseFloat(document.getElementById(id)?.value) || 0;
  return {
    horni_cast_mm: n('ds_horni'),
    dolni_cast_mm: n('ds_dolni'),
    okraj_mm:      n('ds_okraj'),
    px_mm:         n('ds_px'),
    py_mm:         n('ds_py'),
  };
}


export function onDolozkaSettingsInput() {
  if (document.getElementById('printModal')?.classList.contains('open')) {
    buildDolozkaPreviewContent();
    scalePrintPreview();
  }
}


export function saveDolozkaSettings() {
  try {
    const existing = JSON.parse(localStorage.getItem('legalid_dolozka_rozmery') || '{}');
    localStorage.setItem('legalid_dolozka_rozmery', JSON.stringify({ ...existing, ...readDolozkaInputs() }));
  } catch { localStorage.setItem('legalid_dolozka_rozmery', JSON.stringify(readDolozkaInputs())); }
  if (document.getElementById('printModal')?.classList.contains('open')) {
    buildDolozkaPreviewContent();
    scalePrintPreview();
  }
  showToast('Nastavení doložky uloženo');
}


export function resetDolozkaSettings() {
  try {
    const existing = JSON.parse(localStorage.getItem('legalid_dolozka_rozmery') || '{}');
    const { horni_cast_mm, dolni_cast_mm, okraj_mm, px_mm, py_mm, ...rest } = existing;
    localStorage.setItem('legalid_dolozka_rozmery', JSON.stringify(rest));
  } catch { localStorage.removeItem('legalid_dolozka_rozmery'); }
  syncDolozkaInputs();
  if (document.getElementById('printModal')?.classList.contains('open')) {
    buildDolozkaPreviewContent();
    scalePrintPreview();
  }
}

// ── CFG PANEL ─────────────────────────────────────────────────────

export function openCfgPanel(section) {
  _closeAllSidePanels();
  syncCfgFromAdvokat();
  syncDolozkaInputs();
  // Globální Nastavení obsahuje už jen Profil advokáta — sekce rozměrů štítků byla odstraněna.
  if (section === 'advokat') openCfgSection('cfgSec1');
  const panel = document.getElementById('cfgPanel');
  const overlay = document.getElementById('cfgOverlay');
  if (document.getElementById('navPanel').classList.contains('open')) {
    _openPanelFromMenu(panel, overlay);
  } else {
    overlay.classList.add('open');
    panel.classList.add('open');
  }
}


export function closeCfgPanel() {
  state.diagramActive = null;
  const panel = document.getElementById('cfgPanel');
  const wasFromMenu = panel.classList.contains('from-menu');
  document.getElementById('cfgOverlay').classList.remove('open');
  panel.classList.remove('open');
  panel.classList.remove('from-menu');
  if (wasFromMenu) {
    const nav = document.getElementById('navPanel');
    nav.classList.remove('open');
    nav.classList.remove('sliding-left');
    nav.style.transform = '';
    nav.style.transition = '';
    document.getElementById('navOverlay').classList.remove('open');
  }
}


export function closeCfgPanelToMenu() {
  const panel = document.getElementById('cfgPanel');
  if (panel.classList.contains('from-menu')) {
    _closePanelToMenu(panel, document.getElementById('cfgOverlay'));
    state.diagramActive = null;
  } else {
    closeCfgPanel();
  }
}


export function openCfgSection(id) {
  ['cfgSec1','cfgSec3'].forEach(s => {
    const el = document.getElementById(s);
    if (el) el.classList.toggle('open', s === id);
  });
}


export function toggleCfgSection(id) {
  const el = document.getElementById(id);
  if (el) el.classList.toggle('open');
}


export function cfgUpdateAdvokat() {
  ['aJmeno','aRole','aEvCislo','aCisloKnihy','aSidlo'].forEach(id => {
    const cfg = document.getElementById('cfg_' + id);
    const orig = document.getElementById(id);
    if (cfg && orig) orig.value = cfg.value;
  });
  updateAdvokat();
}


export function syncCfgFromAdvokat() {
  ['aJmeno','aRole','aEvCislo','aCisloKnihy','aSidlo'].forEach(id => {
    const orig = document.getElementById(id);
    const cfg = document.getElementById('cfg_' + id);
    if (orig && cfg) cfg.value = orig.value;
  });
}

// ── SETTINGS ──────────────────────────────────────────────────────

export function openSettings() { openCfgPanel('stitky'); }

export function closeSettings() { closeCfgPanel(); }


export function saveSettings() {
  const s = {};
  ['H','H1','X','Y','PX','PY','W1','W2','W3','W4'].forEach(f => {
    s[f] = parseFloat(document.getElementById('sp_' + f)?.value) || 0;
  });
  s.border = document.getElementById('sp_border').checked;
  s.lines = document.getElementById('sp_lines').checked;
  localStorage.setItem('legalid_settings', JSON.stringify(s));
  closeSettings();
  updateStitek();
  showToast('Nastavení uloženo');
}


export function saveAndPrint() {
  const s = {};
  ['H','H1','X','Y','PX','PY','W1','W2','W3','W4'].forEach(f => {
    s[f] = parseFloat(document.getElementById('sp_' + f)?.value) || 0;
  });
  s.border = document.getElementById('sp_border').checked;
  s.lines = document.getElementById('sp_lines').checked;
  localStorage.setItem('legalid_settings', JSON.stringify(s));
  closeSettings();
  updateStitek();
  printStitky();
}


export function resetSettings() {
  localStorage.removeItem('legalid_settings');
  openSettings();
}


export function updateSettingsSum() {
  const w = ['W1','W2','W3','W4'].reduce((sum, f) =>
    sum + (parseFloat(document.getElementById('sp_' + f)?.value) || 0), 0);
  const el = document.getElementById('sp_sum');
  if (!el) return;
  el.textContent = `Součet: ${w.toFixed(1)} mm`;
  el.className = 'sp-sum ' + (w <= 210 ? 'ok' : 'err');
}


export function onSettingsInput() {
  updateSettingsSum();
  const fmtKey = localStorage.getItem('legalid_format') || 'standard';
  const s = { ...(FORMAT_DEFAULTS[fmtKey] || FORMAT_DEFAULTS.standard) };
  ['H','H1','X','Y','PX','PY','W1','W2','W3','W4'].forEach(f => {
    const el = document.getElementById('sp_' + f);
    if (el && el.value !== '') s[f] = parseFloat(el.value) || 0;
  });
  s.border = document.getElementById('sp_border')?.checked ?? s.border;
  s.lines = document.getElementById('sp_lines')?.checked ?? s.lines;
  renderStitek(s);
  renderDiagram(s);
}

// ── PRINT DOLOZKA A4 ──────────────────────────────────────────────

export function getDolozkaData() {
  const a = state.advokat;
  const v = id => document.getElementById(id)?.value.trim() || '';
  return {
    jmeno: v('fJmeno'), datumNar: v('fDatumNar'), mistoNar: v('fMistoNar'),
    adresa: v('fAdresa'), cisloOp: v('fCisloOp'),
    cisloRadku: v('fCisloRadku'), rok: v('fRok'),
    datumOver: v('fDatumOver'), pocet: v('fPocetVyh'), listina: v('fListina'),
    aJmeno: a.jmeno, aRole: a.role, aEvCislo: a.ev_cislo,
    aCisloKnihy: a.cislo_knihy, aSidlo: a.sidlo,
  };
}


export function phd(val, fb) {
  return (val && val.trim()) ? val : `<span style="color:#bbb;font-style:italic">[${fb}]</span>`;
}


export function openDolozkaPreview() {
  softValidate();
  loadPmSettings();
  buildDolozkaPreviewContent();
  // Reset to preview tab (relevant on mobile)
  document.getElementById('pmPreviewCol')?.classList.remove('pm-col-hidden');
  document.getElementById('pmSettingsCol')?.classList.remove('pm-col-show');
  document.getElementById('pmTabPreview')?.classList.add('active');
  document.getElementById('pmTabSettings')?.classList.remove('active');
  document.getElementById('printModalOverlay').classList.add('open');
  document.getElementById('printModal').classList.add('open');
  requestAnimationFrame(scalePrintPreview);
}


export function closePrintModal() {
  document.getElementById('printModalOverlay').classList.remove('open');
  document.getElementById('printModal').classList.remove('open');
}


export function getCopies() {
  const v = parseInt(document.getElementById('pmCopies')?.value || '1', 10);
  return Math.max(1, isNaN(v) ? 1 : v);
}


export function updatePvLines() {
  const grid = document.getElementById('pvGrid');
  if (grid) grid.classList.toggle('pv-show-lines', !!document.getElementById('pmLines')?.checked);
}

// ── PM SETTINGS ───────────────────────────────────────────────────

export function getPmSettings() {
  try {
    const s = JSON.parse(localStorage.getItem('legalid_dolozka_rozmery') || 'null');
    return s ? { ...PM_DEFAULTS, ...s } : { ...PM_DEFAULTS };
  } catch { return { ...PM_DEFAULTS }; }
}


export function getPmSettingsFromUI() {
  const n = id => { const v = parseFloat(document.getElementById(id)?.value); return isNaN(v) ? 0 : v; };
  const sig = document.querySelector('input[name="pm_sig"]:checked')?.value || 'sign';
  return {
    X1: n('pm_X1'), X2: n('pm_X2'), Y1: n('pm_Y1'), Y2: n('pm_Y2'),
    W: Math.max(n('pm_W'), 10), H: Math.max(n('pm_H'), 5),
    PX: n('pm_PX'), PY: n('pm_PY'),
    sig_mode: sig, cell_border: !!document.getElementById('pm_border')?.checked,
    bot_border: !!document.getElementById('pm_bot_border')?.checked,
    cut_line: !!document.getElementById('pm_cut_line')?.checked,
    combo: !!document.getElementById('pm_combo')?.checked,
  };
}


export function loadPmSettings() {
  const s = getPmSettings();
  const set = (id, v) => { const e = document.getElementById(id); if (e) e.value = v; };
  set('pm_X1', s.X1); set('pm_X2', s.X2); set('pm_Y1', s.Y1); set('pm_Y2', s.Y2);
  set('pm_W', s.W);   set('pm_H', s.H);   set('pm_PX', s.PX); set('pm_PY', s.PY);
  document.querySelectorAll('input[name="pm_sig"]').forEach(r => { r.checked = r.value === (s.sig_mode || 'sign'); });
  const b = document.getElementById('pm_border'); if (b) b.checked = !!s.cell_border;
  const bb = document.getElementById('pm_bot_border'); if (bb) bb.checked = !!s.bot_border;
  const cl = document.getElementById('pm_cut_line'); if (cl) cl.checked = !!s.cut_line;
  const co = document.getElementById('pm_combo'); if (co) co.checked = !!s.combo;
  updatePmPanelVisibility();
  loadKombovanySettings();
  renderPmDiagram();
  updatePmAdvancedBadge();
}


export function togglePmAdvanced() {
  const body = document.getElementById('pmAdvancedBody');
  const arrow = document.getElementById('pmAdvancedArrow');
  if (!body) return;
  const open = body.classList.toggle('open');
  if (arrow) arrow.style.transform = open ? 'rotate(90deg)' : '';
}


export function updatePmAdvancedBadge() {
  const badge = document.getElementById('pmAdvancedBadge');
  if (!badge) return;
  let count = 0;
  const sig = document.querySelector('input[name="pm_sig"]:checked')?.value;
  if (sig && sig !== 'sign') count++;
  ['pm_border', 'pm_bot_border', 'pm_cut_line', 'pm_combo'].forEach(id => {
    if (document.getElementById(id)?.checked) count++;
  });
  badge.textContent = count;
  badge.style.display = count > 0 ? '' : 'none';
}


export function onPmSettingsInput() {
  const s = getPmSettingsFromUI();
  try {
    const existing = JSON.parse(localStorage.getItem('legalid_dolozka_rozmery') || '{}');
    localStorage.setItem('legalid_dolozka_rozmery', JSON.stringify({ ...existing, ...s }));
  } catch { localStorage.setItem('legalid_dolozka_rozmery', JSON.stringify(s)); }
  updatePmPanelVisibility();
  renderPmDiagram();
  buildDolozkaPreviewContent();
  updatePmAdvancedBadge();
}


export function resetPmSettings() {
  try {
    const existing = JSON.parse(localStorage.getItem('legalid_dolozka_rozmery') || '{}');
    const { X1, X2, Y1, Y2, W, H, PX, PY, sig_mode, cell_border, bot_border, cut_line, combo, ...rest } = existing;
    localStorage.setItem('legalid_dolozka_rozmery', JSON.stringify(rest));
  } catch { localStorage.removeItem('legalid_dolozka_rozmery'); }
  loadPmSettings();
  buildDolozkaPreviewContent();
  showToast('Nastavení tisku obnoveno');
}


export function updatePmPanelVisibility() {
  const isCombo = !!document.getElementById('pm_combo')?.checked;
  const std = document.getElementById('pmPanelStd');
  const combo = document.getElementById('pmPanelCombo');
  if (std) std.style.display = isCombo ? 'none' : '';
  if (combo) combo.style.display = isCombo ? '' : 'none';
  if (isCombo) renderKomboDiagram();
}


export function getKombovanySettings() {
  try {
    const s = JSON.parse(localStorage.getItem('legalid_kombinovany_rozmery') || 'null');
    return s ? { ...COMBO_PM_DEFAULTS, ...s } : { ...COMBO_PM_DEFAULTS };
  } catch { return { ...COMBO_PM_DEFAULTS }; }
}


export function getKombovanySettingsFromUI() {
  const n = id => { const v = parseFloat(document.getElementById(id)?.value); return isNaN(v) ? 0 : v; };
  return {
    Y: n('km_Y'), X: n('km_X'), XR: n('km_XR'),
    PX: n('km_PX'), PY: n('km_PY'), MEZ: n('km_MEZ'),
    L: n('km_L'), P: n('km_P'),
  };
}


export function loadKombovanySettings() {
  const ks = getKombovanySettings();
  const set = (id, v) => { const e = document.getElementById(id); if (e) e.value = v; };
  set('km_Y', ks.Y); set('km_X', ks.X); set('km_XR', ks.XR);
  set('km_PX', ks.PX); set('km_PY', ks.PY); set('km_MEZ', ks.MEZ);
  set('km_L', ks.L); set('km_P', ks.P);
  validateKomboWidths();
  renderKomboDiagram();
}


export function validateKomboWidths() {
  const ks = getKombovanySettingsFromUI();
  const warn = document.getElementById('kmWidthWarn');
  if (warn) warn.style.display = (ks.L + ks.P !== 100) ? '' : 'none';
}


export function onKomboSettingsInput() {
  const ks = getKombovanySettingsFromUI();
  try {
    const existing = JSON.parse(localStorage.getItem('legalid_kombinovany_rozmery') || '{}');
    localStorage.setItem('legalid_kombinovany_rozmery', JSON.stringify({ ...existing, ...ks }));
  } catch { localStorage.setItem('legalid_kombinovany_rozmery', JSON.stringify(ks)); }
  validateKomboWidths();
  renderKomboDiagram();
  buildDolozkaPreviewContent();
}


export function resetKomboSettings() {
  try {
    localStorage.removeItem('legalid_kombinovany_rozmery');
  } catch {}
  loadKombovanySettings();
  buildDolozkaPreviewContent();
  showToast('Nastavení kombinovaného formátu obnoveno');
}


export function activeResetPmSettings() {
  const isCombo = !!document.getElementById('pm_combo')?.checked;
  if (isCombo) resetKomboSettings();
  else resetPmSettings();
}


export function renderKomboDiagram() {
  const svg = document.getElementById('pmKomboDiagram');
  if (!svg) return;
  const ks = getKombovanySettingsFromUI();
  const k = 1.5;
  const ax = 28, ay = 14, aw = 168, ah = 148;
  const cL = ax + ks.X * k, cR = ax + aw - ks.XR * k, cW = cR - cL;
  const rowTop = ay + ks.Y * k, rowH = 42, rowBot = rowTop + rowH;
  const mezBot = rowBot + ks.MEZ * k;
  const divX = cL + cW * (ks.L / 100);
  const B = '#378ADD', ff = "font-family='system-ui,sans-serif'";
  const ac = f => state.comboDiagramActive === f ? '#9a6e10' : B;
  let o = '';
  o += `<rect x="${ax}" y="${ay}" width="${aw}" height="${ah}" fill="#f0f2f5" stroke="#b0b8c4" stroke-width="1" rx="2"/>`;
  if (cL > ax && cR > cL && rowTop > ay) {
    o += `<rect x="${cL.toFixed(1)}" y="${rowTop.toFixed(1)}" width="${cW.toFixed(1)}" height="${rowH}" fill="rgba(55,138,221,.07)" stroke="none"/>`;
    const tw = divX - ks.PX * k - cL, th = rowH - 2 * ks.PY * k, ty = rowTop + ks.PY * k;
    if (tw > 2 && th > 2) o += `<rect x="${cL.toFixed(1)}" y="${ty.toFixed(1)}" width="${Math.max(tw,2).toFixed(1)}" height="${th.toFixed(1)}" fill="rgba(55,138,221,.12)" stroke="none" rx="1"/>`;
    const rw = cR - (divX + ks.PX * k);
    if (rw > 2 && th > 2) o += `<rect x="${(divX + ks.PX * k).toFixed(1)}" y="${ty.toFixed(1)}" width="${Math.max(rw,2).toFixed(1)}" height="${th.toFixed(1)}" fill="rgba(55,138,221,.12)" stroke="none" rx="1"/>`;
    o += `<line x1="${divX.toFixed(1)}" y1="${rowTop.toFixed(1)}" x2="${divX.toFixed(1)}" y2="${rowBot.toFixed(1)}" stroke="${B}" stroke-width="0.8"/>`;
    if (ks.MEZ > 0 && mezBot > rowBot) {
      o += `<rect x="${cL.toFixed(1)}" y="${rowBot.toFixed(1)}" width="${cW.toFixed(1)}" height="${(mezBot - rowBot).toFixed(1)}" fill="rgba(0,0,0,.03)" stroke="none"/>`;
      o += `<line x1="${cL.toFixed(1)}" y1="${rowBot.toFixed(1)}" x2="${cR.toFixed(1)}" y2="${rowBot.toFixed(1)}" stroke="#aaa" stroke-width="0.8" stroke-dasharray="4,2"/>`;
    }
  }
  if (ks.Y > 0) {
    const mx = ax - 10, my = (ay + rowTop) / 2;
    o += `<line x1="${mx}" y1="${ay}" x2="${mx}" y2="${rowTop.toFixed(1)}" stroke="${ac('Y')}" stroke-width="1"/><line x1="${mx-3}" y1="${ay}" x2="${mx+3}" y2="${ay}" stroke="${ac('Y')}" stroke-width="1"/><line x1="${mx-3}" y1="${rowTop.toFixed(1)}" x2="${mx+3}" y2="${rowTop.toFixed(1)}" stroke="${ac('Y')}" stroke-width="1"/>`;
    o += `<text x="${mx-13}" y="${my.toFixed(1)}" ${ff} font-size="8" fill="${ac('Y')}" text-anchor="middle" dominant-baseline="middle" transform="rotate(-90 ${mx-13} ${my.toFixed(1)})">Y</text>`;
  }
  if (ks.X > 0) {
    const my = ay - 9, mx = (ax + cL) / 2;
    o += `<line x1="${ax}" y1="${my}" x2="${cL.toFixed(1)}" y2="${my}" stroke="${ac('X')}" stroke-width="1"/><line x1="${ax}" y1="${my-3}" x2="${ax}" y2="${my+3}" stroke="${ac('X')}" stroke-width="1"/><line x1="${cL.toFixed(1)}" y1="${my-3}" x2="${cL.toFixed(1)}" y2="${my+3}" stroke="${ac('X')}" stroke-width="1"/>`;
    o += `<text x="${mx.toFixed(1)}" y="${my-5}" ${ff} font-size="8" fill="${ac('X')}" text-anchor="middle">X</text>`;
  }
  if (ks.XR > 0) {
    const my = ay - 9, mx = (cR + ax + aw) / 2;
    o += `<line x1="${cR.toFixed(1)}" y1="${my}" x2="${ax+aw}" y2="${my}" stroke="${ac('XR')}" stroke-width="1"/><line x1="${cR.toFixed(1)}" y1="${my-3}" x2="${cR.toFixed(1)}" y2="${my+3}" stroke="${ac('XR')}" stroke-width="1"/><line x1="${ax+aw}" y1="${my-3}" x2="${ax+aw}" y2="${my+3}" stroke="${ac('XR')}" stroke-width="1"/>`;
    o += `<text x="${mx.toFixed(1)}" y="${my-5}" ${ff} font-size="8" fill="${ac('XR')}" text-anchor="middle">XR</text>`;
  }
  if (ks.MEZ > 0 && mezBot > rowBot + 2) {
    const mx = ax + aw + 10, my = (rowBot + mezBot) / 2;
    o += `<line x1="${mx}" y1="${rowBot.toFixed(1)}" x2="${mx}" y2="${mezBot.toFixed(1)}" stroke="${ac('MEZ')}" stroke-width="1"/><line x1="${mx-3}" y1="${rowBot.toFixed(1)}" x2="${mx+3}" y2="${rowBot.toFixed(1)}" stroke="${ac('MEZ')}" stroke-width="1"/><line x1="${mx-3}" y1="${mezBot.toFixed(1)}" x2="${mx+3}" y2="${mezBot.toFixed(1)}" stroke="${ac('MEZ')}" stroke-width="1"/>`;
    o += `<text x="${mx+13}" y="${my.toFixed(1)}" ${ff} font-size="8" fill="${ac('MEZ')}" text-anchor="middle" dominant-baseline="middle" transform="rotate(90 ${mx+13} ${my.toFixed(1)})">MEZ</text>`;
  }
  const rowMid = (rowTop + rowBot) / 2;
  const lMid = (cL + divX) / 2, pMid = (divX + cR) / 2;
  if (cW > 20) {
    o += `<text x="${lMid.toFixed(1)}" y="${rowMid.toFixed(1)}" ${ff} font-size="7.5" fill="${B}" text-anchor="middle" dominant-baseline="middle" opacity=".7">L ${ks.L}%</text>`;
    o += `<text x="${pMid.toFixed(1)}" y="${rowMid.toFixed(1)}" ${ff} font-size="7.5" fill="${B}" text-anchor="middle" dominant-baseline="middle" opacity=".7">P ${ks.P}%</text>`;
  }
  svg.innerHTML = o;
}


export function switchPmTab(tab) {
  const previewCol = document.getElementById('pmPreviewCol');
  const settingsCol = document.getElementById('pmSettingsCol');
  const tabPreview = document.getElementById('pmTabPreview');
  const tabSettings = document.getElementById('pmTabSettings');
  if (tab === 'preview') {
    previewCol?.classList.remove('pm-col-hidden');
    settingsCol?.classList.remove('pm-col-show');
    tabPreview?.classList.add('active');
    tabSettings?.classList.remove('active');
  } else {
    previewCol?.classList.add('pm-col-hidden');
    settingsCol?.classList.add('pm-col-show');
    tabPreview?.classList.remove('active');
    tabSettings?.classList.add('active');
    updatePmPanelVisibility();
    renderPmDiagram();
  }
}


export function pmDiagramClick(field) {
  state.pmDiagramActive = state.pmDiagramActive === field ? null : field;
  ['X1','X2','Y1','Y2','W','H','PX','PY'].forEach(f => {
    const e = document.getElementById('pm_' + f);
    if (e) e.classList.toggle('pm-hi', f === field && state.pmDiagramActive !== null);
  });
  if (state.pmDiagramActive) { const e = document.getElementById('pm_' + field); if (e) e.focus(); }
  renderPmDiagram();
}


export function renderPmDiagram() {
  const svg = document.getElementById('pmDiagram');
  if (!svg) return;
  const s = getPmSettingsFromUI();
  const k = 2.0, CX = 28, CY = 22, CW = 210, CH = 148;
  const cx = CX + s.X1 * k;
  const cy = CY + s.Y1 * k;
  const cw = Math.min(Math.max(s.W * k, 10), CX + CW - cx);
  const ch = Math.min(Math.max(s.H * k, 6), CY + CH - cy);
  const sepY = cy + ch, bh = CY + CH - sepY;
  const G = '#9a6e10', B = '#1a6eb5';
  const ac = f => state.pmDiagramActive === f ? G : B;
  const ff = "font-family='system-ui,sans-serif'";
  const hl = (f, x, y, w, h) =>
    `<rect x="${x}" y="${y}" width="${Math.max(w,4)}" height="${Math.max(h,4)}" fill="transparent" rx="1" style="cursor:pointer" onclick="pmDiagramClick('${f}')"/>`;
  let o = '';
  o += `<rect x="${CX}" y="${CY}" width="${CW}" height="${CH}" fill="#f0f2f5" stroke="#b0b8c4" stroke-width="1" rx="2"/>`;
  o += `<rect x="${cx.toFixed(1)}" y="${cy.toFixed(1)}" width="${cw.toFixed(1)}" height="${ch.toFixed(1)}" fill="rgba(26,110,181,.08)" stroke="${B}" stroke-width="0.8" stroke-dasharray="4,2" rx="1"/>`;
  o += `<line x1="${cx.toFixed(1)}" y1="${sepY.toFixed(1)}" x2="${(cx+cw).toFixed(1)}" y2="${sepY.toFixed(1)}" stroke="#999" stroke-width="0.8" stroke-dasharray="5,3"/>`;
  if (bh > 1) o += `<rect x="${cx.toFixed(1)}" y="${sepY.toFixed(1)}" width="${cw.toFixed(1)}" height="${bh.toFixed(1)}" fill="rgba(11,25,41,.05)" stroke="${B}" stroke-width="0.5" stroke-dasharray="2,2" rx="1"/>`;
  if (cx > CX + 2) {
    const mx = (CX + cx) / 2;
    o += `<line x1="${CX}" y1="${CY-9}" x2="${cx}" y2="${CY-9}" stroke="${ac('X1')}" stroke-width="1"/><line x1="${CX}" y1="${CY-12}" x2="${CX}" y2="${CY-6}" stroke="${ac('X1')}" stroke-width="1"/><line x1="${cx}" y1="${CY-12}" x2="${cx}" y2="${CY-6}" stroke="${ac('X1')}" stroke-width="1"/>`;
    o += `<text x="${mx}" y="${CY-14}" ${ff} font-size="8" fill="${ac('X1')}" text-anchor="middle">X1</text>`;
    o += hl('X1', CX, CY-17, cx-CX, 12);
  }
  if (CX + CW > cx + cw + 2) {
    const mx = (cx + cw + CX + CW) / 2;
    o += `<line x1="${cx+cw}" y1="${CY-9}" x2="${CX+CW}" y2="${CY-9}" stroke="${ac('X2')}" stroke-width="1"/><line x1="${cx+cw}" y1="${CY-12}" x2="${cx+cw}" y2="${CY-6}" stroke="${ac('X2')}" stroke-width="1"/><line x1="${CX+CW}" y1="${CY-12}" x2="${CX+CW}" y2="${CY-6}" stroke="${ac('X2')}" stroke-width="1"/>`;
    o += `<text x="${mx}" y="${CY-14}" ${ff} font-size="8" fill="${ac('X2')}" text-anchor="middle">X2</text>`;
    o += hl('X2', cx+cw, CY-17, CX+CW-(cx+cw), 12);
  }
  if (cy > CY + 2) {
    const my = (CY + cy) / 2;
    o += `<line x1="${CX-9}" y1="${CY}" x2="${CX-9}" y2="${cy}" stroke="${ac('Y1')}" stroke-width="1"/><line x1="${CX-12}" y1="${CY}" x2="${CX-6}" y2="${CY}" stroke="${ac('Y1')}" stroke-width="1"/><line x1="${CX-12}" y1="${cy}" x2="${CX-6}" y2="${cy}" stroke="${ac('Y1')}" stroke-width="1"/>`;
    o += `<text x="${CX-16}" y="${my}" ${ff} font-size="8" fill="${ac('Y1')}" text-anchor="middle" dominant-baseline="middle" transform="rotate(-90 ${CX-16} ${my})">Y1</text>`;
    o += hl('Y1', CX-17, CY, 12, cy-CY);
  }
  { const wY = CY + CH + 9, mx = cx + cw / 2;
    o += `<line x1="${cx}" y1="${wY}" x2="${cx+cw}" y2="${wY}" stroke="${ac('W')}" stroke-width="1"/><line x1="${cx}" y1="${wY-3}" x2="${cx}" y2="${wY+3}" stroke="${ac('W')}" stroke-width="1"/><line x1="${cx+cw}" y1="${wY-3}" x2="${cx+cw}" y2="${wY+3}" stroke="${ac('W')}" stroke-width="1"/>`;
    o += `<text x="${mx}" y="${wY+10}" ${ff} font-size="8" fill="${ac('W')}" text-anchor="middle">W</text>`;
    o += hl('W', cx, wY-5, cw, 18); }
  if (sepY > cy + 2) {
    const hX = CX + CW + 10, my = (cy + sepY) / 2;
    o += `<line x1="${hX}" y1="${cy}" x2="${hX}" y2="${sepY}" stroke="${ac('H')}" stroke-width="1"/><line x1="${hX-3}" y1="${cy}" x2="${hX+3}" y2="${cy}" stroke="${ac('H')}" stroke-width="1"/><line x1="${hX-3}" y1="${sepY}" x2="${hX+3}" y2="${sepY}" stroke="${ac('H')}" stroke-width="1"/>`;
    o += `<text x="${hX+13}" y="${my}" ${ff} font-size="8" fill="${ac('H')}" text-anchor="middle" dominant-baseline="middle" transform="rotate(90 ${hX+13} ${my})">H</text>`;
    o += hl('H', hX-5, cy, 20, sepY-cy);
  }
  if (cw > 20 && ch > 20) {
    o += `<text x="${(cx+5).toFixed(0)}" y="${(cy+10).toFixed(0)}" ${ff} font-size="8" fill="${ac('PX')}" style="cursor:pointer" onclick="pmDiagramClick('PX')">PX</text>`;
    o += `<text x="${(cx+5).toFixed(0)}" y="${(cy+21).toFixed(0)}" ${ff} font-size="8" fill="${ac('PY')}" style="cursor:pointer" onclick="pmDiagramClick('PY')">PY</text>`;
  }
  if (bh > 10) {
    const y2x = (cx + cx + cw) / 2, y2y = (sepY + CY + CH) / 2;
    o += `<text x="${y2x.toFixed(0)}" y="${y2y.toFixed(0)}" ${ff} font-size="8" fill="${ac('Y2')}" text-anchor="middle" dominant-baseline="middle" style="cursor:pointer" onclick="pmDiagramClick('Y2')">Y2</text>`;
    o += hl('Y2', cx, sepY, cw, bh);
  }
  svg.innerHTML = o;
}


export function toggleSplitMenu(e) {
  e.stopPropagation();
  document.getElementById('splitDropdown').classList.toggle('open');
}

export function closeSplitMenu() {
  document.getElementById('splitDropdown').classList.remove('open');
}

// ── DIAGRAM ───────────────────────────────────────────────────────

export function getDiagramS() {
  const fmtKey = localStorage.getItem('legalid_format') || 'standard';
  const s = { ...(FORMAT_DEFAULTS[fmtKey] || FORMAT_DEFAULTS.standard) };
  ['H','H1','X','Y','PX','PY','W1','W2','W3','W4'].forEach(f => {
    const el = document.getElementById('sp_' + f);
    if (el && el.value !== '') s[f] = parseFloat(el.value) || 0;
  });
  s.border = document.getElementById('sp_border')?.checked ?? s.border;
  return s;
}


export function renderDiagram(s) {
  const svg = document.getElementById('spDiagram');
  if (!svg) return;
  const SHX=38, SHY=14, SHW=185, SHH=108, k=SHW/210;
  const lx=SHX+(s.X||0)*k, ly=SHY+(s.Y||0)*k;
  const lw=((s.W1||0)+(s.W2||0)+(s.W3||0)+(s.W4||0))*k, lh=(s.H||0)*k;
  const rb=lx+lw, lb=ly+lh;
  const cx1=lx+(s.W1||0)*k, cx2=cx1+(s.W2||0)*k, cx3=cx2+(s.W3||0)*k;
  const h1y=ly+(s.H1||0)*k, pxx=lx+(s.PX||0)*k, pyy=ly+(s.PY||0)*k;
  const G='#9a6e10', N='#0b1929', FF="font-family='system-ui,sans-serif'";

  const hl = (f,rx,ry,rw,rh) => {
    const a = state.diagramActive===f;
    return `<rect x="${rx.toFixed(1)}" y="${ry.toFixed(1)}" width="${Math.max(rw,6).toFixed(1)}" height="${Math.max(rh,6).toFixed(1)}" fill="${a?'rgba(154,110,16,.13)':'transparent'}" stroke="${a?G:'none'}" stroke-width="${a?1.5:0}" rx="1" style="cursor:pointer" onclick="diagramClick('${f}')"/>`;
  };

  const arH = (x1,x2,y,lbl) => {
    const d=x2-x1, mx=(x1+x2)/2;
    if (d<5) return `<text x="${mx.toFixed(1)}" y="${(y-5).toFixed(1)}" text-anchor="middle" ${FF} font-size="11" font-weight="700" fill="${G}">${lbl}</text>`;
    return `<polygon points="${x1},${y} ${x1+4},${(y-3)} ${x1+4},${(y+3)}" fill="${N}" opacity=".6"/>
      <line x1="${(x1+4).toFixed(1)}" y1="${y}" x2="${(x2-4).toFixed(1)}" y2="${y}" stroke="${N}" stroke-width="1" opacity=".6"/>
      <polygon points="${x2},${y} ${(x2-4)},${(y-3)} ${(x2-4)},${(y+3)}" fill="${N}" opacity=".6"/>
      <line x1="${x1}" y1="${(y-5)}" x2="${x1}" y2="${(y+5)}" stroke="${N}" stroke-width=".7" opacity=".35"/>
      <line x1="${x2}" y1="${(y-5)}" x2="${x2}" y2="${(y+5)}" stroke="${N}" stroke-width=".7" opacity=".35"/>
      <text x="${mx.toFixed(1)}" y="${(y-6).toFixed(1)}" text-anchor="middle" ${FF} font-size="11" font-weight="700" fill="${G}">${lbl}</text>`;
  };

  const arV = (x,y1,y2,lbl,lx_) => {
    const d=y2-y1, my=(y1+y2)/2, tx=(lx_??x+10);
    if (d<5) return `<text x="${tx.toFixed(1)}" y="${(my+4).toFixed(1)}" text-anchor="middle" ${FF} font-size="11" font-weight="700" fill="${G}">${lbl}</text>`;
    return `<polygon points="${x},${y1} ${(x-3)},${(y1+4)} ${(x+3)},${(y1+4)}" fill="${N}" opacity=".6"/>
      <line x1="${x}" y1="${(y1+4).toFixed(1)}" x2="${x}" y2="${(y2-4).toFixed(1)}" stroke="${N}" stroke-width="1" opacity=".6"/>
      <polygon points="${x},${y2} ${(x-3)},${(y2-4)} ${(x+3)},${(y2-4)}" fill="${N}" opacity=".6"/>
      <line x1="${(x-5)}" y1="${y1}" x2="${(x+5)}" y2="${y1}" stroke="${N}" stroke-width=".7" opacity=".35"/>
      <line x1="${(x-5)}" y1="${y2}" x2="${(x+5)}" y2="${y2}" stroke="${N}" stroke-width=".7" opacity=".35"/>
      <text x="${tx.toFixed(1)}" y="${(my+4).toFixed(1)}" text-anchor="middle" ${FF} font-size="11" font-weight="700" fill="${G}">${lbl}</text>`;
  };

  const wlbl = (cx,lbl) =>
    `<line x1="${cx.toFixed(1)}" y1="${lb.toFixed(1)}" x2="${cx.toFixed(1)}" y2="${(lb+6).toFixed(1)}" stroke="${N}" stroke-width=".7" opacity=".35"/>
    <text x="${cx.toFixed(1)}" y="${(lb+16).toFixed(1)}" text-anchor="middle" ${FF} font-size="11" font-weight="700" fill="${G}">${lbl}</text>`;

  svg.innerHTML = `
    <rect x="${SHX}" y="${SHY}" width="${SHW}" height="${SHH}" rx="2" fill="#f2f0eb" stroke="#d0ccc4" stroke-width=".8"/>
    <rect x="${lx.toFixed(1)}" y="${ly.toFixed(1)}" width="${lw.toFixed(1)}" height="${lh.toFixed(1)}" fill="#fff" stroke="${N}" stroke-width="1.5" opacity=".85"/>
    <line x1="${cx1.toFixed(1)}" y1="${ly.toFixed(1)}" x2="${cx1.toFixed(1)}" y2="${lb.toFixed(1)}" stroke="${N}" stroke-width=".8" opacity=".5"/>
    <line x1="${cx2.toFixed(1)}" y1="${ly.toFixed(1)}" x2="${cx2.toFixed(1)}" y2="${lb.toFixed(1)}" stroke="${N}" stroke-width=".8" opacity=".5"/>
    <line x1="${cx3.toFixed(1)}" y1="${ly.toFixed(1)}" x2="${cx3.toFixed(1)}" y2="${lb.toFixed(1)}" stroke="${N}" stroke-width=".8" opacity=".5"/>
    <line x1="${cx1.toFixed(1)}" y1="${h1y.toFixed(1)}" x2="${cx2.toFixed(1)}" y2="${h1y.toFixed(1)}" stroke="${N}" stroke-width=".8" opacity=".5"/>
    <line x1="${pxx.toFixed(1)}" y1="${ly.toFixed(1)}" x2="${pxx.toFixed(1)}" y2="${lb.toFixed(1)}" stroke="${N}" stroke-width=".8" stroke-dasharray="2.5,2" opacity=".4"/>
    <line x1="${lx.toFixed(1)}" y1="${pyy.toFixed(1)}" x2="${cx1.toFixed(1)}" y2="${pyy.toFixed(1)}" stroke="${N}" stroke-width=".8" stroke-dasharray="2.5,2" opacity=".4"/>
    ${(s.X||0)>0.5 ? arH(SHX,lx,ly+lh/2,'X') : `<text x="${(SHX+3)}" y="${(ly+lh/2+4).toFixed(1)}" ${FF} font-size="10" font-weight="700" fill="${G}">X</text>`}
    ${(s.Y||0)>0.5 ? arV(SHX-13,SHY,ly,'Y',SHX-5) : `<text x="${SHX-6}" y="${(SHY+10)}" text-anchor="end" ${FF} font-size="10" font-weight="700" fill="${G}">Y</text>`}
    <line x1="${rb.toFixed(1)}" y1="${ly.toFixed(1)}" x2="${(rb+12).toFixed(1)}" y2="${ly.toFixed(1)}" stroke="${N}" stroke-width=".7" opacity=".35"/>
    <line x1="${rb.toFixed(1)}" y1="${lb.toFixed(1)}" x2="${(rb+12).toFixed(1)}" y2="${lb.toFixed(1)}" stroke="${N}" stroke-width=".7" opacity=".35"/>
    ${arV(rb+8,ly,lb,'H',rb+17)}
    <text x="${(cx1+2).toFixed(1)}" y="${((ly+h1y)/2+4).toFixed(1)}" ${FF} font-size="10" font-weight="700" fill="${G}">H1</text>
    ${wlbl((lx+cx1)/2,'W1')}${wlbl((cx1+cx2)/2,'W2')}${wlbl((cx2+cx3)/2,'W3')}${wlbl((cx3+rb)/2,'W4')}
    <text x="${(pxx+2).toFixed(1)}" y="${(lb-3).toFixed(1)}" ${FF} font-size="10" font-weight="700" fill="${G}">PX</text>
    <text x="${(lx+2).toFixed(1)}" y="${(pyy-2).toFixed(1)}" ${FF} font-size="10" font-weight="700" fill="${G}">PY</text>
    ${hl('W1',lx,ly,(s.W1||0)*k,lh)}
    ${hl('W2',cx1,ly,(s.W2||0)*k,lh)}
    ${hl('W3',cx2,ly,(s.W3||0)*k,lh)}
    ${hl('W4',cx3,ly,(s.W4||0)*k,lh)}
    ${hl('H1',cx1,ly,(s.W2||0)*k,(s.H1||0)*k)}
    ${hl('H',rb,ly,18,lh)}
    ${(s.X||0)>0.5 ? hl('X',SHX,ly,(s.X||0)*k,lh) : ''}
    ${(s.Y||0)>0.5 ? hl('Y',lx-5,SHY,20,(s.Y||0)*k) : ''}
    ${hl('PX',pxx-5,ly,12,lh)}
    ${hl('PY',lx,pyy-5,cx1-lx,12)}`;
}


export function diagramClick(field) {
  const prev = state.diagramActive;
  state.diagramActive = field;
  renderDiagram(getDiagramS());
  if (prev) {
    const pe = document.getElementById('sp_' + prev);
    if (pe) pe.classList.remove('sp-highlighted');
  }
  const el = document.getElementById('sp_' + field);
  if (el) {
    el.classList.add('sp-highlighted');
    el.focus();
    el.scrollIntoView({ behavior:'smooth', block:'nearest' });
    setTimeout(() => { if (el) el.classList.remove('sp-highlighted'); }, 2000);
  }
}


// ── Toast ─────────────────────────────────────────────────────────
