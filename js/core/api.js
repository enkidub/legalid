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

// Spustí všech 5 lustrací nad případem, vrátí { results: [...] } a uloží je do aml_lookups.
export async function apiAmlRunLookup(caseId) {
  const r = await fetch(`${WORKER_URL}/api/aml/lookup/run`, {
    method: 'POST', credentials: 'include',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ case_id: caseId })
  });
  return r.json();
}

// remember: true → dlouhá session (90 dní), jinak 7 dní.
export async function apiSendMagicLink(email, remember = false) {
  const r = await fetch(`${WORKER_URL}/auth/send`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, remember })
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
