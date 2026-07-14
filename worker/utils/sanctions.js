// legalid.cz — worker/utils/sanctions.js
// Parsování EU konsolidovaného sankčního seznamu (FSD XML) + zápis do D1.
// Bez závislostí a bez XML knihovny — běží ve Workeru (cron) i v Node (import script).
//
// Zdroj: EU Financial Sanctions Database (FSD), konsolidovaný seznam ve formátu XML.
// Bereme jen fyzické osoby (subjectType classificationCode="P"); firmy přeskakujeme.

import { normalizeName } from './fuzzy.js';

export const EU_SANCTIONS_URL =
  'https://webgate.ec.europa.eu/fsd/fsf/public/files/xmlFullSanctionsList_1_1/content?token=dG9rZW4tMjAxNw';

// ── malé XML utility (bez DOM) ──
function decodeEntities(s) {
  return String(s || '')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, '&');
}
function attr(tagStr, name) {
  const m = tagStr.match(new RegExp(`\\b${name}="([^"]*)"`));
  return m ? decodeEntities(m[1]) : '';
}
function allTags(block, tag) {
  return block.match(new RegExp(`<${tag}\\b[^>]*>`, 'g')) || [];
}

// Parse celého FSD XML → pole záznamů (jen osoby).
export function parseEuSanctionsXml(xml) {
  const out = [];
  const parts = xml.split('<sanctionEntity');
  for (let i = 1; i < parts.length; i++) {
    const end = parts[i].indexOf('</sanctionEntity>');
    const block = end >= 0 ? parts[i].slice(0, end) : parts[i];

    // jen fyzické osoby
    if (!/classificationCode="P"/.test(block)) continue;

    const headEnd = block.indexOf('>');
    const head = block.slice(0, headEnd);
    const euRef = attr(head, 'euReferenceNumber');
    const logicalId = attr(head, 'logicalId');

    // jména (wholeName ze všech nameAlias, unikátní, neprázdná)
    const names = [];
    for (const t of allTags(block, 'nameAlias')) {
      const wn = attr(t, 'wholeName').trim();
      if (wn && !names.includes(wn)) names.push(wn);
    }
    if (names.length === 0) continue;   // bez použitelného jména nemá smysl ukládat
    const fullName = names[0];
    const aliases = names.slice(1);

    // datum narození — preferuj plné datum, jinak rok
    let birthDate = '';
    const bdTags = allTags(block, 'birthdate');
    if (bdTags.length) {
      birthDate = attr(bdTags[0], 'birthdate') || attr(bdTags[0], 'year') || '';
    }

    // občanství
    const czTags = allTags(block, 'citizenship');
    const nationality = czTags.length
      ? (attr(czTags[0], 'countryDescription') || attr(czTags[0], 'countryIso2Code'))
      : '';

    // důvod / program a datum zařazení z regulation
    const remarkM = block.match(/<remark>([^<]*)<\/remark>/);
    const regTags = allTags(block, 'regulation');
    const programme = regTags.length ? attr(regTags[0], 'programme') : '';
    const reason = (remarkM ? decodeEntities(remarkM[1]).trim() : '') || programme || '';
    const listedSince = regTags.length ? attr(regTags[0], 'publicationDate') : '';

    out.push({
      source: 'EU',
      full_name: fullName,
      name_normalized: normalizeName(fullName),
      aliases: aliases.length ? JSON.stringify(aliases) : null,
      birth_date: birthDate || null,
      nationality: nationality || null,
      reason: reason || null,
      listed_since: listedSince || null,
      raw_record: JSON.stringify({ euRef, logicalId, programme, names, birthDate, nationality }),
    });
  }
  return out;
}

const COLS = ['source', 'full_name', 'name_normalized', 'aliases', 'birth_date', 'nationality', 'reason', 'listed_since', 'raw_record'];

// ── zápis do D1 (cron ve Workeru) ──
// Smaže staré EU záznamy a vloží nové po dávkách. Vrací počet vložených.
export async function writeSanctionsToD1(env, records, chunkSize = 50) {
  await env.DB.prepare("DELETE FROM sanctions WHERE source = 'EU'").run();
  const placeholders = `(${COLS.map(() => '?').join(', ')})`;
  let inserted = 0;
  for (let i = 0; i < records.length; i += chunkSize) {
    const chunk = records.slice(i, i + chunkSize);
    const sql = `INSERT INTO sanctions (${COLS.join(', ')}) VALUES ${chunk.map(() => placeholders).join(', ')}`;
    const binds = [];
    for (const r of chunk) for (const c of COLS) binds.push(r[c] ?? null);
    await env.DB.prepare(sql).bind(...binds).run();
    inserted += chunk.length;
  }
  return inserted;
}

// Kompletní cron krok: stáhnout → parse → zapsat.
export async function importEuSanctions(env) {
  const res = await fetch(EU_SANCTIONS_URL);
  if (!res.ok) throw new Error(`EU FSD download failed: ${res.status}`);
  const xml = await res.text();
  const records = parseEuSanctionsXml(xml);
  const inserted = await writeSanctionsToD1(env, records);
  return { parsed: records.length, inserted };
}

// ── generování SQL souboru (jednorázový Node import přes wrangler) ──
function sqlStr(v) {
  if (v == null) return 'NULL';
  return `'${String(v).replace(/'/g, "''")}'`;
}
export function buildSanctionsSql(records) {
  const lines = ["DELETE FROM sanctions WHERE source = 'EU';"];
  for (const r of records) {
    const vals = COLS.map(c => sqlStr(r[c])).join(', ');
    lines.push(`INSERT INTO sanctions (${COLS.join(', ')}) VALUES (${vals});`);
  }
  return lines.join('\n') + '\n';
}
