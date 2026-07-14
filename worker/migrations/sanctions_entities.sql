-- Blok B: sankční entity (firmy) — stejná struktura jako sanctions, bez birth_date.
--   npx wrangler d1 execute legalid-db --remote --file=migrations/sanctions_entities.sql

CREATE TABLE IF NOT EXISTS sanctions_entities (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source TEXT NOT NULL,             -- 'EU' (V2: 'OFAC', 'UN')
  full_name TEXT NOT NULL,
  name_normalized TEXT NOT NULL,    -- lowercase, bez diakritiky a právních forem
  aliases TEXT,                     -- JSON pole alternativních názvů
  nationality TEXT,
  reason TEXT,
  listed_since TEXT,
  raw_record TEXT,
  imported_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_sanctions_entities_name_norm ON sanctions_entities(name_normalized);
CREATE INDEX IF NOT EXISTS idx_sanctions_entities_source ON sanctions_entities(source);
