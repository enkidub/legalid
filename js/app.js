// legalid.cz — js/app.js
// Vygenerováno refaktoringem z původního monolitického index.html.

import { checkSession, closeCenikModal, closeRegistrationModal, closeUpgradeModal, handleLogout, openCenikModal, openRegistrationModal, selectPlan, submitRegEmail } from './auth/auth.js';
import { activeResetPmSettings, cfgUpdateAdvokat, clearAdvokatStorage, closeCfgPanel, closeCfgPanelToMenu, closeFormatPanel, closePrintModal, closeSplitMenu, diagramClick, handleFiles, hideOcrSuccess, onKomboSettingsInput, onPmSettingsInput, onSettingsInput, openCfgPanel, openDolozkaPreview, openSettings, pmDiagramClick, prefillDates, removePhoto, resetSettings, saveAndPrint, saveSettings, selectCustomFormat, selectFormat, switchPmTab, toggleAdvokat, toggleCfgSection, togglePreview, toggleSplitMenu, triggerUpload, updateAdvokat, updatePreview, zmenFormat } from './dolozka/dolozka.js';
import { buildDolozkaPreviewContent, closePostPrintToast, downloadDocx, noveOvereni, printDolozka, printStitky, scalePrintPreview } from './dolozka/generate.js';
import { closeKlientiPanel, klientiDeleteConfirm, klientiDeleteDismiss, klientiDeleteDo, klientiEditCancel, klientiEditSave, klientiEditStart, klientiLoad, openKlientiPanel, renderKlientiList, renderKlientiPage } from './klienti/klienti.js';
import { closeKnihaPanel, getKniha, knihaDeleteConfirm, knihaDeleteDismiss, knihaDeleteDo, knihaEditCancel, knihaEditSave, knihaEditStart, knihaLoad, knihaReprint, openKnihaPanel, renderKnihaList, renderKnihaPage } from './kniha/kniha.js';
import { state } from './core/state.js';
import { initRouter, navigate, currentPath } from './core/router.js';
import { renderLanding } from './landing/landing.js';
import { renderAml } from './aml/aml.js';
import { renderArchiv } from './archiv/archiv.js';
import { actionToastOk, closeAboutModal, closeActionToast, closeHamburger, closePrivacyModal, openAboutModal, openHamburger, openPrivacyModal, showToast } from './core/ui.js';


// ── PWA install prompt ─────────────────────────────────────────────
function dismissInstallBanner() {
  localStorage.setItem('installBannerDismissed', '1');
  document.getElementById('installBanner').classList.remove('visible');
}

(function() {
  if (localStorage.getItem('installBannerDismissed') === '1') return;

  const ua = navigator.userAgent;
  const isIOS = /iPad|iPhone|iPod/.test(ua);
  const isSafari = /Safari/.test(ua) && !/Chrome/.test(ua);

  if (isIOS && isSafari && navigator.standalone !== true) {
    document.getElementById('ib-text').textContent = 'Přidejte legalid na plochu';
    document.getElementById('ib-ios-hint').innerHTML =
      'Klepněte na <svg width="13" height="13" viewBox="0 0 24 24" fill="none"' +
      ' stroke="currentColor" stroke-width="2.2" stroke-linecap="round"' +
      ' stroke-linejoin="round" style="vertical-align:middle;margin:0 1px">' +
      '<path d="M4 15v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4"/>' +
      '<polyline points="16 7 12 3 8 7"/><line x1="12" y1="3" x2="12" y2="16"/></svg>' +
      ' a zvolte \'Přidat na plochu\'';
    document.getElementById('ib-ios-hint').style.display = '';
    document.getElementById('installBanner').classList.add('visible');
    return;
  }

  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault();
    state.deferredInstallPrompt = e;
    document.getElementById('ib-text').textContent = 'Nainstalujte aplikaci legalid';
    document.getElementById('installBtn').style.display = '';
    document.getElementById('installBanner').classList.add('visible');
  });

  document.getElementById('installBtn').addEventListener('click', async () => {
    if (!state.deferredInstallPrompt) return;
    state.deferredInstallPrompt.prompt();
    const { outcome } = await state.deferredInstallPrompt.userChoice;
    state.deferredInstallPrompt = null;
    document.getElementById('installBanner').classList.remove('visible');
  });

  window.addEventListener('appinstalled', () => {
    document.getElementById('installBanner').classList.remove('visible');
  });
})();

// ── Service worker registration ────────────────────────────────────

function applyUpdate() {
  const target = state._waitingSW || navigator.serviceWorker.controller;
  if (target) {
    target.postMessage({ type: 'SKIP_WAITING' });
    navigator.serviceWorker.addEventListener('controllerchange', () => location.reload(), { once: true });
  } else {
    location.reload();
  }
}

if ('serviceWorker' in navigator) {
  window.addEventListener('load', async () => {
    try {
      const reg = await navigator.serviceWorker.register('/sw.js');

      const showBar = (sw) => {
        state._waitingSW = sw;
        document.getElementById('updateBar').classList.add('show');
      };

      // Nový SW právě stahován
      reg.addEventListener('updatefound', () => {
        const newSW = reg.installing;
        newSW.addEventListener('statechange', () => {
          if (newSW.state === 'installed' && navigator.serviceWorker.controller) {
            showBar(newSW);
          }
        });
      });

      // SW čeká od předchozí návštěvy (druhá záložka, obnovení stránky)
      if (reg.waiting && navigator.serviceWorker.controller) {
        showBar(reg.waiting);
      }
    } catch (e) {
      console.warn('SW registration failed:', e);
    }
  });
}

// ── Init ──────────────────────────────────────────────────────────
function init() {
  prefillDates();
  let hasAdvokatData = false;
  try {
    const saved = JSON.parse(localStorage.getItem('legalid_advokat') || 'null');
    if (saved) {
      if (saved.jmeno)       document.getElementById('aJmeno').value = saved.jmeno;
      if (saved.role)        document.getElementById('aRole').value = saved.role;
      if (saved.ev_cislo)    document.getElementById('aEvCislo').value = saved.ev_cislo;
      if (saved.cislo_knihy) document.getElementById('aCisloKnihy').value = saved.cislo_knihy;
      if (saved.sidlo)       document.getElementById('aSidlo').value = saved.sidlo;
      hasAdvokatData = !!(saved.jmeno);
      updateAdvokat();
    }
  } catch {}
  const advokatBody = document.getElementById('advokatBody');
  const advokatArrow = document.getElementById('advokatArrow');
  if (!hasAdvokatData) {
    if (advokatBody) advokatBody.classList.add('open');
    if (advokatArrow) advokatArrow.classList.add('open');
  }
  document.getElementById('fileInput').addEventListener('change', e => handleFiles(e.target.files));
  document.addEventListener('click', (e) => {
    if (!e.target.closest('#splitBtnWrap')) closeSplitMenu();
  });
  document.addEventListener('touchstart', (e) => {
    if (!e.target.closest('#splitBtnWrap')) closeSplitMenu();
  }, { passive: true });
  window.addEventListener('resize', () => {
    if (document.getElementById('printModal')?.classList.contains('open')) scalePrintPreview();
  });
  updatePreview();
  const _lrec = getKniha()[0];
  if (_lrec?.cisloRadku) {
    const _elR = document.getElementById('fCisloRadku');
    if (_elR) { _elR.value = parseInt(_lrec.cisloRadku, 10) + 1; updatePreview(); }
  }
}

// ── Routing ─────────────────────────────────────────────────────────
const KNOWN_VIEWS = ['landing', 'dolozka', 'aml', 'klienti', 'kniha', 'archiv'];

function resolveView(path) {
  let v = (path || '/').replace(/\/+$/, '') || '/';
  if (v === '/') return state.loggedIn ? 'aml' : 'landing';
  v = v.slice(1);
  return KNOWN_VIEWS.includes(v) ? v : (state.loggedIn ? 'aml' : 'landing');
}

function mountRoute(path) {
  const view = resolveView(path);
  const host = document.getElementById('appView');
  const dolozka = document.getElementById('view-dolozka');
  if (!host || !dolozka) return;
  if (view === 'dolozka') {
    host.style.display = 'none';
    host.innerHTML = '';
    dolozka.style.display = '';
  } else {
    dolozka.style.display = 'none';
    if (view === 'landing')      host.innerHTML = renderLanding();
    else if (view === 'aml')     host.innerHTML = renderAml();
    else if (view === 'archiv')  host.innerHTML = renderArchiv();
    else if (view === 'klienti') { host.innerHTML = renderKlientiPage(); renderKlientiList(); }
    else if (view === 'kniha')   { host.innerHTML = renderKnihaPage(); renderKnihaList(); }
    host.style.display = '';
  }
  document.querySelectorAll('.main-nav-item').forEach(b =>
    b.classList.toggle('active', b.dataset.route === view));
  window.scrollTo(0, 0);
}

// Login/logout: přepni viditelnost hlavního menu a přemountuj aktuální route.
window.addEventListener('authchange', () => {
  document.body.classList.toggle('logged-in', state.loggedIn);
  mountRoute(currentPath());
});

// ── Bootstrap ────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', checkSession);

init();
initRouter(mountRoute);

// === Window bridge for inline HTML handlers ===
// Inline onclick/onchange v index.html (a v generovaných šablonách) volá tyto funkce
// v globálním scope. ES moduly mají vlastní scope, proto je tu explicitně zveřejníme.
window.navigate = navigate; // hlavní menu (.main-nav-item) + landing CTA: onclick="navigate('/aml')" apod.
window.dismissInstallBanner = dismissInstallBanner; // <button class="ib-close" onclick="dismissInstallBanner()">×</button>
window.applyUpdate = applyUpdate; // <button class="ub-btn" onclick="applyUpdate()">Obnovit</button>
window.handleLogout = handleLogout; // <button id="headerLogoutBtn" style="display:none;font-size:12px;color:var(--ink-lt);background:n
window.openRegistrationModal = openRegistrationModal; // <button id="headerLoginBtn" style="font-size:12px;font-weight:500;color:var(--navy);background:n
window.openHamburger = openHamburger; // <button class="btn-hamburger" style="margin-left:0" onclick="openHamburger()" aria-label="Nabídk
window.closeHamburger = closeHamburger; // <div class="nav-overlay" id="navOverlay" onclick="closeHamburger()"></div>
window.openKnihaPanel = openKnihaPanel; // <button class="nav-item" onclick="openKnihaPanel()">
window.openKlientiPanel = openKlientiPanel; // <button class="nav-item" onclick="openKlientiPanel()">
window.openCenikModal = openCenikModal; // <button class="nav-item" onclick="closeHamburger();openCenikModal()">
window.openCfgPanel = openCfgPanel; // <button class="nav-item" onclick="openCfgPanel()">
window.openAboutModal = openAboutModal; // <button class="nav-footer-link" onclick="closeHamburger();openAboutModal()">O aplikaci · Verze 1
window.openPrivacyModal = openPrivacyModal; // <button class="nav-footer-link" onclick="closeHamburger();openPrivacyModal()">Ochrana dat</butto
window.closeAboutModal = closeAboutModal; // <div class="about-overlay" id="aboutOverlay" onclick="if(event.target===this)closeAboutModal()">
window.closePrivacyModal = closePrivacyModal; // <div class="privacy-overlay" id="privacyOverlay" onclick="if(event.target===this)closePrivacyMod
window.closeRegistrationModal = closeRegistrationModal; // <div class="reg-overlay" id="regOverlay" onclick="if(event.target===this)closeRegistrationModal(
window.submitRegEmail = submitRegEmail; // <button class="btn-reg-submit" id="regSubmitBtn" onclick="submitRegEmail()">Odeslat</button>
window.closeUpgradeModal = closeUpgradeModal; // <div class="upgrade-overlay" id="upgradeOverlay" onclick="if(event.target===this)closeUpgradeMod
window.selectPlan = selectPlan; // <button class="btn-upgrade-plan" onclick="selectPlan('monthly')">Vybrat měsíční</button>
window.closeCenikModal = closeCenikModal; // <div class="cenik-overlay" id="cenikOverlay" onclick="if(event.target===this)closeCenikModal()">
window.toggleAdvokat = toggleAdvokat; // <div class="preview-toggle" onclick="toggleAdvokat()">
window.updateAdvokat = updateAdvokat; // <input class="form-input" id="aJmeno" type="text" placeholder="JUDr. Jana Nováková" oninput="upd
window.clearAdvokatStorage = clearAdvokatStorage; // <button class="btn-clear-storage" onclick="clearAdvokatStorage()">Vymazat uložené údaje</button>
window.openDolozkaPreview = openDolozkaPreview; // <button class="split-btn-main" onclick="openDolozkaPreview()">
window.toggleSplitMenu = toggleSplitMenu; // <button class="split-btn-arrow" onclick="toggleSplitMenu(event)" aria-label="Více možností" aria
window.downloadDocx = downloadDocx; // <button class="split-drop-item" role="menuitem" onclick="downloadDocx().catch(e=>showToast('Chyb
window.showToast = showToast; // <button class="split-drop-item" role="menuitem" onclick="downloadDocx().catch(e=>showToast('Chyb
window.closeSplitMenu = closeSplitMenu; // <button class="split-drop-item" role="menuitem" onclick="downloadDocx().catch(e=>showToast('Chyb
window.printDolozka = printDolozka; // <button class="split-drop-item" role="menuitem" onclick="printDolozka();closeSplitMenu()">
window.noveOvereni = noveOvereni; // <button class="btn-nove-overeni" onclick="noveOvereni()">Nové ověření →</button>
window.selectFormat = selectFormat; // <button class="format-card" data-format="standard" onclick="selectFormat('standard')" aria-label
window.selectCustomFormat = selectCustomFormat; // <button class="format-card" data-format="custom" onclick="selectCustomFormat()" aria-label="Vlas
window.closeFormatPanel = closeFormatPanel; // <button class="btn-panel-close" onclick="closeFormatPanel()" aria-label="Zavřít panel výběru for
window.triggerUpload = triggerUpload; // <button class="btn-upload" id="btnUpload" onclick="triggerUpload()"><svg width="16" height="16" 
window.hideOcrSuccess = hideOcrSuccess; // <div class="ocr-success" id="ocrSuccess" onclick="hideOcrSuccess()">✓ Údaje vyplněny — zkontrolu
window.openSettings = openSettings; // <button class="btn-stitek-settings" onclick="openSettings()" title="Nastavení etiket">
window.printStitky = printStitky; // <button class="btn-tisk-stitek" onclick="printStitky()" aria-label="Tisknout štítky do knihy">Ti
window.zmenFormat = zmenFormat; // <button class="btn-zmen-format" onclick="zmenFormat()" aria-label="Změnit formát etiket">Změnit 
window.updatePreview = updatePreview; // <input class="form-input" id="fJmeno" type="text" placeholder="Jan Novák" oninput="updatePreview
window.togglePreview = togglePreview; // <div class="preview-toggle" onclick="togglePreview()">
window.closePostPrintToast = closePostPrintToast; // <button class="btn-ppt-close" onclick="closePostPrintToast()" aria-label="Zavřít">×</button>
window.actionToastOk = actionToastOk; // <button class="btn-at-ok" onclick="actionToastOk()">Aktualizovat</button>
window.closeActionToast = closeActionToast; // <button class="btn-at-cancel" onclick="closeActionToast()">Ponechat původní</button>
window.closePrintModal = closePrintModal; // <div class="print-modal-overlay" id="printModalOverlay" onclick="closePrintModal()"></div>
window.switchPmTab = switchPmTab; // <button class="pm-tab active" id="pmTabPreview" onclick="switchPmTab('preview')">Náhled</button>
window.onPmSettingsInput = onPmSettingsInput; // <div class="pm-dim-field"><label class="pm-dim-label" for="pm_X1">X1</label><input class="pm-dim
window.onKomboSettingsInput = onKomboSettingsInput; // <div class="pm-dim-field"><label class="pm-dim-label" for="km_Y">Y</label><input class="pm-dim-i
window.activeResetPmSettings = activeResetPmSettings; // <button class="pm-reset-link" onclick="activeResetPmSettings()">obnovit výchozí hodnoty</button>
window.buildDolozkaPreviewContent = buildDolozkaPreviewContent; // <input class="pm-copies-input" id="pmCopies" type="number" min="1" value="3" oninput="buildDoloz
window.closeCfgPanelToMenu = closeCfgPanelToMenu; // <div class="cfg-overlay" id="cfgOverlay" onclick="closeCfgPanelToMenu()"></div>
window.closeCfgPanel = closeCfgPanel; // <button class="btn-cfg-close" onclick="closeCfgPanel()" aria-label="Zavřít">×</button>
window.toggleCfgSection = toggleCfgSection; // <button class="cfg-section-head" onclick="toggleCfgSection('cfgSec1')">
window.cfgUpdateAdvokat = cfgUpdateAdvokat; // <input class="form-input" id="cfg_aJmeno" type="text" placeholder="JUDr. Jana Nováková" oninput=
window.onSettingsInput = onSettingsInput; // <div class="sp-field"><label class="sp-label" for="sp_H">H — výška</label><input class="sp-input
window.resetSettings = resetSettings; // <button class="btn-sp-reset" onclick="resetSettings()">Obnovit výchozí</button>
window.saveSettings = saveSettings; // <button class="btn-sp-save" onclick="saveSettings()">Uložit</button>
window.saveAndPrint = saveAndPrint; // <button class="btn-sp-print" onclick="saveAndPrint()">Uložit a tisknout</button>
window.closeKnihaPanel = closeKnihaPanel; // <div class="lp-overlay" id="knihaOverlay" onclick="closeKnihaPanel()"></div>
window.closeKlientiPanel = closeKlientiPanel; // <div class="lp-overlay" id="klientiOverlay" onclick="closeKlientiPanel()"></div>
window.renderKlientiList = renderKlientiList; // <input class="lp-search" id="klientiSearch" type="search" placeholder="Hledat jméno, IČO…" oninp
window.removePhoto = removePhoto; // <button class="photo-chip-x" onclick="removePhoto(${i})" title="Odstranit">×</button>
window.pmDiagramClick = pmDiagramClick; // `<rect x="${x}" y="${y}" width="${Math.max(w,4)}" height="${Math.max(h,4)}" fill="transparent" r
window.diagramClick = diagramClick; // return `<rect x="${rx.toFixed(1)}" y="${ry.toFixed(1)}" width="${Math.max(rw,6).toFixed(1)}" hei
window.knihaLoad = knihaLoad; // <button class="btn-lp-action" title="Načíst do formuláře" onclick="knihaLoad(${r.id})">↩</button
window.knihaReprint = knihaReprint; // <button class="btn-lp-action" title="Tisknout" onclick="knihaReprint(${r.id})">&#x1F5A8;</button
window.knihaEditStart = knihaEditStart; // <button class="btn-lp-action" title="Upravit" onclick="knihaEditStart(${r.id})">&#x270E;</button
window.knihaDeleteConfirm = knihaDeleteConfirm; // <button class="btn-lp-action danger" title="Smazat" onclick="knihaDeleteConfirm(${r.id})">&#xD7;
window.knihaEditSave = knihaEditSave; // <button class="btn-lp-save" onclick="knihaEditSave(${r.id})">Uložit</button>
window.knihaEditCancel = knihaEditCancel; // <button class="btn-lp-cancel-edit" onclick="knihaEditCancel(${r.id})">Zrušit</button>
window.knihaDeleteDo = knihaDeleteDo; // <button class="btn-lp-del" onclick="knihaDeleteDo(${r.id})">Smazat</button>
window.knihaDeleteDismiss = knihaDeleteDismiss; // <button class="btn-lp-cancel-edit" onclick="knihaDeleteDismiss(${r.id})">Zrušit</button>
window.klientiLoad = klientiLoad; // <button class="btn-lp-action" title="Načíst do formuláře" onclick="klientiLoad(${k.id})">↩</butt
window.klientiEditStart = klientiEditStart; // <button class="btn-lp-action" title="Upravit" onclick="klientiEditStart(${k.id})">&#x270E;</butt
window.klientiDeleteConfirm = klientiDeleteConfirm; // <button class="btn-lp-action danger" title="Smazat" onclick="klientiDeleteConfirm(${k.id})">&#xD
window.klientiEditSave = klientiEditSave; // <button class="btn-lp-save" onclick="klientiEditSave(${k.id})">Uložit</button>
window.klientiEditCancel = klientiEditCancel; // <button class="btn-lp-cancel-edit" onclick="klientiEditCancel(${k.id})">Zrušit</button>
window.klientiDeleteDo = klientiDeleteDo; // <button class="btn-lp-del" onclick="klientiDeleteDo(${k.id})">Smazat</button>
window.klientiDeleteDismiss = klientiDeleteDismiss; // <button class="btn-lp-cancel-edit" onclick="klientiDeleteDismiss(${k.id})">Zrušit</button>
