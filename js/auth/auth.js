// legalid.cz — js/auth/auth.js
// Vygenerováno refaktoringem z původního monolitického index.html.

import { apiCheckSession, apiLogout, apiSendMagicLink, apiTrackUsage } from '../core/api.js';
import { state, CONFIG } from '../core/state.js';
import { closeHamburger, showToast } from '../core/ui.js';
import { navigate } from '../core/router.js';

const REDIRECT_KEY = 'postLoginRedirect';

// Login-gate: uloží cílovou routu, kam se má uživatel po přihlášení vrátit.
export function markLoginRedirect() {
  try { sessionStorage.setItem(REDIRECT_KEY, location.pathname + location.search); } catch {}
}
// Po přihlášení: vrátí uloženou cílovou routu (a smaže ji), jinak null.
export function consumeLoginRedirect() {
  if (!state.loggedIn) return null;
  try {
    const t = sessionStorage.getItem(REDIRECT_KEY);
    if (t) { sessionStorage.removeItem(REDIRECT_KEY); return t; }
  } catch {}
  return null;
}

// Přesměruje na worker OAuth start (celostránková navigace, ne fetch — browser musí
// jít na Google). Session je vždy dlouhá (90 dní) — řeší worker.
export function loginWithGoogle() {
  window.location.href = `${CONFIG.workerUrl}/api/auth/google`;
}

// Webová schránka podle domény e-mailu (tlačítko „Otevřít schránku"); null → tlačítko skryj.
function inboxUrlFor(email) {
  const domain = (email.split('@')[1] || '').toLowerCase();
  if (domain === 'gmail.com' || domain === 'googlemail.com') return 'https://mail.google.com';
  if (domain === 'seznam.cz') return 'https://email.seznam.cz';
  if (['outlook.com', 'hotmail.com', 'live.com', 'outlook.cz', 'hotmail.cz'].includes(domain)) return 'https://outlook.live.com';
  return null;
}

export function openRegistrationModal() {
  document.getElementById('regFormView').style.display = '';
  document.getElementById('regSuccessView').style.display = 'none';
  const emailEl = document.getElementById('regEmail');
  if (emailEl) emailEl.value = '';
  const btn = document.getElementById('regSubmitBtn');
  if (btn) { btn.disabled = false; btn.textContent = 'Odeslat odkaz na e-mail'; }
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
      `Odkaz jsme poslali na ${email}. Zkontrolujte schránku (i spam), platí 15 minut.`;
    const inbox = document.getElementById('regOpenInbox');
    const inboxUrl = inboxUrlFor(email);
    if (inbox) {
      if (inboxUrl) { inbox.href = inboxUrl; inbox.style.display = ''; }
      else inbox.style.display = 'none';
    }
    document.getElementById('regFormView').style.display = 'none';
    document.getElementById('regSuccessView').style.display = 'block';
  } catch {
    btn.disabled = false;
    btn.textContent = 'Odeslat odkaz na e-mail';
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
  // Fáze free testování — žádné limity ani upgrade modal, doložka je vždy povolena.
  // Volání pro statistiku ponecháno (nesmí nikdy blokovat).
  try { await apiTrackUsage(); } catch {}
  return true;
}


export async function checkSession() {
  let loggedIn = false, email = '';
  try {
    const data = await apiCheckSession();
    loggedIn = !!data.loggedIn;
    email = data.email || '';
    const loginBtn   = document.getElementById('headerLoginBtn');
    const tryBtn     = document.getElementById('headerTryBtn');
    const emailEl    = document.getElementById('headerUserEmail');
    const logoutBtn  = document.getElementById('headerLogoutBtn');
    const navItem    = document.getElementById('navLoginItem');
    if (data.loggedIn) {
      if (loginBtn)  loginBtn.style.display  = 'none';
      if (tryBtn)    tryBtn.style.display    = 'none';
      if (emailEl)   { emailEl.textContent = data.email; emailEl.style.display = ''; }
      if (logoutBtn) logoutBtn.style.display = '';
      if (navItem) {
        navItem.querySelector('.nav-item-label').textContent = data.email;
        navItem.querySelector('.nav-item-sub').textContent   = 'Odhlásit se';
        navItem.onclick = () => { closeHamburger(); handleLogout(); };
      }
    } else {
      if (loginBtn)  loginBtn.style.display  = '';
      if (tryBtn)    tryBtn.style.display    = '';
      if (emailEl)   emailEl.style.display   = 'none';
      if (logoutBtn) logoutBtn.style.display = 'none';
      if (navItem) {
        navItem.querySelector('.nav-item-label').textContent = 'Vyzkoušet zdarma';
        navItem.querySelector('.nav-item-sub').textContent   = 'Přihlásit se / registrovat →';
        navItem.onclick = () => { closeHamburger(); openRegistrationModal(); };
      }
    }
  } catch {}
  state.loggedIn = loggedIn;
  state.userEmail = email;
  window.dispatchEvent(new CustomEvent('authchange', { detail: { loggedIn, email } }));
}


export async function handleLogout() {
  try { await apiLogout(); } catch {}
  try { sessionStorage.removeItem(REDIRECT_KEY); } catch {}
  await checkSession();
  navigate('/');                     // odhlášení vede VŽDY na landing
  showToast('Byli jste odhlášeni');
}
