-- Viditelnost nástrojů podpisů (doložka, kniha) v profilu povinné osoby.
-- NULL = neurčeno (odvozuje se z entity_type), 1 = zobrazit, 0 = skrýt.
-- Spustit proti remote D1 (z adresáře worker/):
--   npx wrangler d1 execute legalid-db --remote --file=migrations/profile_v2.sql

ALTER TABLE user_profiles ADD COLUMN show_signature_tools INTEGER;
