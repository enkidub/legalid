-- Krok 4 (AI návrh rizika): povinná osoba může AI návrh editovat. Ukládáme jen
-- příznak, že text byl upraven (bez verzování obsahu). Finální znění je v
-- ai_risk_reasoning (JSON, pole reasoning_cs) a jde přímo do PDF.
--
-- Spustit proti remote D1:
--   npx wrangler d1 execute legalid-db --remote --file=migrations/ai_risk_edited.sql

ALTER TABLE aml_cases ADD COLUMN ai_risk_edited INTEGER NOT NULL DEFAULT 0;
