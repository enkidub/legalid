// scripts/record-landing-demo.mjs
// Nahraje demo video celého AML wizardu (5 kroků) na legalid.cz (Playwright + Chromium)
// a rovnou ho sestříhá + zkonvertuje ffmpeg-em na assets/landing/wizard-demo.mp4 + poster.
//
// Spuštění:
//   LEGALID_SESSION="<hodnota cookie session>" node scripts/record-landing-demo.mjs
//
// Cookie viz README-record-demo.md. Skript NIC nemaže — jen vytvoří jeden testovací
// AML case (jeho číslo vypíše na konci, ať ho v archivu poznáš a smažeš).
//
// Video: řízené scrollování (aby bylo vidět to podstatné), skrytá patička/hlavička,
// vystřižené mrtvé čekání (lustrace/AI/PDF → zůstane jen krátký záblesk spinneru).

import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdirSync, statSync, existsSync, writeFileSync, readdirSync, unlinkSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const FFMPEG = require('ffmpeg-static');

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const OUT_DIR = join(HERE, 'output');
const ASSETS = join(ROOT, 'assets', 'landing');
const MP4 = join(ASSETS, 'wizard-demo.mp4');
const POSTER = join(ASSETS, 'wizard-demo-poster.png');   // landing používá tento poster (click-to-play)
const SITE = 'https://legalid.cz/';
const WORKER_HOST = 'legalid.kuba-houser.workers.dev';

const SESSION = process.env.LEGALID_SESSION;
if (!SESSION) {
  console.error('Chybí LEGALID_SESSION. Spusť: LEGALID_SESSION="<cookie>" node scripts/record-landing-demo.mjs');
  console.error('Jak cookie získat: viz scripts/README-record-demo.md');
  process.exit(1);
}

const KEEP_LEAD = 1.0;   // kolik s záblesku spinneru nechat na začátku čekání
const KEEP_TAIL = 0.4;   // kolik s nechat na konci (odhalení výsledku)

const sleep = ms => new Promise(r => setTimeout(r, ms));
const jitter = (base, spread = 120) => base + Math.floor(Math.random() * spread);

async function humanFill(page, selector, value) {
  const el = page.locator(selector);
  await el.scrollIntoViewIfNeeded().catch(() => {});
  await el.click();
  await el.fill('');
  await el.pressSequentially(value, { delay: 35 });
  await sleep(jitter(400));
}

// Plynulý scroll na prvek (aby divák viděl, co se děje).
async function scrollTo(page, selector, block = 'center') {
  try { await page.locator(selector).first().evaluate((el, b) => el.scrollIntoView({ behavior: 'smooth', block: b }), block); } catch {}
  await sleep(550);
}
async function scrollTop(page) {
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'smooth' })).catch(() => {});
  await sleep(550);
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  mkdirSync(ASSETS, { recursive: true });
  // úklid starých segmentů
  for (const f of readdirSync(OUT_DIR)) if (/^seg_\d+\.mp4$|^concat\.txt$/.test(f)) try { unlinkSync(join(OUT_DIR, f)); } catch {}

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    locale: 'cs-CZ',
    timezoneId: 'Europe/Prague',
    acceptDownloads: true,
    recordVideo: { dir: OUT_DIR, size: { width: 1440, height: 900 } },
  });

  await context.addCookies([{
    name: 'session', value: SESSION, domain: WORKER_HOST, path: '/',
    httpOnly: true, secure: true, sameSite: 'None',
  }]);
  await context.addInitScript(() => { try { localStorage.setItem('installBannerDismissed', '1'); } catch {} });

  const page = await context.newPage();
  const videoStart = Date.now();
  const vt = () => (Date.now() - videoStart) / 1000;   // čas v ose videa (s)
  let trimSec = 0;
  const cuts = [];   // [start,end] úseky k vystřižení (mrtvé čekání)

  // Čeká na výsledek a zaznamená mrtvý úsek čekání k vystřižení (nechá lead+tail).
  async function waitCut(label, fn) {
    const s = vt();
    await fn();
    const e = vt();
    if (e - s > KEEP_LEAD + KEEP_TAIL) cuts.push([s + KEEP_LEAD, e - KEEP_TAIL]);
    console.log(`  · ${label}: ${(e - s).toFixed(1)} s`);
  }

  let createdCaseId = null, createdCaseNumber = null;
  page.on('response', async (res) => {
    if (res.url().includes('/api/aml/case/create') && res.request().method() === 'POST') {
      try { const j = await res.json(); if (j) { createdCaseId = j.case_id ?? createdCaseId; createdCaseNumber = j.case_number ?? createdCaseNumber; } } catch {}
    }
  });

  console.log('→ Otevírám', SITE);
  await page.goto(SITE, { waitUntil: 'domcontentloaded' });
  // Skryj pravou část hlavičky (e-mail) i globální patičku (rušivá tmavá plocha).
  await page.addStyleTag({ content: '#headerAuth{display:none!important}#siteFooter{display:none!important}' });

  await page.waitForSelector('#amlRoot .aml-card', { timeout: 30000 });
  const newBtn = page.locator('[data-act="new"]');
  if (await newBtn.count()) { await newBtn.first().click(); }

  // ── Krok 1/5 — Údaje klienta ──
  await page.waitForSelector('.aml-tile-src[data-source="manual"]', { timeout: 20000 });
  trimSec = Math.max(0, vt() - 0.4);   // od tohoto času nechat video (úvod = landing se ořízne)
  await scrollTop(page);
  await sleep(500);
  await page.locator('.aml-seg[data-subject="fo"]').click();
  await sleep(350);
  await page.locator('.aml-tile-src[data-source="manual"]').click();
  await page.waitForSelector('#aml_f_client_name', { timeout: 10000 });
  await sleep(400);

  await humanFill(page, '#aml_f_client_name', 'Jan');
  await humanFill(page, '#aml_f_client_surname', 'Novák');
  await humanFill(page, '#aml_f_client_birth_date', '15.03.1985');
  await page.selectOption('#aml_f_client_doc_type', 'OP');
  await sleep(300);
  await humanFill(page, '#aml_f_client_doc_number', '123456789');
  await humanFill(page, '#aml_f_client_doc_valid_until', '01.01.2030');
  await humanFill(page, '#aml_f_client_nationality', 'Česká republika');
  await page.selectOption('#aml_f_client_gender', 'M');   // U2: povinné bez rodného čísla
  await sleep(400);
  await scrollTo(page, '#amlVerifierCheck');
  await page.locator('#amlVerifierCheck').check();         // U3: prohlášení ověřující osoby
  await sleep(500);
  await scrollTo(page, '#amlContinue');
  await page.waitForSelector('#amlContinue:not([disabled])', { timeout: 15000 });
  await sleep(700);
  await page.locator('#amlContinue').click();

  // ── Krok 2/5 — Lustrace ──
  console.log('→ Lustrace…');
  await scrollTop(page);
  await waitCut('lustrace', () => page.waitForSelector('[data-act="rerun-lookups"]', { timeout: 60000 }));
  await scrollTo(page, '.aml-lookups', 'start');
  await sleep(1600);   // divák vidí výsledky
  await scrollTo(page, '#amlFoot [data-act="next"]');
  await page.locator('#amlFoot [data-act="next"]:not([disabled])').click();

  // ── Krok 3/5 — Účel obchodu ──
  await page.waitForSelector('[data-act="set-relation"][data-val="jednorazovy"]', { timeout: 15000 });
  await scrollTop(page);
  await sleep(400);
  await page.locator('[data-act="set-relation"][data-val="jednorazovy"]').click();
  await sleep(jitter(450));
  await page.locator('[data-act="set-band"][data-val="1k_15k"]').click();
  await sleep(jitter(450));
  await humanFill(page, '#aml_f_deal_countries', 'Česko');
  await page.selectOption('#aml_f_purpose_category', 'prevod_nemovitosti');
  await sleep(350);
  await humanFill(page, '#aml_f_business_purpose', 'Zprostředkování prodeje bytu 2+kk, Praha');
  await scrollTo(page, '#aml_f_source_of_funds_type');
  await page.selectOption('#aml_f_source_of_funds_type', 'uspory');
  await sleep(1200);
  await scrollTo(page, '#amlFoot [data-act="next"]');
  await page.locator('#amlFoot [data-act="next"]:not([disabled])').click();

  // ── Krok 4/5 — Riziko ──
  console.log('→ AI návrh rizika…');
  await scrollTop(page);
  await waitCut('AI návrh', () => page.waitForSelector('.aml-ai-card .aml-risk-badge', { timeout: 60000 }));
  await scrollTo(page, '.aml-ai-card', 'start');
  await sleep(2200);   // divák čte AI kartu a faktory
  await scrollTo(page, '.aml-decl', 'start');
  await sleep(500);
  await page.locator('input[name="amlPep"][value="not"]').check();
  await sleep(300);
  await waitCut('AI přepočet', () => page.waitForSelector('.aml-ai-card .aml-risk-badge', { timeout: 60000 }));
  await page.locator('#amlDeclSanctions').check();
  await sleep(300);
  await page.locator('#amlDeclSource').check();
  await sleep(400);
  await scrollTo(page, '.aml-decision', 'start');
  await sleep(600);
  await page.waitForSelector('#amlDecideBtn:not([disabled])', { timeout: 10000 });
  await page.locator('#amlDecideBtn').click();
  await sleep(900);
  await scrollTo(page, '#amlFoot [data-act="next"]');
  await page.locator('#amlFoot [data-act="next"]:not([disabled])').click();

  // ── Krok 5/5 — Záznam ──
  await page.waitForSelector('#amlGenBtn', { timeout: 15000 });
  await scrollTop(page);
  await sleep(1300);   // rekapitulace
  console.log('→ Generuji PDF…');
  await scrollTo(page, '#amlGenBtn');
  await waitCut('PDF', async () => { await page.locator('#amlGenBtn').click(); await page.waitForSelector('.aml-done', { timeout: 45000 }); });
  await scrollTop(page);
  await sleep(2500);   // úspěchová obrazovka

  const hb = await page.locator('.app-header').boundingBox();
  const headerH = Math.max(0, Math.round(hb?.height || 56));

  const video = page.video();
  await context.close();
  await browser.close();

  const srcVideo = video ? await video.path() : null;
  console.log('\n✓ Nahrávání hotovo. Header k ořezu:', headerH, 'px. Vystřižené úseky:', cuts.length);
  if (!srcVideo || !existsSync(srcVideo)) { console.error('Video se nenahrálo.'); printSummary(null, null, createdCaseNumber, createdCaseId); return; }

  // ── Post-processing: crop headeru + vystřižení mrtvých úseků (concat) + scale/fps ──
  const videoEnd = ffDuration(srcVideo);
  const keep = computeKeep(trimSec, videoEnd, cuts);
  const vf = `crop=iw:ih-${headerH}:0:${headerH},scale=1280:-2,fps=24`;

  const build = (crf) => {
    const segs = keep.map((r, i) => {
      const f = join(OUT_DIR, `seg_${i}.mp4`);
      execFileSync(FFMPEG, ['-y', '-ss', r[0].toFixed(2), '-i', srcVideo, '-t', (r[1] - r[0]).toFixed(2),
        '-vf', vf, '-c:v', 'libx264', '-crf', String(crf), '-pix_fmt', 'yuv420p', '-an', f],
        { stdio: ['ignore', 'ignore', 'pipe'] });
      return f;
    });
    const list = join(OUT_DIR, 'concat.txt');
    writeFileSync(list, segs.map(s => `file '${s.replace(/\\/g, '/')}'`).join('\n'));
    execFileSync(FFMPEG, ['-y', '-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', '-movflags', '+faststart', MP4],
      { stdio: ['ignore', 'ignore', 'pipe'] });
  };

  console.log('→ Stříhám a konvertuji (crf 28)…');
  build(28);
  let sizeMB = statSync(MP4).size / (1024 * 1024);
  if (sizeMB > 3) { console.log(`  ${sizeMB.toFixed(2)} MB > 3 MB → crf 30…`); build(30); sizeMB = statSync(MP4).size / (1024 * 1024); }

  console.log('→ Poster z úspěchové obrazovky…');
  execFileSync(FFMPEG, ['-y', '-sseof', '-2', '-i', MP4, '-frames:v', '1', '-q:v', '2', POSTER], { stdio: ['ignore', 'ignore', 'pipe'] });

  const dur = ffDuration(MP4);
  const frames = [];
  for (const [label, t] of [['start', '0.5'], ['mid', (dur / 2).toFixed(1)], ['end', Math.max(1, dur - 1).toFixed(1)]]) {
    const f = join(OUT_DIR, `verify_${label}.png`);
    try { execFileSync(FFMPEG, ['-y', '-ss', t, '-i', MP4, '-frames:v', '1', '-q:v', '2', f], { stdio: ['ignore', 'ignore', 'pipe'] }); frames.push(f); } catch {}
  }
  printSummary(dur, sizeMB, createdCaseNumber, createdCaseId, frames);
}

// Doplněk keep-úseků = [start,end] mimo vystřižené cuts.
function computeKeep(start, end, cuts) {
  const sorted = cuts.filter(c => c[1] > c[0]).sort((a, b) => a[0] - b[0]);
  const keep = []; let cur = start;
  for (const [cs, ce] of sorted) {
    if (ce <= cur) continue;
    if (cs > cur) keep.push([cur, Math.min(cs, end)]);
    cur = Math.max(cur, ce);
    if (cur >= end) break;
  }
  if (cur < end) keep.push([cur, end]);
  return keep.filter(r => r[1] - r[0] > 0.15);
}

// Délka (s) přes ffmpeg (parsuje Duration ze stderr; ffmpeg-static nemá ffprobe).
function ffDuration(file) {
  try { execFileSync(FFMPEG, ['-i', file], { stdio: ['ignore', 'ignore', 'pipe'] }); }
  catch (e) { const m = String(e.stderr || '').match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/); if (m) return (+m[1]) * 3600 + (+m[2]) * 60 + parseFloat(m[3]); }
  return 0;
}

function printSummary(dur, sizeMB, caseNumber, caseId, frames) {
  console.log('\n──────── SHRNUTÍ ────────');
  if (dur != null) console.log('Délka videa:', dur ? `${dur.toFixed(1)} s` : '(neznámá)');
  if (sizeMB != null) console.log('Velikost MP4:', `${sizeMB.toFixed(2)} MB`, '→', MP4);
  console.log('Poster:', POSTER);
  console.log('Číslo testovacího případu (smaž v archivu):', caseNumber || '(nezachyceno)');
  console.log('Case ID:', caseId ?? '(nezachyceno)');
  if (frames?.length) { console.log('Ověřovací framy:'); frames.forEach(f => console.log('  ', f)); }
}

main().catch(err => { console.error(err); process.exit(1); });
