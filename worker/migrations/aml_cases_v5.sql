-- Blok A: podpora právnických osob (PO) a podnikajících FO v kroku Údaje klienta.
-- IČO firmy se ukládá do existujícího client_ico (nezakládáme duplicitní sloupec).
--   npx wrangler d1 execute legalid-db --remote --file=migrations/aml_cases_v5.sql

ALTER TABLE aml_cases ADD COLUMN subject_type TEXT DEFAULT 'fo';   -- 'fo' | 'fo_podnikatel' | 'po'
ALTER TABLE aml_cases ADD COLUMN company_name TEXT;
ALTER TABLE aml_cases ADD COLUMN company_address TEXT;
ALTER TABLE aml_cases ADD COLUMN acting_person_role TEXT;          -- 'jednatel' | 'clen_predstavenstva' | 'zmocnenec' | 'jine'
ALTER TABLE aml_cases ADD COLUMN acting_person_note TEXT;
ALTER TABLE aml_cases ADD COLUMN esm_checked INTEGER DEFAULT 0;
ALTER TABLE aml_cases ADD COLUMN esm_note TEXT;
