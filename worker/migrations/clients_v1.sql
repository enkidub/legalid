-- Centrální evidence klientů (jeden zdroj pravdy). Doložka i AML zapisují sem,
-- modul Klienti i dlaždice „Existující klient" čtou odsud.
-- Spustit proti remote D1 (z adresáře worker/):
--   npx wrangler d1 execute legalid-db --remote --file=migrations/clients_v1.sql
--
-- POZN.: aml_cases.client_id UŽ EXISTUJE (z aml_schema.sql) a je nepoužívaný —
-- používáme ho jako FK na clients, proto NEPŘIDÁVÁME client_ref_id.

CREATE TABLE IF NOT EXISTS clients (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  subject_type TEXT DEFAULT 'fo',        -- fo | fo_podnikatel | po
  name TEXT, surname TEXT,               -- FO
  company_name TEXT, ico TEXT,           -- PO / OSVČ
  birth_date TEXT, birth_place TEXT, rc TEXT,
  doc_type TEXT, doc_number TEXT,
  address TEXT, nationality TEXT,
  email TEXT, phone TEXT,
  last_aml_case_id INTEGER, last_aml_date TEXT,
  last_risk_level TEXT, next_review_due TEXT,
  created_from TEXT,                     -- 'dolozka' | 'aml' | 'manual' | 'import'
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT,
  FOREIGN KEY (user_id) REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_clients_user ON clients(user_id);
