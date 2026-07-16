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

// Parse jednoho <sanctionEntity> bloku → společná pole (bez birth_date). null když nemá jméno.
function parseCommon(block) {
  const headEnd = block.indexOf('>');
  const head = block.slice(0, headEnd);
  const euRef = attr(head, 'euReferenceNumber');
  const logicalId = attr(head, 'logicalId');

  const names = [];
  for (const t of allTags(block, 'nameAlias')) {
    const wn = attr(t, 'wholeName').trim();
    if (wn && !names.includes(wn)) names.push(wn);
  }
  if (names.length === 0) return null;
  // Primární jméno musí mít NEPRÁZDNÝ normalizovaný tvar — první alias bývá v azbuce
  // (normalizeName ji smaže na ""), takže by ho prefiltr LIKE '%…%' nikdy nenašel.
  // Vyber první latinkový alias; azbuku (i zbytek) nech v aliasech pro fuzzy.
  let primaryIdx = names.findIndex(n => normalizeName(n).length >= 2);
  if (primaryIdx < 0) primaryIdx = 0;
  const fullName = names[primaryIdx];
  const aliases = names.filter((_, i) => i !== primaryIdx);

  const czTags = allTags(block, 'citizenship');
  const nationality = czTags.length
    ? (attr(czTags[0], 'countryDescription') || attr(czTags[0], 'countryIso2Code'))
    : '';

  const remarkM = block.match(/<remark>([^<]*)<\/remark>/);
  const regTags = allTags(block, 'regulation');
  const programme = regTags.length ? attr(regTags[0], 'programme') : '';
  const reason = (remarkM ? decodeEntities(remarkM[1]).trim() : '') || programme || '';
  const listedSince = regTags.length ? attr(regTags[0], 'publicationDate') : '';

  return {
    source: 'EU',
    full_name: fullName,
    name_normalized: normalizeName(fullName),
    aliases: aliases.length ? JSON.stringify(aliases) : null,
    nationality: nationality || null,
    reason: reason || null,
    listed_since: listedSince || null,
    raw_record: JSON.stringify({ euRef, logicalId, programme, names, nationality }),
  };
}

// Parse celého FSD XML → { persons, entities }.
// Osoby: classificationCode="P" (+ birth_date). Entity/firmy: classificationCode="E".
export function parseEuSanctions(xml) {
  const persons = [], entities = [];
  const parts = xml.split('<sanctionEntity');
  for (let i = 1; i < parts.length; i++) {
    const end = parts[i].indexOf('</sanctionEntity>');
    const block = end >= 0 ? parts[i].slice(0, end) : parts[i];
    const isPerson = /classificationCode="P"/.test(block);
    const isEntity = /classificationCode="E"/.test(block);
    if (!isPerson && !isEntity) continue;

    const base = parseCommon(block);
    if (!base) continue;

    if (isPerson) {
      const bdTags = allTags(block, 'birthdate');
      const birthDate = bdTags.length ? (attr(bdTags[0], 'birthdate') || attr(bdTags[0], 'year') || '') : '';
      persons.push({ ...base, birth_date: birthDate || null });
    } else {
      entities.push(base);
    }
  }
  return { persons, entities };
}

// Zpětná kompatibilita (import script) — vrací jen osoby.
export function parseEuSanctionsXml(xml) {
  return parseEuSanctions(xml).persons;
}

const COLS = ['source', 'full_name', 'name_normalized', 'aliases', 'birth_date', 'nationality', 'reason', 'listed_since', 'raw_record'];
const ENTITY_COLS = ['source', 'full_name', 'name_normalized', 'aliases', 'nationality', 'reason', 'listed_since', 'raw_record'];

// ── zápis do D1 (cron ve Workeru) ──
// D1 má limit ~100 bind parametrů na jeden dotaz → víceřádkový INSERT musí mít
// málo řádků na statement. Posíláme přes DB.batch() (méně round-tripů).
const ROWS_PER_STMT = 11;     // 11 × 9 sloupců = 99 parametrů (< 100)
const STMTS_PER_BATCH = 30;

async function replaceEuRows(env, table, cols, records) {
  const ph = `(${cols.map(() => '?').join(', ')})`;
  const stmts = [env.DB.prepare(`DELETE FROM ${table} WHERE source = 'EU'`)];
  for (let i = 0; i < records.length; i += ROWS_PER_STMT) {
    const chunk = records.slice(i, i + ROWS_PER_STMT);
    const sql = `INSERT INTO ${table} (${cols.join(', ')}) VALUES ${chunk.map(() => ph).join(', ')}`;
    const binds = [];
    for (const r of chunk) for (const c of cols) binds.push(r[c] ?? null);
    stmts.push(env.DB.prepare(sql).bind(...binds));
  }
  for (let i = 0; i < stmts.length; i += STMTS_PER_BATCH) {
    await env.DB.batch(stmts.slice(i, i + STMTS_PER_BATCH));
  }
  return records.length;
}

export function writeSanctionsToD1(env, records) { return replaceEuRows(env, 'sanctions', COLS, records); }
export function writeSanctionEntitiesToD1(env, records) { return replaceEuRows(env, 'sanctions_entities', ENTITY_COLS, records); }

// Kompletní cron krok: stáhnout → parse → zapsat osoby i entity.
export async function importEuSanctions(env) {
  const res = await fetch(EU_SANCTIONS_URL);
  if (!res.ok) throw new Error(`EU FSD download failed: ${res.status}`);
  const xml = await res.text();
  const { persons, entities } = parseEuSanctions(xml);
  // POJISTKA: nikdy nepřepiš tabulku podezřele prázdným/vadným parse (změna formátu
  // zdroje ap.). Zdroj má tisíce osob a musí obsahovat notoricky sankcionované jméno.
  const putinOk = persons.some(p => /\bputin\b/.test(p.name_normalized || ''));
  if (persons.length < 1000 || entities.length < 200 || !putinOk) {
    throw new Error(`sanity_check_failed: persons=${persons.length} entities=${entities.length} putin=${putinOk} — import zrušen, stará data ponechána`);
  }
  const insertedPersons = await writeSanctionsToD1(env, persons);
  const insertedEntities = await writeSanctionEntitiesToD1(env, entities);
  return { persons: insertedPersons, entities: insertedEntities };
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
