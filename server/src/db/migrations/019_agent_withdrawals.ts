const { db, run, all, get } = require('../index');

module.exports = {
  name: "019_agent_withdrawals",
  up: ()=>{db.exec(`
        CREATE TABLE IF NOT EXISTS agent_withdrawals (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          agent_id INTEGER NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
          amount REAL NOT NULL CHECK(amount > 0),
          status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')),
          notes TEXT,
          decided_by INTEGER REFERENCES users(id),
          decided_at TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
      `);db.exec("CREATE INDEX IF NOT EXISTS idx_agent_withdrawals_agent ON agent_withdrawals(agent_id, status);");db.exec("CREATE INDEX IF NOT EXISTS idx_agent_withdrawals_status ON agent_withdrawals(status);")},
};
