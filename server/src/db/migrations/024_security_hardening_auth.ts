const { db, run, all, get } = require('../index');

module.exports = {
  name: "024_security_hardening_auth",
  up: ()=>{db.exec(`
        ALTER TABLE users ADD COLUMN totp_secret TEXT;
        ALTER TABLE users ADD COLUMN totp_enabled INTEGER NOT NULL DEFAULT 0;
        ALTER TABLE sessions ADD COLUMN fingerprint TEXT;
        CREATE TABLE IF NOT EXISTS login_failures (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          identifier TEXT NOT NULL,
          ip TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_login_failures_identifier ON login_failures(identifier, created_at);
        CREATE INDEX IF NOT EXISTS idx_login_failures_ip ON login_failures(ip, created_at);
      `)},
};
