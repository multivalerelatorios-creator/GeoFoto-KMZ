ALTER TABLE tenant_sessions ADD COLUMN username TEXT NOT NULL DEFAULT '';
CREATE TABLE IF NOT EXISTS reference_kmz (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  owner_username TEXT NOT NULL DEFAULT '',
  scope TEXT NOT NULL CHECK(scope IN ('personal','company')),
  name TEXT NOT NULL,
  size_bytes INTEGER NOT NULL DEFAULT 0,
  object_key TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_reference_kmz_tenant_scope ON reference_kmz(tenant_id,scope,owner_username,created_at);
