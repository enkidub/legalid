// legalid.cz — js/core/api.js
// Tenké fetch wrappery na Cloudflare Worker. Jediný zdroj URL = CONFIG.workerUrl.
import { CONFIG } from './state.js';

const WORKER_URL = CONFIG.workerUrl;

export async function apiOcr(images) {
  const res = await fetch(`${WORKER_URL}/ocr`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ images })
  });
  return res.json();
}

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
