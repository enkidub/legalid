// legalid.cz — js/aml/aml.js
// AML kontrola — wizard (týden 2: kostra 0–5 + krok 0 + krok 1 sken dokladu).
// Architektura: žádné inline onclick → jeden delegovaný listener na #amlRoot (data-act).
// Tím odpadá fragilní window-bridge (chybějící bridge byl zdroj minulých ReferenceError).

import { apiAmlCreateCase, apiAmlGetCase, apiAmlPatchCase, apiAmlAddDocument, apiAmlListCases, apiAmlListClients, apiAmlAres, apiAmlGetLookups, apiAmlRunLookup, apiAmlTerminate, apiAmlAnalyzeDocument, apiAmlCheckConsistency, apiAmlRiskSuggest, apiAmlRiskDecision, apiOcr } from '../core/api.js';
import { state } from '../core/state.js';
import { showToast, esc } from '../core/ui.js';
import { openRegistrationModal, markLoginRedirect } from '../auth/auth.js';
import { apiAmlComplete, apiAmlGetDocuments, apiClientsSearch, apiAmlClientMatch } from '../core/api.js';
import { buildTerminationPdf, buildRecordPdf } from './pdf.js';
import { getProfile, ensureProfileLoaded, profileIsFilled } from '../profile/profile.js';

// Wizard: 5 kroků (0-index), zobrazeno jako 1–5. Krátké labely pro mobil (<640px).
const STEP_LABELS = ['Údaje klienta', 'Lustrace', 'Účel obchodu', 'Riziko', 'Záznam'];
const STEP_LABELS_SHORT = ['Údaje', 'Lustrace', 'Účel', 'Riziko', 'Záznam'];

// Kontextová nápověda k aktivnímu kroku (pravý panel ≥1440px). Statické texty.
const CONTEXT_HELP = [
  'Údaje slouží k identifikaci podle § 8. Doklad můžete vyfotit — AI údaje přečte a předvyplní.',
  'Klient se prověří ve veřejných rejstřících a sankčních seznamech. Každá kontrola dostane časové razítko do záznamu.',
  'Popis účelu a zdroje prostředků vyžaduje § 9. Doložené dokumenty AI porovná s deklarací.',
  'AI navrhne rizikový profil — rozhodnutí je vždy na vás a zapíše se do záznamu.',
  'PDF záznam s náležitostmi § 8 a násl., časovými razítky a kryptografickým otiskem.',
];

// Mapování OCR: DB sloupec ← klíč z AML OCR. (RČ/IČO OCR nevrací — jen ve formuláři.)
const FIELD_MAP = [
  ['client_name', 'jmeno'],
  ['client_surname', 'prijmeni'],
  ['client_birth_date', 'datum_narozeni'],
  ['client_birth_place', 'misto_narozeni'],
  ['client_address', 'adresa_trvaleho_pobytu'],
  ['client_doc_type', 'typ_dokladu'],
  ['client_doc_number', 'cislo_dokladu'],
  ['client_doc_issued_at', 'datum_vydani'],
  ['client_doc_valid_until', 'datum_platnosti'],
  ['client_gender', 'pohlavi'],
  ['client_nationality', 'statni_obcanstvi'],
];

// Sloučený formulář kroku Údaje klienta. req = povinné (*).
const DOC_TYPES = [['OP', 'Občanský průkaz'], ['Pas', 'Cestovní pas'], ['ŘP', 'Řidičský průkaz'], ['Jiné', 'Jiné']];
const GENDERS = [['', 'Vyberte…'], ['M', 'Muž'], ['Ž', 'Žena']];
const FORM_FIELDS = [
  { col: 'client_name', label: 'Jméno', req: true },
  { col: 'client_surname', label: 'Příjmení', req: true },
  { col: 'client_name_original', label: 'Jméno a příjmení v originále', ph: 'např. azbuka, arabské písmo…' },
  { col: 'client_birth_date', label: 'Datum narození', req: true, ph: 'DD.MM.RRRR' },
  { col: 'client_doc_type', label: 'Typ dokladu', req: true, type: 'select', opts: DOC_TYPES },
  { col: 'client_doc_number', label: 'Číslo dokladu', req: true },
  { col: 'client_doc_issued_at', label: 'Datum vydání dokladu', ph: 'DD.MM.RRRR' },
  { col: 'client_doc_valid_until', label: 'Datum platnosti dokladu', req: true, ph: 'DD.MM.RRRR' },
  { col: 'client_rc', label: 'Rodné číslo' },
  { col: 'client_address', label: 'Adresa trvalého pobytu' },
  { col: 'client_nationality', label: 'Státní občanství', req: true },
  { col: 'client_gender', label: 'Pohlaví', type: 'select', opts: GENDERS,
    note: 'Pohlaví je povinné, není-li přiděleno rodné číslo (§ 5 odst. 1 písm. a) zák. č. 253/2008 Sb.).' },
  { col: 'client_occupation', label: 'Povolání / zaměstnavatel' },
  { col: 'client_ico', label: 'IČO (podnikající FO)' },
];
// Pohlaví je povinné, jen když není vyplněné rodné číslo (§ 5 odst. 1 písm. a).
function genderRequired() { return !String(wiz.data.client_rc || '').trim(); }
// Rozbor českého rodného čísla → { valid, gender 'M'|'Ž', birthDate 'DD.MM.RRRR', hasChecksum }.
// Ženy: měsíc +50 (51–62), příp. +70 (71–82); muži 01–12 nebo +20 (21–32). 10místné
// rč (od r. 1954) má kontrolní součet dělitelný 11; 9místné starší se checksumem NEvaliduje.
function parseRc(rc) {
  const digits = String(rc || '').replace(/\D/g, '');
  if (!digits) return { empty: true };
  if (digits.length !== 9 && digits.length !== 10) return { valid: false };
  const yy = parseInt(digits.slice(0, 2), 10);
  const mmRaw = parseInt(digits.slice(2, 4), 10);
  const dd = parseInt(digits.slice(4, 6), 10);
  let gender, mm;
  if (mmRaw >= 71 && mmRaw <= 82) { gender = 'Ž'; mm = mmRaw - 70; }
  else if (mmRaw >= 51 && mmRaw <= 62) { gender = 'Ž'; mm = mmRaw - 50; }
  else if (mmRaw >= 21 && mmRaw <= 32) { gender = 'M'; mm = mmRaw - 20; }
  else if (mmRaw >= 1 && mmRaw <= 12) { gender = 'M'; mm = mmRaw; }
  else return { valid: false };
  // Století: 9místné = před 1954; 10místné = 1954+ (starší narození mají 9 číslic).
  const nowY = new Date().getFullYear();
  let year;
  if (digits.length === 10) { year = 2000 + yy; if (year > nowY) year = 1900 + yy; }
  else { year = (yy <= 53) ? 1900 + yy : 1800 + yy; }
  const dt = new Date(year, mm - 1, dd);
  if (dt.getFullYear() !== year || dt.getMonth() !== mm - 1 || dt.getDate() !== dd) return { valid: false };
  let valid = true;
  if (digits.length === 10) {
    valid = (parseInt(digits, 10) % 11 === 0);
    // výjimka pro starší rč (do 1985): zbytek 10 a kontrolní číslice 0
    if (!valid && parseInt(digits.slice(0, 9), 10) % 11 === 10 && digits[9] === '0') valid = true;
  }
  const birthDate = `${String(dd).padStart(2, '0')}.${String(mm).padStart(2, '0')}.${year}`;
  return { valid, gender, birthDate, hasChecksum: digits.length === 10 };
}
function genderFromRc(rc) { const p = parseRc(rc); return (p && p.valid) ? (p.gender || '') : ''; }

// Porovná dvě data (DD.MM.RRRR i D.M.RR) na shodu.
function sameDate(a, b) {
  const norm = (s) => {
    const m = String(s || '').match(/(\d{1,2})\D+(\d{1,2})\D+(\d{2,4})/);
    if (!m) return null;
    let y = +m[3]; if (y < 100) y += (y <= (new Date().getFullYear() % 100)) ? 2000 : 1900;
    return `${+m[1]}.${+m[2]}.${y}`;
  };
  const na = norm(a), nb = norm(b);
  return !!(na && nb && na === nb);
}
function rerenderClientForm() { const fc = document.getElementById('amlClientForm'); if (fc) fc.innerHTML = clientFormHTML(); }

// Po zadání rč: validace (nebloku­jící), předvyplnění data narození + pohlaví
// (editovatelné), kontrola nesouladu s ručně zadaným datem.
function applyRc(root) {
  const p = parseRc(wiz.data.client_rc);
  if (!p || p.empty) { wiz._rcWarning = false; wiz._birthMismatch = false; rerenderClientForm(); return; }
  wiz._rcWarning = !p.valid;
  const patch = {};
  if (p.valid) {
    if (p.gender && wiz.data.client_gender !== p.gender) { wiz.data.client_gender = p.gender; patch.client_gender = p.gender; }
    if (!String(wiz.data.client_birth_date || '').trim()) {
      wiz.data.client_birth_date = p.birthDate; patch.client_birth_date = p.birthDate; wiz._birthMismatch = false;
    } else {
      wiz._birthMismatch = !sameDate(wiz.data.client_birth_date, p.birthDate);
    }
  } else { wiz._birthMismatch = false; }
  if (Object.keys(patch).length) patchCase(patch);
  rerenderClientForm();
}
// Po zadání data narození: přepočítá nesoulad s rč (bez přepisu zadaného data).
function checkRcDateConsistency(root) {
  const p = parseRc(wiz.data.client_rc);
  wiz._birthMismatch = !!(p && p.valid && String(wiz.data.client_birth_date || '').trim() && !sameDate(wiz.data.client_birth_date, p.birthDate));
  rerenderClientForm();
}
const REQUIRED_COLS = FORM_FIELDS.filter(f => f.req).map(f => f.col);

// Cesty získání dat (horní dlaždice). SVG line ikony ve stylu landingu (stroke, bez fill).
// Rozměry i barva přímo v atributech → ikony se zobrazí i bez CSS (odolné vůči staré cachi).
const ICO = 'width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"';
const SVG = {
  camera: `<svg ${ICO}><path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/><circle cx="12" cy="13" r="3"/></svg>`,
  upload: `<svg ${ICO}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M12 18v-6"/><path d="m9 15 3-3 3 3"/></svg>`,
  manual: `<svg ${ICO}><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>`,
  list: `<svg ${ICO}><circle cx="10" cy="7" r="4"/><path d="M10.3 15H7a4 4 0 0 0-4 4v2"/><circle cx="17" cy="17" r="3"/><path d="m21 21-1.9-1.9"/></svg>`,
  close: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>',
  copy: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>',
};
const SOURCES = [
  { id: 'camera', svg: SVG.camera, title: 'Vyfotit doklad' },
  { id: 'upload', svg: SVG.upload, title: 'Nahrát soubor' },
  { id: 'manual', svg: SVG.manual, title: 'Zadat ručně' },
  { id: 'list', svg: SVG.list, title: 'Existující klient' },
];
const LAST_METHOD_KEY = 'legalid_aml_lastMethod';
function loadLastMethod() {
  // Výchozí „Zadat ručně"; jinak poslední použitá z {camera, upload, manual}.
  // „list" (Existující klient) se NIKDY nestává výchozí předvolbou.
  try { const v = localStorage.getItem(LAST_METHOD_KEY); return (v && v !== 'list' && SOURCES.some(s => s.id === v)) ? v : 'manual'; }
  catch { return 'manual'; }
}

// Typ subjektu (segmentový přepínač nad dlaždicemi).
const SUBJECT_TYPES = [['fo', 'Fyzická osoba'], ['fo_podnikatel', 'OSVČ / podnikatel'], ['po', 'Právnická osoba']];
// Role jednající osoby (jen u PO).
const ROLE_OPTIONS = [['', 'Vyberte…'], ['jednatel', 'Jednatel'], ['clen_predstavenstva', 'Člen představenstva'], ['zmocnenec', 'Zmocněnec'], ['jine', 'Jiné']];

// U3 — prohlášení ověřující osoby (osobní setkání). Verze textu se ukládá do JSON kvůli auditu.
const VERIFIER_TEXT_VERSION = 'v1-2026-07';
const VERIFIER_STATEMENT = 'Prohlašuji, že jsem v souladu s § 8 a § 9 zákona č. 253/2008 Sb. provedl/a identifikaci a kontrolu klienta, osobně se s ním setkal/a a ověřil/a jeho totožnost z předloženého průkazu totožnosti porovnáním podoby.';
const VERIFIER_CHECKBOX = 'Potvrzuji totožnost klienta z předložených dokladů a vizuálně jsem ověřil/a shodu podoby s fotografií v dokladu (§ 8 odst. 1).';

// Způsoby potvrzení totožnosti (dolní radia). Jen 'personal' aktivní v MVP.
const METHODS = [
  { id: 'personal', enabled: true, title: 'Osobní setkání' },
  { id: 'remote', enabled: false, title: 'Vzdálené ověření (připravujeme)' },
];

// ── Blok 3 — Účel obchodu (krok index 2) ──
const RELATION_TYPES = [
  ['jednorazovy', 'Jednorázový obchod'],
  ['obchodni_vztah', 'Obchodní vztah (opakované služby, trvalá spolupráce)'],
];
const DEAL_BANDS = [
  ['do_1k', 'do 1 000 €'],
  ['1k_15k', '1 000 – 15 000 €'],
  ['15k_plus', '15 000 € a více'],
];
const PURPOSE_CATEGORIES = [
  ['', 'Vyberte…'],
  ['prevod_nemovitosti', 'Převod nemovitosti'],
  ['uschova', 'Úschova'],
  ['korporatni', 'Korporátní transakce'],
  ['rodinne_dedicke', 'Rodinné a dědické'],
  ['jine', 'Jiné'],
];
const SOURCE_TYPES = [
  ['', 'Vyberte…'],
  ['plat', 'Plat či příjem ze zaměstnání'],
  ['uspory', 'Úspory a investice'],
  ['prodej_nemovitosti', 'Prodej nemovitosti'],
  ['dedictvi', 'Dědictví'],
  ['podnikani', 'Příjem z podnikání'],
  ['penze', 'Penzijní fondy'],
  ['jine', 'Jiné'],
];
// Datové sloupce kroku Účel (persistují se přes patchPurpose, načítají v resume).
const PURPOSE_COLS = ['relation_type', 'deal_value_band', 'deal_countries', 'purpose_category',
  'business_purpose', 'source_of_funds_type', 'source_of_funds'];
const COUNTRIES_CS = ['Česko', 'Slovensko', 'Německo', 'Rakousko', 'Polsko', 'Maďarsko', 'Francie',
  'Itálie', 'Španělsko', 'Nizozemsko', 'Belgie', 'Švýcarsko', 'Spojené království', 'Irsko',
  'Ukrajina', 'Rusko', 'USA', 'Čína', 'Kypr', 'Lucembursko', 'Malta', 'Portugalsko', 'Řecko',
  'Rumunsko', 'Bulharsko', 'Chorvatsko', 'Slovinsko', 'Litva', 'Lotyšsko', 'Estonsko',
  'Spojené arabské emiráty', 'Turecko'];
const MAX_PURPOSE_DOCS = 5;

// ── Blok 4 — Riziko (krok index 3) ──
const RISK_LEVELS = [
  ['nizke', 'Nízké', 'Standardní kontrola, nižší frekvence revizí.'],
  ['stredni', 'Střední', 'Zvýšená pozornost, kratší interval revize.'],
  ['vysoke', 'Vysoké', 'Zesílená kontrola dle § 9a, nejkratší interval revize.'],
];
const IMPACT_VIEW = {
  neutral: { icon: '•', cls: 'neutral' },
  raises: { icon: '▲', cls: 'raises' },
  critical: { icon: '⚠', cls: 'critical' },
};
const PEP_DEFINITION = 'Politicky exponovaná osoba (PEP) je fyzická osoba ve významné veřejné funkci (hlava státu, člen vlády, poslanec, soudce nejvyššího soudu, velvyslanec, člen řídicího orgánu státního podniku apod.), a dále osoby blízké a osoby v úzkém podnikatelském vztahu s PEP (§ 4 odst. 5 zákona č. 253/2008 Sb.).';
const PEP_NOT = 'Klient prohlašuje, že NENÍ PEP, osobou blízkou PEP ani v úzkém podnikatelském vztahu s PEP';
const PEP_IS = 'Klient prohlašuje, že JE PEP nebo osobou blízkou PEP či v úzkém podnikatelském vztahu s PEP';
const SANCTIONS_DECL = 'Klient prohlásil, že není osobou, vůči níž ČR uplatňuje mezinárodní sankce';
const SOURCE_DECL = 'Klient prohlásil pravdivost údajů o zdroji a původu prostředků';
const RISK_DISCLAIMER = 'Návrh rizika má výhradně informativní charakter a slouží jako podpůrný nástroj. Nezbavuje povinnou osobu zákonné odpovědnosti za konečné posouzení klienta dle zákona č. 253/2008 Sb.';

// U4 — důvody ukončení kontroly (radio v modalu).
const TERMINATE_REASONS = [
  ['refused', 'Klient odmítl poskytnout součinnost při identifikaci (§ 15)'],
  ['not_realized', 'Obchod se neuskutečnil'],
  ['other', 'Jiný důvod'],
];

// Pracovní stav wizardu (v paměti, persistuje se přes PATCH na server).
const wiz = {
  caseId: null,
  case_number: null,   // 'AML-YYYYMM-XXXXXX' (číslo kontroly, zobrazeno v hlavičce)
  step: 0,
  source: 'camera',    // krok 0: 'camera' | 'upload' | 'manual' | 'list'
  subject_type: 'fo',  // 'fo' | 'fo_podnikatel' | 'po'
  method: 'personal',  // identification_method
  aresLoading: false, aresStatus: null,   // stav načítání firmy z ARES (PO)
  data: {},            // client_* hodnoty
  frontImg: null, backImg: null,
  frontExtracted: null, backExtracted: null,
  uploadFiles: [],     // source 'upload': [{ dataUrl, media_type, name }] max 3
  ocrLoading: null,    // null | 'front' | 'back' | 'multi'
  camStream: null, camSide: 'front',
  clients: null,       // cache uložených klientů (source 'list')
  clientQuery: '',
  lookups: null,            // pole výsledků lustrací (krok Lustrace), null = ještě neběželo
  lookupStatus: 'idle',     // 'idle' | 'running' | 'loading' | 'done'
  maxStep: 0,               // nejdál dosažený krok (pro klikatelnost indikátoru)
  forceRun: false,          // true = na kroku Lustrace spustit nově (ne načíst uložené)
  verifierConfirmed: false, // U3: checkbox prohlášení ověřující osoby (osobní setkání)
  verifierTimestamp: null,  // čas potvrzení prohlášení (pro záznam)
  terminating: false,       // U4: probíhá ukončení kontroly
  purposeDocs: [],          // Blok 3: podpůrné dokumenty (session paměť, neperzistují se)
  consistency: null,        // Blok 3: výsledek kontroly konzistence
  consistencyLoading: false,
  riskSuggestion: null,     // Blok 4: AI návrh { suggested_level, factors, reasoning_cs }
  riskSuggestLoading: false,
  declaration: { pep: null, sanctions: false, source: false },  // prohlášení klienta
  riskDecision: { level: null, justification: '' },
  riskDecided: false,
  riskDeciding: false,
  generating: false,        // Blok 5: probíhá generování PDF záznamu
  recordSha: null,
  completeResult: null,
};

// Popisky lustrací.
const LOOKUP_LABELS = {
  mvcr: 'Neplatné doklady (MVČR)',
  isir: 'Insolvenční rejstřík (ISIR)',
  ares: 'ARES (podnikatelský subjekt)',
  sanctions: 'Sankční seznamy (EU · OSN · ČR)',
  pep: 'PEP databáze',
  isir_po: 'Insolvenční rejstřík (firma)',
  sanctions_entity: 'Sankční seznamy — firmy (EU · OSN · ČR)',
};
// FO: plochý seznam 5 lustrací. PO: skupiny Společnost / Jednající osoba.
const FO_LOOKUP_TYPES = ['mvcr', 'isir', 'ares', 'sanctions', 'pep'];
const PO_GROUP_COMPANY = ['ares', 'isir_po', 'sanctions_entity'];
const PO_GROUP_PERSON = ['mvcr', 'isir', 'sanctions', 'pep'];
function lookupTypeList() {
  return wiz.subject_type === 'po'
    ? [...PO_GROUP_COMPANY, ...PO_GROUP_PERSON]
    : FO_LOOKUP_TYPES;
}

const $ = (id) => document.getElementById(id);

export function renderAml() {
  return `
<div class="aml-banner-slot" id="amlBanner"></div>
<div class="aml-shell">
  <div class="aml" id="amlRoot">
    <div class="aml-head-row">
      <div class="aml-steps" id="amlSteps"></div>
      <div class="aml-casenum" id="amlCaseNum"></div>
    </div>
    <div class="aml-main" id="amlMain"><div class="aml-loading">Načítám…</div></div>
    <div class="aml-foot" id="amlFoot"></div>
  </div>
  <aside class="aml-context" id="amlContext" aria-label="Kontext kontroly"></aside>
</div>`;
}

// Volá se po mountu /aml (z app.js). Naváže delegaci a rozjede wizard.
let _resizeBound = false;
export function initAml() {
  const root = $('amlRoot');
  if (!root) return;
  bindRoot(root);
  if (!_resizeBound) { _resizeBound = true; window.addEventListener('resize', () => renderSteps()); }
  if (!state.loggedIn) { renderLoginRequired(); return; }
  startAml(root);
}

// ── Delegace událostí ───────────────────────────────────────────────
function bindRoot(root) {
  root.addEventListener('click', (e) => {
    const t = e.target.closest('[data-act]');
    if (!t || !root.contains(t)) return;
    handleAction(root, t.dataset.act, t.dataset);
  });
  // Kontextový panel i banner jsou sourozenci #amlRoot (mimo něj) → vlastní delegace.
  for (const id of ['amlContext', 'amlBanner']) {
    const node = document.getElementById(id);
    if (node) node.addEventListener('click', (e) => {
      const t = e.target.closest('[data-act]');
      if (t) handleAction(root, t.dataset.act, t.dataset);
    });
  }
  root.addEventListener('change', (e) => {
    if (e.target.id === 'amlUploadInput') {
      addUploadFiles(root, e.target.files); e.target.value = ''; return;
    }
    if (e.target.id === 'amlPurposeInput') {
      addPurposeDocs(root, e.target.files); e.target.value = ''; return;
    }
    if (e.target.matches('input[type="file"]')) {   // kamera — jedna strana
      const side = e.target.dataset.side || 'front';
      const f = e.target.files && e.target.files[0];
      if (f) handleFile(root, f, side);
      e.target.value = '';
    }
    if (e.target.matches('input[name="amlMethod"]')) { setMethod(e.target.value); renderStep(root); return; }
    if (e.target.id === 'amlVerifierCheck') { wiz.verifierConfirmed = e.target.checked; clearOwnInvalid(e.target); return; }
    if (e.target.id === 'amlAiReason') { persistAiReason(); return; }   // uloží upravené AI odůvodnění na blur
    // Blok 4 — prohlášení klienta.
    if (e.target.name === 'amlPep') { wiz.declaration.pep = e.target.value; clearOwnInvalid(e.target); runRiskSuggest(root); return; }
    if (e.target.id === 'amlDeclSanctions') { wiz.declaration.sanctions = e.target.checked; clearOwnInvalid(e.target); return; }
    if (e.target.id === 'amlDeclSource') { wiz.declaration.source = e.target.checked; clearOwnInvalid(e.target); return; }
    // select / checkbox / textarea polí formuláře (typ dokladu, role, ESM, pohlaví)
    if (e.target.id && e.target.id.startsWith('aml_f_')) {
      readFieldsFromForm(); clearOwnInvalid(e.target);
      // Uložené jméno klienta (blur s obsahem) = reálný obsah → lazy založení případu.
      if (!wiz.caseId && ['aml_f_client_name', 'aml_f_client_surname', 'aml_f_company_name'].includes(e.target.id) && e.target.value.trim()) ensureCase();
      // Duplicity: po opuštění identifikačního pole prověř evidenci (nenápadná nabídka).
      if (['aml_f_client_name', 'aml_f_client_surname', 'aml_f_client_birth_date', 'aml_f_client_rc', 'aml_f_client_doc_number', 'aml_f_client_ico'].includes(e.target.id)) maybeCheckDuplicate(root);
      // Rodné číslo → validace + předvyplnění data narození a pohlaví (editovatelné).
      if (e.target.id === 'aml_f_client_rc') applyRc(root);
      // Datum narození → přepočet nesouladu s rč.
      else if (e.target.id === 'aml_f_client_birth_date') checkRcDateConsistency(root);
    }
  });
  // Live validace formuláře + průběžné čtení do wiz.data (bez re-renderu → nezahodí fokus).
  root.addEventListener('input', (e) => {
    if (e.target.id && e.target.id.startsWith('aml_f_')) { readFieldsFromForm(); clearOwnInvalid(e.target); }
    if (e.target.id === 'amlClientSearch') { wiz.clientQuery = e.target.value; debouncedClientSearch(root); }
    if (e.target.id === 'amlRiskJust') { wiz.riskDecision.justification = e.target.value; clearOwnInvalid(e.target); }
    // Editace AI odůvodnění — bez re-renderu (drží fokus/kurzor), uloží se na blur.
    if (e.target.id === 'amlAiReason' && wiz.riskSuggestion) {
      wiz.riskSuggestion.reasoning_cs = e.target.value; wiz._aiEdited = true;
      e.target.style.height = 'auto'; e.target.style.height = e.target.scrollHeight + 'px';
    }
  });
  // Drag & drop na dropzóny (source 'upload').
  root.addEventListener('dragover', (e) => {
    const dz = e.target.closest('.aml-dropzone');
    if (dz) { e.preventDefault(); dz.classList.add('aml-dropzone--over'); }
  });
  root.addEventListener('dragleave', (e) => {
    const dz = e.target.closest('.aml-dropzone');
    if (dz) dz.classList.remove('aml-dropzone--over');
  });
  root.addEventListener('drop', (e) => {
    const dz = e.target.closest('.aml-dropzone');
    if (!dz) return;
    e.preventDefault();
    dz.classList.remove('aml-dropzone--over');
    const files = e.dataTransfer?.files;
    if (files && files.length) addUploadFiles(root, files);
  });
}

function handleAction(root, act, ds) {
  switch (act) {
    case 'resume': case 'resume-banner': resumeCase(root, +ds.id); break;
    case 'dismiss-banner': dismissBanner(ds.id); break;
    case 'new': if (!confirmLeaveUndocumented()) break; startFreshWizard(root); break;
    case 'login': openRegistrationModal(); break;
    case 'set-subject': setSubjectType(root, ds.subject); break;
    case 'ares-load': aresLoad(root); break;
    case 'pick-source': pickSource(root, ds.source); break;
    case 'capture': onCapture(root, ds.side); break;
    case 'add-upload': $('amlUploadInput')?.click(); break;
    case 'remove-upload': removeUpload(root, +ds.idx); break;
    case 'remove-side': removeSide(root, ds.side); break;
    case 'restart-step': restartStep(root); break;
    case 'cam-shoot': shootCamera(root); break;
    case 'cam-cancel': closeCamera(); break;
    case 'pick-client': pickClient(root, ds.key); break;
    case 'use-existing-dup': if (wiz._dupMatch) applyExistingClient(root, wiz._dupMatch); break;
    case 'dismiss-dup': dismissDupPanel(); break;
    case 'ai-add-para': addAiParagraph(); break;
    case 'retry-clients': loadClients(root, (wiz.clientQuery || '').trim()); break;
    case 'continue-lustrace': continueToLustrace(root); break;
    case 'next': goNext(root); break;
    case 'back': goBack(root); break;
    case 'goto-step': goToStep(root, +ds.idx); break;
    case 'toggle-detail': toggleLookupDetail(ds.type); break;
    case 'ctx-lookup': openLookupDetail(root, ds.type); break;
    case 'rerun-lookups': wiz.lookupStatus = 'idle'; wiz.lookups = null; wiz.forceRun = true; wiz._ctxLookupsTriedStep = null; renderLustrace(root); break;
    // Retry selhaného zdroje: přeběhne celá lustrace (jediná perzistující cesta →
    // konzistentní záznam), spouští se ale z tlačítka u konkrétního zdroje.
    case 'retry-lookup': wiz.lookupStatus = 'idle'; wiz.lookups = null; wiz.forceRun = true; wiz._ctxLookupsTriedStep = null; renderLustrace(root); break;
    case 'copy-casenum': copyCaseNum(); break;
    case 'open-terminate': openTerminateModal(root); break;
    case 'close-terminate': closeTerminateModal(); break;
    case 'confirm-terminate': confirmTerminate(root); break;
    case 'go-archive': if (!confirmLeaveUndocumented()) break; wiz.caseId = null; wiz._started = false; if (window.navigate) window.navigate('/archiv'); break;
    case 'set-relation': readFieldsFromForm(); wiz.data.relation_type = ds.val; renderPurpose(root); break;
    case 'set-band': readFieldsFromForm(); wiz.data.deal_value_band = ds.val; renderPurpose(root); break;
    case 'add-purpose-doc': $('amlPurposeInput')?.click(); break;
    case 'remove-purpose-doc': removePurposeDoc(root, +ds.idx); break;
    case 'check-consistency': runConsistency(root); break;
    case 'set-risk': wiz.riskDecision.level = ds.val; renderRisk(root); break;
    case 'risk-decide': runRiskDecision(root); break;
    case 'gen-record': runGenerateRecord(root); break;
    case 'open-settings': if (window.openCfgPanel) window.openCfgPanel('advokat'); break;
    default: break;
  }
}

// ── Start / resume / new ─────────────────────────────────────────────
// Prefill z modulu Klienti (sessionStorage, jednorázově) — „Nová AML kontrola".
function readAmlPrefill() {
  try {
    const raw = sessionStorage.getItem('legalid_aml_prefill');
    if (!raw) return null;
    sessionStorage.removeItem('legalid_aml_prefill');
    return JSON.parse(raw);
  } catch { return null; }
}

async function applyClientPrefill(root, c) {
  const map = {
    client_name: c.name, client_surname: c.surname, client_birth_date: c.birth_date,
    client_birth_place: c.birth_place, client_address: c.address, client_nationality: c.nationality,
    client_doc_type: c.doc_type, client_doc_number: c.doc_number, client_rc: c.rc,
    client_ico: c.ico, company_name: c.company_name,
  };
  Object.entries(map).forEach(([col, v]) => { if (v != null && v !== '') wiz.data[col] = v; });
  if (c.subject_type) wiz.subject_type = c.subject_type;
  wiz.source = 'manual';
  const patch = { client_id: c.id, subject_type: wiz.subject_type };
  DATA_COLS.forEach(col => { if (wiz.data[col] != null && wiz.data[col] !== '') patch[col] = wiz.data[col]; });
  patchCase(patch);
  renderStep(root);
}

// „Pokračovat" z archivu → sessionStorage, jednorázově.
function readResumeCaseId() {
  try { const v = sessionStorage.getItem('legalid_aml_resume'); if (v) { sessionStorage.removeItem('legalid_aml_resume'); return +v; } } catch {}
  return null;
}

// Zavření/refresh záložky po kroku 4 bez záznamu → nativní varování prohlížeče (§ 16).
let _leaveGuardBound = false;
function bindLeaveGuard() {
  if (_leaveGuardBound) return;
  _leaveGuardBound = true;
  window.addEventListener('beforeunload', (e) => {
    if (wiz.riskDecided && !wiz.recordSha) { e.preventDefault(); e.returnValue = ''; }
  });
}

async function startAml(root) {
  bindLeaveGuard();
  const resumeId = readResumeCaseId();
  if (resumeId) { await resumeCase(root, resumeId); return; }
  const prefill = readAmlPrefill();
  if (prefill) { startFreshWizard(root); await ensureCase(); await applyClientPrefill(root, prefill); return; }
  if (wiz._started) { renderStep(root); return; }   // wizard běží v této relaci (i in-memory draft bez caseId)
  startFreshWizard(root);            // „AML kontrola" vede vždy rovnou do nové kontroly
  loadResumeBanner(root);            // + tenký banner nad wizardem, existuje-li smysluplný draft
}

// Banner nad wizardem: nabídne pokračování v NEJNOVĚJŠÍ smysluplné rozpracované
// kontrole (má jméno klienta NEBO je za krokem 1). Prázdné skořápky se nezobrazí.
async function loadResumeBanner(root) {
  const el = $('amlBanner'); if (!el) return;
  let cases = [];
  try { const r = await apiAmlListCases(); cases = r.cases || []; } catch { return; }
  const meaningful = cases
    .filter(c => c.status === 'in_progress' && isMeaningfulDraft(c) && !bannerDismissed(c.id))
    .sort((a, b) => b.id - a.id);
  if (!meaningful.length) { el.innerHTML = ''; return; }
  const c = meaningful[0];
  const name = draftName(c);
  const step = (c.current_step || 0) + 1;
  const more = meaningful.length > 1
    ? ` <button class="aml-banner-more" data-act="go-archive">další v Archivu →</button>` : '';
  const decidedNoRecord = isDecidedNoRecord(c);
  const txt = decidedNoRecord
    ? `<b>${esc(c.case_number || '')}</b>: ${esc(name)} — <b>Rozhodnuto — chybí záznam</b> (dokončete krok 5)`
    : `Rozpracovaná kontrola <b>${esc(c.case_number || '')}</b>: ${esc(name)} · krok ${step} z 5`;
  el.innerHTML = `<div class="aml-banner${decidedNoRecord ? ' aml-banner--warn' : ''}">
    <span class="aml-banner-txt">${txt}</span>
    <button class="aml-btn aml-btn-sm aml-btn-primary" data-act="resume-banner" data-id="${c.id}">${decidedNoRecord ? 'Dokončit' : 'Pokračovat'}</button>${more}
    <button class="aml-banner-x" data-act="dismiss-banner" data-id="${c.id}" aria-label="Skrýt">×</button>
  </div>`;
}

// Případ, kde padlo závazné rozhodnutí (krok 4), ale nebyl vygenerován PDF záznam
// (krok 5) — dokud je in_progress a má risk_decided_at. Bez záznamu není kontrola
// doložitelná (§ 16).
function isDecidedNoRecord(c) {
  return c && c.status === 'in_progress' && !!c.risk_decided_at;
}

// Smysluplný draft = má jméno klienta (FO/PO) NEBO je za krokem 1 (Lustrace+).
function isMeaningfulDraft(c) {
  const hasName = !!(c.client_name || c.client_surname || c.company_name);
  return hasName || (c.current_step || 0) >= 1;
}
function draftName(c) {
  if (c.subject_type === 'po') return c.company_name || 'bez názvu';
  const n = [c.client_name, c.client_surname].filter(Boolean).join(' ');
  return n || 'bez jména';
}
function bannerDismissed(id) {
  try { return sessionStorage.getItem('legalid_aml_banner_dismiss_' + id) === '1'; } catch { return false; }
}
function dismissBanner(id) {
  try { sessionStorage.setItem('legalid_aml_banner_dismiss_' + id, '1'); } catch {}
  const el = $('amlBanner'); if (el) el.innerHTML = '';
}

// Reset wizardu do výchozího stavu BEZ založení DB případu. Číslo (case_number)
// i řádek v DB vznikne až při prvním reálném obsahu — viz ensureCase().
function resetWizard() {
  wiz.caseId = null; state.amlCurrentCaseId = null; wiz.case_number = null;
  wiz.step = 0; wiz.source = loadLastMethod(); wiz.method = 'personal'; wiz.data = {};
  wiz.subject_type = 'fo'; wiz.aresStatus = null; wiz.aresLoading = false;
  wiz.frontImg = wiz.backImg = wiz.frontExtracted = wiz.backExtracted = null;
  wiz.uploadFiles = []; wiz.ocrLoading = null; wiz.clients = null; wiz.clientQuery = ''; wiz.clientsError = false;
  wiz.lookups = null; wiz.lookupStatus = 'idle'; wiz.maxStep = 0; wiz.forceRun = false;
  wiz._ctxLookupsTriedStep = null;
  wiz.verifierConfirmed = false; wiz.terminating = false;
  wiz.purposeDocs = []; wiz.consistency = null; wiz.consistencyLoading = false; wiz._consistencyHint = null;
  wiz.riskSuggestion = null; wiz.riskSuggestLoading = false; wiz._aiEdited = false;
  wiz.declaration = { pep: null, sanctions: false, source: false };
  wiz.riskDecision = { level: null, justification: '' };
  wiz.riskDecided = false; wiz.riskDeciding = false;
  wiz.generating = false; wiz.recordSha = null; wiz.completeResult = null; wiz.verifierTimestamp = null;
  wiz._profileTried = false; wiz._clientsLoading = false; wiz._creating = false;
  wiz._dupMatch = null; wiz._dupDismissed = false; wiz._dupDismissedId = null;
  wiz._lastRenderedStep = null; wiz._rcWarning = false; wiz._birthMismatch = false;
  wiz._started = true;
}

function startFreshWizard(root) {
  resetWizard();
  renderStep(root);   // renderClientStep → ensureClientsLoaded načte list, je-li aktivní
}

// Lazy založení DB případu při PRVNÍM reálném obsahu (uložené jméno / doklad / výběr
// klienta / přechod na krok 2). Přidělí case_number a propíše už zadaná data.
async function ensureCase() {
  if (wiz.caseId) return wiz.caseId;
  if (wiz._creating) { for (let i = 0; i < 240 && wiz._creating; i++) await new Promise(r => setTimeout(r, 25)); return wiz.caseId; }
  wiz._creating = true;
  try {
    const r = await apiAmlCreateCase();
    if (!r.case_id) throw new Error(r.error || 'create_failed');
    wiz.caseId = r.case_id; state.amlCurrentCaseId = r.case_id; wiz.case_number = r.case_number || null;
    const patch = {};
    DATA_COLS.forEach(col => { const v = wiz.data[col]; if (v != null && v !== '') patch[col] = v; });
    if (wiz.subject_type && wiz.subject_type !== 'fo') patch.subject_type = wiz.subject_type;
    if (Object.keys(patch).length) { try { await apiAmlPatchCase(wiz.caseId, patch); } catch {} }
    renderCaseNum(); renderContext();   // zobraz přidělené číslo v hlavičce/panelu
  } catch { showToast('Nepodařilo se založit AML případ.'); }
  finally { wiz._creating = false; }
  return wiz.caseId;
}

// Všechny datové sloupce klienta (formulář + místo narození z OCR).
const DATA_COLS = [...FORM_FIELDS.map(f => f.col), 'client_birth_place',
  'company_name', 'company_address', 'acting_person_role', 'acting_person_note', 'esm_checked', 'esm_note',
  ...PURPOSE_COLS];

async function resumeCase(root, id) {
  wiz._started = true;
  const el = $('amlBanner'); if (el) el.innerHTML = '';   // schovej banner při pokračování
  renderLoading('Načítám případ…');
  try {
    const r = await apiAmlGetCase(id);
    const c = r.case;
    if (!c) throw new Error('not_found');
    wiz.caseId = c.id; state.amlCurrentCaseId = c.id;
    wiz.case_number = c.case_number || null;
    wiz.method = c.identification_method || 'personal';
    wiz.subject_type = c.subject_type || 'fo';
    wiz.data = {};
    DATA_COLS.forEach(col => { if (c[col] != null && c[col] !== '') wiz.data[col] = c[col]; });
    try { const vj = c.verifier_declaration_json ? JSON.parse(c.verifier_declaration_json) : null; wiz.verifierConfirmed = !!(vj && vj.confirmed); wiz.verifierTimestamp = vj?.timestamp || null; }
    catch { wiz.verifierConfirmed = false; wiz.verifierTimestamp = null; }
    try { wiz.consistency = c.consistency_json ? JSON.parse(c.consistency_json) : null; } catch { wiz.consistency = null; }
    wiz.purposeDocs = []; wiz.consistencyLoading = false;
    // Blok 4 — návrh rizika, prohlášení, rozhodnutí.
    try {
      const rr = c.ai_risk_reasoning ? JSON.parse(c.ai_risk_reasoning) : null;
      wiz.riskSuggestion = (rr && rr.suggested_level) ? rr
        : (c.ai_risk_suggestion ? { suggested_level: c.ai_risk_suggestion, factors: [], reasoning_cs: '' } : null);
      wiz._aiEdited = !!c.ai_risk_edited;
    } catch { wiz.riskSuggestion = c.ai_risk_suggestion ? { suggested_level: c.ai_risk_suggestion, factors: [], reasoning_cs: '' } : null; }
    try { const dj = c.client_declaration_json ? JSON.parse(c.client_declaration_json) : null; if (dj) wiz.declaration = { pep: dj.pep || null, sanctions: !!dj.sanctions_confirmed, source: !!dj.source_confirmed }; }
    catch { wiz.declaration = { pep: null, sanctions: false, source: false }; }
    wiz.riskDecided = !!c.risk_decided_at;
    wiz.riskDecision = { level: c.final_risk_level || wiz.riskSuggestion?.suggested_level || null, justification: c.risk_justification || '', decided_at: c.risk_decided_at || null };
    wiz.riskSuggestLoading = false; wiz.riskDeciding = false;
    wiz.step = c.current_step || 0;   // DB je již v novém schématu (migrace v4)
    wiz.maxStep = wiz.step; wiz.forceRun = false;
    wiz.source = hasClientData() ? 'manual' : loadLastMethod();   // s daty rovnou ukaž formulář
    wiz.lookups = null; wiz.lookupStatus = 'idle'; wiz._ctxLookupsTriedStep = null;
    wiz.clients = null; wiz.clientQuery = ''; wiz.clientsError = false; wiz._clientsLoading = false;
    renderStep(root);   // renderClientStep → ensureClientsLoaded načte list i po resume (C)
  } catch {
    renderError('Případ se nepodařilo načíst.');
  }
}

function hasClientData() {
  return FORM_FIELDS.some(f => (wiz.data[f.col] || '').trim());
}

// ── Krok Údaje klienta — výběr cesty získání dat ─────────────────────
function pickSource(root, id) {
  if (!SOURCES.some(s => s.id === id)) return;
  wiz.source = id;
  // Pamatuj jen Vyfotit/Nahrát/Zadat ručně — „Existující klient" se nikdy nepředvolí.
  if (id !== 'list') { try { localStorage.setItem(LAST_METHOD_KEY, id); } catch {} }
  renderStep(root);   // renderClientStep → ensureClientsLoaded načte seznam, je-li aktivní
}

// Segmentový přepínač typu subjektu (FO / Podnikající FO / PO).
function setSubjectType(root, id) {
  if (!SUBJECT_TYPES.some(([v]) => v === id)) return;
  readFieldsFromForm();
  wiz.subject_type = id;
  patchCase({ subject_type: id });
  renderStep(root);
}

// Načtení firmy z ARES podle IČO (subject_type='po').
async function aresLoad(root) {
  readFieldsFromForm();
  const ico = (wiz.data.client_ico || '').replace(/\s/g, '');
  if (!/^\d{6,8}$/.test(ico)) { showToast('Zadejte platné IČO (6–8 číslic).'); return; }
  wiz.aresLoading = true; wiz.aresStatus = null; renderStep(root);
  try {
    const s = await apiAmlAres(ico);
    if (s && s.found) {
      if (s.name) wiz.data.company_name = s.name;
      if (s.address) wiz.data.company_address = s.address;
      wiz.aresStatus = { ok: true, active: s.active, text: s.active ? 'Aktivní subjekt' : `Zaniklý subjekt${s.zanik ? ` (${s.zanik})` : ''}` };
    } else {
      wiz.aresStatus = { ok: false, text: 'Subjekt s tímto IČO nebyl v ARES nalezen.' };
    }
  } catch {
    wiz.aresStatus = { ok: false, text: 'ARES nedostupný — vyplňte údaje ručně.' };
  } finally {
    wiz.aresLoading = false; renderStep(root);
  }
}

// ── Navigace ─────────────────────────────────────────────────────────
async function patchCase(fields) {
  if (!wiz.caseId) return;
  try { await apiAmlPatchCase(wiz.caseId, fields); }
  catch { showToast('Nepodařilo se uložit stav.'); }
}

// Kroky 1–4 (Lustrace, Účel, Riziko, Hotovo). Krok 0 vede vlastní tlačítko v kartě.
async function goNext(root) {
  // Krok Riziko (3): bez závazného rozhodnutí nelze dál — toast + zvýraznění sekce.
  if (wiz.step === 3 && !wiz.riskDecided) {
    const sec = root.querySelector('.aml-decision');
    if (sec) { clearInvalid(root); markInvalid(sec, 'Nejprve závazně rozhodněte o riziku.'); scrollToInvalid(sec); }
    showToast('Nejprve závazně rozhodněte o riziku.');
    return;
  }
  // Krok Účel (2): validace povinných polí (zvýraznění + scroll) + uložení.
  if (wiz.step === 2) {
    readFieldsFromForm();
    const missing = validatePurpose(root);
    if (missing.length) { scrollToInvalid(missing[0]); showToast('Doplňte prosím povinná pole (*).'); return; }
    await patchPurpose();
  }
  if (wiz.step >= 1 && wiz.step <= 3) {
    wiz.step += 1;
    wiz.maxStep = Math.max(wiz.maxStep, wiz.step);
    await patchCase({ current_step: wiz.maxStep });
  }
  renderStep(root);
}

// § 16 — po závazném rozhodnutí (krok 4) bez vygenerovaného PDF záznamu (krok 5)
// není kontrola doložitelná. Confirm při odchodu z wizardu. true = pokračovat v odchodu.
function confirmLeaveUndocumented() {
  if (wiz.riskDecided && !wiz.recordSha) {
    return window.confirm('Záznam ještě nebyl vygenerován — bez něj kontrola není doložitelná (§ 16). Opravdu chcete odejít?');
  }
  return true;
}

async function goBack(root) {
  if (wiz.step > 0) {
    wiz.step -= 1;   // pohyb zpět nezmenšuje dosažený pokrok (maxStep drží klikatelnost)
    if (wiz.step === 0) wiz.source = hasClientData() ? 'manual' : loadLastMethod();
  }
  renderStep(root);
}

// Klik na dokončený krok v indikátoru — návrat bez ztráty dat (data se čtou z case).
async function goToStep(root, idx) {
  if (idx === wiz.step || idx > wiz.maxStep) return;
  wiz.step = idx;
  if (idx === 0) wiz.source = hasClientData() ? 'manual' : loadLastMethod();
  if (idx === 1) { wiz.lookupStatus = 'idle'; wiz.forceRun = false; }   // Lustrace → načti uložené
  renderStep(root);
}

// Validace kroku Údaje klienta: zvýrazní chybějící povinná pole/potvrzení a vrátí
// je (seřazené shora dolů). Prázdné pole → vše v pořádku.
function validateStep0(root) {
  clearInvalid(root);
  const missing = [];
  const reqCols = [...REQUIRED_COLS];
  if (wiz.subject_type === 'fo_podnikatel' || wiz.subject_type === 'po') reqCols.push('client_ico');
  if (genderRequired()) reqCols.push('client_gender');
  reqCols.forEach(col => {
    if (String(wiz.data[col] ?? '').trim()) return;
    const field = document.getElementById(`aml_f_${col}`)?.closest('.aml-field');
    if (field) { markInvalid(field, 'Toto pole je povinné.'); missing.push(field); }
  });
  if (wiz.method === 'personal' && !wiz.verifierConfirmed) {
    const v = root.querySelector('.aml-verifier');
    if (v) { markInvalid(v, 'Potvrďte prohlášení ověřující osoby.'); missing.push(v); }
  }
  if (wiz.subject_type === 'po' && !wiz.data.esm_checked) {
    const e = root.querySelector('.aml-esm');
    if (e) { markInvalid(e, 'Ověření skutečných majitelů je povinné.'); missing.push(e); }
  }
  missing.sort(byTop);
  return missing;
}

// Uloží data klienta a přejde na Lustraci (krok 0 → 1). Vždy čerstvý běh lustrace.
async function continueToLustrace(root) {
  readFieldsFromForm();
  const missing = validateStep0(root);
  if (missing.length) { scrollToInvalid(missing[0]); showToast('Doplňte prosím povinná pole (*).'); return; }
  await ensureCase();   // přechod na krok 2 = reálný obsah → založ DB případ (lazy)
  const patch = { current_step: 1, identification_method: wiz.method, subject_type: wiz.subject_type };
  DATA_COLS.forEach(col => { patch[col] = (wiz.data[col] === '' || wiz.data[col] == null) ? null : wiz.data[col]; });
  if (wiz.method === 'personal') {
    const vts = new Date().toISOString();
    wiz.verifierTimestamp = vts;
    patch.verifier_declaration_json = JSON.stringify({
      confirmed: true, text_version: VERIFIER_TEXT_VERSION,
      statement: VERIFIER_STATEMENT, checkbox: VERIFIER_CHECKBOX, timestamp: vts,
    });
  }
  await patchCase(patch);
  wiz.step = 1; wiz.maxStep = Math.max(wiz.maxStep, 1);
  wiz.lookupStatus = 'idle'; wiz.lookups = null; wiz.forceRun = true;   // nová data → čerstvá lustrace
  renderStep(root);
}

function setMethod(id) {
  const m = METHODS.find(x => x.id === id);
  if (m && m.enabled) wiz.method = id;
}

// ── Kamera / soubor / OCR ────────────────────────────────────────────
function onCapture(root, side) {
  wiz.camSide = side || 'front';
  const isMobile = matchMedia('(max-width: 800px)').matches || 'ontouchstart' in window;
  if (isMobile) { $('amlCapture_' + wiz.camSide)?.click(); return; }
  openCamera(root);
}

// Smazání jedné strany kamerového snímku (× na miniatuře) — bez potvrzení (malý zásah).
function removeSide(root, side) {
  if (side === 'back') { wiz.backImg = null; wiz.backExtracted = null; }
  else { wiz.frontImg = null; wiz.frontExtracted = null; }
  renderStep(root);
}

// Reset celého kroku 1 (upload/foto + formulář + způsob ověření). Nemaže aml_case.
function restartStep(root) {
  if (!confirm('Opravdu vymazat všechna data případu?')) return;
  wiz.data = {};
  wiz.frontImg = wiz.backImg = wiz.frontExtracted = wiz.backExtracted = null;
  wiz.uploadFiles = []; wiz.ocrLoading = null; wiz.method = 'personal';
  renderStep(root);
}

function handleFile(root, file, side) {
  const r = new FileReader();
  r.onload = () => handleImageDataUrl(root, r.result, side || 'front');
  r.onerror = () => showToast('Soubor se nepodařilo načíst.');
  r.readAsDataURL(file);
}

const MAX_UPLOAD = 3, MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

// Přidá 1–N souborů do upload zóny (max 3, ≤10 MB, JPG/PNG/PDF) a spustí sloučenou AI extrakci.
async function addUploadFiles(root, fileList) {
  const files = Array.from(fileList || []);
  for (const f of files) {
    if (wiz.uploadFiles.length >= MAX_UPLOAD) { showToast(`Max. ${MAX_UPLOAD} soubory.`); break; }
    const isPdf = f.type === 'application/pdf';
    const isImg = f.type.startsWith('image/');
    if (!isPdf && !isImg) { showToast('Podporujeme jen JPG, PNG a PDF.'); continue; }
    if (f.size > MAX_UPLOAD_BYTES) { showToast(`${f.name}: přesahuje 10 MB.`); continue; }
    const dataUrl = await new Promise((res, rej) => {
      const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(f);
    }).catch(() => null);
    if (!dataUrl) { showToast('Soubor se nepodařilo načíst.'); continue; }
    const small = isPdf ? dataUrl : await downscale(dataUrl);
    wiz.uploadFiles.push({ dataUrl: small, media_type: isPdf ? 'application/pdf' : 'image/jpeg', name: f.name, isPdf });
  }
  renderStep(root);
  if (wiz.uploadFiles.length) runMultiOcr(root);
}

function removeUpload(root, idx) {
  wiz.uploadFiles.splice(idx, 1);   // × maže jeden soubor bez potvrzení (malý zásah)
  renderStep(root);
}

// Pošle všechna nahraná média najednou do /ocr (multi) a sloučí výsledek do formuláře.
async function runMultiOcr(root) {
  wiz.ocrLoading = 'multi'; renderStep(root);
  try {
    const payload = wiz.uploadFiles.map(u => ({ data: u.dataUrl.split(',')[1], media_type: u.media_type }));
    const data = await apiOcr(payload, 'aml', null, true);
    if (data.error) throw new Error(data.message || 'ocr_failed');
    mergeExtracted(data, false);
    for (const u of wiz.uploadFiles) saveDoc('doklad_upload', u.dataUrl, u.isPdf ? null : data);
  } catch {
    showToast('AI rozpoznání selhalo — vyplňte údaje ručně.');
  } finally {
    wiz.ocrLoading = null; renderStep(root);
  }
}

function downscale(dataUrl, maxDim = 1400, quality = 0.82) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
      const cw = Math.round(img.width * scale), ch = Math.round(img.height * scale);
      const c = document.createElement('canvas');
      c.width = cw; c.height = ch;
      c.getContext('2d').drawImage(img, 0, 0, cw, ch);
      resolve(c.toDataURL('image/jpeg', quality));
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
}

async function handleImageDataUrl(root, dataUrl, side) {
  const isBack = side === 'back';
  const small = await downscale(dataUrl);
  if (isBack) wiz.backImg = small; else wiz.frontImg = small;
  wiz.ocrLoading = side; renderStep(root);
  let extracted = null;
  try {
    const base64 = small.split(',')[1];
    const data = await apiOcr([{ data: base64, media_type: 'image/jpeg' }], 'aml', isBack ? 'back' : 'front');
    if (data.error) throw new Error(data.message || 'ocr_failed');
    mergeExtracted(data, isBack);
    extracted = data;
    if (isBack) wiz.backExtracted = data; else wiz.frontExtracted = data;
  } catch {
    showToast('AI rozpoznání selhalo — vyplňte údaje ručně.');
    const failed = { __failed: true };
    if (isBack) wiz.backExtracted = failed; else wiz.frontExtracted = failed;
  } finally {
    wiz.ocrLoading = null; renderStep(root);
  }
  saveDoc(isBack ? 'doklad_back' : 'doklad_front', isBack ? wiz.backImg : wiz.frontImg, extracted);
}

function mergeExtracted(data, isBack) {
  FIELD_MAP.forEach(([col, from]) => {
    const v = data[from];
    if (v == null || v === '') return;
    if (isBack) { if (!wiz.data[col]) wiz.data[col] = v; }   // zadní strana jen doplní chybějící
    else wiz.data[col] = v;
  });
}

// Přečte všechna pole formuláře (osobní + firma + role + ESM) dle id „aml_f_<col>".
function readFieldsFromForm() {
  document.querySelectorAll('#amlMain [id^="aml_f_"]').forEach(el => {
    const col = el.id.slice(6);
    wiz.data[col] = el.type === 'checkbox' ? (el.checked ? 1 : 0) : el.value.trim();
  });
}

// ── Validace UX ──────────────────────────────────────────────────────
// Vzor „aktivní tlačítko + validace po kliku": tlačítka jsou vždy klikatelná
// (disabled jen během probíhající akce/loadingu). Nesplněné podmínky se po
// kliku ukážou zvýrazněním polí + inline hláškou + toastem, nikdy tichým disable.
function markInvalid(el, msg) {
  if (!el) return;
  el.classList.add('aml-invalid');
  if (msg && !el.querySelector(':scope > .aml-inval-msg')) {
    const m = document.createElement('div');
    m.className = 'aml-inval-msg';
    m.textContent = msg;
    el.appendChild(m);
  }
}
function clearInvalid(root) {
  const r = root || document;
  r.querySelectorAll('.aml-invalid').forEach(e => e.classList.remove('aml-invalid'));
  r.querySelectorAll('.aml-inval-msg').forEach(e => e.remove());
}
// Zruší zvýraznění kontejneru editovaného pole, jakmile ho uživatel začne opravovat.
function clearOwnInvalid(inputEl) {
  const c = inputEl && inputEl.closest('.aml-field, .aml-check, .aml-decl-q, .aml-verifier, .aml-esm, .aml-risk-cards, .aml-decision');
  if (c && c.classList.contains('aml-invalid')) {
    c.classList.remove('aml-invalid');
    c.querySelectorAll(':scope > .aml-inval-msg').forEach(m => m.remove());
  }
}
function scrollToInvalid(el) {
  if (!el) return;
  try { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch {}
  const f = el.querySelector('input, select, textarea');
  if (f) setTimeout(() => { try { f.focus({ preventScroll: true }); } catch {} }, 320);
}
function byTop(a, b) { return a.getBoundingClientRect().top - b.getBoundingClientRect().top; }

function formValid() {
  const req = [...REQUIRED_COLS];
  if (wiz.subject_type === 'fo_podnikatel' || wiz.subject_type === 'po') req.push('client_ico');
  if (genderRequired()) req.push('client_gender');
  return req.every(col => String(wiz.data[col] ?? '').trim());
}

// Tlačítko „pokračovat na lustraci" je vždy klikatelné — validace probíhá po kliku
// (viz continueToLustrace). Ponecháno jako no-op kvůli call-sites v bindRoot.
function refreshContinue() { /* no-op: aktivní tlačítko + validace po kliku */ }

async function saveDoc(type, img, extracted) {
  if (!img) return;
  await ensureCase();   // nahraný/vyfocený doklad = reálný obsah → založ DB případ (lazy)
  if (!wiz.caseId) return;
  try {
    await apiAmlAddDocument(wiz.caseId, {
      doc_type: type,
      filename: type + '.jpg',
      content_base64: img.split(',')[1],
      ai_extracted_data: (extracted && !extracted.__failed) ? extracted : null,
    });
  } catch { showToast('Foto se nepodařilo uložit.'); }
}

// ── Ze seznamu (uložení klienti z předchozích případů) ───────────────
// Centrální evidence: hledání klientů přes GET /api/clients?q= (server-side fulltext).
async function loadClients(root, q = '') {
  if (wiz._clientsLoading) return;    // pojistka proti souběžným/opakovaným fetchům
  wiz._clientsLoading = true;
  wiz.clientsError = false;
  wiz.clients = null;                 // loading stav
  if (wiz.step === 0 && wiz.source === 'list') renderClientList();
  const timeout = new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 12000));
  try {
    const r = await Promise.race([apiClientsSearch(q), timeout]);
    wiz.clients = r.clients || [];
  } catch {
    wiz.clients = null;               // ne prázdný seznam — chyba ≠ „nemáte klienty"
    wiz.clientsError = true;
  }
  wiz._clientsLoading = false;
  if (wiz.step === 0 && wiz.source === 'list') renderClientList();
}

// Zajistí načtení seznamu klientů, jakmile je aktivní dlaždice „Existující klient"
// (funguje pro čerstvý případ i resume). Guard brání opakovaným fetchům při re-renderu.
function ensureClientsLoaded(root) {
  if (wiz.source === 'list' && wiz.clients === null && !wiz._clientsLoading && !wiz.clientsError) {
    loadClients(root, (wiz.clientQuery || '').trim());
  }
}

let _clientSearchTimer = null;
function debouncedClientSearch(root) {
  clearTimeout(_clientSearchTimer);
  _clientSearchTimer = setTimeout(() => loadClients(root, wiz.clientQuery.trim()), 250);
}

// Namapuje záznam z clients (D1) na sloupce wiz.data a předvyplní formulář.
// Předvyplní wiz.data z klienta v evidenci a vrátí patch pro case (client_id + pole).
function clientToCasePatch(c) {
  const map = {
    client_name: c.name, client_surname: c.surname, client_birth_date: c.birth_date,
    client_birth_place: c.birth_place, client_address: c.address, client_nationality: c.nationality,
    client_doc_type: c.doc_type, client_doc_number: c.doc_number, client_rc: c.rc,
    client_ico: c.ico, company_name: c.company_name,
  };
  const patch = { client_id: c.id };
  Object.entries(map).forEach(([col, v]) => {
    if (v != null && v !== '') { wiz.data[col] = v; patch[col] = v; }
  });
  if (c.subject_type) { wiz.subject_type = c.subject_type; patch.subject_type = c.subject_type; }
  wiz.data.client_id = c.id;
  return patch;
}

// Naváž případ na klienta z evidence (client_id) + subject_type + ULOŽ client_* pole
// do case (jinak resume ztratí jméno i předvyplnění). Sdíleno s panelem duplicit.
async function applyExistingClient(root, c) {
  const patch = clientToCasePatch(c);
  wiz._dupMatch = null; wiz._dupDismissed = true;   // panel duplicit po výběru zmizí
  renderStep(root);            // okamžitě ukázat předvyplněný formulář
  await ensureCase();          // výběr existujícího klienta = reálný obsah → založ DB případ (lazy)
  patchCase(patch);
}

async function pickClient(root, key) {
  const c = (wiz.clients || []).find(x => String(x.id) === String(key));
  if (!c) return;
  await applyExistingClient(root, c);
}

// ── Duplicity při ručním zadání (krok 1) ─────────────────────────────
const RISK_CS_SHORT = { nizke: 'nízké', stredni: 'střední', vysoke: 'vysoké' };
// Po opuštění pole jméno+datum (nebo rč/č. dokladu/IČO) prověří evidenci a nabídne
// existujícího klienta. NEBLOKUJE — jen nenápadný panel.
async function maybeCheckDuplicate(root) {
  readFieldsFromForm();
  const d = wiz.data;
  const identity = {
    rc: d.client_rc, doc_number: d.client_doc_number, ico: d.client_ico,
    name: d.client_name, surname: d.client_surname, birth_date: d.client_birth_date,
  };
  const enough = identity.rc || identity.doc_number || identity.ico
    || ((identity.name || identity.surname) && identity.birth_date);
  if (!enough) return;
  try {
    const r = await apiAmlClientMatch(identity);
    const m = r && r.client;
    if (!m || (wiz.data.client_id && String(wiz.data.client_id) === String(m.id))) {
      if (wiz._dupMatch) { wiz._dupMatch = null; updateDupPanel(); }
      return;
    }
    wiz._dupMatch = m;
    wiz._dupDismissed = (m.id === wiz._dupDismissedId);   // jednou zavřený stejný klient znovu neotravuje
    updateDupPanel();
  } catch { /* nabídka duplicit je best-effort */ }
}
function dupPanelHTML() {
  const m = wiz._dupMatch;
  if (!m || wiz._dupDismissed) return '';
  const isPo = m.subject_type === 'po';
  const name = isPo ? (m.company_name || 'firma') : [m.name, m.surname].filter(Boolean).join(' ');
  const bd = m.birth_date ? ` (nar. ${fmtDate(m.birth_date)})` : '';
  const parts = [];
  if (m.last_aml_date) parts.push(`poslední kontrola ${fmtDate(m.last_aml_date)}`);
  if (m.last_risk_level) parts.push(`riziko ${RISK_CS_SHORT[m.last_risk_level] || m.last_risk_level}`);
  const meta = parts.length ? ' — ' + parts.join(', ') : '';
  return `<div class="aml-dup">
    <span class="aml-dup-txt">V evidenci už je <b>${esc(name)}</b>${esc(bd)}${esc(meta)}.</span>
    <button class="aml-btn aml-btn-sm aml-btn-primary" data-act="use-existing-dup">Použít existujícího</button>
    <button class="aml-btn aml-btn-sm" data-act="dismiss-dup">Pokračovat s novým</button>
  </div>`;
}
function updateDupPanel() {
  const el = document.getElementById('amlDupPanel');
  if (el) el.innerHTML = dupPanelHTML();
}
function dismissDupPanel() {
  wiz._dupDismissedId = wiz._dupMatch ? wiz._dupMatch.id : null;
  wiz._dupDismissed = true;
  updateDupPanel();
}

// ── Kamera (desktop, getUserMedia) ───────────────────────────────────
function openCamera(root) {
  if (!navigator.mediaDevices?.getUserMedia) {
    showToast('Kamera není dostupná — použijte „Z galerie".');
    return;
  }
  const ov = document.createElement('div');
  ov.className = 'aml-cam'; ov.id = 'amlCam';
  ov.innerHTML = `<div class="aml-cam-box">
    <video id="amlCamVideo" autoplay playsinline muted></video>
    <div class="aml-cam-btns">
      <button class="aml-btn" data-act="cam-cancel">Zrušit</button>
      <button class="aml-btn aml-btn-primary" data-act="cam-shoot">Pořídit snímek</button>
    </div>
  </div>`;
  root.appendChild(ov);
  navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })
    .then(s => { wiz.camStream = s; const v = $('amlCamVideo'); if (v) v.srcObject = s; })
    .catch(() => { showToast('Kameru se nepodařilo otevřít — použijte „Z galerie".'); closeCamera(); });
}

function closeCamera() {
  if (wiz.camStream) { wiz.camStream.getTracks().forEach(t => t.stop()); wiz.camStream = null; }
  $('amlCam')?.remove();
}

function shootCamera(root) {
  const v = $('amlCamVideo');
  if (!v || !v.videoWidth) { showToast('Snímek se nepodařil, zkuste to znovu.'); return; }
  const c = document.createElement('canvas');
  c.width = v.videoWidth; c.height = v.videoHeight;
  c.getContext('2d').drawImage(v, 0, 0);
  const dataUrl = c.toDataURL('image/jpeg', 0.85);
  closeCamera();
  handleImageDataUrl(root, dataUrl);
}

// ── Rendering ────────────────────────────────────────────────────────
function renderLoading(msg) { const m = $('amlMain'); if (m) m.innerHTML = `<div class="aml-loading">${esc(msg)}</div>`; }
function renderError(msg) { const m = $('amlMain'); if (m) m.innerHTML = `<div class="aml-card"><div class="aml-ai-note">${esc(msg)}</div><button class="aml-btn aml-btn-primary" data-act="new">Začít novou kontrolu</button></div>`; }

function renderLoginRequired() {
  markLoginRedirect();
  const steps = $('amlSteps'); if (steps) steps.innerHTML = '';
  const foot = $('amlFoot'); if (foot) foot.innerHTML = '';
  const m = $('amlMain');
  if (m) m.innerHTML = `<div class="aml-card aml-login">
    <div class="aml-h">AML kontrola</div>
    <div class="aml-ai-note">Pro pokračování se přihlaste — data se ukládají k vašemu účtu.</div>
    <button class="aml-btn aml-btn-primary" data-act="login">Přihlásit se / Registrovat</button>
  </div>`;
}

// Relativní čas: „dnes 14:32" / „včera" / „před 3 dny" / jinak datum.
function relTimeCs(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d)) return '';
  const now = new Date();
  if (d.toDateString() === now.toDateString()) {
    try { return `dnes ${d.toLocaleTimeString('cs-CZ', { hour: '2-digit', minute: '2-digit' })}`; } catch { return 'dnes'; }
  }
  const y = new Date(now); y.setDate(now.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return 'včera';
  const days = Math.floor((now - d) / 86400000);
  if (days >= 2 && days <= 4) return `před ${days} dny`;
  if (days >= 5 && days <= 6) return `před ${days} dny`;
  try { return d.toLocaleDateString('cs-CZ', { day: 'numeric', month: 'numeric', year: 'numeric' }); } catch { return ''; }
}

function renderResume(root, c) {
  // Bez step indikátoru (patří až do otevřeného případu) a bez kontextového panelu.
  const steps = $('amlSteps'); if (steps) steps.innerHTML = '';
  const cn = $('amlCaseNum'); if (cn) cn.innerHTML = '';
  const ctx = $('amlContext'); if (ctx) ctx.style.display = 'none';
  const foot = $('amlFoot'); if (foot) foot.innerHTML = '';

  const name = c.subject_type === 'po'
    ? (c.company_name || 'bez názvu')
    : ([c.client_name, c.client_surname].filter(Boolean).join(' ') || 'bez jména');
  const step = c.current_step || 0;
  const stepLabel = STEP_LABELS[step] || '';
  const num = c.case_number || 'bez čísla';
  const edited = relTimeCs(c.created_at);   // aml_cases nemá updated_at → created_at

  $('amlMain').innerHTML = `<div class="aml-resume">
    <div class="aml-card aml-resume-card">
      <div class="aml-h">Rozpracovaná kontrola</div>
      <div class="aml-resume-line"><b>${esc(num)}</b> · ${esc(name)} · krok ${step + 1} z 5 (${esc(stepLabel)})</div>
      ${edited ? `<div class="aml-resume-meta">Naposledy upraveno ${esc(edited)}</div>` : ''}
      <div class="aml-resume-btns">
        <button class="aml-btn aml-btn-primary" data-act="resume" data-id="${c.id}">Pokračovat v rozpracované kontrole</button>
        <button class="aml-btn" data-act="new">Začít novou</button>
      </div>
      <div class="aml-resume-note">Rozpracovaná kontrola zůstane uložená — najdete ji v Archivu.</div>
    </div>
  </div>`;
}

function renderSteps() {
  const wrap = $('amlSteps');
  if (!wrap) return;
  // Jeden label podle šířky (bez CSS toggle → nemůže vzniknout duplicita).
  const short = matchMedia('(max-width: 640px)').matches;
  const labels = short ? STEP_LABELS_SHORT : STEP_LABELS;
  wrap.innerHTML = STEP_LABELS.map((_, i) => {
    const reachable = i <= wiz.maxStep;
    const cls = i === wiz.step ? 'active' : (reachable ? 'done' : 'future');
    const clickable = i !== wiz.step && reachable;   // dokončené/navštívené kroky jsou klikatelné
    const mark = i < wiz.step ? '✓' : String(i + 1);   // zobrazeno 1–5
    const act = clickable ? ` data-act="goto-step" data-idx="${i}" role="button" tabindex="0"` : '';
    return `<div class="aml-step ${cls}${clickable ? ' aml-step--click' : ''}"${act}>` +
      `<span class="aml-step-dot">${mark}</span>` +
      `<span class="aml-step-label">${labels[i]}</span></div>`;
  }).join('');
}

// U1 — hlavička s číslem kontroly + ikona kopírovat (na všech krocích wizardu).
function renderCaseNum() {
  const el = $('amlCaseNum');
  if (!el) return;
  if (!wiz.case_number) { el.innerHTML = ''; return; }
  el.innerHTML = `<span class="aml-cn-label">Kontrola č.</span>
    <span class="aml-cn-val">${esc(wiz.case_number)}</span>
    <button class="aml-cn-copy" data-act="copy-casenum" aria-label="Kopírovat číslo kontroly" title="Kopírovat">${SVG.copy}</button>`;
}

function copyCaseNum() {
  if (!wiz.case_number) return;
  const done = () => showToast('Číslo kontroly zkopírováno.');
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(wiz.case_number).then(done).catch(() => showToast('Kopírování se nezdařilo.'));
  } else {
    try {
      const ta = document.createElement('textarea');
      ta.value = wiz.case_number; document.body.appendChild(ta); ta.select();
      document.execCommand('copy'); ta.remove(); done();
    } catch { showToast('Kopírování se nezdařilo.'); }
  }
}

// Řádek jedné lustrace v panelu — sdílí stavové třídy s kartami kroku 2 (aml-lk-*).
function ctxLookupRow(lk) {
  const v = lookupView(lk);
  const name = LOOKUP_LABELS[lk.lookup_type] || lk.lookup_type;
  let right = '';
  if (lk.status === 'warning') right = lk.match_score ? `možná shoda ${Math.round(lk.match_score * 100)} %` : 'ke kontrole';
  else if (lk.status === 'match') right = 'SHODA';
  else if (lk.status === 'manual') right = 'ověřte ručně';
  else if (lk.status === 'error') right = 'nedokončeno';
  // clean → jen ikona+název (bez textu vpravo, šetří místo)
  const finding = ['match', 'warning', 'manual'].includes(lk.status);
  const attrs = finding ? ` data-act="ctx-lookup" data-type="${lk.lookup_type}" role="button" tabindex="0"` : '';
  return `<div class="aml-ctx-lk aml-lk-${v.cls}${finding ? ' aml-ctx-lk--click' : ''}"${attrs}>
    <span class="aml-lk-ico aml-ctx-lk-ico">${v.icon}</span>
    <span class="aml-ctx-lk-name">${esc(name)}</span>
    ${right ? `<span class="aml-ctx-lk-right">${esc(right)}${sanctionSourceBadge(lk)}</span>` : ''}
  </div>`;
}

// Dotáhne uložené lustrace pro panel (když nejsou v paměti — např. po resume).
// POJISTKA proti smyčce: fetch max JEDNOU na daný krok. Bez toho by prázdná
// odpověď (renderContext → fetch → prázdno → renderContext → fetch …) zacyklila
// hlavní vlákno request stormem = freeze.
async function fetchContextLookups() {
  if (wiz._ctxLookupsLoading || wiz._ctxLookupsTriedStep === wiz.step || !wiz.caseId) return;
  wiz._ctxLookupsLoading = true;
  wiz._ctxLookupsTriedStep = wiz.step;
  try { const r = await apiAmlGetLookups(wiz.caseId); if (r.results?.length) { wiz.lookups = r.results; logLookupErrors(wiz.lookups); } } catch {}
  wiz._ctxLookupsLoading = false;
  renderContext();
}

// Kontextový panel vpravo (jen ≥1440px) — živý stav případu: souhrn, lustrace,
// další zjištění, nápověda ke kroku. Kroky (0-index): 0=Údaje, 1=Lustrace, 2=Účel,
// 3=Riziko, 4=Záznam. Lustrace se ukazuje od kroku Lustrace (index 1) dál.
function renderContext() {
  const el = $('amlContext');
  if (!el) return;
  el.style.display = '';   // zruš případné skrytí z obrazovky Rozpracovaná kontrola
  const subj = SUBJECT_TYPES.find(([v]) => v === wiz.subject_type);
  const clientName = wiz.subject_type === 'po'
    ? (wiz.data.company_name || '')
    : [wiz.data.client_name, wiz.data.client_surname].filter(Boolean).join(' ');
  const rows = [
    wiz.case_number && ['Číslo', wiz.case_number, true],
    subj && ['Typ klienta', subj[1]],
    clientName && ['Klient', clientName],
  ].filter(Boolean).map(([k, v, copy]) => `<div class="aml-ctx-row"><span>${esc(k)}</span>${copy
      ? `<b class="aml-ctx-num"><span>${esc(v)}</span><button class="aml-cn-copy" data-act="copy-casenum" aria-label="Kopírovat číslo kontroly" title="Kopírovat">${SVG.copy}</button></b>`
      : `<b>${esc(v)}</b>`}</div>`).join('');

  // Lustrace: krok 0 (Údaje) → placeholder; od kroku 1 dál → řádky (nálezy nahoře).
  if (wiz.step >= 2 && (!wiz.lookups || !wiz.lookups.length) && !wiz._ctxLookupsLoading) fetchContextLookups();
  let lustraceHTML;
  if (wiz.step < 1) {
    lustraceHTML = `<div class="aml-ctx-empty">Lustrace zatím neproběhla</div>`;
  } else if (!wiz.lookups || !wiz.lookups.length) {
    const loading = wiz._ctxLookupsLoading || wiz.lookupStatus === 'running' || wiz.lookupStatus === 'loading';
    lustraceHTML = `<div class="aml-ctx-empty">${loading ? 'Načítám lustrace…' : 'Lustrace zatím neproběhla'}</div>`;
  } else {
    const RANK = { match: 4, warning: 3, manual: 2, clean: 1, pending: 0, error: 0 };
    const sorted = [...wiz.lookups].sort((a, b) => (RANK[b.status] ?? 0) - (RANK[a.status] ?? 0));
    lustraceHTML = `<div class="aml-ctx-lookups">${sorted.map(ctxLookupRow).join('')}</div>`;
  }

  // Další zjištění: konzistence (od kroku Účel), AI riziko + rozhodnutí (od kroku Riziko).
  const extra = [];
  if (wiz.step >= 2 && wiz.consistency) {
    const cv = CONSISTENCY_VIEW[wiz.consistency.consistency] || { label: wiz.consistency.consistency || '—', cls: 'warn' };
    extra.push(`<div class="aml-ctx-badge aml-lk-${cv.cls}"><span class="aml-ctx-badge-k">Konzistence dokumentů</span><span>${esc(cv.label)}</span></div>`);
  }
  if (wiz.step >= 3 && wiz.riskSuggestion) {
    const sl = wiz.riskSuggestion.suggested_level;
    extra.push(`<div class="aml-ctx-riskrow"><span class="aml-ctx-badge-k">AI návrh</span><span class="aml-risk-badge aml-risk-${esc(sl)}">${esc(lbl(RISK_LEVELS, sl))}</span></div>`);
    if (wiz.riskDecided && wiz.riskDecision.level) {
      const dl = wiz.riskDecision.level;
      extra.push(`<div class="aml-ctx-riskrow"><span class="aml-ctx-badge-k">Rozhodnuto</span><span class="aml-risk-badge aml-risk-${esc(dl)}">${esc(lbl(RISK_LEVELS, dl))}</span></div>`);
    }
  }
  const extraHTML = extra.length
    ? `<div class="aml-ctx-sec"><div class="aml-ctx-sec-title">Další zjištění</div>${extra.join('')}</div>` : '';

  el.innerHTML = `<div class="aml-ctx-card">
      <div class="aml-ctx-title">Souhrn kontroly</div>
      ${rows}
    </div>
    <div class="aml-ctx-sec aml-ctx-sec-lustrace">
      <div class="aml-ctx-sec-title">Lustrace</div>
      ${lustraceHTML}
    </div>
    ${extraHTML}
    <div class="aml-ctx-help">${esc(contextHelp(wiz.step))}</div>`;
}

// Nápověda ke kroku. U kroku Lustrace konkretizuje počet rejstříků podle typu
// klienta: fyzická osoba = 5, právnická osoba = 7.
function contextHelp(step) {
  if (step === 1) {
    const n = wiz.subject_type === 'po' ? 7 : 5;
    return `Klient se prověří v ${n} rejstřících. Každá kontrola dostane časové razítko do záznamu.`;
  }
  return CONTEXT_HELP[step] || '';
}

function renderStep(root) {
  const stepChanged = wiz._lastRenderedStep !== wiz.step;
  renderCaseNum();
  renderSteps();
  renderContext();
  if (wiz.step === 0) renderClientStep(root);
  else if (wiz.step === 1) renderLustrace(root);
  else if (wiz.step === 2) renderPurpose(root);
  else if (wiz.step === 3) renderRisk(root);
  else if (wiz.step === 4) renderRecord(root);
  else renderPlaceholder();
  renderFoot();
  wiz._lastRenderedStep = wiz.step;
  // Přechod na jiný krok → vždy začni na začátku kroku (ne u patičky, kde uživatel
  // klikl Další). Jen při skutečné změně kroku, ať běžné re-rendery nescrollují.
  if (stepChanged) scrollWizardTop();
}
// Scroll na začátek wizardu (okno je scroll kontejner — viz mountRoute).
function scrollWizardTop() {
  try { window.scrollTo({ top: 0, left: 0, behavior: 'auto' }); } catch { try { window.scrollTo(0, 0); } catch {} }
}

// ── Krok 1 (index 0) — Údaje klienta ─────────────────────────────────
function renderClientStep(root) {
  const tiles = SOURCES.map(s => {
    const sel = wiz.source === s.id ? ' aml-tile--selected' : '';
    return `<button class="aml-tile aml-tile-src${sel}" data-act="pick-source" data-source="${s.id}">
      <span class="aml-tile-ico">${s.svg}</span>
      <span class="aml-tile-title">${esc(s.title)}</span>
    </button>`;
  }).join('');

  const showForm = wiz.source === 'manual' || hasClientData()
    || !!wiz.frontImg || !!wiz.backImg || wiz.uploadFiles.length > 0;
  const methods = METHODS.map(m => {
    const checked = wiz.method === m.id ? ' checked' : '';
    const dis = m.enabled ? '' : ' disabled';
    const badge = '';   // „(připravujeme)" je přímo v názvu metody
    return `<label class="aml-radio${m.enabled ? '' : ' aml-radio--disabled'}">
      <input type="radio" name="amlMethod" value="${m.id}"${checked}${dis}>
      <span>${esc(m.title)}${badge}</span>
    </label>`;
  }).join('');

  const isPo = wiz.subject_type === 'po';
  const seg = SUBJECT_TYPES.map(([id, label]) =>
    `<button class="aml-seg${wiz.subject_type === id ? ' aml-seg--on' : ''}" data-act="set-subject" data-subject="${id}">${esc(label)}</button>`
  ).join('');

  const hasAnything = showForm || wiz.uploadFiles.length || !!wiz.frontImg || !!wiz.backImg || isPo;
  const formShown = showForm || isPo;   // u PO jednající osobu ukazuj vždy
  $('amlMain').innerHTML = `<div class="aml-card">
    <div class="aml-h">Údaje klienta</div>
    <div class="aml-sub">Vyplňte údaje klienta a zvolte, jak byla potvrzena jeho totožnost.</div>
    <div class="aml-seg-field">
      <span class="aml-seg-label">Typ klienta</span>
      <div class="aml-seg-wrap">${seg}</div>
    </div>
    ${isPo ? companyBlockHTML() : ''}
    ${isPo ? `<div class="aml-sec-title">Jednající osoba</div>` : ''}
    <div class="aml-tiles aml-tiles-src">${tiles}</div>
    <div class="aml-src-area">${sourceAreaHTML()}</div>
    ${formShown ? `<div class="aml-form-note">Pole označená <span class="aml-req">*</span> jsou povinná.</div>
    <div class="aml-form-wrap" id="amlClientForm">${clientFormHTML()}</div>` : ''}
    <div class="aml-dup-slot" id="amlDupPanel">${dupPanelHTML()}</div>
    ${isPo ? actingRoleHTML() : ''}
    ${isPo ? esmBlockHTML() : ''}
    <div class="aml-method">
      <div class="aml-method-title">Jak byla potvrzena totožnost klienta?</div>
      <div class="aml-radios">${methods}</div>
    </div>
    ${(wiz.method === 'personal' && formShown) ? verifierDeclHTML() : ''}
    <button class="aml-btn aml-btn-primary aml-btn-block" id="amlContinue" data-act="continue-lustrace">
      Pokračovat na lustraci →
    </button>
    ${hasAnything ? `<button class="aml-reset-link" data-act="restart-step">Vymazat vše</button>` : ''}
  </div>`;
  ensureClientsLoaded(root);   // C: list se načte VŽDY při aktivaci (fresh i resume)
}

// U3 — rámeček prohlášení ověřující osoby (jen „Osobní setkání").
function verifierDeclHTML() {
  const checked = wiz.verifierConfirmed ? ' checked' : '';
  return `<div class="aml-verifier">
    <div class="aml-verifier-title">Prohlášení ověřující osoby</div>
    <div class="aml-verifier-text">${esc(VERIFIER_STATEMENT)}</div>
    <label class="aml-check aml-verifier-check"><input type="checkbox" id="amlVerifierCheck"${checked}>
      <span>${esc(VERIFIER_CHECKBOX)}</span></label>
  </div>`;
}

// Lze pokračovat z kroku Údaje klienta? (data úplná + u osobního setkání potvrzené prohlášení)
function canContinueStep0() {
  if (!formValid()) return false;
  if (wiz.method === 'personal' && !wiz.verifierConfirmed) return false;
  return true;
}

// Blok Společnost (PO) — IČO + načtení z ARES + název/sídlo.
function companyBlockHTML() {
  const st = wiz.aresStatus;
  const status = wiz.aresLoading
    ? `<div class="aml-ai-loading"><span class="aml-spinner"></span> Načítám z ARES…</div>`
    : st ? `<div class="aml-ares-status ${st.ok ? (st.active ? 'is-ok' : 'is-warn') : 'is-warn'}">${esc(st.text)}</div>` : '';
  return `<div class="aml-company">
    <div class="aml-sec-title">Společnost</div>
    <div class="aml-company-ico">
      <label class="aml-field"><span>IČO <span class="aml-req">*</span></span>
        <input id="aml_f_client_ico" value="${esc(wiz.data.client_ico || '')}" placeholder="12345678"></label>
      <button class="aml-btn aml-btn-sm" data-act="ares-load">Načíst z ARES</button>
    </div>
    ${status}
    <div class="aml-fields">
      <label class="aml-field"><span>Název společnosti</span><input id="aml_f_company_name" value="${esc(wiz.data.company_name || '')}"></label>
      <label class="aml-field"><span>Sídlo</span><input id="aml_f_company_address" value="${esc(wiz.data.company_address || '')}"></label>
    </div>
  </div>`;
}

// Role jednající osoby + poznámka (PO).
function actingRoleHTML() {
  const opts = ROLE_OPTIONS.map(([v, l]) => `<option value="${esc(v)}"${v === (wiz.data.acting_person_role || '') ? ' selected' : ''}>${esc(l)}</option>`).join('');
  return `<div class="aml-fields">
    <label class="aml-field"><span>Role jednající osoby</span><select id="aml_f_acting_person_role">${opts}</select></label>
    <label class="aml-field"><span>Poznámka (nepovinné)</span><input id="aml_f_acting_person_note" value="${esc(wiz.data.acting_person_note || '')}"></label>
  </div>`;
}

// Skuteční majitelé (ESM) — gate pro pokračování.
function esmBlockHTML() {
  const checked = wiz.data.esm_checked ? ' checked' : '';
  return `<div class="aml-esm">
    <div class="aml-sec-title">Skuteční majitelé (ESM)</div>
    <label class="aml-check"><input type="checkbox" id="aml_f_esm_checked"${checked}>
      <span>Ověřil jsem skutečné majitele v evidenci skutečných majitelů</span></label>
    <a class="aml-lk-link" href="https://esm.justice.cz" target="_blank" rel="noopener">Otevřít evidenci skutečných majitelů ↗</a>
    <label class="aml-field"><span>Poznámka (nepovinné)</span>
      <textarea id="aml_f_esm_note" rows="2">${esc(wiz.data.esm_note || '')}</textarea></label>
  </div>`;
}

// Prostřední část podle zvolené dlaždice.
function sourceAreaHTML() {
  if (wiz.source === 'camera') return cameraSlotsHTML();
  if (wiz.source === 'upload') return uploadZoneHTML();
  if (wiz.source === 'manual') return '';
  if (wiz.source === 'list') return clientListHTML();
  return '';
}

// Kamera — dvoukrokový flow (přední → zadní zvlášť), × na miniatuře.
function cameraSlotsHTML() {
  return `<div class="aml-slots">${['front', 'back'].map(side => {
    const img = side === 'back' ? wiz.backImg : wiz.frontImg;
    const label = side === 'back' ? 'Zadní strana' : 'Přední strana';
    const loading = wiz.ocrLoading === side;
    if (img) {
      return `<div class="aml-slot">
        <div class="aml-slot-label">${label}</div>
        <div class="aml-thumb-wrap">
          <img class="aml-thumb" src="${img}" alt="${label}">
          <button class="aml-thumb-x" data-act="remove-side" data-side="${side}" aria-label="Odstranit">${SVG.close}</button>
        </div>
        ${loading ? `<div class="aml-ai-loading"><span class="aml-spinner"></span> AI rozpoznává…</div>` : ''}
      </div>`;
    }
    return `<div class="aml-slot">
      <div class="aml-slot-label">${label}</div>
      <button class="aml-slot-capture" data-act="capture" data-side="${side}">
        <span class="aml-dz-ico">${SVG.camera}</span><span>Vyfotit ${label.toLowerCase()}</span>
      </button>
      <input type="file" id="amlCapture_${side}" data-side="${side}" accept="image/*" capture="environment" hidden>
    </div>`;
  }).join('')}</div>`;
}

// Nahrát soubor — jedna inteligentní zóna, 1–3 soubory (přední/zadní/další), sloučená AI extrakce.
function uploadZoneHTML() {
  const previews = wiz.uploadFiles.map((u, i) => {
    const thumb = u.isPdf
      ? `<div class="aml-up-pdf"><span>PDF</span><span class="aml-up-name">${esc(u.name)}</span></div>`
      : `<img class="aml-thumb" src="${u.dataUrl}" alt="${esc(u.name)}">`;
    return `<div class="aml-up-item"><div class="aml-thumb-wrap">${thumb}
      <button class="aml-thumb-x" data-act="remove-upload" data-idx="${i}" aria-label="Odstranit">${SVG.close}</button>
    </div></div>`;
  }).join('');
  const zone = wiz.uploadFiles.length < MAX_UPLOAD
    ? `<div class="aml-dropzone" data-act="add-upload">
        <span class="aml-dz-ico">${SVG.upload}</span>
        <span>Přetáhněte foto nebo PDF sem, nebo klikněte pro výběr</span>
        <span class="aml-dz-sub">Podporujeme občanku, pas, řidičský průkaz nebo jiný doklad totožnosti. Můžete nahrát jednu stranu i obě strany najednou (JPG, PNG, PDF).</span>
      </div>
      <input type="file" id="amlUploadInput" accept="image/*,application/pdf" multiple hidden>
      <div class="aml-upload-hint">Občanka, pas nebo řidičák · JPG, PNG, PDF · max 10 MB</div>`
    : '';
  const loading = wiz.ocrLoading === 'multi'
    ? `<div class="aml-ai-loading"><span class="aml-spinner"></span> AI rozpoznává údaje ze všech stran…</div>` : '';
  return `<div class="aml-upload">${previews ? `<div class="aml-up-grid">${previews}</div>` : ''}${zone}${loading}</div>`;
}

// Formulář klienta (společný pro všechny 4 cesty).
// U PO se IČO vynechá (je v bloku Společnost). U podnikající FO je IČO povinné.
function clientFormHTML() {
  const fields = FORM_FIELDS.filter(f => !(f.col === 'client_ico' && wiz.subject_type === 'po'));
  const rcFilled = !genderRequired();   // rč vyplněno → pohlaví se určuje z rč (§ 5)
  return `<div class="aml-fields">` + fields.map(f => {
    // Pohlaví: při zadaném rč předvyplň z rč, ale ponech editovatelné (možnost opravy).
    const val = (f.col === 'client_gender' && rcFilled)
      ? (wiz.data.client_gender || genderFromRc(wiz.data.client_rc) || '')
      : (wiz.data[f.col] || '');
    const req = f.req
      || (f.col === 'client_ico' && wiz.subject_type === 'fo_podnikatel')
      || (f.col === 'client_gender' && genderRequired());
    const star = req ? ' <span class="aml-req">*</span>' : '';
    let input;
    if (f.type === 'select') {
      const opts = f.opts.map(([v, l]) => `<option value="${esc(v)}"${v === val ? ' selected' : ''}>${esc(l)}</option>`).join('');
      input = `<select id="aml_f_${f.col}">${opts}</select>`;
    } else {
      input = `<input id="aml_f_${f.col}" value="${esc(val)}"${f.ph ? ` placeholder="${esc(f.ph)}"` : ''}>`;
    }
    // Inline poznámky / upozornění (nebloku­jící).
    let noteText = f.note, warn = false;
    if (f.col === 'client_rc' && wiz._rcWarning) { noteText = 'Rodné číslo nevypadá platně — zkontrolujte.'; warn = true; }
    else if (f.col === 'client_gender' && rcFilled) { noteText = 'Určeno z rodného čísla (lze upravit).'; }
    else if (f.col === 'client_birth_date' && wiz._birthMismatch) { noteText = 'Datum nesouhlasí s rodným číslem — zkontrolujte.'; warn = true; }
    const note = noteText ? `<span class="aml-field-note${warn ? ' aml-field-note--warn' : ''}">${esc(noteText)}</span>` : '';
    return `<label class="aml-field"><span>${esc(f.label)}${star}</span>${input}${note}</label>`;
  }).join('') + `</div>`;
}

// Seznam uložených klientů (source 'list'). Vyhledávací pole i kontejner #amlClientList
// se renderují VŽDY (i během loadingu) — jinak by renderClientList neměl co aktualizovat.
function clientListHTML() {
  return `<input class="aml-client-search" id="amlClientSearch" placeholder="Hledat jméno, IČO nebo číslo dokladu…" value="${esc(wiz.clientQuery)}">
    <div class="aml-client-list" id="amlClientList">${clientRowsHTML()}</div>`;
}

// Tři stavy: error (retry) → loading (spinner) → data (empty / řádky).
function clientRowsHTML() {
  if (wiz.clientsError) {
    return `<div class="aml-src-state aml-src-state--err">
      <span>Klienty se nepodařilo načíst.</span>
      <button class="aml-btn aml-btn-sm" data-act="retry-clients">Zkusit znovu</button>
    </div>`;
  }
  if (wiz.clients === null) return `<div class="aml-src-hint"><span class="aml-spinner"></span> Načítám klienty…</div>`;
  const list = wiz.clients || [];
  if (!list.length) return `<div class="aml-src-hint">${wiz.clientQuery ? 'Nic nenalezeno.' : 'Zatím nemáte žádné uložené klienty. Použijte jinou cestu (Vyfotit / Nahrát / Zadat ručně).'}</div>`;
  return list.map(c => {
    const name = c.subject_type === 'po'
      ? (c.company_name || 'firma bez názvu')
      : ([c.name, c.surname].filter(Boolean).join(' ') || 'bez jména');
    const meta = [
      c.birth_date && `nar. ${esc(c.birth_date)}`,
      c.ico && `IČO ${esc(c.ico)}`,
      c.doc_number && `doklad ${esc(c.doc_number)}`,
    ].filter(Boolean).join(' · ');
    const aml = c.last_aml_date
      ? `<span class="aml-client-status">Poslední kontrola ${esc(fmtDateOnly(c.last_aml_date))}` +
        `${c.last_risk_level ? ' · ' + esc(lbl(RISK_LEVELS, c.last_risk_level)) + ' riziko' : ''}` +
        `${c.next_review_due ? ' · revalidace do ' + esc(fmtDateOnly(c.next_review_due)) : ''}</span>`
      : `<span class="aml-client-status aml-client-status--none">AML kontrola zatím neproběhla</span>`;
    return `<button class="aml-client-row" data-act="pick-client" data-key="${esc(String(c.id))}">
      <span class="aml-client-name">${esc(name)}</span>
      <span class="aml-client-meta">${meta}</span>
      ${aml}
    </button>`;
  }).join('');
}

// Re-render jen seznamu (při psaní do vyhledávání) — nezahodí fokus inputu.
function renderClientList() {
  const el = $('amlClientList');
  if (el) el.innerHTML = clientRowsHTML();
}

function renderPlaceholder() {
  $('amlMain').innerHTML = `<div class="aml-card aml-placeholder">
    <div class="aml-h">${wiz.step + 1} — ${esc(STEP_LABELS[wiz.step] || '')}</div>
    <div class="aml-ai-note">Tento krok bude doplněn v dalších týdnech vývoje.</div>
  </div>`;
}

// ── Krok 3 (index 2) — Účel obchodu ──────────────────────────────────
const DOC_TYPE_LABELS = {
  kupni_smlouva: 'Kupní smlouva', vypis_uctu: 'Výpis z účtu', darovaci_smlouva: 'Darovací smlouva',
  potvrzeni: 'Potvrzení', danove_priznani: 'Daňové přiznání', jine: 'Jiný dokument',
};
const CONSISTENCY_VIEW = {
  consistent: { label: 'Konzistentní', cls: 'ok', icon: '✓' },
  partial: { label: 'Částečně konzistentní', cls: 'warn', icon: '⚠' },
  inconsistent: { label: 'Nekonzistentní', cls: 'match', icon: '⚠' },
};

function purposeValid() {
  return !!(wiz.data.relation_type && wiz.data.deal_value_band
    && String(wiz.data.business_purpose || '').trim() && wiz.data.source_of_funds_type);
}

// Validace kroku Účel: zvýrazní chybějící povinná pole a vrátí je (shora dolů).
function validatePurpose(root) {
  clearInvalid(root);
  const missing = [];
  if (!wiz.data.relation_type) {
    const el = root.querySelector('[data-act="set-relation"]')?.closest('.aml-seg-field');
    if (el) { markInvalid(el, 'Zvolte typ vztahu.'); missing.push(el); }
  }
  if (!wiz.data.deal_value_band) {
    const el = root.querySelector('[data-act="set-band"]')?.closest('.aml-seg-field');
    if (el) { markInvalid(el, 'Zvolte hodnotu obchodu.'); missing.push(el); }
  }
  if (!String(wiz.data.business_purpose || '').trim()) {
    const el = document.getElementById('aml_f_business_purpose')?.closest('.aml-field');
    if (el) { markInvalid(el, 'Popis obchodu je povinný.'); missing.push(el); }
  }
  if (!wiz.data.source_of_funds_type) {
    const el = document.getElementById('aml_f_source_of_funds_type')?.closest('.aml-field');
    if (el) { markInvalid(el, 'Zdroj prostředků je povinný.'); missing.push(el); }
  }
  missing.sort(byTop);
  return missing;
}

function renderPurpose(root) {
  if (!wiz.data.deal_countries) wiz.data.deal_countries = 'Česko';   // default dle zadání

  const relSegs = RELATION_TYPES.map(([v, l]) =>
    `<button class="aml-seg${wiz.data.relation_type === v ? ' aml-seg--on' : ''}" data-act="set-relation" data-val="${v}">${esc(l)}</button>`
  ).join('');
  const bandSegs = DEAL_BANDS.map(([v, l]) =>
    `<button class="aml-seg${wiz.data.deal_value_band === v ? ' aml-seg--on' : ''}" data-act="set-band" data-val="${v}">${esc(l)}</button>`
  ).join('');
  const catOpts = PURPOSE_CATEGORIES.map(([v, l]) => `<option value="${esc(v)}"${v === (wiz.data.purpose_category || '') ? ' selected' : ''}>${esc(l)}</option>`).join('');
  const srcOpts = SOURCE_TYPES.map(([v, l]) => `<option value="${esc(v)}"${v === (wiz.data.source_of_funds_type || '') ? ' selected' : ''}>${esc(l)}</option>`).join('');
  const countryList = COUNTRIES_CS.map(c => `<option value="${esc(c)}">`).join('');

  const showBanner = wiz.data.deal_value_band === '15k_plus' && wiz.purposeDocs.length === 0;
  const banner = showBanner
    ? `<div class="aml-warn-banner">Nedostupnost podpůrných dokumentů k původu prostředků je faktorem zvýšeného rizika (§ 9a, § 13 zákona č. 253/2008 Sb.). Doporučujeme doložit.</div>`
    : '';

  $('amlMain').innerHTML = `<div class="aml-card">
    <div class="aml-h">Účel obchodu</div>
    <div class="aml-sub">Popište povahu a účel zamýšleného obchodu a původ prostředků. AI porovná doložené dokumenty s deklarovaným zdrojem prostředků.</div>

    <div class="aml-seg-field">
      <span class="aml-seg-label">Typ vztahu <span class="aml-req">*</span></span>
      <div class="aml-seg-wrap">${relSegs}</div>
    </div>

    <div class="aml-seg-field">
      <span class="aml-seg-label">Hodnota obchodu (EUR) <span class="aml-req">*</span></span>
      <div class="aml-seg-wrap">${bandSegs}</div>
    </div>

    <label class="aml-field">
      <span>Kterých zemí se obchod týká</span>
      <input id="aml_f_deal_countries" list="amlCountryList" value="${esc(wiz.data.deal_countries || '')}" placeholder="Česko (více zemí oddělte čárkou)">
      <datalist id="amlCountryList">${countryList}</datalist>
    </label>

    <label class="aml-field">
      <span>Kategorie obchodu</span>
      <select id="aml_f_purpose_category">${catOpts}</select>
    </label>

    <label class="aml-field">
      <span>Popis obchodu <span class="aml-req">*</span></span>
      <textarea id="aml_f_business_purpose" rows="3" placeholder="Stručně popište, co je předmětem obchodu.">${esc(wiz.data.business_purpose || '')}</textarea>
    </label>

    <label class="aml-field">
      <span>Zdroj prostředků <span class="aml-req">*</span></span>
      <select id="aml_f_source_of_funds_type">${srcOpts}</select>
    </label>
    <label class="aml-field">
      <span>Upřesnění zdroje</span>
      <textarea id="aml_f_source_of_funds" rows="2" placeholder="např. prodej podílu ve společnosti XY, 12 mil. Kč">${esc(wiz.data.source_of_funds || '')}</textarea>
    </label>

    <div class="aml-pfield">
      <div class="aml-plabel">Podpůrné dokumenty <span class="aml-plabel-sub">(nepovinné, 0–5 · PDF, JPG, PNG · max 10 MB)</span></div>
      ${banner}
      ${purposeDocsHTML()}
    </div>

    ${consistencyHTML()}
  </div>`;
}

function purposeDocsHTML() {
  const cards = wiz.purposeDocs.map((d, i) => {
    const remove = `<button class="aml-doc-x" data-act="remove-purpose-doc" data-idx="${i}" aria-label="Odebrat">${SVG.close}</button>`;
    if (d.status === 'analyzing') {
      return `<div class="aml-doc-card"><div class="aml-doc-head"><span class="aml-doc-name">${esc(d.name)}</span>${remove}</div>
        <div class="aml-ai-loading"><span class="aml-spinner"></span> AI analyzuje dokument…</div></div>`;
    }
    if (d.status === 'error') {
      return `<div class="aml-doc-card aml-doc-err"><div class="aml-doc-head"><span class="aml-doc-name">${esc(d.name)}</span>${remove}</div>
        <div class="aml-doc-note">Analýza selhala. Dokument zůstává přiložen, můžete jej odebrat a zkusit znovu.</div></div>`;
    }
    const typeLabel = DOC_TYPE_LABELS[d.doc_type] || 'Dokument';
    const parties = (d.parties || []).map(p => [p.name, p.role].filter(Boolean).join(' — ')).filter(Boolean);
    const amounts = (d.amounts || []).map(a => [a.value, a.currency].filter(Boolean).join(' ') + (a.context ? ` (${a.context})` : '')).filter(Boolean);
    const flags = (d.red_flags || []).filter(Boolean);
    const rowP = parties.length ? `<div class="aml-doc-row"><span class="aml-doc-k">Strany:</span> ${esc(parties.join('; '))}</div>` : '';
    const rowA = amounts.length ? `<div class="aml-doc-row"><span class="aml-doc-k">Částky:</span> ${esc(amounts.join('; '))}</div>` : '';
    const rowS = d.summary ? `<div class="aml-doc-summary">${esc(d.summary)}</div>` : '';
    const rowF = flags.length ? `<div class="aml-doc-flags">${flags.map(f => `<span class="aml-doc-flag">${esc(f)}</span>`).join('')}</div>` : '';
    return `<div class="aml-doc-card">
      <div class="aml-doc-head"><span class="aml-doc-type">${esc(typeLabel)}</span><span class="aml-doc-name">${esc(d.name)}</span>${remove}</div>
      ${rowS}${rowP}${rowA}${rowF}</div>`;
  }).join('');
  const canAdd = wiz.purposeDocs.length < MAX_PURPOSE_DOCS;
  const add = canAdd
    ? `<button class="aml-doc-add" data-act="add-purpose-doc"><span class="aml-dz-ico">${SVG.upload}</span><span>Nahrát dokument</span></button>
       <input type="file" id="amlPurposeInput" accept="image/*,application/pdf" multiple hidden>`
    : '';
  return `<div class="aml-docs">${cards}${add}</div>`;
}

function consistencyHTML() {
  // Tlačítko je vždy klikatelné; disabled jen během běžící kontroly (loading).
  // Chybějící dokument řeší runConsistency toastem po kliku.
  const btnDis = wiz.consistencyLoading ? ' disabled' : '';
  let result = '';
  if (wiz.consistencyLoading) {
    result = `<div class="aml-ai-loading"><span class="aml-spinner"></span> AI porovnává účel a zdroj s dokumenty…</div>`;
  } else if (wiz.consistency) {
    const v = CONSISTENCY_VIEW[wiz.consistency.consistency] || { label: wiz.consistency.consistency || '—', cls: 'warn', icon: '•' };
    const signals = (wiz.consistency.signals || []).map(s =>
      `<div class="aml-sig aml-sig-${esc(s.severity || 'low')}"><span class="aml-sig-dot"></span><span>${esc(s.description_cs || s.type || '')}</span></div>`
    ).join('');
    const summary = wiz.consistency.summary_cs ? `<div class="aml-cons-summary">${esc(wiz.consistency.summary_cs)}</div>` : '';
    result = `<div class="aml-cons-result">
      <div class="aml-cons-badge aml-lk-${v.cls}"><span class="aml-lk-ico">${v.icon}</span> ${esc(v.label)}</div>
      ${summary}${signals}</div>`;
  } else {
    // Trvalá inline nápověda pod tlačítkem (ne mizející tooltip/toast). Při chybějícím
    // dokladu / selhání se sem zapíše konkrétní hláška (wiz._consistencyHint).
    const warn = !!wiz._consistencyHint;
    const hint = wiz._consistencyHint || 'Porovná uvedený účel a zdroj prostředků s obsahem nahraných dokumentů.';
    result = `<div class="aml-cons-hint${warn ? ' aml-cons-hint--warn' : ''}">${esc(hint)}</div>`;
  }
  return `<div class="aml-pfield aml-cons">
    <button class="aml-btn aml-btn-sm" data-act="check-consistency"${btnDis}>Zkontrolovat konzistenci</button>
    ${result}</div>`;
}

// Přidá podpůrné dokumenty (max 5) a spustí AI analýzu každého zvlášť.
async function addPurposeDocs(root, fileList) {
  const files = Array.from(fileList || []);
  for (const f of files) {
    if (wiz.purposeDocs.length >= MAX_PURPOSE_DOCS) { showToast(`Max. ${MAX_PURPOSE_DOCS} dokumentů.`); break; }
    const isPdf = f.type === 'application/pdf';
    const isImg = f.type.startsWith('image/');
    if (!isPdf && !isImg) { showToast('Podporujeme jen JPG, PNG a PDF.'); continue; }
    if (f.size > MAX_UPLOAD_BYTES) { showToast(`${f.name}: přesahuje 10 MB.`); continue; }
    const dataUrl = await new Promise((res, rej) => {
      const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(f);
    }).catch(() => null);
    if (!dataUrl) { showToast('Soubor se nepodařilo načíst.'); continue; }
    const small = isPdf ? dataUrl : await downscale(dataUrl);
    const doc = { name: f.name, mime: isPdf ? 'application/pdf' : 'image/jpeg', dataUrl: small, isPdf, status: 'analyzing' };
    wiz.purposeDocs.push(doc);
    renderPurpose(root);
    analyzePurposeDoc(root, doc);
  }
}

async function analyzePurposeDoc(root, doc) {
  try {
    const res = await apiAmlAnalyzeDocument(wiz.caseId, { filename: doc.name, mime: doc.mime, data_base64: doc.dataUrl.split(',')[1] });
    if (!res || res.error) throw new Error(res?.message || 'analyze_failed');
    doc.status = 'done';
    doc.sha256 = res.sha256; doc.doc_type = res.doc_type;
    doc.parties = res.parties || []; doc.amounts = res.amounts || [];
    doc.summary = res.summary_cs || ''; doc.red_flags = res.red_flags || [];
    doc.document_id = res.document_id; doc.extracted = res;
  } catch {
    doc.status = 'error';
  }
  if (wiz.step === 2) renderPurpose(root);
}

function removePurposeDoc(root, idx) {
  wiz.purposeDocs.splice(idx, 1);
  wiz.consistency = null;   // odebrání dokumentu zneplatní konzistenci
  renderPurpose(root);
}

async function runConsistency(root) {
  readFieldsFromForm();
  const docs = wiz.purposeDocs.filter(d => d.status === 'done');
  if (!docs.length) { wiz._consistencyHint = 'Nejdřív nahrajte alespoň jeden dokument, pak lze porovnat konzistenci.'; renderPurpose(root); return; }
  wiz._consistencyHint = null;
  wiz.consistencyLoading = true; renderPurpose(root);
  let res;
  try {
    res = await apiAmlCheckConsistency(wiz.caseId, {
      purpose: wiz.data.business_purpose || '',
      source_of_funds_type: wiz.data.source_of_funds_type || '',
      source_of_funds: wiz.data.source_of_funds || '',
      documents: docs.map(d => ({ doc_type: d.doc_type, summary: d.summary, extracted: d.extracted })),
    });
  } catch { res = null; }
  wiz.consistencyLoading = false;
  if (!res || res.error) { wiz._consistencyHint = 'Kontrola konzistence selhala — zkuste to znovu.'; renderPurpose(root); return; }
  wiz._consistencyHint = null;
  wiz.consistency = res;
  renderPurpose(root); renderContext();
}

// Uloží pole kroku Účel (přes patchCase) — volá se při přechodu na krok Riziko.
async function patchPurpose() {
  const patch = {};
  PURPOSE_COLS.forEach(col => { patch[col] = (wiz.data[col] === '' || wiz.data[col] == null) ? null : wiz.data[col]; });
  patch.consistency_json = wiz.consistency ? JSON.stringify(wiz.consistency) : null;
  await patchCase(patch);
}

// ── Krok 4 (index 3) — Riziko ────────────────────────────────────────
function declarationPayload() {
  return { pep: wiz.declaration.pep, sanctions_confirmed: wiz.declaration.sanctions, source_confirmed: wiz.declaration.source };
}
function justificationRequired() {
  const dev = wiz.riskDecision.level && wiz.riskSuggestion && wiz.riskDecision.level !== wiz.riskSuggestion.suggested_level;
  return !!(dev || wiz.declaration.pep === 'is');
}
function canDecide() {
  const d = wiz.declaration;
  if (!d.pep || !d.sanctions || !d.source) return false;
  if (!wiz.riskDecision.level) return false;
  if (justificationRequired() && !String(wiz.riskDecision.justification || '').trim()) return false;
  return true;
}
function updateDecideBtn() {
  const btn = $('amlDecideBtn');
  if (btn) btn.disabled = wiz.riskDeciding;   // disabled jen během ukládání (loading)
}

function riskAiCardHTML() {
  if (wiz.riskSuggestLoading) return `<div class="aml-ai-card aml-ai-card-loading"><span class="aml-spinner"></span> AI navrhuje rizikový profil…</div>`;
  const s = wiz.riskSuggestion;
  if (!s) return '';
  const lvl = RISK_LEVELS.find(([v]) => v === s.suggested_level) || ['', '—'];
  const factors = (s.factors || []).map(f => {
    const iv = IMPACT_VIEW[f.impact] || IMPACT_VIEW.neutral;
    return `<div class="aml-factor aml-factor-${iv.cls}"><span class="aml-factor-ico">${iv.icon}</span><span><b>${esc(f.factor || '')}</b>${f.note_cs ? ' — ' + esc(f.note_cs) : ''}</span></div>`;
  }).join('');
  // Odůvodnění je editovatelné, dokud kontrola není dokončena — povinná osoba může
  // text upravit, smazat části i doplnit. Do PDF jde finální znění (ai_edited příznak).
  const editable = !wiz.completeResult;
  const reasonBlock = editable
    ? `<div class="aml-ai-reason-edit">
        <div class="aml-ai-reason-label">Odůvodnění návrhu — můžete upravit, smazat části i doplnit${wiz._aiEdited ? ' <span class="aml-ai-edited-tag">upraveno</span>' : ''}</div>
        <textarea id="amlAiReason" class="aml-ai-reason-ta" rows="5" placeholder="Odůvodnění rizikového návrhu…">${esc(s.reasoning_cs || '')}</textarea>
        <button class="aml-btn aml-btn-sm aml-ai-addpara" data-act="ai-add-para">+ Přidat vlastní odstavec</button>
      </div>`
    : (s.reasoning_cs ? `<div class="aml-ai-reason">${esc(s.reasoning_cs)}</div>` : '');
  return `<div class="aml-ai-card">
    <div class="aml-ai-card-head">
      <span class="aml-ai-tag">AI návrh</span>
      <span class="aml-risk-badge aml-risk-${esc(s.suggested_level)}">${esc(lvl[1])} riziko</span>
    </div>
    ${factors ? `<div class="aml-factors">${factors}</div>` : ''}
    ${reasonBlock}
  </div>
  <div class="aml-disclaimer">${esc(RISK_DISCLAIMER)}</div>`;
}

// Uloží (debounce-free, na blur) upravené odůvodnění AI návrhu do case.
function persistAiReason() {
  if (!wiz.caseId || !wiz.riskSuggestion) return;
  patchCase({ ai_risk_reasoning: JSON.stringify(wiz.riskSuggestion), ai_risk_edited: wiz._aiEdited ? 1 : 0 });
}
// „+ Přidat vlastní odstavec" — přidá prázdný odstavec a nastaví fokus na konec.
function addAiParagraph() {
  const ta = document.getElementById('amlAiReason');
  if (!ta || !wiz.riskSuggestion) return;
  const cur = ta.value.replace(/\s+$/, '');
  ta.value = cur + (cur ? '\n\n' : '');
  wiz.riskSuggestion.reasoning_cs = ta.value;
  wiz._aiEdited = true;
  ta.focus();
  try { ta.setSelectionRange(ta.value.length, ta.value.length); } catch {}
  ta.style.height = 'auto'; ta.style.height = ta.scrollHeight + 'px';
}

function declarationHTML() {
  const d = wiz.declaration;
  const pepRadio = (val, text) => `<label class="aml-radio"><input type="radio" name="amlPep" value="${val}"${d.pep === val ? ' checked' : ''}><span>${esc(text)}</span></label>`;
  return `<div class="aml-decl">
    <div class="aml-sec-title">Prohlášení klienta</div>
    <div class="aml-decl-q">
      <div class="aml-decl-label">Politicky exponovaná osoba (PEP) <span class="aml-req">*</span></div>
      <div class="aml-decl-def">${esc(PEP_DEFINITION)}</div>
      <div class="aml-radios aml-decl-radios">${pepRadio('not', PEP_NOT)}${pepRadio('is', PEP_IS)}</div>
    </div>
    <label class="aml-check"><input type="checkbox" id="amlDeclSanctions"${d.sanctions ? ' checked' : ''}><span>${esc(SANCTIONS_DECL)} <span class="aml-req">*</span></span></label>
    <label class="aml-check"><input type="checkbox" id="amlDeclSource"${d.source ? ' checked' : ''}><span>${esc(SOURCE_DECL)} <span class="aml-req">*</span></span></label>
    <div class="aml-decl-note">Prohlášení budou součástí PDF záznamu s místem pro podpis klienta.</div>
  </div>`;
}

function decisionHTML() {
  const cards = RISK_LEVELS.map(([v, l, desc]) =>
    `<button class="aml-risk-card aml-risk-card-${v}${wiz.riskDecision.level === v ? ' aml-risk-card--on' : ''}" data-act="set-risk" data-val="${v}">
      <span class="aml-risk-card-lvl">${esc(l)}</span><span class="aml-risk-card-desc">${esc(desc)}</span></button>`
  ).join('');
  const req = justificationRequired();
  return `<div class="aml-decision">
    <div class="aml-sec-title">Rozhodnutí o riziku</div>
    <div class="aml-risk-cards">${cards}</div>
    <label class="aml-field">
      <span>Odůvodnění${req ? ' <span class="aml-req">*</span>' : ' (nepovinné)'}</span>
      <textarea id="amlRiskJust" rows="3" placeholder="${req ? 'Zdůvodněte odchylku od návrhu nebo PEP status.' : 'Volitelná poznámka k rozhodnutí.'}">${esc(wiz.riskDecision.justification || '')}</textarea>
    </label>
    <button class="aml-btn aml-btn-primary aml-btn-block" id="amlDecideBtn" data-act="risk-decide">Závazně rozhodnout</button>
  </div>`;
}

function riskLockedHTML() {
  const lvl = RISK_LEVELS.find(([v]) => v === wiz.riskDecision.level) || ['', '—'];
  return `<div class="aml-decision aml-decision-locked">
    <div class="aml-sec-title">Rozhodnutí o riziku</div>
    ${wiz.riskDecision.justification ? `<div class="aml-locked-just"><span class="aml-doc-k">Odůvodnění:</span> ${esc(wiz.riskDecision.justification)}</div>` : ''}
    <div class="aml-btn aml-btn-block aml-btn-decided">✓ Rozhodnuto — ${esc(lvl[1])} riziko</div>
    <div class="aml-decl-note">Rozhodnutí je uzamčeno. Pokračujte na krok Záznam tlačítkem Další.</div>
  </div>`;
}

function renderRisk(root) {
  if (!wiz.riskSuggestion && !wiz.riskSuggestLoading && !wiz.riskDecided) runRiskSuggest(root);
  const decisionPart = wiz.riskDecided
    ? riskLockedHTML()
    : ((wiz.riskSuggestion || wiz.riskDecision.level) ? decisionHTML() : '');
  $('amlMain').innerHTML = `<div class="aml-card">
    <div class="aml-h">Vyhodnocení rizika</div>
    <div class="aml-sub">Posuďte rizikový profil klienta. Návrh AI je podpůrný — závazné rozhodnutí je na vás.</div>
    ${riskAiCardHTML()}
    ${wiz.riskDecided ? '' : declarationHTML()}
    ${decisionPart}
  </div>`;
}

async function runRiskSuggest(root) {
  wiz.riskSuggestLoading = true;
  if (wiz.step === 3) renderRisk(root);
  let res;
  try { res = await apiAmlRiskSuggest(wiz.caseId, { client_declaration: declarationPayload() }); } catch { res = null; }
  wiz.riskSuggestLoading = false;
  if (!res || res.error) { showToast('Návrh rizika se nepodařilo načíst.'); if (wiz.step === 3) renderRisk(root); return; }
  wiz.riskSuggestion = res;
  if (!wiz.riskDecision.level) wiz.riskDecision.level = res.suggested_level;
  if (wiz.step === 3) renderRisk(root);
  renderContext();
}

// Validace závazného rozhodnutí: zvýrazní chybějící prohlášení / úroveň / odůvodnění.
function validateDecision(root) {
  clearInvalid(root);
  const d = wiz.declaration; const missing = [];
  if (!d.pep) {
    const el = root.querySelector('.aml-decl-q');
    if (el) { markInvalid(el, 'Toto prohlášení je povinné.'); missing.push(el); }
  }
  [['sanctions', 'amlDeclSanctions'], ['source', 'amlDeclSource']].forEach(([k, id]) => {
    if (d[k]) return;
    const el = document.getElementById(id)?.closest('.aml-check');
    if (el) { markInvalid(el, 'Toto prohlášení je povinné.'); missing.push(el); }
  });
  if (!wiz.riskDecision.level) {
    const el = root.querySelector('.aml-risk-cards');
    if (el) { markInvalid(el, 'Zvolte úroveň rizika.'); missing.push(el); }
  }
  if (justificationRequired() && !String(wiz.riskDecision.justification || '').trim()) {
    const el = document.getElementById('amlRiskJust')?.closest('.aml-field');
    if (el) { markInvalid(el, 'Odůvodnění je povinné při odchylce od návrhu nebo u PEP.'); missing.push(el); }
  }
  missing.sort(byTop);
  return missing;
}

async function runRiskDecision(root) {
  if (wiz.riskDeciding) return;
  const missing = validateDecision(root);
  if (missing.length) { scrollToInvalid(missing[0]); showToast('Doplňte povinná prohlášení klienta.'); return; }
  wiz.riskDeciding = true; updateDecideBtn();
  let res;
  try {
    res = await apiAmlRiskDecision(wiz.caseId, {
      final_risk_level: wiz.riskDecision.level,
      risk_justification: wiz.riskDecision.justification || '',
      client_declaration: declarationPayload(),
    });
  } catch { res = null; }
  wiz.riskDeciding = false;
  if (!res || res.error) {
    const msg = res?.error === 'justification_required'
      ? 'Odůvodnění je povinné při odchylce od návrhu nebo u PEP.'
      : (res?.error === 'declaration_incomplete' ? 'Doplňte prosím prohlášení klienta.' : 'Rozhodnutí se nepodařilo uložit.');
    showToast(msg); renderRisk(root); return;
  }
  wiz.riskDecided = true;
  wiz.riskDecision.decided_at = res.risk_decided_at;
  wiz.maxStep = Math.max(wiz.maxStep, 4);
  renderRisk(root); renderSteps(); renderFoot(); renderContext();
  scrollWizardTop();   // po zamčení rozhodnutí ukaž začátek kroku (ne patičku)
}

// ── Krok 5 (index 4) — Záznam ────────────────────────────────────────
function fmtDateOnly(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d)) return '';
  try { return d.toLocaleDateString('cs-CZ', { day: 'numeric', month: 'numeric', year: 'numeric' }); } catch { return ''; }
}
function recapRow(label, val) {
  return `<div class="aml-recap-row"><span class="aml-recap-k">${esc(label)}</span><span class="aml-recap-v">${esc(val || '—')}</span></div>`;
}
function lbl(list, v) { return (list.find(([x]) => x === v) || ['', '—'])[1]; }

function renderRecord(root) {
  if (wiz.completeResult) { renderRecordDone(root); return; }
  if (!getProfile() && !wiz._profileTried) {
    wiz._profileTried = true;
    ensureProfileLoaded().then(() => { if (wiz.step === 4) renderRecord(root); });
  }
  if (!wiz.riskDecided) {
    $('amlMain').innerHTML = `<div class="aml-card"><div class="aml-h">Záznam o kontrole</div>
      <div class="aml-ai-note">Nejdřív dokončete vyhodnocení rizika (krok Riziko) a proveďte závazné rozhodnutí.</div></div>`;
    return;
  }
  const client = wiz.subject_type === 'po'
    ? (wiz.data.company_name || '—')
    : ([wiz.data.client_name, wiz.data.client_surname].filter(Boolean).join(' ') || '—');
  const docCount = wiz.purposeDocs.filter(d => d.status === 'done').length;
  const profBanner = !profileIsFilled(getProfile())
    ? `<div class="aml-warn-banner">Záznam bude bez údajů povinné osoby — vyplňte je v <button class="aml-inline-link" data-act="open-settings">Nastavení</button>.</div>`
    : '';
  $('amlMain').innerHTML = `<div class="aml-card">
    <div class="aml-h">Záznam o kontrole</div>
    <div class="aml-sub">Zkontrolujte rekapitulaci a vygenerujte finální PDF záznam. Tím se kontrola dokončí a uloží do archivu.</div>
    ${profBanner}
    <div class="aml-recap">
      ${recapRow('Číslo kontroly', wiz.case_number)}
      ${recapRow('Klient', client)}
      ${recapRow('Typ vztahu', lbl(RELATION_TYPES, wiz.data.relation_type))}
      ${recapRow('Hodnota obchodu', lbl(DEAL_BANDS, wiz.data.deal_value_band))}
      ${recapRow('Zdroj prostředků', lbl(SOURCE_TYPES, wiz.data.source_of_funds_type))}
      ${recapRow('Podpůrné dokumenty', docCount ? `${docCount} přiloženo` : 'žádné')}
      ${recapRow('Rozhodnuté riziko', lbl(RISK_LEVELS, wiz.riskDecision.level))}
    </div>
    <div class="aml-recap-note">PDF obsahuje plnou diakritiku, prohlášení klienta s podpisovými poli a přiložené dokumenty ze session. Přílohy se z bezpečnostních důvodů neukládají na server.</div>
    <button class="aml-btn aml-btn-primary aml-btn-block" id="amlGenBtn" data-act="gen-record">Vygenerovat a stáhnout PDF</button>
  </div>`;
}

function verifierForRecord() {
  if (wiz.method === 'personal' && wiz.verifierConfirmed) {
    return { confirmed: true, statement: VERIFIER_STATEMENT, checkbox: VERIFIER_CHECKBOX, timestamp: wiz.verifierTimestamp || null };
  }
  return null;
}

function buildRecordData(lookups) {
  return {
    caseNumber: wiz.case_number,
    povinnaOsoba: getProfile(),
    dateISO: new Date().toISOString(),
    subjectType: wiz.subject_type,
    client: {
      name: [wiz.data.client_name, wiz.data.client_surname].filter(Boolean).join(' '),
      nameOriginal: wiz.data.client_name_original || '', birthDate: wiz.data.client_birth_date || '',
      birthPlace: wiz.data.client_birth_place || '', address: wiz.data.client_address || '',
      nationality: wiz.data.client_nationality || '', docType: wiz.data.client_doc_type || '',
      docNumber: wiz.data.client_doc_number || '', docValidUntil: wiz.data.client_doc_valid_until || '',
      rc: wiz.data.client_rc || '', occupation: wiz.data.client_occupation || '', gender: wiz.data.client_gender || '',
    },
    company: {
      name: wiz.data.company_name || '', ico: wiz.data.client_ico || '', address: wiz.data.company_address || '',
      actingRole: wiz.data.acting_person_role || '', actingNote: wiz.data.acting_person_note || '',
      esmChecked: !!wiz.data.esm_checked, esmNote: wiz.data.esm_note || '',
    },
    identification: { method: wiz.method, verifier: verifierForRecord() },
    deal: { relationType: wiz.data.relation_type, valueBand: wiz.data.deal_value_band, countries: wiz.data.deal_countries, category: wiz.data.purpose_category, purpose: wiz.data.business_purpose },
    source: { type: wiz.data.source_of_funds_type, detail: wiz.data.source_of_funds },
    consistency: wiz.consistency,
    lookups: (lookups || []).map(l => ({ type: l.lookup_type, status: l.status, matched_against: l.matched_against, checked_at: l.checked_at, source: (l.details && l.details.source) || l.source || null })),
    documents: wiz.purposeDocs.filter(d => d.status === 'done').map(d => ({ doc_type: d.doc_type, filename: d.name, sha256: d.sha256, summary: d.summary })),
    risk: { suggestion: wiz.riskSuggestion, finalLevel: wiz.riskDecision.level, justification: wiz.riskDecision.justification, decidedAt: wiz.riskDecision.decided_at },
    declaration: declarationPayload(),
  };
}

function dataUrlToBytes(dataUrl) {
  const b64 = (dataUrl.split(',')[1] || '');
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return arr;
}

function gatherAttachments() {
  const list = [];
  if (wiz.frontImg) list.push({ dataUrl: wiz.frontImg, mime: 'image/jpeg', caption: 'Doklad totožnosti — přední strana' });
  if (wiz.backImg) list.push({ dataUrl: wiz.backImg, mime: 'image/jpeg', caption: 'Doklad totožnosti — zadní strana' });
  for (const u of wiz.uploadFiles) list.push({ dataUrl: u.dataUrl, mime: u.media_type, caption: 'Doklad totožnosti — ' + (u.name || '') });
  for (const dc of wiz.purposeDocs.filter(d => d.status === 'done')) list.push({ dataUrl: dc.dataUrl, mime: dc.mime, caption: 'Podpůrný dokument — ' + (DOC_TYPE_LABELS[dc.doc_type] || dc.name || '') });
  return list.map(a => ({ bytes: dataUrlToBytes(a.dataUrl), mime: a.mime, caption: a.caption }));
}

async function sha256HexBytes(bytes) {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map(x => x.toString(16).padStart(2, '0')).join('');
}

async function runGenerateRecord(root) {
  if (wiz.generating) return;
  wiz.generating = true;
  const btn = $('amlGenBtn'); if (btn) { btn.disabled = true; btn.textContent = 'Generuji PDF…'; }
  try {
    let lookups = wiz.lookups;
    try { const r = await apiAmlGetLookups(wiz.caseId); if (r.results?.length) lookups = r.results; } catch {}
    await ensureProfileLoaded();
    const data = buildRecordData(lookups);
    const attachments = gatherAttachments();
    const bytes = await buildRecordPdf(data, attachments);
    const sha = await sha256HexBytes(bytes);
    downloadPdf(bytes, `${wiz.case_number || 'AML'}-zaznam.pdf`);
    let res;
    try { res = await apiAmlComplete(wiz.caseId, sha); } catch { res = null; }
    wiz.recordSha = sha;
    wiz.completeResult = (res && !res.error) ? res : { ok: false };
    if (!res || res.error) showToast('PDF vygenerováno, ale dokončení se nepodařilo uložit.');
    renderRecordDone(root);
  } catch (e) {
    showToast('Generování PDF selhalo, zkuste to prosím znovu.');
  } finally {
    wiz.generating = false;
    const b2 = $('amlGenBtn'); if (b2) { b2.disabled = false; b2.textContent = 'Vygenerovat a stáhnout PDF'; }
  }
}

function renderRecordDone(root) {
  renderCaseNum();
  renderSteps();
  const foot = $('amlFoot'); if (foot) foot.innerHTML = '';
  const review = wiz.completeResult?.next_review_due ? fmtDateOnly(wiz.completeResult.next_review_due) : '';
  $('amlMain').innerHTML = `<div class="aml-card aml-done">
    <div class="aml-h">Kontrola dokončena</div>
    <div class="aml-ai-note">Záznam ${esc(wiz.case_number || '')} byl vygenerován a stažen. Případ je uložen v archivu.</div>
    <div class="aml-recap">
      ${recapRow('Otisk záznamu (SHA-256)', wiz.recordSha ? wiz.recordSha.slice(0, 32) + '…' : '—')}
      ${review ? recapRow('Příští revize do', review) : ''}
    </div>
    <div class="aml-upload-btns">
      <button class="aml-btn aml-btn-primary" data-act="go-archive">Do archivu</button>
      <button class="aml-btn" data-act="new">Nová kontrola</button>
    </div>
  </div>`;
}

// ── Krok 2 — automatická lustrace ────────────────────────────────────
// Beználezový výsledek per rejstřík — hodnotící závěr („v pořádku") NEDĚLÁ lustrace,
// dělá ho povinná osoba v kroku Riziko. Proto věcná formulace pro každý zdroj zvlášť.
const CLEAN_TEXT = {
  mvcr: 'doklad není evidován jako neplatný',
  isir: 'bez záznamu v ISIR',
  isir_po: 'bez záznamu v ISIR',
  ares: 'ověřeno v ARES',
  sanctions: 'bez nálezu',
  sanctions_entity: 'bez nálezu',
  pep: 'bez nálezu',
};
const cleanText = t => CLEAN_TEXT[t] || 'bez nálezu';

// Ikona + třída + text podle stavu jedné lustrace.
function lookupView(lk) {
  if (!lk) return { icon: '⏳', cls: 'pending', text: 'probíhá…' };
  const pct = lk.match_score ? `${Math.round(lk.match_score * 100)} %` : '';
  switch (lk.status) {
    case 'clean':   return { icon: '✓', cls: 'ok',    text: cleanText(lk.lookup_type) };
    case 'warning': return { icon: '⚠', cls: 'warn',  text: pct ? `možná shoda ${pct}` : 'ke kontrole' };
    case 'match':   return { icon: '⚠', cls: 'match', text: pct ? `SHODA ${pct}` : 'SHODA' };
    case 'manual':  return { icon: '↗', cls: 'manual', text: 'ověřte ručně' };
    case 'error':   return { icon: '✕', cls: 'err',   text: 'ověřte ručně' };
    default:        return { icon: '⏳', cls: 'pending', text: 'probíhá…' };
  }
}

// Překladové slovníky pro OpenSanctions kódy → český popis.
const OS_DATASETS = {
  us_cia_world_leaders: 'CIA World Leaders', wikidata: 'Wikidata', wd_peps: 'Wikidata (PEP index)',
  fr_hatvp_declarations: 'HATVP (FR registr funkcionářů)',
  un_ga_protocol: 'OSN – protokol Valného shromáždění', everypolitician: 'EveryPolitician',
  eu_meps: 'Europarlament (poslanci)', gb_hmt_sanctions: 'HM Treasury (UK)',
};
// Interní/technické datasety OpenSanctions — pro povinnou osobu bez hodnoty, skryjeme.
const OS_DATASET_NOISE = new Set(['wd_categories', 'ann_pep_positions', 'wd_positions', 'ext_wikidata', 'wikidata_categories']);
const OS_TOPICS = {
  'role.pep': 'politicky exponovaná osoba', 'role.pol': 'politik',
  'role.rca': 'osoba blízká funkcionáři', 'gov.national': 'státní správa',
  'role.judge': 'soudce', 'role.diplo': 'diplomat', 'gov.muni': 'komunální politika',
};
const COUNTRY_CS = {
  fr: 'Francie', cz: 'Česko', sk: 'Slovensko', de: 'Německo', us: 'USA', gb: 'Spojené království',
  ru: 'Rusko', ua: 'Ukrajina', pl: 'Polsko', at: 'Rakousko', it: 'Itálie', es: 'Španělsko',
  hu: 'Maďarsko', be: 'Belgie', nl: 'Nizozemsko', cn: 'Čína',
};
const arr = v => Array.isArray(v) ? v : (v == null ? [] : [v]);
const transList = (v, map) => arr(v).map(x => map[x] || map[String(x).toLowerCase()] || x);
const transCountry = v => arr(v).map(c => COUNTRY_CS[String(c).toLowerCase()] || String(c).toUpperCase());

// "1979-05-18(Z)" → "18. 5. 1979"
function fmtDate(s) {
  const m = String(s || '').match(/(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${+m[3]}. ${+m[2]}. ${m[1]}` : String(s || '');
}
// "(2018-)" → "(od 2018)", "(2010-2018)" → "(2010–2018)"
const normYears = s => s.replace(/\((\d{4})-\)/g, '(od $1)').replace(/\((\d{4})-(\d{4})\)/g, '($1–$2)');
// Časté anglické názvy funkcí z OpenSanctions → česky (jinak ponech originál).
const POS_PATTERNS = [
  [/deputy mayor of a place in the czech republic/i, 'místostarosta obce (ČR)'],
  [/mayor of a place in the czech republic/i, 'starosta obce (ČR)'],
  [/member of a czech municipal council/i, 'člen obecního zastupitelstva (ČR)'],
  [/member of the chamber of deputies/i, 'poslanec Poslanecké sněmovny'],
  [/member of the senate/i, 'senátor'],
  [/president of the czech republic/i, 'prezident ČR'],
  [/prime minister/i, 'předseda vlády'],
  [/minister/i, 'ministr'], [/senator/i, 'senátor'], [/governor/i, 'guvernér'],
  [/president/i, 'prezident'], [/ambassador/i, 'velvyslanec'],
];
function translatePosition(p) {
  const yr = (String(p).match(/\([^)]*\)\s*$/) || [''])[0];
  const base = yr ? String(p).slice(0, p.length - yr.length).trim() : String(p);
  for (const [re, cs] of POS_PATTERNS) if (re.test(base)) return normYears(`${cs} ${yr}`.trim());
  return normYears(String(p));
}

// Speciální, povinné osobě srozumitelný detail PEP shody z OpenSanctions.
function pepDetailHTML(lk) {
  const d = lk.details || {};
  const row = (label, val) => val && val.length
    ? `<div><span class="aml-lk-dk">${label}:</span> ${esc(Array.isArray(val) ? val.join('; ') : String(val))}</div>` : '';
  const countries = transCountry(d.countries);
  const positions = arr(d.positions).map(translatePosition);
  const datasets = [...new Set(arr(d.datasets).filter(x => !OS_DATASET_NOISE.has(x)).map(x => OS_DATASETS[x] || x))];
  const topics = transList(d.topics, OS_TOPICS);
  const bd = arr(d.birth_date).map(fmtDate);
  return `<div class="aml-lk-detail" id="aml-lk-det-pep" hidden>` +
    row('Shoda s', lk.matched_against || d.caption) +
    `<div><span class="aml-lk-dk">Zdroj:</span> OpenSanctions (globální PEP databáze)</div>` +
    row('Datum narození', bd) +
    row('Země', countries) +
    row('Funkce', positions) +
    row('Typ', topics) +
    row('Zdrojové databáze', datasets) +
    `</div>`;
}

const CS_KEYS = {
  note: 'Poznámka', doc_number: 'Číslo dokladu', name: 'Jméno', birthdate: 'Datum narození',
  birth_date: 'Datum narození', source: 'Zdroj', full_name: 'Celé jméno', nationality: 'Národnost',
  reason: 'Důvod', position: 'Funkce', organization: 'Organizace', active_since: 'Ve funkci od',
  active_until: 'Ve funkci do', ico: 'IČO', address: 'Adresa', vysledek: 'Výsledek',
  client_birth_date: 'Datum narození klienta', checked: 'Prověřeno záznamů',
};

// Stav insolvenčního řízení (druhStavKonkursu) → česky.
const ISIR_STAV = {
  ODSKRTNUTA: 'skončeno (vyškrtnuto z evidence)', PROHLASENY: 'konkurs prohlášen',
  POVOLENE_ODDLUZENI: 'povolené oddlužení', POVOLENA_REORGANIZACE: 'povolená reorganizace',
  ZRUSENY: 'zrušeno', UKONCENA: 'ukončeno', MORATORIUM: 'moratorium', UPADEK: 'úpadek',
};
const isirStav = s => s ? (ISIR_STAV[s] || String(s).toLowerCase().replace(/_/g, ' ')) : '';

// ISIR — seznam nalezených insolvenčních řízení, hodnotný pro povinnou osobu:
// probíhající řízení nahoře + zvýrazněná, český stav, formátovaná data.
function isirDetailHTML(lk) {
  const d = lk.details || {};
  const list = (d.rizeni || []).slice()
    .sort((a, b) => (a.ukonceni ? 1 : 0) - (b.ukonceni ? 1 : 0)
      || String(b.zahajeni || '').localeCompare(String(a.zahajeni || '')));
  const rows = list.slice(0, 10).map(r => {
    const aktivni = !r.ukonceni;
    const badge = aktivni
      ? `<span class="aml-lk-badge aml-lk-badge-live">PROBÍHÁ</span>`
      : `<span class="aml-lk-badge">skončeno ${esc(fmtDate(r.ukonceni))}</span>`;
    const meta = [
      r.soud,
      r.nar && `nar. ${fmtDate(r.nar)}`,
      r.zahajeni && `zahájeno ${fmtDate(r.zahajeni)}`,
      isirStav(r.stav) && `stav: ${isirStav(r.stav)}`,
    ].filter(Boolean).join(' · ');
    const spis = r.url
      ? `<a class="aml-lk-link" href="${esc(r.url)}" target="_blank" rel="noopener">${esc(r.spis || 'řízení')} ↗</a>`
      : esc(r.spis || 'řízení');
    return `<div class="aml-lk-rizeni"><div class="aml-lk-spis">${spis} ${badge}</div><div class="aml-lk-rmeta">${esc(meta)}</div></div>`;
  }).join('');
  const more = list.length > 10 ? `<div class="aml-lk-rmeta">… a dalších ${list.length - 10} řízení</div>` : '';
  return `<div class="aml-lk-detail" id="aml-lk-det-${lk.lookup_type}" hidden>` +
    (d.note ? `<div class="aml-lk-rnote">${esc(d.note)}</div>` : '') + rows + more + `</div>`;
}

function lookupDetailHTML(lk) {
  // PEP z OpenSanctions má vlastní srozumitelný render.
  if (lk.lookup_type === 'pep' && lk.source === 'opensanctions') return pepDetailHTML(lk);
  // ISIR (osoba i firma) nalezená řízení mají vlastní render.
  if ((lk.lookup_type === 'isir' || lk.lookup_type === 'isir_po') && lk.details && lk.details.rizeni) return isirDetailHTML(lk);

  const d = lk.details;
  // Nedostupný rejstřík — jasná výzva k ruční kontrole + přímý odkaz.
  if (lk.status === 'error') {
    const links = {
      mvcr: 'https://aplikace.mv.gov.cz/neplatne-doklady/',
      isir: 'https://isir.justice.cz', isir_po: 'https://isir.justice.cz',
      ares: 'https://ares.gov.cz',
    };
    const url = links[lk.lookup_type];
    const msg = typeof d === 'string' ? d : (d && d.note) || '';
    return `<div class="aml-lk-detail" id="aml-lk-det-${lk.lookup_type}" hidden>` +
      (msg ? `<div>${esc(msg)}</div>` : '') +
      `<div>Rejstřík nedostupný — ověřte ručně${url ? `: <a class="aml-lk-link" href="${esc(url)}" target="_blank" rel="noopener">otevřít rejstřík ↗</a>` : '.'}</div>` +
      `</div>`;
  }
  // ISIR / obecný ruční fallback — odkaz na ověření.
  if (lk.status === 'manual') {
    const url = d && d.url;
    return `<div class="aml-lk-detail" id="aml-lk-det-${lk.lookup_type}" hidden>` +
      `<div>${esc(d?.note || 'Ověřte ručně.')}</div>` +
      (url ? `<div><a class="aml-lk-link" href="${esc(url)}" target="_blank" rel="noopener">Otevřít insolvenční rejstřík ↗</a></div>` : '') +
      `</div>`;
  }

  let inner = '';
  if (typeof d === 'string') inner = esc(d);
  else if (d && typeof d === 'object') {
    inner = Object.entries(d)
      .filter(([k, v]) => v != null && v !== '' && k !== 'source')   // source → badge, ne raw řádek
      .map(([k, v]) => `<div><span class="aml-lk-dk">${esc(CS_KEYS[k] || k)}:</span> ${esc(String(typeof v === 'object' ? JSON.stringify(v) : v))}</div>`)
      .join('');
  }
  const matched = lk.matched_against ? `<div><span class="aml-lk-dk">Shoda s:</span> ${esc(lk.matched_against)}${sanctionSourceBadge(lk)}</div>` : '';
  return `<div class="aml-lk-detail" id="aml-lk-det-${lk.lookup_type}" hidden>${matched}${inner}</div>`;
}

// "2026-07-14T09:32:00Z" → "ověřeno 14. 7. 2026 v 9:32" (cs-CZ, Europe/Prague)
// U selhaného zdroje (status 'error') NEpíšeme „ověřeno", ale „nedokončeno".
function fmtCheckedAt(iso, status) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d)) return '';
  try {
    const s = d.toLocaleString('cs-CZ', { timeZone: 'Europe/Prague', day: 'numeric', month: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    const prefix = status === 'error' ? 'nedokončeno' : 'ověřeno';
    return `${prefix} ${s.replace(', ', ' v ')}`;
  } catch { return ''; }
}

// Badge, KTERÝ sankční seznam matchnul (EU / OSN / ČR) — jen u shody sankcí.
const SANCTION_SRC_LABEL = { EU: 'EU', UN: 'OSN', CZ: 'ČR' };
function sanctionSourceBadge(lk) {
  const s = lk && lk.status === 'match' && lk.details && lk.details.source;
  if (!SANCTION_SRC_LABEL[s]) return '';
  return ` <span class="aml-src-badge aml-src-${String(s).toLowerCase()}">${SANCTION_SRC_LABEL[s]}</span>`;
}

// Technická chyba zdroje se uživateli NIKDY neukazuje (D1_ERROR apod.) — jen věcná
// výzva + retry pro daný zdroj. Odkaz na ruční ověření podle typu rejstříku.
const MANUAL_LINKS = {
  mvcr: 'https://aplikace.mv.gov.cz/neplatne-doklady/',
  isir: 'https://isir.justice.cz', isir_po: 'https://isir.justice.cz',
  ares: 'https://ares.gov.cz',
};
function errorBlockHTML(type) {
  const url = MANUAL_LINKS[type];
  const link = url ? ` <a class="aml-lk-link" href="${esc(url)}" target="_blank" rel="noopener">otevřít rejstřík ↗</a>` : '';
  return `<div class="aml-lk-detail aml-lk-errbox" id="aml-lk-det-${type}">
      <div>Kontrolu se nepodařilo dokončit — zkuste znovu nebo ověřte ručně.${link}</div>
      <div class="aml-lk-errbtns"><button class="aml-btn aml-btn-sm" data-act="retry-lookup" data-type="${type}">Zkusit znovu</button></div>
    </div>`;
}

function lookupRowHTML(type) {
  const lk = wiz.lookups?.find(x => x.lookup_type === type) || null;
  const v = lookupView(lk);
  const isError = lk && lk.status === 'error';
  const expandable = lk && ['warning', 'match', 'manual'].includes(lk.status);
  const act = expandable ? ` data-act="toggle-detail" data-type="${type}" role="button" tabindex="0"` : '';
  const when = lk && lk.checked_at ? `<span class="aml-lk-when">${esc(fmtCheckedAt(lk.checked_at, lk.status))}</span>` : '';
  const row = `<div class="aml-lk-row aml-lk-${v.cls}"${act}>
      <span class="aml-lk-ico">${v.icon}</span>
      <span class="aml-lk-label">${esc(LOOKUP_LABELS[type] || type)}${when}</span>
      <span class="aml-lk-status">${esc(v.text)}${sanctionSourceBadge(lk)}${expandable ? ' <span class="aml-lk-caret">▾</span>' : ''}</span>
    </div>`;
  if (isError) return row + errorBlockHTML(type);
  return row + (expandable ? lookupDetailHTML(lk) : '');
}

function renderLustrace(root) {
  let inner;
  if (wiz.subject_type === 'po') {
    // Dvě skupiny: Společnost / Jednající osoba.
    inner =
      `<div class="aml-lk-group-title">Společnost</div>` +
      `<div class="aml-lookups">${PO_GROUP_COMPANY.map(lookupRowHTML).join('')}</div>` +
      `<div class="aml-lk-group-title">Jednající osoba</div>` +
      `<div class="aml-lookups">${PO_GROUP_PERSON.map(lookupRowHTML).join('')}</div>`;
  } else {
    inner = `<div class="aml-lookups">${FO_LOOKUP_TYPES.map(lookupRowHTML).join('')}</div>`;
  }
  const rerun = wiz.lookupStatus === 'done'
    ? `<button class="aml-btn aml-btn-sm" data-act="rerun-lookups">Spustit lustraci znovu</button>`
    : '';
  $('amlMain').innerHTML = `<div class="aml-card">
    <div class="aml-h">Automatická lustrace</div>
    <div class="aml-sub">Prověřujeme klienta ve veřejných rejstřících a sankčních seznamech.</div>
    ${inner}
    <div class="aml-lk-note">Sankční kontrola: konsolidovaný seznam EU, seznam Rady bezpečnosti OSN a národní seznam MZV ČR — denní aktualizace.</div>
    ${rerun}
  </div>`;
  if (wiz.lookupStatus === 'idle') initLustrace(root);
  else if (wiz.lookupStatus === 'done' && wiz._expandLookup) applyPendingExpand();
}

// Vstup na krok Lustrace: čerstvý běh (po zadání dat) NEBO načtení uložených výsledků.
async function initLustrace(root) {
  if (wiz.forceRun) { wiz.forceRun = false; return runLookups(root); }
  wiz.lookupStatus = 'loading';
  const ok = await loadStoredLookups(root);
  if (!ok) return runLookups(root);
}

// Načte uložené výsledky lustrací (GET /lookups) bez nového běhu. Vrací true, když jsou.
async function loadStoredLookups(root) {
  const types = lookupTypeList();
  try {
    const r = await apiAmlGetLookups(wiz.caseId);
    const res = r.results || [];
    if (!types.some(t => res.find(x => x.lookup_type === t))) { wiz.lookupStatus = 'idle'; return false; }
    wiz.lookups = types.map(t => res.find(x => x.lookup_type === t)
      || { lookup_type: t, status: 'error', details: 'Bez odpovědi.' });
    logLookupErrors(wiz.lookups);
    wiz.lookupStatus = 'done';
    if (wiz.step === 1) { renderLustrace(root); renderFoot(); }
    renderContext();
    return true;
  } catch { wiz.lookupStatus = 'idle'; return false; }
}

// Technický detail chyby zdroje jde jen do konzole (alerting ho posílá i mailem),
// uživateli se nikdy nezobrazuje — v UI je jen věcná výzva + retry.
function logLookupErrors(list) {
  for (const lk of (list || [])) {
    if (lk && lk.status === 'error') {
      const d = lk.details;
      const detail = typeof d === 'string' ? d : (d && (d.note || JSON.stringify(d))) || '(bez detailu)';
      console.error(`[aml] lustrace '${lk.lookup_type}' se nedokončila:`, detail);
    }
  }
}

async function runLookups(root) {
  const types = lookupTypeList();
  wiz.lookupStatus = 'running';
  wiz.lookups = [];
  renderLustrace(root);       // řádky ve stavu „probíhá"
  renderFoot();               // Další zůstává disabled
  let res;
  try {
    const r = await apiAmlRunLookup(wiz.caseId);
    res = r.results || [];
  } catch {
    res = types.map(t => ({ lookup_type: t, status: 'error', details: 'Lustrace se nezdařila.' }));
  }
  logLookupErrors(res);
  if (wiz.step !== 1) { wiz.lookupStatus = 'done'; return; }   // uživatel mezitím odešel
  // staggered reveal — řádky naskakují postupně
  for (const t of types) {
    const found = res.find(x => x.lookup_type === t)
      || { lookup_type: t, status: 'error', details: 'Bez odpovědi.' };
    wiz.lookups.push(found);
    await new Promise(r => setTimeout(r, 220));
    if (wiz.step === 1) renderLustrace(root);
  }
  wiz.lookupStatus = 'done';
  if (wiz.step === 1) { renderLustrace(root); renderFoot(); }
  renderContext();
}

function toggleLookupDetail(type) {
  const el = document.getElementById(`aml-lk-det-${type}`);
  if (el) el.hidden = !el.hidden;
}

// Klik na nález v panelu → skok na krok Lustrace s rozbaleným detailem dané lustrace.
function openLookupDetail(root, type) {
  wiz._expandLookup = type;
  if (wiz.step === 1) { applyPendingExpand(); return; }
  goToStep(root, 1);   // po načtení lustrace (renderLustrace, stav done) se detail rozbalí
}

// Rozbalí detail čekající lustrace (nastavený z panelu) a odscrolluje k němu.
function applyPendingExpand() {
  const type = wiz._expandLookup; wiz._expandLookup = null;
  if (!type) return;
  const el = document.getElementById(`aml-lk-det-${type}`);
  if (el) { el.hidden = false; try { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch {} }
}

// ── U4 — Ukončit kontrolu (§ 15) ─────────────────────────────────────
// Stáhne PDF (Uint8Array) pod daným názvem.
function downloadPdf(bytes, filename) {
  const blob = new Blob([bytes], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

function openTerminateModal(root) {
  if ($('amlTermModal')) return;
  const radios = TERMINATE_REASONS.map(([k, l], i) =>
    `<label class="aml-radio"><input type="radio" name="amlTermReason" value="${k}"${i === 0 ? ' checked' : ''}><span>${esc(l)}</span></label>`
  ).join('');
  const ov = document.createElement('div');
  ov.className = 'aml-modal-ov'; ov.id = 'amlTermModal';
  ov.innerHTML = `<div class="aml-modal">
    <div class="aml-modal-title">Ukončit kontrolu</div>
    <div class="aml-modal-sub">Zvolte důvod ukončení. Vygenerujeme zjednodušený záznam a případ se uloží do archivu jako ukončený.</div>
    <div class="aml-radios aml-term-reasons">${radios}</div>
    <textarea id="amlTermText" class="aml-term-text" rows="3" placeholder="Upřesnění (u jiného důvodu povinné)"></textarea>
    <div class="aml-modal-btns">
      <button class="aml-btn" data-act="close-terminate">Zrušit</button>
      <button class="aml-btn aml-btn-danger" data-act="confirm-terminate">Ukončit kontrolu</button>
    </div>
  </div>`;
  root.appendChild(ov);
}

function closeTerminateModal() { $('amlTermModal')?.remove(); }

async function confirmTerminate(root) {
  if (wiz.terminating) return;
  const sel = root.querySelector('input[name="amlTermReason"]:checked');
  if (!sel) { showToast('Vyberte prosím důvod ukončení.'); return; }
  const reasonKey = sel.value;
  const text = (root.querySelector('#amlTermText')?.value || '').trim();
  const reasonLabel = (TERMINATE_REASONS.find(([k]) => k === reasonKey) || [])[1] || 'Ukončeno';
  if (reasonKey === 'other' && !text) { showToast('U jiného důvodu prosím doplňte popis.'); return; }
  wiz.terminating = true;
  const btn = root.querySelector('[data-act="confirm-terminate"]');
  if (btn) { btn.disabled = true; btn.textContent = 'Ukončuji…'; }
  const reasonForDb = `${reasonLabel}${text ? ' — ' + text : ''}`;
  let res;
  try { res = await apiAmlTerminate(wiz.caseId, reasonForDb); } catch { res = null; }
  if (!res || res.error) {
    wiz.terminating = false;
    if (btn) { btn.disabled = false; btn.textContent = 'Ukončit kontrolu'; }
    showToast('Ukončení se nezdařilo, zkuste to znovu.');
    return;
  }
  closeTerminateModal();
  await ensureProfileLoaded();
  try {
    const bytes = await buildTerminationPdf({
      caseNumber: wiz.case_number,
      povinnaOsoba: getProfile(),
      dateISO: res.completed_at,
      clientName: [wiz.data.client_name, wiz.data.client_surname].filter(Boolean).join(' '),
      clientNameOriginal: wiz.data.client_name_original || '',
      clientBirthDate: wiz.data.client_birth_date || '',
      clientDocNumber: wiz.data.client_doc_number || '',
      reasonLabel, reasonText: text,
    });
    downloadPdf(bytes, `${wiz.case_number || 'AML'}-ukonceno.pdf`);
  } catch {
    showToast('Případ byl ukončen, ale PDF se nepodařilo vygenerovat.');
  }
  wiz.terminating = false;
  renderTerminated(root, reasonLabel);
}

function renderTerminated(root, reasonLabel) {
  renderCaseNum();
  const steps = $('amlSteps'); if (steps) steps.innerHTML = '';
  const foot = $('amlFoot'); if (foot) foot.innerHTML = '';
  $('amlMain').innerHTML = `<div class="aml-card aml-done">
    <div class="aml-h">Kontrola ukončena</div>
    <div class="aml-ai-note">Případ ${esc(wiz.case_number || '')} byl ukončen (${esc(reasonLabel)}). Zjednodušený záznam se stáhl a případ najdete v archivu se štítkem „ukončeno".</div>
    <div class="aml-upload-btns">
      <button class="aml-btn aml-btn-primary" data-act="go-archive">Do archivu</button>
      <button class="aml-btn" data-act="new">Nová kontrola</button>
    </div>
  </div>`;
}

function renderFoot() {
  const foot = $('amlFoot');
  if (!foot) return;
  // Dokončený záznam (krok 4) — bez navigace, obrazovka má vlastní tlačítka.
  if (wiz.step === 4 && wiz.completeResult) { foot.innerHTML = ''; return; }
  // U4: „Ukončit kontrolu" (sekundární) je dostupné na všech krocích vedle Zpět/Další.
  const term = `<button class="aml-btn aml-btn-ghost aml-btn-terminate" data-act="open-terminate">Ukončit kontrolu</button>`;
  let nav = '';
  if (wiz.step === 0) {
    nav = '';   // krok Údaje klienta má vlastní tlačítko „pokračovat na lustraci" v kartě
  } else if (wiz.step >= 1 && wiz.step <= 3) {
    // Lustrace (1): Další disabled dokud lustrace neproběhne (loading — výsledky
    // se načítají/běží). Riziko (3): vždy klikatelné — bez závazného rozhodnutí se
    // po kliku ukáže toast + zvýraznění sekce, nikdy tichý disable.
    let dis = '';
    if (wiz.step === 1 && wiz.lookupStatus !== 'done') dis = ' disabled';
    nav = `<button class="aml-btn" data-act="back">Zpět</button>
           <button class="aml-btn aml-btn-primary" data-act="next"${dis}>Další</button>`;
  } else { // Záznam (krok 4)
    nav = `<button class="aml-btn" data-act="back">Zpět</button>`;
  }
  foot.innerHTML = `<div class="aml-foot-left">${term}</div><div class="aml-foot-right">${nav}</div>`;
}
