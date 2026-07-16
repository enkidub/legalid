-- Fix regrese PEP lustrace: alias předfiltr (name_normalized LIKE ? OR aliases LIKE ?)
-- v dbCandidates() se aplikuje i na tabulku `pep`, která sloupec `aliases` neměla
-- → "D1_ERROR: no such column: aliases". Sjednocujeme schéma se `sanctions` /
-- `sanctions_entities`. Prázdný default = předfiltr se chová jako dřív (žádné aliasy
-- k rozbalení), do budoucna umožní ukládat latinkové přepisy stejně jako u sankcí.
--
-- Spustit proti remote D1:
--   npx wrangler d1 execute legalid-db --remote --file=migrations/pep_aliases.sql

ALTER TABLE pep ADD COLUMN aliases TEXT NOT NULL DEFAULT '';
