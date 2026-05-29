// legalid.cz — js/core/state.js
// Vygenerováno refaktoringem z původního monolitického index.html.

export const CONFIG = { workerUrl: "https://legalid.kuba-houser.workers.dev" };


export const MM = 3.7795;

export const SCALE = 0.6;

export const FORMAT_DEFAULTS = {
  standard: { H: 40, W1: 40, W2: 80, W3: 55, W4: 35, H1: 28, X: 0,  Y: 0,  PX: 3, PY: 2, border: true, lines: true },
  dolozky:  { H: 37, W1: 35, W2: 50, W3: 69, W4: 40, H1: 24, X: 8,  Y: 20, PX: 2, PY: 2, border: true, lines: true },
  custom:   { H: 40, W1: 40, W2: 80, W3: 55, W4: 35, H1: 28, X: 0,  Y: 0,  PX: 3, PY: 2, border: true, lines: true },
};


export const DOLOZKA_DEFAULTS = { horni_cast_mm: 200, dolni_cast_mm: 55, okraj_mm: 15, px_mm: 5, py_mm: 5 };

export const PM_DEFAULTS = { X1: 20, X2: 14, Y1: 8, Y2: 0, W: 78, H: 47, PX: 2, PY: 2, sig_mode: 'sign', cell_border: false, bot_border: false, cut_line: false, combo: false };

export const COMBO_PM_DEFAULTS = { Y: 10, X: 8, XR: 8, PX: 6, PY: 6, MEZ: 4, L: 50, P: 50 };


export function getDolozkaSettings() {
  try {
    const s = JSON.parse(localStorage.getItem('legalid_dolozka_rozmery') || 'null');
    return s ? { ...DOLOZKA_DEFAULTS, ...s } : { ...DOLOZKA_DEFAULTS };
  } catch { return { ...DOLOZKA_DEFAULTS }; }
}


export function getSettings() {
  const fmtKey = localStorage.getItem('legalid_format') || 'standard';
  const defaults = FORMAT_DEFAULTS[fmtKey] || FORMAT_DEFAULTS.standard;
  if (fmtKey === 'custom') {
    try {
      const saved = JSON.parse(localStorage.getItem('legalid_settings') || 'null');
      return saved ? { ...defaults, ...saved } : { ...defaults };
    } catch {}
  }
  return { ...defaults };
}


// ── Sdílený mutable stav (importuj { state } a měň jeho vlastnosti) ──
export const state = {
  loggedIn: false,
  userEmail: '',
  advokat: { jmeno: '', role: '', ev_cislo: '', cislo_knihy: '', sidlo: '' },
  pmDiagramActive: null,
  comboDiagramActive: null,
  uploadedImages: [],
  ocrDone: false,
  gdprShown: false,
  deferredInstallPrompt: null,
  diagramActive: null,
  _waitingSW: null,
  _actionToastOkFn: null,
};
