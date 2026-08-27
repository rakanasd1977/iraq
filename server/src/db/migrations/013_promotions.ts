const { db, run, all, get } = require('../index');

module.exports = {
  name: "013_promotions",
  up: ()=>{db.exec(`
        CREATE TABLE promotions (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          provider_id INTEGER NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
          service_id INTEGER NOT NULL REFERENCES services(id),
          item_type TEXT NOT NULL,
          item_id INTEGER NOT NULL,
          item_title TEXT NOT NULL,
          item_price REAL NOT NULL DEFAULT 0,
          item_image TEXT,
          item_link TEXT,
          governorate_id INTEGER NOT NULL REFERENCES governorates(id),
          cost REAL NOT NULL DEFAULT 0,
          status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','ended')),
          starts_at TEXT NOT NULL DEFAULT (datetime('now')),
          ends_at TEXT,
          impressions INTEGER NOT NULL DEFAULT 0,
          clicks INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX idx_promotions_gov ON promotions(governorate_id, status, ends_at);
        CREATE INDEX idx_promotions_provider ON promotions(provider_id, status);

        INSERT OR IGNORE INTO settings (key, value, label) VALUES
          ('promo_price', '5000', '\u0633\u0639\u0631 \u0627\u0644\u062A\u0631\u0648\u064A\u062C \u0644\u0643\u0644 \u0641\u062A\u0631\u0629 (\u062F\u064A\u0646\u0627\u0631)'),
          ('promo_duration_days', '7', '\u0645\u062F\u0629 \u0627\u0644\u062A\u0631\u0648\u064A\u062C \u0628\u0627\u0644\u0623\u064A\u0627\u0645'),
          ('promo_max_active', '3', '\u0627\u0644\u062D\u062F \u0627\u0644\u0623\u0642\u0635\u0649 \u0644\u0644\u062A\u0631\u0648\u064A\u062C\u0627\u062A \u0627\u0644\u0646\u0634\u0637\u0629 \u0644\u0643\u0644 \u0645\u0632\u0648\u062F');
      `);db.exec(`
        ALTER TABLE wallet_transactions RENAME TO wallet_transactions_old;
        DROP INDEX IF EXISTS idx_wallet_tx_provider;
        DROP INDEX IF EXISTS idx_wallet_tx_order;
        CREATE TABLE wallet_transactions (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          provider_id INTEGER NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
          type TEXT NOT NULL CHECK (type IN ('recharge','commission','refund','promotion')),
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
        INSERT INTO wallet_transactions SELECT * FROM wallet_transactions_old;
        DROP TABLE wallet_transactions_old;
      `)},
};
