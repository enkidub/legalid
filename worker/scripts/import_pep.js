// legalid.cz — worker/scripts/import_pep.js
// Vygeneruje seed SQL pro tabulku pep z pep_cz_seed.json (ruční CZ seznam).
//
//   node scripts/import_pep.js
//   npx wrangler d1 execute legalid-db --remote --file=scripts/pep_cz_seed.generated.sql

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { normalizeName } from '../utils/fuzzy.js';

const here = dirname(fileURLToPath(import.meta.url));
const IN = join(here, 'pep_cz_seed.json');
const OUT = join(here, 'pep_cz_seed.generated.sql');

const COLS = ['full_name', 'name_normalized', 'position', 'organization', 'source_country', 'active_since', 'active_until', 'source', 'notes'];
const sqlStr = v => v == null || v === '' ? 'NULL' : `'${String(v).replace(/'/g, "''")}'`;

const people = JSON.parse(readFileSync(IN, 'utf8'));
const lines = ["DELETE FROM pep WHERE source = 'manual_cz';"];
for (const p of people) {
  const row = {
    full_name: p.full_name,
    name_normalized: normalizeName(p.full_name),
    position: p.position || null,
    organization: p.organization || null,
    source_country: p.source_country || 'CZ',
    active_since: p.active_since || null,
    active_until: p.active_until || null,
    source: 'manual_cz',
    notes: p.notes || null,
  };
  lines.push(`INSERT INTO pep (${COLS.join(', ')}) VALUES (${COLS.map(c => sqlStr(row[c])).join(', ')});`);
}
writeFileSync(OUT, lines.join('\n') + '\n', 'utf8');
console.log(`PEP osob: ${people.length}`);
console.log(`SQL zapsáno: ${OUT}`);
console.log('Aplikuj: npx wrangler d1 execute legalid-db --remote --file=scripts/pep_cz_seed.generated.sql');
