const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');

process.env.NODE_ENV = 'test';
process.env.DB_PATH = path.join(os.tmpdir(), `rafidain-coupons-${process.pid}-${crypto.randomUUID()}.db`);
process.env.JWT_SECRET = 'coupons-test-secret';
process.env.RATE_LIMIT_MAX = '100000';
delete process.env.TRUST_PROXY;

const { generateVAPIDKeys } = require('web-push');
const _testVapid = generateVAPIDKeys();
process.env.VAPID_PUBLIC_KEY = _testVapid.publicKey;
process.env.VAPID_PRIVATE_KEY = _testVapid.privateKey;

require('../src/db/seed');
const app = require('../src/app');
const { get, all, run, close } = require('../src/db');

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
let store, rest, product, gov;

test.before(async () => {
  tokens.admin = await login('admin@rafidain.iq', 'Admin@123');
  tokens.provider = await login('provider.demo@rafidain.iq', 'Provider@123');
  tokens.customer = await login('customer.demo@rafidain.iq', 'Customer@123');

  store = get('SELECT * FROM providers WHERE name_ar = ?', ['متجر الرافدين للتجارة']);
  rest = get("SELECT * FROM providers WHERE service_id = (SELECT id FROM services WHERE slug = 'restaurants') ORDER BY id ASC LIMIT 1");
  product = get('SELECT * FROM products WHERE provider_id = ? ORDER BY id ASC LIMIT 1', [store.id]);
  gov = get('SELECT * FROM governorates ORDER BY id ASC LIMIT 1');
  assert.ok(store && rest && product && gov, 'بيانات seed متوفرة');
});

test.after(() => {
  server.close();
  close();
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(process.env.DB_PATH + suffix); } catch (e) { /* تجاهل */ }
  }
});

// ===== دفتر العناوين =====

test('بداية: قائمة العناوين فارغة', async () => {
  const r = await api('GET', '/api/customer/addresses', { token: tokens.customer });
  assert.equal(r.status, 200);
  assert.equal(r.json.data.length, 0);
});

test('إضافة عنوان أول يصبح افتراضياً ويظهر بالقائمة', async () => {
  const add = await api('POST', '/api/customer/addresses', {
    token: tokens.customer,
    body: { label: 'المنزل', name_ar: 'زبون تجريبي', phone: '0770000001', governorate_id: gov.id, address: 'بغداد - الكرادة' },
  });
  assert.equal(add.status, 201, JSON.stringify(add.json));
  assert.equal(add.json.data.is_default, 1, 'أول عنوان افتراضي تلقائياً');

  const list = await api('GET', '/api/customer/addresses', { token: tokens.customer });
  assert.equal(list.json.data.length, 1);
  assert.equal(list.json.data[0].address, 'بغداد - الكرادة');
  assert.equal(list.json.data[0].governorate_name_ar, gov.name_ar);
});

test('إضافة عنوان ثانٍ مع is_default يزيح الافتراضي القديم', async () => {
  const add = await api('POST', '/api/customer/addresses', {
    token: tokens.customer,
    body: { label: 'العمل', address: 'النجف - حي السلام', is_default: 1 },
  });
  assert.equal(add.status, 201, JSON.stringify(add.json));
  assert.equal(add.json.data.is_default, 1);

  const list = await api('GET', '/api/customer/addresses', { token: tokens.customer });
  assert.equal(list.json.data.filter((a) => a.is_default).length, 1, 'عنوان افتراضي واحد فقط');
  const first = list.json.data.find((a) => a.label === 'المنزل');
  assert.equal(first.is_default, 0, 'الأول لم يعد افتراضياً');
});

test('تعديل عنوان يحفظ التغييرات', async () => {
  const list = await api('GET', '/api/customer/addresses', { token: tokens.customer });
  const home = list.json.data.find((a) => a.label === 'المنزل');
  const upd = await api('PUT', `/api/customer/addresses/${home.id}`, {
    token: tokens.customer,
    body: { address: 'بغداد - المنصور - شارع الربيعي' },
  });
  assert.equal(upd.status, 200, JSON.stringify(upd.json));
  assert.equal(upd.json.data.address, 'بغداد - المنصور - شارع الربيعي');
});

test('تعيين عنوان افتراضياً عبر مسار default', async () => {
  const list = await api('GET', '/api/customer/addresses', { token: tokens.customer });
  const home = list.json.data.find((a) => a.label === 'المنزل');
  const r = await api('POST', `/api/customer/addresses/${home.id}/default`, { token: tokens.customer });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.data.is_default, 1);

  const after = await api('GET', '/api/customer/addresses', { token: tokens.customer });
  assert.equal(after.json.data.filter((a) => a.is_default).length, 1);
  assert.equal(after.json.data.find((a) => a.label === 'المنزل').is_default, 1);
});

test('حذف العنوان الافتراضي ينقل الافتراضي لعنوان آخر', async () => {
  const list = await api('GET', '/api/customer/addresses', { token: tokens.customer });
  const home = list.json.data.find((a) => a.label === 'المنزل');
  const del = await api('DELETE', `/api/customer/addresses/${home.id}`, { token: tokens.customer });
  assert.equal(del.status, 200, JSON.stringify(del.json));

  const after = await api('GET', '/api/customer/addresses', { token: tokens.customer });
  assert.equal(after.json.data.length, 1);
  assert.equal(after.json.data[0].is_default, 1, 'بقي عنوان افتراضي واحد');
  assert.equal(after.json.data[0].label, 'العمل');
});

test('حذف العنوان الأخير يفرغ القائمة ويبقى سليماً', async () => {
  const list = await api('GET', '/api/customer/addresses', { token: tokens.customer });
  const del = await api('DELETE', `/api/customer/addresses/${list.json.data[0].id}`, { token: tokens.customer });
  assert.equal(del.status, 200, JSON.stringify(del.json));

  const after = await api('GET', '/api/customer/addresses', { token: tokens.customer });
  assert.equal(after.json.data.length, 0);
});

test('التحقق: عنوان فارغ مرفوض وغير الزبون ممنوع', async () => {
  const bad = await api('POST', '/api/customer/addresses', { token: tokens.customer, body: { address: '  ' } });
  assert.equal(bad.status, 400);

  const anon = await api('GET', '/api/customer/addresses');
  assert.equal(anon.status, 401);

  const prov = await api('GET', '/api/customer/addresses', { token: tokens.provider });
  assert.equal(prov.status, 403, 'المزود ليس زبوناً');
});

// ===== إدارة الكوبونات (ينشرها مزود الخدمة لمتجره) =====

test('إنشاء كوبون نسبة مئوية ينجح ويُقيَّد بمتجر المزود', async () => {
  const r = await api('POST', '/api/provider/coupons', {
    token: tokens.provider,
    body: { code: 'save10', title: 'خصم 10%', discount_type: 'percent', discount_value: 10 },
  });
  assert.equal(r.status, 201, JSON.stringify(r.json));
  assert.equal(r.json.data.code, 'SAVE10');
  assert.equal(r.json.data.discount_type, 'percent');
  assert.equal(r.json.data.provider_id, store.id, 'الكوبون مُقيّد بمتجر المزود نفسه');
  assert.equal(r.json.data.used_count, 0);
});

test('غير المزود ممنوع من إدارة كوبونات المزودين', async () => {
  const asAdmin = await api('POST', '/api/provider/coupons', {
    token: tokens.admin,
    body: { code: 'NOPE', discount_type: 'percent', discount_value: 5 },
  });
  assert.equal(asAdmin.status, 403);

  const asCustomer = await api('GET', '/api/provider/coupons', { token: tokens.customer });
  assert.equal(asCustomer.status, 403);
});

test('رمز مكرر يُرفض ونسبة تتجاوز السقف تُرفض', async () => {
  const dup = await api('POST', '/api/provider/coupons', {
    token: tokens.provider,
    body: { code: 'save10', discount_type: 'percent', discount_value: 5 },
  });
  assert.equal(dup.status, 409);

  const over = await api('POST', '/api/provider/coupons', {
    token: tokens.provider,
    body: { code: 'OVER', discount_type: 'percent', discount_value: 120 },
  });
  assert.equal(over.status, 400);
});

test('تعديل كوبون يحفظ القيم الجديدة', async () => {
  const mk = await api('POST', '/api/provider/coupons', {
    token: tokens.provider,
    body: { code: 'EDITABLE', title: 'قابل للتعديل', discount_type: 'percent', discount_value: 5 },
  });
  assert.equal(mk.status, 201, JSON.stringify(mk.json));
  const id = mk.json.data.id;

  const upd = await api('PUT', `/api/provider/coupons/${id}`, {
    token: tokens.provider,
    body: { discount_value: 15, min_amount: 5000 },
  });
  assert.equal(upd.status, 200, JSON.stringify(upd.json));
  assert.equal(upd.json.data.discount_value, 15);
  assert.equal(upd.json.data.min_amount, 5000);
});

test('إيقاف وتفعيل كوبون', async () => {
  const list = await api('GET', '/api/provider/coupons', { token: tokens.provider });
  const c = list.json.data.find((x) => x.code === 'SAVE10');
  const off = await api('POST', `/api/provider/coupons/${c.id}/toggle`, { token: tokens.provider });
  assert.equal(off.json.data.is_active, 0);
  const on = await api('POST', `/api/provider/coupons/${c.id}/toggle`, { token: tokens.provider });
  assert.equal(on.json.data.is_active, 1);
});

test('حذف كوبون يزيله من القائمة', async () => {
  const mk = await api('POST', '/api/provider/coupons', {
    token: tokens.provider,
    body: { code: 'DELETE_ME', discount_type: 'fixed', discount_value: 1000 },
  });
  const del = await api('DELETE', `/api/provider/coupons/${mk.json.data.id}`, { token: tokens.provider });
  assert.equal(del.status, 200, JSON.stringify(del.json));

  const list = await api('GET', '/api/provider/coupons', { token: tokens.provider });
  assert.equal(list.json.data.some((x) => x.code === 'DELETE_ME'), false);
});

// ===== تطبيق الكوبون في الطلبات =====

test('معاينة كوبون غير صالح تفشل برسالة', async () => {
  const r = await api('GET', '/api/customer/coupons/preview?code=WRONG99&amount=10000&provider_id=' + store.id, { token: tokens.customer });
  assert.equal(r.status, 200);
  assert.equal(r.json.data.valid, false);
  assert.ok(r.json.data.message, 'رسالة توضيحية');
});

test('معاينة كوبون صالح تحسب الخصم', async () => {
  const price = Number(product.price);
  const r = await api('GET', `/api/customer/coupons/preview?code=SAVE10&amount=${price}&provider_id=${store.id}`, { token: tokens.customer });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.data.valid, true);
  assert.equal(r.json.data.discount, Math.round(price * 0.1 * 100) / 100);
});

test('الحد الأدنى للطلب غير محقق يرفض الكوبون', async () => {
  const mk = await api('POST', '/api/provider/coupons', {
    token: tokens.provider,
    body: { code: 'MIN100K', discount_type: 'percent', discount_value: 5, min_amount: 100000 },
  });
  assert.equal(mk.status, 201, JSON.stringify(mk.json));

  const r = await api('GET', '/api/customer/coupons/preview?code=MIN100K&amount=5000&provider_id=' + store.id, { token: tokens.customer });
  assert.equal(r.json.data.valid, false);
  assert.match(r.json.data.message, /الحد الأدنى/);
});

test('كوبون خاص بمزود لا يصح لمزود آخر', async () => {
  const mk = await api('POST', '/api/provider/coupons', {
    token: tokens.provider,
    body: { code: 'STORE_ONLY', discount_type: 'percent', discount_value: 5 },
  });
  assert.equal(mk.status, 201, JSON.stringify(mk.json));

  const r = await api('GET', `/api/customer/coupons/preview?code=STORE_ONLY&amount=50000&provider_id=${rest.id}`, { token: tokens.customer });
  assert.equal(r.json.data.valid, false, 'لا يصح لمزود آخر');
  assert.match(r.json.data.message, /غير صالح لهذا المتجر/);
});

test('إنشاء طلب بكوبون يخصم ويُسجل الاستخدام', async () => {
  const price = Number(product.price);
  const expectedDiscount = Math.round(price * 0.1 * 100) / 100;
  const created = await api('POST', '/api/orders', {
    token: tokens.customer,
    body: {
      provider_id: store.id,
      items: [{ kind: 'products', item_id: product.id, quantity: 1 }],
      coupon_code: 'save10',
      customer_address: 'بغداد - الكرادة',
    },
  });
  assert.equal(created.status, 201, JSON.stringify(created.json));
  const data = created.json.data;
  assert.equal(data.subtotal_amount, price);
  assert.equal(data.discount_amount, expectedDiscount);
  assert.equal(data.total_amount, Math.round((price - expectedDiscount) * 100) / 100);
  assert.equal(data.coupon_code, 'SAVE10');
  assert.ok(data.coupon_id, 'مرجع الكوبون محفوظ');

  const usage = get('SELECT * FROM coupon_usages WHERE coupon_id = (SELECT id FROM coupons WHERE code = ?) AND order_id = ?', ['SAVE10', data.id]);
  assert.ok(usage, 'استخدام الكوبون مسجل');
  assert.equal(usage.discount_amount, expectedDiscount);

  const orders = await api('GET', '/api/orders', { token: tokens.customer });
  const row = orders.json.data.find((o) => o.id === data.id);
  assert.equal(row.discount_amount, expectedDiscount, 'الخصم ظاهر في قائمة الطلبات');
});

test('إعادة استخدام الكوبون مرفوضة بعد حد الاستخدام (لكل زبون)', async () => {
  const r = await api('GET', `/api/customer/coupons/preview?code=SAVE10&amount=50000&provider_id=${store.id}`, { token: tokens.customer });
  assert.equal(r.json.data.valid, false);
  assert.match(r.json.data.message, /استخدمت هذا الكوبون من قبل/);
});

test('كوبون انتهت صلاحيته يُرفض', async () => {
  const mk = await api('POST', '/api/provider/coupons', {
    token: tokens.provider,
    body: { code: 'EXPIRED', discount_type: 'fixed', discount_value: 1000, ends_at: '2020-01-01T00:00:00.000Z' },
  });
  assert.equal(mk.status, 201, JSON.stringify(mk.json));

  const r = await api('GET', `/api/customer/coupons/preview?code=EXPIRED&amount=50000&provider_id=${store.id}`, { token: tokens.customer });
  assert.equal(r.json.data.valid, false);
  assert.match(r.json.data.message, /انتهت صلاحية/);
});

test('إنشاء كوبون بتاريخ تالف يُرفض (لا يبقى خالداً)', async () => {
  const badStart = await api('POST', '/api/provider/coupons', {
    token: tokens.provider,
    body: { code: 'BADSTART', discount_type: 'percent', discount_value: 5, starts_at: 'not-a-date' },
  });
  assert.equal(badStart.status, 400, JSON.stringify(badStart.json));
  assert.match(badStart.json.message, /غير صالح/);

  const badEnd = await api('POST', '/api/provider/coupons', {
    token: tokens.provider,
    body: { code: 'BADEND', discount_type: 'percent', discount_value: 5, ends_at: '13-99-2025' },
  });
  assert.equal(badEnd.status, 400, JSON.stringify(badEnd.json));
  assert.match(badEnd.json.message, /غير صالح/);
});

test('كوبون بنهاية قبل بدايته يُرفض', async () => {
  const r = await api('POST', '/api/provider/coupons', {
    token: tokens.provider,
    body: { code: 'REVERSED', discount_type: 'percent', discount_value: 5, starts_at: '2026-06-01', ends_at: '2026-01-01' },
  });
  assert.equal(r.status, 400, JSON.stringify(r.json));
  assert.match(r.json.message, /بعد تاريخ بدايته/);
});

test('كوبون مخزّن بتاريخ تالف لا يُطبَّق أبداً (لا يصبح خالداً)', async () => {
  const cid = run(
    `INSERT INTO coupons (code, title, discount_type, discount_value, provider_id, starts_at, ends_at, is_active)
     VALUES (?,?,?,?,?,?,?,1)`,
    ['TAMPERED_DATE', 'كوبون بتاريخ تالف', 'percent', 5, store.id, '2026-01-01', 'garbage-date']
  ).lastId;

  const r = await api('GET', `/api/customer/coupons/preview?code=TAMPERED_DATE&amount=50000&provider_id=${store.id}`, { token: tokens.customer });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.data.valid, false, 'التاريخ التالف يجعل الكوبون غير قابل للتطبيق وليس خالداً');
  assert.match(r.json.data.message, /غير صالح/);
});

test('طلبات المكتب الخلفي تتجاهل كوبون الزبون', async () => {
  const price = Number(product.price);
  const created = await api('POST', '/api/orders', {
    token: tokens.admin,
    body: {
      provider_id: store.id,
      customer_id: get('SELECT id FROM users WHERE email = ?', ['customer.demo@rafidain.iq']).id,
      items: [{ kind: 'products', item_id: product.id, quantity: 1 }],
      coupon_code: 'save10',
    },
  });
  assert.equal(created.status, 201, JSON.stringify(created.json));
  assert.equal(created.json.data.discount_amount, 0, 'لا خصم من المكتب الخلفي');
  assert.equal(created.json.data.total_amount, price);
  assert.equal(created.json.data.coupon_code, null);
});
