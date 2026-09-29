CREATE TABLE IF NOT EXISTS tenants (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS points (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  technician TEXT NOT NULL DEFAULT '',
  lat REAL NOT NULL,
  lng REAL NOT NULL,
  accuracy REAL NOT NULL DEFAULT 0,
  time TEXT NOT NULL,
  city TEXT NOT NULL DEFAULT '',
  address TEXT NOT NULL DEFAULT '',
  photo_key TEXT NOT NULL DEFAULT '',
  tenant_id TEXT NOT NULL DEFAULT 'principal'
);
CREATE INDEX IF NOT EXISTS idx_points_tenant_time ON points(tenant_id,time);
CREATE TABLE IF NOT EXISTS tenant_config (
  tenant_id TEXT PRIMARY KEY,
  data TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS tenant_users (
  tenant_id TEXT NOT NULL,
  username TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user',
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (tenant_id,username)
);

CREATE TABLE IF NOT EXISTS tenant_sessions (
  token TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user',
  username TEXT NOT NULL DEFAULT '',
  expires_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_expiry ON tenant_sessions(expires_at);

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

INSERT OR IGNORE INTO tenants (id,name) VALUES ('principal','Conta principal');

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

CREATE TABLE IF NOT EXISTS master_users (
  username TEXT PRIMARY KEY,
  password_hash TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS master_sessions (
  token TEXT PRIMARY KEY,
  username TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_master_sessions_expiry ON master_sessions(expires_at);
