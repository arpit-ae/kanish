CREATE TABLE IF NOT EXISTS store_receipts (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('order', 'enquiry')),
  request_key TEXT NOT NULL UNIQUE,
  payload TEXT NOT NULL,
  source_hash TEXT NOT NULL DEFAULT '',
  state TEXT NOT NULL CHECK (state IN ('awaiting_payment','ready','sent')),
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  next_attempt INTEGER NOT NULL DEFAULT 0,
  attempts INTEGER NOT NULL DEFAULT 0,
  mail_ids TEXT
);
CREATE INDEX IF NOT EXISTS store_receipts_queue ON store_receipts(state,next_attempt);
CREATE INDEX IF NOT EXISTS store_receipts_source ON store_receipts(source_hash,created_at);
