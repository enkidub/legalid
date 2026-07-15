// legalid.cz — js/core/api.js
// Tenké fetch wrappery na Cloudflare Worker. Jediný zdroj URL = CONFIG.workerUrl.
import { CONFIG } from './state.js';

const WORKER_URL = CONFIG.workerUrl;

// mode: 'dolozka' (default — beze změny, Doložka) | 'aml'. side: 'front' | 'back' (jen pro AML).
// multi: true → všechna média jsou jeden doklad (přední+zadní / více stran / PDF).
export async function apiOcr(images, mode = 'dolozka', side = null, multi = false) {
  const res = await fetch(`${WORKER_URL}/ocr`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ images, mode, side, multi })
  });
  return res.json();
}

// ── AML (vyžadují session, credentials: 'include') ──
export async function apiAmlCreateCase() {
  const r = await fetch(`${WORKER_URL}/api/aml/case/create`, { method: 'POST', credentials: 'include' });
  return r.json();
}

export async function apiAmlGetCase(id) {
  const r = await fetch(`${WORKER_URL}/api/aml/case/${id}`, { credentials: 'include' });
  return r.json();
}

export async function apiAmlPatchCase(id, patch) {
  const r = await fetch(`${WORKER_URL}/api/aml/case/${id}`, {
    method: 'PATCH', credentials: 'include',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch)
  });
  return r.json();
}

export async function apiAmlAddDocument(id, doc) {
  const r = await fetch(`${WORKER_URL}/api/aml/case/${id}/document`, {
    method: 'POST', credentials: 'include',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(doc)
  });
  return r.json();
}

export async function apiAmlListCases() {
  const r = await fetch(`${WORKER_URL}/api/aml/cases`, { credentials: 'include' });
  return r.json();
}

// Uložení klienti (distinct z případů uživatele) — zdroj pro „Ze seznamu".
export async function apiAmlListClients() {
  const r = await fetch(`${WORKER_URL}/api/aml/clients`, { credentials: 'include' });
  return r.json();
}

// Předvyplnění firmy z ARES podle IČO (subject_type='po').
export async function apiAmlAres(ico) {
  const r = await fetch(`${WORKER_URL}/api/aml/ares/${encodeURIComponent(ico)}`, { credentials: 'include' });
  return r.json();
}

// Uložené výsledky lustrací (bez nového běhu) — pro návrat na krok Lustrace.
export async function apiAmlGetLookups(caseId) {
  const r = await fetch(`${WORKER_URL}/api/aml/case/${caseId}/lookups`, { credentials: 'include' });
  return r.json();
}

// Spustí všech 5 lustrací nad případem, vrátí { results: [...] } a uloží je do aml_lookups.
export async function apiAmlRunLookup(caseId) {
  const r = await fetch(`${WORKER_URL}/api/aml/lookup/run`, {
    method: 'POST', credentials: 'include',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ case_id: caseId })
  });
  return r.json();
}

// Blok 3 — analýza podpůrného dokumentu (AI). Vrací { doc_type, parties, amounts, ..., sha256, document_id }.
export async function apiAmlAnalyzeDocument(caseId, { filename, mime, data_base64 }) {
  const r = await fetch(`${WORKER_URL}/api/aml/${caseId}/analyze-document`, {
    method: 'POST', credentials: 'include',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ filename, mime, data_base64 })
  });
  return r.json();
}

// Blok 3 — kontrola konzistence účelu/zdroje s dokumenty. Vrací { consistency, signals, summary_cs }.
export async function apiAmlCheckConsistency(caseId, payload) {
  const r = await fetch(`${WORKER_URL}/api/aml/${caseId}/check-consistency`, {
    method: 'POST', credentials: 'include',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
  });
  return r.json();
}

// Blok 4 — AI návrh rizika (deterministická pravidla + Anthropic). Vrací { suggested_level, factors, reasoning_cs }.
export async function apiAmlRiskSuggest(caseId, payload) {
  const r = await fetch(`${WORKER_URL}/api/aml/${caseId}/risk-suggest`, {
    method: 'POST', credentials: 'include',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload || {})
  });
  return r.json();
}

// Blok 4 — závazné rozhodnutí o riziku (serverová validace povinného odůvodnění).
export async function apiAmlRiskDecision(caseId, payload) {
  const r = await fetch(`${WORKER_URL}/api/aml/${caseId}/risk-decision`, {
    method: 'POST', credentials: 'include',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
  });
  return r.json();
}

// Centrální evidence klientů — fulltext hledání (GET /api/clients?q=).
export async function apiClientsSearch(q = '') {
  const url = q ? `${WORKER_URL}/api/clients?q=${encodeURIComponent(q)}` : `${WORKER_URL}/api/clients`;
  const r = await fetch(url, { credentials: 'include' });
  return r.json();
}

// Detail klienta + historie AML případů.
export async function apiClientGet(id) {
  const r = await fetch(`${WORKER_URL}/api/clients/${id}`, { credentials: 'include' });
  return r.json();
}

// Vytvoření/upsert klienta (created_from: 'manual' | 'dolozka'). Vrací { client, created }.
export async function apiClientCreate(data) {
  const r = await fetch(`${WORKER_URL}/api/clients`, {
    method: 'POST', credentials: 'include',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data)
  });
  return r.json();
}

export async function apiClientUpdate(id, patch) {
  const r = await fetch(`${WORKER_URL}/api/clients/${id}`, {
    method: 'PATCH', credentials: 'include',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch)
  });
  return r.json();
}

// Smazání klienta. status 409 (r.ok=false) = má navázané AML případy.
export async function apiClientDelete(id) {
  const r = await fetch(`${WORKER_URL}/api/clients/${id}`, { method: 'DELETE', credentials: 'include' });
  return { ok: r.ok, status: r.status, data: await r.json().catch(() => ({})) };
}

// Bulk import z localStorage → { created, merged }.
export async function apiClientsImport(clients) {
  const r = await fetch(`${WORKER_URL}/api/clients/import`, {
    method: 'POST', credentials: 'include',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ clients })
  });
  return r.json();
}

// Blok 5 — dokončení kontroly: status='completed' + next_review_due + record_sha256.
export async function apiAmlComplete(caseId, record_sha256) {
  const r = await fetch(`${WORKER_URL}/api/aml/${caseId}/complete`, {
    method: 'POST', credentials: 'include',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ record_sha256 })
  });
  return r.json();
}

// Blok 5 — metadata podpůrných dokumentů (pro archiv/regeneraci PDF bez příloh).
export async function apiAmlGetDocuments(caseId) {
  const r = await fetch(`${WORKER_URL}/api/aml/case/${caseId}/documents`, { credentials: 'include' });
  return r.json();
}

// U4 — ukončení kontroly (§ 15): status='terminated' + důvod. Vrací { ok, completed_at }.
export async function apiAmlTerminate(caseId, reason) {
  const r = await fetch(`${WORKER_URL}/api/aml/${caseId}/terminate`, {
    method: 'POST', credentials: 'include',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reason })
  });
  return r.json();
}

// Session je vždy dlouhá (90 dní) — řeší worker (bez volby „zůstat přihlášen").
export async function apiSendMagicLink(email) {
  const r = await fetch(`${WORKER_URL}/auth/send`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email })
  });
  return { ok: r.ok, data: await r.json() };
}

export async function apiTrackUsage() {
  const r = await fetch(`${WORKER_URL}/api/track`, {
    method: 'POST',
    credentials: 'include',
  });
  return r.json();
}

export async function apiCheckSession() {
  const r = await fetch(`${WORKER_URL}/auth/me`, { credentials: 'include' });
  return r.json();
}

export async function apiLogout() {
  await fetch(`${WORKER_URL}/auth/logout`, { method: 'POST', credentials: 'include' });
}

// Žádost o demo (Blok B) — bez session; worker pošle e-mail majiteli a uloží do D1.
export async function apiDemoRequest(payload) {
  const r = await fetch(`${WORKER_URL}/api/demo-request`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return { ok: r.ok, status: r.status, data: await r.json().catch(() => ({})) };
}
