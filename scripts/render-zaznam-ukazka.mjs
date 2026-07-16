// scripts/render-zaznam-ukazka.mjs
// Vygeneruje ukázkový AML záznam z REÁLNÉ pdf-lib šablony frontendu (js/aml/pdf.js)
// a vyrenderuje jeho první stranu do assets/landing/zaznam-ukazka.png.
// Navíc vytáhne z wizard-demo.mp4 úspěchový frame → wizard-demo-poster.png.
//
// Šablona (buildRecordPdf) je bezstavová funkce (data → Uint8Array), jen fetchuje
// fonty z /assets/fonts/ a lazy-importuje pdf-lib z CDN — obojí funguje v prohlížeči
// Playwrightu (fonty ze statického serveru, CDN z internetu). Proto ji voláme přímo
// v page.evaluate a nemusíme nic portovat do Node. PDF→PNG přes pdf.js (prostředí
// nemá pdftoppm/imagemagick). Předpoklad: běžící static server na 127.0.0.1:8123.

import { createRequire } from 'module';
import { writeFileSync } from 'fs';
const require = createRequire('C:/Users/Dell/Documents/legalid/package.json');
const { chromium } = require('playwright');

const BASE = 'http://127.0.0.1:8123';
const OUT_DIR = 'C:/Users/Dell/Documents/legalid/assets/landing';

// Mock — žádná reálná osoba (Jan Novák), povinná osoba JUDr. Jana Vzorová (advokátka).
const mock = {
  caseNumber: 'AML-202607-N7K2QX',
  povinnaOsoba: {
    display_name: 'JUDr. Jana Vzorová, advokátka',
    entity_type: 'advokat',
    reg_number: '99999',
    address: 'Advokátní 12, 110 00 Praha 1',
  },
  dateISO: '2026-07-16T09:12:00.000Z',
  regenerated: false,
  subjectType: 'fo',
  client: {
    name: 'Jan Novák', birthDate: '15.03.1985', nationality: 'Česká republika',
    docType: 'Občanský průkaz', docNumber: '123456789',
  },
  company: {},
  identification: { method: 'personal', verifier: null },
  deal: { relationType: 'jednorazovy', valueBand: '1k_15k', countries: 'Česko',
          category: 'prevod_nemovitosti', purpose: 'Zprostředkování převodu bytové jednotky v Praze.' },
  source: { type: 'uspory', detail: 'Dlouhodobé úspory z příjmů ze zaměstnání.' },
  consistency: null,
  lookups: [
    { type: 'mvcr', status: 'clean', checked_at: '2026-07-16T09:12:30.000Z' },
    { type: 'isir', status: 'clean', checked_at: '2026-07-16T09:12:31.000Z' },
    { type: 'ares', status: 'clean', checked_at: '2026-07-16T09:12:32.000Z' },
    { type: 'sanctions', status: 'clean', checked_at: '2026-07-16T09:12:33.000Z' },
    { type: 'pep', status: 'clean', checked_at: '2026-07-16T09:12:34.000Z' },
  ],
  documents: [],
  risk: {
    suggestion: {
      suggested_level: 'nizke',
      factors: [
        { factor: 'Jednorázový obchod nízké hodnoty', impact: 'neutral', note_cs: 'Hodnota v pásmu 1 000–15 000 €.' },
        { factor: 'Klient bez negativních nálezů', impact: 'neutral', note_cs: 'Všechny lustrace bez shody.' },
      ],
      reasoning_cs: 'Klient nevykazuje rizikové faktory, všechny lustrace jsou bez shody a zdroj prostředků je doložen.',
    },
    finalLevel: 'nizke', justification: '', decidedAt: '2026-07-16T09:13:00.000Z',
  },
  declaration: { pep: 'not', sanctions: true, source: true },
  recordSha: '15514dcbc82440aab6ee19399e4f5b53c9a1e7d20f4b3a6c8e2f1099aa77bb42',
};

const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1400, height: 1000 }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
page.on('console', m => { if (m.type() === 'error') console.log('PAGEERR:', m.text()); });
await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded', timeout: 25000 });

// ── 1) PDF z reálné šablony → PNG přes pdf.js ──
const pngDataUrl = await page.evaluate(async (mock) => {
  const mod = await import('/js/aml/pdf.js');
  const pdfBytes = await mod.buildRecordPdf(mock);   // Uint8Array (reálná šablona)
  const pdfjs = await import('https://cdn.jsdelivr.net/npm/pdfjs-dist@4.0.379/build/pdf.min.mjs');
  pdfjs.GlobalWorkerOptions.workerSrc = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.0.379/build/pdf.worker.min.mjs';
  const doc = await pdfjs.getDocument({ data: pdfBytes }).promise;
  const pg = await doc.getPage(1);
  const scale = 150 / 72;                              // ~150 DPI
  const vp = pg.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(vp.width); canvas.height = Math.ceil(vp.height);
  const c = canvas.getContext('2d');
  c.fillStyle = '#ffffff'; c.fillRect(0, 0, canvas.width, canvas.height);
  await pg.render({ canvasContext: c, viewport: vp }).promise;
  return canvas.toDataURL('image/png');
}, mock);

writeFileSync(`${OUT_DIR}/zaznam-ukazka.png`, Buffer.from(pngDataUrl.split(',')[1], 'base64'));
console.log('zaznam-ukazka.png OK');

// ── 2) Poster videa — úspěchový frame z wizard-demo.mp4 ──
const poster = await page.evaluate(async (base) => {
  const v = document.createElement('video');
  v.src = `${base}/assets/landing/wizard-demo.mp4`; v.muted = true; v.crossOrigin = 'anonymous';
  document.body.appendChild(v);
  await new Promise((res, rej) => { v.addEventListener('loadeddata', res, { once: true }); v.addEventListener('error', rej, { once: true }); v.load(); });
  await new Promise(res => { v.addEventListener('seeked', res, { once: true }); v.currentTime = Math.max(0, (v.duration || 1) - 0.25); });
  const canvas = document.createElement('canvas');
  canvas.width = v.videoWidth; canvas.height = v.videoHeight;
  canvas.getContext('2d').drawImage(v, 0, 0);
  return canvas.toDataURL('image/png');
}, BASE).catch(e => { console.log('poster fail:', e.message); return null; });

if (poster) {
  writeFileSync(`${OUT_DIR}/wizard-demo-poster.png`, Buffer.from(poster.split(',')[1], 'base64'));
  console.log('wizard-demo-poster.png OK');
}

await b.close();
console.log('DONE');
