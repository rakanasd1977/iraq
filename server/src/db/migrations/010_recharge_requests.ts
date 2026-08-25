const { db, run, all, get } = require('../index');

module.exports = {
  name: "010_recharge_requests",
  up: ()=>{db.exec(`
        CREATE TABLE recharge_requests (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          provider_id INTEGER NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
          reference TEXT NOT NULL UNIQUE,
          amount REAL NOT NULL,
          payment_method TEXT NOT NULL,
          note TEXT,
          proof_image TEXT,
          status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
          admin_note TEXT,
          handled_at TEXT,
          handled_by TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX idx_recharge_requests_provider ON recharge_requests(provider_id);
        CREATE INDEX idx_recharge_requests_status ON recharge_requests(status);
      `)},
};
