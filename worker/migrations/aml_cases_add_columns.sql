-- Týden 2 follow-up: doplnění sloupců pro datum vydání dokladu a pohlaví klienta.
ALTER TABLE aml_cases ADD COLUMN client_doc_issued_at TEXT;
ALTER TABLE aml_cases ADD COLUMN client_gender TEXT;
