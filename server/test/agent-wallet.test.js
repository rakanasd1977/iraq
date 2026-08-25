const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');

process.env.NODE_ENV = 'test';
process.env.DB_PATH = path.join(os.tmpdir(), `rafidain-wallet-${process.pid}-${crypto.randomUUID()}.db`);
process.env.JWT_SECRET = 'agent-wallet-test-secret';
process.env.RATE_LIMIT_MAX = '100000';
delete process.env.TRUST_PROXY;

const { generateVAPIDKeys } = require('web-push');
const _testVapid = generateVAPIDKeys();
process.env.VAPID_PUBLIC_KEY = _testVapid.publicKey;
process.env.VAPID_PRIVATE_KEY = _testVapid.privateKey;

require('../src/db/seed');
const app = require('../src/app');
const { get, run, close } = require('../src/db');

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
let store, agent;

test.before(async () => {
  tokens.admin = await login('admin@rafidain.iq', 'Admin@123');
  tokens.agent = await login('agent.baghdad@rafidain.iq', 'Agent@123');
  tokens.provider = await login('provider.demo@rafidain.iq', 'Provider@123');
  tokens.customer = await login('customer.demo@rafidain.iq', 'Customer@123');

  store = get('SELECT * FROM providers WHERE name_ar = ?', ['متجر الرافدين للتجارة']);
  agent = get('SELECT * FROM agents WHERE governorate_id = ?', [store.governorate_id]);
  assert.ok(store && agent, 'بيانات seed متوفرة');
});

test.after(() => {
  server.close();
  close();
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(process.env.DB_PATH + suffix); } catch (e) { /* تجاهل */ }
  }
});

async function createAndCompleteOrder() {
  const charge = await api('POST', `/api/wallets/${store.id}/recharge`, { token: tokens.admin, body: { amount: 1000000, note: 'شحن لاختبار محفظة الوكيل' } });
  assert.equal(charge.status, 200, JSON.stringify(charge.json));
  const create = await api('POST', '/api/orders', {
    token: tokens.agent,
    body: {
      provider_id: store.id,
      customer_name: 'زبون اختبار المحفظة',
      items: [{ title: 'بند اختبار', quantity: 1, unit_price: 100000 }],
    },
  });
  assert.equal(create.status, 201, JSON.stringify(create.json));
  const orderId = create.json.data.id;
  for (const st of ['confirmed', 'in_progress', 'completed']) {
    const r = await api('PUT', `/api/orders/${orderId}/status`, { token: tokens.provider, body: { status: st } });
    assert.equal(r.status, 200, `الانتقال إلى ${st}: ` + JSON.stringify(r.json));
  }
  return orderId;
}

test('محفظة الوكيل: رصيد صفر ثم أرباح الطلبات المكتملة', async () => {
  let w = await api('GET', '/api/agent/wallet', { token: tokens.agent });
  assert.equal(w.status, 200);
  assert.equal(w.json.data.balance.available, 0);

  await createAndCompleteOrder();

  w = await api('GET', '/api/agent/wallet', { token: tokens.agent });
  assert.equal(w.status, 200);
  assert.ok(w.json.data.balance.total_earned > 0, 'العمولة ظهرت بعد إكمال الطلب');
  assert.equal(w.json.data.balance.available, w.json.data.balance.total_earned);
  assert.ok(w.json.data.income.length >= 1);
});

test('سحب: رفض المبالغ غير الصالحة والمبالغ التي تتجاوز الرصيد', async () => {
  const bad1 = await api('POST', '/api/agent/wallet/withdraw', { token: tokens.agent, body: { amount: 500 } });
  assert.equal(bad1.status, 400, 'أقل من 1000');
  const bad2 = await api('POST', '/api/agent/wallet/withdraw', { token: tokens.agent, body: { amount: -5 } });
  assert.equal(bad2.status, 400);
  const bad3 = await api('POST', '/api/agent/wallet/withdraw', { token: tokens.agent, body: { amount: 1e9 } });
  assert.equal(bad3.status, 400, 'يتجاوز الرصيد');
});

test('سحب: طلب صالح يظهر قيدياً ويُجمد الرصيد المتاح', async () => {
  const w0 = await api('GET', '/api/agent/wallet', { token: tokens.agent });
  const available = w0.json.data.balance.available;
  const req = await api('POST', '/api/agent/wallet/withdraw', { token: tokens.agent, body: { amount: available, notes: 'استلام يدوي' } });
  assert.equal(req.status, 201, JSON.stringify(req.json));
  assert.equal(req.json.data.status, 'pending');

  const w1 = await api('GET', '/api/agent/wallet', { token: tokens.agent });
  assert.equal(w1.json.data.balance.pending_withdrawals, available);
  assert.equal(w1.json.data.balance.available, 0, 'السحب القيدي يُجمّد الرصيد');
});

test('الزائر/الزبون/المزود ممنوعون من مسارات المحفظة', async () => {
  const anon = await api('GET', '/api/agent/wallet');
  assert.equal(anon.status, 401);
  const cust = await api('GET', '/api/agent/wallet', { token: tokens.customer });
  assert.equal(cust.status, 403);
  const prov = await api('GET', '/api/agent/wallet', { token: tokens.provider });
  assert.equal(prov.status, 403);
});

test('المسؤول: قائمة سحوبات الوكلاء + اعتماد يخفض الرصيد ويُشعر الوكيل', async () => {
  const list = await api('GET', '/api/agent-withdrawals?status=pending', { token: tokens.admin });
  assert.equal(list.status, 200);
  assert.ok(list.json.data.length >= 1, 'يوجد طلب سحب قيد الانتظار');
  const w = list.json.data[0];

  const before = await api('GET', '/api/agent/wallet', { token: tokens.agent });
  const approve = await api('POST', `/api/agent-withdrawals/${w.id}/decision`, { token: tokens.admin, body: { decision: 'approved' } });
  assert.equal(approve.status, 200, JSON.stringify(approve.json));
  assert.equal(approve.json.data.status, 'approved');

  const after = await api('GET', '/api/agent/wallet', { token: tokens.agent });
  assert.equal(after.json.data.balance.approved_withdrawals, before.json.data.balance.approved_withdrawals + w.amount);
  assert.ok(after.json.data.withdrawals.some((x) => x.id === w.id && x.status === 'approved'));

  const notify = get('SELECT * FROM notifications WHERE user_id = (SELECT user_id FROM agents WHERE id = ?) AND type = ? ORDER BY id DESC LIMIT 1', [agent.id, 'wallet']);
  assert.ok(notify && notify.title.includes('الموافقة'), 'إشعار الموافقة أُرسل للوكيل');
});

test('المسؤول: قرار مزدوج مرفوض وغير المسؤول ممنوع', async () => {
  const list = await api('GET', '/api/agent-withdrawals', { token: tokens.admin });
  const w = list.json.data[0];
  const dup = await api('POST', `/api/agent-withdrawals/${w.id}/decision`, { token: tokens.admin, body: { decision: 'rejected' } });
  assert.equal(dup.status, 400, 'تم البت مسبقاً');

  const agentAttempt = await api('GET', '/api/agent-withdrawals', { token: tokens.agent });
  assert.equal(agentAttempt.status, 403);
});

test('جرس الوكيل: طلب جديد في محافظته يظهر كإشعار غير مقروء ويُقرأ', async () => {
  run('DELETE FROM notifications WHERE user_id = (SELECT user_id FROM agents WHERE id = ?)', [agent.id]);

  const product = get('SELECT * FROM products WHERE provider_id = ? ORDER BY id ASC LIMIT 1', [store.id]);
  const order = await api('POST', '/api/orders', {
    token: tokens.customer,
    body: { provider_id: store.id, items: [{ kind: 'products', item_id: product.id, quantity: 1 }] },
  });
  assert.equal(order.status, 201, JSON.stringify(order.json));

  const bell = await api('GET', '/api/notifications?limit=10', { token: tokens.agent });
  assert.equal(bell.status, 200, JSON.stringify(bell.json));
  const notice = bell.json.data.find((n) => n.type === 'order' && String(n.title).includes('محافظتك'));
  assert.ok(notice, 'إشعار «طلب جديد في محافظتك» موجود في جرس الوكيل');
  assert.equal(notice.is_read, 0, 'الإشعار الجديد غير مقروء');
  assert.equal(bell.json.meta.unread, 1);

  const mark = await api('POST', `/api/notifications/${notice.id}/read`, { token: tokens.agent });
  assert.equal(mark.status, 200, JSON.stringify(mark.json));
  assert.equal(mark.json.data.unread, 0);
  assert.equal(get('SELECT is_read FROM notifications WHERE id = ?', [notice.id]).is_read, 1);
});
