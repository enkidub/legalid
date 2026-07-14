// legalid.cz — worker/scripts/import_sanctions.js
// Jednorázový (a opakovatelný) import EU sankčního seznamu.
//
// Stáhne FSD XML, vyparsuje fyzické osoby a vygeneruje SQL soubor,
// který se aplikuje na remote D1 přes wrangler:
//
//   node scripts/import_sanctions.js
//   npx wrangler d1 execute legalid-db --remote --file=scripts/import_sanctions.generated.sql
//
// (Runtime cron používá importEuSanctions() z utils/sanctions.js a zapisuje do D1 přímo.)

import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parseEuSanctionsXml, buildSanctionsSql, EU_SANCTIONS_URL } from '../utils/sanctions.js';

const OUT = join(dirname(fileURLToPath(import.meta.url)), 'import_sanctions.generated.sql');

async function main() {
  console.log('Stahuji EU FSD XML…');
  const res = await fetch(EU_SANCTIONS_URL);
  if (!res.ok) throw new Error(`Download failed: ${res.status}`);
  const xml = await res.text();
  console.log(`Staženo ${(xml.length / 1e6).toFixed(1)} MB, parsuji…`);

  const records = parseEuSanctionsXml(xml);
  const withDob = records.filter(r => r.birth_date).length;
  const withAlias = records.filter(r => r.aliases).length;

  writeFileSync(OUT, buildSanctionsSql(records), 'utf8');

  console.log(`Osob (typ P): ${records.length}`);
  console.log(`  z toho s datem narození: ${withDob}`);
  console.log(`  z toho s aliasy:         ${withAlias}`);
  console.log(`SQL zapsáno: ${OUT}`);
  console.log('Aplikuj: npx wrangler d1 execute legalid-db --remote --file=scripts/import_sanctions.generated.sql');
}

main().catch(e => { console.error(e); process.exit(1); });
