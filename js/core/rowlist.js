// legalid.cz — js/core/rowlist.js
// Sdílené komponenty sloupcového seznamu (Archiv i Klienti): jméno-normalizace,
// relativní datum, riziková tečka, jantarový badge, kopírování, „⋯" menu.
import { esc, showToast } from './ui.js';

export const RISK_CS = { nizke: 'Nízké', stredni: 'Střední', vysoke: 'Vysoké' };
export const RISK_RANK = { vysoke: 3, stredni: 2, nizke: 1 };
export const EMPTY_CELL = '<span class="rl-cell-empty">—</span>';

// Jméno nikdy verzálkami: OCR z dokladu často vrací CELÉ VELKÝMI → normální
// kapitalizace u zdroje (ne CSS). „von/de/van" apod. (smíšená velikost) nech být.
export function humanizeName(s) {
  if (!s) return '';
  if (s === s.toUpperCase() && s !== s.toLowerCase()) {
    return s.toLowerCase().replace(/(^|[\s\-'’.])(\p{L})/gu, (m, p, ch) => p + ch.toUpperCase());
  }
  return s;
}

// Diakritika-insensitive normalizace pro hledání.
export function norm(s) { return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''); }

// Relativní datum: dnes / včera, starší absolutně (cs-CZ).
export function fmtDateCs(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d)) return String(iso);
  try { return d.toLocaleDateString('cs-CZ', { day: 'numeric', month: 'numeric', year: 'numeric' }); } catch { return String(iso); }
}
export function relDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d)) return '';
  const startOf = (x) => { const y = new Date(x); y.setHours(0, 0, 0, 0); return y.getTime(); };
  const diff = Math.round((startOf(Date.now()) - startOf(d)) / 86400000);
  if (diff <= 0) return 'dnes';
  if (diff === 1) return 'včera';
  return fmtDateCs(iso);
}
export function dayWord(n) { return n === 1 ? 'den' : (n < 5 ? 'dny' : 'dní'); }

// Riziková tečka (semafor) + text; bez úrovně → „—".
export function riskDotHTML(level) {
  if (!level) return EMPTY_CELL;
  return `<span class="rl-riskdot rl-riskdot-${esc(level)}"><span class="rl-dot"></span>${esc(RISK_CS[level] || level)}</span>`;
}

// Jantarový badge (jediná barva stavové řeči). full = title tooltip.
export function amberBadge(short, full) {
  return `<span class="rl-badge rl-badge-amber"${full ? ` title="${esc(full)}"` : ''}>${esc(short)}</span>`;
}

// Kopírování do schránky + toast.
export function copyToClipboard(text, okMsg = 'Zkopírováno.') {
  if (!text) return;
  const done = () => showToast(okMsg);
  const fallback = () => {
    try {
      const ta = document.createElement('textarea');
      ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove(); done();
    } catch { showToast('Kopírování se nezdařilo.'); }
  };
  try {
    if (navigator.clipboard?.writeText) navigator.clipboard.writeText(text).then(done).catch(fallback);
    else fallback();
  } catch { fallback(); }
}

// Sdílený modal se 2–3 tlačítky. body = bezpečné HTML. Vrací klíč tlačítka | null.
export function choiceModal({ title, body, buttons }) {
  return new Promise(resolve => {
    const ov = document.createElement('div');
    ov.className = 'rl-modal-ov';
    const btnHtml = buttons.map(b => `<button class="aml-btn ${b.cls || ''}" data-k="${b.key}">${esc(b.label)}</button>`).join('');
    ov.innerHTML = `<div class="rl-modal" role="dialog" aria-modal="true">
      <div class="rl-modal-title">${esc(title)}</div>
      <div class="rl-modal-body">${body}</div>
      <div class="rl-modal-actions">${btnHtml}</div>
    </div>`;
    const onKey = (e) => { if (e.key === 'Escape') close(null); };
    function close(k) { ov.remove(); document.removeEventListener('keydown', onKey); resolve(k); }
    ov.addEventListener('click', (e) => {
      if (e.target === ov) return close(null);
      const b = e.target.closest('[data-k]');
      if (b) close(b.dataset.k);
    });
    document.addEventListener('keydown', onKey);
    document.body.appendChild(ov);
    const first = ov.querySelector('[data-k]');
    if (first) first.focus();
  });
}

// ── „⋯" řádkové menu (jedno globální, plovoucí u tlačítka) ──
let _menuEl = null;
export function closeRowMenu() { if (_menuEl) { _menuEl.remove(); _menuEl = null; } }
export function openRowMenu(btn, id, items, onPick) {
  if (_menuEl && _menuEl.dataset.id === String(id)) { closeRowMenu(); return; }
  closeRowMenu();
  const menu = document.createElement('div');
  menu.className = 'rl-menu'; menu.dataset.id = String(id);
  menu.innerHTML = items.map(it => `<button class="rl-menu-item${it.danger ? ' is-danger' : ''}" data-act="${esc(it.act)}">${esc(it.label)}</button>`).join('');
  document.body.appendChild(menu);
  const r = btn.getBoundingClientRect();
  const mw = 200;
  let left = r.right - mw + window.scrollX;
  if (left < 8) left = 8;
  menu.style.top = `${r.bottom + 4 + window.scrollY}px`;
  menu.style.left = `${left}px`;
  _menuEl = menu;
  menu.addEventListener('click', (e) => {
    const it = e.target.closest('[data-act]');
    if (!it) return;
    const act = it.dataset.act;
    closeRowMenu();
    onPick(act, id);
  });
}
// zavření menu při kliku mimo / scrollu / resize (registruje se jednou)
let _menuGlobalBound = false;
export function bindRowMenuGlobalClose() {
  if (_menuGlobalBound) return;
  _menuGlobalBound = true;
  document.addEventListener('click', (e) => {
    if (_menuEl && !e.target.closest('.rl-menu') && !e.target.closest('[data-act="row-menu"]')) closeRowMenu();
  });
  window.addEventListener('resize', closeRowMenu);
  window.addEventListener('scroll', closeRowMenu, true);
}
