const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');

process.env.NODE_ENV = 'test';
process.env.DB_PATH = path.join(os.tmpdir(), `rafidain-loyalty-${process.pid}-${crypto.randomUUID()}.db`);
process.env.JWT_SECRET = 'loyalty-test-secret';
process.env.RATE_LIMIT_MAX = '100000';
delete process.env.TRUST_PROXY;

const { generateVAPIDKeys } = require('web-push');
const _testVapid = generateVAPIDKeys();
process.env.VAPID_PUBLIC_KEY = _testVapid.publicKey;
process.env.VAPID_PRIVATE_KEY = _testVapid.privateKey;

require('../src/db/seed');
const app = require('../src/app');
const { get, run, close } = require('../src/db');
const { settingValue } = require('../src/utils/helpers');

const server = app.listen(0);
const base = `http://127.0.0.1:${server.address().port}`;

async function api(method, url, { token, body } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(base + url, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  let json = null;
  try { json = await res.json(); } catch (e) { /* غير JSON */ }
  return { status: res.status, json };
}

async function registerCustomer(email) {
  const r = await api('POST', '/api/auth/register-customer', {
    body: {
      name_ar: 'زبون ولاء',
      email,
      phone: `07${Math.floor(10000000 + Math.random() * 89999999)}`,
      password: 'Customer@123',
    },
  });
  assert.equal(r.status, 201, JSON.stringify(r.json));
  const v = await api('POST', '/api/auth/verify-email', { body: { token: r.json.data.verification_token } });
  assert.equal(v.status, 200, JSON.stringify(v.json));
  const l = await api('POST', '/api/auth/login', { body: { email, password: 'Customer@123' } });
  assert.equal(l.status, 200, `تسجيل دخول ${email}`);
  return { userId: r.json.data.user.id, token: l.json.data.token };
}

let tokens = {};
let store, product;

test.before(async () => {
  tokens.admin = await api('POST', '/api/auth/login', { body: { email: 'admin@rafidain.iq', password: 'Admin@123' } }).then((r) => r.json.data.token);
  tokens.provider = await api('POST', '/api/auth/login', { body: { email: 'provider.demo@rafidain.iq', password: 'Provider@123' } }).then((r) => r.json.data.token);
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

async function createOrder(customerToken, extra) {
  const created = await api('POST', '/api/orders', {
    token: customerToken,
    body: { provider_id: store.id, items: [{ kind: 'products', item_id: product.id, quantity: 1 }], ...extra },
  });
  return created;
}

async function completeOrder(orderId) {
  await api('POST', `/api/wallets/${store.id}/recharge`, { token: tokens.admin, body: { amount: 1000000, note: 'شحن اختبار الولاء' } });
  for (const s of ['confirmed', 'in_progress', 'completed']) {
    const r = await api('PUT', `/api/orders/${orderId}/status`, { token: tokens.provider, body: { status: s } });
    assert.equal(r.status, 200, `الانتقال إلى ${s}: ${JSON.stringify(r.json)}`);
  }
}

test('تسجيل بكود إحالة غير صالح يُرفض', async () => {
  const r = await api('POST', '/api/auth/register-customer', {
    body: {
      name_ar: 'كود خاطئ',
      email: 'bad.ref@test.iq',
      phone: '07111111111',
      password: 'Customer@123',
      referral_code: 'RAF-NOT-REAL',
    },
  });
  assert.equal(r.status, 400);
  assert.match(r.json.message, /غير صالح/);
});

test('إحالة الأصدقاء: مكافآت الطرفين عند أول طلب مكتمل', async () => {
  const a = await registerCustomer('referrer.a@test.iq');
  const ref = await api('GET', '/api/customer/referral', { token: a.token });
  assert.equal(ref.status, 200);
  assert.ok(ref.json.data.code.startsWith('RAF'));
  assert.match(ref.json.data.link, new RegExp(`ref=${ref.json.data.code}`));

  const b = await registerCustomer('referee.b@test.iq');
  const created = await createOrder(b.token, { referral_code: undefined });
  const linked = await api('POST', '/api/auth/register-customer', {
    body: {
      name_ar: 'مدعو',
      email: 'invited.c@test.iq',
      phone: '07222222222',
      password: 'Customer@123',
      referral_code: ref.json.data.code,
    },
  });
  assert.equal(linked.status, 201, JSON.stringify(linked.json));
  const v = await api('POST', '/api/auth/verify-email', { body: { token: linked.json.data.verification_token } });
  assert.equal(v.status, 200);
  const c = await api('POST', '/api/auth/login', { body: { email: 'invited.c@test.iq', password: 'Customer@123' } });
  const cToken = c.json.data.token;

  const order = await createOrder(cToken);
  assert.equal(order.status, 201, JSON.stringify(order.json));
  await completeOrder(order.json.data.id);

  const referrerPoints = get('SELECT points_balance FROM users WHERE id = ?', [a.userId]).points_balance;
  const refereePoints = get('SELECT points_balance FROM users WHERE id = ?', [linked.json.data.user.id]).points_balance;
  const earn = Math.floor(Number(order.json.data.total_amount) / 1000) * settingValue('loyalty_earn_per_1000', 10);
  assert.equal(referrerPoints, settingValue('referral_bonus_referrer', 5000));
  assert.equal(refereePoints, settingValue('referral_bonus_referee', 3000) + earn);

  const referralRows = get(
    "SELECT COUNT(*) AS c FROM loyalty_points WHERE order_id = ? AND type = 'referral'",
    [order.json.data.id]
  ).c;
  assert.equal(referralRows, 2, 'مكافأة الإحالة تُمنح مرة واحدة للطرفين');

  const loyalty = await api('GET', '/api/customer/loyalty', { token: cToken });
  assert.equal(loyalty.status, 200);
  assert.equal(loyalty.json.data.points_balance, refereePoints);
  assert.ok(loyalty.json.data.tier.key);
  assert.ok(loyalty.json.data.history.length >= 2);
});

test('مكافأة الإحالة لا تتكرر مع الطلب المكتمل الثاني للمدعو', async () => {
  const a = get('SELECT * FROM users WHERE email = ?', ['referrer.a@test.iq']);
  const c = await api('POST', '/api/auth/login', { body: { email: 'invited.c@test.iq', password: 'Customer@123' } });
  const cToken = c.json.data.token;
  const refereeId = c.json.data.user.id;

  const referrerBefore = get('SELECT points_balance FROM users WHERE id = ?', [a.id]).points_balance;
  const refereeBefore = get('SELECT points_balance FROM users WHERE id = ?', [refereeId]).points_balance;

  const order = await createOrder(cToken);
  assert.equal(order.status, 201, JSON.stringify(order.json));
  await completeOrder(order.json.data.id);

  const referrerAfter = get('SELECT points_balance FROM users WHERE id = ?', [a.id]).points_balance;
  const refereeAfter = get('SELECT points_balance FROM users WHERE id = ?', [refereeId]).points_balance;
  const earn = Math.floor(Number(order.json.data.total_amount) / 1000) * settingValue('loyalty_earn_per_1000', 10);

  assert.equal(referrerAfter, referrerBefore, 'المُحيل لا يحصل على مكافأة إحالة ثانية');
  assert.equal(refereeAfter, refereeBefore + earn, 'المدعو يحصل على نقاط الطلب فقط، لا مكافأة إحالة ثانية');

  const referralRows = get(
    "SELECT COUNT(*) AS c FROM loyalty_points WHERE order_id = ? AND type = 'referral'",
    [order.json.data.id]
  ).c;
  assert.equal(referralRows, 0, 'لا سجل إحالة للطلب الثاني');
});

test('استبدال النقاط بخصم على الطلب يخصم الرصيد ويُسجّل', async () => {
  const c = await api('POST', '/api/auth/login', { body: { email: 'invited.c@test.iq', password: 'Customer@123' } });
  const cToken = c.json.data.token;
  const before = get('SELECT points_balance FROM users WHERE id = ?', [c.json.data.user.id]).points_balance;
  assert.ok(before >= settingValue('loyalty_min_redeem', 100), `رصيد المدعو قبل الاستبدال: ${before}`);

  const r = await createOrder(cToken, { redeem_points: 2000 });
  assert.equal(r.status, 201, JSON.stringify(r.json));
  assert.equal(r.json.data.points_discount_amount, 2000);
  assert.equal(r.json.data.redeemed_points, 2000);
  const after = get('SELECT points_balance FROM users WHERE id = ?', [c.json.data.user.id]).points_balance;
  assert.equal(after, before - 2000);

  const lr = get("SELECT COUNT(*) AS c FROM loyalty_points WHERE user_id = ? AND type = 'redeem'", [c.json.data.user.id]).c;
  assert.equal(lr, 1);
});

test('استبدال نقاط برصيد أقل من الحد الأدنى يُرفض', async () => {
  const d = await registerCustomer('no.points@test.iq');
  const r = await createOrder(d.token, { redeem_points: 50 });
  assert.equal(r.status, 400);
  assert.match(r.json.message, /الحد الأدنى/);
});
