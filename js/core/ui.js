// legalid.cz — js/core/ui.js
// Vygenerováno refaktoringem z původního monolitického index.html.

import { state } from './state.js';

export function openHamburger() {
  document.getElementById('navOverlay').classList.add('open');
  document.getElementById('navPanel').classList.add('open');
}

export function closeHamburger() {
  document.getElementById('navOverlay').classList.remove('open');
  document.getElementById('navPanel').classList.remove('open');
}

export function openAboutModal() {
  document.getElementById('aboutOverlay').classList.add('open');
}

export function closeAboutModal() {
  document.getElementById('aboutOverlay').classList.remove('open');
}

export function openPrivacyModal() {
  document.getElementById('privacyOverlay').classList.add('open');
}

export function closePrivacyModal() {
  document.getElementById('privacyOverlay').classList.remove('open');
}

// Zavři případný otevřený side panel (Nastavení) — volá se před otevřením nového.
// (Kniha/Klienti jsou dnes plné stránky, žádné drawer panely už neexistují.)
export function _closeAllSidePanels() {
  const p = document.getElementById('cfgPanel');
  const o = document.getElementById('cfgOverlay');
  if (p) p.classList.remove('open', 'from-menu');
  if (o) o.classList.remove('open');
  state.diagramActive = null;
}


// Otevři panel z hamburger menu. Jediná pravdivá vrstva je otevíraný panel + jeho
// overlay — hamburger se proto ÚPLNĚ zavře. Dřív se nav panel jen "parkoval"
// (sliding-left + skryté děti), takže jeho bílé pozadí prosvítalo nad bottom-sheetem
// na mobilu (= ten bílý blok). 'from-menu' je teď už jen marker pro tlačítko Zpět.
export function _openPanelFromMenu(panel, overlay) {
  closeHamburger();
  overlay.classList.add('open');
  panel.classList.add('open', 'from-menu');
}


// Zpět z panelu do hamburger menu.
export function _closePanelToMenu(panel, overlay) {
  panel.classList.remove('open', 'from-menu');
  overlay.classList.remove('open');
  openHamburger();
}


export function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 3500);
}

// ── HTML ESCAPE ───────────────────────────────────────────────────

export function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ── ACTION TOAST ──────────────────────────────────────────────────



export function showActionToast(msg, okFn) {
  state._actionToastOkFn = okFn;
  document.getElementById('actionToastMsg').textContent = msg;
  document.getElementById('actionToast').classList.add('show');
}


export function actionToastOk() {
  if (state._actionToastOkFn) state._actionToastOkFn();
  closeActionToast();
}


export function closeActionToast() {
  state._actionToastOkFn = null;
  document.getElementById('actionToast').classList.remove('show');
}

// ── AUTO SAVE ─────────────────────────────────────────────────────
