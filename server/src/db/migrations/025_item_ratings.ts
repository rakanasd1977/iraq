const { db, run, all, get } = require('../index');

module.exports = {
  name: "025_item_ratings",
  up: ()=>{db.exec(`
        CREATE TABLE IF NOT EXISTS item_ratings (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          item_type TEXT NOT NULL CHECK (item_type IN ('products','menu','packages','rooms','flights')),
          item_id INTEGER NOT NULL,
          provider_id INTEGER NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
          customer_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          order_id INTEGER REFERENCES orders(id) ON DELETE SET NULL,
          rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
          comment TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now')),
          UNIQUE (item_type, item_id, customer_id)
        );
        CREATE INDEX IF NOT EXISTS idx_item_ratings_item ON item_ratings(item_type, item_id);
        CREATE INDEX IF NOT EXISTS idx_item_ratings_provider ON item_ratings(provider_id);
        CREATE INDEX IF NOT EXISTS idx_item_ratings_customer ON item_ratings(customer_id);
        CREATE TABLE IF NOT EXISTS item_rating_sums (
          item_type TEXT NOT NULL,
          item_id INTEGER NOT NULL,
          rating REAL NOT NULL DEFAULT 0,
          rating_count INTEGER NOT NULL DEFAULT 0,
          PRIMARY KEY (item_type, item_id)
        );
      `)},
};
