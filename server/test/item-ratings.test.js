const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');

process.env.NODE_ENV = 'test';
process.env.DB_PATH = path.join(os.tmpdir(), `rafidain-item-ratings-${process.pid}-${crypto.randomUUID()}.db`);
process.env.JWT_SECRET = 'item-ratings-test-secret';
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
let store, product, menuItem, menuProviderToken;

test.before(async () => {
  tokens.admin = await login('admin@rafidain.iq', 'Admin@123');
  tokens.provider = await login('provider.demo@rafidain.iq', 'Provider@123');
  tokens.customer = await login('customer.demo@rafidain.iq', 'Customer@123');
  menuProviderToken = await login('restaurant.demo@rafidain.iq', 'Provider@123');

  store = get('SELECT * FROM providers WHERE name_ar = ?', ['متجر الرافدين للتجارة']);
  product = get('SELECT * FROM products WHERE provider_id = ? ORDER BY id ASC LIMIT 1', [store.id]);
  menuItem = get('SELECT * FROM menu_items ORDER BY id ASC LIMIT 1');
});

test.after(() => {
  server.close();
  close();
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(process.env.DB_PATH + suffix); } catch (e) { /* تجاهل */ }
  }
});

async function completeOrder(providerId, itemKind, itemId, providerToken) {
  const created = await api('POST', '/api/orders', {
    token: tokens.customer,
    body: { provider_id: providerId, items: [{ kind: itemKind, item_id: itemId, quantity: 1 }] },
  });
  assert.equal(created.status, 201, JSON.stringify(created.json));
  const id = created.json.data.id;
  await api('POST', `/api/wallets/${providerId}/recharge`, { token: tokens.admin, body: { amount: 1000000, note: 'شحن لاختبار سير الطلب' } });
  for (const s of ['confirmed', 'in_progress', 'completed']) {
    const r = await api('PUT', `/api/orders/${id}/status`, { token: providerToken || tokens.provider, body: { status: s } });
    assert.equal(r.status, 200, `الانتقال إلى ${s}`);
  }
  return id;
}

test('بداية: لا تقييمات للبند والمعدل صفر ونوع غير معروف يُرفض', async () => {
  const sum = get('SELECT rating, rating_count FROM item_rating_sums WHERE item_type = ? AND item_id = ?', ['products', product.id]);
  assert.ok(!sum || (Number(sum.rating_count) === 0));

  const badKind = await api('GET', `/api/public/items/xyz/${product.id}/reviews`);
  assert.equal(badKind.status, 400, 'نوع بند غير معروف يرفض');

  const missing = await api('GET', '/api/public/items/products/999999/reviews');
  assert.equal(missing.status, 404, 'بند غير موجود يرفض');
});

test('لا يمكن تقييم بند قبل إتمام طلب يشمله', async () => {
  const info = await api('GET', `/api/customer/rate-item/products/${product.id}`, { token: tokens.customer });
  assert.equal(info.status, 200);
  assert.equal(info.json.data.my_rating, 0);

  const denied = await api('POST', `/api/customer/rate-item/products/${product.id}`, {
    token: tokens.customer,
    body: { rating: 5, comment: 'رائع' },
  });
  assert.equal(denied.status, 403, 'لا يمكن التقييم قبل الشراء');
});

test('التقييم صحيح بعد إتمام الطلب ويحدّث معدل البند في الكتالوج', async () => {
  await completeOrder(store.id, 'products', product.id);

  const bad = await api('POST', `/api/customer/rate-item/products/${product.id}`, {
    token: tokens.customer,
    body: { rating: 9 },
  });
  assert.equal(bad.status, 400, 'تقييم خارج 1-5 يرفض');

  const rated = await api('POST', `/api/customer/rate-item/products/${product.id}`, {
    token: tokens.customer,
    body: { rating: 5, comment: 'منتج ممتاز' },
  });
  assert.equal(rated.status, 200, JSON.stringify(rated.json));
  assert.equal(rated.json.data.rating, 5);
  assert.equal(rated.json.data.rating_count, 1);

  const inCatalog = await api('GET', `/api/public/providers/${store.id}/products`);
  assert.equal(inCatalog.status, 200);
  const row = inCatalog.json.data.find((r) => r.id === product.id);
  assert.ok(row, 'المنتج في الكتالوج');
  assert.equal(row.rating_count, 1);
  assert.equal(row.rating, 5);

  const updated = await api('POST', `/api/customer/rate-item/products/${product.id}`, {
    token: tokens.customer,
    body: { rating: 3 },
  });
  assert.equal(updated.status, 200);
  assert.equal(updated.json.data.rating, 3);
  assert.equal(updated.json.data.rating_count, 1, 'التقييم يحدّث لا يضاعف');

  const mine = await api('GET', `/api/customer/rate-item/products/${product.id}`, { token: tokens.customer });
  assert.equal(mine.json.data.my_rating, 3);
});

test('المسار العام يعرض مراجعات البند وردود التقويم', async () => {
  const pub = await api('GET', `/api/public/items/products/${product.id}/reviews`);
  assert.equal(pub.status, 200, JSON.stringify(pub.json));
  const data = pub.json.data;
  assert.equal(data.rating_count, 1);
  assert.equal(data.rating, 3);
  assert.equal(data.reviews.length, 1);
  assert.equal(data.reviews[0].rating, 3);
  assert.equal(data.reviews[0].customer_name, 'زبون تجريبي');
  assert.ok(Array.isArray(data.breakdown) && data.breakdown.some((b) => b.rating === 3 && b.count === 1), 'breakdown=' + JSON.stringify(data.breakdown));
});

test('التقييم يعمل لأنواع بنود أخرى (أصناف المطعم)', async () => {
  const menuProvider = get('SELECT provider_id FROM menu_items WHERE id = ?', [menuItem.id]);
  if (menuItem && menuProvider) {
    await completeOrder(menuProvider.provider_id, 'menu', menuItem.id, menuProviderToken);
    const rated = await api('POST', `/api/customer/rate-item/menu/${menuItem.id}`, {
      token: tokens.customer,
      body: { rating: 4, comment: 'طعم جيد' },
    });
    assert.equal(rated.status, 200, JSON.stringify(rated.json));
    assert.equal(rated.json.data.rating_count, 1);

    const pub = await api('GET', `/api/public/items/menu/${menuItem.id}/reviews`);
    assert.equal(pub.status, 200);
    assert.equal(pub.json.data.reviews.length, 1);
  }
});
