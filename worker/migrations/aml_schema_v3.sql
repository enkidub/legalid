-- Týden 3: lustrace v rejstřících — sankce, PEP, log lustrací.
-- Spustit proti remote D1:
--   npx wrangler d1 execute legalid-db --remote --file=migrations/aml_schema_v3.sql

CREATE TABLE IF NOT EXISTS sanctions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source TEXT NOT NULL,             -- 'EU' (V2: 'OFAC', 'UN')
  full_name TEXT NOT NULL,
  name_normalized TEXT NOT NULL,    -- lowercase, bez diakritiky, pro fuzzy match
  aliases TEXT,                     -- JSON pole alternativních jmen
  birth_date TEXT,
  nationality TEXT,
  reason TEXT,
  listed_since TEXT,
  raw_record TEXT,                  -- původní záznam ze zdroje (JSON)
  imported_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_sanctions_name_norm ON sanctions(name_normalized);
CREATE INDEX IF NOT EXISTS idx_sanctions_source ON sanctions(source);

CREATE TABLE IF NOT EXISTS pep (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  full_name TEXT NOT NULL,
  name_normalized TEXT NOT NULL,
  position TEXT,                    -- 'poslanec', 'senator', 'ministr', 'prezident', 'guverner_cnb', 'clen_vlady'
  organization TEXT,                -- 'PSP ČR', 'Senát ČR', 'Vláda ČR', 'Kancelář prezidenta', 'ČNB'
  source_country TEXT DEFAULT 'CZ',
  active_since TEXT,
  active_until TEXT,                -- NULL = stále aktivní
  source TEXT,                      -- 'manual_cz' | 'opensanctions'
  notes TEXT,
  imported_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_pep_name_norm ON pep(name_normalized);

CREATE TABLE IF NOT EXISTS aml_lookups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  case_id INTEGER NOT NULL,
  lookup_type TEXT NOT NULL,        -- 'mvcr' | 'isir' | 'ares' | 'sanctions' | 'pep'
  result_status TEXT,               -- 'clean' | 'warning' | 'match' | 'error'
  result_details TEXT,              -- JSON s výsledkem nebo popis chyby
  matched_against TEXT,             -- jméno z databáze (u fuzzy match)
  match_score REAL,                 -- 0.0-1.0
  checked_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (case_id) REFERENCES aml_cases(id)
);

CREATE INDEX IF NOT EXISTS idx_aml_lookups_case ON aml_lookups(case_id);
