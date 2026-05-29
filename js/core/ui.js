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

export function _closeAllSidePanels() {
  [['cfgPanel','cfgOverlay'],['knihaPanel','knihaOverlay'],['klientiPanel','klientiOverlay']]
    .forEach(([pid, oid]) => {
      const p = document.getElementById(pid);
      const o = document.getElementById(oid);
      if (p) p.classList.remove('open', 'from-menu');
      if (o) o.classList.remove('open');
    });
  const nav = document.getElementById('navPanel');
  if (nav) { nav.classList.remove('sliding-left'); nav.style.transform = ''; nav.style.transition = ''; }
  state.diagramActive = null;
}


export function _openPanelFromMenu(panel, overlay) {
  const nav = document.getElementById('navPanel');
  nav.classList.add('sliding-left');
  panel.classList.add('from-menu');
  overlay.classList.add('open');
  panel.classList.add('open');
}


export function _closePanelToMenu(panel, overlay) {
  const nav = document.getElementById('navPanel');
  panel.classList.remove('from-menu');
  overlay.classList.remove('open');
  panel.classList.remove('open');
  nav.classList.remove('sliding-left');
  nav.style.transition = 'none';
  nav.style.transform = 'translateX(-30%)';
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      nav.style.transition = '';
      nav.style.transform = '';
    });
  });
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
