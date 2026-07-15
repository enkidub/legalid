-- Týden 4: dokončení AML wizardu (kroky 3–5 + upgrade kroků 0–1).
-- Čistě aditivní migrace. Spustit proti remote D1 (z adresáře worker/):
--   npx wrangler d1 execute legalid-db --remote --file=migrations/aml_v6.sql
--
-- POZOR: backfill case_number je idempotentní (WHERE case_number IS NULL OR '').

-- ── aml_cases: nové sloupce ──
ALTER TABLE aml_cases ADD COLUMN case_number TEXT;            -- 'AML-YYYYMM-XXXXXX'
ALTER TABLE aml_cases ADD COLUMN client_name_original TEXT;   -- jméno v originále (azbuka…)
ALTER TABLE aml_cases ADD COLUMN relation_type TEXT;          -- 'jednorazovy' | 'obchodni_vztah'
ALTER TABLE aml_cases ADD COLUMN deal_value_band TEXT;        -- 'do_1k' | '1k_15k' | '15k_plus' (EUR)
ALTER TABLE aml_cases ADD COLUMN deal_countries TEXT;
ALTER TABLE aml_cases ADD COLUMN purpose_category TEXT;
ALTER TABLE aml_cases ADD COLUMN source_of_funds_type TEXT;   -- select hodnota
ALTER TABLE aml_cases ADD COLUMN source_of_funds TEXT;        -- upřesnění textem
ALTER TABLE aml_cases ADD COLUMN client_occupation TEXT;
ALTER TABLE aml_cases ADD COLUMN consistency_json TEXT;
ALTER TABLE aml_cases ADD COLUMN client_declaration_json TEXT;
ALTER TABLE aml_cases ADD COLUMN verifier_declaration_json TEXT;
ALTER TABLE aml_cases ADD COLUMN risk_justification TEXT;
ALTER TABLE aml_cases ADD COLUMN record_sha256 TEXT;
ALTER TABLE aml_cases ADD COLUMN terminated_reason TEXT;      -- pro § 15 ukončení

-- ── aml_documents: rozšíření o pole pro podpůrné dokumenty (Blok 3) ──
-- Tabulka už existuje (doklady totožnosti). Podpůrné dokumenty se NEPERSISTUJÍ:
-- řádek má content_base64 = NULL a naplněné mime_type / sha256 / extracted_json / ai_summary.
ALTER TABLE aml_documents ADD COLUMN mime_type TEXT;
ALTER TABLE aml_documents ADD COLUMN sha256 TEXT;
ALTER TABLE aml_documents ADD COLUMN extracted_json TEXT;
ALTER TABLE aml_documents ADD COLUMN ai_summary TEXT;

-- ── Backfill case_number existujícím případům ──
-- hex(randomblob(4)) → 8 hex znaků (0-9A-F, velká písmena); vezmeme prvních 6.
UPDATE aml_cases
   SET case_number = 'AML-' || strftime('%Y%m', COALESCE(created_at, 'now')) || '-' || substr(hex(randomblob(4)), 1, 6)
 WHERE case_number IS NULL OR case_number = '';
