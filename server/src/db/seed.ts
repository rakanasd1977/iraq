const bcrypt = require('bcryptjs');
const { run, get, all } = require('./index');
const { migrate, seedSoldCountersDemo } = require('./migrate');

migrate();

const GOVERNORATES = [
  { ar: 'بغداد', en: 'Baghdad', code: 'BAG', fee: 5000000, lat: 33.3152, lng: 44.3661 },
  { ar: 'البصرة', en: 'Basra', code: 'BAS', fee: 3000000, lat: 30.5085, lng: 47.7804 },
  { ar: 'نينوى', en: 'Nineveh', code: 'NIN', fee: 2500000, lat: 36.345, lng: 43.145 },
  { ar: 'أربيل', en: 'Erbil', code: 'ERB', fee: 3500000, lat: 36.19, lng: 44.0092 },
  { ar: 'السليمانية', en: 'Sulaymaniyah', code: 'SUL', fee: 2500000, lat: 35.5556, lng: 45.435 },
  { ar: 'دهوك', en: 'Duhok', code: 'DUH', fee: 2000000, lat: 36.86, lng: 42.99 },
  { ar: 'كركوك', en: 'Kirkuk', code: 'KIR', fee: 1500000, lat: 35.4667, lng: 44.2833 },
  { ar: 'النجف', en: 'Najaf', code: 'NAJ', fee: 2500000, lat: 31.998, lng: 44.305 },
  { ar: 'كربلاء', en: 'Karbala', code: 'KAR', fee: 2000000, lat: 32.616, lng: 44.024 },
  { ar: 'الأنبار', en: 'Anbar', code: 'ANB', fee: 1500000, lat: 33.42, lng: 43.3 },
  { ar: 'صلاح الدين', en: 'Salah al-Din', code: 'SAL', fee: 1200000, lat: 34.603, lng: 43.68 },
  { ar: 'ديالى', en: 'Diyala', code: 'DIY', fee: 1200000, lat: 33.74, lng: 44.63 },
  { ar: 'واسط', en: 'Wasit', code: 'WAS', fee: 1200000, lat: 32.51, lng: 45.82 },
  { ar: 'ذي قار', en: 'Dhi Qar', code: 'DHI', fee: 1200000, lat: 31.05, lng: 46.26 },
  { ar: 'ميسان', en: 'Maysan', code: 'MAY', fee: 1000000, lat: 31.85, lng: 47.15 },
  { ar: 'المثنى', en: 'Muthanna', code: 'MUT', fee: 800000, lat: 31.33, lng: 45.28 },
  { ar: 'القادسية', en: 'Al-Qadisiyyah', code: 'QAD', fee: 1000000, lat: 31.99, lng: 44.93 },
  { ar: 'بابل', en: 'Babylon', code: 'BAB', fee: 1500000, lat: 32.47, lng: 44.42 },
];

const DISTRICTS = [
  { gov: 'BAG', ar: 'الرصافة', en: 'Al-Rusafa', code: 'RUS', fee: 800000, lat: 33.34, lng: 44.40 },
  { gov: 'BAG', ar: 'الكرخ', en: 'Al-Karkh', code: 'KRK', fee: 800000, lat: 33.30, lng: 44.33 },
  { gov: 'BAS', ar: 'الزبير', en: 'Al-Zubair', code: 'ZUB', fee: 500000, lat: 30.39, lng: 47.63 },
  { gov: 'NIN', ar: 'الموصل', en: 'Mosul', code: 'MOS', fee: 400000, lat: 36.36, lng: 43.15 },
];

const SERVICES = [
  { slug: 'stores', ar: 'المتاجر', en: 'Stores', icon: '🛒', desc: 'متاجر متعددة لبيع المنتجات والبضائع' },
  { slug: 'restaurants', ar: 'المطاعم', en: 'Restaurants', icon: '🍽️', desc: 'مطاعم لطلب الوجبات والطعام' },
  { slug: 'hotels', ar: 'الفنادق', en: 'Hotels', icon: '🏨', desc: 'فنادق لحجز الغرف والإقامة' },
  { slug: 'flights', ar: 'حجز الطيران', en: 'Flights', icon: '✈️', desc: 'حجز تذاكر الطيران المحلي والدولي' },
  { slug: 'travel_offices', ar: 'مكاتب السفر', en: 'Travel Offices', icon: '🧳', desc: 'مكاتب سفر للرحلات والباقات السياحية' },
  { slug: 'pharmacies', ar: 'مواد انشائية', en: 'Construction Materials', icon: '🧱', desc: 'مواد بناء وإنشاءات' },
  { slug: 'electronics', ar: 'الإلكترونيات', en: 'Electronics', icon: '📱', desc: 'هواتف وأجهزة إلكترونية وإكسسوارات' },
  { slug: 'fashion', ar: 'الأزياء', en: 'Fashion', icon: '👗', desc: 'ملابس وأزياء وعطور' },
  { slug: 'grocery', ar: 'البقالة', en: 'Grocery', icon: '🥬', desc: 'مواد غذائية واستهلاكية' },
  { slug: 'home_services', ar: 'مواد منزلية', en: 'Home Materials', icon: '🧺', desc: 'مواد وأدوات منزلية' },
];

const SETTINGS = {
  platform_commission_default: { value: '5', label: 'نسبة عمولة المنصة الافتراضية (%)' },
  provider_free_orders: { value: '5', label: 'عدد الطلبات المجانية للمزود الجديد (بدون عمولة للمنصة والوكيل)' },
  agent_default_commission: { value: '2', label: 'نسبة عمولة الوكيل الافتراضية (%)' },
  currency: { value: 'IQD', label: 'العملة' },
  app_name: { value: 'سوق الرافدين', label: 'اسم التطبيق' },
  support_phone: { value: '', label: 'رقم الدعم' },
  about_us: { value: '', label: 'عن المنصة' },
  require_agent_lease: { value: '1', label: 'تفعيل تجديد إجارة الوكالة السنوية' },
  recharge_instructions: { value: 'أرسل مبلغ الشحن إلى أحد حسابات المنصة أدناه ثم ارفق لقطة شاشة لعملية الإرسال ضمن طلب الشحن، وبعد تدقيق المسؤول يُضاف الرصيد لمحفظتك.', label: 'تعليمات شحن الرصيد (تظهر للمزودين)' },
  zain_cash_number: { value: '', label: 'أرقام زين كاش لاستقبال الشحنات' },
  asia_pay_number: { value: '', label: 'أرقام آسيا باي لاستقبال الشحنات' },
  first_iraqi_bank_name: { value: '', label: 'اسم المستفيد - مصرف العراق الأول' },
  first_iraqi_bank_iban: { value: '', label: 'رقم الآيبان - مصرف العراق الأول' },
  al_ahli_bank_name: { value: '', label: 'اسم المستفيد - المصرف الأهلي' },
  al_ahli_bank_iban: { value: '', label: 'رقم الآيبان - المصرف الأهلي' },
};

function seedGovernorates() {
  const count = get('SELECT COUNT(*) AS c FROM governorates').c;
  if (count > 0) return console.log('[seed] المحافظات موجودة مسبقاً');
  GOVERNORATES.forEach((g, i) => {
    run(
      'INSERT INTO governorates (name_ar, name_en, code, lease_fee, sort_order, lat, lng) VALUES (?,?,?,?,?,?,?)',
      [g.ar, g.en, g.code, g.fee, i + 1, g.lat, g.lng]
    );
  });
  console.log(`[seed] تم إدخال ${GOVERNORATES.length} محافظة`);
}

function seedDistricts() {
  const existing = get('SELECT COUNT(*) AS c FROM districts').c;
  DISTRICTS.forEach((d) => {
    if (get('SELECT 1 FROM districts WHERE code = ?', [d.code])) return;
    const gov = get('SELECT id FROM governorates WHERE code = ?', [d.gov]);
    if (!gov) return;
    const sortOrder = get('SELECT COALESCE(MAX(sort_order),0) + 1 AS n FROM districts').n;
    run(
      'INSERT INTO districts (governorate_id, name_ar, name_en, code, lease_fee, sort_order, lat, lng) VALUES (?,?,?,?,?,?,?,?)',
      [gov.id, d.ar, d.en, d.code, d.fee, sortOrder, d.lat, d.lng]
    );
  });
  console.log(`[seed] تم التحقق/إدخال الأقضية (الموجود ${existing})`);
}

function seedDemoDistrictAgent() {
  if (get('SELECT 1 FROM users WHERE email = ?', ['agent.rusafa@rafidain.iq'])) {
    return console.log('[seed] وكيل القضاء التجريبي موجود مسبقاً');
  }
  const rusafa = get('SELECT id, governorate_id FROM districts WHERE code = ?', ['RUS']);
  if (!rusafa) return console.log('[seed] لا يوجد قضاء الرصافة لربط وكيل القضاء');

  const now = new Date();
  const end = new Date(now);
  end.setFullYear(end.getFullYear() + 1);
  const userId = run('INSERT INTO users (role, name_ar, email, password_hash, governorate_id, is_active) VALUES (?,?,?,?,?,1)', [
    'agent',
    'وكيل قضاء الرصافة',
    'agent.rusafa@rafidain.iq',
    bcrypt.hashSync('Agent@123', 10),
    rusafa.governorate_id,
  ]).lastId;
  run(
    'INSERT INTO agents (user_id, governorate_id, district_id, commission_rate, lease_status, lease_expires_at) VALUES (?,?,?,?,?,?)',
    [userId, rusafa.governorate_id, rusafa.id, 2, 'active', end.toISOString()]
  );
  console.log('[seed] حساب وكيل القضاء: agent.rusafa@rafidain.iq / Agent@123');
}

function seedServices() {
  const count = get('SELECT COUNT(*) AS c FROM services').c;
  if (count > 0) return console.log('[seed] الخدمات موجودة مسبقاً');
  SERVICES.forEach((s, i) => {
    run(
      'INSERT INTO services (slug, name_ar, name_en, icon, description, sort_order) VALUES (?,?,?,?,?,?)',
      [s.slug, s.ar, s.en, s.icon, s.desc, i + 1]
    );
  });
  console.log(`[seed] تم إدخال ${SERVICES.length} خدمات`);
}

function seedSettings() {
  for (const [key, { value, label }] of Object.entries(SETTINGS)) {
    const exists = get('SELECT key FROM settings WHERE key = ?', [key]);
    if (!exists) run('INSERT INTO settings (key, value, label) VALUES (?,?,?)', [key, value, label]);
  }
  console.log('[seed] تم إدخال الإعدادات الافتراضية');
}

function seedAccounts() {
  const admin = get('SELECT id FROM users WHERE role = ?', ['admin']);
  if (admin) return console.log('[seed] حسابات المستخدمين موجودة مسبقاً');

  run('INSERT INTO users (role, name_ar, email, password_hash, is_active) VALUES (?,?,?,?,1)', [
    'admin',
    'مدير المنصة',
    'admin@rafidain.iq',
    bcrypt.hashSync('Admin@123', 10),
  ]);
  const adminId = get('SELECT id FROM users WHERE email = ?', ['admin@rafidain.iq']).id;
  const superAdminRole = get('SELECT id FROM admin_roles WHERE name = ?', ['super_admin']);
  if (superAdminRole) {
    run('INSERT OR IGNORE INTO admin_user_roles (user_id, role_id, assigned_by) VALUES (?,?,?)', [adminId, superAdminRole.id, adminId]);
  }
  console.log('[seed] حساب المدير: admin@rafidain.iq / Admin@123');

  const baghdad = get('SELECT id FROM governorates WHERE code = ?', ['BAG']);

  const agentUserId = run('INSERT INTO users (role, name_ar, email, password_hash, governorate_id, is_active) VALUES (?,?,?,?,?,1)', [
    'agent',
    'وكيل محافظة بغداد',
    'agent.baghdad@rafidain.iq',
    bcrypt.hashSync('Agent@123', 10),
    baghdad.id,
  ]).lastId;

  const now = new Date();
  const end = new Date(now);
  end.setFullYear(end.getFullYear() + 1);
  run(
    'INSERT INTO agents (user_id, governorate_id, commission_rate, lease_status, lease_expires_at) VALUES (?,?,?,?,?)',
    [agentUserId, baghdad.id, 2, 'active', end.toISOString()]
  );
  console.log('[seed] حساب الوكيل: agent.baghdad@rafidain.iq / Agent@123');

  const stores = get('SELECT id FROM services WHERE slug = ?', ['stores']);
  const providerUserId = run('INSERT INTO users (role, name_ar, email, password_hash, governorate_id, service_type, is_active) VALUES (?,?,?,?,?,?,1)', [
    'provider',
    'متجر الرافدين للتجارة',
    'provider.demo@rafidain.iq',
    bcrypt.hashSync('Provider@123', 10),
    baghdad.id,
    'stores',
  ]).lastId;

  run(
    'INSERT INTO providers (user_id, governorate_id, service_id, name_ar, commission_rate, is_active, is_verified) VALUES (?,?,?,?,?,1,1)',
    [providerUserId, baghdad.id, stores.id, 'متجر الرافدين للتجارة', 5]
  );
  console.log('[seed] حساب مزود الخدمة: provider.demo@rafidain.iq / Provider@123');

  const otherProviders = [
    { name: 'مطعم الرافدين للمشاوي', email: 'restaurant.demo@rafidain.iq', slug: 'restaurants' },
    { name: 'فندق الرافدين بغداد', email: 'hotel.demo@rafidain.iq', slug: 'hotels' },
    { name: 'شركة الرافدين للطيران', email: 'flights.demo@rafidain.iq', slug: 'flights' },
    { name: 'مكتب الرافدين للسفر', email: 'travel.demo@rafidain.iq', slug: 'travel_offices' },
  ];
  for (const a of otherProviders) {
    const svc = get('SELECT id FROM services WHERE slug = ?', [a.slug]);
    if (!svc) continue;
    const uid = run('INSERT INTO users (role, name_ar, email, password_hash, governorate_id, service_type, is_active) VALUES (?,?,?,?,?,?,1)', [
      'provider', a.name, a.email, bcrypt.hashSync('Provider@123', 10), baghdad.id, a.slug,
    ]).lastId;
    run(
      'INSERT INTO providers (user_id, governorate_id, service_id, name_ar, commission_rate, is_active, is_verified) VALUES (?,?,?,?,?,1,1)',
      [uid, baghdad.id, svc.id, a.name, 5]
    );
    console.log(`[seed] حساب مزود ${a.slug}: ${a.email} / Provider@123`);
  }

  const customerUserId = run('INSERT INTO users (role, name_ar, email, password_hash, governorate_id, is_active) VALUES (?,?,?,?,?,1)', [
    'customer',
    'زبون تجريبي',
    'customer.demo@rafidain.iq',
    bcrypt.hashSync('Customer@123', 10),
    baghdad.id,
  ]).lastId;
  run('INSERT INTO customers (user_id, governorate_id) VALUES (?,?)', [customerUserId, baghdad.id]);
  console.log('[seed] حساب الزبون: customer.demo@rafidain.iq / Customer@123');
}

function seedDemoAdminUsers() {
  const managerEmail = 'manager.demo@rafidain.iq';
  const viewerEmail = 'viewer.demo@rafidain.iq';
  if (get('SELECT 1 FROM users WHERE email = ?', [managerEmail]) || get('SELECT 1 FROM users WHERE email = ?', [viewerEmail])) {
    return console.log('[seed] مستخدمو العرض للأدوار موجودون مسبقاً');
  }

  const adminId = get('SELECT id FROM users WHERE email = ?', ['admin@rafidain.iq'])?.id || null;

  const managerId = run('INSERT INTO users (role, name_ar, email, password_hash, is_active) VALUES (?,?,?,?,1)', [
    'admin', 'مدير العمليات التجريبي', managerEmail, bcrypt.hashSync('Manager@123', 10),
  ]).lastId;
  const viewerId = run('INSERT INTO users (role, name_ar, email, password_hash, is_active) VALUES (?,?,?,?,1)', [
    'admin', 'مشاهد تجريبي', viewerEmail, bcrypt.hashSync('Viewer@123', 10),
  ]).lastId;

  const managerRole = get('SELECT id FROM admin_roles WHERE name = ?', ['manager']);
  const viewerRole = get('SELECT id FROM admin_roles WHERE name = ?', ['viewer']);
  if (managerRole) run('INSERT OR IGNORE INTO admin_user_roles (user_id, role_id, assigned_by) VALUES (?,?,?)', [managerId, managerRole.id, adminId]);
  if (viewerRole) run('INSERT OR IGNORE INTO admin_user_roles (user_id, role_id, assigned_by) VALUES (?,?,?)', [viewerId, viewerRole.id, adminId]);
  console.log('[seed] حسابا العرض: manager.demo@rafidain.iq / Manager@123 و viewer.demo@rafidain.iq / Viewer@123');
}

function seedCoupons() {
  // كوبون تجريبي للاختبار من لوحة الزبون — مقيّد بمتجر المزود التجريبي (الكوبونات حصرية للمزودين)
  const store = get(
    `SELECT p.id FROM providers p
     JOIN services s ON s.id = p.service_id
     JOIN governorates g ON g.id = p.governorate_id
     WHERE s.slug = 'stores' AND g.code = 'BAG' ORDER BY p.id ASC LIMIT 1`
  );
  if (!store) return console.log('[seed] لا يوجد متجر تجريبي لربط الكوبون به');
  const existing = get('SELECT id FROM coupons WHERE code = ?', ['RAFIDAIN10']);
  if (existing) {
    // إصلاح أي صف تالف (مزوّد ناقص/غير مفعّل) بدل تخطّيه بصمت
    run(
      'UPDATE coupons SET provider_id = ?, is_active = 1, discount_type = ?, discount_value = ?, min_amount = ?, max_uses = ?, per_customer_limit = ? WHERE id = ?',
      [store.id, 'percent', 10, 0, 0, 1, existing.id]
    );
    return console.log('[seed] كوبون RAFIDAIN10 موجود مسبقاً — تم إصلاحه');
  }
  run(
    'INSERT INTO coupons (code, title, discount_type, discount_value, min_amount, provider_id, max_uses, per_customer_limit, is_active) VALUES (?,?,?,?,?,?,?,?,1)',
    ['RAFIDAIN10', 'خصم ترحيبي 10%', 'percent', 10, 0, store.id, 0, 1]
  );
  console.log('[seed] كوبون تجريبي لمتجر المزود: RAFIDAIN10 (خصم 10%)');
}

function seedCatalog() {
  const providerByService = (slug) => {
    const svc = get('SELECT id FROM services WHERE slug = ?', [slug]);
    if (!svc) return null;
    return get('SELECT id FROM providers WHERE service_id = ? ORDER BY id ASC LIMIT 1', [svc.id]);
  };

  // متجر: أقسام + منتجات
  const store = providerByService('stores');
  if (store) {
    const existing = get('SELECT COUNT(*) AS c FROM products WHERE provider_id = ?', [store.id]).c;
    if (existing === 0) {
      const cat1 = run('INSERT INTO product_categories (provider_id, name_ar, name_en, sort_order) VALUES (?,?,?,?)', [store.id, 'إلكترونيات', 'Electronics', 1]).lastId;
      const cat2 = run('INSERT INTO product_categories (provider_id, name_ar, name_en, sort_order) VALUES (?,?,?,?)', [store.id, 'أزياء', 'Fashion', 2]).lastId;
      const IMG = (id) => `https://images.unsplash.com/${id}?w=500&q=80`;
      const LF = (kw) => `https://loremflickr.com/500/500/${kw}`;
      run('INSERT INTO products (provider_id, category_id, name_ar, name_en, description, price, old_price, stock, images_json, is_active, is_featured) VALUES (?,?,?,?,?,?,?,?,?,1,1)', [store.id, cat1, 'هاتف ذكي', 'Smartphone', 'هاتف حديث بشاشة كبيرة وبطارية تدوم طويلاً', 450000, 550000, 25, JSON.stringify([IMG('photo-1511707171634-5f897ff02aa9')])]);
      run('INSERT INTO products (provider_id, category_id, name_ar, name_en, description, price, old_price, stock, images_json, is_active, is_featured) VALUES (?,?,?,?,?,?,?,?,?,1,1)', [store.id, cat1, 'حاسوب محمول', 'Laptop', 'حاسوب خفيف مناسب للعمل والدراسة', 1250000, 1400000, 10, JSON.stringify([IMG('photo-1496181133206-80ce9b88a853')])]);
      run('INSERT INTO products (provider_id, category_id, name_ar, name_en, description, price, old_price, stock, images_json, is_active, is_featured) VALUES (?,?,?,?,?,?,?,?,?,1,0)', [store.id, cat1, 'سماعات لاسلكية', 'Wireless Earbuds', 'جودة صوت عالية وعزل ضوضاء', 65000, null, 50, JSON.stringify([IMG('photo-1505740420928-5e560c06d30e')])]);
      run('INSERT INTO products (provider_id, category_id, name_ar, name_en, description, price, old_price, stock, images_json, is_active, is_featured) VALUES (?,?,?,?,?,?,?,?,?,1,0)', [store.id, cat2, 'قُمصان قطنية', 'Cotton Shirts', 'أقمشة قطنية مريحة بألوان متعددة', 25000, null, 100, JSON.stringify([LF('tshirt,clothing')])]);
      run('INSERT INTO products (provider_id, category_id, name_ar, name_en, description, price, old_price, stock, images_json, is_active, is_featured) VALUES (?,?,?,?,?,?,?,?,?,1,1)', [store.id, cat2, 'ساعة يد أنيقة', 'Elegant Watch', 'تصميم كلاسيكي عصري', 120000, 150000, 30, JSON.stringify([IMG('photo-1524592094714-0f0654e20314')])]);
      console.log('[seed] كتالوج المتجر: 5 منتجات في قسمين');
    }
  }

  // مطعم: أقسام + أصناف (5 أصناف)
  const rest = providerByService('restaurants');
  if (rest) {
    const LF = (kw) => `https://loremflickr.com/500/500/${kw}`;
    const addMenuItem = (categoryName, f) => {
      let cat = get('SELECT id FROM menu_categories WHERE provider_id = ? AND name_ar = ?', [rest.id, categoryName]);
      if (!cat) cat = { id: run('INSERT INTO menu_categories (provider_id, name_ar, sort_order) VALUES (?,?,?)', [rest.id, categoryName, 99]).lastId };
      const exists = get('SELECT id FROM menu_items WHERE provider_id = ? AND name_ar = ?', [rest.id, f.name_ar]);
      if (exists) return;
      run('INSERT INTO menu_items (provider_id, category_id, name_ar, name_en, description, price, images_json, is_active, is_featured, is_available) VALUES (?,?,?,?,?,?,?,1,?,1)',
        [rest.id, cat.id, f.name_ar, f.name_en, f.description, f.price, JSON.stringify([f.img]), f.is_featured]);
    };
    addMenuItem('مشاوي', { name_ar: 'كبة مشوية', name_en: 'Grilled Kebab', description: 'كبة لحم غنم مشوية على الفحم', price: 18000, img: LF('kebab,grill'), is_featured: 1 });
    addMenuItem('مشاوي', { name_ar: 'تكة', name_en: 'Tikka', description: 'قطع لحم متبلة مشوية', price: 22000, img: LF('tikka,chicken'), is_featured: 1 });
    addMenuItem('مشاوي', { name_ar: 'شيش طاووق', name_en: 'Shish Tawook', description: 'أسياخ دجاج متبلة مشوية على الفحم', price: 16000, img: LF('shish,tawook'), is_featured: 0 });
    addMenuItem('مقبلات', { name_ar: 'حمص بالطحينة', name_en: 'Hummus', description: 'حمص بكريمة الطحينة مع زيت الزيتون', price: 8000, img: LF('hummus,food'), is_featured: 0 });
    addMenuItem('مقبلات', { name_ar: 'سلطة عراقية', name_en: 'Iraqi Salad', description: 'خضار طازجة مع دبس الرمان', price: 7000, img: 'https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=500&q=80', is_featured: 0 });
    const menuTotal = get('SELECT COUNT(*) AS c FROM menu_items WHERE provider_id = ?', [rest.id]).c;
    console.log(`[seed] قائمة المطعم: ${menuTotal} أصناف`);
  }

  // فندق: غرف
  const hotel = providerByService('hotels');
  if (hotel) {
    const existing = get('SELECT COUNT(*) AS c FROM hotel_rooms WHERE provider_id = ?', [hotel.id]).c;
    if (existing === 0) {
      const IMG = (id) => `https://images.unsplash.com/${id}?w=500&q=80`;
      run('INSERT INTO hotel_rooms (provider_id, name_ar, name_en, description, price_per_night, room_type, max_guests, images_json, is_active, is_featured) VALUES (?,?,?,?,?,?,?,?,1,1)', [hotel.id, 'غرفة قياسية', 'Standard Room', 'غرفة مريحة بإطلالة داخلية', 150000, 'standard', 2, JSON.stringify([IMG('photo-1611892440504-42a792e24d32')])]);
      run('INSERT INTO hotel_rooms (provider_id, name_ar, name_en, description, price_per_night, room_type, max_guests, images_json, is_active, is_featured) VALUES (?,?,?,?,?,?,?,?,1,0)', [hotel.id, 'جناح ديلوكس', 'Deluxe Suite', 'جناح واسع بإطلالة على النهر', 400000, 'deluxe', 4, JSON.stringify([IMG('photo-1590490360182-c33d57733427')])]);
      run('INSERT INTO hotel_rooms (provider_id, name_ar, name_en, description, price_per_night, room_type, max_guests, images_json, is_active, is_featured) VALUES (?,?,?,?,?,?,?,?,1,0)', [hotel.id, 'غرفة عائلية', 'Family Room', 'مناسبة للعائلات بمساحة كبيرة', 300000, 'family', 5, JSON.stringify([IMG('photo-1611892440504-42a792e24d32')])]);
      console.log('[seed] غرف الفندق: 3 غرف');
    }
  }

  // طيران: رحلات (5 رحلات)
  const air = providerByService('flights');
  if (air) {
    const base = new Date(Date.now() + 7 * 86400000);
    const base2 = new Date(Date.now() + 14 * 86400000);
    const iso = (d, h, m) => { const x = new Date(d); x.setHours(h, m); return x.toISOString(); };
    const IMG = (id) => `https://images.unsplash.com/${id}?w=500&q=80`;
    const addFlight = (f) => {
      const exists = get('SELECT id FROM flights WHERE provider_id = ? AND flight_number = ?', [air.id, f.flight_number]);
      if (exists) return;
      run('INSERT INTO flights (provider_id, flight_number, airline, origin, origin_ar, destination, destination_ar, departure_at, arrival_at, price, seats, images_json, is_active, is_featured) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,1,?)',
        [air.id, f.flight_number, f.airline, f.origin, f.origin_ar, f.destination, f.destination_ar, f.departure_at, f.arrival_at, f.price, f.seats, JSON.stringify([IMG('photo-1436491865332-7a61a109cc05')]), f.is_featured]);
    };
    addFlight({ flight_number: 'IA100', airline: 'العراقية', origin: 'BGW', origin_ar: 'بغداد', destination: 'ERB', destination_ar: 'أربيل', departure_at: iso(base, 8, 0), arrival_at: iso(base, 9, 0), price: 90000, seats: 120, is_featured: 1 });
    addFlight({ flight_number: 'IA101', airline: 'العراقية', origin: 'BGW', origin_ar: 'بغداد', destination: 'NJF', destination_ar: 'النجف', departure_at: iso(base, 13, 30), arrival_at: iso(base, 14, 20), price: 80000, seats: 90, is_featured: 0 });
    addFlight({ flight_number: 'IA200', airline: 'فلاي بغداد', origin: 'ERB', origin_ar: 'أربيل', destination: 'DUH', destination_ar: 'دهوك', departure_at: iso(base2, 10, 0), arrival_at: iso(base2, 10, 45), price: 75000, seats: 80, is_featured: 0 });
    addFlight({ flight_number: 'IA102', airline: 'العراقية', origin: 'BGW', origin_ar: 'بغداد', destination: 'BAS', destination_ar: 'البصرة', departure_at: iso(base, 7, 15), arrival_at: iso(base, 8, 30), price: 95000, seats: 110, is_featured: 0 });
    addFlight({ flight_number: 'IA300', airline: 'فلاي بغداد', origin: 'BGW', origin_ar: 'بغداد', destination: 'IST', destination_ar: 'إسطنبول', departure_at: iso(base2, 6, 0), arrival_at: iso(base2, 9, 40), price: 385000, seats: 150, is_featured: 0 });
    const flightsTotal = get('SELECT COUNT(*) AS c FROM flights WHERE provider_id = ?', [air.id]).c;
    console.log(`[seed] رحلات الطيران: ${flightsTotal} رحلات`);
  }

  // مكاتب سفر: باقات (5 باقات)
  const travel = providerByService('travel_offices');
  if (travel) {
    const IMG = (id) => `https://images.unsplash.com/${id}?w=500&q=80`;
    const addPackage = (f) => {
      const exists = get('SELECT id FROM travel_packages WHERE provider_id = ? AND name_ar = ?', [travel.id, f.name_ar]);
      if (exists) return;
      run('INSERT INTO travel_packages (provider_id, name_ar, name_en, description, destination, duration_days, price, includes_json, images_json, is_active, is_featured) VALUES (?,?,?,?,?,?,?,?,?,1,?)',
        [travel.id, f.name_ar, f.name_en, f.description, f.destination, f.duration_days, f.price, JSON.stringify(f.includes), JSON.stringify([f.img]), f.is_featured]);
    };
    addPackage({ name_ar: 'رحلة إسطنبول', name_en: 'Istanbul Trip', description: 'باقة سياحية شاملة لتشمل الإقامة والتنقلات', destination: 'إسطنبول', duration_days: 5, price: 1250000, includes: ['تذاكر طيران ذهاب وعودة', 'إقامة 4 ليالٍ في فندق 5 نجوم', 'تنقلات من وإلى المطار'], img: IMG('photo-1524231757912-21f4fe3a7200'), is_featured: 1 });
    addPackage({ name_ar: 'عمرة', name_en: 'Umrah', description: 'باقة عمرة تشمل التأشيرة والإقامة', destination: 'مكة المكرمة', duration_days: 14, price: 1950000, includes: ['تأشيرة', 'سكن قريب من الحرم', 'نقل بري'], img: IMG('photo-1591604129939-f1efa4d9f7fa'), is_featured: 0 });
    addPackage({ name_ar: 'رحلة شرم الشيخ', name_en: 'Sharm Trip', description: 'استجمام على البحر الأحمر', destination: 'شرم الشيخ', duration_days: 7, price: 1750000, includes: ['طيران', 'فندق بكلّي الإقامة'], img: IMG('photo-1507525428034-b723cf961d3e'), is_featured: 0 });
    addPackage({ name_ar: 'رحلة دبي', name_en: 'Dubai Trip', description: 'تسوق وترفيه في وجهة دبي العالمية', destination: 'دبي', duration_days: 5, price: 1650000, includes: ['تذاكر طيران ذهاب وعودة', 'إقامة 4 ليالٍ بفندق 4 نجوم', 'تأشيرة دخول'], img: IMG('photo-1512453979798-5ea266f8880c'), is_featured: 0 });
    addPackage({ name_ar: 'رحلة أنطاليا', name_en: 'Antalya Trip', description: 'شواطئ أنطاليا التركية الساحرة', destination: 'أنطاليا', duration_days: 7, price: 1950000, includes: ['طيران ذهاب وعودة', 'إقامة 6 ليالٍ كليّ الإقامة', 'تنقلات المطار'], img: IMG('photo-1507525428034-b723cf961d3e'), is_featured: 0 });
    const packagesTotal = get('SELECT COUNT(*) AS c FROM travel_packages WHERE provider_id = ?', [travel.id]).c;
    console.log(`[seed] باقات مكاتب السفر: ${packagesTotal} باقات`);
  }
}

// حراسة: لا تُدخل بيانات التجربة تلقائياً في بيئة الإنتاج إلا بتفويض صريح (SEED_ALLOW=1)
if (process.env.NODE_ENV === 'production' && process.env.SEED_ALLOW !== '1') {
  console.warn('[seed] NODE_ENV=production بدون SEED_ALLOW=1 — تخطي تهيئة بيانات التجربة.');
  module.exports = {};
} else {
  seedGovernorates();
  seedServices();
  seedSettings();
  seedDistricts();
  seedAccounts();
  seedDemoDistrictAgent();
  seedDemoAdminUsers();
  seedCoupons();
  seedCatalog();
  seedSoldCountersDemo();

  console.log('[seed] اكتمل التجهيز بنجاح');
}
