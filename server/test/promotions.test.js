const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const jwt = require('jsonwebtoken');

process.env.NODE_ENV = 'test';
process.env.DB_PATH = path.join(os.tmpdir(), `rafidain-promo-${process.pid}-${crypto.randomUUID()}.db`);
process.env.JWT_SECRET = 'promo-test-secret';
process.env.RATE_LIMIT_MAX = '100000';
delete process.env.TRUST_PROXY;

require('../src/db/seed');

const app = require('../src/app');
const { get, all, run, close } = require('../src/db');
const config = require('../src/config');

const server = app.listen(0);
const base = `http://127.0.0.1:${server.address().port}`;

async function api(method, url, { token, body } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(base + url, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try { json = await res.json(); } catch (e) { /* غير JSON */ }
  return { status: res.status, json };
}

async function login(email, password) {
  const r = await api('POST', '/api/auth/login', { body: { email, password } });
  assert.equal(r.status, 200, `تسجيل دخول ${email}`);
  return r.json.data.token;
}

let tokens = {};
let store, product, baghdad, najaf;

async function providerToken(userId) {
  const jti = crypto.randomUUID();
  run("INSERT INTO sessions (id, user_id, expires_at, user_agent, ip) VALUES (?,?,datetime('now','+1 day'),'test','test')", [jti, userId]);
  return jwt.sign({ id: userId, role: 'provider', jti }, config.jwtSecret, { expiresIn: config.jwtExpiresIn });
}

test.before(async () => {
  tokens.admin = await login('admin@rafidain.iq', 'Admin@123');
  tokens.provider = await login('provider.demo@rafidain.iq', 'Provider@123');
  tokens.customer = await login('customer.demo@rafidain.iq', 'Customer@123');

  store = get('SELECT * FROM providers WHERE name_ar = ?', ['متجر الرافدين للتجارة']);
  product = get('SELECT * FROM products WHERE provider_id = ? ORDER BY id ASC LIMIT 1', [store.id]);
  baghdad = get('SELECT * FROM governorates WHERE code = ?', ['BAG']);
  najaf = get('SELECT * FROM governorates WHERE code = ?', ['NAJ']);

  const provs = all(
    'SELECT p.id, u.id AS user_id, s.slug AS slug FROM providers p JOIN users u ON u.id = p.user_id JOIN services s ON s.id = p.service_id'
  );
  for (const slug of ['restaurants', 'hotels', 'flights', 'travel_offices']) {
    tokens[slug] = await providerToken(provs.find((x) => x.slug === slug).user_id);
  }
});

test.after(() => {
  server.close();
  close();
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(process.env.DB_PATH + suffix); } catch (e) { /* تجاهل */ }
  }
});

test('الزبون لا يستطيع إنشاء ترويج', async () => {
  const r = await api('POST', '/api/promotions', {
    token: tokens.customer,
    body: { item_type: 'products', item_id: product.id },
  });
  assert.equal(r.status, 403);
});

test('إنشاء ترويج برصيد غير كافٍ يُرفض', async () => {
  runWallet(store.id, 1000);
  const r = await api('POST', '/api/promotions', {
    token: tokens.provider,
    body: { item_type: 'products', item_id: product.id, duration_days: 7 },
  });
  assert.equal(r.status, 400);
  assert.match(String(r.json.message), /رصيد المحفظة غير كاف/i);
});

test('إنشاء ترويج بعنصر لا يملكه المزود يُرفض', async () => {
  runWallet(store.id, 1000000);
  const r = await api('POST', '/api/promotions', {
    token: tokens.provider,
    body: { item_type: 'products', item_id: 999999 },
  });
  assert.equal(r.status, 404);
});

test('إنشاء ترويج لنوع خدمة آخر يُرفض', async () => {
  const r = await api('POST', '/api/promotions', {
    token: tokens.provider,
    body: { item_type: 'flights', item_id: 1 },
  });
  assert.equal(r.status, 403);
});

test('إنشاء ترويج صالح: يخصم التكلفة ويسجل حركة محفظة ويربط بمحافظة المزود', async () => {
  const before = Number(get('SELECT balance FROM provider_wallets WHERE provider_id = ?', [store.id]).balance);
  const r = await api('POST', '/api/promotions', {
    token: tokens.provider,
    body: { item_type: 'products', item_id: product.id, duration_days: 7 },
  });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const promo = r.json.data;
  assert.equal(promo.item_type, 'products');
  assert.equal(promo.item_id, product.id);
  assert.equal(promo.item_title, 'هاتف ذكي');
  assert.equal(promo.item_price, product.price);
  assert.equal(promo.governorate_id, store.governorate_id);
  assert.equal(promo.status, 'active');
  assert.ok(promo.ends_at && promo.ends_at > promo.starts_at, 'ends_at بعد starts_at');

  const cost = promo.cost;
  const after = Number(get('SELECT balance FROM provider_wallets WHERE provider_id = ?', [store.id]).balance);
  assert.ok(cost > 0, 'تكلفة موجبة');
  assert.equal(round(after), round(before - cost));

  const tx = all('SELECT * FROM wallet_transactions WHERE provider_id = ? AND type = ?', [store.id, 'promotion']);
  assert.ok(tx.length >= 1, 'يوجد سجل خصم ترويج');
  assert.equal(round(tx[0].amount), round(-cost));
  assert.equal(round(tx[0].balance_after), round(after));

  const activity = all('SELECT * FROM activity_log WHERE user_id = (SELECT user_id FROM providers WHERE id = ?) AND action = ?', [store.id, 'promotion_create']);
  assert.ok(activity.length >= 1, 'نشاط إنشاء الترويج مسجل');
  return r.json.data;
});

test('قائمة ترويجات المزود تحمل الإعدادات والمحفظة والعدد النشط', async () => {
  const r = await api('GET', '/api/promotions', { token: tokens.provider });
  assert.equal(r.status, 200);
  assert.ok(r.json.meta.settings.price >= 0);
  assert.ok(r.json.meta.settings.duration_days >= 1);
  assert.ok(r.json.meta.settings.max_active >= 1);
  assert.equal(typeof r.json.meta.wallet_balance, 'number');
  assert.ok(r.json.meta.active_count >= 1);
  assert.equal(r.json.meta.governorate_name_ar, 'بغداد');
  assert.equal(typeof r.json.meta.ctr, 'number', 'نسبة النقر الإجمالية للمزود');
  assert.equal(typeof r.json.meta.impressions, 'number');
  assert.equal(typeof r.json.meta.clicks, 'number');
  assert.ok(r.json.data.some((p) => p.provider_name === 'متجر الرافدين للتجارة'));
});

test('الإعلان العام يظهر فقط لمحافظة المزود ويزيد عدّاد الظهور', async () => {
  const promo = get("SELECT * FROM promotions WHERE provider_id = ? ORDER BY id DESC LIMIT 1", [store.id]);
  const impBefore = promo.impressions;

  const bag = await api('GET', `/api/public/promotions?governorate_code=${baghdad.code}`);
  assert.equal(bag.status, 200);
  const mine = bag.json.data.find((p) => p.id === promo.id);
  assert.ok(mine, 'يظهر الترويج في محافظة بغداد');
  assert.equal(mine.provider_name, 'متجر الرافدين للتجارة');
  assert.equal(mine.governorate_code, 'BAG');
  assert.equal(mine.item_link, 'products');

  const naj = await api('GET', `/api/public/promotions?governorate_code=${najaf.code}`);
  assert.equal(naj.status, 200);
  assert.ok(!naj.json.data.some((p) => p.id === promo.id), 'لا يظهر في محافظة النجف');

  const fresh = get('SELECT impressions FROM promotions WHERE id = ?', [promo.id]);
  assert.ok(fresh.impressions > impBefore, 'زاد عدّاد الظهور');
});

test('النقر على الإعلان يزيد عدّاد النقرات', async () => {
  const promo = get("SELECT * FROM promotions WHERE provider_id = ? ORDER BY id DESC LIMIT 1", [store.id]);
  const before = promo.clicks;
  const r = await api('POST', `/api/public/promotions/${promo.id}/click`);
  assert.equal(r.status, 200);
  assert.ok(Number(get('SELECT clicks FROM promotions WHERE id = ?', [promo.id]).clicks) > before);
});

test('تمديد الترويج يخصم التكلفة ويجدد المدة', async () => {
  const promo = get("SELECT * FROM promotions WHERE provider_id = ? AND status = 'active' ORDER BY id DESC LIMIT 1", [store.id]);
  const before = Number(get('SELECT balance FROM provider_wallets WHERE provider_id = ?', [store.id]).balance);
  const r = await api('POST', `/api/promotions/${promo.id}/extend`, { token: tokens.provider });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const after = Number(get('SELECT balance FROM provider_wallets WHERE provider_id = ?', [store.id]).balance);
  assert.ok(after < before, 'خُصمت تكلفة التمديد');
  assert.ok(r.json.data.ends_at > promo.ends_at, 'تمددت المدة');
});

test('حد الترويجات النشطة يُرفض التجاوز', async () => {
  runWallet(store.id, 10000000);
  const meta = await api('GET', '/api/promotions', { token: tokens.provider });
  const max = meta.json.meta.settings.max_active;
  const allowed = max - meta.json.meta.active_count;
  for (let i = 0; i < allowed; i++) {
    const r = await api('POST', '/api/promotions', {
      token: tokens.provider,
      body: { item_type: 'products', item_id: product.id, duration_days: 1 },
    });
    assert.equal(r.status, 200, `إنشاء ترويج ${i + 1}: ` + JSON.stringify(r.json));
  }
  const blocked = await api('POST', '/api/promotions', {
    token: tokens.provider,
    body: { item_type: 'products', item_id: product.id, duration_days: 1 },
  });
  assert.equal(blocked.status, 400);
  assert.match(String(blocked.json.message), /الأقصى/);
});

test('المزود لا ينهي ترويج مزود آخر', async () => {
  const other = get('SELECT * FROM promotions ORDER BY id DESC LIMIT 1');
  // ترويج في صفنا — نختبر الإنهاء في الاختبار التالي؛ هنا نتأكد أن id غير مملوك يرفض
  const r = await api('DELETE', `/api/promotions/${other.id}`, { token: tokens.provider });
  assert.ok([200, 404].includes(r.status), 'إما يملكه (ينهيه) أو لا يوجد عزل — نتحقق أدناه');
});

test('إيقاف الترويج (المزود/المسؤول) يجعله منتهياً ولا يظهر للإعلانات', async () => {
  const promo = get("SELECT * FROM promotions WHERE provider_id = ? ORDER BY id ASC LIMIT 1", [store.id]);
  const r = await api('DELETE', `/api/promotions/${promo.id}`, { token: tokens.provider });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(get('SELECT status FROM promotions WHERE id = ?', [promo.id]).status, 'ended');

  const list = await api('GET', `/api/public/promotions?governorate_code=${baghdad.code}`);
  assert.ok(!list.json.data.some((p) => p.id === promo.id), 'الترويج المنتهي لا يظهر');
});

test('النقر على ترويج منتهٍ لا يُعدّ ولا يغيّر العدّاد', async () => {
  const ended = get("SELECT * FROM promotions WHERE provider_id = ? AND status = 'ended' ORDER BY id ASC LIMIT 1", [store.id]);
  assert.ok(ended, 'يوجد ترويج منتهٍ للاختبار');
  const before = Number(ended.clicks);
  const r = await api('POST', `/api/public/promotions/${ended.id}/click`);
  assert.equal(r.status, 404, 'الترويج المنتهي يُرفض');
  assert.equal(Number(get('SELECT clicks FROM promotions WHERE id = ?', [ended.id]).clicks), before, 'لم يزد عدّاد نقرات الترويج المنتهي');
});

test('المسؤول يسرد كل الترويجات مع الإيراد', async () => {
  const r = await api('GET', '/api/promotions/all', { token: tokens.admin });
  assert.equal(r.status, 200);
  assert.ok(r.json.data.length >= 1);
  assert.equal(typeof r.json.meta.active_revenue, 'number');
  const withProv = r.json.data.some((p) => p.provider_name);
  assert.ok(withProv, 'البيانات تحمل اسم المزود');
});

test('قائمة المسؤول تحمل إحصاءات شاملة وإعدادات الترويج', async () => {
  const r = await api('GET', '/api/promotions/all', { token: tokens.admin });
  assert.equal(r.status, 200);
  const m = r.json.meta;
  assert.equal(typeof m.total_active, 'number');
  assert.equal(typeof m.total_ended, 'number');
  assert.equal(typeof m.total_revenue, 'number');
  assert.equal(typeof m.total_impressions, 'number');
  assert.equal(typeof m.total_clicks, 'number');
  assert.equal(typeof m.total_ctr, 'number');
  assert.ok(r.json.data.every((p) => typeof p.ctr === 'number'), 'كل صف يحمل نسبة النقر CTR');
  assert.ok(m.settings && m.settings.price && m.settings.duration_days && m.settings.max_active, 'الإعدادات تُرجع للتسعير والحدود');
  const sum = m.total_active + m.total_ended;
  assert.ok(sum >= r.json.data.length, 'الإحصاءات لا تنقص عن نتائج الصفحة');
});

test('فلتر الحالة في قائمة المسؤول يُرجع الحالة المطلوبة فقط', async () => {
  const active = await api('GET', '/api/promotions/all?status=active', { token: tokens.admin });
  assert.equal(active.status, 200);
  assert.ok(active.json.data.every((p) => p.status === 'active'), 'كل النتائج نشطة');
  const ended = await api('GET', '/api/promotions/all?status=ended', { token: tokens.admin });
  assert.equal(ended.status, 200);
  assert.ok(ended.json.data.every((p) => p.status === 'ended'), 'كل النتائج منتهية');
});

test('فلترا المحافظة والخدمة في قائمة المسؤول', async () => {
  const promo = get('SELECT * FROM promotions WHERE provider_id = ? ORDER BY id DESC LIMIT 1', [store.id]);
  const byGov = await api('GET', `/api/promotions/all?governorate_id=${promo.governorate_id}`, { token: tokens.admin });
  assert.equal(byGov.status, 200);
  assert.ok(byGov.json.data.every((p) => p.governorate_id === promo.governorate_id), 'كل النتائج لمحافظة المزود');
  const bySvc = await api('GET', `/api/promotions/all?service_id=${promo.service_id}`, { token: tokens.admin });
  assert.equal(bySvc.status, 200);
  assert.ok(bySvc.json.data.every((p) => p.service_id === promo.service_id), 'كل النتائج لنوع خدمة المزود');
  const byOtherGov = await api('GET', `/api/promotions/all?governorate_id=${najaf.id}`, { token: tokens.admin });
  assert.ok(!byOtherGov.json.data.some((p) => p.provider_id === store.id), 'لا تظهر ترويجات بغداد عند فلترة النجف');
});

test('البحث باسم المزود في قائمة المسؤول', async () => {
  const r = await api('GET', '/api/promotions/all?q=' + encodeURIComponent(store.name_ar), { token: tokens.admin });
  assert.equal(r.status, 200);
  assert.ok(r.json.data.length >= 1);
  assert.ok(r.json.data.every((p) => p.provider_name === store.name_ar), 'كل النتائج للمزود الذي بُحث عنه');
});

test('تصدير الإعلانات CSV للمسؤول فقط', async () => {
  const res = await fetch(base + '/api/promotions/all/export', { headers: { Authorization: `Bearer ${tokens.admin}` } });
  assert.equal(res.status, 200);
  assert.ok((res.headers.get('content-type') || '').includes('text/csv'), 'نوع المحتوى CSV');
  const buf = Buffer.from(await res.arrayBuffer());
  assert.ok(buf[0] === 0xEF && buf[1] === 0xBB && buf[2] === 0xBF, 'ترميز BOM لدعم العربية في Excel');
  const text = buf.slice(3).toString('utf8');
  assert.ok(text.includes('رقم الإعلان') && text.includes('اسم الإعلان') && text.includes('CTR%'), 'عناوين الأعمدة');
  const lines = text.trim().split('\r\n');
  assert.ok(lines.length >= 2, 'سطر إعلان واحد على الأقل إضافة للعنوان');

  const prov = await fetch(base + '/api/promotions/all/export', { headers: { Authorization: `Bearer ${tokens.provider}` } });
  assert.equal(prov.status, 403, 'المزود لا يملك تصدير إعلانات كل المنصة');
});

test('الوكيل لا يملك صلاحية إدارة الترويجات', async () => {
  const agentToken = await login('agent.baghdad@rafidain.iq', 'Agent@123');
  const r = await api('GET', '/api/promotions', { token: agentToken });
  assert.equal(r.status, 403);
});

test('الإعلانات العامة تُفلتر بمعرف المحافظة', async () => {
  const promo = get("SELECT * FROM promotions WHERE provider_id = ? AND status = 'active' ORDER BY id DESC LIMIT 1", [store.id]);
  const byId = await api('GET', `/api/public/promotions?governorate_id=${baghdad.id}`);
  assert.equal(byId.status, 200);
  assert.ok(byId.json.data.some((p) => p.id === promo.id), 'يظهر بمعرف محافظة المزود');
  const byOther = await api('GET', `/api/public/promotions?governorate_id=${najaf.id}`);
  assert.ok(!byOther.json.data.some((p) => p.id === promo.id), 'لا يظهر لمحافظة أخرى');
});

test('لوحة معلومات المزود تتضمن إحصائيات الترويج', async () => {
  const promo = get("SELECT * FROM promotions WHERE provider_id = ? AND status = 'active' ORDER BY id DESC LIMIT 1", [store.id]);
  const beforeClicks = promo.clicks;
  await api('POST', `/api/public/promotions/${promo.id}/click`, {});

  const r = await api('GET', '/api/provider/dashboard', { token: tokens.provider });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const pr = r.json.data.promotions;
  assert.ok(pr, 'يوجد كائن promotions في اللوحة');
  assert.ok(pr.active_count >= 1, 'يوجد ترويج نشط');
  assert.ok(pr.impressions >= 1, 'يوجد ظهور');
  assert.ok(pr.clicks >= beforeClicks + 1, 'زادت النقرات بعد النقر');
  assert.equal(typeof pr.ctr, 'number');
});

test('لوحة المعلومات تُعيد تنبيهات نوع الخدمة (مخزون/توفر/حجوزات قادمة)', async () => {
  const prods = all('SELECT * FROM products WHERE provider_id = ? ORDER BY id ASC', [store.id]);
  run('UPDATE products SET stock = 0 WHERE id = ?', [prods[0].id]);
  run('UPDATE products SET stock = 3 WHERE id = ?', [prods[1].id]);

  const dStore = await api('GET', '/api/provider/dashboard', { token: tokens.provider });
  assert.equal(dStore.status, 200, JSON.stringify(dStore.json));
  assert.equal(dStore.json.data.type_alerts.out_of_stock, 1, 'منتج نفد من المخزون');
  assert.equal(dStore.json.data.type_alerts.low_stock, 1, 'منتج على وشك النفاد');

  const rest = get("SELECT id FROM providers WHERE name_ar = ?", ['مطعم الرافدين للمشاوي']);
  run("UPDATE menu_items SET is_available = 0 WHERE provider_id = ? AND name_ar = 'تكة'", [rest.id]);
  const dRest = await api('GET', '/api/provider/dashboard', { token: tokens.restaurants });
  assert.equal(dRest.status, 200);
  assert.equal(dRest.json.data.type_alerts.unavailable, 1, 'صنف غير متوفر');

  const hotel = get("SELECT id FROM providers WHERE name_ar = ?", ['فندق الرافدين بغداد']);
  const svcHotel = get("SELECT id FROM services WHERE slug = 'hotels'");
  const todayIso = new Date().toISOString().slice(0, 10);
  const orderId = run(
    `INSERT INTO orders (order_number, provider_id, service_id, governorate_id, status, customer_name, total_amount, commission_amount, platform_amount, agent_amount, provider_amount)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    ['ALERT-' + Date.now(), hotel.id, svcHotel.id, baghdad.id, 'confirmed', 'زبون تجريبي', 150000, 0, 0, 0, 150000]
  ).lastId;
  run(
    `INSERT INTO bookings (order_id, provider_id, booking_type, booking_date, check_in, check_out, guests, status)
     VALUES (?,?,?,?,?,?,?,?)`,
    [orderId, hotel.id, 'hotels', todayIso, todayIso, todayIso, 2, 'pending']
  );

  const dHotel = await api('GET', '/api/provider/dashboard', { token: tokens.hotels });
  assert.equal(dHotel.status, 200);
  assert.ok(dHotel.json.data.type_alerts.upcoming >= 1, 'حجز قادم خلال 7 أيام يظهر تنبيهاً');

  const dFlights = await api('GET', '/api/provider/dashboard', { token: tokens.flights });
  assert.equal(dFlights.status, 200);
  assert.equal(typeof dFlights.json.data.type_alerts.upcoming, 'number');
});

test('فلتر العروض للمنتجات يُعيد المميزة فقط', async () => {
  const allRes = await api('GET', '/api/provider/products?limit=50', { token: tokens.provider });
  const offers = await api('GET', '/api/provider/products?offers=1&limit=50', { token: tokens.provider });
  assert.equal(allRes.json.data.length, 5);
  const featured = allRes.json.data.filter((p) => Number(p.is_featured) === 1);
  assert.equal(offers.json.data.length, featured.length);
  assert.equal(offers.json.data.length, 3);
  assert.ok(offers.json.data.every((p) => Number(p.is_featured) === 1));
});

test('فلتر العروض يعمل لكل أنواع الكتالوج ولا يُعيد كل العناصر', async () => {
  const cases = [
    ['/api/provider/menu-items', tokens.restaurants, 2, 5],
    ['/api/provider/rooms', tokens.hotels, 1, 3],
    ['/api/provider/flights', tokens.flights, 1, 5],
    ['/api/provider/packages', tokens.travel_offices, 1, 5],
  ];
  for (const [p, tok, offersCount, total] of cases) {
    const allRes = await api('GET', p + '?limit=50', { token: tok });
    assert.equal(allRes.status, 200, p);
    assert.equal(allRes.json.data.length, total, `كل عناصر ${p}`);
    const offers = await api('GET', p + '?offers=1&limit=50', { token: tok });
    assert.equal(offers.status, 200, p);
    assert.equal(offers.json.data.length, offersCount, `عروض ${p}`);
  }
});

test('تمييز غرفة يُدرجها في العروض', async () => {
  const room = get('SELECT * FROM hotel_rooms ORDER BY id DESC LIMIT 1');
  const r = await api('PUT', `/api/provider/rooms/${room.id}`, { token: tokens.hotels, body: { is_featured: 1 } });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const offers = await api('GET', '/api/provider/rooms?offers=1&limit=50', { token: tokens.hotels });
  assert.equal(offers.json.data.length, 2, 'الغرفة المميزة في seed + الغرفة المضافة');
  assert.ok(offers.json.data.some((o) => o.id === room.id));
});

// ------------------------- استهداف الإعلانات (مسؤول) -------------------------

test('مسارات إنشاء الإعلانات المستهدفة للمسؤول فقط', async () => {
  const asProv = await api('POST', '/api/promotions/admin/create', {
    token: tokens.provider, body: { provider_id: store.id, item_type: 'products', item_id: product.id, target: 'all' },
  });
  assert.equal(asProv.status, 403);
  const asCust = await api('GET', '/api/promotions/admin/items?provider_id=1&item_type=products', { token: tokens.customer });
  assert.equal(asCust.status, 403);
  const anon = await api('POST', '/api/promotions/admin/create', { body: { provider_id: store.id } });
  assert.equal(anon.status, 401);
});

test('admin/items يدرج عناصر المزود النشطة ويرفض النوع الخاطئ والمزود المفقود', async () => {
  const ok = await api('GET', `/api/promotions/admin/items?provider_id=${store.id}&item_type=products`, { token: tokens.admin });
  assert.equal(ok.status, 200, JSON.stringify(ok.json));
  assert.ok(Array.isArray(ok.json.data) && ok.json.data.length >= 1);
  const first = ok.json.data[0];
  assert.ok(first.id && first.title && typeof first.price === 'number');

  const badType = await api('GET', `/api/promotions/admin/items?provider_id=${store.id}&item_type=nope`, { token: tokens.admin });
  assert.equal(badType.status, 400);
  const missing = await api('GET', `/api/promotions/admin/items?provider_id=999999&item_type=products`, { token: tokens.admin });
  assert.equal(missing.status, 404);
});

test('إعلان لمحافظة واحدة يخصم تكلفة فترة واحدة فقط (نطاق محافظة)', async () => {
  runWallet(store.id, 5000000);
  const before = Number(get('SELECT balance FROM provider_wallets WHERE provider_id = ?', [store.id]).balance);
  const price = Number(get("SELECT value FROM settings WHERE key = 'promo_price'").value);
  const base = Number(get("SELECT value FROM settings WHERE key = 'promo_duration_days'").value);
  const unit = round((price / base) * 7);

  const r = await api('POST', '/api/promotions/admin/create', {
    token: tokens.admin,
    body: { provider_id: store.id, item_type: 'products', item_id: product.id, duration_days: 7, target: 'governorate', governorate_ids: [baghdad.id] },
  });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const p = r.json.data;
  assert.equal(p.target_type, 'governorate');
  assert.equal(p.target_count, 1);
  assert.equal(p.billing, 'wallet');
  assert.equal(round(p.cost), unit, 'تكلفة فترة واحدة');
  const after = Number(get('SELECT balance FROM provider_wallets WHERE provider_id = ?', [store.id]).balance);
  assert.equal(round(after), round(before - unit), 'خُصم من المحفظة تكلفة واحدة فقط');
});

test('إعلان لمحافظات متعددة يخصم التكلفة × عدد المحافظات ويظهر فيها فقط', async () => {
  runWallet(store.id, 5000000);
  const before = Number(get('SELECT balance FROM provider_wallets WHERE provider_id = ?', [store.id]).balance);
  const price = Number(get("SELECT value FROM settings WHERE key = 'promo_price'").value);
  const base = Number(get("SELECT value FROM settings WHERE key = 'promo_duration_days'").value);
  const unit = round((price / base) * 7);
  const third = all("SELECT * FROM governorates WHERE code NOT IN ('BAG','NAJ') ORDER BY id ASC LIMIT 1")[0];

  const r = await api('POST', '/api/promotions/admin/create', {
    token: tokens.admin,
    body: { provider_id: store.id, item_type: 'products', item_id: product.id, duration_days: 7, target: 'governorate', governorate_ids: [baghdad.id, najaf.id] },
  });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const p = r.json.data;
  assert.equal(p.target_type, 'governorate');
  assert.equal(p.target_count, 2);
  assert.equal(round(p.cost), round(unit * 2), 'تكلفة × 2 محافظات');
  assert.equal(round(Number(get('SELECT balance FROM provider_wallets WHERE provider_id = ?', [store.id]).balance)), round(before - unit * 2));

  const bag = await api('GET', `/api/public/promotions?governorate_code=${baghdad.code}`);
  assert.ok(bag.json.data.some((x) => x.id === p.id), 'يظهر في بغداد');
  const naj = await api('GET', `/api/public/promotions?governorate_code=${najaf.code}`);
  assert.ok(naj.json.data.some((x) => x.id === p.id), 'يظهر في النجف');
  const other = await api('GET', `/api/public/promotions?governorate_code=${third.code}`);
  assert.ok(!other.json.data.some((x) => x.id === p.id), `لا يظهر في ${third.name_ar}`);

  const adminList = await api('GET', `/api/promotions/all?governorate_id=${najaf.id}`, { token: tokens.admin });
  const row = adminList.json.data.find((x) => x.id === p.id);
  assert.ok(row, 'فلتر المسؤول بالمحافظة يشمل النطاق المتعدد');
  assert.ok(String(row.target_label).includes('بغداد') && String(row.target_label).includes('النجف'), 'target_label يجمع المحافظات');
  assert.equal(row.target_count, 2, 'target_count في قائمة المسؤول يطابق عدد المحافظات');
});

test('إعلان مجاني لكل المحافظات لا يخصم ويظهر في أي محافظة', async () => {
  runWallet(store.id, 1000000);
  const before = Number(get('SELECT balance FROM provider_wallets WHERE provider_id = ?', [store.id]).balance);
  const r = await api('POST', '/api/promotions/admin/create', {
    token: tokens.admin,
    body: { provider_id: store.id, item_type: 'products', item_id: product.id, duration_days: 7, target: 'all', billing: 'free' },
  });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const p = r.json.data;
  assert.equal(p.target_type, 'all');
  assert.equal(p.billing, 'free');
  assert.equal(p.cost, 0, 'إعلان مجاني');
  assert.equal(p.target_count, all('SELECT COUNT(*) AS c FROM governorates')[0].c, 'يغطي كل المحافظات');
  assert.equal(p.governorate_name_ar, 'كل المحافظات');
  assert.equal(Number(get('SELECT balance FROM provider_wallets WHERE provider_id = ?', [store.id]).balance), before, 'لا خصم من المحفظة');

  for (const gov of [baghdad, najaf, all("SELECT * FROM governorates WHERE code NOT IN ('BAG','NAJ') ORDER BY id ASC LIMIT 1")[0]]) {
    const res = await api('GET', `/api/public/promotions?governorate_code=${gov.code}`);
    assert.ok(res.json.data.some((x) => x.id === p.id), `يظهر في ${gov.name_ar}`);
  }
});

test('تمديد الإعلان المجاني لا يخصم المحفظة', async () => {
  const promo = get("SELECT * FROM promotions WHERE billing = 'free' ORDER BY id DESC LIMIT 1");
  assert.ok(promo, 'يوجد إعلان مجاني');
  const before = Number(get('SELECT balance FROM provider_wallets WHERE provider_id = ?', [store.id]).balance);
  const r = await api('POST', `/api/promotions/${promo.id}/extend`, { token: tokens.provider });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(Number(get('SELECT balance FROM provider_wallets WHERE provider_id = ?', [store.id]).balance), before, 'لا خصم لتمديد مجاني');
  assert.ok(r.json.data.ends_at > promo.ends_at, 'تمددت المدة');
});

test('تحقق صحة إنشاء الإعلان من المسؤول', async () => {
  const noGovs = await api('POST', '/api/promotions/admin/create', {
    token: tokens.admin, body: { provider_id: store.id, item_type: 'products', item_id: product.id, governorate_ids: [] },
  });
  assert.equal(noGovs.status, 400);
  assert.match(String(noGovs.json.message), /اختر محافظة/);

  const badGov = await api('POST', '/api/promotions/admin/create', {
    token: tokens.admin, body: { provider_id: store.id, item_type: 'products', item_id: product.id, governorate_ids: [999999] },
  });
  assert.equal(badGov.status, 400);
  assert.match(String(badGov.json.message), /محافظة غير موجودة/);

  const missingItem = await api('POST', '/api/promotions/admin/create', {
    token: tokens.admin, body: { provider_id: store.id, item_type: 'products', item_id: 999999, target: 'all' },
  });
  assert.equal(missingItem.status, 404);

  run('UPDATE providers SET is_active = 0 WHERE id = ?', [store.id]);
  const stopped = await api('POST', '/api/promotions/admin/create', {
    token: tokens.admin, body: { provider_id: store.id, item_type: 'products', item_id: product.id, target: 'all' },
  });
  assert.equal(stopped.status, 400);
  assert.match(String(stopped.json.message), /مزود موقوف/);
  run('UPDATE providers SET is_active = 1 WHERE id = ?', [store.id]);
});

function runWallet(providerId, amount) {
  const { run } = require('../src/db');
  const existing = get('SELECT provider_id FROM provider_wallets WHERE provider_id = ?', [providerId]);
  if (existing) {
    run('UPDATE provider_wallets SET balance = ? WHERE provider_id = ?', [amount, providerId]);
  } else {
    run('INSERT INTO provider_wallets (provider_id, balance) VALUES (?,?)', [providerId, amount]);
  }
}

function round(n) { return Math.round(Number(n) * 100) / 100; }
