// scripts/record-landing-demo.mjs
// Nahraje demo video celého AML wizardu (5 kroků) na legalid.cz (Playwright + Chromium)
// a rovnou ho zkonvertuje ffmpeg-em na assets/landing/wizard-demo.mp4 + poster .png.
//
// Spuštění:
//   LEGALID_SESSION="<hodnota cookie session>" node scripts/record-landing-demo.mjs
//
// Cookie viz README-record-demo.md. Skript NIC nemaže — jen vytvoří jeden testovací
// AML case (jeho číslo vypíše na konci, ať ho v archivu poznáš a smažeš).

import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdirSync, statSync, existsSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const FFMPEG = require('ffmpeg-static');   // cesta k bundlenému ffmpeg.exe

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const OUT_DIR = join(HERE, 'output');
const ASSETS = join(ROOT, 'assets', 'landing');
const MP4 = join(ASSETS, 'wizard-demo.mp4');
const POSTER = join(ASSETS, 'wizard-demo.png');
const SITE = 'https://legalid.cz/';
const WORKER_HOST = 'legalid.kuba-houser.workers.dev';   // doména session cookie (viz core/state.js)

const SESSION = process.env.LEGALID_SESSION;
if (!SESSION) {
  console.error('Chybí LEGALID_SESSION. Spusť: LEGALID_SESSION="<cookie>" node scripts/record-landing-demo.mjs');
  console.error('Jak cookie získat: viz scripts/README-record-demo.md');
  process.exit(1);
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
const jitter = (base, spread = 150) => base + Math.floor(Math.random() * spread);

// Lidsky vypadající vyplnění pole: klik + psaní po znacích s prodlevou 35 ms.
async function humanFill(page, selector, value) {
  const el = page.locator(selector);
  await el.click();
  await el.fill('');
  await el.pressSequentially(value, { delay: 35 });
  await sleep(jitter(450));   // pauza 400–600 ms mezi poli
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  mkdirSync(ASSETS, { recursive: true });

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    locale: 'cs-CZ',
    timezoneId: 'Europe/Prague',
    acceptDownloads: true,   // krok Záznam stahuje PDF přes blob → povolit, ať flow pokračuje
    recordVideo: { dir: OUT_DIR, size: { width: 1440, height: 900 } },
  });

  // Session cookie (cross-site — pro doménu workeru, kam míří API volání).
  await context.addCookies([{
    name: 'session', value: SESSION, domain: WORKER_HOST, path: '/',
    httpOnly: true, secure: true, sameSite: 'None',
  }]);

  // Install banner nikdy nezobrazovat.
  await context.addInitScript(() => {
    try { localStorage.setItem('installBannerDismissed', '1'); } catch {}
  });

  const page = await context.newPage();

  // Zachyť číslo/ID vytvořeného AML case z odpovědi /api/aml/case/create.
  let createdCaseId = null, createdCaseNumber = null;
  page.on('response', async (res) => {
    if (res.url().includes('/api/aml/case/create') && res.request().method() === 'POST') {
      try { const j = await res.json(); if (j) { createdCaseId = j.case_id ?? createdCaseId; createdCaseNumber = j.case_number ?? createdCaseNumber; } } catch {}
    }
  });

  console.log('→ Otevírám', SITE);
  await page.goto(SITE, { waitUntil: 'domcontentloaded' });

  // Skryj pravou část hlavičky s e-mailem uživatele (navigaci ponech).
  await page.addStyleTag({ content: '#headerAuth{display:none!important}' });

  // Počkej, až se po ověření session namontuje AML wizard.
  await page.waitForSelector('#amlRoot .aml-card', { timeout: 30000 });

  // Pokud naskočila „Rozdělaná kontrola", začni novou.
  const newBtn = page.locator('[data-act="new"]');
  if (await newBtn.count()) { await newBtn.first().click(); }

  // ── Krok 1/5 — Údaje klienta ──
  await page.waitForSelector('.aml-tile-src[data-source="manual"]', { timeout: 20000 });
  await sleep(600);
  await page.locator('.aml-seg[data-subject="fo"]').click();           // typ: Fyzická osoba
  await sleep(400);
  await page.locator('.aml-tile-src[data-source="manual"]').click();   // cesta: Zadat ručně
  await page.waitForSelector('#aml_f_client_name', { timeout: 10000 });
  await sleep(500);

  await humanFill(page, '#aml_f_client_name', 'Jan');
  await humanFill(page, '#aml_f_client_surname', 'Novák');
  await humanFill(page, '#aml_f_client_birth_date', '15.03.1985');
  await page.selectOption('#aml_f_client_doc_type', 'OP');
  await sleep(400);
  await humanFill(page, '#aml_f_client_doc_number', '123456789');
  await humanFill(page, '#aml_f_client_doc_valid_until', '01.01.2030');
  await humanFill(page, '#aml_f_client_nationality', 'Česká republika');
  await sleep(500);

  // U3 — prohlášení ověřující osoby (osobní setkání) je povinné pro odemčení tlačítka.
  await page.locator('#amlVerifierCheck').check();
  await sleep(600);

  // Pokračovat na lustraci (počkej, až se tlačítko odemkne).
  await page.waitForSelector('#amlContinue:not([disabled])', { timeout: 15000 });
  await sleep(1000);   // pauza po dokončení kroku
  await page.locator('#amlContinue').click();

  // ── Krok 2/5 — Lustrace ──
  console.log('→ Čekám na dokončení lustrace…');
  await page.waitForSelector('[data-act="rerun-lookups"]', { timeout: 60000 });
  await sleep(2000);   // pauza na výsledku
  await page.locator('#amlFoot [data-act="next"]:not([disabled])').click();

  // ── Krok 3/5 — Účel obchodu ──
  await page.waitForSelector('[data-act="set-relation"][data-val="jednorazovy"]', { timeout: 15000 });
  await sleep(500);
  await page.locator('[data-act="set-relation"][data-val="jednorazovy"]').click();
  await sleep(jitter(500));
  await page.locator('[data-act="set-band"][data-val="1k_15k"]').click();
  await sleep(jitter(500));
  await humanFill(page, '#aml_f_deal_countries', 'Česko');            // default je Česko; vypíšeme explicitně
  await page.selectOption('#aml_f_purpose_category', 'prevod_nemovitosti');
  await sleep(400);
  await humanFill(page, '#aml_f_business_purpose', 'Zprostředkování prodeje bytu 2+kk, Praha');
  await page.selectOption('#aml_f_source_of_funds_type', 'uspory');
  await sleep(1500);   // pauza na vyplněném kroku (BEZ dokumentů)
  await page.locator('#amlFoot [data-act="next"]:not([disabled])').click();

  // ── Krok 4/5 — Riziko ──
  console.log('→ Čekám na AI návrh rizika…');
  await page.waitForSelector('.aml-ai-card .aml-risk-badge', { timeout: 30000 });
  await sleep(2500);   // divák čte faktory
  await page.locator('input[name="amlPep"][value="not"]').check();    // klient NENÍ PEP
  await sleep(300);
  // Změna PEP re-spustí návrh — počkej, než se karta znovu ustálí.
  await page.waitForSelector('.aml-ai-card .aml-risk-badge', { timeout: 30000 });
  await page.locator('#amlDeclSanctions').check();
  await sleep(300);
  await page.locator('#amlDeclSource').check();
  await sleep(300);
  // Ponech navrženou úroveň, odůvodnění přeskoč.
  await page.waitForSelector('#amlDecideBtn:not([disabled])', { timeout: 10000 });
  await page.locator('#amlDecideBtn').click();
  await sleep(1000);
  await page.locator('#amlFoot [data-act="next"]:not([disabled])').click();

  // ── Krok 5/5 — Záznam ──
  await page.waitForSelector('#amlGenBtn', { timeout: 15000 });
  await sleep(1500);   // rekapitulace
  console.log('→ Generuji PDF záznam…');
  await page.locator('#amlGenBtn').click();
  await page.waitForSelector('.aml-done', { timeout: 45000 });   // úspěchová obrazovka
  await sleep(2500);

  // Výška hlavičky aplikace (pro ořez horního okraje ve videu).
  const hb = await page.locator('.app-header').boundingBox();
  const headerH = Math.max(0, Math.round((hb?.height || 56)));

  // Ukončení nahrávky.
  const video = page.video();
  await context.close();
  await browser.close();

  const srcVideo = video ? await video.path() : null;
  console.log('\n✓ Nahrávání hotovo.');
  console.log('Zdrojové video:', srcVideo);
  console.log('Výška hlavičky k ořezu:', headerH, 'px');

  if (!srcVideo || !existsSync(srcVideo)) {
    console.error('Video se nenahrálo — přeskočen post-processing.');
    printSummary(null, null, createdCaseNumber, createdCaseId);
    return;
  }

  // ── Post-processing (ffmpeg-static) ──
  // crop headeru → scale 1280 → 24 fps → bez zvuku → faststart. Cíl < 3 MB (jinak crf 30).
  const encode = (crf) => {
    execFileSync(FFMPEG, [
      '-y', '-i', srcVideo,
      '-vf', `crop=iw:ih-${headerH}:0:${headerH},scale=1280:-2,fps=24`,
      '-c:v', 'libx264', '-crf', String(crf), '-pix_fmt', 'yuv420p',
      '-an', '-movflags', '+faststart', MP4,
    ], { stdio: ['ignore', 'ignore', 'pipe'] });
  };
  console.log('→ Konvertuji (crf 28)…');
  encode(28);
  let sizeMB = statSync(MP4).size / (1024 * 1024);
  if (sizeMB > 3) {
    console.log(`  ${sizeMB.toFixed(2)} MB > 3 MB → překóduji crf 30…`);
    encode(30);
    sizeMB = statSync(MP4).size / (1024 * 1024);
  }

  // Poster z framu úspěchové obrazovky (2 s před koncem).
  console.log('→ Extrahuji poster…');
  execFileSync(FFMPEG, ['-y', '-sseof', '-2', '-i', MP4, '-frames:v', '1', '-q:v', '2', POSTER],
    { stdio: ['ignore', 'ignore', 'pipe'] });

  // Ověřovací framy (začátek / střed / konec) — vizuální kontrola: žádný e-mail, karta neořízlá.
  const dur = ffprobeDuration(MP4);
  const frames = [];
  for (const [label, t] of [['start', '0.5'], ['mid', String(Math.max(1, (dur / 2)).toFixed(1))], ['end', String(Math.max(1, dur - 1).toFixed(1))]]) {
    const f = join(OUT_DIR, `verify_${label}.png`);
    try { execFileSync(FFMPEG, ['-y', '-ss', t, '-i', MP4, '-frames:v', '1', '-q:v', '2', f], { stdio: ['ignore', 'ignore', 'pipe'] }); frames.push(f); } catch {}
  }

  printSummary(dur, sizeMB, createdCaseNumber, createdCaseId, frames);
}

// Délka videa (s) přes ffmpeg (parsuje Duration ze stderr; ffmpeg-static nemá ffprobe).
function ffprobeDuration(file) {
  try {
    execFileSync(FFMPEG, ['-i', file], { stdio: ['ignore', 'ignore', 'pipe'] });
  } catch (e) {
    const m = String(e.stderr || '').match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
    if (m) return (+m[1]) * 3600 + (+m[2]) * 60 + parseFloat(m[3]);
  }
  return 0;
}

function printSummary(dur, sizeMB, caseNumber, caseId, frames) {
  console.log('\n──────── SHRNUTÍ ────────');
  if (dur != null) console.log('Délka videa:', dur ? `${dur.toFixed(1)} s` : '(neznámá)');
  if (sizeMB != null) console.log('Velikost MP4:', `${sizeMB.toFixed(2)} MB`, '→', MP4);
  console.log('Poster:', POSTER);
  console.log('Číslo testovacího případu (smaž v archivu):', caseNumber || '(nezachyceno)');
  console.log('Case ID:', caseId ?? '(nezachyceno)');
  if (frames?.length) { console.log('Ověřovací framy (zkontroluj: žádný e-mail, karta neořízlá):'); frames.forEach(f => console.log('  ', f)); }
}

main().catch(err => { console.error(err); process.exit(1); });
