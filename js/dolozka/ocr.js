// legalid.cz — js/dolozka/ocr.js
// Vygenerováno refaktoringem z původního monolitického index.html.

import { apiOcr } from '../core/api.js';
import { openPreview, showOcrSuccess, updatePreview } from './dolozka.js';
import { state } from '../core/state.js';
import { showToast } from '../core/ui.js';

export async function runOcr() {
  if (state.uploadedImages.length === 0) return;
  setOcrLoading(true);
  const images = state.uploadedImages.map(img => ({
    data: img.dataUrl.split(',')[1],
    media_type: img.mediaType.startsWith('image/') ? img.mediaType : 'image/jpeg'
  }));
  try {
    const data = await apiOcr(images);
    if (data.error) throw new Error(data.message || 'OCR selhalo.');
    fillForm(data);
    state.ocrDone = true;
    openPreview();
    showOcrSuccess();
    showToast('Údaje rozpoznány — zkontrolujte prosím.');
  } catch (err) {
    showToast('Chyba: ' + err.message);
  } finally {
    setOcrLoading(false);
  }
}


export function setOcrLoading(on) {
  document.getElementById('ocrLoading').classList.toggle('visible', on);
  document.getElementById('uploadHint').style.visibility = on ? 'hidden' : 'visible';
}


export function fillForm(data) {
  const fields = {
    fJmeno:    'jmeno_prijmeni',
    fDatumNar: 'datum_narozeni',
    fMistoNar: 'misto_narozeni',
    fAdresa:   'adresa_trvaleho_pobytu',
    fCisloOp:  'cislo_op',
    fStatOb:   'statni_obcanstvi',
  };
  const lowConf = new Set(data.pole_s_nizkou_jistotou || []);
  const conf = data.confidence ?? 1;
  Object.entries(fields).forEach(([elId, key]) => {
    const el = document.getElementById(elId);
    el.value = data[key] ?? '';
    el.classList.remove('warn', 'danger');
    const hint = el.nextElementSibling;
    if (hint?.classList.contains('field-hint')) {
      hint.classList.remove('warn', 'danger');
      hint.textContent = hint.dataset.orig || hint.textContent;
    }
    if (lowConf.has(key)) {
      const cls = conf < 0.5 ? 'danger' : 'warn';
      el.classList.add(cls);
      if (hint?.classList.contains('field-hint')) {
        hint.dataset.orig = hint.textContent;
        hint.classList.add(cls);
        hint.textContent = conf < 0.5 ? 'Nízká jistota — zkontrolujte.' : 'Možná chyba — zkontrolujte.';
      }
    }
  });
  updatePreview();
}

// ── Preview ───────────────────────────────────────────────────────
