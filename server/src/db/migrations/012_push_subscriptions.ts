const { db, run, all, get } = require('../index');

module.exports = {
  name: "012_push_subscriptions",
  up: ()=>{db.exec(`
        CREATE TABLE push_subscriptions (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          endpoint TEXT NOT NULL UNIQUE,
          keys_json TEXT NOT NULL,
          user_agent TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          last_seen_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX idx_push_subscriptions_user ON push_subscriptions(user_id);
      `)},
};
