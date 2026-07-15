// legalid.cz — js/profile/profile.js
// Globální profil povinné osoby (Nastavení). Přihlášený: D1 přes /api/profile.
// Host: localStorage 'legalid_profile'. Doložková extra (role, číslo knihy) vždy lokálně.
// Doložka generuje ze state.advokat, který sem plníme (mapování zachováno).

import { apiGetProfile, apiSaveProfile } from '../core/api.js';
import { state } from '../core/state.js';
import { showToast } from '../core/ui.js';
import { ENTITY_ORDER, ENTITY_LABELS, regLabel, regIsOptional } from '../core/entities.js';

const LS_PROFILE = 'legalid_profile';        // host fallback centrálního profilu
const LS_EXTRA = 'legalid_dolozka_extra';    // role + číslo knihy (doložka)
const LS_OLD = 'legalid_advokat';            // starý doložkový profil (pro migraci C2)

let _profile = null;   // aktuální centrální profil (poslední načtený/uložený)
let _logo = { base64: null, mime: null };
let _loaded = false;

const $ = id => document.getElementById(id);
const val = id => ($(id)?.value || '').trim();

export function getProfile() { return _profile; }

// Mapa centrální profil + extra → state.advokat (doložka čte odsud, generování beze změny).
function syncStateAdvokat(p, extra) {
  state.advokat = {
    jmeno: p?.display_name || '',
    role: extra?.role || '',
    ev_cislo: p?.reg_number || '',
    cislo_knihy: extra?.cislo_knihy || '',
    sidlo: p?.address || '',
  };
}

function readExtra() { try { return JSON.parse(localStorage.getItem(LS_EXTRA) || 'null') || {}; } catch { return {}; } }
function readLocalProfile() { try { return JSON.parse(localStorage.getItem(LS_PROFILE) || 'null'); } catch { return null; } }

// Naplní modul (bez UI) — volá se i mimo panel (např. před generováním doložky).
export async function ensureProfileLoaded() {
  if (_loaded) return _profile;
  let p = null;
  if (state.loggedIn) { try { p = (await apiGetProfile()).profile; } catch {} }
  if (!p) p = readLocalProfile();
  _profile = p || null;
  _logo = { base64: _profile?.logo_base64 || null, mime: _profile?.logo_mime || null };
  syncStateAdvokat(_profile, readExtra());
  _loaded = true;
  return _profile;
}

// Po přihlášení/odhlášení: natáhni profil znovu a propiš do state.advokat + inline doložky.
export async function reloadProfile() {
  _loaded = false;
  await ensureProfileLoaded();
  const a = state.advokat;
  const set = (id, v) => { const el = document.getElementById(id); if (el) el.value = v || ''; };
  set('aJmeno', a.jmeno); set('aRole', a.role); set('aEvCislo', a.ev_cislo);
  set('aCisloKnihy', a.cislo_knihy); set('aSidlo', a.sidlo);
  if (typeof window !== 'undefined' && window.updatePreview) window.updatePreview();
}

// Je profil vyplněn natolik, aby dával smysl v záznamu?
export function profileIsFilled(p = _profile) {
  return !!(p && (p.display_name || '').trim());
}

// ── Nastavení panel ──
const ENTITY_OPTIONS = ['', ...ENTITY_ORDER].map(v =>
  `<option value="${v}">${v ? ENTITY_LABELS[v] : '— vyberte —'}</option>`).join('');

// Vrátí HTML sekce profilu (nahrazuje starou „Profil advokáta").
export function profileSectionHTML() {
  return `
    <p class="cfg-section-desc">Vyplňte jednou — údaje se propisují do AML záznamů a doložek.</p>
    <div id="cfg_profile_banner" class="cfg-profile-banner" style="display:none">
      Vyplňte údaje povinné osoby — budou se propisovat do AML záznamů a doložek.
    </div>
    <div class="form-grid">
      <div class="form-group full">
        <label class="form-label" for="cfg_entity_type">Typ povinné osoby</label>
        <select class="form-input" id="cfg_entity_type" onchange="profileEntityChange()">${ENTITY_OPTIONS}</select>
      </div>
      <div class="form-group full">
        <label class="form-label" for="cfg_display_name">Jméno / název kanceláře *</label>
        <input class="form-input" id="cfg_display_name" type="text" placeholder="JUDr. Jana Nováková">
      </div>
      <div class="form-group">
        <label class="form-label" for="cfg_ico">IČO</label>
        <input class="form-input" id="cfg_ico" type="text" placeholder="12345678">
      </div>
      <div class="form-group" id="cfg_reg_group">
        <label class="form-label" for="cfg_reg_number" id="cfg_reg_label">Registrační číslo</label>
        <input class="form-input" id="cfg_reg_number" type="text" placeholder="12345">
      </div>
      <div class="form-group full">
        <label class="form-label" for="cfg_address">Sídlo</label>
        <input class="form-input" id="cfg_address" type="text" placeholder="Ulice 1, Praha 1, 110 00">
      </div>
      <div class="form-group">
        <label class="form-label" for="cfg_contact_email">Kontaktní e-mail</label>
        <input class="form-input" id="cfg_contact_email" type="email" placeholder="info@kancelar.cz">
      </div>
      <div class="form-group">
        <label class="form-label" for="cfg_contact_phone">Telefon</label>
        <input class="form-input" id="cfg_contact_phone" type="text" placeholder="+420 000 000 000">
      </div>
    </div>

    <div class="cfg-logo-row">
      <div class="cfg-logo-preview" id="cfg_logo_preview"></div>
      <div class="cfg-logo-actions">
        <label class="btn-clear-storage cfg-logo-btn">Nahrát logo<input type="file" id="cfg_logo" accept="image/png,image/jpeg" hidden onchange="profileLogoSelect(event)"></label>
        <button class="btn-clear-storage" id="cfg_logo_remove" style="display:none" onclick="profileLogoRemove()">Odebrat logo</button>
        <div class="cfg-logo-hint">PNG nebo JPEG · zmenší se na 600 px šířky</div>
      </div>
    </div>

    <div class="cfg-dolozka-extra">
      <div class="cfg-subhead">Doložka (jen pro ověřovací doložky)</div>
      <div class="form-grid">
        <div class="form-group">
          <label class="form-label" for="cfg_aRole">Role</label>
          <input class="form-input" id="cfg_aRole" type="text" placeholder="advokátka">
        </div>
        <div class="form-group">
          <label class="form-label" for="cfg_aCisloKnihy">Číslo knihy</label>
          <input class="form-input" id="cfg_aCisloKnihy" type="text" placeholder="012345">
        </div>
      </div>
    </div>

    <div class="cfg-save-row">
      <span class="cfg-save-status" id="cfg_save_status"></span>
      <button class="btn-sp-save" id="cfg_save_btn" onclick="profileSave()">Uložit</button>
    </div>`;
}

// Vloží HTML sekce profilu do cfg panelu a naplní formulář (volá openCfgPanel).
export async function initSettingsPanel() {
  const body = document.getElementById('cfgProfileBody');
  if (!body) return;
  if (!body.dataset.built) { body.innerHTML = profileSectionHTML(); body.dataset.built = '1'; }
  await initProfileForm();
}

// Naplní formulář hodnotami; nabídne migraci ze starého doložkového profilu.
export async function initProfileForm() {
  await ensureProfileLoaded();
  const p = _profile || {};
  const extra = readExtra();
  const set = (id, v) => { const el = $(id); if (el) el.value = v || ''; };
  set('cfg_entity_type', p.entity_type);
  set('cfg_display_name', p.display_name);
  set('cfg_ico', p.ico);
  set('cfg_reg_number', p.reg_number);
  set('cfg_address', p.address);
  set('cfg_contact_email', p.contact_email);
  set('cfg_contact_phone', p.contact_phone);
  set('cfg_aRole', extra.role);
  set('cfg_aCisloKnihy', extra.cislo_knihy);
  _logo = { base64: p.logo_base64 || null, mime: p.logo_mime || null };
  renderLogoPreview();
  profileEntityChange();
  refreshBanner();
  maybeOfferOldMigration();
}

// C2 — pokud existuje starý doložkový profil a nový je prázdný, nabídni převzetí.
function maybeOfferOldMigration() {
  if (profileIsFilled()) return;
  let old = null;
  try { old = JSON.parse(localStorage.getItem(LS_OLD) || 'null'); } catch {}
  if (!old || !(old.jmeno || '').trim()) return;
  if (!confirm(`Nalezli jsme uložený profil z doložek (${old.jmeno}). Převzít údaje do nastavení povinné osoby?`)) return;
  const set = (id, v) => { const el = $(id); if (el) el.value = v || ''; };
  set('cfg_display_name', old.jmeno);
  set('cfg_reg_number', old.ev_cislo);
  set('cfg_address', old.sidlo);
  set('cfg_aRole', old.role);
  set('cfg_aCisloKnihy', old.cislo_knihy);
  if (!$('cfg_entity_type').value) set('cfg_entity_type', 'advokat');
  profileEntityChange();
  showToast('Údaje převzaty — zkontrolujte a uložte.');
}

export function profileEntityChange() {
  const t = val('cfg_entity_type');
  const label = $('cfg_reg_label');
  if (label) label.textContent = regLabel(t) + (regIsOptional(t) ? ' (nepovinné)' : '');
}

export function refreshBanner() {
  const b = $('cfg_profile_banner');
  if (b) b.style.display = profileIsFilled() ? 'none' : '';
}

function renderLogoPreview() {
  const prev = $('cfg_logo_preview');
  const rm = $('cfg_logo_remove');
  if (!prev) return;
  if (_logo.base64) {
    prev.innerHTML = `<img src="data:${_logo.mime};base64,${_logo.base64}" alt="logo">`;
    if (rm) rm.style.display = '';
  } else { prev.innerHTML = '<span class="cfg-logo-empty">bez loga</span>'; if (rm) rm.style.display = 'none'; }
}

export async function profileLogoSelect(ev) {
  const file = ev?.target?.files?.[0];
  if (!file) return;
  try {
    const out = await resizeLogo(file);
    const bytes = Math.floor(out.base64.length * 3 / 4);
    if (bytes > 300 * 1024) { showToast('Logo je i po zmenšení příliš velké (> 300 kB). Zkuste jednodušší obrázek.'); return; }
    _logo = { base64: out.base64, mime: out.mime };
    renderLogoPreview();
  } catch { showToast('Logo se nepodařilo načíst.'); }
  if (ev.target) ev.target.value = '';
}

export function profileLogoRemove() {
  _logo = { base64: null, mime: null };
  renderLogoPreview();
}

function resizeLogo(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const maxW = 600;
        const scale = Math.min(1, maxW / img.width);
        const w = Math.max(1, Math.round(img.width * scale)), h = Math.max(1, Math.round(img.height * scale));
        const c = document.createElement('canvas'); c.width = w; c.height = h;
        c.getContext('2d').drawImage(img, 0, 0, w, h);
        const isPng = file.type === 'image/png';
        const mime = isPng ? 'image/png' : 'image/jpeg';
        const dataUrl = c.toDataURL(mime, isPng ? undefined : 0.85);
        resolve({ base64: dataUrl.split(',')[1], mime });
      };
      img.onerror = reject; img.src = reader.result;
    };
    reader.onerror = reject; reader.readAsDataURL(file);
  });
}

export async function profileSave() {
  const btn = $('cfg_save_btn'); const status = $('cfg_save_status');
  const p = {
    entity_type: val('cfg_entity_type') || null,
    display_name: val('cfg_display_name'),
    ico: val('cfg_ico'),
    reg_number: val('cfg_reg_number'),
    address: val('cfg_address'),
    contact_email: val('cfg_contact_email'),
    contact_phone: val('cfg_contact_phone'),
    logo_base64: _logo.base64,
    logo_mime: _logo.mime,
  };
  const extra = { role: val('cfg_aRole'), cislo_knihy: val('cfg_aCisloKnihy') };
  localStorage.setItem(LS_EXTRA, JSON.stringify(extra));

  if (btn) btn.disabled = true;
  if (status) { status.textContent = 'Ukládám…'; status.className = 'cfg-save-status'; }
  if (state.loggedIn) {
    const r = await apiSaveProfile(p);
    if (!r.ok) {
      if (btn) btn.disabled = false;
      const msg = r.data?.error === 'logo_too_large' ? 'Logo je příliš velké.' : 'Uložení se nezdařilo.';
      if (status) { status.textContent = msg; status.className = 'cfg-save-status is-err'; }
      return;
    }
    _profile = r.data.profile || p;
  } else {
    localStorage.setItem(LS_PROFILE, JSON.stringify(p));
    _profile = p;
  }
  syncStateAdvokat(_profile, extra);
  refreshBanner();
  if (btn) btn.disabled = false;
  if (status) { status.textContent = '✓ Uloženo'; status.className = 'cfg-save-status is-ok'; }
  showToast('Profil uložen.');
}
