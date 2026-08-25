const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

process.env.NODE_ENV = 'test';
process.env.DB_PATH = path.join(os.tmpdir(), `rafidain-test-${process.pid}-${crypto.randomUUID()}.db`);
process.env.JWT_SECRET = 'integration-test-secret';
process.env.RATE_LIMIT_MAX = '100000';
delete process.env.TRUST_PROXY;

// مفاتيح VAPID مستقلة للاختبار (لا تُكتب في data/)
const { generateVAPIDKeys } = require('web-push');
const _testVapid = generateVAPIDKeys();
process.env.VAPID_PUBLIC_KEY = _testVapid.publicKey;
process.env.VAPID_PRIVATE_KEY = _testVapid.privateKey;

require('../src/db/seed');

const app = require('../src/app');
const { get, all, run, close } = require('../src/db');
const { hashPassword } = require('../src/utils/password');

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
let store, product, flight, najaf, customerUser, airProvider;

test.before(async () => {
  tokens.admin = await login('admin@rafidain.iq', 'Admin@123');
  tokens.agent = await login('agent.baghdad@rafidain.iq', 'Agent@123');
  tokens.provider = await login('provider.demo@rafidain.iq', 'Provider@123');
  tokens.customer = await login('customer.demo@rafidain.iq', 'Customer@123');

  store = get('SELECT * FROM providers WHERE name_ar = ?', ['متجر الرافدين للتجارة']);
  product = get('SELECT * FROM products WHERE provider_id = ? ORDER BY id ASC LIMIT 1', [store.id]);
  najaf = get('SELECT * FROM governorates WHERE code = ?', ['NAJ']);
  customerUser = get('SELECT * FROM users WHERE email = ?', ['customer.demo@rafidain.iq']);

  const flightsSvc = get('SELECT * FROM services WHERE slug = ?', ['flights']);
  airProvider = get('SELECT * FROM providers WHERE service_id = ?', [flightsSvc.id]);
  if (!airProvider) {
    const u = run(
      'INSERT INTO users (role, name_ar, email, password_hash, governorate_id, service_type, is_active) VALUES (?,?,?,?,?,?,1)',
      ['provider', 'شركة طيران اختبار', 'air.test@rafidain.iq', await hashPassword('Air@123'), store.governorate_id, 'flights']
    ).lastId;
    const pid = run(
      'INSERT INTO providers (user_id, governorate_id, service_id, name_ar, commission_rate, is_active, is_verified) VALUES (?,?,?,?,?,1,1)',
      [u, store.governorate_id, flightsSvc.id, 'شركة طيران اختبار', 5]
    ).lastId;
    airProvider = get('SELECT * FROM providers WHERE id = ?', [pid]);
  }
  const t = new Date(Date.now() + 7 * 86400000).toISOString();
  const fid = run(
    'INSERT INTO flights (provider_id, flight_number, airline, origin, origin_ar, destination, destination_ar, departure_at, arrival_at, price, seats, is_active) VALUES (?,?,?,?,?,?,?,?,?,?,?,1)',
    [airProvider.id, 'IA999', 'اختبار', 'BGW', 'بغداد', 'ERB', 'أربيل', t, t, 90000, 120]
  ).lastId;
  flight = get('SELECT * FROM flights WHERE id = ?', [fid]);
});

test.after(() => {
  server.close();
  close();
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(process.env.DB_PATH + suffix); } catch (e) { /* تجاهل */ }
  }
});

// ------------------------- البنية الأساسية -------------------------
test('GET /api/health يرجع حالة طبيعية مع فحص قاعدة البيانات', async () => {
  const r = await api('GET', '/api/health');
  assert.equal(r.status, 200);
  assert.equal(r.json.status, 'ok');
  assert.equal(r.json.db, 'ok');
});

test('مسار /api/auth/test-password حُذف', async () => {
  const r = await api('GET', '/api/auth/test-password');
  assert.equal(r.status, 404);
});

test('كلمة مرور خاطئة ترفض', async () => {
  const r = await api('POST', '/api/auth/login', { body: { email: 'admin@rafidain.iq', password: 'wrong' } });
  assert.equal(r.status, 401);
});

// ------------------------- الصلاحيات (RBAC) -------------------------
test('الزبون لا يستطيع إنشاء مزود خدمة', async () => {
  const r = await api('POST', '/api/providers', {
    token: tokens.customer,
    body: { name_ar: 'مخترق', email: 'hack@x.iq', service_id: store.service_id, governorate_id: store.governorate_id },
  });
  assert.equal(r.status, 403);
});

test('المزود لا يستطيع تعديل نسب العمولة', async () => {
  const r = await api('PUT', '/api/commissions', { token: tokens.provider, body: { platform_commission_default: 1 } });
  assert.equal(r.status, 403);
});

test('نسب عمولة خارج 0-100 ترفض للمسؤول', async () => {
  for (const bad of [150, -5]) {
    const r = await api('PUT', '/api/commissions', { token: tokens.admin, body: { platform_commission_default: bad } });
    assert.equal(r.status, 400, `نسبة ${bad}`);
  }
  const ok = await api('PUT', '/api/commissions', { token: tokens.admin, body: { platform_commission_default: 5 } });
  assert.equal(ok.status, 200);
});

test('المزود لا يستطيع إنشاء طلب لمزود آخر', async () => {
  const r = await api('POST', '/api/orders', {
    token: tokens.provider,
    body: {
      provider_id: airProvider.id,
      customer_name: 'عميل تجريبي',
      items: [{ title: 'بند', quantity: 1, unit_price: 10000 }],
    },
  });
  assert.equal(r.status, 403, JSON.stringify(r.json));
});

test('لوحة المزود تعرض صافي الإيراد في آخر الطلبات', async () => {
  const created = await api('POST', '/api/orders', {
    token: tokens.customer,
    body: {
      provider_id: store.id,
      items: [{ kind: 'products', item_id: product.id, quantity: 1 }],
    },
  });
  assert.equal(created.status, 201, JSON.stringify(created.json));
  try {
    const r = await api('GET', '/api/provider/dashboard', { token: tokens.provider });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    const recent = r.json.data.recent_orders || [];
    const found = recent.find((o) => o.id === created.json.data.id);
    assert.ok(found, 'الطلب الجديد يظهر في آخر الطلبات');
    assert.equal(found.provider_amount, created.json.data.provider_amount, 'عمود صافي الإيراد معبأ وليس 0');
    assert.equal(found.commission_amount, created.json.data.commission_amount);
  } finally {
    // إلغاء الطلب لإعادة المخزون حتى لا تتأثر اختبارات المخزون اللاحقة
    await api('PUT', `/api/orders/${created.json.data.id}/status`, { token: tokens.admin, body: { status: 'cancelled' } });
  }
});

// ------------------------- نموذج العمل: وسيط + عمولة -------------------------
test('الزبون يرى عمولة المنصة حسب نسبة مزود الخدمة فقط', async () => {
  const price = product.price;
  const qty = 2;
  const r = await api('POST', '/api/orders', {
    token: tokens.customer,
    body: {
      provider_id: store.id,
      items: [{ kind: 'products', item_id: product.id, quantity: qty }],
      customer_address: 'بغداد - الكرادة',
    },
  });
  assert.equal(r.status, 201, JSON.stringify(r.json));
  assert.equal(r.json.data.total_amount, round(price * qty));
  assert.equal(r.json.data.commission_amount, round(price * qty * 5 / 100));
  assert.equal(r.json.data.agent_amount, round(price * qty * 2 / 100));
  assert.equal(r.json.data.platform_amount, round(price * qty * 3 / 100));
  assert.equal(r.json.data.provider_amount, round(price * qty * 95 / 100));
  assert.equal(r.json.data.status, 'pending');

  // خصم المخزون
  const after = get('SELECT stock FROM products WHERE id = ?', [product.id]).stock;
  assert.equal(after, product.stock - qty);
});

test('إلغاء الطلب يعيد المخزون', async () => {
  const created = await api('POST', '/api/orders', {
    token: tokens.customer,
    body: { provider_id: store.id, items: [{ kind: 'products', item_id: product.id, quantity: 1 }] },
  });
  assert.equal(created.status, 201);
  const before = get('SELECT stock FROM products WHERE id = ?', [product.id]).stock;
  const r = await api('PUT', `/api/orders/${created.json.data.id}/status`, {
    token: tokens.admin,
    body: { status: 'cancelled' },
  });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const after = get('SELECT stock FROM products WHERE id = ?', [product.id]).stock;
  assert.equal(after, before + 1);
});

test('حجز مقاعد الطيران يُخصم ويُستعاد عند الإلغاء', async () => {
  const created = await api('POST', '/api/orders', {
    token: tokens.customer,
    body: {
      provider_id: flight.provider_id,
      items: [{ kind: 'flights', item_id: flight.id, quantity: 3 }],
      booking: { type: 'flights', travel_date: new Date(Date.now() + 86400000).toISOString().slice(0, 10) },
    },
  });
  assert.equal(created.status, 201, JSON.stringify(created.json));
  assert.equal(get('SELECT seats FROM flights WHERE id = ?', [flight.id]).seats, flight.seats - 3);
  const r = await api('PUT', `/api/orders/${created.json.data.id}/status`, { token: tokens.admin, body: { status: 'cancelled' } });
  assert.equal(r.status, 200);
  assert.equal(get('SELECT seats FROM flights WHERE id = ?', [flight.id]).seats, flight.seats);
});

// ------------------------- سلامة الطلبات -------------------------
test('الزبون لا يحدد customer_id بنفسه', async () => {
  const r = await api('POST', '/api/orders', {
    token: tokens.customer,
    body: {
      provider_id: store.id,
      customer_id: 1,
      items: [{ kind: 'products', item_id: product.id, quantity: 1 }],
    },
  });
  assert.equal(r.status, 201);
  const detail = await api('GET', `/api/orders/${r.json.data.id}`, { token: tokens.admin });
  assert.equal(detail.json.data.customer_id, customerUser.id);
});

test('الزبون لا يرسل بنوداً حرة بسعر من جانبه', async () => {
  const r = await api('POST', '/api/orders', {
    token: tokens.customer,
    body: {
      provider_id: store.id,
      items: [{ title: 'منتج مزيف', unit_price: 10, quantity: 5 }],
    },
  });
  assert.equal(r.status, 400);
});

test('عنصر غير موجود في كتالوج المزود يرفض', async () => {
  const r = await api('POST', '/api/orders', {
    token: tokens.customer,
    body: { provider_id: store.id, items: [{ kind: 'products', item_id: 999999, quantity: 1 }] },
  });
  assert.equal(r.status, 400);
});

test('كمية تتجاوز المخزون ترفض دون خصم جزئي', async () => {
  const before = get('SELECT stock FROM products WHERE id = ?', [product.id]).stock;
  const r = await api('POST', '/api/orders', {
    token: tokens.customer,
    body: { provider_id: store.id, items: [{ kind: 'products', item_id: product.id, quantity: 99999 }] },
  });
  assert.equal(r.status, 400);
  assert.equal(get('SELECT stock FROM products WHERE id = ?', [product.id]).stock, before);
});

test('كمية صفرية أو سالبة ترفض', async () => {
  for (const q of [0, -3]) {
    const r = await api('POST', '/api/orders', {
      token: tokens.customer,
      body: { provider_id: store.id, items: [{ kind: 'products', item_id: product.id, quantity: q }] },
    });
    assert.equal(r.status, 400, `كمية ${q}`);
  }
});

test('المكتب الخلفي يستطيع إنشاء بنود حرة لكن السعر السالب يرفض', async () => {
  const ok = await api('POST', '/api/orders', {
    token: tokens.admin,
    body: {
      provider_id: store.id,
      customer_id: customerUser.id,
      items: [{ title: 'خدمة خاصة', unit_price: 5000, quantity: 3 }],
    },
  });
  assert.equal(ok.status, 201, JSON.stringify(ok.json));
  assert.equal(ok.json.data.total_amount, 15000);

  const bad = await api('POST', '/api/orders', {
    token: tokens.admin,
    body: {
      provider_id: store.id,
      customer_id: customerUser.id,
      items: [{ title: 'خدمة سالبة', unit_price: -500, quantity: 1 }],
    },
  });
  assert.equal(bad.status, 400);
});

// ------------------------- نطاق البيانات -------------------------
test('الوكيل لا يرى مزودين خارج محافظته ولا يعدّلهم', async () => {
  const created = await api('POST', '/api/providers', {
    token: tokens.admin,
    body: {
      name_ar: 'متجر النجف',
      name_en: 'Najaf Store',
      email: 'najaf.store@test.iq',
      service_id: store.service_id,
      governorate_id: najaf.id,
      commission_rate: 5,
    },
  });
  assert.equal(created.status, 201, JSON.stringify(created.json));

  const list = await api('GET', '/api/providers?governorate_id=' + najaf.id, { token: tokens.agent });
  const ids = (list.json.data || []).map((p) => p.id);
  assert.ok(!ids.includes(created.json.data.id), 'وكيل بغداد لا يرى مزود النجف');

  const put = await api('PUT', `/api/providers/${created.json.data.id}`, { token: tokens.agent, body: { name_ar: 'تعديل محظور' } });
  assert.equal(put.status, 403);
});

test('الوكيل لا ينشئ طلباً لمزود خارج محافظته', async () => {
  const created = await api('POST', '/api/providers', {
    token: tokens.admin,
    body: {
      name_ar: 'متجر نجف للإنشاء',
      email: 'najaf.create@test.iq',
      service_id: store.service_id,
      governorate_id: najaf.id,
      commission_rate: 5,
    },
  });
  assert.equal(created.status, 201, JSON.stringify(created.json));

  const r = await api('POST', '/api/orders', {
    token: tokens.agent,
    body: {
      provider_id: created.json.data.id,
      customer_name: 'زبون تجريبي',
      items: [{ title: 'بند', unit_price: 1000, quantity: 1 }],
    },
  });
  assert.equal(r.status, 403, 'وكيل بغداد لا ينشئ طلباً لمزود في النجف');
});

test('الوكيل ينشئ طلباً في محافظته بزبون حرّ', async () => {
  const r = await api('POST', '/api/orders', {
    token: tokens.agent,
    body: {
      provider_id: store.id,
      customer_name: 'زبون عابر',
      customer_phone: '0799999999',
      items: [{ title: 'حقيبة', unit_price: 2000, quantity: 2 }],
    },
  });
  assert.equal(r.status, 201, JSON.stringify(r.json));
  assert.equal(r.json.data.total_amount, 4000);
  const detail = await api('GET', `/api/orders/${r.json.data.id}`, { token: tokens.agent });
  assert.equal(detail.status, 200);
  assert.equal(detail.json.data.customer_name, 'زبون عابر');
  assert.equal(detail.json.data.customer_phone, '0799999999');
});

test('المزود يرى طلباته فقط', async () => {
  const list = await api('GET', '/api/orders', { token: tokens.provider });
  assert.equal(list.status, 200);
  assert.ok(list.json.data.length > 0);
  assert.ok(list.json.data.every((o) => o.provider_id === store.id));
});

// ------------------------- التقييمات -------------------------
test('التقييم متاح فقط بعد إتمام الطلب ويحدّث معدل المزود', async () => {
  const created = await api('POST', '/api/orders', {
    token: tokens.customer,
    body: { provider_id: store.id, items: [{ kind: 'products', item_id: product.id, quantity: 1 }] },
  });
  assert.equal(created.status, 201);
  const id = created.json.data.id;

  await api('POST', `/api/wallets/${store.id}/recharge`, { token: tokens.admin, body: { amount: 1000000, note: 'شحن لاختبار سير الطلب' } });

  const before = await api('GET', `/api/customer/rate/${store.id}`, { token: tokens.customer });
  assert.equal(before.json.data.my_rating, 0);

  const denied = await api('POST', `/api/customer/rate/${store.id}`, { token: tokens.customer, body: { rating: 5, comment: 'رائع' } });
  assert.equal(denied.status, 403, 'لا يمكن التقييم قبل إتمام الطلب');

  for (const s of ['confirmed', 'in_progress', 'completed']) {
    const r = await api('PUT', `/api/orders/${id}/status`, { token: tokens.provider, body: { status: s } });
    assert.equal(r.status, 200, `الانتقال إلى ${s}`);
  }

  const bad = await api('POST', `/api/customer/rate/${store.id}`, { token: tokens.customer, body: { rating: 9 } });
  assert.equal(bad.status, 400, 'تقييم خارج 1-5 يرفض');

  const rated = await api('POST', `/api/customer/rate/${store.id}`, { token: tokens.customer, body: { rating: 5, comment: 'ممتاز' } });
  assert.equal(rated.status, 200, JSON.stringify(rated.json));
  assert.equal(rated.json.data.rating, 5);
  assert.equal(rated.json.data.rating_count, 1);

  const updated = await api('POST', `/api/customer/rate/${store.id}`, { token: tokens.customer, body: { rating: 3 } });
  assert.equal(updated.status, 200);
  assert.equal(updated.json.data.rating, 3);
  assert.equal(updated.json.data.rating_count, 1);

  const mine = await api('GET', `/api/customer/rate/${store.id}`, { token: tokens.customer });
  assert.equal(mine.json.data.my_rating, 3);
});

// ------------------------- الدفعة الأمنية الأولى (B1/B2/B3) -------------------------
test('B1: الوكيل لا يعيد تعيين كلمة مرور حساب خارج محافظته', async () => {
  const najafProvider = await api('POST', '/api/providers', {
    token: tokens.admin,
    body: { name_ar: 'متجر نجف لكلمة المرور', email: 'najaf.pw@test.iq', service_id: store.service_id, governorate_id: najaf.id, commission_rate: 5 },
  });
  assert.equal(najafProvider.status, 201, JSON.stringify(najafProvider.json));
  const najafUserId = najafProvider.json.data.user_id;

  const outside = await api('POST', '/api/auth/reset-password', {
    token: tokens.agent,
    body: { user_id: najafUserId, new_password: 'NewPass@123' },
  });
  assert.equal(outside.status, 403, 'وكيل بغداد لا يغيّر كلمة مرور مزود في النجف');

  const otherAgent = get('SELECT * FROM users WHERE email = ?', ['agent.baghdad@rafidain.iq']);
  const agentReset = await api('POST', '/api/auth/reset-password', {
    token: tokens.agent,
    body: { user_id: otherAgent.id, new_password: 'NewPass@123' },
  });
  assert.equal(agentReset.status, 403, 'الوكيل لا يغيّر كلمة مرور وكيل آخر');

  const storeUser = get('SELECT * FROM users WHERE email = ?', ['provider.demo@rafidain.iq']);
  const inside = await api('POST', '/api/auth/reset-password', {
    token: tokens.agent,
    body: { user_id: storeUser.id, new_password: 'TempPass@123' },
  });
  assert.equal(inside.status, 200, 'وكيل بغداد يعيد تعيين كلمة مرور مزود في محافظته');
  await api('POST', '/api/auth/reset-password', {
    token: tokens.admin,
    body: { user_id: storeUser.id, new_password: 'Provider@123' },
  });
  // إعادة التعيين تُبطل جلسات الحساب الحالية — نعيد تسجيل الدخول للمزوّد لبقية الاختبارات
  tokens.provider = await login('provider.demo@rafidain.iq', 'Provider@123');
});

test('B2: الوكيل معلق الإجارة ممنوع من إنشاء الطلبات وتغيير الحالة وإعادة تعيين كلمات المرور', async () => {
  const created = await api('POST', '/api/agents', {
    token: tokens.admin,
    body: { name_ar: 'وكيل النجف', email: 'agent.najaf@test.iq', password: 'AgentNajaf@123', governorate_id: najaf.id },
  });
  assert.equal(created.status, 201, JSON.stringify(created.json));

  const poorToken = await login('agent.najaf@test.iq', 'AgentNajaf@123');

  const order = await api('POST', '/api/orders', {
    token: poorToken,
    body: { provider_id: store.id, customer_name: 'x', items: [{ title: 'بند', unit_price: 100, quantity: 1 }] },
  });
  assert.equal(order.status, 403, JSON.stringify(order.json));
  assert.match(order.json.message, /إجارة/, 'الرفض بسبب الإجارة لا نطاق المحافظة');

  const anyOrder = get('SELECT id FROM orders ORDER BY id DESC LIMIT 1');
  const status = await api('PUT', `/api/orders/${anyOrder.id}/status`, { token: poorToken, body: { status: 'cancelled' } });
  assert.equal(status.status, 403);

  const storeUser = get('SELECT * FROM users WHERE email = ?', ['provider.demo@rafidain.iq']);
  const reset = await api('POST', '/api/auth/reset-password', { token: poorToken, body: { user_id: storeUser.id, new_password: 'Xxx@12345' } });
  assert.equal(reset.status, 403);
});

test('B3: إلغاء متزامن يعيد المخزون مرة واحدة والطلب الملغي نهائي', async () => {
  const created = await api('POST', '/api/orders', {
    token: tokens.customer,
    body: { provider_id: store.id, items: [{ kind: 'products', item_id: product.id, quantity: 1 }] },
  });
  assert.equal(created.status, 201);
  const id = created.json.data.id;
  const before = get('SELECT stock FROM products WHERE id = ?', [product.id]).stock;

  const results = await Promise.all(
    [0, 1, 2, 3, 4].map(() => api('PUT', `/api/orders/${id}/status`, { token: tokens.admin, body: { status: 'cancelled' } }))
  );
  const successes = results.filter((r) => r.status === 200).length;
  assert.equal(successes, 1, 'إلغاء واحد فقط ينجح: ' + JSON.stringify(results.map((r) => r.status)));
  const after = get('SELECT stock FROM products WHERE id = ?', [product.id]).stock;
  assert.equal(after, before + 1, 'المخزون يُعاد مرة واحدة فقط');

  const again = await api('PUT', `/api/orders/${id}/status`, { token: tokens.admin, body: { status: 'cancelled' } });
  assert.equal(again.status, 400, 'الطلب الملغي نهائي');
});

// ------------------------- الدفعة الثانية (B4–B10) -------------------------
test('B4: لا يُسمح بحجز غرفة بفترة تتداخل مع حجز سابق', async () => {
  const hotelsSvc = get('SELECT * FROM services WHERE slug = ?', ['hotels']);
  const hotel = await api('POST', '/api/providers', {
    token: tokens.admin,
    body: { name_ar: 'فندق اختبار', email: 'hotel.test@test.iq', service_id: hotelsSvc.id, governorate_id: store.governorate_id, commission_rate: 5 },
  });
  assert.equal(hotel.status, 201, JSON.stringify(hotel.json));
  const roomId = run(
    'INSERT INTO hotel_rooms (provider_id, name_ar, price_per_night, room_type, max_guests, is_active) VALUES (?,?,?,?,?,1)',
    [hotel.json.data.id, 'غرفة مزدوجة', 25000, 'double', 2]
  ).lastId;

  const mk = (check_in, check_out) => api('POST', '/api/orders', {
    token: tokens.customer,
    body: {
      provider_id: hotel.json.data.id,
      items: [{ kind: 'rooms', item_id: roomId, quantity: 2 }],
      booking: { type: 'hotels', check_in, check_out, guests: 2 },
    },
  });

  const first = await mk('2026-09-01', '2026-09-03');
  assert.equal(first.status, 201, JSON.stringify(first.json));

  const clash = await mk('2026-09-02', '2026-09-04');
  assert.equal(clash.status, 409, 'تداخل مباشر مرفوض: ' + JSON.stringify(clash.json));

  const touching = await mk('2026-09-03', '2026-09-05');
  assert.equal(touching.status, 201, 'فترة ملامسة [1,3) و[3,5) لا تتداخل: ' + JSON.stringify(touching.json));

  const noDates = await mk(undefined, undefined);
  assert.equal(noDates.status, 400, 'حجز بلا تواريخ مرفوض');
});

test('B4b: تواريخ حجز تالفة أو معكوسة تُرفض رقماً لا نصاً', async () => {
  const hotelsSvc = get('SELECT * FROM services WHERE slug = ?', ['hotels']);
  const hotel = get('SELECT * FROM providers WHERE service_id = ? ORDER BY id DESC LIMIT 1', [hotelsSvc.id]);
  const roomId = get('SELECT * FROM hotel_rooms WHERE provider_id = ? ORDER BY id ASC LIMIT 1', [hotel.id]).id;

  const mk = (booking) => api('POST', '/api/orders', {
    token: tokens.customer,
    body: {
      provider_id: hotel.id,
      items: [{ kind: 'rooms', item_id: roomId, quantity: 1 }],
      booking,
    },
  });

  const garbage = await mk({ type: 'hotels', check_in: '2026-09-01', check_out: 'not-a-date', guests: 2 });
  assert.equal(garbage.status, 400, 'تاريخ مغادرة تالف مرفوض: ' + JSON.stringify(garbage.json));
  assert.match(garbage.json.message, /غير صالح/);

  const reversed = await mk({ type: 'hotels', check_in: '2026-09-05', check_out: '2026-09-01', guests: 2 });
  assert.equal(reversed.status, 400, 'مغادرة قبل الوصول مرفوضة');
  assert.match(reversed.json.message, /بعد تاريخ الوصول/);
});

test('B5: حذف الوكيل يحفظ سجل دفعات إجارته (تعطيل ناعم)', async () => {
  const basra = get('SELECT * FROM governorates WHERE code = ?', ['BAS']);
  const created = await api('POST', '/api/agents', {
    token: tokens.admin,
    body: { name_ar: 'وكيل البصرة', email: 'agent.basra@test.iq', password: 'Basra@123', governorate_id: basra.id },
  });
  assert.equal(created.status, 201, JSON.stringify(created.json));
  const agentId = created.json.data.id;
  const userId = created.json.data.user_id;
  run(
    'INSERT INTO lease_payments (agent_id, governorate_id, amount, period_start, period_end, status) VALUES (?,?,?,?,?,?)',
    [agentId, basra.id, 3000000, '2026-01-01', '2027-01-01', 'paid']
  );

  const del = await api('DELETE', `/api/agents/${agentId}`, { token: tokens.admin });
  assert.equal(del.status, 200, JSON.stringify(del.json));

  const user = get('SELECT * FROM users WHERE id = ?', [userId]);
  assert.equal(user.is_active, 0, 'الحساب موقوف');
  const payments = get('SELECT COUNT(*) AS c FROM lease_payments WHERE agent_id = ?', [agentId]).c;
  assert.equal(payments, 1, 'سجل دفعات الإجارة محفوظ بعد الحذف');
});

test('B6: طلب JSON غير صالح يعود 400 بدل 500', async () => {
  const res = await fetch(base + '/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{bad json',
  });
  assert.equal(res.status, 400);
});

test('B7: randomPassword ينتج طولاً مضبوطاً من مجموعة الرموز فقط', () => {
  const { randomPassword } = require('../src/utils/password');
  const allowed = new Set('abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789!@#$%');
  for (let i = 0; i < 200; i++) {
    const pw = randomPassword(10);
    assert.equal(pw.length, 10);
    assert.ok([...pw].every((c) => allowed.has(c)), 'رمز خارج المجموعة: ' + pw);
  }
});

test('B8: فلتر التصدير بالتاريخ يستخدم حدوداً محلية صحيحة', async () => {
  const created = await api('POST', '/api/orders', {
    token: tokens.customer,
    body: { provider_id: store.id, items: [{ kind: 'products', item_id: product.id, quantity: 1 }] } });
  assert.equal(created.status, 201);
  const num = created.json.data.order_number;
  const pad = (n) => String(n).padStart(2, '0');
  const fmt = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const now = new Date();
  const yesterday = new Date(now.getTime() - 86400000);

  const auth = { Authorization: `Bearer ${tokens.admin}` };
  const inRange = await fetch(`${base}/api/orders/export?from=${fmt(yesterday)}&to=${fmt(now)}`, { headers: auth });
  assert.equal(inRange.status, 200);
  assert.ok((await inRange.text()).includes(num), 'الطلب ضمن النطاق المحلي');

  const tomorrow = new Date(now.getTime() + 86400000);
  const outOfRange = await fetch(`${base}/api/orders/export?from=${fmt(tomorrow)}&to=${fmt(tomorrow)}`, { headers: auth });
  assert.equal(outOfRange.status, 200);
  assert.ok(!(await outOfRange.text()).includes(num), 'الطلب خارج نطاق الغد');
});

test('B9: مفتاح Idempotency يمنع إنشاء طلب مزدوج', async () => {
  const body = { provider_id: store.id, customer_id: customerUser.id, items: [{ title: 'بند', unit_price: 1000, quantity: 1 }] };
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${tokens.admin}` };
  const key = `ord-${Date.now()}`;

  const r1 = await fetch(base + '/api/orders', { method: 'POST', headers: { ...headers, 'Idempotency-Key': key }, body: JSON.stringify(body) });
  const j1 = await r1.json();
  assert.equal(r1.status, 201, JSON.stringify(j1));
  const orderNumber = j1.data.order_number;

  const r2 = await fetch(base + '/api/orders', { method: 'POST', headers: { ...headers, 'Idempotency-Key': key }, body: JSON.stringify(body) });
  const j2 = await r2.json();
  assert.equal(r2.status, 200, JSON.stringify(j2));
  assert.equal(j2.data.order_number, orderNumber, 'إعادة المفتاح تُعيد نفس الطلب');

  const count = get('SELECT COUNT(*) AS c FROM orders WHERE order_number = ?', [orderNumber]).c;
  assert.equal(count, 1, 'لم يُنشأ طلب ثانٍ');
});

test('B10: إنشاء طلب بلا بنود يرفض للمكتب الخلفي', async () => {
  const r1 = await api('POST', '/api/orders', {
    token: tokens.admin,
    body: { provider_id: store.id, customer_id: customerUser.id },
  });
  assert.equal(r1.status, 400, JSON.stringify(r1.json));

  const r2 = await api('POST', '/api/orders', {
    token: tokens.agent,
    body: { provider_id: store.id, customer_name: 'x', items: [] },
  });
  assert.equal(r2.status, 400, JSON.stringify(r2.json));
});

// ------------------------- الدفعة الثالثة (البيانات) -------------------------
test('هجرة 004: الفهارس المفقودة أُنشئت', () => {
  const names = all("SELECT name FROM sqlite_master WHERE type='index'").map((r) => r.name);
  for (const idx of [
    'idx_bookings_order', 'idx_bookings_provider', 'idx_bookings_dates',
    'idx_orders_gov_status', 'idx_orders_created', 'idx_lease_payments_agent', 'idx_activity_log_user',
  ]) {
    assert.ok(names.includes(idx), 'فهرس مفقود: ' + idx);
  }
});

test('فلتر تاريخ قائمة الطلبات يستخدم حدوداً محلية صحيحة (إزاحة UTC)', async () => {
  const created = await api('POST', '/api/orders', {
    token: tokens.customer,
    body: { provider_id: store.id, items: [{ kind: 'products', item_id: product.id, quantity: 1 }] } });
  assert.equal(created.status, 201);
  const num = created.json.data.order_number;
  const pad = (n) => String(n).padStart(2, '0');
  const fmt = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const now = new Date();
  const yesterday = new Date(now.getTime() - 86400000);
  const tomorrow = new Date(now.getTime() + 86400000);

  const inRange = await api('GET', `/api/orders?from=${fmt(yesterday)}&to=${fmt(now)}`, { token: tokens.admin });
  assert.equal(inRange.status, 200);
  assert.ok((inRange.json.data || []).some((o) => o.order_number === num), 'الطلب ضمن النطاق المحلي');

  const outRange = await api('GET', `/api/orders?from=${fmt(tomorrow)}&to=${fmt(tomorrow)}`, { token: tokens.admin });
  assert.equal(outRange.status, 200);
  assert.ok(!(outRange.json.data || []).some((o) => o.order_number === num), 'الطلب خارج نطاق الغد');
});

test('قائمة الإيجارات مقيدة بالترقيم', async () => {
  const kar = get('SELECT * FROM governorates WHERE code = ?', ['KAR']);
  const agent = await api('POST', '/api/agents', {
    token: tokens.admin,
    body: { name_ar: 'وكيل ترقيم', email: 'agent.paged@test.iq', password: 'Paged@123', governorate_id: kar.id },
  });
  assert.equal(agent.status, 201, JSON.stringify(agent.json));
  const agentId = agent.json.data.id;
  for (let i = 0; i < 3; i++) {
    run('INSERT INTO lease_payments (agent_id, governorate_id, amount, period_start, period_end, status) VALUES (?,?,?,?,?,?)',
      [agentId, kar.id, 1000000, '2026-01-01', '2027-01-01', 'paid']);
  }

  const r = await api('GET', '/api/leases?page=1&limit=2', { token: tokens.admin });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.data.length, 2);
  assert.equal(r.json.meta.limit, 2);
  assert.ok(r.json.meta.total >= 3, 'إجمالي السجلات محسوب');
  assert.ok(r.json.meta.pages >= 2, 'عدد الصفحات محسوب');
});

test('المسؤول يتحكم بتجديد الوكالات: إنشاء يدوي، تعديل التواريخ، وإلغاء الإجارة', async () => {
  const nin = get('SELECT * FROM governorates WHERE code = ?', ['NIN']);
  const agent = await api('POST', '/api/agents', {
    token: tokens.admin,
    body: { name_ar: 'وكيل إدارة الإجارة', email: 'agent.leaseadm@test.iq', password: 'Lease@123', governorate_id: nin.id },
  });
  assert.equal(agent.status, 201, JSON.stringify(agent.json));
  const agentId = agent.json.data.id;

  const forbidden = await api('POST', '/api/leases', {
    token: tokens.provider,
    body: { agent_id: agentId, period_start: '2026-01-01', period_end: '2027-01-01', amount: 1000 },
  });
  assert.equal(forbidden.status, 403, 'غير المسؤول لا ينشئ دفعات');

  const created = await api('POST', '/api/leases', {
    token: tokens.admin,
    body: { agent_id: agentId, period_start: '2026-01-01', period_end: '2027-01-01', amount: 2500000, status: 'paid' },
  });
  assert.equal(created.status, 200, JSON.stringify(created.json));
  assert.equal(created.json.data.status, 'paid');
  const a1 = get('SELECT * FROM agents WHERE id = ?', [agentId]);
  assert.equal(a1.lease_status, 'active', 'الدفعة المدفوعة تفعّل الوكيل فوراً');
  assert.equal(a1.lease_expires_at, new Date('2027-01-01').toISOString(), 'تاريخ انتهاء الوكيل يوافق نهاية الفترة');

  const edited = await api('PUT', `/api/leases/${created.json.data.id}`, {
    token: tokens.admin,
    body: { period_end: '2027-06-01', amount: 3000000 },
  });
  assert.equal(edited.status, 200, JSON.stringify(edited.json));
  const a2 = get('SELECT * FROM agents WHERE id = ?', [agentId]);
  assert.equal(a2.lease_expires_at, new Date('2027-06-01').toISOString(), 'تعديل النهاية يزامن إجارة الوكيل');
  assert.equal(a2.lease_status, 'active');

  const bad = await api('PUT', `/api/leases/${created.json.data.id}`, {
    token: tokens.admin,
    body: { period_start: '2026-07-01', period_end: '2026-06-01' },
  });
  assert.equal(bad.status, 400, 'نهاية قبل البداية مرفوضة');

  const cancelled = await api('POST', `/api/leases/${created.json.data.id}/cancel`, {
    token: tokens.admin,
    body: { reason: 'اختبار' },
  });
  assert.equal(cancelled.status, 200, JSON.stringify(cancelled.json));
  assert.equal(cancelled.json.data.status, 'refunded');
  const a3 = get('SELECT * FROM agents WHERE id = ?', [agentId]);
  assert.equal(a3.lease_status, 'expired', 'إلغاء الإجارة يُبطل الوكالة');
  assert.equal(a3.lease_expires_at, null, 'لا تاريخ انتهاء لإجارة ملغاة');

  const again = await api('POST', `/api/leases/${created.json.data.id}/cancel`, { token: tokens.admin });
  assert.equal(again.status, 400, 'الدفعة الملغاة لا تُلغى مرة أخرى');
});

test('تعديل وكيل بهاتف فارغ لا يفشل ويحدّث نسبة العمولة (انحدار phone=^\'\'^)', async () => {
  const duh = get('SELECT * FROM governorates WHERE code = ?', ['DUH']);
  const agent = await api('POST', '/api/agents', {
    token: tokens.admin,
    body: { name_ar: 'وكيل تعديل العمولة', email: 'agent.comm@test.iq', password: 'Comm@123', governorate_id: duh.id },
  });
  assert.equal(agent.status, 201, JSON.stringify(agent.json));
  const agentId = agent.json.data.id;

  const edited = await api('PUT', `/api/agents/${agentId}`, {
    token: tokens.admin,
    body: { name_ar: 'وكيل تعديل العمولة', email: 'agent.comm@test.iq', phone: '', commission_rate: 4.5 },
  });
  assert.equal(edited.status, 200, JSON.stringify(edited.json));
  assert.equal(edited.json.data.commission_rate, 4.5, 'نسبة العمولة تُحدَّث');
  const a = get('SELECT * FROM agents WHERE id = ?', [agentId]);
  assert.equal(a.commission_rate, 4.5);
  const u = get('SELECT * FROM users WHERE id = ?', [agent.json.data.user_id]);
  assert.equal(u.phone, null, 'هاتف فارغ يُخزَّن كـ NULL ولا يصطدم بقيد UNIQUE');
});

// ------------------------- الدفعة الرابعة (الأداء والاستقرار) -------------------------
test('المحفظة: شحن، منع القبول برصيد غير كافٍ، الاستقطاع عند القبول، والرد عند الإلغاء', async () => {
  run('UPDATE provider_wallets SET balance = 0 WHERE provider_id = ?', [store.id]);
  const order = await api('POST', '/api/orders', {
    token: tokens.provider,
    body: { provider_id: store.id, customer_name: 'زبون محفظة', items: [{ title: 'سلعة', quantity: 1, unit_price: 100000 }] },
  });
  assert.equal(order.status, 201, JSON.stringify(order.json));
  const oid = order.json.data.id;
  const commission = order.json.data.commission_amount;
  assert.ok(commission > 0, 'للطلب عمولة');

  const blocked = await api('PUT', `/api/orders/${oid}/status`, { token: tokens.provider, body: { status: 'confirmed' } });
  assert.equal(blocked.status, 400, 'قبول برصيد صفر ممنوع');
  assert.match(blocked.json.message, /محفظة/);

  const charge = await api('POST', `/api/wallets/${store.id}/recharge`, { token: tokens.admin, body: { amount: 100000, note: 'شحن اختبار' } });
  assert.equal(charge.status, 200, JSON.stringify(charge.json));
  assert.equal(charge.json.data.balance, 100000);

  const acc = await api('PUT', `/api/orders/${oid}/status`, { token: tokens.provider, body: { status: 'confirmed' } });
  assert.equal(acc.status, 200, JSON.stringify(acc.json));
  assert.equal(acc.json.data.status, 'confirmed');
  assert.ok(acc.json.data.accepted_at, 'يُسجل وقت القبول');

  const w = await api('GET', '/api/wallets/provider', { token: tokens.provider });
  assert.equal(w.json.data.balance, 100000 - commission, 'الرصيد نُقص بمقدار العمولة');
  const ded = w.json.data.transactions.find((t) => t.type === 'commission' && t.order_id === oid);
  assert.ok(ded, 'سجل استقطاع للطلب');
  assert.equal(ded.amount, -commission);
  assert.ok(ded.agent_amount > 0 && ded.platform_amount > 0, 'تفصيل حصة الوكيل والمنصة');
  assert.equal(ded.agent_amount + ded.platform_amount, commission, 'مجموع الحصتين يساوي العمولة');

  const can = await api('PUT', `/api/orders/${oid}/status`, { token: tokens.provider, body: { status: 'cancelled', reason: 'إلغاء اختباري' } });
  assert.equal(can.status, 200, JSON.stringify(can.json));
  assert.equal(can.json.data.reject_reason, 'إلغاء اختباري');
  const w2 = await api('GET', '/api/wallets/provider', { token: tokens.provider });
  assert.equal(w2.json.data.balance, 100000, 'ردّت العمولة بعد الإلغاء');
  assert.ok(w2.json.data.transactions.some((t) => t.type === 'refund' && t.order_id === oid), 'سجل رد');

  const led = await api('GET', '/api/wallets/agent/ledger', { token: tokens.agent });
  assert.equal(led.status, 200, JSON.stringify(led.json));
  assert.ok(led.json.data.transactions.some((t) => t.order_id === oid), 'الوكيل يرى حركة الطلب');

  const forbidden = await api('POST', `/api/wallets/${store.id}/recharge`, { token: tokens.provider, body: { amount: 1000 } });
  assert.equal(forbidden.status, 403, 'المزود لا يشحن محفظته بنفسه');
});

test('الوكيل لا يستطيع قبول الطلب (القبول يخصم عمولة محفظة المزود — يمنع استنزافها)', async () => {
  const created = await api('POST', '/api/orders', {
    token: tokens.agent,
    body: { provider_id: store.id, customer_name: 'زبون بالهاتف', items: [{ title: 'سلعة', quantity: 1, unit_price: 100000 }] },
  });
  assert.equal(created.status, 201, 'الوكيل ينشئ طلباً حراً لمحافظته: ' + JSON.stringify(created.json));
  const oid = created.json.data.id;

  const confirm = await api('PUT', `/api/orders/${oid}/status`, { token: tokens.agent, body: { status: 'confirmed' } });
  assert.equal(confirm.status, 403, 'الوكيل ممنوع من قبول الطلب وخصم محفظة المزود');
  assert.match(confirm.json.message, /يختص بمزود الخدمة/);

  const cancel = await api('PUT', `/api/orders/${oid}/status`, { token: tokens.agent, body: { status: 'cancelled' } });
  assert.equal(cancel.status, 200, 'يبقى للوكيل إلغاء الطلب المعلق');
});

const PROOF_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

test('دورة الشحن المسبق: يدفع المزود ويرسل إثباتاً، يعلّق الطلب، والمسؤول يوافق فيُشحن الرصيد أو يرفض مع سبب', async () => {
  const balBefore = get('SELECT balance FROM provider_wallets WHERE provider_id = ?', [store.id]).balance;

  const badProof = await api('POST', '/api/recharges', { token: tokens.provider, body: { amount: 50000, payment_method: 'zain_cash', proof_image: 'ليست صورة' } });
  assert.equal(badProof.status, 400, 'الإثبات يجب أن يكون صورة');

  const badMethod = await api('POST', '/api/recharges', { token: tokens.provider, body: { amount: 50000, payment_method: 'western_union', proof_image: PROOF_PNG } });
  assert.equal(badMethod.status, 400, 'طريقة الدفع غير مدعومة');

  const req1 = await api('POST', '/api/recharges', {
    token: tokens.provider,
    body: { amount: 250000, payment_method: 'zain_cash', note: 'شحن نقدي من زين كاش', proof_image: PROOF_PNG },
  });
  assert.equal(req1.status, 200, JSON.stringify(req1.json));
  assert.equal(req1.json.data.status, 'pending');
  assert.match(req1.json.data.reference, /^RCH-/);
  const rid = req1.json.data.id;

  const adminBell = await api('GET', '/api/notifications?limit=10', { token: tokens.admin });
  assert.equal(adminBell.status, 200, JSON.stringify(adminBell.json));
  const rechargeNotice = adminBell.json.data.find((n) => n.type === 'recharge' && String(n.body).includes(req1.json.data.reference));
  assert.ok(rechargeNotice, 'إشعار طلب الشحن يظهر في جرس المسؤول');
  assert.equal(rechargeNotice.url, '/wallets', 'رابط الإشعار يوجّه لصفحة محافظ المزودين');

  const balMid = get('SELECT balance FROM provider_wallets WHERE provider_id = ?', [store.id]).balance;
  assert.equal(balMid, balBefore, 'الطلب المعلق لا يغيّر الرصيد');

  const notProvider = await api('POST', '/api/recharges', { token: tokens.customer, body: { amount: 5000, payment_method: 'asia_pay', proof_image: PROOF_PNG } });
  assert.equal(notProvider.status, 403, 'الزبون لا ينشئ طلبات شحن');

  const adminList = await api('GET', '/api/recharges?status=pending', { token: tokens.admin });
  assert.equal(adminList.status, 200);
  assert.ok(adminList.json.data.some((r) => r.id === rid), 'المسؤول يرى الطلب المعلق');
  assert.ok(!adminList.json.data.some((r) => r.proof_image), 'القائمة لا تحمل الصور');

  const detail = await api('GET', `/api/recharges/${rid}`, { token: tokens.admin });
  assert.equal(detail.status, 200);
  assert.equal(detail.json.data.proof_image, PROOF_PNG, 'تفاصيل الطلب تتضمن الإثبات');
  assert.ok(detail.json.data.payment_method_label.includes('زين كاش'), 'تسمية طريقة الدفع');

  const providerList = await api('GET', '/api/recharges/provider', { token: tokens.provider });
  assert.ok(providerList.json.data.some((r) => r.id === rid), 'المزود يرى طلبه');

  const doubleHandle = await api('POST', `/api/recharges/${rid}/approve`, { token: tokens.admin });
  assert.equal(doubleHandle.status, 200, JSON.stringify(doubleHandle.json));

  const again = await api('POST', `/api/recharges/${rid}/approve`, { token: tokens.admin });
  assert.equal(again.status, 409, 'لا موافقة مكررة');

  const w1 = await api('GET', '/api/wallets/provider', { token: tokens.provider });
  assert.equal(w1.json.data.balance, balBefore + 250000, 'الرصيد أُضيف بعد الموافقة');
  assert.ok(
    w1.json.data.transactions.some((t) => t.type === 'recharge' && String(t.note).includes(req1.json.data.reference)),
    'سجل شحن مرتبط بطلب الشحن'
  );

  const req2 = await api('POST', '/api/recharges', {
    token: tokens.provider,
    body: { amount: 100000, payment_method: 'first_iraqi_bank', proof_image: PROOF_PNG },
  });
  assert.equal(req2.status, 200, JSON.stringify(req2.json));
  const rej = await api('POST', `/api/recharges/${req2.json.data.id}/reject`, { token: tokens.admin, body: { reason: 'الإثبات غير واضح — أعد إرسال لقطة أوضح' } });
  assert.equal(rej.status, 200, JSON.stringify(rej.json));
  assert.equal(rej.json.data.status, 'rejected');

  const balEnd = get('SELECT balance FROM provider_wallets WHERE provider_id = ?', [store.id]).balance;
  assert.equal(balEnd, balBefore + 250000, 'الرفض لا يغيّر الرصيد');

  const rejDetail = await api('GET', `/api/recharges/${req2.json.data.id}`, { token: tokens.admin });
  assert.equal(rejDetail.json.data.status, 'rejected');
  assert.ok(rejDetail.json.data.admin_note.includes('غير واضح'), 'سبب الرفض محفوظ');
  assert.ok(rejDetail.json.data.handled_by, 'اسم من عالج الطلب محفوظ');

  const providerStatus = await api('GET', '/api/recharges/provider', { token: tokens.provider });
  assert.equal(providerStatus.json.data.find((r) => r.id === req2.json.data.id).status, 'rejected', 'المزود يرى أن طلبه رُفض');

  const onlyAdmin = await api('POST', `/api/recharges/${rid}/reject`, { token: tokens.provider });
  assert.equal(onlyAdmin.status, 403, 'المزود لا يرفض الطلبات');
});

test('حسابات استقبال شحن المزودين قابلة للتعديل من المسؤول وتظهر للمزود (بمصادقة المزوّد)', async () => {
  const anon = await api('GET', '/api/public/payment-info');
  assert.equal(anon.status, 401, 'البيانات المالية لا تُكشف للزوار');

  const info = await api('GET', '/api/public/payment-info', { token: tokens.provider });
  assert.equal(info.status, 200, JSON.stringify(info.json));
  assert.ok(info.json.data.methods.zain_cash, 'زين كاش ضمن القنوات');
  assert.ok(Array.isArray(info.json.data.methods.al_ahli_bank.ibans), 'الآيبان ضمن الحقول');

  await api('PUT', '/api/settings', {
    token: tokens.admin,
    body: {
      zain_cash_number: { value: '07700001111\n07800002222', label: 'أرقام زين كاش' },
      first_iraqi_bank_iban: { value: 'IQ00FIRI000000000000000\nIQ00FIRI000000000000001', label: 'الآيبان' },
    },
  });

  const info2 = await api('GET', '/api/public/payment-info', { token: tokens.provider });
  assert.deepEqual(info2.json.data.methods.zain_cash.numbers, ['07700001111', '07800002222'], 'أرقام زين كاش المتعددة تظهر للمزود');
  assert.deepEqual(info2.json.data.methods.first_iraqi_bank.ibans, ['IQ00FIRI000000000000000', 'IQ00FIRI000000000000001'], 'آيبانات متعددة تظهر للمزود');

  const customerDenied = await api('GET', '/api/public/payment-info', { token: tokens.customer });
  assert.equal(customerDenied.status, 403, 'الزبون (مصادق) لا يرى حسابات الشحن — للمزوّدين فقط');

  const denied = await api('GET', '/api/settings', { token: tokens.provider });
  assert.equal(denied.status, 403, 'المزود لا يعدّل الإعدادات');
});

test('رفض المزود للطلب (قبول→لا) يسجل السبب ويعيد المخزون دون مساس بالرصيد', async () => {
  const order = await api('POST', '/api/orders', {
    token: tokens.customer,
    body: { provider_id: store.id, items: [{ kind: 'products', item_id: product.id, quantity: 1 }] },
  });
  assert.equal(order.status, 201, JSON.stringify(order.json));
  const oid = order.json.data.id;
  const stockBefore = get('SELECT stock FROM products WHERE id = ?', [product.id]).stock;

  const before = await api('GET', '/api/wallets/provider', { token: tokens.provider });
  const balBefore = before.json.data.balance;

  const reject = await api('PUT', `/api/orders/${oid}/status`, { token: tokens.provider, body: { status: 'cancelled', reason: 'المنتج غير متوفر حالياً' } });
  assert.equal(reject.status, 200, JSON.stringify(reject.json));
  assert.equal(reject.json.data.status, 'cancelled');
  assert.equal(reject.json.data.reject_reason, 'المنتج غير متوفر حالياً');

  const stockAfter = get('SELECT stock FROM products WHERE id = ?', [product.id]).stock;
  assert.equal(stockAfter, stockBefore + 1, 'المخزون عاد عند الرفض');

  const after = await api('GET', '/api/wallets/provider', { token: tokens.provider });
  assert.equal(after.json.data.balance, balBefore, 'رفض بلا استقطاع ولا رد (لم يُقبل سابقاً)');
  assert.ok(!after.json.data.transactions.some((t) => t.order_id === oid), 'لا حركة محفظة لطلب مرفوض لم يُقبل');
});
test('هجرة 005: فهارس المنتجات والسجل + إعداد الاحتفاظ أُنشئت', () => {
  const names = all("SELECT name FROM sqlite_master WHERE type='index'").map((r) => r.name);
  for (const idx of ['idx_products_category', 'idx_products_provider', 'idx_activity_log_created']) {
    assert.ok(names.includes(idx), 'فهرس مفقود: ' + idx);
  }
  const retention = get("SELECT value FROM settings WHERE key = 'activity_log_retention_days'");
  assert.equal(retention.value, '90');
});

test('تصدير CSV بحد صفوف: limit يقطع ويعلّم بالاقتطاع', async () => {
  const res = await fetch(`${base}/api/orders/export?limit=1`, {
    headers: { Authorization: `Bearer ${tokens.admin}` },
  });
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type') || '', /text\/csv/);
  const body = await res.text();
  const lines = body.replace(/^\uFEFF/, '').split('\r\n').filter(Boolean);
  assert.ok(lines.length >= 3, 'رأس + صف واحد + سطر اقتطاع');
  assert.match(lines[0], /رقم الطلب/);
  assert.match(lines[lines.length - 1], /اقتُطع التصدير/);
});

test('تصدير CSV بلا حد يعيد كل الطلبات بدون سطر اقتطاع', async () => {
  const res = await fetch(`${base}/api/orders/export`, {
    headers: { Authorization: `Bearer ${tokens.admin}` },
  });
  assert.equal(res.status, 200);
  const body = (await res.text()).replace(/^\uFEFF/, '');
  assert.ok(body.split('\r\n')[0].includes('رقم الطلب'));
  assert.ok(!body.includes('اقتُطع التصدير'), 'لا اقتطاع بدون حد');
});

test('تدوير activity_log يحذف السجلات الأقدم من فترة الاحتفاظ فقط', () => {
  const { pruneActivityLog } = require('../src/utils/log');
  run("INSERT INTO activity_log (user_id, action, entity_type, created_at) VALUES (NULL,'prune-old','test','2020-01-01 00:00:00')");
  run("INSERT INTO activity_log (user_id, action, entity_type, created_at) VALUES (NULL,'prune-fresh','test',datetime('now'))");
  pruneActivityLog();
  assert.equal(get("SELECT COUNT(*) AS c FROM activity_log WHERE action='prune-old'").c, 0);
  assert.equal(get("SELECT COUNT(*) AS c FROM activity_log WHERE action='prune-fresh'").c, 1);
});

test('SQLITE_BUSY يتحول إلى 503 مع رسالة واضحة', () => {
  const { errorHandler } = require('../src/middleware/error');
  let captured = null;
  const mockRes = { status(s) { this.statusCode = s; return this; }, json(o) { captured = o; } };
  errorHandler(Object.assign(new Error('database is locked'), { code: 'SQLITE_BUSY' }), {}, mockRes, () => {});
  assert.equal(mockRes.statusCode, 503);
  assert.equal(captured.success, false);
  assert.match(captured.message, /مشغولة/);
});

// ------------------------- الدفعة الخامسة (الأمان) -------------------------
test('حقن CSV: الصيغ (= + - @) تُبطل ببادئة apostrophe', async () => {
  const { csvEscape } = require('../src/utils/helpers');
  assert.equal(csvEscape('=SUM(A1:A2)'), "'=SUM(A1:A2)");
  assert.equal(csvEscape('+1'), "'+1");
  assert.equal(csvEscape('-cmd'), "'-cmd");
  assert.equal(csvEscape('@import'), "'@import");
  assert.equal(csvEscape('normal'), 'normal');
  assert.equal(csvEscape('a,b'), '"a,b"');

  const injected = await api('POST', '/api/orders', {
    token: tokens.admin,
    body: { provider_id: store.id, customer_name: '=1+1', customer_phone: '0700', items: [{ title: 'خدمة', unit_price: 100, quantity: 1 }] },
  });
  assert.equal(injected.status, 201, JSON.stringify(injected.json));
  const res = await fetch(`${base}/api/orders/export`, { headers: { Authorization: `Bearer ${tokens.admin}` } });
  const body = (await res.text()).replace(/^\uFEFF/, '');
  assert.ok(body.includes("'=1+1"), 'الاسم الحقن يُصدَّر ببادئة آمنة');
});

test('clientIp يتجاهل X-Forwarded-For عند الاتصال المباشر ويصدقه خلف موازن محلي', () => {
  const { clientIp } = require('../src/utils/rateLimit');
  const config = require('../src/config');

  const fakeReq = (socketIp, forwarded) => ({ socket: { remoteAddress: socketIp }, ip: forwarded });
  const was = config.trustProxy;
  try {
    config.trustProxy = false;
    assert.equal(clientIp(fakeReq('203.0.113.5', '6.6.6.6')), '203.0.113.5', 'بدون trust-proxy لا تُصدَّق XFF');
    assert.equal(clientIp(fakeReq('127.0.0.1', '1.2.3.4')), '127.0.0.1', 'حتى من loopback، TRUST_PROXY مفطوب = لا XFF');
    config.trustProxy = true;
    assert.equal(clientIp(fakeReq('127.0.0.1', '1.2.3.4')), '1.2.3.4', 'خلف موازن محلي تُصدَّق XFF');
    assert.equal(clientIp(fakeReq('203.0.113.5', '6.6.6.6')), '203.0.113.5', 'اتصال مباشر عام يُتجاهل XFF رغم TRUST_PROXY');
  } finally {
    config.trustProxy = was;
  }
});

test('تسجيل زبون يتطلب تفعيل البريد قبل الدخول، والرمز يُفعل الحساب', async () => {
  const email = `verify-${Date.now()}@test.iq`;
  const r = await api('POST', '/api/auth/register-customer', {
    body: { name_ar: 'زبون تحقق', email, phone: '0770-verify', password: 'Verify@123', governorate_id: null },
  });
  assert.equal(r.status, 201, JSON.stringify(r.json));
  assert.equal(r.json.data.user.is_verified, 0);
  assert.ok(r.json.data.verification_token, 'يصدر رمز تفعيل');

  const blocked = await api('POST', '/api/auth/login', { body: { email, password: 'Verify@123' } });
  assert.equal(blocked.status, 403, 'الدخول محظور قبل التفعيل');

  const badToken = await api('POST', '/api/auth/verify-email', { body: { token: 'nope' } });
  assert.equal(badToken.status, 400);

  const verify = await api('POST', '/api/auth/verify-email', { body: { token: r.json.data.verification_token } });
  assert.equal(verify.status, 200, JSON.stringify(verify.json));
  assert.ok(verify.json.data.token, 'دخول تلقائي بعد التفعيل');

  const ok = await api('POST', '/api/auth/login', { body: { email, password: 'Verify@123' } });
  assert.equal(ok.status, 200, 'الدخول متاح بعد التفعيل');

  const reuse = await api('POST', '/api/auth/verify-email', { body: { token: r.json.data.verification_token } });
  assert.equal(reuse.status, 400, 'الرمز يُستهلك مرة واحدة');
});

test('تسجيل زبون بحقول متضخمة يرفض (حدود الأطوال)', async () => {
  const r = await api('POST', '/api/auth/register-customer', {
    body: { name_ar: 'أ'.repeat(101), email: 'long@test.iq', phone: '0770', password: 'Long@123' },
  });
  assert.equal(r.status, 400);
});

test('مدة التوكن الافتراضية أصبحت يوماً واحداً', () => {
  const config = require('../src/config');
  assert.equal(config.jwtExpiresIn, '1d');
});

test('حد الكتابة العام: createRateLimiter يفرض سقفاً معزولاً ويعيد 429', () => {
  const { createRateLimiter } = require('../src/utils/rateLimit');
  const limiter = createRateLimiter({ windowMs: 60000, max: 2 });
  let status = 0;
  const res = { status(c) { status = c; return this; }, json() { return this; } };
  const next = () => { status = 0; };
  const req = () => ({ socket: { remoteAddress: '9.9.9.9' } });

  limiter(req(), res, next); assert.equal(status, 0, 'الطلب الأول يمر');
  limiter(req(), res, next); assert.equal(status, 0, 'الطلب الثاني يمر');
  limiter(req(), res, next); assert.equal(status, 429, 'الطلب الثالث مرفوض');

  // عزل الحدود: حدّ آخر بنفس النافذة لا يشارك عدّاد الأول
  const other = createRateLimiter({ windowMs: 60000, max: 2 });
  other(req(), res, next);
  assert.equal(status, 0, 'كل مثيل يحتفظ بعدّاده الخاص');
});

test('قائمة النشاط مرقّمة بإجمالي وصفحات بعد إعادة الترقيم', async () => {
  run("INSERT INTO activity_log (actor_role, action, entity_type, entity_id, details) VALUES (?,?,?,?,?)", ['admin', 'test_activity_page', 'test', 1, null]);
  const r = await api('GET', '/api/activity?page=1&limit=5', { token: tokens.admin });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.ok(r.json.data.length <= 5, 'حد الصفحة مطبق');
  assert.equal(r.json.meta.page, 1);
  assert.equal(r.json.meta.limit, 5);
  assert.ok(r.json.meta.total >= 1);
  assert.ok(r.json.meta.pages >= 1);
  run("DELETE FROM activity_log WHERE action = 'test_activity_page'");
});

test('الترقيم إلزامي: القوائم تُقصّ دائماً بسقف وتُعيد meta حتى بدون page/limit', async () => {
  const noParams = await api('GET', '/api/activity', { token: tokens.admin });
  assert.equal(noParams.status, 200);
  assert.ok(Array.isArray(noParams.json.data), 'data تبقى مصفوفة');
  assert.ok(noParams.json.data.length <= 100, 'لا تُرد قائمة بلا سقف حتى بدون معاملات');
  assert.ok(noParams.json.meta && typeof noParams.json.meta.total === 'number', 'meta حاضرة دائماً');
  assert.equal(noParams.json.meta.page, 1);
  assert.equal(noParams.json.meta.limit, 100, 'الحد الافتراضي لنشاط المسؤول 100');

  const capped = await api('GET', '/api/activity?limit=100000', { token: tokens.admin });
  assert.equal(capped.status, 200);
  assert.ok(capped.json.data.length <= 100, 'السقف الأقصى 100 يُفرض مهما طلبت');
  assert.equal(capped.json.meta.limit, 100);
});

test('بحث الوكلاء بالاسم/البريد/المحافظة وترشيح محافظة', async () => {
  const found = await api('GET', '/api/agents?q=baghdad', { token: tokens.admin });
  assert.equal(found.status, 200);
  assert.ok(found.json.data.length >= 1, 'نتائج مطابقة للبحث');
  assert.ok(found.json.data.every((a) => (a.email || '').toLowerCase().includes('baghdad')));

  const byGov = await api('GET', `/api/agents?governorate_id=${store.governorate_id}`, { token: tokens.admin });
  assert.equal(byGov.status, 200);
  assert.ok(byGov.json.data.length >= 1);
  assert.ok(byGov.json.data.every((a) => a.governorate_id === store.governorate_id), 'كل النتائج ضمن المحافظة المختارة');

  const none = await api('GET', '/api/agents?q=zzz-no-match', { token: tokens.admin });
  assert.equal(none.json.data.length, 0, 'لا نتائج لعبارة خاطئة');
});

test('تقليم idempotency_keys يحذف المفاتيح المنتهية فقط', async () => {
  const { pruneIdempotencyKeys } = require('../src/utils/maintenance');
  const orderId = get('SELECT id FROM orders ORDER BY id DESC LIMIT 1').id;
  run("INSERT INTO idempotency_keys (key, order_id, created_at) VALUES (?,?,datetime('now','-30 day'))", ['old-key', orderId]);
  run("INSERT INTO idempotency_keys (key, order_id, created_at) VALUES (?,?,datetime('now'))", ['fresh-key', orderId]);
  pruneIdempotencyKeys();
  assert.equal(get("SELECT COUNT(*) AS c FROM idempotency_keys WHERE key = 'old-key'").c, 0, 'القديم يُحذف');
  assert.equal(get("SELECT COUNT(*) AS c FROM idempotency_keys WHERE key = 'fresh-key'").c, 1, 'الجديد يبقى');
  run("DELETE FROM idempotency_keys WHERE key IN ('old-key','fresh-key')");
});

test('تسجيل الخروج يبطل التوكن فوراً ولا يبطل توكن جلسة أخرى', async () => {
  const t1 = await login('customer.demo@rafidain.iq', 'Customer@123');
  const me1 = await api('GET', '/api/auth/me', { token: t1 });
  assert.equal(me1.status, 200, 'التوكن الأول حي');

  const t2 = await login('customer.demo@rafidain.iq', 'Customer@123');
  const out = await api('POST', '/api/auth/logout', { token: t1 });
  assert.equal(out.status, 200);

  const after1 = await api('GET', '/api/auth/me', { token: t1 });
  assert.equal(after1.status, 401, 'توكن الجلسة المُبطلة مرفوض');
  const after2 = await api('GET', '/api/auth/me', { token: t2 });
  assert.equal(after2.status, 200, 'جلسة أخرى تبقى حية');
  await api('POST', '/api/auth/logout', { token: t2 });
});

test('logout-all يبطل كل جلسات المستخدم', async () => {
  const a = await login('customer.demo@rafidain.iq', 'Customer@123');
  const b = await login('customer.demo@rafidain.iq', 'Customer@123');
  const all = await api('POST', '/api/auth/logout-all', { token: a });
  assert.equal(all.status, 200);
  assert.equal((await api('GET', '/api/auth/me', { token: a })).status, 401, 'الجلسة المنفذة تُبطل أيضاً');
  assert.equal((await api('GET', '/api/auth/me', { token: b })).status, 401, 'كل الجلسات الأخرى تُبطل');
});

test('تقليم الجلسات يحذف المنتهية فقط', () => {
  const { pruneSessions } = require('../src/utils/session');
  const { randomUUID } = require('node:crypto');
  run("INSERT INTO sessions (id, user_id, expires_at) VALUES (?,?,datetime('now','-1 day'))", [randomUUID(), customerUser.id]);
  const live = randomUUID();
  run("INSERT INTO sessions (id, user_id, expires_at) VALUES (?,?,datetime('now','+1 day'))", [live, customerUser.id]);
  pruneSessions();
  assert.equal(get('SELECT COUNT(*) AS c FROM sessions WHERE id = ?', [live]).c, 1, 'الحيّة تبقى');
  const stale = get("SELECT COUNT(*) AS c FROM sessions WHERE user_id = ? AND expires_at <= datetime('now')", [customerUser.id]);
  assert.equal(stale.c, 0, 'المنتهية تُحذف');
  run('DELETE FROM sessions WHERE id = ?', [live]);
});

// ------------------------- المساعدات -------------------------
function round(n) {
  return Math.round(n * 100) / 100;
}

test('إشعارات Web Push: مفتاح VAPID + اشتراك + إلغاء + عدم كسر الأحداث المرتبطة', async () => {
  // توكنات جديدة لأن اختبارات الجلسات السابقة أبطلت القديمة
  const provToken = await login('provider.demo@rafidain.iq', 'Provider@123');
  const custToken = await login('customer.demo@rafidain.iq', 'Customer@123');
  const ep = `https://127.0.0.1:9/push/${Date.now()}`;
  const keys = { p256dh: 'QUJDRA==', auth: 'QUJDRA==' };

  const noAuth = await api('GET', '/api/push/vapid-key');
  assert.equal(noAuth.status, 401, 'المفتاح يتطلب مصادقة');

  const vk = await api('GET', '/api/push/vapid-key', { token: provToken });
  assert.equal(vk.status, 200, JSON.stringify(vk.json));
  assert.ok(vk.json.data.public_key && vk.json.data.public_key.length > 20, 'مفتاح عمومي صالح');

  const bad = await api('POST', '/api/push/subscribe', { token: provToken, body: { endpoint: 'ftp://x', keys } });
  assert.equal(bad.status, 400, 'نقطة اشتراك غير صالحة تُرفض');

  const sub = await api('POST', '/api/push/subscribe', { token: provToken, body: { endpoint: ep, keys } });
  assert.equal(sub.status, 200, JSON.stringify(sub.json));
  const row = get('SELECT * FROM push_subscriptions WHERE endpoint = ?', [ep]);
  assert.ok(row, 'الاشتراك محفوظ');
  assert.equal(row.user_id, store.user_id, 'مرتبط بحساب المزوّد');

  // إعادة الاشتراك لنفس النقطة لا تكرر الصف (ON CONFLICT)
  await api('POST', '/api/push/subscribe', { token: provToken, body: { endpoint: ep, keys } });
  assert.equal(get('SELECT COUNT(*) AS c FROM push_subscriptions WHERE endpoint = ?', [ep]).c, 1, 'بلا تكرار');

  // إنشاء طلب مع اشتراك مفعّل: لا يكسر العملية (فشل الإرسال يُحتسب ويُتجاهل)
  const order = await api('POST', '/api/orders', {
    token: custToken,
    body: { provider_id: store.id, items: [{ kind: 'products', item_id: product.id, quantity: 1 }] },
  });
  assert.equal(order.status, 201, JSON.stringify(order.json));

  // الإشعارات لا تمسّ مسار الشحن اليدوي (يبقى النموذج الحالي كما هو)
  const prov = await api('GET', '/api/wallets/provider', { token: provToken });
  assert.equal(prov.status, 200, JSON.stringify(prov.json));

  const unsub = await api('POST', '/api/push/unsubscribe', { token: provToken, body: { endpoint: ep } });
  assert.equal(unsub.status, 200, JSON.stringify(unsub.json));
  assert.equal(get('SELECT COUNT(*) AS c FROM push_subscriptions WHERE endpoint = ?', [ep]).c, 0, 'أُلغي الاشتراك');

  run('DELETE FROM orders WHERE order_number = ?', [order.json.data.order_number]);
});

test('توثيق المزود بالمستندات: رفع، مراجعة قبول/رفض، وإلغاء', async () => {
  const provToken = tokens.provider;

  // الحالة الابتدائية
  const initial = await api('GET', '/api/provider/verification', { token: provToken });
  assert.equal(initial.status, 200, JSON.stringify(initial.json));
  assert.equal(initial.json.data.verification_status, 'none');

  // رفع بلا مستندات → 400
  const empty = await api('PUT', '/api/provider/verification', { token: provToken, body: {} });
  assert.equal(empty.status, 400, 'رفع فارغ يُرفض');

  // مستند غير صورة → 400
  const badType = await api('PUT', '/api/provider/verification', { token: provToken, body: { national_id_image: 'data:text/plain;base64,abc' } });
  assert.equal(badType.status, 400, 'غير صورة يُرفض');

  // صورة كبيرة → 400
  const huge = await api('PUT', '/api/provider/verification', { token: provToken, body: { national_id_image: 'data:image/png;base64,' + 'A'.repeat(3 * 1024 * 1024) } });
  assert.equal(huge.status, 400, 'أكبر من الحد تُرفض');

  // رفع صالح
  const doc = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
  const up = await api('PUT', '/api/provider/verification', { token: provToken, body: { national_id_image: doc, residency_doc_image: doc } });
  assert.equal(up.status, 200, JSON.stringify(up.json));
  assert.equal(up.json.data.verification_status, 'pending');
  assert.ok(up.json.data.submitted_at, 'سُجّل وقت التقديم');
  assert.equal(get('SELECT verification_status FROM providers WHERE id = ?', [store.id]).verification_status, 'pending');

  // مراجعة القبول من المسؤول
  const approve = await api('POST', `/api/providers/${store.id}/verify`, { token: tokens.admin, body: { status: 'approved', note: 'مستندات سليمة' } });
  assert.equal(approve.status, 200, JSON.stringify(approve.json));
  assert.equal(approve.json.data.verification_status, 'approved');
  assert.equal(approve.json.data.is_verified, 1);
  assert.ok(approve.json.data.reviewed_at, 'سُجّل وقت المراجعة');
  assert.equal(get('SELECT verification_status FROM providers WHERE id = ?', [store.id]).verification_status, 'approved');

  // المستندات تظهر لمزوّدها
  const after = await api('GET', '/api/provider/verification', { token: provToken });
  assert.equal(after.json.data.verification_status, 'approved');
  assert.ok(after.json.data.national_id_image.startsWith('/uploads/'), 'يُخزَّن المستند كرابط مرفوع آمن (وليس data URI)');

  // رفض بملاحظة → is_verified=0 وتظهر الملاحظة
  const reject = await api('POST', `/api/providers/${store.id}/verify`, { token: tokens.admin, body: { status: 'rejected', note: 'الصورة غير واضحة، أعد رفعها' } });
  assert.equal(reject.status, 200, JSON.stringify(reject.json));
  assert.equal(reject.json.data.verification_status, 'rejected');
  assert.equal(reject.json.data.is_verified, 0);
  assert.equal(reject.json.data.verification_note, 'الصورة غير واضحة، أعد رفعها');

  const rejView = await api('GET', '/api/provider/verification', { token: provToken });
  assert.equal(rejView.json.data.verification_status, 'rejected');
  assert.equal(rejView.json.data.verification_note, 'الصورة غير واضحة، أعد رفعها');

  // إعادة الرفع بعد الرفض تعيده pending وتمسح الملاحظة
  const resub = await api('PUT', '/api/provider/verification', { token: provToken, body: { national_id_image: doc } });
  assert.equal(resub.json.data.verification_status, 'pending');
  assert.equal(resub.json.data.verification_note, null, 'الملاحظة تُمحى عند إعادة التقديم');

  // إلغاء التوثيق (بدون حالة جديدة)
  const cancel = await api('POST', `/api/providers/${store.id}/verify`, { token: tokens.admin, body: {} });
  assert.equal(cancel.json.data.verification_status, 'approved', 'التبديل القديم بلا status يفعّل التوثيق');
  assert.equal(cancel.json.data.is_verified, 1);

  // وكيل بغداد لا يستطيع توثيق مزود في محافظة أخرى (النجف)
  const outsideUser = run(
    'INSERT INTO users (role, name_ar, email, password_hash, governorate_id, service_type, is_active) VALUES (?,?,?,?,?,?,1)',
    ['provider', 'مزود نجف اختبار', 'najaf.outside@test.iq', await hashPassword('Najaf@123'), najaf.id, 'stores']
  ).lastId;
  const outsidePid = run(
    'INSERT INTO providers (user_id, governorate_id, service_id, name_ar, commission_rate, is_active, is_verified) VALUES (?,?,?,?,?,1,0)',
    [outsideUser, najaf.id, store.service_id, 'مزود نجف اختبار', 5]
  ).lastId;
  const outside = await api('POST', `/api/providers/${outsidePid}/verify`, { token: tokens.agent, body: { status: 'approved' } });
  assert.equal(outside.status, 403, 'وكيل لا يدير مزود محافظة أخرى');
});

test('الإشعارات الداخلية: حفظ عند إنشاء الطلب، عدّاد غير المقروء، قراءة، وقراءة الكل', async () => {
  // توكنات جديدة لأن اختبارات الجلسات السابقة أبطلت القديمة
  const provToken = await login('provider.demo@rafidain.iq', 'Provider@123');
  const custToken = await login('customer.demo@rafidain.iq', 'Customer@123');

  // تنظيف أي إشعارات سابقة للمزوّد والزبون في هذه القاعدة المؤقتة
  run('DELETE FROM notifications');

  // إنشاء طلب من الزبون → يخلق إشعاراً للمزوّد (عبر notifyUser)
  const order = await api('POST', '/api/orders', {
    token: custToken,
    body: { provider_id: store.id, items: [{ kind: 'products', item_id: product.id, quantity: 1 }] },
  });
  assert.equal(order.status, 201, JSON.stringify(order.json));

  // إشعار المزوّد محفوظ وغير مقروء
  const provNotifs = await api('GET', '/api/notifications', { token: provToken });
  assert.equal(provNotifs.status, 200, JSON.stringify(provNotifs.json));
  assert.equal(provNotifs.json.data.length, 1, 'إشعار واحد للمزوّد');
  assert.match(provNotifs.json.data[0].title, /طلب جديد/);
  assert.equal(provNotifs.json.data[0].is_read, 0);
  assert.equal(provNotifs.json.meta.unread, 1);

  // عدّاد غير المقروء
  const unread = await api('GET', '/api/notifications/unread-count', { token: provToken });
  assert.equal(unread.json.data.unread, 1);

  // الزبون ليس له إشعارات
  const custNotifs = await api('GET', '/api/notifications', { token: custToken });
  assert.equal(custNotifs.json.data.length, 0);

  // تحديد إشعار كمقروء
  const mark = await api('POST', `/api/notifications/${provNotifs.json.data[0].id}/read`, { token: provToken });
  assert.equal(mark.status, 200, JSON.stringify(mark.json));
  assert.equal(mark.json.data.unread, 0);

  // قراءة إشعار ليس للمستخدم → 403
  const custMark = await api('POST', `/api/notifications/${provNotifs.json.data[0].id}/read`, { token: custToken });
  assert.equal(custMark.status, 403, 'لا يقرأ إشعار غيره');

  // إضافة إشعار آخر وقراءة الكل
  const { createInAppNotification } = require('../src/utils/push');
  const provUserId = get('SELECT user_id FROM providers WHERE id = ?', [store.id]).user_id;
  createInAppNotification(provUserId, {
    type: 'recharge', title: '✅ تم قبول شحنك', body: 'أُضيف 10000 دينار', url: '/wallet',
  });
  createInAppNotification(customerUser.id, { type: 'order', title: '🔔 تحديث الطلب', body: 'اكتمل طلبك', url: '/orders' });

  const readAll = await api('POST', '/api/notifications/read-all', { token: custToken });
  assert.equal(readAll.status, 200, JSON.stringify(readAll.json));
  assert.equal(readAll.json.data.unread, 0);
  const custAfter = await api('GET', '/api/notifications', { token: custToken });
  assert.equal(custAfter.json.data.length, 1);
  assert.equal(custAfter.json.data[0].is_read, 1);
});

test('رفع الصور كملفات: نقطة /upload (مصادقة + قيود)، وقبول روابط /uploads في الشحن والتوثيق', async () => {
  const provToken = await login('provider.demo@rafidain.iq', 'Provider@123');

  // بدون مصادقة → 401
  const noAuth = await api('POST', '/api/upload', { body: { data: PROOF_PNG } });
  assert.equal(noAuth.status, 401, 'الرفع يتطلب مصادقة');

  // غير صورة → 400
  const notImg = await api('POST', '/api/upload', { token: provToken, body: { data: 'data:text/plain;base64,aGVsbG8=' } });
  assert.equal(notImg.status, 400, 'يُقبل ملفات الصور فقط');

  // صيغة غير صالحة → 400
  const badFmt = await api('POST', '/api/upload', { token: provToken, body: { data: 'not-a-data-uri' } });
  assert.equal(badFmt.status, 400, 'يُرفض غير data-URI');

  // رفع صورة سليمة → يُعيد /uploads/<file>
  const up = await api('POST', '/api/upload', { token: provToken, body: { data: PROOF_PNG } });
  assert.equal(up.status, 200, JSON.stringify(up.json));
  assert.ok(/^\/uploads\/.+\.png$/.test(up.json.data.url), 'يُعيد رابط /uploads: ' + up.json.data.url);

  // الملف محفوظ فعلياً على القرص
  const filePath = path.join(__dirname, '../data/uploads', up.json.data.url.replace('/uploads/', ''));
  assert.ok(fs.existsSync(filePath), 'الملف محفوظ في data/uploads');

  // شحن بإثبات رابط /uploads بدل base64
  const rch = await api('POST', '/api/recharges', { token: provToken, body: { amount: 50000, payment_method: 'zain_cash', proof_image: up.json.data.url } });
  assert.equal(rch.status, 200, JSON.stringify(rch.json));
  run('DELETE FROM recharge_requests WHERE reference = ?', [rch.json.data.reference]);

  // رفع مستندات التوثيق برابط /uploads
  const vdoc = await api('PUT', '/api/provider/verification', { token: provToken, body: { national_id_image: up.json.data.url, residency_doc_image: up.json.data.url } });
  assert.equal(vdoc.status, 200, JSON.stringify(vdoc.json));
  const stored = get('SELECT national_id_image, residency_doc_image FROM providers WHERE id = ?', [store.id]);
  assert.match(stored.national_id_image, /^\/uploads\//);
  assert.match(stored.residency_doc_image, /^\/uploads\//);

  // تنظيف الملف المرفوع
  fs.rmSync(filePath, { force: true });
});

// ------------------------- دفعة التدقيق: إصلاح H1–H4 وE1 وE9 -------------------------

test('E1: isUniqueViolation يكتشف اصطدام UNIQUE في node:sqlite', () => {
  const { isUniqueViolation } = require('../src/utils/helpers');
  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync(':memory:');
  db.exec('CREATE TABLE t (id INTEGER PRIMARY KEY, u TEXT UNIQUE)');
  db.prepare('INSERT INTO t (u) VALUES (?)').run('x');
  let err = null;
  try { db.prepare('INSERT INTO t (u) VALUES (?)').run('x'); } catch (e) { err = e; }
  assert.equal(isUniqueViolation(err), true, 'يرصد ERR_SQLITE_ERROR/errcode 2067');
  assert.equal(isUniqueViolation(new Error('خطأ آخر')), false);
  assert.equal(isUniqueViolation(null), false);
});

test('E9: دفعة إجارة بلا تواريخ تُنشئ فترة سنة تبدأ من بداية الإجارة', async () => {
  const agentRow = get('SELECT * FROM agents ORDER BY id LIMIT 1');
  const r = await api('POST', '/api/leases', {
    token: tokens.admin,
    body: { agent_id: agentRow.id, amount: 3000, status: 'pending' },
  });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const start = new Date(r.json.data.period_start);
  const end = new Date(r.json.data.period_end);
  assert.equal(end.getFullYear(), start.getFullYear() + 1, 'النهاية بعد سنة من البداية');
  assert.ok(end > start, 'النهاية بعد البداية');
  run('DELETE FROM lease_payments WHERE id = ?', [r.json.data.id]);
});

test('H1: تفاصيل طلب الشحن — الوكيل والزبون ممنوعان (المسؤول والمزوّد المالك فقط)', async () => {
  const provToken = await login('provider.demo@rafidain.iq', 'Provider@123');
  const custToken = await login('customer.demo@rafidain.iq', 'Customer@123');
  const created = await api('POST', '/api/recharges', {
    token: provToken,
    body: { amount: 20000, payment_method: 'zain_cash', proof_image: 'https://example.com/proof.png' },
  });
  assert.equal(created.status, 200, JSON.stringify(created.json));
  const rid = created.json.data.id;

  assert.equal((await api('GET', `/api/recharges/${rid}`, { token: tokens.agent })).status, 403, 'الوكيل لا يرى الطلب');
  assert.equal((await api('GET', `/api/recharges/${rid}`, { token: custToken })).status, 403, 'الزبون لا يرى الطلب');
  assert.equal((await api('GET', `/api/recharges/${rid}`, { token: provToken })).status, 200, 'المزوّد المالك يرى طلبه');
  assert.equal((await api('GET', `/api/recharges/${rid}`, { token: tokens.admin })).status, 200, 'المسؤول يرى كل الطلبات');

  run('DELETE FROM recharge_requests WHERE id = ?', [rid]);
});

test('H2: الوكيل لا يستطيع منح التوثيق/التمييز لمزوّد (المسؤول فقط)', async () => {
  const email = `agent-fake-${Date.now()}@test.iq`;
  const create = await api('POST', '/api/providers', {
    token: tokens.agent,
    body: { name_ar: 'مزود تدقيق', email, service_id: store.service_id, governorate_id: store.governorate_id, is_verified: 1, is_featured: 1 },
  });
  assert.equal(create.status, 201, JSON.stringify(create.json));
  const pid = create.json.data.id;
  assert.equal(create.json.data.is_verified, 0, 'الوكيل لا يمرر is_verified عند الإنشاء');
  assert.equal(create.json.data.is_featured, 0, 'الوكيل لا يمرر is_featured عند الإنشاء');

  const upd = await api('PUT', `/api/providers/${pid}`, {
    token: tokens.agent,
    body: { is_verified: 1, is_featured: 1 },
  });
  assert.equal(upd.status, 200, JSON.stringify(upd.json));
  assert.equal(upd.json.data.is_verified, 0, 'تعديل الوكيل لا يغيّر التوثيق');
  assert.equal(upd.json.data.is_featured, 0, 'تعديل الوكيل لا يغيّر التمييز');

  // المسؤول يبقى قادراً عبر مسار المراجعة الرسمي
  const adm = await api('POST', `/api/providers/${pid}/verify`, { token: tokens.admin, body: { status: 'approved' } });
  assert.equal(adm.status, 200, JSON.stringify(adm.json));
  assert.equal(adm.json.data.is_verified, 1, 'المسؤول يوثّق عبر /verify');

  const prow = get('SELECT * FROM providers WHERE id = ?', [pid]);
  run('DELETE FROM providers WHERE id = ?', [pid]);
  run('DELETE FROM users WHERE id = ?', [prow.user_id]);
});

test('H3: مفتاح Idempotency لا يسترجع طلب مستخدم آخر', async () => {
  const custA = await login('customer.demo@rafidain.iq', 'Customer@123');
  const key = `k-${Date.now()}`;
  const body = { provider_id: store.id, items: [{ kind: 'products', item_id: product.id, quantity: 1 }] };

  const r1 = await api('POST', '/api/orders', { token: custA, body: { ...body, idempotency_key: key } });
  assert.equal(r1.status, 201, JSON.stringify(r1.json));
  const orderA = r1.json.data.id;

  // عميل ثانٍ (حساب جديد) يعيد نفس المفتاح
  const emailB = `audit-b-${Date.now()}@test.iq`;
  const reg = await api('POST', '/api/auth/register-customer', {
    body: { name_ar: 'عميل تدقيق', email: emailB, phone: `0771999${String(Date.now()).slice(-6)}`, password: 'Strong@123', governorate_id: store.governorate_id },
  });
  assert.equal(reg.status, 201, JSON.stringify(reg.json));
  const vtoken = reg.json.data.verification_token;
  assert.ok(vtoken, 'وضع الاختبار يُعيد رمز التفعيل');
  await api('POST', '/api/auth/verify-email', { body: { token: vtoken } });
  const custB = await login(emailB, 'Strong@123');

  const r2 = await api('POST', '/api/orders', { token: custB, body: { ...body, idempotency_key: key } });
  assert.equal(r2.status, 201, 'العميل الثاني ينشئ طلبه الخاص: ' + JSON.stringify(r2.json));
  assert.notEqual(r2.json.data.id, orderA, 'لا يحصل على طلب العميل الأول');

  // المالك الأصلي ما زال يحصل على طلبه بنفس المفتاح
  const r3 = await api('POST', '/api/orders', { token: custA, body: { ...body, idempotency_key: key } });
  assert.equal(r3.status, 200, 'إعادة مفتاح المالك تُعيد طلبه');
  assert.equal(r3.json.data.id, orderA);

  run('DELETE FROM orders WHERE id = ?', [r2.json.data.id]);
});

test('H4: إلغاء طلب مكتمل ممنوع (لا رد عمولة بعد الإكمال)', async () => {
  run('UPDATE provider_wallets SET balance = 500000 WHERE provider_id = ?', [store.id]);
  const created = await api('POST', '/api/orders', {
    token: tokens.admin,
    body: { provider_id: store.id, customer_id: customerUser.id, items: [{ title: 'بند H4', unit_price: 10000, quantity: 1 }] },
  });
  assert.equal(created.status, 201, JSON.stringify(created.json));
  const id = created.json.data.id;

  for (const s of ['confirmed', 'in_progress', 'completed']) {
    const r = await api('PUT', `/api/orders/${id}/status`, { token: tokens.admin, body: { status: s } });
    assert.equal(r.status, 200, `الانتقال إلى ${s}: ${JSON.stringify(r.json)}`);
  }

  const cancel = await api('PUT', `/api/orders/${id}/status`, { token: tokens.admin, body: { status: 'cancelled' } });
  assert.equal(cancel.status, 400, 'لا يُلغى طلب مكتمل');
  assert.equal(get('SELECT status FROM orders WHERE id = ?', [id]).status, 'completed', 'الحالة تبقى مكتملة');

  run('DELETE FROM orders WHERE id = ?', [id]);
});

// ------------------------- الهدف 20 المؤجل: تنظيف الصور والترحيل وحماية المحتوى -------------------------

test('رفع الصور: فحص magic bytes يرفض محتوى مخالفاً للصيغة المعلنة ويرفض SVG', async () => {
  const provToken = await login('provider.demo@rafidain.iq', 'Provider@123');

  // يُعلن PNG لكن محتواه JPEG فعلاً → 400
  const fakePng = 'data:image/png;base64,' + Buffer.from([0xff, 0xd8, 0xff, 0xe0]).toString('base64');
  const mismatch = await api('POST', '/api/upload', { token: provToken, body: { data: fakePng } });
  assert.equal(mismatch.status, 400, 'محتوى مخالف للصيغة يُرفض: ' + JSON.stringify(mismatch.json));

  // SVG (ناقل برمجي قد ينفّذ سكربت عبر /uploads العام) يُرفض
  const svg = 'data:image/svg+xml;base64,' + Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>').toString('base64');
  const svgUp = await api('POST', '/api/upload', { token: provToken, body: { data: svg } });
  assert.equal(svgUp.status, 400, 'SVG يُرفض: ' + JSON.stringify(svgUp.json));

  // PNG سليم يُقبل
  const ok = await api('POST', '/api/upload', { token: provToken, body: { data: PROOF_PNG } });
  assert.equal(ok.status, 200, JSON.stringify(ok.json));
  fs.rmSync(path.join(__dirname, '../data/uploads', ok.json.data.url.replace('/uploads/', '')), { force: true });
});

test('الترحيل: convertBase64Value يحوّل base64 المخزن إلى ملف /uploads ويُبقي الروابط الأخرى', () => {
  const { convertBase64Value } = require('../src/utils/uploads');

  const single = convertBase64Value(PROOF_PNG);
  assert.match(single, /^\/uploads\/.+\.png$/, 'قيمة مفردة تتحول إلى رابط ملف');
  const singlePath = path.join(__dirname, '../data/uploads', single.replace('/uploads/', ''));
  assert.ok(fs.existsSync(singlePath), 'ملف الترحيل محفوظ على القرص');
  fs.rmSync(singlePath, { force: true });

  const arr = convertBase64Value(JSON.stringify(['https://x.com/a.png', PROOF_PNG]));
  const parsed = JSON.parse(arr);
  assert.equal(parsed[0], 'https://x.com/a.png', 'الروابط الخارجية تبقى كما هي');
  assert.match(parsed[1], /^\/uploads\//, 'عنصر المصفوفة base64 يتحول إلى ملف');
  fs.rmSync(path.join(__dirname, '../data/uploads', parsed[1].replace('/uploads/', '')), { force: true });

  assert.equal(convertBase64Value(null), null, 'القيم الخالية تبقى كما هي');
  assert.equal(convertBase64Value('/uploads/keep.png'), '/uploads/keep.png', 'روابط /uploads تبقى كما هي');
});

test('حذف الصور: استبدال/حذف عنصر كتالوج يزيل ملفاته القديمة من data/uploads', async () => {
  const provToken = await login('provider.demo@rafidain.iq', 'Provider@123');

  const up1 = await api('POST', '/api/upload', { token: provToken, body: { data: PROOF_PNG } });
  const up2 = await api('POST', '/api/upload', { token: provToken, body: { data: PROOF_PNG } });
  assert.equal(up1.status, 200, JSON.stringify(up1.json));
  assert.equal(up2.status, 200, JSON.stringify(up2.json));
  const f1 = up1.json.data.url;
  const f2 = up2.json.data.url;

  const created = await api('POST', '/api/provider/products', {
    token: provToken,
    body: { name_ar: 'منتج صور التدقيق', price: 1000, images_json: [f1] },
  });
  assert.equal(created.status, 201, JSON.stringify(created.json));
  const pid = created.json.data.id;

  const p1Path = path.join(__dirname, '../data/uploads', f1.replace('/uploads/', ''));
  assert.ok(fs.existsSync(p1Path), 'الصورة الأولى محفوظة');

  // استبدال الصورة → تُحذف القديمة
  const upd = await api('PUT', `/api/provider/products/${pid}`, { token: provToken, body: { images_json: [f2] } });
  assert.equal(upd.status, 200, JSON.stringify(upd.json));
  assert.equal(fs.existsSync(p1Path), false, 'الصورة القديمة حُذفت بعد الاستبدال');
  assert.ok(fs.existsSync(path.join(__dirname, '../data/uploads', f2.replace('/uploads/', ''))), 'الصورة الجديدة محفوظة');

  // حذف المنتج → تُحذف صوره
  const del = await api('DELETE', `/api/provider/products/${pid}`, { token: provToken });
  assert.equal(del.status, 200, JSON.stringify(del.json));
  assert.equal(fs.existsSync(path.join(__dirname, '../data/uploads', f2.replace('/uploads/', ''))), false, 'صورة المنتج المحذوف حُذفت');
});

test('الكتالوج: سعر أو مخزون سالب يُرفض عند الإنشاء والتعديل', async () => {
  const provToken = await login('provider.demo@rafidain.iq', 'Provider@123');

  const negPrice = await api('POST', '/api/provider/products', {
    token: provToken,
    body: { name_ar: 'منتج بسعر سالب', price: -5000, stock: 10 },
  });
  assert.equal(negPrice.status, 400, 'سعر سالب مرفوض: ' + JSON.stringify(negPrice.json));
  assert.match(negPrice.json.message, /غير سالب/);

  const ok = await api('POST', '/api/provider/products', {
    token: provToken,
    body: { name_ar: 'منتج سليم', price: 10000, stock: 5 },
  });
  assert.equal(ok.status, 201, JSON.stringify(ok.json));

  const negStock = await api('PUT', `/api/provider/products/${ok.json.data.id}`, {
    token: provToken,
    body: { stock: -1 },
  });
  assert.equal(negStock.status, 400, 'مخزون سالب مرفوض عند التعديل: ' + JSON.stringify(negStock.json));
});

test('حذف الصور: استبدال شعار المزوّد والصورة الرمزية للزبون يزيل القديم', async () => {
  const provToken = await login('provider.demo@rafidain.iq', 'Provider@123');
  const custToken = await login('customer.demo@rafidain.iq', 'Customer@123');

  // شعار المزوّد
  const up1 = await api('POST', '/api/upload', { token: provToken, body: { data: PROOF_PNG } });
  const up2 = await api('POST', '/api/upload', { token: provToken, body: { data: PROOF_PNG } });
  const l1 = up1.json.data.url;
  const l2 = up2.json.data.url;
  const l1Path = path.join(__dirname, '../data/uploads', l1.replace('/uploads/', ''));

  await api('PUT', '/api/provider/profile', { token: provToken, body: { logo: l1 } });
  assert.ok(fs.existsSync(l1Path), 'الشعار الأول محفوظ');
  await api('PUT', '/api/provider/profile', { token: provToken, body: { logo: l2 } });
  assert.equal(fs.existsSync(l1Path), false, 'الشعار القديم حُذف بعد الاستبدال');

  // الصورة الرمزية للزبون
  const a1 = await api('POST', '/api/upload', { token: custToken, body: { data: PROOF_PNG } });
  const a2 = await api('POST', '/api/upload', { token: custToken, body: { data: PROOF_PNG } });
  const av1 = a1.json.data.url;
  const av2 = a2.json.data.url;
  const av1Path = path.join(__dirname, '../data/uploads', av1.replace('/uploads/', ''));

  await api('PUT', '/api/customer/profile', { token: custToken, body: { avatar: av1 } });
  assert.ok(fs.existsSync(av1Path), 'الصورة الرمزية الأولى محفوظة');
  await api('PUT', '/api/customer/profile', { token: custToken, body: { avatar: av2 } });
  assert.equal(fs.existsSync(av1Path), false, 'الصورة الرمزية القديمة حُذفت بعد الاستبدال');

  // تنظيف الملفات التي بقي مرجعها في قاعدة الاختبار (تُهمَل القاعدة بعد التشغيل)
  for (const u of [l2, av2]) fs.rmSync(path.join(__dirname, '../data/uploads', u.replace('/uploads/', '')), { force: true });
});

test('حذف الصور: استبدال مستندات التوثيق يزيل الملف القديم', async () => {
  const provToken = await login('provider.demo@rafidain.iq', 'Provider@123');

  const up1 = await api('POST', '/api/upload', { token: provToken, body: { data: PROOF_PNG } });
  const up2 = await api('POST', '/api/upload', { token: provToken, body: { data: PROOF_PNG } });
  const d1 = up1.json.data.url;
  const d2 = up2.json.data.url;
  const d1Path = path.join(__dirname, '../data/uploads', d1.replace('/uploads/', ''));

  await api('PUT', '/api/provider/verification', { token: provToken, body: { national_id_image: d1 } });
  assert.ok(fs.existsSync(d1Path), 'المستند الأول محفوظ');
  await api('PUT', '/api/provider/verification', { token: provToken, body: { national_id_image: d2 } });
  assert.equal(fs.existsSync(d1Path), false, 'المستند القديم حُذف بعد الاستبدال');

  // تنظيف الملف الذي بقي مرجعه في قاعدة الاختبار
  fs.rmSync(path.join(__dirname, '../data/uploads', d2.replace('/uploads/', '')), { force: true });
});

// ------------------------- الدفعة الأمنية (H5 / M6 / M10 / M11) -------------------------
test('H5: الواجهات العامة للمزوّدين لا تعيد مستندات التوثيق ولا الحقول الداخلية', async () => {
  const list = await api('GET', `/api/public/providers?governorate_code=${get('SELECT code FROM governorates WHERE id = ?', [store.governorate_id]).code}`);
  assert.equal(list.status, 200, JSON.stringify(list.json));
  assert.ok(list.json.data.length >= 1, 'يوجد مزودون في القائمة');
  for (const p of list.json.data) {
    assert.ok(!('national_id_image' in p), 'لا تسريب national_id_image في القائمة');
    assert.ok(!('residency_doc_image' in p), 'لا تسريب residency_doc_image في القائمة');
    assert.ok(!('verification_status' in p), 'لا تسريب verification_status في القائمة');
    assert.ok(!('service_id' in p) && !('governorate_id' in p), 'لا تسريب معرفات داخلية في القائمة');
  }

  const detail = await api('GET', `/api/public/providers/${store.id}`);
  assert.equal(detail.status, 200, JSON.stringify(detail.json));
  assert.ok(!('national_id_image' in detail.json.data), 'لا تسريب مستند التوثيق في التفاصيل');
  assert.ok(!('residency_doc_image' in detail.json.data), 'لا تسريب تأييد السكن في التفاصيل');
});

test('M11: تجزئة وهمية لموازنة زمن الدخول + دخول ببريد غير موجود يرفض', async () => {
  const { DUMMY_HASH, verifyPassword } = require('../src/utils/password');
  assert.match(DUMMY_HASH, /^\$2[aby]\$/, 'DUMMY_HASH تجزئة bcrypt صالحة');
  assert.equal(await verifyPassword('anything', DUMMY_HASH), false, 'المقارنة الوهمية ترفض دائماً');

  const missing = await api('POST', '/api/auth/login', { body: { email: 'not-exists@test.iq', password: 'Whatever@123' } });
  assert.equal(missing.status, 401, 'بريد غير موجود يرفض بنفس رسالة كلمة المرور الخاطئة');
  assert.match(missing.json.message, /غير صحيحة/, 'رسالة موحدة لا تكشف وجود الحساب');
});

test('M11: كلمة مرور تتجاوز 72 حرفاً تُرفض عند التغيير وإعادة التعيين', async () => {
  const longPw = 'a'.repeat(80);
  const change = await api('POST', '/api/auth/change-password', {
    token: tokens.agent,
    body: { current_password: 'Agent@123', new_password: longPw },
  });
  assert.equal(change.status, 400, 'تغيير كلمة المرور يرفض تجاوز 72 حرفاً');

  const storeUser = get('SELECT * FROM users WHERE email = ?', ['provider.demo@rafidain.iq']);
  const reset = await api('POST', '/api/auth/reset-password', {
    token: tokens.admin,
    body: { user_id: storeUser.id, new_password: longPw },
  });
  assert.equal(reset.status, 400, 'إعادة التعيين ترفض تجاوز 72 حرفاً');

  const loginStill = await api('POST', '/api/auth/login', { body: { email: 'provider.demo@rafidain.iq', password: 'Provider@123' } });
  assert.equal(loginStill.status, 200, 'كلمة مرور المزود لم تتغير بالطلبات المرفوضة');
});

test('M11: تغيير كلمة المرور يُبطل الجلسات الأخرى ويُبقي الجلسة الحالية', async () => {
  const tokenA = await login('agent.baghdad@rafidain.iq', 'Agent@123');
  const tokenB = await login('agent.baghdad@rafidain.iq', 'Agent@123');

  const change = await api('POST', '/api/auth/change-password', {
    token: tokenA,
    body: { current_password: 'Agent@123', new_password: 'Agent@456' },
  });
  assert.equal(change.status, 200, JSON.stringify(change.json));

  const revoked = await api('GET', '/api/auth/me', { token: tokenB });
  assert.equal(revoked.status, 401, 'الجلسة الأخرى أُبطلت بعد تغيير كلمة المرور');

  const current = await api('GET', '/api/auth/me', { token: tokenA });
  assert.equal(current.status, 200, 'الجلسة الحالية تبقى صالحة');

  const newPwLogin = await api('POST', '/api/auth/login', { body: { email: 'agent.baghdad@rafidain.iq', password: 'Agent@456' } });
  assert.equal(newPwLogin.status, 200, 'الدخول بكلمة المرور الجديدة يعمل');

  // إعادة كلمة المرور لتبقى قابلة للدخول لبقية بيئة الاختبار
  await api('POST', '/api/auth/change-password', {
    token: tokenA,
    body: { current_password: 'Agent@456', new_password: 'Agent@123' },
  });
  const back = await api('POST', '/api/auth/login', { body: { email: 'agent.baghdad@rafidain.iq', password: 'Agent@123' } });
  assert.equal(back.status, 200, 'عودة كلمة المرور الأصلية تنجح');
});

test('M11: إعادة تعيين كلمة المرور (مسؤول) تُبطل جلسات الحساب المستهدف', async () => {
  const email = `sessions-${Date.now()}@test.iq`;
  const reg = await api('POST', '/api/auth/register-customer', {
    body: { name_ar: 'زبون الجلسات', email, phone: '0770-sessions', password: 'Sessions@123', governorate_id: null },
  });
  assert.equal(reg.status, 201, JSON.stringify(reg.json));
  const verify = await api('POST', '/api/auth/verify-email', { body: { token: reg.json.data.verification_token } });
  assert.equal(verify.status, 200, JSON.stringify(verify.json));
  const target = get('SELECT * FROM users WHERE email = ?', [email]);
  const oldToken = verify.json.data.token;
  assert.equal((await api('GET', '/api/auth/me', { token: oldToken })).status, 200, 'جلسة الحساب حية قبل إعادة التعيين');

  const reset = await api('POST', '/api/auth/reset-password', {
    token: tokens.admin,
    body: { user_id: target.id, new_password: 'Reset@12345' },
  });
  assert.equal(reset.status, 200, JSON.stringify(reset.json));

  const after = await api('GET', '/api/auth/me', { token: oldToken });
  assert.equal(after.status, 401, 'جلسة الحساب المستعاد أُبطلت');
  const relogin = await api('POST', '/api/auth/login', { body: { email, password: 'Reset@12345' } });
  assert.equal(relogin.status, 200, 'الدخول بكلمة المرور الجديدة يعمل');
});

test('M10: النقر على ترويج غير موجود/غير نشط لا يُعدّ ولا يستجيب', async () => {
  const missing = await api('POST', '/api/public/promotions/999999/click');
  assert.equal(missing.status, 404, 'ترويج غير موجود يرفض');

  const ended = await api('POST', '/api/public/promotions/0/click');
  assert.ok([400, 404].includes(ended.status), 'معرّف غير صالح يرفض');
});

