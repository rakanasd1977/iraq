const { db, run, all, get } = require('../index');

module.exports = {
  name: "022_coupons_and_addresses",
  up: ()=>{db.exec(`
        CREATE TABLE IF NOT EXISTS addresses (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          customer_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          label TEXT,
          name_ar TEXT,
          phone TEXT,
          governorate_id INTEGER REFERENCES governorates(id),
          address TEXT NOT NULL,
          is_default INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
      `);db.exec("CREATE INDEX IF NOT EXISTS idx_addresses_customer ON addresses(customer_id, id DESC);");db.exec(`
        CREATE TABLE IF NOT EXISTS coupons (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          code TEXT UNIQUE NOT NULL,
          title TEXT,
          discount_type TEXT NOT NULL DEFAULT 'percent' CHECK (discount_type IN ('percent','fixed')),
          discount_value REAL NOT NULL DEFAULT 0,
          min_amount REAL NOT NULL DEFAULT 0,
          provider_id INTEGER REFERENCES providers(id) ON DELETE CASCADE,
          starts_at TEXT,
          ends_at TEXT,
          max_uses INTEGER NOT NULL DEFAULT 0,
          per_customer_limit INTEGER NOT NULL DEFAULT 1,
          is_active INTEGER NOT NULL DEFAULT 1,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE TABLE IF NOT EXISTS coupon_usages (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          coupon_id INTEGER NOT NULL REFERENCES coupons(id) ON DELETE CASCADE,
          customer_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
          discount_amount REAL NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          UNIQUE(coupon_id, order_id)
        );
      `);db.exec("CREATE INDEX IF NOT EXISTS idx_coupons_active ON coupons(is_active, ends_at);");db.exec("CREATE INDEX IF NOT EXISTS idx_coupon_usages_coupon ON coupon_usages(coupon_id);");db.exec("CREATE INDEX IF NOT EXISTS idx_coupon_usages_customer ON coupon_usages(customer_id, coupon_id);");db.exec(`
        ALTER TABLE orders ADD COLUMN subtotal_amount REAL NOT NULL DEFAULT 0;
        ALTER TABLE orders ADD COLUMN discount_amount REAL NOT NULL DEFAULT 0;
        ALTER TABLE orders ADD COLUMN coupon_id INTEGER REFERENCES coupons(id);
        ALTER TABLE orders ADD COLUMN coupon_code TEXT;
        UPDATE orders SET subtotal_amount = total_amount WHERE subtotal_amount = 0;
      `)},
};
