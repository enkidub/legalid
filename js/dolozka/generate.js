// legalid.cz — js/dolozka/generate.js
// Vygenerováno refaktoringem z původního monolitického index.html.

import { trackUsage } from '../auth/auth.js';
import { dateToYMD, extractCity, getCopies, getDolozkaData, getKombovanySettings, getKombovanySettingsFromUI, getPmSettingsFromUI, getPrijmeni, hideOcrSuccess, loadPmSettings, phd, prefillDates, renderChips, slugify, softValidate, updatePreview, updatePvLines } from './dolozka.js';
import { autoSaveRecord, getKniha } from '../kniha/kniha.js';
import { PM_DEFAULTS, getSettings, state } from '../core/state.js';
import { showToast } from '../core/ui.js';

export async function downloadDocx() {
  if (!await trackUsage()) return;
  softValidate();
  try {
    loadPmSettings();
    const d = getDolozkaData();
    const s = getPmSettingsFromUI();
    const copies = getCopies();
    const knjia = `${d.aCisloKnihy}/${d.cisloRadku}/${d.rok}`;

    const { Document, Paragraph, TextRun, Table, TableRow, TableCell,
            WidthType, AlignmentType, HeightRule } = docx;

    const mm = v => Math.round(v * 56.692);
    const tw = v => Math.round(v * 20);
    const nil = { style: 'nil', size: 0, color: 'auto' };
    const noB = () => ({ top: nil, bottom: nil, left: nil, right: nil });
    const brd = (color, sz = 3) => ({ style: 'single', size: sz, color });
    const A4W = 11906, A4H = 16838;
    let sections;

    if (s.combo) {
      const ks = getKombovanySettings();
      const mgL = mm(ks.X), mgR = mm(ks.XR), mgT = mm(ks.Y);
      const tblW = A4W - mgL - mgR;
      const leftW = Math.round(tblW * ks.L / 100);
      const rightW = tblW - leftW;
      const font = 'Times New Roman', sz = 20;
      const sp = { before: 0, after: tw(1.5) };
      const spGap = { before: 0, after: tw(7) };
      const run = (t, o = {}) => new TextRun({ text: String(t ?? ''), font, size: sz, ...o });
      const p = (t, o = {}) => new Paragraph({ children: [run(t)], spacing: sp, ...o });
      const gap = () => new Paragraph({ children: [run('')], spacing: spGap });
      const leftBrd = s.cell_border ? { ...noB(), right: brd('dddddd') } : noB();
      const rightBrd = s.bot_border
        ? { top: brd('dddddd'), bottom: brd('dddddd'), left: brd('dddddd'), right: brd('dddddd') }
        : noB();

      const rows = [];
      for (let i = 0; i < copies; i++) {
        if (i > 0) {
          rows.push(new TableRow({
            height: { value: mm(ks.MEZ), rule: HeightRule.EXACT },
            children: [new TableCell({
              columnSpan: 2,
              width: { size: tblW, type: WidthType.DXA },
              borders: noB(),
              margins: { top: 0, bottom: 0, left: 0, right: 0 },
              children: [new Paragraph({
                children: [],
                spacing: { before: 0, after: 0 },
                border: s.cut_line
                  ? { top: { style: 'dashed', size: 6, color: 'cccccc', space: 1 } }
                  : undefined,
              })],
            })],
          }));
        }

        const sigPara = s.sig_mode !== 'none'
          ? [new Paragraph({ children: [run(`${d.aJmeno}, ${d.aRole}`)], spacing: { before: tw(10), after: 0 }, alignment: AlignmentType.RIGHT })]
          : [];

        rows.push(new TableRow({
          children: [
            new TableCell({
              width: { size: leftW, type: WidthType.DXA },
              borders: leftBrd,
              margins: { top: mm(ks.PY), bottom: mm(ks.PY), left: 0, right: mm(ks.PX) },
              children: [
                new Paragraph({ children: [run('Prohlášení o pravosti podpisu', { bold: true, allCaps: true })], spacing: { before: 0, after: tw(3) } }),
                p(`Číslo knihy: ${knjia}`),
                p(`${d.aJmeno}, ${d.aRole}, ev. č. ${d.aEvCislo}, se sídlem ${d.aSidlo};`),
                p(`Prohlašuji, že ${d.jmeno}, nar. ${d.datumNar}, místo nar. ${d.mistoNar}, bytem ${d.adresa}, jehož/jejíž totožnost prokázána OP č. ${d.cisloOp}, tuto listinu v ${d.pocet} vyhotovení(ch) přede mnou vlastnoručně podepsal/a.`),
                new Paragraph({ children: [run(`V Praze dne ${d.datumOver}`)], spacing: { before: tw(6), after: 0 } }),
                ...sigPara,
              ],
            }),
            new TableCell({
              width: { size: rightW, type: WidthType.DXA },
              borders: rightBrd,
              margins: { top: mm(ks.PY), bottom: mm(ks.PY), left: mm(ks.PX), right: 0 },
              children: [
                p(`V Praze, ${d.aSidlo}`),
                p(`dne ${d.datumOver}`),
                gap(),
                p(`${d.jmeno}, nar. ${d.datumNar},`),
                p(`místo narození ${d.mistoNar},`),
                p(`bytem ${d.adresa}`),
                gap(),
                p(`OP: ${d.cisloOp}`),
                gap(),
                p(`${d.pocet}x`),
                p(`${d.listina}`),
              ],
            }),
          ],
        }));
      }

      sections = [{
        properties: {
          page: {
            size: { width: A4W, height: A4H },
            margin: { top: mgT, bottom: mm(10), left: mgL, right: mgR },
          },
        },
        children: [new Table({
          width: { size: tblW, type: WidthType.DXA },
          borders: { top: nil, bottom: nil, left: nil, right: nil, insideH: nil, insideV: nil },
          rows,
        })],
      }];

    } else {
      const cellW = mm(105), cellH = mm(74), tblW = cellW * 2;
      const font = 'Times New Roman', sz = 14, szSm = 13;
      const sp = { before: 0, after: tw(2.5) };
      const run = (t, o = {}) => new TextRun({ text: String(t ?? ''), font, size: sz, ...o });
      const runSm = (t, o = {}) => new TextRun({ text: String(t ?? ''), font, size: szSm, ...o });
      const pSm = t => new Paragraph({ children: [runSm(t)], spacing: sp });
      const cellBrd = s.cell_border ? brd('888888', 4) : nil;
      const stitkBrd = s.bot_border ? brd('888888', 4) : nil;
      const stitkCellBrd = { top: stitkBrd, bottom: stitkBrd, left: stitkBrd, right: stitkBrd };
      const stitkMg = { top: tw(1.5), bottom: tw(1.5), left: tw(3), right: tw(3) };

      const buildCell = filled => {
        if (!filled) {
          return new TableCell({
            width: { size: cellW, type: WidthType.DXA },
            borders: { top: cellBrd, bottom: cellBrd, left: cellBrd, right: cellBrd },
            children: [new Paragraph({ children: [], spacing: { before: 0, after: 0 } })],
          });
        }

        const mgH = mm(s.X1 + s.PX), mgH2 = mm(s.X2 + s.PX);
        const innerW = cellW - mgH - mgH2;
        const sw1 = Math.round(innerW * 0.48), sw2 = innerW - sw1;

        const stitkTable = new Table({
          width: { size: innerW, type: WidthType.DXA },
          borders: { top: nil, bottom: nil, left: nil, right: nil, insideH: nil, insideV: nil },
          rows: [
            new TableRow({ children: [
              new TableCell({ width: { size: sw1, type: WidthType.DXA }, borders: stitkCellBrd, margins: stitkMg, children: [pSm(`V Praze, ${d.aSidlo} dne ${d.datumOver}`)] }),
              new TableCell({ width: { size: sw2, type: WidthType.DXA }, borders: stitkCellBrd, margins: stitkMg, children: [pSm(`${d.jmeno} nar. ${d.datumNar}, místo nar. ${d.mistoNar}, bytem ${d.adresa}`)] }),
            ]}),
            new TableRow({ children: [
              new TableCell({ width: { size: sw1, type: WidthType.DXA }, borders: stitkCellBrd, margins: stitkMg, children: [pSm(`OP: ${d.cisloOp}`)] }),
              new TableCell({ width: { size: sw2, type: WidthType.DXA }, borders: stitkCellBrd, margins: stitkMg, children: [pSm(`${d.pocet}x ${d.listina}`)] }),
            ]}),
          ],
        });

        const sigPara = s.sig_mode !== 'none'
          ? [new Paragraph({ children: [run(`${d.aJmeno}, ${d.aRole}`)], spacing: { before: tw(12), after: 0 }, alignment: AlignmentType.RIGHT })]
          : [];

        return new TableCell({
          width: { size: cellW, type: WidthType.DXA },
          borders: { top: cellBrd, bottom: cellBrd, left: cellBrd, right: cellBrd },
          margins: { top: mm(s.Y1 + s.PY), bottom: mm(s.Y2), left: mgH, right: mgH2 },
          children: [
            new Paragraph({ children: [runSm('Prohlášení o pravosti podpisu', { bold: true, allCaps: true })], alignment: AlignmentType.CENTER, spacing: { before: 0, after: tw(3) } }),
            new Paragraph({ children: [runSm(`Číslo knihy: ${knjia}`)], spacing: sp }),
            new Paragraph({ children: [runSm(`${d.aJmeno}, ${d.aRole}, ev. č. ${d.aEvCislo}, se sídlem ${d.aSidlo};`)], spacing: sp }),
            new Paragraph({ children: [runSm(`Prohlašuji, že ${d.jmeno}, nar. ${d.datumNar}, místo nar. ${d.mistoNar}, bytem ${d.adresa}, jehož/jejíž totožnost prokázána OP č. ${d.cisloOp}, tuto listinu v ${d.pocet} vyhotovení(ch) přede mnou vlastnoručně podepsal/a.`)], spacing: sp }),
            new Paragraph({ children: [runSm(`V Praze dne ${d.datumOver}`)], spacing: { before: tw(6), after: 0 } }),
            ...sigPara,
            new Paragraph({
              children: [],
              spacing: { before: tw(4), after: tw(4) },
              border: s.cut_line ? { top: { style: 'dashed', size: 6, color: '999999', space: 1 } } : undefined,
            }),
            stitkTable,
          ],
        });
      };

      const numPages = Math.ceil(copies / 8);
      sections = [];
      for (let pg = 0; pg < numPages; pg++) {
        const pageRows = [];
        for (let r = 0; r < 4; r++) {
          const cells = [];
          for (let c = 0; c < 2; c++) {
            cells.push(buildCell(pg * 8 + r * 2 + c < copies));
          }
          pageRows.push(new TableRow({
            height: { value: cellH, rule: HeightRule.EXACT },
            children: cells,
          }));
        }
        sections.push({
          properties: {
            page: {
              size: { width: A4W, height: A4H },
              margin: { top: 0, bottom: 0, left: 0, right: 0 },
            },
          },
          children: [new Table({
            width: { size: tblW, type: WidthType.DXA },
            borders: { top: nil, bottom: nil, left: nil, right: nil, insideH: nil, insideV: nil },
            rows: pageRows,
          })],
        });
      }
    }

    const doc = new Document({ sections });
    const blob = await docx.Packer.toBlob(doc);
    saveAs(blob, `dolozka_${dateToYMD(d.datumOver)}_${slugify(getPrijmeni(d.jmeno))}.docx`);
    autoSaveRecord();
    if (!state.gdprShown) { state.gdprShown = true; document.getElementById('gdprNotice').classList.add('visible'); }

  } catch (err) {
    showToast('Nepodařilo se stáhnout — zkuste na počítači nebo v Chrome');
  }
}

// ── PRINT FLOW ────────────────────────────────────────────────────

export function printStitky() {
  const s = getSettings();
  const v = id => document.getElementById(id)?.value.trim() || '';
  const datumOver = v('fDatumOver'), jmeno = v('fJmeno');
  const datumNar = v('fDatumNar'), mistoNar = v('fMistoNar');
  const adresa = v('fAdresa'), cisloOp = v('fCisloOp');
  const listina = v('fListina'), pocet = v('fPocetVyh');
  const city = extractCity(state.advokat.sidlo);
  const totalW = s.W1 + s.W2 + s.W3 + s.W4;
  const dc = 'rgba(11,25,41,.5)';
  const narLine = [datumNar && `nar. ${datumNar}`, mistoNar].filter(Boolean).join(', ');
  const brd = s.border !== false ? 'border:0.3mm solid #0b1929;' : '';
  const colBrd = s.lines !== false ? `border-right:0.3mm solid ${dc}` : 'border-right:none';
  const rowBrd = s.lines !== false ? `border-bottom:0.3mm solid ${dc}` : 'border-bottom:none';

  const one = `<div class="st" style="${brd}">
    <div class="c1"><div>${datumOver}</div><div>${city}</div></div>
    <div class="c2">
      <div class="c2t"><div class="fw">${jmeno}</div><div>${narLine}</div><div>${adresa}</div></div>
      <div class="c2b">OP: ${cisloOp}</div>
    </div>
    <div class="c3"><div>${listina}</div><div class="mt">Počet: ${pocet}x</div></div>
    <div class="c4"><div class="fw">${state.advokat.jmeno}</div><div>${state.advokat.role}</div><div>ev.č. ČAK: ${state.advokat.ev_cislo}</div></div>
  </div>`;

  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>
@page{size:A4 portrait;margin:0}
body{margin:0;padding:${s.Y||0}mm 0 0 ${s.X||0}mm;font-family:'DM Sans',system-ui,sans-serif;font-size:6.5pt;line-height:1.3;color:#1a2233;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.st{display:grid;grid-template-columns:${s.W1}mm ${s.W2}mm ${s.W3}mm ${s.W4}mm;width:${totalW}mm;height:${s.H}mm;box-sizing:border-box;page-break-inside:avoid;break-inside:avoid}
.c1,.c3,.c4{padding:${s.PY}mm ${s.PX}mm;overflow:hidden;box-sizing:border-box}
.c1,.c2,.c3{${colBrd}}
.c2{display:flex;flex-direction:column;overflow:hidden}
.c2t{padding:${s.PY}mm ${s.PX}mm;height:${s.H1}mm;${rowBrd};overflow:hidden;flex-shrink:0;box-sizing:border-box}
.c2b{padding:${s.PY}mm ${s.PX}mm;flex:1;overflow:hidden}
.fw{font-weight:600}.mt{margin-top:2mm}
</style></head><body>
${Array(7).fill(one).join('')}
<script>window.addEventListener('load',()=>window.print())<\/script>
</body></html>`;

  const w = window.open('', '_blank');
  if (!w) { showToast('Povolte popup v adresním řádku.'); return; }
  w.document.write(html);
  w.document.close();
}

// ── DOLOZKA SETTINGS ──────────────────────────────────────────────

export function buildStitekCellHTML(d, knjia, s) {
  s = s || PM_DEFAULTS;
  const sigLine = s.sig_mode === 'none' ? '' :
    `<div class="pv-sig-name">${phd(d.aJmeno,'advokát')}, ${phd(d.aRole,'role')}</div>`;
  const brdStyle = s.cell_border ? 'border:0.5px solid #888;box-sizing:border-box;' : '';
  if (s.combo) {
    return `<div class="pv-cell-inner pv-combo-wrap" style="${brdStyle}padding:${s.Y1}mm ${s.X2}mm ${s.Y2}mm ${s.X1}mm;">` +
      `<div class="pv-combo-left">` +
      `<div style="max-height:${s.H}mm;overflow:hidden;padding:${s.PY}mm ${s.PX}mm 0;">` +
      `<div class="pv-title">Prohlášení o pravosti podpisu</div>` +
      `<div class="pv-p">Číslo knihy: ${knjia}</div>` +
      `<div class="pv-p">${phd(d.aJmeno,'advokát')}, ${phd(d.aRole,'role')}, ev. č. ${phd(d.aEvCislo,'č.ev.')}, se sídlem ${phd(d.aSidlo,'sídlo')};</div>` +
      `<div class="pv-p">Prohlašuji, že ${phd(d.jmeno,'JMÉNO')}, nar. ${phd(d.datumNar,'DATUM NAR.')}, místo nar. ${phd(d.mistoNar,'MÍSTO')}, bytem ${phd(d.adresa,'ADRESA')}, jehož/jejíž totožnost prokázána OP č. ${phd(d.cisloOp,'ČÍSLO OP')}, tuto listinu v ${phd(d.pocet,'POČET')} vyhotovení(ch) přede mnou vlastnoručně podepsal/a.</div>` +
      `<div class="pv-sig">V Praze dne ${phd(d.datumOver,'DATUM')}</div>` +
      sigLine +
      `</div>` +
      `</div>` +
      `<div class="pv-combo-right">` +
      `<div class="pv-p">V Praze, ${phd(d.aSidlo,'sídlo')} dne ${phd(d.datumOver,'datum')}</div>` +
      `<div class="pv-p">${phd(d.jmeno,'JMÉNO')} nar. ${phd(d.datumNar,'DATUM')}, místo nar. ${phd(d.mistoNar,'MÍSTO')}, bytem ${phd(d.adresa,'ADRESA')}</div>` +
      `<div class="pv-p">OP: ${phd(d.cisloOp,'ČÍSLO OP')}</div>` +
      `<div class="pv-p">${phd(d.pocet,'počet')}x ${phd(d.listina,'LISTINA')}</div>` +
      `</div>` +
      `</div>`;
  }
  return `<div class="pv-cell-inner" style="${brdStyle}padding:${s.Y1}mm ${s.X2}mm ${s.Y2}mm ${s.X1}mm;">` +
    `<div style="max-height:${s.H}mm;overflow:hidden;padding:${s.PY}mm ${s.PX}mm 0;">` +
    `<div class="pv-title">Prohlášení o pravosti podpisu</div>` +
    `<div class="pv-p">Číslo knihy: ${knjia}</div>` +
    `<div class="pv-p">${phd(d.aJmeno,'advokát')}, ${phd(d.aRole,'role')}, ev. č. ${phd(d.aEvCislo,'č.ev.')}, se sídlem ${phd(d.aSidlo,'sídlo')};</div>` +
    `<div class="pv-p">Prohlašuji, že ${phd(d.jmeno,'JMÉNO')}, nar. ${phd(d.datumNar,'DATUM NAR.')}, místo nar. ${phd(d.mistoNar,'MÍSTO')}, bytem ${phd(d.adresa,'ADRESA')}, jehož/jejíž totožnost prokázána OP č. ${phd(d.cisloOp,'ČÍSLO OP')}, tuto listinu v ${phd(d.pocet,'POČET')} vyhotovení(ch) přede mnou vlastnoručně podepsal/a.</div>` +
    `<div class="pv-sig">V Praze dne ${phd(d.datumOver,'DATUM')}</div>` +
    sigLine +
    `</div>` +
    `<div class="pv-sep" style="${s.cut_line ? 'border-top:1px dashed #999;' : ''}"></div>` +
    `<div class="pv-bot${s.bot_border ? '' : ' pv-no-border'}" style="padding:0 ${s.PX}mm;"><table>` +
    `<tr><td>V Praze, ${phd(d.aSidlo,'sídlo')} dne ${phd(d.datumOver,'datum')}</td>` +
    `<td>${phd(d.jmeno,'JMÉNO')} nar. ${phd(d.datumNar,'DATUM')}, místo nar. ${phd(d.mistoNar,'MÍSTO')}, bytem ${phd(d.adresa,'ADRESA')}</td></tr>` +
    `<tr><td>OP: ${phd(d.cisloOp,'ČÍSLO OP')}</td>` +
    `<td>${phd(d.pocet,'počet')}x ${phd(d.listina,'LISTINA')}</td></tr>` +
    `</table></div>` +
    `</div>`;
}


export function buildDolozkaPreviewContent() {
  const d = getDolozkaData();
  const knjia = `${phd(d.aCisloKnihy,'č.knihy')}/${phd(d.cisloRadku,'č.řádku')}/${phd(d.rok,'rok')}`;
  const copies = getCopies();
  const s = getPmSettingsFromUI();
  const grid = document.getElementById('pvGrid');
  const a4 = document.getElementById('printPreviewA4');
  if (!grid) return;
  if (s.combo) {
    const ks = getKombovanySettingsFromUI();
    const mm2px = mm => (mm * 794 / 210);
    const pT = mm2px(ks.Y).toFixed(1), pL = mm2px(ks.X).toFixed(1), pR = mm2px(ks.XR).toFixed(1);
    const pV = mm2px(ks.PY).toFixed(1), pH = mm2px(ks.PX).toFixed(1);
    const sepH = mm2px(ks.MEZ).toFixed(1);
    const sigLine = s.sig_mode === 'none' ? '' :
      `<div class="pv-combo-row-sig-name">${phd(d.aJmeno,'advokát')}, ${phd(d.aRole,'role')}</div>`;
    let html = `<div class="pv-combo-sheet" style="padding:${pT}px ${pR}px 0 ${pL}px;">`;
    for (let i = 0; i < copies; i++) {
      if (i > 0) {
        const cutIcon = s.cut_line ? `<span class="pv-combo-sep-icon">✂</span>` : '';
        html += `<div class="pv-combo-sep" style="height:${sepH}px;${s.cut_line ? 'border-top:0.5px dashed #ccc;' : ''}">${cutIcon}</div>`;
      }
      html +=
        `<div class="pv-combo-row">` +
        `<div class="pv-combo-row-left" style="flex:0 0 ${ks.L}%;padding:${pV}px ${pH}px ${pV}px 0;">` +
        `<div class="pv-combo-row-title">Prohlášení o pravosti podpisu</div>` +
        `<div>${knjia} · ${phd(d.aJmeno,'advokát')}, ev.č. ${phd(d.aEvCislo,'č.ev.')}</div>` +
        `<div>Prohlašuji, že ${phd(d.jmeno,'JMÉNO')}, nar. ${phd(d.datumNar,'datum')}, OP č. ${phd(d.cisloOp,'OP')}, listinu v ${phd(d.pocet,'POČET')} vyhotov. přede mnou vlastnoručně podepsal/a.</div>` +
        `<div class="pv-combo-row-sig">V Praze dne ${phd(d.datumOver,'datum')}` + sigLine + `</div>` +
        `</div>` +
        `<div class="pv-combo-row-right" style="flex:0 0 ${ks.P}%;padding:${pV}px 0 ${pV}px ${pH}px;${s.bot_border ? 'border:0.5px solid #ddd;' : s.cell_border ? 'border-left:0.5px solid #ddd;' : ''}">` +
        `<div>V Praze, ${phd(d.aSidlo,'sídlo')}</div>` +
        `<div>dne ${phd(d.datumOver,'datum')}</div>` +
        `<div class="pv-combo-gap"></div>` +
        `<div>${phd(d.jmeno,'JMÉNO')}, nar. ${phd(d.datumNar,'datum')},</div>` +
        `<div>místo narození ${phd(d.mistoNar,'místo')},</div>` +
        `<div>bytem ${phd(d.adresa,'adresa')}</div>` +
        `<div class="pv-combo-gap"></div>` +
        `<div>OP: ${phd(d.cisloOp,'OP')}</div>` +
        `<div class="pv-combo-gap"></div>` +
        `<div>${phd(d.pocet,'počet')}×</div>` +
        `<div>${phd(d.listina,'LISTINA')}</div>` +
        `</div>` +
        `</div>`;
    }
    html += `</div>`;
    grid.style.display = 'block';
    grid.style.height = '';
    if (a4) { a4.style.height = ''; a4.style.background = ''; a4.style.boxShadow = ''; }
    grid.innerHTML = html;
    const gridH = grid.offsetHeight || 1123;
    if (a4) a4.style.height = gridH + 'px';
    scalePrintPreview();
    return;
  } else {
    const pages = Math.ceil(copies / 8);
    if (pages === 1) {
      grid.style.display = '';
      grid.style.height = '';
      if (a4) { a4.style.height = ''; a4.style.background = ''; a4.style.boxShadow = ''; }
      let html = '';
      for (let i = 0; i < 8; i++) {
        html += i < copies
          ? `<div class="pv-cell">${buildStitekCellHTML(d, knjia, s)}</div>`
          : `<div class="pv-cell pv-cell-empty"></div>`;
      }
      grid.innerHTML = html;
      updatePvLines();
    } else {
      const totalH = pages * 1123 + (pages - 1) * 8;
      grid.style.display = 'block';
      grid.style.height = totalH + 'px';
      if (a4) { a4.style.height = totalH + 'px'; a4.style.background = '#dde0e4'; a4.style.boxShadow = 'none'; }
      let html = '';
      for (let p = 0; p < pages; p++) {
        if (p > 0) html += `<div style="height:8px;width:794px;background:#dde0e4;"></div>`;
        html += `<div style="display:grid;grid-template-columns:397px 397px;grid-template-rows:repeat(4,1fr);width:794px;height:1123px;">`;
        for (let i = 0; i < 8; i++) {
          const idx = p * 8 + i;
          html += idx < copies
            ? `<div class="pv-cell">${buildStitekCellHTML(d, knjia, s)}</div>`
            : `<div class="pv-cell pv-cell-empty"></div>`;
        }
        html += `</div>`;
      }
      grid.innerHTML = html;
    }
    scalePrintPreview();
  }
}


export function scalePrintPreview() {
  const outer = document.getElementById('printPreviewOuter');
  const a4 = document.getElementById('printPreviewA4');
  if (!outer || !a4) return;
  const scroll = document.getElementById('pmPreviewScroll');
  const a4H = parseFloat(a4.style.height) || 1123;
  const isCombo = a4H > 1200;
  let scale;
  if (window.innerWidth <= 800) {
    const scaleW = (window.innerWidth - 32) / 794;
    const scrollH = scroll && scroll.clientHeight > 50 ? scroll.clientHeight : Math.max(window.innerHeight - 120, 200);
    const scaleH = (scrollH - 16) / a4H;
    scale = Math.min(scaleW, scaleH);
  } else {
    const availW = scroll ? scroll.clientWidth - 40 : 560;
    const availH = scroll && scroll.clientHeight > 50 ? scroll.clientHeight - 32 : 600;
    const scaleW = availW / 794;
    const scaleH = isCombo ? availH / a4H : Infinity;
    scale = Math.min(0.95, scaleW, scaleH);
  }
  a4.style.transform = `scale(${scale})`;
  outer.style.width = Math.ceil(794 * scale) + 'px';
  outer.style.height = Math.ceil(a4H * scale) + 'px';
  if (scroll) scroll.style.justifyContent = isCombo ? 'center' : '';
}


export async function printDolozka() {
  if (!await trackUsage()) return;
  const d = getDolozkaData();
  const knjia = `${d.aCisloKnihy}/${d.cisloRadku}/${d.rok}`;
  const copies = getCopies();
  const s = getPmSettingsFromUI();

  if (s.combo) {
    const ks = getKombovanySettings();
    let rowsHtml = '';
    for (let i = 0; i < copies; i++) {
      if (i > 0) {
        const cutIcon = s.cut_line ? `<span class="sep-icon">✂</span>` : '';
        rowsHtml += `<div class="sep" style="height:${ks.MEZ}mm;">${cutIcon}</div>`;
      }
      const sigLine = s.sig_mode === 'none' ? '' : `<div class="sig-name">${d.aJmeno}, ${d.aRole}</div>`;
      rowsHtml +=
        `<div class="row">` +
        `<div class="pleft" style="flex:0 0 ${ks.L}%;padding:${ks.PY}mm ${ks.PX}mm ${ks.PY}mm 0;">` +
        `<div class="title">Prohlášení o pravosti podpisu</div>` +
        `<div class="p">Číslo knihy: ${knjia}</div>` +
        `<div class="p">${d.aJmeno}, ${d.aRole}, ev. č. ${d.aEvCislo}, se sídlem ${d.aSidlo};</div>` +
        `<div class="p">Prohlašuji, že ${d.jmeno}, nar. ${d.datumNar}, místo nar. ${d.mistoNar}, bytem ${d.adresa}, jehož/jejíž totožnost prokázána OP č. ${d.cisloOp}, tuto listinu v ${d.pocet} vyhotovení(ch) přede mnou vlastnoručně podepsal/a.</div>` +
        `<div class="sig">V Praze dne ${d.datumOver}</div>` +
        sigLine +
        `</div>` +
        `<div class="pright" style="flex:0 0 ${ks.P}%;padding:${ks.PY}mm 0 ${ks.PY}mm ${ks.PX}mm;">` +
        `<div class="p">V Praze, ${d.aSidlo}</div>` +
        `<div class="p">dne ${d.datumOver}</div>` +
        `<div class="gap"></div>` +
        `<div class="p">${d.jmeno}, nar. ${d.datumNar},</div>` +
        `<div class="p">místo narození ${d.mistoNar},</div>` +
        `<div class="p">bytem ${d.adresa}</div>` +
        `<div class="gap"></div>` +
        `<div class="p">OP: ${d.cisloOp}</div>` +
        `<div class="gap"></div>` +
        `<div class="p">${d.pocet}x</div>` +
        `<div class="p">${d.listina}</div>` +
        `</div>` +
        `</div>`;
    }
    const comboHtml = `<!DOCTYPE html><html lang="cs"><head><meta charset="UTF-8"><style>
@page{size:A4 portrait;margin:0}
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:'Times New Roman',Times,serif;font-size:10pt;line-height:1.35;color:#111;width:210mm}
.outer{padding:${ks.Y}mm ${ks.XR}mm 0 ${ks.X}mm}
.row{display:flex;width:100%;position:relative;page-break-inside:avoid}
.pleft{min-width:0;${s.cell_border ? 'border-right:0.5pt solid #ddd;' : ''}}
.pright{min-width:0;${s.bot_border ? 'border:0.5pt solid #ddd;' : ''}}
.title{font-weight:bold;text-transform:uppercase;letter-spacing:.2px;margin-bottom:3pt}
.p{margin-bottom:1.5pt}.sig{margin-top:6pt}.sig-name{margin-top:10pt;text-align:right}
.gap{height:0.7em}.sep{position:relative;${s.cut_line ? 'border-top:0.5pt dashed #ccc;' : ''}}
.sep-icon{position:absolute;top:-7pt;left:4pt;font-size:9pt;color:#aaa;background:#fff;line-height:1}
</style></head><body><div class="outer">${rowsHtml}</div>
<script>window.addEventListener('load',()=>window.print())<\/script>
</body></html>`;
    const wc = window.open('', '_blank');
    if (!wc) { showToast('Povolte popup v adresním řádku.'); return; }
    wc.document.write(comboHtml);
    wc.document.close();
    autoSaveRecord();
    showPostPrintToast();
    return;
  }

  const nonComboPgs = Math.ceil(copies / 8);
  const cellBorder = s.cell_border ? 'border:0.3pt solid #888;' : '';
  let pagesHtml = '';
  for (let p = 0; p < nonComboPgs; p++) {
    let cells = '';
    for (let i = 0; i < 8; i++) {
      const idx = p * 8 + i;
      if (idx < copies) {
        const sigLine = s.sig_mode === 'none' ? '' : `<div class="sig-name">${d.aJmeno}, ${d.aRole}</div>`;
        cells +=
          `<div class="cell">` +
          `<div class="top">` +
          `<div class="title">Prohlášení o pravosti podpisu</div>` +
          `<div class="p">Číslo knihy: ${knjia}</div>` +
          `<div class="p">${d.aJmeno}, ${d.aRole}, ev. č. ${d.aEvCislo}, se sídlem ${d.aSidlo};</div>` +
          `<div class="p">Prohlašuji, že ${d.jmeno}, nar. ${d.datumNar}, místo nar. ${d.mistoNar}, bytem ${d.adresa}, jehož/jejíž totožnost prokázána OP č. ${d.cisloOp}, tuto listinu v ${d.pocet} vyhotovení(ch) přede mnou vlastnoručně podepsal/a.</div>` +
          `<div class="sig">V Praze dne ${d.datumOver}</div>` +
          sigLine +
          `</div>` +
          `<div class="sep"></div>` +
          `<table><tr><td>V Praze, ${d.aSidlo} dne ${d.datumOver}</td><td>${d.jmeno} nar. ${d.datumNar}, místo nar. ${d.mistoNar}, bytem ${d.adresa}</td></tr>` +
          `<tr><td>OP: ${d.cisloOp}</td><td>${d.pocet}x ${d.listina}</td></tr></table>` +
          `</div>`;
      } else {
        cells += `<div class="cell cell-empty"></div>`;
      }
    }
    pagesHtml += `<div class="page${p < nonComboPgs - 1 ? ' page-break' : ''}">${cells}</div>`;
  }
  const html = `<!DOCTYPE html><html lang="cs"><head><meta charset="UTF-8"><style>
@page{size:A4 portrait;margin:0}
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:'Times New Roman',Times,serif;font-size:7pt;line-height:1.35;color:#111}
.page{display:grid;grid-template-columns:105mm 105mm;grid-template-rows:74mm 74mm 74mm 74mm;width:210mm;height:297mm}
.page-break{page-break-after:always}
.cell{overflow:hidden;padding:${s.Y1}mm ${s.X2}mm ${s.Y2}mm ${s.X1}mm;${cellBorder}}
.cell-empty{background:#f5f5f5}
.top{max-height:${s.H}mm;overflow:hidden;padding:${s.PY}mm ${s.PX}mm 0}
.title{text-align:center;font-weight:bold;text-transform:uppercase;letter-spacing:.3px;margin-bottom:3pt;font-size:6.5pt}
.p{margin-bottom:2.5pt}
.sig{margin-top:6pt}
.sig-name{margin-top:12pt;text-align:right}
.sep{margin:4pt 0;${s.cut_line ? 'border-top:1pt dashed #999;' : ''}}
table{width:100%;border-collapse:collapse;font-size:6.5pt}
td{${s.bot_border ? 'border:0.3pt solid #888;' : ''}padding:1.5pt 3pt;vertical-align:top;line-height:1.3}
td:first-child{width:48%}
</style></head><body>
${pagesHtml}
<script>window.addEventListener('load',()=>window.print())<\/script>
</body></html>`;
  const w = window.open('', '_blank');
  if (!w) { showToast('Povolte popup v adresním řádku.'); return; }
  w.document.write(html);
  w.document.close();
  autoSaveRecord();
  showPostPrintToast();
}

// ── NOVÉ OVĚŘENÍ ──────────────────────────────────────────────────

export function noveOvereni() {
  // a) Vymaž fotografie
  state.uploadedImages = [];
  renderChips();
  hideOcrSuccess();
  document.getElementById('fileInput').value = '';

  // b) Vymaž pole klienta
  ['fJmeno','fDatumNar','fMistoNar','fAdresa','fCisloOp','fStatOb'].forEach(id => {
    const el = document.getElementById(id);
    if (el) { el.value = ''; el.classList.remove('warn','danger','invalid'); }
  });

  // c) Pole doložky — listina smaž, ostatní nastav
  const listEl = document.getElementById('fListina');
  if (listEl) { listEl.value = ''; listEl.classList.remove('warn','invalid'); }

  const kniha = getKniha();
  const lastRec = kniha[0];
  const nextRadku = lastRec?.cisloRadku ? parseInt(lastRec.cisloRadku, 10) + 1 : 1;
  const elRadku = document.getElementById('fCisloRadku');
  if (elRadku) { elRadku.value = nextRadku; elRadku.classList.remove('warn','invalid'); }

  prefillDates();

  const elPocet = document.getElementById('fPocetVyh');
  if (elPocet) { elPocet.value = 1; elPocet.classList.remove('warn','invalid'); }

  // e) Sbal náhled doložky
  document.getElementById('previewBody')?.classList.remove('open');
  document.getElementById('previewArrow')?.classList.remove('open');

  // Vymaž validační chyby
  document.getElementById('validationErrors')?.classList.remove('visible');
  document.querySelectorAll('.form-input.warn, .form-input.invalid')
    .forEach(el => el.classList.remove('warn','invalid'));

  updatePreview();

  // f) Scrolluj nahoru
  window.scrollTo({ top: 0, behavior: 'smooth' });

  // g) Zavři post-print toast
  closePostPrintToast();

  // h) Krátký toast
  showToast('Připraveno pro nové ověření');
}


export function showPostPrintToast() {
  document.getElementById('postPrintToast').classList.add('show');
}


export function closePostPrintToast() {
  document.getElementById('postPrintToast').classList.remove('show');
}

// ── SPLIT MENU ────────────────────────────────────────────────────
