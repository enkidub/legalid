-- Týden 4 refaktor: sloučení kroků 0+1 do jednoho „Údaje klienta".
-- Nová pole formuláře (RČ, IČO) + přečíslování kroků.
-- Wizard nově 5 kroků (0-index): 0=Údaje, 1=Lustrace, 2=Účel, 3=Riziko, 4=Hotovo.
-- Původní: 0=Způsob, 1=Doklad, 2=Lustrace, 3=Účel, 4=Riziko, 5=Hotovo.
--
-- POZOR: UPDATE current_step spouštět POUZE JEDNOU (opětovné spuštění by posunulo znovu).
--   npx wrangler d1 execute legalid-db --remote --file=migrations/aml_cases_v4.sql

ALTER TABLE aml_cases ADD COLUMN client_rc TEXT;
ALTER TABLE aml_cases ADD COLUMN client_ico TEXT;

-- Mapování kroků: 0→0, 1→0 (Způsob i Doklad splynuly do Údaje), 2→1, 3→2, 4→3, 5→4.
UPDATE aml_cases SET current_step = CASE WHEN current_step <= 1 THEN 0 ELSE current_step - 1 END;
