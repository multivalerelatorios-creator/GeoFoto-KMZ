
CREATE TABLE IF NOT EXISTS tenant_recovery (
  tenant_id TEXT PRIMARY KEY,
  recovery_hash TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS registration_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ip_hash TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_registration_ip_time ON registration_log(ip_hash,created_at);
