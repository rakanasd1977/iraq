const { db, run, all, get } = require('../index');

module.exports = {
  name: "009_provider_wallets",
  up: ()=>{db.exec(`
        CREATE TABLE provider_wallets (
          provider_id INTEGER PRIMARY KEY REFERENCES providers(id) ON DELETE CASCADE,
          balance REAL NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE TABLE wallet_transactions (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          provider_id INTEGER NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
          type TEXT NOT NULL CHECK (type IN ('recharge','commission','refund')),
          amount REAL NOT NULL,
          agent_amount REAL NOT NULL DEFAULT 0,
          platform_amount REAL NOT NULL DEFAULT 0,
          balance_after REAL NOT NULL,
          order_id INTEGER REFERENCES orders(id) ON DELETE SET NULL,
          order_number TEXT,
          note TEXT,
          created_by TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX idx_wallet_tx_provider ON wallet_transactions(provider_id);
        CREATE INDEX idx_wallet_tx_order ON wallet_transactions(order_id);
        INSERT OR IGNORE INTO provider_wallets (provider_id, balance) SELECT id, 0 FROM providers;
        CREATE INDEX idx_wallet_tx_created ON wallet_transactions(created_at);
      `);db.exec("ALTER TABLE orders ADD COLUMN accepted_at TEXT;");db.exec("ALTER TABLE orders ADD COLUMN reject_reason TEXT;")},
};
