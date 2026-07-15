-- Blok B — tabulka žádostí o demo (POST /api/demo-request).
-- Spuštění na produkční D1:
--   npx wrangler d1 execute legalid-db --remote --file worker/migrations/demo_requests.sql
-- Pozn.: sloupec `ip` slouží pro rate limit (max 3 žádosti / IP / hodinu).

CREATE TABLE IF NOT EXISTS demo_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT,
  message TEXT,
  utm_source TEXT,
  ip TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_demo_requests_ip_created ON demo_requests (ip, created_at);
