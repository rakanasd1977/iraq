const { db, run, all, get } = require('./index');
const { round2 } = require('../utils/helpers');

const m_001_init_schema = require('./migrations/001_init_schema');
const m_002_provider_ratings = require('./migrations/002_provider_ratings');
const m_003_idempotency_keys = require('./migrations/003_idempotency_keys');
const m_004_indexes = require('./migrations/004_indexes');
const m_005_indexes_and_retention = require('./migrations/005_indexes_and_retention');
const m_006_email_verification = require('./migrations/006_email_verification');
const m_007_sessions = require('./migrations/007_sessions');
const m_008_lease_payments_updated_at = require('./migrations/008_lease_payments_updated_at');
const m_009_provider_wallets = require('./migrations/009_provider_wallets');
const m_010_recharge_requests = require('./migrations/010_recharge_requests');
const m_011_recharge_payment_settings = require('./migrations/011_recharge_payment_settings');
const m_012_push_subscriptions = require('./migrations/012_push_subscriptions');
const m_013_promotions = require('./migrations/013_promotions');
const m_014_catalog_featured = require('./migrations/014_catalog_featured');
const m_015_rating_replies = require('./migrations/015_rating_replies');
const m_016_provider_verification = require('./migrations/016_provider_verification');
const m_017_in_app_notifications = require('./migrations/017_in_app_notifications');
const m_019_agent_withdrawals = require('./migrations/019_agent_withdrawals');
const m_018_convert_base64_uploads = require('./migrations/018_convert_base64_uploads');
const m_020_customer_favorites = require('./migrations/020_customer_favorites');
const m_021_promotion_targets = require('./migrations/021_promotion_targets');
const m_022_coupons_and_addresses = require('./migrations/022_coupons_and_addresses');
const m_023_catalog_images = require('./migrations/023_catalog_images');
const m_024_security_hardening_auth = require('./migrations/024_security_hardening_auth');
const m_025_item_ratings = require('./migrations/025_item_ratings');
const m_026_follows_and_item_favorites = require('./migrations/026_follows_and_item_favorites');
const m_027_homepage_services_and_coupons = require('./migrations/027_homepage_services_and_coupons');
const m_028_sold_counters_demo = require('./migrations/028_sold_counters_demo');
const m_029_free_shipping_setting = require('./migrations/029_free_shipping_setting');
const m_030_rename_home_pharmacy_services = require('./migrations/030_rename_home_pharmacy_services');
const m_031_provider_coupon_limits = require('./migrations/031_provider_coupon_limits');
const m_032_provider_only_coupons = require('./migrations/032_provider_only_coupons');
const m_033_loyalty_and_referral = require('./migrations/033_loyalty_and_referral');
const m_034_admin_rbac = require('./migrations/034_admin_rbac');
const m_035_audit_log_enhancements = require('./migrations/035_audit_log_enhancements');
const m_036_add_missing_created_at_indexes = require('./migrations/036_add_missing_created_at_indexes');
const m_037_rbac_resource_catalog = require('./migrations/037_rbac_resource_catalog');
const m_038_service_commission = require('./migrations/038_service_commission');
const m_039_governorate_coords = require('./migrations/039_governorate_coords');
const m_040_districts = require('./migrations/040_districts');
const m_041_rbac_districts = require('./migrations/041_rbac_districts');
const m_042_restore_agent_withdrawals_created_idx = require('./migrations/042_restore_agent_withdrawals_created_idx');

const MIGRATIONS = [
  m_001_init_schema,
  m_002_provider_ratings,
  m_003_idempotency_keys,
  m_004_indexes,
  m_005_indexes_and_retention,
  m_006_email_verification,
  m_007_sessions,
  m_008_lease_payments_updated_at,
  m_009_provider_wallets,
  m_010_recharge_requests,
  m_011_recharge_payment_settings,
  m_012_push_subscriptions,
  m_013_promotions,
  m_014_catalog_featured,
  m_015_rating_replies,
  m_016_provider_verification,
  m_017_in_app_notifications,
  m_018_convert_base64_uploads,
  m_019_agent_withdrawals,
  m_020_customer_favorites,
  m_021_promotion_targets,
  m_022_coupons_and_addresses,
  m_023_catalog_images,
  m_024_security_hardening_auth,
  m_025_item_ratings,
  m_026_follows_and_item_favorites,
  m_027_homepage_services_and_coupons,
  m_028_sold_counters_demo,
  m_029_free_shipping_setting,
  m_030_rename_home_pharmacy_services,
  m_031_provider_coupon_limits,
  m_032_provider_only_coupons,
  m_033_loyalty_and_referral,
  m_034_admin_rbac,
  m_035_audit_log_enhancements,
  m_036_add_missing_created_at_indexes,
  m_037_rbac_resource_catalog,
  m_038_service_commission,
  m_039_governorate_coords,
  m_040_districts,
  m_041_rbac_districts,
  m_042_restore_agent_withdrawals_created_idx,
];


function seedSoldCountersDemo() {
  // طلبات مكتملة تجريبية تملأ عدّاد "باع X / طلب X" على بطاقات البنود بأرقام واقعية.
  // بلا customer_id حتى لا تظهر في طلبات أي زبون؛ تُحسب كمبيعات للبند من items_json.
  // تُتخطى إذا وُجدت طلبات تجريبية سابقة (لتظل قابلة للاستدعاء بعد بذر الكتالوج دون تكرار).
  const existing = get("SELECT COUNT(*) AS c FROM orders WHERE order_number LIKE 'DEMO-%'");
  if (existing && existing.c > 0) return;
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
    if (!prov || !prov.service_id) continue;
    const qty = 1 + (it.item_id % 4);
    const total = round2(Number(it.paid) * qty);
    const rounds = 3 + ((it.item_id * 7) % 28);
    for (let i = 0; i < rounds; i++) {
      const num = String(100000 + n);
      run(
        `INSERT INTO orders (order_number, provider_id, service_id, governorate_id, status, customer_name, items_json, total_amount, subtotal_amount, discount_amount, commission_amount, platform_amount, agent_amount, provider_amount, status_history_json)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [
          `DEMO-${num.slice(1)}`, it.provider_id, prov.service_id, prov.governorate_id, 'completed', 'عميل تجريبي',
          JSON.stringify([{ kind: it.kind, item_id: it.item_id, title: it.title, quantity: qty, unit_price: Number(it.paid), total }]),
          total, total, 0, 0, 0, 0, total, JSON.stringify([{ status: 'completed', at: new Date().toISOString() }]),
        ]
      );
      n++;
    }
  }
  console.log(`[migrate] seeded ${n} completed demo orders`);
}
globalThis.seedSoldCountersDemo = seedSoldCountersDemo;

function migrate() {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    applied_at TEXT NOT NULL DEFAULT (datetime('now'))
  );`);

  const applied = new Set(all('SELECT name FROM schema_migrations').map((r) => r.name));

  for (const m of MIGRATIONS) {
    if (applied.has(m.name)) continue;
    db.exec('BEGIN');
    try {
      m.up();
      run('INSERT INTO schema_migrations (name) VALUES (?)', [m.name]);
      db.exec('COMMIT');
      console.log(`[migrate] applied: ${m.name}`);
    } catch (e: any) {
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
