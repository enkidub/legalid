-- app_meta: jednoduchý key-value pro provozní metadata (např. čas posledního
-- úspěšného importu EU sankcí pro cron alerting). Aplikováno na remote D1.
CREATE TABLE IF NOT EXISTS app_meta (key TEXT PRIMARY KEY, value TEXT);
