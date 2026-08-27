const { db, run, all, get } = require('../index');

module.exports = {
  name: "002_provider_ratings",
  up: ()=>{db.exec(`
        CREATE TABLE provider_ratings (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          provider_id INTEGER NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
          customer_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          order_id INTEGER REFERENCES orders(id) ON DELETE SET NULL,
          rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
          comment TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now')),
          UNIQUE (provider_id, customer_id)
        );
        CREATE INDEX idx_provider_ratings_provider ON provider_ratings(provider_id);
        CREATE INDEX idx_provider_ratings_customer ON provider_ratings(customer_id);
      `)},
};
