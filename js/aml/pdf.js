// legalid.cz — js/aml/pdf.js
// Sdílený PDF engine pro AML záznamy (client-side, pdf-lib + fontkit + Noto Sans).
// jsPDF NELZE — nezvládá českou diakritiku. pdf-lib + vložený Noto Sans ano.
//
// Knihovny se lazy-loadují z CDN (jako docx/file-saver v index.html), fonty z /assets/fonts/.
// Export:
//   buildTerminationPdf(data) → Uint8Array  (U4, zjednodušený záznam o neuskutečnění)
//   buildRecordPdf(data)      → Uint8Array  (Blok 5, plný AML záznam) — doplněno později
//   createPdfBuilder()        → Builder     (nízkoúrovňové API pro oba)

import { ENTITY_LABELS, regLabel, dozorFor } from '../core/entities.js';

const CDN_PDFLIB = 'https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/+esm';
const CDN_FONTKIT = 'https://cdn.jsdelivr.net/npm/@pdf-lib/fontkit@1.1.1/+esm';

let _engine = null;
async function loadEngine() {
  if (_engine) return _engine;
  const [pdfLib, fontkitMod] = await Promise.all([import(CDN_PDFLIB), import(CDN_FONTKIT)]);
  _engine = { pdfLib, fontkit: fontkitMod.default || fontkitMod };
  return _engine;
}

let _fontBytes = null;
async function loadFontBytes() {
  if (_fontBytes) return _fontBytes;
  const [reg, bold] = await Promise.all([
    fetch('/assets/fonts/NotoSans-Regular.ttf').then(r => { if (!r.ok) throw new Error('font reg'); return r.arrayBuffer(); }),
    fetch('/assets/fonts/NotoSans-Bold.ttf').then(r => { if (!r.ok) throw new Error('font bold'); return r.arrayBuffer(); }),
  ]);
  _fontBytes = { reg, bold };
  return _fontBytes;
}

// A4 v bodech (pt).
const PAGE_W = 595.28, PAGE_H = 841.89;
const MARGIN = 56;
const CONTENT_W = PAGE_W - 2 * MARGIN;

const NAVY = [0.118, 0.165, 0.267];   // #1e2a44 — nadpisy
const GOLD = [0.722, 0.569, 0.184];   // #b8912f — akcentní linky
const INK = [0.133, 0.149, 0.180];    // #22262e — text
const MUTED = [0.44, 0.47, 0.53];     // meta
const RULE = [0.82, 0.84, 0.88];
const WARN_BG = [0.99, 0.96, 0.90];
const ACCENT = NAVY;                   // zpětná kompat. (žádná modrá)

class Builder {
  constructor(doc, font, fontB, rgb, PDFDocument) {
    this.doc = doc; this.font = font; this.fontB = fontB; this.rgb = rgb;
    this.PDFDocument = PDFDocument;
    this.pages = []; this._newPage();
  }
  _newPage() {
    this.page = this.doc.addPage([PAGE_W, PAGE_H]);
    this.pages.push(this.page);
    this.y = PAGE_H - MARGIN;
  }
  _col(c) { return this.rgb(c[0], c[1], c[2]); }
  ensure(h) { if (this.y - h < MARGIN + 24) this._newPage(); }
  moveDown(h) { this.y -= h; }

  // Zalomí text na řádky dle šířky (respektuje explicitní \n).
  _wrap(text, size, bold, maxWidth) {
    const f = bold ? this.fontB : this.font;
    const out = [];
    for (const rawLine of String(text ?? '').split('\n')) {
      const words = rawLine.split(/\s+/).filter(Boolean);
      if (!words.length) { out.push(''); continue; }
      let line = '';
      for (const w of words) {
        const trial = line ? `${line} ${w}` : w;
        if (f.widthOfTextAtSize(trial, size) > maxWidth && line) { out.push(line); line = w; }
        else line = trial;
      }
      if (line) out.push(line);
    }
    return out;
  }

  // Vykreslí odstavec, vrátí spotřebovanou výšku. Auto page-break po řádcích.
  text(str, opts = {}) {
    const size = opts.size ?? 10;
    const bold = !!opts.bold;
    const color = opts.color || INK;
    const lineGap = opts.lineGap ?? 4;
    const x = opts.x ?? MARGIN;
    const maxWidth = opts.maxWidth ?? (PAGE_W - MARGIN - x);
    const f = bold ? this.fontB : this.font;
    const lines = this._wrap(str, size, bold, maxWidth);
    const lh = size + lineGap;
    for (const ln of lines) {
      this.ensure(lh);
      this.page.drawText(ln, { x, y: this.y - size, size, font: f, color: this._col(color) });
      this.y -= lh;
    }
    return lines.length * lh;
  }

  heading(str) {
    this.text(str, { size: 20, bold: true, color: NAVY, lineGap: 6 });
    this.moveDown(2);
  }
  subtitle(str) { this.text(str, { size: 9.5, color: MUTED, lineGap: 4 }); this.moveDown(6); }
  sectionTitle(str) {
    this.moveDown(10); this.ensure(24);
    this.text(str, { size: 13, bold: true, color: NAVY, lineGap: 4 });
    this.moveDown(3); this.goldRule(); this.moveDown(5);
  }
  goldRule() {
    this.ensure(6);
    this.page.drawLine({ start: { x: MARGIN, y: this.y }, end: { x: PAGE_W - MARGIN, y: this.y }, thickness: 1, color: this._col(GOLD) });
    this.moveDown(2);
  }

  // Hlavička 1. strany: vlevo logo, vpravo blok povinné osoby, pod tím titul + č. kontroly + datum.
  async header(profile, docTitle, caseNumber, dateISO, regenerated) {
    const p = profile || {};
    const topY = this.y;
    const rightX = PAGE_W - MARGIN;
    const rows = [];
    if (p.display_name) rows.push([p.display_name, true]);
    if (p.entity_type && ENTITY_LABELS[p.entity_type]) rows.push([ENTITY_LABELS[p.entity_type], false]);
    if (p.ico) rows.push([`IČO: ${p.ico}`, false]);
    if (p.reg_number) rows.push([`${regLabel(p.entity_type)}: ${p.reg_number}`, false]);
    if (p.address) rows.push([p.address, false]);
    if (p.entity_type) rows.push([`Dozor: ${dozorFor(p.entity_type)}`, false]);
    let ry = topY;
    for (const [txt, bold] of rows) {
      const size = bold ? 11 : 8.5;
      const font = bold ? this.fontB : this.font;
      for (const ln of this._wrap(txt, size, bold, CONTENT_W * 0.56)) {
        const w = font.widthOfTextAtSize(ln, size);
        this.page.drawText(ln, { x: rightX - w, y: ry - size, size, font, color: this._col(bold ? NAVY : MUTED) });
        ry -= size + 3;
      }
    }
    let ly = topY;
    if (p.logo_base64) {
      try {
        const bytes = b64ToBytes(p.logo_base64);
        const img = p.logo_mime === 'image/png' ? await this.doc.embedPng(bytes) : await this.doc.embedJpg(bytes);
        const scale = Math.min(40 / img.height, 1);
        this.page.drawImage(img, { x: MARGIN, y: topY - img.height * scale, width: img.width * scale, height: img.height * scale });
        ly = topY - img.height * scale;
      } catch { /* nevalidní logo přeskoč */ }
    }
    this.y = Math.min(ly, ry) - 12;
    this.goldRule();
    this.moveDown(8);
    this.heading(docTitle);
    const meta = [];
    if (caseNumber) meta.push(`Číslo kontroly: ${caseNumber}`);
    if (dateISO) meta.push(`Datum: ${fmtDateCs(dateISO)}`);
    if (meta.length) this.text(meta.join('     ·     '), { size: 9, color: MUTED, lineGap: 4 });
    if (regenerated) this.text('Kopie vygenerovaná z archivu (bez obrazových příloh).', { size: 8.5, color: MUTED, lineGap: 4 });
    this.moveDown(6);
  }
  para(str, opts = {}) { const h = this.text(str, { size: 10, lineGap: 4, ...opts }); this.moveDown(3); return h; }

  // "Label: value" — label tučně, value normálně, s obtékáním hodnoty.
  keyVal(label, value) {
    const size = 10;
    const labelTxt = `${label}: `;
    const labelW = this.fontB.widthOfTextAtSize(labelTxt, size);
    const valMaxW = CONTENT_W - labelW;
    const valLines = this._wrap(value == null || value === '' ? '—' : String(value), size, false, valMaxW);
    const lh = size + 4;
    this.ensure(lh);
    this.page.drawText(labelTxt, { x: MARGIN, y: this.y - size, size, font: this.fontB, color: this._col(INK) });
    this.page.drawText(valLines[0] || '', { x: MARGIN + labelW, y: this.y - size, size, font: this.font, color: this._col(INK) });
    this.y -= lh;
    for (let i = 1; i < valLines.length; i++) {
      this.ensure(lh);
      this.page.drawText(valLines[i], { x: MARGIN + labelW, y: this.y - size, size, font: this.font, color: this._col(INK) });
      this.y -= lh;
    }
    this.moveDown(1);
  }

  hr() {
    this.ensure(6);
    this.page.drawLine({ start: { x: MARGIN, y: this.y }, end: { x: PAGE_W - MARGIN, y: this.y }, thickness: 0.7, color: this._col(RULE) });
    this.moveDown(2);
  }

  // Barevný informační rámeček (např. poučení). text = string.
  noticeBox(str, bg = WARN_BG) {
    const size = 9.5, pad = 10, lineGap = 4;
    const lines = this._wrap(str, size, false, CONTENT_W - 2 * pad);
    const lh = size + lineGap;
    const boxH = lines.length * lh + 2 * pad;
    this.ensure(boxH + 6);
    const top = this.y;
    this.page.drawRectangle({ x: MARGIN, y: top - boxH, width: CONTENT_W, height: boxH, color: this._col(bg), borderColor: this._col(RULE), borderWidth: 0.7 });
    let ty = top - pad;
    for (const ln of lines) { this.page.drawText(ln, { x: MARGIN + pad, y: ty - size, size, font: this.font, color: this._col(INK) }); ty -= lh; }
    this.y = top - boxH; this.moveDown(8);
  }

  // Tabulka: headers[], rows[[...]], colW[] (podíly nebo body). Auto page-break po řádcích.
  table(headers, rows, colW) {
    const size = 9, pad = 5, lineGap = 3;
    const totalUnits = colW.reduce((a, b) => a + b, 0);
    const widths = colW.map(w => (w / totalUnits) * CONTENT_W);
    const drawRow = (cells, bold, bg) => {
      const cellLines = cells.map((c, i) => this._wrap(c == null ? '' : String(c), size, bold, widths[i] - 2 * pad));
      const rowLines = Math.max(1, ...cellLines.map(l => l.length));
      const rowH = rowLines * (size + lineGap) + 2 * pad;
      this.ensure(rowH);
      const top = this.y;
      if (bg) this.page.drawRectangle({ x: MARGIN, y: top - rowH, width: CONTENT_W, height: rowH, color: this._col(bg) });
      let cx = MARGIN;
      for (let i = 0; i < cells.length; i++) {
        let cy = top - pad;
        for (const ln of cellLines[i]) {
          this.page.drawText(ln, { x: cx + pad, y: cy - size, size, font: bold ? this.fontB : this.font, color: this._col(INK) });
          cy -= size + lineGap;
        }
        cx += widths[i];
      }
      this.page.drawLine({ start: { x: MARGIN, y: top - rowH }, end: { x: PAGE_W - MARGIN, y: top - rowH }, thickness: 0.6, color: this._col(RULE) });
      this.y = top - rowH;
    };
    drawRow(headers, true, [0.94, 0.95, 0.97]);
    for (const r of rows) drawRow(r, false, null);
    this.moveDown(6);
  }

  // Podpisové linky (2 sloupce). labels = [levý, pravý].
  signatureLines(labels) {
    this.moveDown(24); this.ensure(48);
    const colW = CONTENT_W / 2, lineW = colW - 30;
    const y = this.y;
    labels.forEach((lab, i) => {
      const x = MARGIN + i * colW;
      this.page.drawLine({ start: { x, y }, end: { x: x + lineW, y }, thickness: 0.8, color: this._col(INK) });
      this.page.drawText(lab, { x, y: y - 14, size: 9, font: this.font, color: this._col(MUTED) });
    });
    this.y = y - 24;
  }

  // Vloží obrázek jako novou stránku (příloha) — bytes = Uint8Array, mime.
  async imagePage(bytes, mime, caption) {
    let img;
    try {
      img = mime === 'image/png' ? await this.doc.embedPng(bytes) : await this.doc.embedJpg(bytes);
    } catch { return; }
    this._newPage();
    if (caption) { this.text(caption, { size: 9, color: MUTED, lineGap: 4 }); this.moveDown(4); }
    const maxW = CONTENT_W, maxH = this.y - MARGIN - 20;
    const scale = Math.min(maxW / img.width, maxH / img.height, 1);
    const w = img.width * scale, h = img.height * scale;
    this.page.drawImage(img, { x: MARGIN + (maxW - w) / 2, y: this.y - h, width: w, height: h });
    this.y -= h;
  }

  // Vloží všechny stránky přiloženého PDF (příloha typu PDF).
  async appendPdf(bytes) {
    try {
      const src = await this.PDFDocument.load(bytes, { ignoreEncryption: true });
      const copied = await this.doc.copyPages(src, src.getPageIndices());
      for (const p of copied) { this.doc.addPage(p); this.pages.push(p); }
    } catch { /* nevalidní/zaheslované PDF přílohy přeskoč */ }
  }

  // Patička se stránkováním na všech stránkách + SHA-256 na poslední. Volat naposledy.
  finalize(footerText, recordSha) {
    const total = this.pages.length;
    this.pages.forEach((pg, i) => {
      pg.drawText(`${footerText} · strana ${i + 1}/${total}`, { x: MARGIN, y: MARGIN - 22, size: 8, font: this.font, color: this._col(MUTED) });
      if (recordSha && i === total - 1) {
        pg.drawText(`SHA-256: ${String(recordSha).slice(0, 32)}…`, { x: MARGIN, y: MARGIN - 32, size: 7.5, font: this.font, color: this._col(MUTED) });
      }
    });
    return this.doc.save();
  }
}

export async function createPdfBuilder() {
  const { pdfLib, fontkit } = await loadEngine();
  const { reg, bold } = await loadFontBytes();
  const { PDFDocument, rgb } = pdfLib;
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const font = await doc.embedFont(reg, { subset: true });
  const fontB = await doc.embedFont(bold, { subset: true });
  return new Builder(doc, font, fontB, rgb, PDFDocument);
}

// Formátování data „14. 7. 2026" z ISO/prostého řetězce.
export function fmtDateCs(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d)) return String(iso);
  try { return d.toLocaleDateString('cs-CZ', { day: 'numeric', month: 'numeric', year: 'numeric' }); }
  catch { return String(iso); }
}

function b64ToBytes(b64) {
  const bin = atob(b64);
  const a = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i);
  return a;
}

// ── Popisky kódů → čeština (pro záznam) ──
const L_RELATION = { jednorazovy: 'Jednorázový obchod', obchodni_vztah: 'Obchodní vztah (opakované služby)' };
const L_BAND = { do_1k: 'do 1 000 €', '1k_15k': '1 000 – 15 000 €', '15k_plus': '15 000 € a více' };
const L_CATEGORY = { prevod_nemovitosti: 'Převod nemovitosti', uschova: 'Úschova', korporatni: 'Korporátní transakce', rodinne_dedicke: 'Rodinné a dědické', jine: 'Jiné' };
const L_SOURCE = { plat: 'Plat či příjem ze zaměstnání', uspory: 'Úspory a investice', prodej_nemovitosti: 'Prodej nemovitosti', dedictvi: 'Dědictví', podnikani: 'Příjem z podnikání', penze: 'Penzijní fondy', jine: 'Jiné' };
const L_DOCTYPE = { kupni_smlouva: 'Kupní smlouva', vypis_uctu: 'Výpis z účtu', darovaci_smlouva: 'Darovací smlouva', potvrzeni: 'Potvrzení', danove_priznani: 'Daňové přiznání', jine: 'Jiný dokument', doklad_front: 'Doklad totožnosti', doklad_back: 'Doklad totožnosti (zadní)' };
const L_RISK = { nizke: 'Nízké', stredni: 'Střední', vysoke: 'Vysoké' };
const L_CONSISTENCY = { consistent: 'Konzistentní', partial: 'Částečně konzistentní', inconsistent: 'Nekonzistentní' };
const L_LOOKUP = { mvcr: 'Neplatné doklady (MVČR)', isir: 'Insolvenční rejstřík (ISIR)', ares: 'ARES', sanctions: 'Sankční seznamy (EU · OSN · ČR)', pep: 'PEP databáze', isir_po: 'Insolvenční rejstřík (firma)', sanctions_entity: 'Sankční seznamy — firmy (EU · OSN · ČR)' };
// „V pořádku" (hodnotící závěr) v lustraci nepoužíváme — dělá ho povinná osoba
// v kroku Riziko. Beználezový výsledek popisujeme věcně per rejstřík.
const L_LK_STATUS = { warning: 'Ke kontrole', match: 'SHODA', manual: 'Ověřte ručně', error: 'Kontrola neprovedena — zdroj nedostupný', pending: 'Neproběhlo' };
const L_LK_CLEAN = {
  mvcr: 'Doklad není evidován jako neplatný',
  isir: 'Bez záznamu v ISIR', isir_po: 'Bez záznamu v ISIR',
  ares: 'Ověřeno v ARES',
  sanctions: 'Bez nálezu', sanctions_entity: 'Bez nálezu', pep: 'Bez nálezu',
};
const L_METHOD = { personal: 'Osobní setkání', video: 'Video hovor', bankid: 'BankID', micropayment: 'Mikroplatba' };

// Blok 5 — plný AML záznam o identifikaci a kontrole klienta.
// attachments: [{ bytes:Uint8Array, mime, caption }] (jen při generování ze session; archiv = []).
export async function buildRecordPdf(data, attachments = []) {
  const b = await createPdfBuilder();
  const d = data || {};

  await b.header(d.povinnaOsoba, 'Záznam o identifikaci a kontrole klienta', d.caseNumber, d.dateISO, d.regenerated);
  b.text('podle zákona č. 253/2008 Sb., o některých opatřeních proti legalizaci výnosů z trestné činnosti a financování terorismu', { size: 9, color: MUTED, lineGap: 4 });
  b.moveDown(4);

  // 2. Obchod
  b.sectionTitle('Obchod');
  b.keyVal('Typ vztahu', L_RELATION[d.deal?.relationType] || d.deal?.relationType || '—');
  b.keyVal('Hodnota obchodu', L_BAND[d.deal?.valueBand] || d.deal?.valueBand || '—');
  b.keyVal('Dotčené země', d.deal?.countries || '—');
  b.keyVal('Kategorie', L_CATEGORY[d.deal?.category] || d.deal?.category || '—');
  if (d.deal?.purpose) b.keyVal('Popis obchodu', d.deal.purpose);

  // 3. Klient
  b.sectionTitle('Klient');
  if (d.subjectType === 'po') {
    b.keyVal('Právnická osoba', d.company?.name || '—');
    b.keyVal('IČO', d.company?.ico || '—');
    b.keyVal('Sídlo', d.company?.address || '—');
    b.keyVal('Jednající osoba', [d.client?.name, d.company?.actingRole].filter(Boolean).join(' — ') || '—');
    if (d.company?.actingNote) b.keyVal('Poznámka', d.company.actingNote);
    b.keyVal('Skuteční majitelé (ESM)', d.company?.esmChecked ? 'Ověřeno v evidenci skutečných majitelů' : 'Neověřeno');
    if (d.company?.esmNote) b.keyVal('ESM poznámka', d.company.esmNote);
  } else {
    b.keyVal('Jméno a příjmení', d.client?.name || '—');
  }
  if (d.client?.nameOriginal) b.keyVal('Jméno v originále', d.client.nameOriginal);
  b.keyVal('Datum narození', d.client?.birthDate || '—');
  if (d.client?.rc) b.keyVal('Rodné číslo', d.client.rc);
  if (d.client?.address) b.keyVal('Adresa', d.client.address);
  b.keyVal('Státní občanství', d.client?.nationality || '—');
  b.keyVal('Doklad totožnosti', [d.client?.docType, d.client?.docNumber].filter(Boolean).join(' č. ') || '—');
  if (d.client?.occupation) b.keyVal('Povolání / zaměstnavatel', d.client.occupation);
  b.keyVal('Způsob potvrzení totožnosti', L_METHOD[d.identification?.method] || d.identification?.method || '—');
  const ver = d.identification?.verifier;
  if (ver && ver.confirmed) {
    b.moveDown(2);
    b.text('Prohlášení ověřující osoby', { size: 10, bold: true });
    b.para(ver.statement || '', { size: 9.5, color: [0.42, 0.45, 0.52] });
    if (ver.checkbox) b.para('• ' + ver.checkbox, { size: 9.5, color: MUTED });
    if (ver.timestamp) b.para('Potvrzeno: ' + fmtDateCs(ver.timestamp), { size: 9, color: [0.42, 0.45, 0.52] });
  }

  // 4. Lustrace
  b.sectionTitle('Lustrace v rejstřících a seznamech');
  const SRC_CS = { EU: 'EU', UN: 'OSN', CZ: 'ČR' };
  const lkRows = (d.lookups || []).map(l => {
    let vysledek;
    if (l.status === 'clean') vysledek = L_LK_CLEAN[l.type] || 'Bez nálezu';
    else vysledek = L_LK_STATUS[l.status] || l.status || '—';
    if (l.status === 'match' && SRC_CS[l.source]) vysledek += ` — ${SRC_CS[l.source]}`;   // který seznam
    // Selhaný zdroj: ve sloupci Ověřeno nikdy jen timestamp — explicitně „nedokončeno".
    const kdy = l.status === 'error'
      ? (l.checked_at ? 'nedokončeno ' + fmtDateCs(l.checked_at) : 'nedokončeno')
      : fmtDateCs(l.checked_at);
    return [L_LOOKUP[l.type] || l.type, vysledek, kdy];
  });
  if (lkRows.length) b.table(['Zdroj', 'Výsledek', 'Ověřeno'], lkRows, [5, 3, 3]);
  else b.para('Lustrace neproběhly.', { color: [0.42, 0.45, 0.52] });
  b.para('Sankční kontrola zahrnuje konsolidovaný seznam EU, seznam Rady bezpečnosti OSN a národní seznam MZV ČR (zákon č. 1/2023 Sb.); seznamy se aktualizují denně. Datum ve sloupci Ověřeno je časové razítko provedené lustrace. U nedokončené kontroly zdroj nebyl v době lustrace dostupný — je nutné ověření ručně.', { size: 8.5, color: [0.42, 0.45, 0.52] });
  if (d.client?.nameOriginal) b.para('Sankční a PEP lustrace byly provedeny i pro jméno v originále.', { size: 9, color: [0.42, 0.45, 0.52] });

  // 5. Zdroj prostředků
  b.sectionTitle('Zdroj a původ prostředků');
  b.keyVal('Typ zdroje', L_SOURCE[d.source?.type] || d.source?.type || '—');
  if (d.source?.detail) b.keyVal('Upřesnění', d.source.detail);
  if (d.consistency) {
    b.keyVal('Konzistence s doklady', L_CONSISTENCY[d.consistency.consistency] || d.consistency.consistency || '—');
    if (d.consistency.summary_cs) b.para(d.consistency.summary_cs, { size: 9.5, color: [0.42, 0.45, 0.52] });
    for (const s of (d.consistency.signals || [])) b.para(`• ${s.description_cs || s.type || ''} (${s.severity || 'low'})`, { size: 9, color: [0.42, 0.45, 0.52] });
  }

  // 6. Dokumenty
  if ((d.documents || []).length) {
    b.sectionTitle('Podpůrné dokumenty');
    const docRows = d.documents.map(x => [
      L_DOCTYPE[x.doc_type] || x.doc_type || 'Dokument',
      x.filename || '—',
      (x.sha256 || '').slice(0, 16) + (x.sha256 ? '…' : ''),
      x.summary || '',
    ]);
    b.table(['Typ', 'Soubor', 'SHA-256', 'Shrnutí'], docRows, [2.4, 2.2, 2, 4]);
  }

  // 7. Riziko
  b.sectionTitle('Vyhodnocení rizika');
  const sug = d.risk?.suggestion;
  if (sug) {
    b.keyVal('AI návrh úrovně', L_RISK[sug.suggested_level] || sug.suggested_level || '—');
    for (const f of (sug.factors || [])) {
      const sev = f.impact === 'critical' ? ' [kritický]' : (f.impact === 'raises' ? ' [zvyšuje riziko]' : '');
      b.para(`•  ${f.factor || ''}${sev}${f.note_cs ? ' — ' + f.note_cs : ''}`, { size: 9.5, color: MUTED });
    }
    // Odůvodnění může být upravené povinnou osobou a mít více odstavců (prázdný řádek).
    if (sug.reasoning_cs) {
      String(sug.reasoning_cs).split(/\n{2,}/).map(p => p.replace(/\s*\n\s*/g, ' ').trim()).filter(Boolean)
        .forEach(p => b.para(p, { size: 9.5, color: [0.42, 0.45, 0.52] }));
    }
    b.para('Návrh rizika má výhradně informativní charakter a slouží jako podpůrný nástroj. Nezbavuje povinnou osobu zákonné odpovědnosti za konečné posouzení klienta dle zákona č. 253/2008 Sb.', { size: 8.5, color: [0.55, 0.57, 0.63] });
  }
  b.moveDown(4);
  b.keyVal('Závazné rozhodnutí', L_RISK[d.risk?.finalLevel] || d.risk?.finalLevel || '—');
  if (d.risk?.justification) b.keyVal('Odůvodnění', d.risk.justification);
  b.keyVal('Datum rozhodnutí', fmtDateCs(d.risk?.decidedAt));

  // 8. Prohlášení klienta
  b.sectionTitle('Prohlášení klienta');
  const dec = d.declaration || {};
  b.para(dec.pep === 'is'
    ? 'Klient prohlašuje, že JE politicky exponovanou osobou nebo osobou blízkou PEP či v úzkém podnikatelském vztahu s PEP (§ 4 odst. 5 zákona č. 253/2008 Sb.).'
    : 'Klient prohlašuje, že NENÍ politicky exponovanou osobou, osobou blízkou PEP ani v úzkém podnikatelském vztahu s PEP (§ 4 odst. 5 zákona č. 253/2008 Sb.).', { size: 9.5 });
  if (dec.sanctions_confirmed) b.para('Klient prohlásil, že není osobou, vůči níž Česká republika uplatňuje mezinárodní sankce.', { size: 9.5 });
  if (dec.source_confirmed) b.para('Klient prohlásil pravdivost údajů o zdroji a původu prostředků.', { size: 9.5 });
  b.moveDown(6);
  b.para('V ................................ dne ................................', { size: 10 });
  b.signatureLines(['Klient (podpis)', 'Povinná osoba (podpis)']);

  // 9. Přílohy (jen ze session paměti)
  if (attachments && attachments.length) {
    for (const a of attachments) {
      if (!a || !a.bytes) continue;
      if (a.mime === 'application/pdf') await b.appendPdf(a.bytes);
      else await b.imagePage(a.bytes, a.mime, a.caption);
    }
  } else if (d.regenerated) {
    b.sectionTitle('Přílohy');
    b.para('Podpůrné dokumenty a doklady se z bezpečnostních důvodů neukládají na server. Tato kopie záznamu byla vygenerována z archivu a neobsahuje obrazové přílohy. Originály přikládá povinná osoba ze své evidence.', { size: 9.5, color: [0.42, 0.45, 0.52] });
  }

  return b.finalize(`Legalid · legalid.cz · ${d.caseNumber || ''}`, d.recordSha);
}

// U4 — zjednodušený záznam o neuskutečnění obchodu / ukončení kontroly (§ 15).
export async function buildTerminationPdf(data) {
  const b = await createPdfBuilder();
  await b.header(data.povinnaOsoba, 'Záznam o ukončení AML kontroly', data.caseNumber, data.dateISO, data.regenerated);
  b.text('podle zákona č. 253/2008 Sb., o některých opatřeních proti legalizaci výnosů z trestné činnosti a financování terorismu', { size: 9, color: MUTED, lineGap: 4 });
  b.moveDown(4);

  b.sectionTitle('Klient');
  b.keyVal('Jméno a příjmení', data.clientName || '—');
  if (data.clientNameOriginal) b.keyVal('Jméno v originále', data.clientNameOriginal);
  b.keyVal('Datum narození', data.clientBirthDate || '—');
  b.keyVal('Doklad totožnosti', data.clientDocNumber || '—');

  b.sectionTitle('Důvod ukončení');
  b.keyVal('Důvod', data.reasonLabel || '—');
  if (data.reasonText) b.para(data.reasonText);

  b.sectionTitle('Poučení');
  b.noticeBox('Nebyla-li provedena identifikace nebo kontrola klienta v rozsahu požadovaném zákonem, popřípadě odmítl-li klient poskytnout potřebnou součinnost, povinná osoba neuskuteční obchod ani neuzavře obchodní vztah (§ 15 zákona č. 253/2008 Sb.). Tento záznam je součástí dokumentace povinné osoby a uchovává se po zákonem stanovenou dobu.');

  b.signatureLines(['Povinná osoba (podpis)', 'Datum a místo']);

  return b.finalize(`Legalid · legalid.cz · ${data.caseNumber || ''}`);
}
