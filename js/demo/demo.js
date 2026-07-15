// legalid.cz — js/demo/demo.js
// Blok B — „Domluvit ukázku": modal + odeslání na worker POST /api/demo-request.
// Volá se z landing hero i ze sekce „Chcete to vidět naživo?" (onclick="openDemoModal()").

import { apiDemoRequest } from '../core/api.js';

function getUtmSource() {
  try { return new URLSearchParams(location.search).get('utm_source') || ''; } catch { return ''; }
}

export function openDemoModal() {
  document.getElementById('demoFormView').style.display = '';
  document.getElementById('demoSuccessView').style.display = 'none';
  ['demoName', 'demoEmail', 'demoPhone', 'demoMessage'].forEach(id => {
    const el = document.getElementById(id); if (el) el.value = '';
  });
  const err = document.getElementById('demoError'); if (err) err.style.display = 'none';
  const btn = document.getElementById('demoSubmitBtn'); if (btn) { btn.disabled = false; btn.textContent = 'Odeslat žádost'; }
  document.getElementById('demoOverlay').classList.add('open');
}

export function closeDemoModal() {
  document.getElementById('demoOverlay').classList.remove('open');
}

export async function submitDemoRequest() {
  const name = (document.getElementById('demoName').value || '').trim();
  const email = (document.getElementById('demoEmail').value || '').trim();
  const phone = (document.getElementById('demoPhone').value || '').trim();
  const message = (document.getElementById('demoMessage').value || '').trim();
  const err = document.getElementById('demoError');
  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  if (!name || !emailValid) {
    err.textContent = !name ? 'Vyplňte prosím jméno.' : 'Zadejte platný e-mail.';
    err.style.display = 'block';
    return;
  }
  err.style.display = 'none';
  const btn = document.getElementById('demoSubmitBtn');
  btn.disabled = true; btn.textContent = 'Odesílám…';
  try {
    const { ok, status } = await apiDemoRequest({ name, email, phone, message, utm_source: getUtmSource() });
    if (!ok) {
      btn.disabled = false; btn.textContent = 'Odeslat žádost';
      err.textContent = status === 429
        ? 'Příliš mnoho žádostí. Zkuste to prosím za chvíli.'
        : 'Něco se nepovedlo, zkuste to prosím znovu.';
      err.style.display = 'block';
      return;
    }
    document.getElementById('demoFormView').style.display = 'none';
    document.getElementById('demoSuccessView').style.display = 'block';
  } catch {
    btn.disabled = false; btn.textContent = 'Odeslat žádost';
    err.textContent = 'Něco se nepovedlo, zkuste to prosím znovu.';
    err.style.display = 'block';
  }
}

// Exit-intent (Blok B4) — VYPNUTO defaultně (EXIT_INTENT_DEMO=false v landing.js).
// Zapnutí: mouseleave nahoru z viewportu, max 1× (localStorage) → otevře demo modal.
export function initExitIntentDemo(enabled) {
  if (!enabled) return;
  if (localStorage.getItem('demoExitShown') === '1') return;
  const handler = (e) => {
    if (e.clientY <= 0 && !e.relatedTarget) {
      localStorage.setItem('demoExitShown', '1');
      document.removeEventListener('mouseout', handler);
      openDemoModal();
    }
  };
  document.addEventListener('mouseout', handler);
}
