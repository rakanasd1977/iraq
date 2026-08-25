const { db, run, all, get } = require('../index');

module.exports = {
  name: "026_follows_and_item_favorites",
  up: ()=>{db.exec(`
        CREATE TABLE IF NOT EXISTS provider_follows (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          customer_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          provider_id INTEGER NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          UNIQUE (customer_id, provider_id)
        );
      `);db.exec("CREATE INDEX IF NOT EXISTS idx_provider_follows_customer ON provider_follows(customer_id, id DESC);");db.exec("CREATE INDEX IF NOT EXISTS idx_provider_follows_provider ON provider_follows(provider_id, id DESC);");db.exec(`
        CREATE TABLE IF NOT EXISTS item_favorites (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          customer_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          item_type TEXT NOT NULL CHECK (item_type IN ('products','menu','packages','rooms','flights')),
          item_id INTEGER NOT NULL,
          provider_id INTEGER NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          UNIQUE (customer_id, item_type, item_id)
        );
      `);db.exec("CREATE INDEX IF NOT EXISTS idx_item_favorites_customer ON item_favorites(customer_id, id DESC);");db.exec("CREATE INDEX IF NOT EXISTS idx_item_favorites_item ON item_favorites(item_type, item_id);")},
};
