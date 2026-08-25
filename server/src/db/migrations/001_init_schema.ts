const { db, run, all, get } = require('../index');

module.exports = {
  name: "001_init_schema",
  up: ()=>{db.exec(`
        CREATE TABLE users (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          role TEXT NOT NULL CHECK (role IN ('admin','agent','provider','customer')),
          name_ar TEXT NOT NULL,
          name_en TEXT,
          email TEXT UNIQUE,
          phone TEXT UNIQUE,
          password_hash TEXT NOT NULL,
          governorate_id INTEGER REFERENCES governorates(id),
          service_type TEXT,
          is_active INTEGER NOT NULL DEFAULT 1,
          avatar TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE governorates (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name_ar TEXT NOT NULL,
          name_en TEXT NOT NULL,
          code TEXT UNIQUE NOT NULL,
          is_active INTEGER NOT NULL DEFAULT 1,
          lease_fee REAL NOT NULL DEFAULT 0,
          sort_order INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE agents (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
          governorate_id INTEGER NOT NULL UNIQUE REFERENCES governorates(id),
          commission_rate REAL NOT NULL DEFAULT 2,
          lease_status TEXT NOT NULL DEFAULT 'pending' CHECK (lease_status IN ('active','expired','pending')),
          lease_expires_at TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE services (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          slug TEXT UNIQUE NOT NULL,
          name_ar TEXT NOT NULL,
          name_en TEXT NOT NULL,
          description TEXT,
          icon TEXT,
          is_active INTEGER NOT NULL DEFAULT 1,
          sort_order INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE providers (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
          governorate_id INTEGER NOT NULL REFERENCES governorates(id),
          service_id INTEGER NOT NULL REFERENCES services(id),
          name_ar TEXT NOT NULL,
          name_en TEXT,
          logo TEXT,
          cover TEXT,
          description TEXT,
          address TEXT,
          phone TEXT,
          website TEXT,
          commission_rate REAL NOT NULL DEFAULT 5,
          is_active INTEGER NOT NULL DEFAULT 1,
          is_featured INTEGER NOT NULL DEFAULT 0,
          is_verified INTEGER NOT NULL DEFAULT 0,
          rating REAL NOT NULL DEFAULT 0,
          rating_count INTEGER NOT NULL DEFAULT 0,
          verified_at TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE customers (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
          governorate_id INTEGER REFERENCES governorates(id),
          address TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE orders (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          order_number TEXT UNIQUE NOT NULL,
          customer_id INTEGER REFERENCES users(id),
          provider_id INTEGER NOT NULL REFERENCES providers(id),
          service_id INTEGER NOT NULL REFERENCES services(id),
          governorate_id INTEGER REFERENCES governorates(id),
          status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','confirmed','in_progress','completed','cancelled')),
          customer_name TEXT,
          customer_phone TEXT,
          customer_address TEXT,
          notes TEXT,
          items_json TEXT,
          total_amount REAL NOT NULL DEFAULT 0,
          commission_amount REAL NOT NULL DEFAULT 0,
          platform_amount REAL NOT NULL DEFAULT 0,
          agent_amount REAL NOT NULL DEFAULT 0,
          provider_amount REAL NOT NULL DEFAULT 0,
          status_history_json TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX idx_orders_provider ON orders(provider_id);
        CREATE INDEX idx_orders_customer ON orders(customer_id);
        CREATE INDEX idx_orders_gov ON orders(governorate_id);
        CREATE INDEX idx_orders_status ON orders(status);
        CREATE INDEX idx_orders_created_at ON orders(created_at);
        CREATE INDEX idx_orders_created_at_status ON orders(created_at, status);

        CREATE TABLE lease_payments (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          agent_id INTEGER NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
          governorate_id INTEGER NOT NULL REFERENCES governorates(id),
          amount REAL NOT NULL,
          period_start TEXT NOT NULL,
          period_end TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','paid','rejected','refunded')),
          paid_at TEXT,
          notes TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE activity_log (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER,
          actor_role TEXT,
          action TEXT NOT NULL,
          entity_type TEXT,
          entity_id INTEGER,
          details TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX idx_activity_log_user_id ON activity_log(user_id);
        CREATE INDEX idx_activity_log_created ON activity_log(created_at);

        CREATE TABLE settings (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL,
          label TEXT,
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE product_categories (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          provider_id INTEGER NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
          name_ar TEXT NOT NULL,
          name_en TEXT,
          icon TEXT,
          is_active INTEGER NOT NULL DEFAULT 1,
          sort_order INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE products (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          provider_id INTEGER NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
          category_id INTEGER REFERENCES product_categories(id) ON DELETE SET NULL,
          name_ar TEXT NOT NULL,
          name_en TEXT,
          description TEXT,
          price REAL NOT NULL DEFAULT 0,
          old_price REAL,
          images_json TEXT,
          stock INTEGER NOT NULL DEFAULT 0,
          is_active INTEGER NOT NULL DEFAULT 1,
          is_featured INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE menu_categories (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          provider_id INTEGER NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
          name_ar TEXT NOT NULL,
          name_en TEXT,
          icon TEXT,
          is_active INTEGER NOT NULL DEFAULT 1,
          sort_order INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE menu_items (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          provider_id INTEGER NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
          category_id INTEGER REFERENCES menu_categories(id) ON DELETE SET NULL,
          name_ar TEXT NOT NULL,
          name_en TEXT,
          description TEXT,
          price REAL NOT NULL DEFAULT 0,
          images_json TEXT,
          is_active INTEGER NOT NULL DEFAULT 1,
          is_featured INTEGER NOT NULL DEFAULT 0,
          is_available INTEGER NOT NULL DEFAULT 1,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE hotel_rooms (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          provider_id INTEGER NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
          name_ar TEXT NOT NULL,
          name_en TEXT,
          description TEXT,
          price_per_night REAL NOT NULL DEFAULT 0,
          room_type TEXT NOT NULL DEFAULT 'standard',
          max_guests INTEGER NOT NULL DEFAULT 2,
          images_json TEXT,
          is_active INTEGER NOT NULL DEFAULT 1,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE flights (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          provider_id INTEGER NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
          flight_number TEXT,
          origin TEXT,
          origin_ar TEXT,
          destination TEXT,
          destination_ar TEXT,
          departure_at TEXT,
          arrival_at TEXT,
          price REAL NOT NULL DEFAULT 0,
          seats INTEGER NOT NULL DEFAULT 0,
          airline TEXT,
          is_active INTEGER NOT NULL DEFAULT 1,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE travel_packages (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          provider_id INTEGER NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
          name_ar TEXT NOT NULL,
          name_en TEXT,
          description TEXT,
          destination TEXT,
          duration_days INTEGER NOT NULL DEFAULT 1,
          price REAL NOT NULL DEFAULT 0,
          includes_json TEXT,
          images_json TEXT,
          is_active INTEGER NOT NULL DEFAULT 1,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE bookings (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
          provider_id INTEGER NOT NULL REFERENCES providers(id),
          booking_type TEXT NOT NULL,
          details_json TEXT,
          booking_date TEXT,
          check_in TEXT,
          check_out TEXT,
          guests INTEGER NOT NULL DEFAULT 1,
          status TEXT NOT NULL DEFAULT 'pending',
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
      `)},
};
