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

// ════════════════════════════════════════════════════════════════════
// OSN (UN Security Council) + MZV ČR — přidané zdroje. Stejná normalizační
// pipeline jako EU (primární jméno = první alias s neprázdným normalizovaným
// tvarem = latinka; originální písma → aliases), aby předfiltr LIKE fungoval.
// ════════════════════════════════════════════════════════════════════

// Sdílená tvorba záznamu (společné pro UN i CZ). `names` = všechny varianty jména.
function makeRecord(names, extra = {}) {
  const uniq = [];
  for (const n of names) { const t = String(n || '').replace(/\s+/g, ' ').trim(); if (t && !uniq.includes(t)) uniq.push(t); }
  if (!uniq.length) return null;
  let idx = uniq.findIndex(n => normalizeName(n).length >= 2);   // první latinkové
  if (idx < 0) idx = 0;
  const fullName = uniq[idx];
  const aliases = uniq.filter((_, i) => i !== idx);
  return {
    source: extra.source,
    full_name: fullName,
    name_normalized: normalizeName(fullName),
    aliases: aliases.length ? JSON.stringify(aliases) : null,
    birth_date: extra.birth_date || null,
    nationality: extra.nationality || null,
    reason: extra.reason || null,
    listed_since: extra.listed_since || null,
    raw_record: JSON.stringify({ names: uniq, ...(extra.raw || {}) }),
  };
}

function innerText(block, tag) {
  const m = String(block).match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`));
  return m ? decodeEntities(m[1]).trim() : '';
}
function allBlocksOf(xml, tag) {
  return String(xml).match(new RegExp(`<${tag}>[\\s\\S]*?</${tag}>`, 'g')) || [];
}

// Zápis jednoho zdroje: DELETE WHERE source=? + batched INSERT (11 řádků / ≤99 params).
async function replaceSourceRows(env, table, cols, records, source) {
  const ph = `(${cols.map(() => '?').join(', ')})`;
  const stmts = [env.DB.prepare(`DELETE FROM ${table} WHERE source = ?`).bind(source)];
  for (let i = 0; i < records.length; i += ROWS_PER_STMT) {
    const chunk = records.slice(i, i + ROWS_PER_STMT);
    const sql = `INSERT INTO ${table} (${cols.join(', ')}) VALUES ${chunk.map(() => ph).join(', ')}`;
    const binds = [];
    for (const r of chunk) for (const c of cols) binds.push(r[c] ?? null);
    stmts.push(env.DB.prepare(sql).bind(...binds));
  }
  for (let i = 0; i < stmts.length; i += STMTS_PER_BATCH) await env.DB.batch(stmts.slice(i, i + STMTS_PER_BATCH));
  return records.length;
}

// ── OSN — konsolidovaný seznam Rady bezpečnosti (INDIVIDUALS + ENTITIES) ──
export const UN_SANCTIONS_URL = 'https://scsanctions.un.org/resources/xml/en/consolidated.xml';
export function parseUnSanctions(xml) {
  const persons = [], entities = [];
  for (const block of allBlocksOf(xml, 'INDIVIDUAL')) {
    const primary = ['FIRST_NAME', 'SECOND_NAME', 'THIRD_NAME', 'FOURTH_NAME'].map(t => innerText(block, t)).filter(Boolean).join(' ');
    const names = primary ? [primary] : [];
    for (const al of allBlocksOf(block, 'INDIVIDUAL_ALIAS')) { const a = innerText(al, 'ALIAS_NAME'); if (a) names.push(a); }
    const dob = allBlocksOf(block, 'INDIVIDUAL_DATE_OF_BIRTH')[0] || '';
    const rec = makeRecord(names, {
      source: 'UN', birth_date: innerText(dob, 'DATE') || innerText(dob, 'YEAR') || '',
      nationality: innerText(allBlocksOf(block, 'NATIONALITY')[0] || '', 'VALUE'),
      reason: innerText(block, 'UN_LIST_TYPE'), listed_since: innerText(block, 'LISTED_ON'),
      raw: { ref: innerText(block, 'REFERENCE_NUMBER') },
    });
    if (rec) persons.push(rec);
  }
  for (const block of allBlocksOf(xml, 'ENTITY')) {
    const names = [];
    const primary = innerText(block, 'FIRST_NAME'); if (primary) names.push(primary);
    for (const al of allBlocksOf(block, 'ENTITY_ALIAS')) { const a = innerText(al, 'ALIAS_NAME'); if (a) names.push(a); }
    const rec = makeRecord(names, { source: 'UN', reason: innerText(block, 'UN_LIST_TYPE'), listed_since: innerText(block, 'LISTED_ON'), raw: { ref: innerText(block, 'REFERENCE_NUMBER') } });
    if (rec) entities.push(rec);
  }
  return { persons, entities };
}

export async function importUnSanctions(env) {
  const res = await fetch(UN_SANCTIONS_URL);
  if (!res.ok) throw new Error(`OSN download failed: ${res.status}`);
  const { persons, entities } = parseUnSanctions(await res.text());
  if (persons.length + entities.length < 500) throw new Error(`sanity_check_failed (OSN): persons=${persons.length} entities=${entities.length} < 500 — nepřepsáno`);
  if (persons.concat(entities).some(r => !(r.name_normalized || '').trim())) throw new Error('sanity_check_failed (OSN): záznam s prázdným name_normalized');
  const p = await replaceSourceRows(env, 'sanctions', COLS, persons, 'UN');
  const e = await replaceSourceRows(env, 'sanctions_entities', ENTITY_COLS, entities, 'UN');
  return { persons: p, entities: e };
}

// ── MZV ČR — vnitrostátní sankční seznam (CSV; URL zjišťujeme dynamicky z NKOD) ──
// jednoduchý RFC4180 CSV parser (uvozovky, čárky i zalomení uvnitř uvozovek).
export function parseCsv(text) {
  const rows = []; let row = [], field = '', inQ = false;
  text = String(text).replace(/^﻿/, '');
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQ = false; }
      else field += c;
    } else if (c === '"') inQ = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\r') { /* skip */ }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
}

export function parseCzSanctions(csvText) {
  const rows = parseCsv(csvText);
  const persons = [], entities = [];
  for (let r = 1; r < rows.length; r++) {           // řádek 0 = hlavička
    const row = rows[r];
    const surnameField = (row[0] || '').trim();
    const nameField = (row[1] || '').trim();
    if (!surnameField && !nameField) continue;      // prázdný oddělovací řádek
    const surnames = surnameField.split('/').map(s => s.trim()).filter(Boolean);
    const given = nameField.split('/').map(s => s.trim()).filter(Boolean);
    const isPerson = given.length > 0;              // má jméno FO → osoba; jinak entita
    const names = [];
    if (isPerson) {
      const n = Math.max(surnames.length, given.length);
      for (let i = 0; i < n; i++) {
        const full = `${given[i] || given[0] || ''} ${surnames[i] || surnames[0] || ''}`.trim();
        if (full) names.push(full);
      }
    } else for (const s of surnames) names.push(s);
    const rec = makeRecord(names, {
      source: 'CZ', birth_date: isPerson ? (row[2] || '').trim() : null,
      nationality: (row[3] || '').trim(), reason: ((row[8] || '') || (row[9] || '')).trim().slice(0, 500),
      listed_since: (row[5] || '').trim(), raw: { usneseni: (row[6] || '').trim() },
    });
    if (!rec) continue;
    (isPerson ? persons : entities).push(rec);
  }
  return { persons, entities };
}

// URL CSV z MZV se mění (datovaný název) → zjisti aktuální distribuci z Národního
// katalogu otevřených dat (NKOD SPARQL). Filtr jen ASCII substringy (kvůli diakritice).
export async function resolveCzCsvUrl() {
  const q = 'PREFIX dcterms:<http://purl.org/dc/terms/> PREFIX dcat:<http://www.w3.org/ns/dcat#> '
    + 'SELECT ?dl WHERE { ?ds a dcat:Dataset; dcterms:title ?t; dcat:distribution ?d. ?d dcat:downloadURL ?dl. '
    + 'FILTER(CONTAINS(LCASE(STR(?t)),"vnitrost")) FILTER(CONTAINS(LCASE(STR(?t)),"sank")) '
    + 'FILTER(CONTAINS(LCASE(STR(?dl)),".csv")) } LIMIT 1';
  const res = await fetch('https://data.gov.cz/sparql?query=' + encodeURIComponent(q), { headers: { Accept: 'application/sparql-results+json' } });
  if (!res.ok) throw new Error(`NKOD SPARQL ${res.status}`);
  const j = await res.json();
  const url = j?.results?.bindings?.[0]?.dl?.value;
  if (!url) throw new Error('CZ CSV URL nenalezena v NKOD');
  return url;
}

export async function importCzSanctions(env) {
  const url = await resolveCzCsvUrl();
  const res = await fetch(url);
  if (!res.ok) throw new Error(`MZV CSV download failed: ${res.status}`);
  const { persons, entities } = parseCzSanctions(await res.text());
  if (persons.length + entities.length < 3) throw new Error(`sanity_check_failed (MZV): total=${persons.length + entities.length} < 3 — nepřepsáno`);
  if (persons.concat(entities).some(r => !(r.name_normalized || '').trim())) throw new Error('sanity_check_failed (MZV): záznam s prázdným name_normalized');
  const p = await replaceSourceRows(env, 'sanctions', COLS, persons, 'CZ');
  const e = await replaceSourceRows(env, 'sanctions_entities', ENTITY_COLS, entities, 'CZ');
  return { persons: p, entities: e, url };
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
