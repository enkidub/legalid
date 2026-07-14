// scripts/record-landing-demo.mjs
// Nahraje demo video AML wizardu na legalid.cz (Playwright + Chromium).
//
// Spuštění:
//   LEGALID_SESSION="<hodnota cookie session>" node scripts/record-landing-demo.mjs
//
// Cookie viz README-record-demo.md. Skript NIC nemaže — jen vytvoří jeden testovací
// AML case (jeho ID vypíše na konci). Video uloží do scripts/output/.

import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdirSync } from 'node:fs';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(HERE, 'output');
const SITE = 'https://legalid.cz/';
const WORKER_HOST = 'legalid.kuba-houser.workers.dev';   // doména session cookie (viz core/state.js)

const SESSION = process.env.LEGALID_SESSION;
if (!SESSION) {
  console.error('Chybí LEGALID_SESSION. Spusť: LEGALID_SESSION="<cookie>" node scripts/record-landing-demo.mjs');
  console.error('Jak cookie získat: viz scripts/README-record-demo.md');
  process.exit(1);
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

// Lidsky vypadající vyplnění pole: klik + psaní po znacích s prodlevou.
async function humanFill(page, selector, value) {
  const el = page.locator(selector);
  await el.click();
  await el.fill('');
  await el.pressSequentially(value, { delay: 40 });
  await sleep(350 + Math.floor(Math.random() * 150));   // pauza vypadá přirozeně
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    locale: 'cs-CZ',
    timezoneId: 'Europe/Prague',
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

  // Zachyť ID vytvořeného AML case z odpovědi /api/aml/case/create.
  let createdCaseId = null;
  page.on('response', async (res) => {
    if (res.url().includes('/api/aml/case/create') && res.request().method() === 'POST') {
      try { const j = await res.json(); if (j && j.case_id) createdCaseId = j.case_id; } catch {}
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

  // Krok Údaje klienta.
  await page.waitForSelector('.aml-tile-src[data-source="manual"]', { timeout: 20000 });
  await sleep(600);

  // Typ klienta: Fyzická osoba (default, klikneme explicitně kvůli videu).
  await page.locator('.aml-seg[data-subject="fo"]').click();
  await sleep(400);

  // Cesta: Zadat ručně.
  await page.locator('.aml-tile-src[data-source="manual"]').click();
  await page.waitForSelector('#aml_f_client_name', { timeout: 10000 });
  await sleep(500);

  // Vyplnění formuláře (občanství je povinné → doplněno, jinak se tlačítko neodemkne).
  await humanFill(page, '#aml_f_client_name', 'Jan');
  await humanFill(page, '#aml_f_client_surname', 'Novák');
  await humanFill(page, '#aml_f_client_birth_date', '15.03.1985');
  await page.selectOption('#aml_f_client_doc_type', 'OP');
  await sleep(400);
  await humanFill(page, '#aml_f_client_doc_number', '123456789');
  await humanFill(page, '#aml_f_client_doc_valid_until', '01.01.2030');
  await humanFill(page, '#aml_f_client_nationality', 'Česká republika');
  await sleep(600);

  // Pokračovat na lustraci (počkej, až se tlačítko odemkne).
  await page.waitForSelector('#amlContinue:not([disabled])', { timeout: 15000 });
  await page.locator('#amlContinue').click();

  // Počkej, až lustrace doběhne — indikátorem je tlačítko „Spustit lustraci znovu".
  console.log('→ Čekám na dokončení lustrace…');
  await page.waitForSelector('[data-act="rerun-lookups"]', { timeout: 60000 });
  await sleep(2500);   // pauza na výsledku

  // Ukončení nahrávky.
  const video = page.video();
  await context.close();
  await browser.close();

  const videoPath = video ? await video.path() : null;
  console.log('\n✓ Hotovo.');
  if (videoPath) console.log('Video:', videoPath);
  console.log('Vytvořený AML case ID:', createdCaseId ?? '(nezachyceno)');
  console.log('Konverze na MP4 (viz README):');
  console.log(`  ffmpeg -i "${videoPath}" -vf "scale=1280:-2,fps=24" -c:v libx264 -crf 28 -an -movflags +faststart wizard-demo.mp4`);
}

main().catch(err => { console.error(err); process.exit(1); });
