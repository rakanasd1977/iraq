const { db, run, all, get } = require('../index');

module.exports = {
  name: "003_idempotency_keys",
  up: ()=>{db.exec(`
        CREATE TABLE idempotency_keys (
          key TEXT PRIMARY KEY,
          order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX idx_idempotency_keys_order ON idempotency_keys(order_id);
      `)},
};
