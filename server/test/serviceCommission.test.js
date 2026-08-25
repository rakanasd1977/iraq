const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

process.env.NODE_ENV = 'test';
process.env.DB_PATH = path.join(os.tmpdir(), `rafidain-test-${process.pid}-${crypto.randomUUID()}.db`);
process.env.JWT_SECRET = 'service-commission-test-secret';
process.env.RATE_LIMIT_MAX = '100000';
delete process.env.TRUST_PROXY;

const { generateVAPIDKeys } = require('web-push');
const _testVapid = generateVAPIDKeys();
process.env.VAPID_PUBLIC_KEY = _testVapid.publicKey;
process.env.VAPID_PRIVATE_KEY = _testVapid.privateKey;

require('../src/db/seed');

const app = require('../src/app');
const { get, run, close } = require('../src/db');
const svcMod = require('../src/services/services');

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

const round2 = (x) => Math.round(x * 100) / 100;

let tokens = {};
let store, product, svc;

test.before(async () => {
  tokens.admin = await login('admin@rafidain.iq', 'Admin@123');
  tokens.agent = await login('agent.baghdad@rafidain.iq', 'Agent@123');
  tokens.provider = await login('provider.demo@rafidain.iq', 'Provider@123');
  tokens.customer = await login('customer.demo@rafidain.iq', 'Customer@123');

  store = get('SELECT * FROM providers WHERE name_ar = ?', ['متجر الرافدين للتجارة']);
  product = get('SELECT * FROM products WHERE provider_id = ? ORDER BY id ASC LIMIT 1', [store.id]);
  svc = get('SELECT * FROM services WHERE id = ?', [store.service_id]);
});

test.after(() => {
  server.close();
  close();
  for (const suffix of ['', '-wal', '-shm']) {
    try { require('node:fs').unlinkSync(process.env.DB_PATH + suffix); } catch (e) { /* تجاهل */ }
  }
});

// ------------------------- وحدات منفصلة (Unit) -------------------------
test('resolveRate يُرجِع نسبة الخدمة عند تعيينها', () => {
  assert.equal(svcMod.resolveRate(12, 5), 12);
  assert.equal(svcMod.resolveRate(0, 5), 0);
});

test('resolveRate يسقط إلى نسبة المزود عند غياب نسبة الخدمة', () => {
  assert.equal(svcMod.resolveRate(null, 5), 5);
  assert.equal(svcMod.resolveRate(undefined, 7), 7);
});

test('validRate يقبل القيم الصالحة والفارغة ويرفض خارج النطاق', () => {
  assert.equal(svcMod.validRate(null), true);
  assert.equal(svcMod.validRate(''), true);
  assert.equal(svcMod.validRate(0), true);
  assert.equal(svcMod.validRate(100), true);
  assert.equal(svcMod.validRate(50), true);
  assert.equal(svcMod.validRate(101), false);
  assert.equal(svcMod.validRate(-1), false);
  assert.equal(svcMod.validRate('abc'), false);
});

// ------------------------- قائمة الخدمات -------------------------
test('GET /api/services يرجع حقل commission_rate (فارغ افتراضياً)', async () => {
  const r = await api('GET', '/api/services', { token: tokens.admin });
  assert.equal(r.status, 200);
  assert.ok(Array.isArray(r.json.data));
  assert.ok(r.json.data.length > 0);
  for (const s of r.json.data) {
    assert.ok('commission_rate' in s, 'الحقل موجود في الاستجابة');
    assert.equal(s.commission_rate, null, `الخدمة ${s.slug} بلا نسبة معيّنة بعد`);
  }
});

// ------------------------- إنشاء/تحديث عبر API -------------------------
test('المسؤول ينشئ خدمة بنسبة عمولة ثم يحذفها', async () => {
  const slug = 'svc_test_' + crypto.randomBytes(3).toString('hex');
  const created = await api('POST', '/api/services', {
    token: tokens.admin,
    body: { slug, name_ar: 'خدمة اختبار', name_en: 'Test', commission_rate: 12.5 },
  });
  assert.equal(created.status, 201, JSON.stringify(created.json));
  assert.equal(created.json.data.commission_rate, 12.5);

  const res = await api('DELETE', `/api/services/${created.json.data.id}`, { token: tokens.admin });
  assert.equal(res.status, 200, JSON.stringify(res.json));
});

test('المسؤول يحدّث نسبة عمولة خدمة قائمة', async () => {
  const r = await api('PUT', `/api/services/${svc.id}`, {
    token: tokens.admin,
    body: { commission_rate: 18 },
  });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(Number(r.json.data.commission_rate), 18);

  const reset = await api('PUT', `/api/services/${svc.id}`, {
    token: tokens.admin,
    body: { commission_rate: '' },
  });
  assert.equal(reset.status, 200);
  assert.equal(reset.json.data.commission_rate, null);
});

// ------------------------- التحقق من الصحة (Validation) -------------------------
test('نسبة عمولة خارج 0-100 تُرفض عند الإنشاء', async () => {
  const slug = 'svc_bad_' + crypto.randomBytes(3).toString('hex');
  for (const bad of [150, -5]) {
    const r = await api('POST', '/api/services', {
      token: tokens.admin,
      body: { slug, name_ar: 'خ', name_en: 'X', commission_rate: bad },
    });
    assert.equal(r.status, 400, `نسبة ${bad} يجب أن تُرفض`);
  }
});

test('نسبة عمولة سالبة تُرفض عند التحديث', async () => {
  const r = await api('PUT', `/api/services/${svc.id}`, {
    token: tokens.admin,
    body: { commission_rate: -3 },
  });
  assert.equal(r.status, 400, JSON.stringify(r.json));
});

test('القيمة الفارغة تقبَل (تُعامل افتراضياً) عند الإنشاء', async () => {
  const slug = 'svc_empty_' + crypto.randomBytes(3).toString('hex');
  const r = await api('POST', '/api/services', {
    token: tokens.admin,
    body: { slug, name_ar: 'خ', name_en: 'X', commission_rate: '' },
  });
  assert.equal(r.status, 201, JSON.stringify(r.json));
  assert.equal(r.json.data.commission_rate, null);
  await api('DELETE', `/api/services/${r.json.data.id}`, { token: tokens.admin });
});

// ------------------------- الصلاحيات (Permissions) -------------------------
test('المزود لا يستطيع إنشاء خدمة', async () => {
  const slug = 'svc_p_' + crypto.randomBytes(3).toString('hex');
  const r = await api('POST', '/api/services', {
    token: tokens.provider,
    body: { slug, name_ar: 'خ', name_en: 'X' },
  });
  assert.equal(r.status, 403);
});

test('الزبون لا يستطيع تعديل خدمة', async () => {
  const r = await api('PUT', `/api/services/${svc.id}`, {
    token: tokens.customer,
    body: { commission_rate: 3 },
  });
  assert.equal(r.status, 403);
});

// ------------------------- سلوك حساب العمولة في الطلبات -------------------------
test('إنشاء طلب يستخدم نسبة عمولة الخدمة عند تعيينها', async () => {
  run('UPDATE services SET commission_rate = 12 WHERE id = ?', [svc.id]);
  const created = await api('POST', '/api/orders', {
    token: tokens.customer,
    body: { provider_id: store.id, items: [{ kind: 'products', item_id: product.id, quantity: 1 }] },
  });
  assert.equal(created.status, 201, JSON.stringify(created.json));
  const total = created.json.data.total_amount;
  const expected = round2(total * 12 / 100);
  assert.ok(Math.abs(created.json.data.commission_amount - expected) < 0.01, `commission=${created.json.data.commission_amount} expected=${expected}`);
});

test('إنشاء طلب يسقط إلى نسبة المزود عند عدم تعيين نسبة الخدمة', async () => {
  run('UPDATE services SET commission_rate = NULL WHERE id = ?', [svc.id]);
  const created = await api('POST', '/api/orders', {
    token: tokens.customer,
    body: { provider_id: store.id, items: [{ kind: 'products', item_id: product.id, quantity: 1 }] },
  });
  assert.equal(created.status, 201, JSON.stringify(created.json));
  const total = created.json.data.total_amount;
  const expected = round2(total * Number(store.commission_rate) / 100);
  assert.ok(Math.abs(created.json.data.commission_amount - expected) < 0.01, `commission=${created.json.data.commission_amount} expected=${expected}`);
});
