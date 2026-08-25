const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

process.env.NODE_ENV = 'test';
process.env.DB_PATH = path.join(os.tmpdir(), `rafidain-test-${process.pid}-${crypto.randomUUID()}.db`);
process.env.JWT_SECRET = 'integration-test-secret';
process.env.RATE_LIMIT_MAX = '100000';
delete process.env.TRUST_PROXY;

const { generateVAPIDKeys } = require('web-push');
const _testVapid = generateVAPIDKeys();
process.env.VAPID_PUBLIC_KEY = _testVapid.publicKey;
process.env.VAPID_PRIVATE_KEY = _testVapid.privateKey;

require('../src/db/seed');

const app = require('../src/app');
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

let adminToken, customerToken, agentToken;

test.before(async () => {
  adminToken = await login('admin@rafidain.iq', 'Admin@123');
  customerToken = await login('customer.demo@rafidain.iq', 'Customer@123');
  agentToken = await login('agent.baghdad@rafidain.iq', 'Agent@123');
});

test.after(() => { server.close(); });

test('لوحة القيادة التنفيذية ترجع بيانات صحيحة للمدير (شهر)', async () => {
  const r = await api('GET', '/api/dashboard/executive?period=month', { token: adminToken });
  assert.equal(r.status, 200);
  assert.equal(r.json.success, true);
  const { kpis, sparkline, period, currentRange, previousRange } = r.json.data;
  assert.equal(period, 'month');
  assert.ok(currentRange && previousRange);
  for (const key of ['orders', 'customers', 'revenue', 'conversion']) {
    assert.ok(kpis[key], `يجب وجود مفتاح ${key}`);
    assert.equal(typeof kpis[key].current, 'number');
    assert.equal(typeof kpis[key].previous, 'number');
    assert.equal(typeof kpis[key].deltaPct, 'number');
  }
  assert.ok(Array.isArray(sparkline));
  assert.equal(sparkline.length, 12);
  for (const s of sparkline) {
    assert.equal(typeof s.orders, 'number');
    assert.equal(typeof s.revenue, 'number');
  }
});

test('لوحة القيادة التنفيذية تعمل لفترات day و week', async () => {
  for (const p of ['day', 'week']) {
    const r = await api('GET', `/api/dashboard/executive?period=${p}`, { token: adminToken });
    assert.equal(r.status, 200, `فترة ${p} يجب أن تعمل`);
    assert.equal(r.json.data.sparkline.length, 12);
  }
});

test('فترة غير صالحة تُرفض بـ 400', async () => {
  const r = await api('GET', '/api/dashboard/executive?period=year', { token: adminToken });
  assert.equal(r.status, 400);
});

test('زبون غير مصرح له بالوصول للوحة التنفيذية (403)', async () => {
  const r = await api('GET', '/api/dashboard/executive?period=month', { token: customerToken });
  assert.equal(r.status, 403);
});

test('وكيل غير مصرح له بالوصول للوحة التنفيذية (403)', async () => {
  const r = await api('GET', '/api/dashboard/executive?period=month', { token: agentToken });
  assert.equal(r.status, 403);
});

test('بدون توكن يُرفض بـ 401', async () => {
  const r = await api('GET', '/api/dashboard/executive?period=month');
  assert.equal(r.status, 401);
});

test('مؤشر العملاء الجدد لا يستعلم عن عمود غير موجود', async () => {
  const r = await api('GET', '/api/dashboard/executive?period=month', { token: adminToken });
  assert.equal(r.status, 200, 'كان يفشل سابقاً بسبب SUM(total_amount) على جدول users');
  assert.equal(typeof r.json.data.kpis.customers.current, 'number');
});

test('متوسط قيمة الطلب (AOV) يُحسب كرقم', async () => {
  const r = await api('GET', '/api/dashboard/executive?period=month', { token: adminToken });
  assert.equal(r.status, 200);
  assert.equal(typeof r.json.data.averages.aov, 'number');
  assert.ok(r.json.data.averages.aov >= 0);
  assert.equal(typeof r.json.data.averages.aovPrevious, 'number');
});

test('توزيع حالات الطلبات يرجع الحالات مع العدد والإيراد', async () => {
  const r = await api('GET', '/api/dashboard/executive?period=month', { token: adminToken });
  assert.equal(r.status, 200);
  const sb = r.json.data.statusBreakdown;
  assert.ok(Array.isArray(sb) && sb.length > 0);
  const completed = sb.find((s) => s.status === 'completed');
  assert.ok(completed, 'يجب وجود حالة مكتمل');
  for (const s of sb) {
    assert.equal(typeof s.status, 'string');
    assert.equal(typeof s.count, 'number');
    assert.equal(typeof s.revenue, 'number');
  }
  const total = sb.reduce((acc, s) => acc + s.count, 0);
  assert.equal(total, r.json.data.kpis.orders.current, 'مجموع الحالات يساوي عدد الطلبات');
});

test('أعلى المحافظات وأعلى المزودين يُرجعان مصنّفين تنازلياً', async () => {
  const r = await api('GET', '/api/dashboard/executive?period=month', { token: adminToken });
  assert.equal(r.status, 200);
  const provs = r.json.data.topProvinces;
  const providers = r.json.data.topProviders;
  assert.ok(Array.isArray(provs));
  assert.ok(Array.isArray(providers));
  for (const list of [provs, providers]) {
    for (const item of list) {
      assert.equal(typeof item.name, 'string');
      assert.equal(typeof item.orders, 'number');
      assert.equal(typeof item.revenue, 'number');
    }
    for (let i = 1; i < list.length; i++) {
      assert.ok(list[i - 1].orders >= list[i].orders, 'يجب أن يكون الترتيب تنازلياً حسب الطلبات');
    }
  }
});

test('قسم الانتباه يرجع أعداد العناصر المعلقة', async () => {
  const r = await api('GET', '/api/dashboard/executive?period=month', { token: adminToken });
  assert.equal(r.status, 200);
  const a = r.json.data.attention;
  assert.equal(typeof a.pendingProviders, 'number');
  assert.equal(typeof a.pendingAgentWithdrawals, 'number');
});

test('نسبة الإنجاز (conversion) محسوبة كنسبة مئوية من الطلبات المكتملة', async () => {
  const r = await api('GET', '/api/dashboard/executive?period=month', { token: adminToken });
  assert.equal(r.status, 200);
  const conv = r.json.data.kpis.conversion;
  assert.ok(conv.current >= 0 && conv.current <= 100, 'نسبة الإنجاز يجب أن تكون بين 0 و100');
  assert.equal(typeof conv.deltaPct, 'number');
});
