// legalid.cz — js/aml/pdf.js
// Sdílený PDF engine pro AML záznamy (client-side, pdf-lib + fontkit + Noto Sans).
// jsPDF NELZE — nezvládá českou diakritiku. pdf-lib + vložený Noto Sans ano.
//
// Knihovny se lazy-loadují z CDN (jako docx/file-saver v index.html), fonty z /assets/fonts/.
// Export:
//   buildTerminationPdf(data) → Uint8Array  (U4, zjednodušený záznam o neuskutečnění)
//   buildRecordPdf(data)      → Uint8Array  (Blok 5, plný AML záznam) — doplněno později
//   createPdfBuilder()        → Builder     (nízkoúrovňové API pro oba)

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

const INK = [0.13, 0.15, 0.20];       // tmavě šedomodrá
const MUTED = [0.42, 0.45, 0.52];
const RULE = [0.82, 0.84, 0.88];
const ACCENT = [0.11, 0.24, 0.45];    // navy
const WARN_BG = [0.99, 0.96, 0.90];

class Builder {
  constructor(doc, font, fontB, rgb) {
    this.doc = doc; this.font = font; this.fontB = fontB; this.rgb = rgb;
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
    this.text(str, { size: 16, bold: true, color: ACCENT, lineGap: 6 });
    this.moveDown(2);
  }
  subtitle(str) { this.text(str, { size: 9.5, color: MUTED, lineGap: 4 }); this.moveDown(6); }
  sectionTitle(str) {
    this.moveDown(8); this.ensure(22);
    this.text(str, { size: 11.5, bold: true, color: ACCENT, lineGap: 4 });
    this.moveDown(3); this.hr(); this.moveDown(4);
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

  // Patička se stránkováním na všech stránkách. Volat naposledy.
  finalize(footerText) {
    const total = this.pages.length;
    this.pages.forEach((pg, i) => {
      const txt = `${footerText} · strana ${i + 1}/${total}`;
      pg.drawText(txt, { x: MARGIN, y: MARGIN - 22, size: 8, font: this.font, color: this._col(MUTED) });
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
  return new Builder(doc, font, fontB, rgb);
}

// Formátování data „14. 7. 2026" z ISO/prostého řetězce.
export function fmtDateCs(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d)) return String(iso);
  try { return d.toLocaleDateString('cs-CZ', { day: 'numeric', month: 'numeric', year: 'numeric' }); }
  catch { return String(iso); }
}

function povinnaOsobaLine(p) {
  if (!p) return '—';
  return [p.jmeno, p.role, p.sidlo].filter(Boolean).join(', ') || '—';
}

// U4 — zjednodušený záznam o neuskutečnění obchodu / ukončení kontroly (§ 15).
export async function buildTerminationPdf(data) {
  const b = await createPdfBuilder();
  b.heading('Záznam o ukončení AML kontroly');
  b.subtitle('podle zákona č. 253/2008 Sb., o některých opatřeních proti legalizaci výnosů z trestné činnosti a financování terorismu');

  b.sectionTitle('Základní údaje');
  b.keyVal('Číslo kontroly', data.caseNumber || '—');
  b.keyVal('Povinná osoba', povinnaOsobaLine(data.povinnaOsoba));
  b.keyVal('Datum ukončení', fmtDateCs(data.dateISO));

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
