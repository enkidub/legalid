-- Centrální profil povinné osoby (globální nastavení uživatele).
-- Propisuje se do AML záznamů i doložek; nahrazuje lokální doložkový „Profil advokáta".
-- Spustit proti remote D1 (z adresáře worker/):
--   npx wrangler d1 execute legalid-db --remote --file=migrations/profile_v1.sql

CREATE TABLE IF NOT EXISTS user_profiles (
  user_id INTEGER PRIMARY KEY,
  entity_type TEXT,              -- 'advokat'|'notar'|'exekutor'|'insolvencni_spravce'|
                                 -- 'danovy_poradce'|'auditor'|'ucetni'|'realitni'|
                                 -- 'drazebnik'|'sverensky_spravce'|'obchodnik'|
                                 -- 'zastavarna'|'jina'
  display_name TEXT,             -- jméno + titul / název kanceláře či firmy
  ico TEXT,
  reg_number TEXT,               -- ev. číslo (ČAK/NK/…) — label dle entity_type
  address TEXT,
  contact_email TEXT, contact_phone TEXT,
  logo_base64 TEXT, logo_mime TEXT,
  updated_at TEXT,
  FOREIGN KEY (user_id) REFERENCES users(id)
);
