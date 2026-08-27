const { db, run, all, get } = require('../index');

module.exports = {
  name: "020_customer_favorites",
  up: ()=>{db.exec(`
        CREATE TABLE IF NOT EXISTS customer_favorites (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          customer_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          provider_id INTEGER NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          UNIQUE(customer_id, provider_id)
        );
      `);db.exec("CREATE INDEX IF NOT EXISTS idx_customer_favorites_customer ON customer_favorites(customer_id, id DESC);")},
};
