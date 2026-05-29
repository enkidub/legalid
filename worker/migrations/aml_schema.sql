CREATE TABLE IF NOT EXISTS aml_cases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  client_id INTEGER,
  status TEXT DEFAULT 'in_progress',           -- in_progress | completed | abandoned
  current_step INTEGER DEFAULT 0,
  identification_method TEXT,                   -- 'personal' (V2: remote, bankid, V3: micropayment)
  client_name TEXT,
  client_surname TEXT,
  client_birth_date TEXT,
  client_birth_place TEXT,
  client_address TEXT,
  client_nationality TEXT,
  client_doc_type TEXT,
  client_doc_number TEXT,
  client_doc_valid_until TEXT,
  business_purpose TEXT,
  ai_risk_suggestion TEXT,
  ai_risk_reasoning TEXT,
  final_risk_level TEXT,
  risk_decided_at TEXT,
  final_pdf_generated INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  completed_at TEXT,
  next_review_due TEXT,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS aml_documents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  case_id INTEGER NOT NULL,
  doc_type TEXT NOT NULL,                       -- 'doklad_front' | 'doklad_back' | 'kupni_smlouva' | 'jine'
  filename TEXT,
  content_base64 TEXT,
  content_size_bytes INTEGER,
  ai_extracted_data TEXT,                       -- JSON string
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (case_id) REFERENCES aml_cases(id)
);

CREATE INDEX IF NOT EXISTS idx_aml_cases_user ON aml_cases(user_id);
CREATE INDEX IF NOT EXISTS idx_aml_cases_status ON aml_cases(status);
CREATE INDEX IF NOT EXISTS idx_aml_documents_case ON aml_documents(case_id);
