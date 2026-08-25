"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const { db, run, all, get } = require('./index');
const MIGRATIONS = [
    {
        name: '001_init_schema',
        up: () => {
            db.exec(`
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
      `);
        },
    },
    {
        name: '002_provider_ratings',
        up: () => {
            db.exec(`
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
      `);
        },
    },
    {
        name: '003_idempotency_keys',
        up: () => {
            db.exec(`
        CREATE TABLE idempotency_keys (
          key TEXT PRIMARY KEY,
          order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX idx_idempotency_keys_order ON idempotency_keys(order_id);
      `);
        },
    },
    {
        name: '004_indexes',
        up: () => {
            db.exec(`
        CREATE INDEX IF NOT EXISTS idx_bookings_order ON bookings(order_id);
        CREATE INDEX IF NOT EXISTS idx_bookings_provider ON bookings(provider_id);
        CREATE INDEX IF NOT EXISTS idx_bookings_dates ON bookings(check_in, check_out);
        CREATE INDEX IF NOT EXISTS idx_orders_gov_status ON orders(governorate_id, status);
        CREATE INDEX IF NOT EXISTS idx_orders_created ON orders(created_at);
        CREATE INDEX IF NOT EXISTS idx_lease_payments_agent ON lease_payments(agent_id);
        CREATE INDEX IF NOT EXISTS idx_activity_log_user ON activity_log(user_id);
      `);
        },
    },
    {
        name: '005_indexes_and_retention',
        up: () => {
            db.exec(`
        CREATE INDEX IF NOT EXISTS idx_products_category ON products(category_id);
        CREATE INDEX IF NOT EXISTS idx_products_provider ON products(provider_id);
        CREATE INDEX IF NOT EXISTS idx_activity_log_created ON activity_log(created_at);
        INSERT OR IGNORE INTO settings (key, value, label, updated_at)
          VALUES ('activity_log_retention_days', '90', 'الاحتفاظ بسجلات النشاط (أيام)', datetime('now'));
      `);
        },
    },
    {
        name: '006_email_verification',
        up: () => {
            db.exec(`
        ALTER TABLE users ADD COLUMN is_verified INTEGER NOT NULL DEFAULT 1;
        CREATE TABLE user_verifications (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          token TEXT NOT NULL UNIQUE,
          expires_at TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX idx_user_verifications_user ON user_verifications(user_id);
      `);
        },
    },
    {
        name: '007_sessions',
        up: () => {
            db.exec(`
        CREATE TABLE sessions (
          id TEXT PRIMARY KEY,
          user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          expires_at TEXT NOT NULL,
          user_agent TEXT,
          ip TEXT
        );
        CREATE INDEX idx_sessions_user ON sessions(user_id);
        CREATE INDEX idx_sessions_expiry ON sessions(expires_at);
      `);
        },
    },
    {
        name: '008_lease_payments_updated_at',
        up: () => {
            db.exec("ALTER TABLE lease_payments ADD COLUMN updated_at TEXT;");
            db.exec("UPDATE lease_payments SET updated_at = created_at;");
        },
    },
    {
        name: '009_provider_wallets',
        up: () => {
            db.exec(`
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
      `);
            db.exec("ALTER TABLE orders ADD COLUMN accepted_at TEXT;");
            db.exec("ALTER TABLE orders ADD COLUMN reject_reason TEXT;");
        },
    },
    {
        name: '010_recharge_requests',
        up: () => {
            db.exec(`
        CREATE TABLE recharge_requests (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          provider_id INTEGER NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
          reference TEXT NOT NULL UNIQUE,
          amount REAL NOT NULL,
          payment_method TEXT NOT NULL,
          note TEXT,
          proof_image TEXT,
          status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
          admin_note TEXT,
          handled_at TEXT,
          handled_by TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX idx_recharge_requests_provider ON recharge_requests(provider_id);
        CREATE INDEX idx_recharge_requests_status ON recharge_requests(status);
      `);
        },
    },
    {
        name: '011_recharge_payment_settings',
        up: () => {
            db.exec(`
        INSERT OR IGNORE INTO settings (key, value, label, updated_at) VALUES
          ('recharge_instructions', 'أرسل مبلغ الشحن إلى أحد حسابات المنصة أدناه ثم ارفق لقطة شاشة لعملية الإرسال ضمن طلب الشحن، وبعد تدقيق المسؤول يُضاف الرصيد لمحفظتك.', 'تعليمات شحن الرصيد (تظهر للمزودين)', datetime('now')),
          ('zain_cash_number', '', 'رقم زين كاش لاستقبال الشحنات', datetime('now')),
          ('asia_pay_number', '', 'رقم آسيا باي لاستقبال الشحنات', datetime('now')),
          ('first_iraqi_bank_name', '', 'اسم المستفيد - مصرف العراق الأول', datetime('now')),
          ('first_iraqi_bank_iban', '', 'رقم الآيبان - مصرف العراق الأول', datetime('now')),
          ('al_ahli_bank_name', '', 'اسم المستفيد - المصرف الأهلي', datetime('now')),
          ('al_ahli_bank_iban', '', 'رقم الآيبان - المصرف الأهلي', datetime('now'));
      `);
        },
    },
    {
        name: '012_push_subscriptions',
        up: () => {
            db.exec(`
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
      `);
        },
    },
    {
        name: '013_promotions',
        up: () => {
            db.exec(`
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
          ('promo_price', '5000', 'سعر الترويج لكل فترة (دينار)'),
          ('promo_duration_days', '7', 'مدة الترويج بالأيام'),
          ('promo_max_active', '3', 'الحد الأقصى للترويجات النشطة لكل مزود');
      `);
            // SQLite لا يسمح بتعديل CHECK — نعيد بناء الجدول لإضافة نوع 'promotion'
            db.exec(`
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
      `);
        },
    },
    {
        name: '014_catalog_featured',
        up: () => {
            db.exec("ALTER TABLE hotel_rooms ADD COLUMN is_featured INTEGER NOT NULL DEFAULT 0;");
            db.exec("ALTER TABLE flights ADD COLUMN is_featured INTEGER NOT NULL DEFAULT 0;");
            db.exec("ALTER TABLE travel_packages ADD COLUMN is_featured INTEGER NOT NULL DEFAULT 0;");
        },
    },
    {
        name: '015_rating_replies',
        up: () => {
            db.exec("ALTER TABLE provider_ratings ADD COLUMN reply TEXT;");
            db.exec("ALTER TABLE provider_ratings ADD COLUMN replied_at TEXT;");
        },
    },
    {
        name: '016_provider_verification',
        up: () => {
            db.exec("ALTER TABLE providers ADD COLUMN national_id_image TEXT;");
            db.exec("ALTER TABLE providers ADD COLUMN residency_doc_image TEXT;");
            db.exec("ALTER TABLE providers ADD COLUMN verification_status TEXT NOT NULL DEFAULT 'none';");
            db.exec("ALTER TABLE providers ADD COLUMN verification_note TEXT;");
            db.exec("ALTER TABLE providers ADD COLUMN submitted_at TEXT;");
            db.exec("ALTER TABLE providers ADD COLUMN reviewed_at TEXT;");
            db.exec("UPDATE providers SET verification_status = CASE WHEN is_verified = 1 THEN 'approved' ELSE 'none' END;");
        },
    },
    {
        name: '017_in_app_notifications',
        up: () => {
            db.exec(`
        CREATE TABLE IF NOT EXISTS notifications (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          type TEXT NOT NULL DEFAULT 'order',
          title TEXT NOT NULL,
          body TEXT,
          url TEXT,
          icon TEXT,
          is_read INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
      `);
            db.exec('CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, is_read, id DESC);');
        },
    },
    {
        name: '019_agent_withdrawals',
        up: () => {
            db.exec(`
        CREATE TABLE IF NOT EXISTS agent_withdrawals (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          agent_id INTEGER NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
          amount REAL NOT NULL CHECK(amount > 0),
          status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')),
          notes TEXT,
          decided_by INTEGER REFERENCES users(id),
          decided_at TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
      `);
            db.exec('CREATE INDEX IF NOT EXISTS idx_agent_withdrawals_agent ON agent_withdrawals(agent_id, status);');
            db.exec('CREATE INDEX IF NOT EXISTS idx_agent_withdrawals_status ON agent_withdrawals(status);');
        },
    },
    {
        name: '018_convert_base64_uploads',
        // ترحيل: تحويل رموز base64 المخزنة سابقاً في أعمدة الصور إلى ملفات /uploads
        up: () => {
            const { convertBase64Value } = require('../utils/uploads');
            const convert = (v) => {
                try {
                    return convertBase64Value(v);
                }
                catch (e) {
                    console.warn(`[migrate 018] تخطي صورة تالفة (تُترك كما هي): ${e.message}`);
                    return v;
                }
            };
            const singleCols = [
                ['providers', 'logo'],
                ['providers', 'cover'],
                ['providers', 'national_id_image'],
                ['providers', 'residency_doc_image'],
                ['recharge_requests', 'proof_image'],
                ['users', 'avatar'],
                ['promotions', 'item_image'],
            ];
            for (const [table, col] of singleCols) {
                for (const row of all(`SELECT id, ${col} AS v FROM ${table} WHERE ${col} LIKE 'data:image/%'`)) {
                    const next = convert(row.v);
                    if (next !== row.v)
                        run(`UPDATE ${table} SET ${col} = ? WHERE id = ?`, [next, row.id]);
                }
            }
            for (const table of ['products', 'menu_items', 'hotel_rooms', 'travel_packages']) {
                for (const row of all(`SELECT id, images_json AS v FROM ${table} WHERE images_json LIKE '%data:image/%'`)) {
                    const next = convert(row.v);
                    if (next !== row.v)
                        run(`UPDATE ${table} SET images_json = ? WHERE id = ?`, [next, row.id]);
                }
            }
        },
    },
    {
        name: '020_customer_favorites',
        up: () => {
            db.exec(`
        CREATE TABLE IF NOT EXISTS customer_favorites (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          customer_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          provider_id INTEGER NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          UNIQUE(customer_id, provider_id)
        );
      `);
            db.exec('CREATE INDEX IF NOT EXISTS idx_customer_favorites_customer ON customer_favorites(customer_id, id DESC);');
        },
    },
    {
        name: '021_promotion_targets',
        up: () => {
            // استهداف الإعلان: محافظة واحدة/أكثر (target_type='governorate') أو كل المحافظات (target_type='all')
            // المحاسبة: تُخصم من محفظة المزود (wallet) أو إعلان مجاني من المنصة (free)
            db.exec(`
        ALTER TABLE promotions ADD COLUMN target_type TEXT NOT NULL DEFAULT 'governorate' CHECK (target_type IN ('governorate','all'));
        ALTER TABLE promotions ADD COLUMN target_governorate_ids TEXT;
        ALTER TABLE promotions ADD COLUMN billing TEXT NOT NULL DEFAULT 'wallet' CHECK (billing IN ('wallet','free'));
        UPDATE promotions SET target_governorate_ids = CAST(governorate_id AS TEXT) WHERE target_governorate_ids IS NULL;
        CREATE INDEX IF NOT EXISTS idx_promotions_target ON promotions(target_type, status, ends_at);
      `);
        },
    },
    {
        name: '022_coupons_and_addresses',
        up: () => {
            // عناوين الزبائن المحفوظة (دفتر العناوين)
            db.exec(`
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
      `);
            db.exec('CREATE INDEX IF NOT EXISTS idx_addresses_customer ON addresses(customer_id, id DESC);');
            // كوبونات الخصم (داخل السلة/عند إنشاء الطلب) — code فريد، نسبة أو مبلغ ثابت
            db.exec(`
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
      `);
            db.exec('CREATE INDEX IF NOT EXISTS idx_coupons_active ON coupons(is_active, ends_at);');
            db.exec('CREATE INDEX IF NOT EXISTS idx_coupon_usages_coupon ON coupon_usages(coupon_id);');
            db.exec('CREATE INDEX IF NOT EXISTS idx_coupon_usages_customer ON coupon_usages(customer_id, coupon_id);');
            // أعمدة الخصم على الطلب: subtotal قبل الخصم، الخصم، مرجع الكوبون
            db.exec(`
        ALTER TABLE orders ADD COLUMN subtotal_amount REAL NOT NULL DEFAULT 0;
        ALTER TABLE orders ADD COLUMN discount_amount REAL NOT NULL DEFAULT 0;
        ALTER TABLE orders ADD COLUMN coupon_id INTEGER REFERENCES coupons(id);
        ALTER TABLE orders ADD COLUMN coupon_code TEXT;
        UPDATE orders SET subtotal_amount = total_amount WHERE subtotal_amount = 0;
      `);
        },
    },
    {
        name: '023_catalog_images',
        up: () => {
            // صور حقيقية للكتالوج: الرحلات الجوية كانت بلا عمود صور — أضفناه لبقية الأصناف
            db.exec(`
        ALTER TABLE flights ADD COLUMN images_json TEXT;
        CREATE INDEX IF NOT EXISTS idx_catalog_images ON products(is_active, is_featured);
      `);
        },
    },
    {
        name: '024_security_hardening_auth',
        up: () => {
            // المصادقة الثنائية (TOTP) لحسابات الامتياز + بصمة الجهاز في الجلسات + سجل فشل الدخول
            db.exec(`
        ALTER TABLE users ADD COLUMN totp_secret TEXT;
        ALTER TABLE users ADD COLUMN totp_enabled INTEGER NOT NULL DEFAULT 0;
        ALTER TABLE sessions ADD COLUMN fingerprint TEXT;
        CREATE TABLE IF NOT EXISTS login_failures (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          identifier TEXT NOT NULL,
          ip TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_login_failures_identifier ON login_failures(identifier, created_at);
        CREATE INDEX IF NOT EXISTS idx_login_failures_ip ON login_failures(ip, created_at);
      `);
        },
    },
    {
        name: '025_item_ratings',
        up: () => {
            // تقييمات الزبائن للبنود (منتجات/أصناف/باقات/غرف/رحلات): عمومية عبر item_type + item_id
            // مع جدول مجاميع منزوعة التطبيع لقراءة سريعة في الكتالوج.
            db.exec(`
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
      `);
        },
    },
    {
        name: '026_follows_and_item_favorites',
        up: () => {
            // متابعة الزبائن لمزودي الخدمات (تُرسل إشعارات عند نشر منتج/عرض جديد)
            db.exec(`
        CREATE TABLE IF NOT EXISTS provider_follows (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          customer_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          provider_id INTEGER NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          UNIQUE (customer_id, provider_id)
        );
      `);
            db.exec('CREATE INDEX IF NOT EXISTS idx_provider_follows_customer ON provider_follows(customer_id, id DESC);');
            db.exec('CREATE INDEX IF NOT EXISTS idx_provider_follows_provider ON provider_follows(provider_id, id DESC);');
            // مفضلة البنود: منتجات/أصناف/باقات/غرف/رحلات (item_type + item_id عام)
            db.exec(`
        CREATE TABLE IF NOT EXISTS item_favorites (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          customer_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          item_type TEXT NOT NULL CHECK (item_type IN ('products','menu','packages','rooms','flights')),
          item_id INTEGER NOT NULL,
          provider_id INTEGER NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          UNIQUE (customer_id, item_type, item_id)
        );
      `);
            db.exec('CREATE INDEX IF NOT EXISTS idx_item_favorites_customer ON item_favorites(customer_id, id DESC);');
            db.exec('CREATE INDEX IF NOT EXISTS idx_item_favorites_item ON item_favorites(item_type, item_id);');
        },
    },
    {
        name: '027_homepage_services_and_coupons',
        up: () => {
            // خدمتا النواة الخمس + خمس خدمات إضافية لتكمل شبكة خدمات الرئيسية 10 أزرار (صفّان × 5).
            // INSERT OR IGNORE يضمن عدم التكرار على القواعد الموجودة مسبقاً.
            const ALL_SERVICES = [
                { slug: 'stores', ar: 'المتاجر', en: 'Stores', icon: '🛒', desc: 'متاجر متعددة لبيع المنتجات والبضائع', sort: 1 },
                { slug: 'restaurants', ar: 'المطاعم', en: 'Restaurants', icon: '🍽️', desc: 'مطاعم لطلب الوجبات والطعام', sort: 2 },
                { slug: 'hotels', ar: 'الفنادق', en: 'Hotels', icon: '🏨', desc: 'فنادق لحجز الغرف والإقامة', sort: 3 },
                { slug: 'flights', ar: 'حجز الطيران', en: 'Flights', icon: '✈️', desc: 'حجز تذاكر الطيران المحلي والدولي', sort: 4 },
                { slug: 'travel_offices', ar: 'مكاتب السفر', en: 'Travel Offices', icon: '🧳', desc: 'مكاتب سفر للرحلات والباقات السياحية', sort: 5 },
                { slug: 'pharmacies', ar: 'مواد انشائية', en: 'Construction Materials', icon: '🧱', desc: 'مواد بناء وإنشاءات', sort: 6 },
                { slug: 'electronics', ar: 'الإلكترونيات', en: 'Electronics', icon: '📱', desc: 'هواتف وأجهزة إلكترونية وإكسسوارات', sort: 7 },
                { slug: 'fashion', ar: 'الأزياء', en: 'Fashion', icon: '👗', desc: 'ملابس وأزياء وعطور', sort: 8 },
                { slug: 'grocery', ar: 'البقالة', en: 'Grocery', icon: '🥬', desc: 'مواد غذائية واستهلاكية', sort: 9 },
                { slug: 'home_services', ar: 'مواد منزلية', en: 'Home Materials', icon: '🧺', desc: 'مواد وأدوات منزلية', sort: 10 },
            ];
            const ins = (s) => run('INSERT OR IGNORE INTO services (slug, name_ar, name_en, icon, description, sort_order) VALUES (?,?,?,?,?,?)', [s.slug, s.ar, s.en, s.icon, s.desc, s.sort]);
            ALL_SERVICES.forEach(ins);
            // كوبونات تجريبية نشطة تظهر في "كوبونات وعروض" بصفحة الرئيسية.
            // التواريخ بنفس صيغة datetime('now') في SQLite (مسافة، بلا T/Z) حتى تُقارن نصياً بشكل صحيح.
            const fmt = (d) => d.toISOString().replace('T', ' ').replace(/\.\d+Z$/, '');
            const now = fmt(new Date());
            const ends = fmt(new Date(Date.now() + 90 * 86400000));
            const COUPONS = [
                { code: 'RAFIDAIN10', title: 'خصم 10% على أول طلب', type: 'percent', value: 10, min: 10000 },
                { code: 'SAVE20', title: 'خصم 20% على الطلبات الكبيرة', type: 'percent', value: 20, min: 50000 },
                { code: 'BIG50', title: 'خصم 50% لفترة محدودة', type: 'percent', value: 50, min: 100000 },
                { code: 'FIX5K', title: 'خصم 5000 د.ع على أي طلب', type: 'fixed', value: 5000, min: 30000 },
            ];
            COUPONS.forEach((c) => run('INSERT OR IGNORE INTO coupons (code, title, discount_type, discount_value, min_amount, starts_at, ends_at, max_uses, per_customer_limit, is_active) VALUES (?,?,?,?,?,?,?,0,1,1)', [c.code, c.title, c.type, c.value, c.min, null, ends]));
        },
    },
    {
        name: '028_sold_counters_demo',
        up: () => {
            seedSoldCountersDemo();
        },
    },
    {
        name: '029_free_shipping_setting',
        up: () => {
            // عتبة الشحن المجاني فوق مبلغ معيّن (تُعرض كشريط تقدم في السلة بأسلوب علي إكسبريس).
            const exists = get('SELECT key FROM settings WHERE key = ?', ['free_shipping_min']);
            if (!exists) {
                run('INSERT INTO settings (key, value, label) VALUES (?,?,?)', ['free_shipping_min', '50000', 'الحد الأدنى للشحن المجاني (دينار)']);
            }
        },
    },
    {
        name: '030_rename_home_pharmacy_services',
        up: () => {
            // إعادة تسمية خدمتي "الخدمات المنزلية" و"الصيدليات" إلى تسميات السلع الجديدة.
            run("UPDATE services SET name_ar = 'مواد منزلية', name_en = 'Home Materials', icon = '🧺', description = 'مواد وأدوات منزلية' WHERE slug = 'home_services'");
            run("UPDATE services SET name_ar = 'مواد انشائية', name_en = 'Construction Materials', icon = '🧱', description = 'مواد بناء وإنشاءات' WHERE slug = 'pharmacies'");
        },
    },
    {
        name: '031_provider_coupon_limits',
        up: () => {
            // سقوف كوبونات الخصم التي ينشرها مزود الخدمة نفسه (تُقيد في مسار /provider/coupons).
            const seed = (key, value, label) => {
                const exists = get('SELECT key FROM settings WHERE key = ?', [key]);
                if (!exists)
                    run('INSERT INTO settings (key, value, label) VALUES (?,?,?)', [key, value, label]);
            };
            seed('provider_coupon_max_percent', '50', 'الحد الأقصى لنسبة خصم كوبونات المزودين (%)');
            seed('provider_coupon_max_fixed', '100000', 'الحد الأقصى لخصم الكوبون الثابت للمزودين (دينار)');
        },
    },
    {
        name: '032_provider_only_coupons',
        up: () => {
            // كوبونات الخصم أصبحت حصرية للمزوّدين: تُوقف الكوبونات العامة التي نشرتها المنصة سابقاً.
            run('UPDATE coupons SET is_active = 0, updated_at = datetime(\'now\') WHERE provider_id IS NULL');
        },
    },
    {
        name: '033_loyalty_and_referral',
        up: () => {
            // برنامج الولاء والنقاط + الإحالة بين الزبائن.
            const ucols = all('PRAGMA table_info(users)').map((c) => c.name);
            if (!ucols.includes('points_balance'))
                run('ALTER TABLE users ADD COLUMN points_balance INTEGER NOT NULL DEFAULT 0');
            if (!ucols.includes('points_total'))
                run('ALTER TABLE users ADD COLUMN points_total INTEGER NOT NULL DEFAULT 0');
            if (!ucols.includes('referral_code'))
                run('ALTER TABLE users ADD COLUMN referral_code TEXT');
            if (!ucols.includes('referred_by'))
                run('ALTER TABLE users ADD COLUMN referred_by INTEGER REFERENCES users(id)');
            run(`CREATE TABLE IF NOT EXISTS loyalty_points (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        type TEXT NOT NULL DEFAULT 'earn',
        points INTEGER NOT NULL,
        description TEXT,
        order_id INTEGER REFERENCES orders(id) ON DELETE SET NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )`);
            run('CREATE INDEX IF NOT EXISTS idx_loyalty_user ON loyalty_points(user_id, id)');
            const ocols = all('PRAGMA table_info(orders)').map((c) => c.name);
            if (!ocols.includes('points_discount_amount'))
                run('ALTER TABLE orders ADD COLUMN points_discount_amount REAL NOT NULL DEFAULT 0');
            if (!ocols.includes('redeemed_points'))
                run('ALTER TABLE orders ADD COLUMN redeemed_points INTEGER NOT NULL DEFAULT 0');
            const customers = all("SELECT id FROM users WHERE role = 'customer' AND referral_code IS NULL");
            for (const u of customers) {
                const code = 'RAF' + (100000 + u.id).toString(36).toUpperCase();
                run('UPDATE users SET referral_code = ? WHERE id = ?', [code, u.id]);
            }
            run('CREATE UNIQUE INDEX IF NOT EXISTS idx_users_referral_code ON users(referral_code) WHERE referral_code IS NOT NULL');
            const seed = (key, value, label) => {
                const exists = get('SELECT key FROM settings WHERE key = ?', [key]);
                if (!exists)
                    run('INSERT INTO settings (key, value, label) VALUES (?,?,?)', [key, value, label]);
            };
            seed('loyalty_earn_per_1000', '10', 'نقاط الولاء المكتسبة لكل 1000 دينار من قيمة الطلب');
            seed('loyalty_point_value', '1', 'قيمة النقطة الواحدة عند استبدالها بالخصم (دينار)');
            seed('loyalty_min_redeem', '100', 'الحد الأدنى للنقاط القابلة للاستبدال');
            seed('referral_bonus_referrer', '1000', 'مكافأة مَن دعا صديقاً (نقطة ولاء)');
            seed('referral_bonus_referee', '3000', 'مكافأة الصديق المدعو بعد أول طلب (نقطة ولاء)');
            seed('referral_min_order', '10000', 'الحد الأدنى لقيمة أول طلب للمدعو لتفعيل مكافأة الإحالة');
        },
    },
    {
        name: '034_admin_rbac',
        up: () => {
            // نظام الصلاحيات الدقيقة للمسؤولين
            db.exec(`
        CREATE TABLE IF NOT EXISTS admin_roles (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL UNIQUE,
          name_ar TEXT NOT NULL,
          description TEXT,
          is_system INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
      `);
            db.exec(`
        CREATE TABLE IF NOT EXISTS admin_role_permissions (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          role_id INTEGER NOT NULL REFERENCES admin_roles(id) ON DELETE CASCADE,
          resource TEXT NOT NULL,
          action TEXT NOT NULL,
          UNIQUE(role_id, resource, action)
        );
      `);
            db.exec(`
        CREATE TABLE IF NOT EXISTS admin_user_roles (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          role_id INTEGER NOT NULL REFERENCES admin_roles(id) ON DELETE CASCADE,
          assigned_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
          assigned_at TEXT NOT NULL DEFAULT (datetime('now')),
          UNIQUE(user_id, role_id)
        );
      `);
            // أدوار افتراضية
            const superAdmin = run(`INSERT OR IGNORE INTO admin_roles (name, name_ar, description, is_system) VALUES (?,?,?,1)`, ['super_admin', 'مسؤول أعلى', 'صلاحية كاملة على جميع الموارد',]);
            const adminRole = run(`INSERT OR IGNORE INTO admin_roles (name, name_ar, description, is_system) VALUES (?,?,?,1)`, ['admin', 'مسؤول', 'إدارة العمليات الأساسية',]);
            const managerRole = run(`INSERT OR IGNORE INTO admin_roles (name, name_ar, description, is_system) VALUES (?,?,?,1)`, ['manager', 'مدير عمليات', 'عرض وتعديل الطلبات والمزودين',]);
            const viewerRole = run(`INSERT OR IGNORE INTO admin_roles (name, name_ar, description, is_system) VALUES (?,?,?,1)`, ['viewer', 'مشاهد', 'عرض فقط بدون تعديل',]);
            // صلاحيات شاملة للمسؤول الأعلى
            const resources = ['agents', 'providers', 'orders', 'coupons', 'promotions', 'customers', 'settings', 'financial_reports', 'withdrawals', 'leases', 'activity_log', 'system', 'users', 'roles'];
            const actions = ['view', 'create', 'edit', 'delete', 'export'];
            if (superAdmin.lastId) {
                for (const resource of resources) {
                    for (const action of actions) {
                        run(`INSERT OR IGNORE INTO admin_role_permissions (role_id, resource, action) VALUES (?,?,?)`, [superAdmin.lastId, resource, action]);
                    }
                }
            }
            // صلاحيات للمسؤول العادي (بدون system/users/roles)
            if (adminRole.lastId) {
                const adminResources = ['agents', 'providers', 'orders', 'coupons', 'promotions', 'customers', 'settings', 'financial_reports', 'withdrawals', 'leases', 'activity_log'];
                for (const resource of adminResources) {
                    for (const action of actions) {
                        run(`INSERT OR IGNORE INTO admin_role_permissions (role_id, resource, action) VALUES (?,?,?)`, [adminRole.lastId, resource, action]);
                    }
                }
            }
            // صلاحيات للمدير (عرض وتعديل فقط)
            if (managerRole.lastId) {
                const managerResources = ['agents', 'providers', 'orders', 'coupons', 'promotions', 'customers', 'financial_reports', 'withdrawals', 'leases'];
                for (const resource of managerResources) {
                    for (const action of ['view', 'edit', 'export']) {
                        run(`INSERT OR IGNORE INTO admin_role_permissions (role_id, resource, action) VALUES (?,?,?)`, [managerRole.lastId, resource, action]);
                    }
                }
            }
            // صلاحيات للمشاهد (عرض فقط)
            if (viewerRole.lastId) {
                const viewerResources = ['agents', 'providers', 'orders', 'coupons', 'promotions', 'customers', 'financial_reports', 'withdrawals', 'leases', 'activity_log'];
                for (const resource of viewerResources) {
                    run(`INSERT OR IGNORE INTO admin_role_permissions (role_id, resource, action) VALUES (?,?,?)`, [viewerRole.lastId, resource, 'view']);
                }
            }
        },
    },
    {
        name: '035_audit_log_enhancements',
        up: () => {
            // إضافة عمود IP لتتبع أفضل
            const acols = all('PRAGMA table_info(activity_log)').map((c) => c.name);
            if (!acols.includes('ip_address'))
                run('ALTER TABLE activity_log ADD COLUMN ip_address TEXT');
            if (!acols.includes('user_agent'))
                run('ALTER TABLE activity_log ADD COLUMN user_agent TEXT');
            // فهرس لتسريع البحث
            run('CREATE INDEX IF NOT EXISTS idx_activity_log_user_id ON activity_log(user_id)');
            run('CREATE INDEX IF NOT EXISTS idx_activity_log_entity ON activity_log(entity_type, entity_id)');
            run('CREATE INDEX IF NOT EXISTS idx_activity_log_created ON activity_log(created_at)');
        },
    },
];
function seedSoldCountersDemo() {
    // طلبات مكتملة تجريبية تملأ عدّاد "باع X / طلب X" على بطاقات البنود بأرقام واقعية.
    // بلا customer_id حتى لا تظهر في طلبات أي زبون؛ تُحسب كمبيعات للبند من items_json.
    // تُتخطى إذا وُجدت طلبات تجريبية سابقة (لتظل قابلة للاستدعاء بعد بذر الكتالوج دون تكرار).
    const existing = get("SELECT COUNT(*) AS c FROM orders WHERE order_number LIKE 'DEMO-%'");
    if (existing && existing.c > 0)
        return;
    const round2 = (n) => Math.round(n * 100) / 100;
    const items = all(`
    SELECT 'products' AS kind, id AS item_id, provider_id, name_ar AS title,
           CASE WHEN old_price IS NOT NULL AND old_price > price THEN old_price ELSE price END AS paid
    FROM products WHERE is_active = 1
    UNION ALL
    SELECT 'menu', id, provider_id, name_ar, price FROM menu_items WHERE is_active = 1 AND is_available = 1
    UNION ALL
    SELECT 'packages', id, provider_id, name_ar, price FROM travel_packages WHERE is_active = 1
    UNION ALL
    SELECT 'rooms', id, provider_id, name_ar, price_per_night FROM hotel_rooms WHERE is_active = 1
    UNION ALL
    SELECT 'flights', id, provider_id, flight_number, price FROM flights WHERE is_active = 1
  `);
    let n = 0;
    for (const it of items) {
        const prov = get('SELECT service_id, governorate_id FROM providers WHERE id = ?', [it.provider_id]);
        if (!prov || !prov.service_id)
            continue;
        const qty = 1 + (it.item_id % 4);
        const total = round2(Number(it.paid) * qty);
        const rounds = 3 + ((it.item_id * 7) % 28);
        for (let i = 0; i < rounds; i++) {
            const num = String(100000 + n);
            run(`INSERT INTO orders (order_number, provider_id, service_id, governorate_id, status, customer_name, items_json, total_amount, subtotal_amount, discount_amount, commission_amount, platform_amount, agent_amount, provider_amount, status_history_json)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [
                `DEMO-${num.slice(1)}`, it.provider_id, prov.service_id, prov.governorate_id, 'completed', 'عميل تجريبي',
                JSON.stringify([{ kind: it.kind, item_id: it.item_id, title: it.title, quantity: qty, unit_price: Number(it.paid), total }]),
                total, total, 0, 0, 0, 0, total, JSON.stringify([{ status: 'completed', at: new Date().toISOString() }]),
            ]);
            n++;
        }
    }
    console.log(`[migrate] seeded ${n} completed demo orders`);
}
function migrate() {
    db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    applied_at TEXT NOT NULL DEFAULT (datetime('now'))
  );`);
    const applied = new Set(all('SELECT name FROM schema_migrations').map((r) => r.name));
    for (const m of MIGRATIONS) {
        if (applied.has(m.name))
            continue;
        db.exec('BEGIN');
        try {
            m.up();
            run('INSERT INTO schema_migrations (name) VALUES (?)', [m.name]);
            db.exec('COMMIT');
            console.log(`[migrate] applied: ${m.name}`);
        }
        catch (e) {
            db.exec('ROLLBACK');
            throw e;
        }
    }
}
module.exports = { migrate, MIGRATIONS, seedSoldCountersDemo };
if (require.main === module) {
    migrate();
    console.log('[migrate] done');
}
