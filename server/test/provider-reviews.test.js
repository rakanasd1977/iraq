const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

process.env.NODE_ENV = 'test';
process.env.DB_PATH = path.join(os.tmpdir(), `rafidain-reviews-${process.pid}-${crypto.randomUUID()}.db`);
process.env.JWT_SECRET = 'reviews-test-secret';
process.env.RATE_LIMIT_MAX = '100000';
delete process.env.TRUST_PROXY;

const { generateVAPIDKeys } = require('web-push');
const _testVapid = generateVAPIDKeys();
process.env.VAPID_PUBLIC_KEY = _testVapid.publicKey;
process.env.VAPID_PRIVATE_KEY = _testVapid.privateKey;

require('../src/db/seed');
const app = require('../src/app');
const { get, close } = require('../src/db');

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
let store, product;

test.before(async () => {
  tokens.admin = await login('admin@rafidain.iq', 'Admin@123');
  tokens.provider = await login('provider.demo@rafidain.iq', 'Provider@123');
  tokens.customer = await login('customer.demo@rafidain.iq', 'Customer@123');

  store = get('SELECT * FROM providers WHERE name_ar = ?', ['متجر الرافدين للتجارة']);
  product = get('SELECT * FROM products WHERE provider_id = ? ORDER BY id ASC LIMIT 1', [store.id]);
});

test.after(() => {
  server.close();
  close();
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(process.env.DB_PATH + suffix); } catch (e) { /* تجاهل */ }
  }
});

async function completeOrder(providerId, itemKind, itemId) {
  const created = await api('POST', '/api/orders', {
    token: tokens.customer,
    body: { provider_id: providerId, items: [{ kind: itemKind, item_id: itemId, quantity: 1 }] },
  });
  assert.equal(created.status, 201, JSON.stringify(created.json));
  const id = created.json.data.id;
  await api('POST', `/api/wallets/${providerId}/recharge`, { token: tokens.admin, body: { amount: 1000000, note: 'شحن لاختبار سير الطلب' } });
  for (const s of ['confirmed', 'in_progress', 'completed']) {
    const r = await api('PUT', `/api/orders/${id}/status`, { token: tokens.provider, body: { status: s } });
    assert.equal(r.status, 200, `الانتقال إلى ${s}`);
  }
  return id;
}

test('بداية: لا مراجعات والمسار يرفض مزوداً غير موجود', async () => {
  const empty = await api('GET', `/api/public/providers/${store.id}/reviews`);
  assert.equal(empty.status, 200);
  assert.equal(empty.json.data.reviews.length, 0);
  assert.deepEqual(empty.json.data.breakdown, []);

  const missing = await api('GET', '/api/public/providers/999999/reviews');
  assert.equal(missing.status, 404);
});

test('مراجعة الزبون مع رد المزود تظهر للعامة في المسار العام', async () => {
  await completeOrder(store.id, 'products', product.id);
  const rated = await api('POST', `/api/customer/rate/${store.id}`, {
    token: tokens.customer,
    body: { rating: 5, comment: 'خدمة ممتازة وسريعة' },
  });
  assert.equal(rated.status, 200, JSON.stringify(rated.json));

  const list = await api('GET', `/api/provider/ratings`, { token: tokens.provider });
  assert.equal(list.status, 200, JSON.stringify(list.json));
  const ratingRow = list.json.data.find((r) => r.customer_name === 'زبون تجريبي');
  assert.ok(ratingRow, 'التقييم يظهر في لوحة المزود');
  const ratingId = ratingRow.id;

  const reply = await api('PUT', `/api/provider/ratings/${ratingId}/reply`, {
    token: tokens.provider,
    body: { reply: 'شكراً لثقتكم!' },
  });
  assert.equal(reply.status, 200, JSON.stringify(reply.json));

  const pub = await api('GET', `/api/public/providers/${store.id}/reviews`);
  assert.equal(pub.status, 200, JSON.stringify(pub.json));
  const data = pub.json.data;
  assert.equal(data.reviews.length, 1);
  const rev = data.reviews[0];
  assert.equal(rev.rating, 5);
  assert.equal(rev.comment, 'خدمة ممتازة وسريعة');
  assert.equal(rev.customer_name, 'زبون تجريبي');
  assert.equal(rev.reply, 'شكراً لثقتكم!');
  assert.ok(rev.replied_at, 'تاريخ الرد محفوظ');
  assert.ok(rev.created_at, 'تاريخ المراجعة محفوظ');
  assert.ok(Array.isArray(data.breakdown) && data.breakdown.some((b) => b.rating === 5 && b.count === 1), 'breakdown=' + JSON.stringify(data.breakdown));
});

test('المسار العام متاح بلا مصادقة', async () => {
  const anon = await api('GET', `/api/public/providers/${store.id}/reviews`);
  assert.equal(anon.status, 200);
  assert.ok(anon.json.data.reviews.length >= 1);
});
