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
  const fullName = names[0];
  const aliases = names.slice(1);

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

// Zápis sankčních ENTIT (firem) do sanctions_entities (bez birth_date).
export async function writeSanctionEntitiesToD1(env, records, chunkSize = 50) {
  await env.DB.prepare("DELETE FROM sanctions_entities WHERE source = 'EU'").run();
  const placeholders = `(${ENTITY_COLS.map(() => '?').join(', ')})`;
  let inserted = 0;
  for (let i = 0; i < records.length; i += chunkSize) {
    const chunk = records.slice(i, i + chunkSize);
    const sql = `INSERT INTO sanctions_entities (${ENTITY_COLS.join(', ')}) VALUES ${chunk.map(() => placeholders).join(', ')}`;
    const binds = [];
    for (const r of chunk) for (const c of ENTITY_COLS) binds.push(r[c] ?? null);
    await env.DB.prepare(sql).bind(...binds).run();
    inserted += chunk.length;
  }
  return inserted;
}

// Kompletní cron krok: stáhnout → parse → zapsat osoby i entity.
export async function importEuSanctions(env) {
  const res = await fetch(EU_SANCTIONS_URL);
  if (!res.ok) throw new Error(`EU FSD download failed: ${res.status}`);
  const xml = await res.text();
  const { persons, entities } = parseEuSanctions(xml);
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
