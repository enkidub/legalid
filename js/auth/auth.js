// legalid.cz — js/auth/auth.js
// Vygenerováno refaktoringem z původního monolitického index.html.

import { apiCheckSession, apiLogout, apiSendMagicLink, apiTrackUsage } from '../core/api.js';
import { state } from '../core/state.js';
import { closeHamburger } from '../core/ui.js';

export function openRegistrationModal() {
  document.getElementById('regFormView').style.display = '';
  document.getElementById('regSuccessView').style.display = 'none';
  const emailEl = document.getElementById('regEmail');
  if (emailEl) emailEl.value = '';
  const btn = document.getElementById('regSubmitBtn');
  if (btn) { btn.disabled = false; btn.textContent = 'Odeslat'; }
  document.getElementById('regEmailError').style.display = 'none';
  document.getElementById('regSendError').style.display = 'none';
  document.getElementById('regOverlay').classList.add('open');
}

export function closeRegistrationModal() {
  document.getElementById('regOverlay').classList.remove('open');
}

export async function submitRegEmail() {
  const emailEl = document.getElementById('regEmail');
  const errorEl = document.getElementById('regEmailError');
  const sendErrEl = document.getElementById('regSendError');
  const btn = document.getElementById('regSubmitBtn');
  const email = (emailEl?.value || '').trim();
  const valid = email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  errorEl.style.display = valid ? 'none' : 'block';
  errorEl.textContent = valid ? '' : 'Zadejte platný email';
  if (!valid) return;
  sendErrEl.style.display = 'none';
  btn.disabled = true;
  btn.textContent = 'Odesílám…';
  try {
    const { ok, data } = await apiSendMagicLink(email);
    if (!ok || !data.ok) throw new Error('failed');
    document.getElementById('regSuccessMsg').textContent =
      `Na ${email} jsme poslali přihlašovací odkaz. Zkontrolujte schránku (i spam), platí 15 minut.`;
    document.getElementById('regFormView').style.display = 'none';
    document.getElementById('regSuccessView').style.display = 'block';
  } catch {
    btn.disabled = false;
    btn.textContent = 'Odeslat';
    sendErrEl.style.display = 'block';
    sendErrEl.textContent = 'Něco se nepovedlo, zkuste to znovu.';
  }
}


export function openCenikModal() {
  document.getElementById('cenikOverlay').classList.add('open');
}

export function closeCenikModal() {
  document.getElementById('cenikOverlay').classList.remove('open');
}

export function selectPlan(type) {
  closeCenikModal();
  closeUpgradeModal();
  // type: 'monthly' | 'annual'
  // TODO: if logged in → fetch('/api/checkout?plan=' + type, { method:'POST', credentials:'include' })
  openRegistrationModal();
}


export function showUpgradeModal(msg, showLogin) {
  document.getElementById('upgradeModalMsg').textContent = msg;
  const proOptions = document.getElementById('upgradeProOptions');
  const loginBtn   = document.getElementById('upgradeLoginBtn');
  if (proOptions) proOptions.style.display = showLogin ? 'none' : '';
  if (loginBtn)   loginBtn.style.display   = showLogin ? '' : 'none';
  document.getElementById('upgradeOverlay').classList.add('open');
}

export function closeUpgradeModal() {
  document.getElementById('upgradeOverlay').classList.remove('open');
}


export async function trackUsage() {
  try {
    const data = await apiTrackUsage();

    if (data.anonymous) {
      const FREE_KEY = 'legalid_free_count';
      const count = parseInt(localStorage.getItem(FREE_KEY) || '0', 10);
      if (count >= 5) {
        showUpgradeModal('Vyčerpali jste 5 doložek zdarma. Zaregistrujte se a získejte 30 dní neomezeně zdarma.', true);
        return false;
      }
      localStorage.setItem(FREE_KEY, count + 1);
      return true;
    }

    if (data.allowed) return true;

    if (data.reason === 'limit') {
      showUpgradeModal('Dosáhli jste limitu 2 doložek tento měsíc. Upgradujte na Pro pro neomezené použití.');
      return false;
    }
    return false;
  } catch {
    return true;
  }
}


export async function checkSession() {
  let loggedIn = false, email = '';
  try {
    const data = await apiCheckSession();
    loggedIn = !!data.loggedIn;
    email = data.email || '';
    const loginBtn   = document.getElementById('headerLoginBtn');
    const emailEl    = document.getElementById('headerUserEmail');
    const logoutBtn  = document.getElementById('headerLogoutBtn');
    const navItem    = document.getElementById('navLoginItem');
    if (data.loggedIn) {
      if (loginBtn)  loginBtn.style.display  = 'none';
      if (emailEl)   { emailEl.textContent = data.email; emailEl.style.display = ''; }
      if (logoutBtn) logoutBtn.style.display = '';
      if (navItem) {
        navItem.querySelector('.nav-item-label').textContent = data.email;
        navItem.querySelector('.nav-item-sub').textContent   = 'Odhlásit se';
        navItem.onclick = () => { closeHamburger(); handleLogout(); };
      }
    } else {
      if (loginBtn)  loginBtn.style.display  = '';
      if (emailEl)   emailEl.style.display   = 'none';
      if (logoutBtn) logoutBtn.style.display = 'none';
      if (navItem) {
        navItem.querySelector('.nav-item-label').textContent = 'Upgradovat na Pro';
        navItem.querySelector('.nav-item-sub').textContent   = 'Vyzkoušet zdarma 30 dní →';
        navItem.onclick = () => { closeHamburger(); openRegistrationModal(); };
      }
    }
  } catch {}
  state.loggedIn = loggedIn;
  state.userEmail = email;
  window.dispatchEvent(new CustomEvent('authchange', { detail: { loggedIn, email } }));
}


export async function handleLogout() {
  try {
    await apiLogout();
  } catch {}
  checkSession();
}
