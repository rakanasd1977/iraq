const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');

process.env.NODE_ENV = 'test';
process.env.DB_PATH = path.join(os.tmpdir(), `rafidain-reports-${process.pid}-${crypto.randomUUID()}.db`);
process.env.JWT_SECRET = 'reports-test-secret';
process.env.RATE_LIMIT_MAX = '100000';
delete process.env.TRUST_PROXY;

const { generateVAPIDKeys } = require('web-push');
const _testVapid = generateVAPIDKeys();
process.env.VAPID_PUBLIC_KEY = _testVapid.publicKey;
process.env.VAPID_PRIVATE_KEY = _testVapid.privateKey;

require('../src/db/seed');
const app = require('../src/app');
const { get, run, close } = require('../src/db');
const { localDayUtcBoundary, parseDateRange, ApiError } = require('../src/utils/helpers');

const server = app.listen(0);
const base = `http://127.0.0.1:${server.address().port}`;

async function api(method, url, { token, body } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(base + url, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  const text = Buffer.from(await res.arrayBuffer()).toString('utf8');
  let json = null;
  try { json = JSON.parse(text); } catch (e) { /* غير JSON */ }
  return { status: res.status, json, text, contentType: res.headers.get('content-type') || '' };
}

async function login(email, password) {
  const r = await api('POST', '/api/auth/login', { body: { email, password } });
  assert.equal(r.status, 200, `تسجيل دخول ${email}`);
  return r.json.data.token;
}

let tokens = {};
let store;

test.before(async () => {
  tokens.admin = await login('admin@rafidain.iq', 'Admin@123');
  tokens.agent = await login('agent.baghdad@rafidain.iq', 'Agent@123');
  tokens.provider = await login('provider.demo@rafidain.iq', 'Provider@123');
  tokens.customer = await login('customer.demo@rafidain.iq', 'Customer@123');
  store = get('SELECT * FROM providers WHERE name_ar = ?', ['متجر الرافدين للتجارة']);
  assert.ok(store, 'بيانات seed متوفرة');
});

test.after(() => {
  server.close();
  close();
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(process.env.DB_PATH + suffix); } catch (e) { /* تجاهل */ }
  }
});

// ------------------------- وحدة: حدود التاريخ ونطاقه -------------------------

test('وحدة: localDayUtcBoundary يحوّل تاريخاً محلياً إلى بداية ونهاية اليوم UTC', () => {
  const start = localDayUtcBoundary('2026-01-15', false);
  const end = localDayUtcBoundary('2026-01-15', true);
  assert.match(start, /^2026-01-1[45]T/);
  assert.ok(new Date(start) <= new Date('2026-01-15T12:00:00Z'), 'البداية لا تتجاوز منتصف النهار');
  assert.ok(new Date(end) >= new Date('2026-01-15T12:00:00Z'), 'النهاية تتجاوز منتصف النهار');
  assert.ok(new Date(end) > new Date(start), 'النهاية بعد البداية');
});

test('وحدة: localDayUtcBoundary يرفض الصيغ الخاطئة', () => {
  assert.equal(localDayUtcBoundary('', false), null);
  assert.equal(localDayUtcBoundary('15-01-2026', false), null);
  assert.equal(localDayUtcBoundary('2026-1-1', false), null);
  assert.equal(localDayUtcBoundary('2026/01/15', false), null);
  assert.equal(localDayUtcBoundary('not-a-date', false), null);
});

test('وحدة: parseDateRange يحقق النطاق ويحوّل حديه', () => {
  const r = parseDateRange('2026-01-01', '2026-01-31');
  assert.ok(r.fromUtc && r.toUtc && new Date(r.fromUtc) <= new Date(r.toUtc));
  const empty = parseDateRange(undefined, '');
  assert.equal(empty.fromUtc, null);
  assert.equal(empty.toUtc, null);
});

test('وحدة: parseDateRange يرفض الصيغة الخاطئة والنطاق المعكوس', () => {
  assert.throws(() => parseDateRange('abc', '2026-01-01'), (e) => e instanceof ApiError && e.status === 400);
  assert.throws(() => parseDateRange('2026-01-01', 'x'), (e) => e instanceof ApiError && e.status === 400);
  assert.throws(() => parseDateRange('2026-05-01', '2026-04-01'), (e) => e instanceof ApiError && e.status === 400);
});

// ------------------------- تصدير داشبورد الوكيل -------------------------

test('تصدير داشبورد الوكيل: CSV برؤوس الأقسام وتضمين الأرقام', async () => {
  const r = await api('GET', '/api/agent/dashboard/export', { token: tokens.agent });
  assert.equal(r.status, 200);
  assert.match(r.contentType, /text\/csv/, 'نوع المحتوى CSV');
  assert.ok(r.text.startsWith('\uFEFF'), 'يبدأ بـ BOM لترميز العربية');
  for (const h of ['لوحة الوكيل', 'إجمالي الطلبات', 'الطلبات حسب الحالة', 'الخدمة', 'الشهر', 'الزبون']) {
    assert.ok(r.text.includes(h), `يحتوي على قسم ${h}`);
  }
});

test('تصدير داشبورد الوكيل: زائر 401 والزبون/المزود 403', async () => {
  assert.equal((await api('GET', '/api/agent/dashboard/export')).status, 401);
  assert.equal((await api('GET', '/api/agent/dashboard/export', { token: tokens.customer })).status, 403);
  assert.equal((await api('GET', '/api/agent/dashboard/export', { token: tokens.provider })).status, 403);
});

// ------------------------- فلتر تاريخ سجل النشاط -------------------------

async function stampActivity(daysAgo) {
  const ts = new Date(Date.now() - daysAgo * 86400000).toISOString().replace('T', ' ').slice(0, 19);
  run("INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, created_at) VALUES (?, 'create', 'service', 1, NULL, ?)",
    [get('SELECT user_id FROM agents WHERE id = 1').user_id, ts]);
}

test('نشاط الوكيل: فلتر from/to يحدد النطاق ولا يتجاوزه', async () => {
  run("DELETE FROM activity_log WHERE action = 'create' AND entity_type = 'service'");
  await stampActivity(40);
  await stampActivity(5);

  const recent = await api('GET', '/api/agent/activity?from=2020-01-01&to=2030-01-01', { token: tokens.agent });
  assert.equal(recent.status, 200);
  const own = recent.json.data.filter((a) => a.entity_type === 'service' && a.action === 'create');
  assert.equal(own.length, 2, 'كل السجلات المختومة ضمن نطاق عريض');

  const past = await api('GET', '/api/agent/activity?from=2020-01-01&to=2025-01-01', { token: tokens.agent });
  assert.equal(past.status, 200);
  const pastOwn = past.json.data.filter((a) => a.entity_type === 'service' && a.action === 'create');
  assert.equal(pastOwn.length, 0, 'سجلات 2026 خارج نطاق 2020-2025');
});

test('نشاط المسؤول: from/to يعمل ويرفض الصيغة الخاطئة', async () => {
  const ok = await api('GET', '/api/activity?from=2020-01-01&to=2030-01-01', { token: tokens.admin });
  assert.equal(ok.status, 200);
  assert.ok(Array.isArray(ok.json.data));
  const bad = await api('GET', '/api/activity?from=bad-date', { token: tokens.admin });
  assert.equal(bad.status, 400);
});

test('نشاط المسؤول: الزبون/الوكيل ممنوعون (403)', async () => {
  assert.equal((await api('GET', '/api/activity?from=2026-01-01', { token: tokens.agent })).status, 403);
  assert.equal((await api('GET', '/api/activity?from=2026-01-01', { token: tokens.customer })).status, 403);
  assert.equal((await api('GET', '/api/activity?from=2026-01-01')).status, 401);
});

// ------------------------- التقرير المالي -------------------------

async function createOrderAt(utcTs) {
  await api('POST', `/api/wallets/${store.id}/recharge`, { token: tokens.admin, body: { amount: 1000000, note: 'شحن لاختبار التقرير المالي' } });
  const c = await api('POST', '/api/orders', {
    token: tokens.agent,
    body: { provider_id: store.id, customer_name: 'زبون التقرير', items: [{ title: 'بند', quantity: 1, unit_price: 50000 }] },
  });
  assert.equal(c.status, 201, JSON.stringify(c.json));
  run('UPDATE orders SET created_at = ? WHERE id = ?', [utcTs, c.json.data.id]);
  return c.json.data.id;
}

test('التقرير المالي: ملخص وتفصيل حسب الشهر', async () => {
  const orderId = await createOrderAt('2026-03-10 12:00:00');
  const r = await api('GET', '/api/financial-report', { token: tokens.admin });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.ok(r.json.data.summary && Array.isArray(r.json.data.rows));
  assert.equal(r.json.data.period.group_by, 'month');
  assert.ok(Number(r.json.data.summary.orders_count) >= 1, 'يوجد طلب للعد');
  assert.ok(Number(r.json.data.summary.orders_value) >= 50000, 'قيمة الطلبات تشمل الطلب المنشأ');
  assert.equal(typeof r.json.data.summary.platform_revenue, 'number');
  assert.equal(typeof r.json.data.summary.avg_order_value, 'number');
  run('DELETE FROM orders WHERE id = ?', [orderId]);
});

test('التقرير المالي: نطاق تاريخي يحصي طلبات النطاق فقط مع حدود اليوم الشامل', async () => {
  const a = await createOrderAt('2026-01-15 12:00:00');
  const b = await createOrderAt('2026-02-20 12:00:00');

  const jan = await api('GET', '/api/financial-report?from=2026-01-01&to=2026-01-31&group_by=month', { token: tokens.admin });
  assert.equal(jan.status, 200, JSON.stringify(jan.json));
  const janRow = jan.json.data.rows.find((x) => x.label === '2026-01');
  assert.ok(janRow && janRow.orders_count >= 1, 'طلبات يناير ضمن النطاق');
  assert.equal(janRow.orders_count, 1, 'طلب فبراير خارج نطاق يناير');
  assert.ok(jan.json.data.rows.some((x) => x.label === '2026-02') === false, 'لا يظهر فبراير');

  const none = await api('GET', '/api/financial-report?from=2030-01-01&to=2030-12-31', { token: tokens.admin });
  assert.equal(none.status, 200);
  assert.equal(none.json.data.rows.length, 0, 'نطاق مستقبلي بلا طلبات');
  assert.equal(none.json.data.summary.orders_count, 0);
  assert.equal(none.json.data.summary.orders_value, 0);

  const sameDay = await api('GET', '/api/financial-report?from=2026-01-15&to=2026-01-15&group_by=day', { token: tokens.admin });
  assert.equal(sameDay.status, 200, JSON.stringify(sameDay.json));
  const dayRow = sameDay.json.data.rows.find((x) => x.label === '2026-01-15');
  assert.ok(dayRow && dayRow.orders_count >= 1, 'طلب منتصف اليوم 15 ضمن يوم 15');

  const before = await api('GET', '/api/financial-report?from=2026-01-01&to=2026-01-14&group_by=day', { token: tokens.admin });
  const beforeRow = before.json.data.rows.find((x) => x.label === '2026-01-15');
  assert.ok(!beforeRow, 'طلب 15 لا يظهر عند نهاية 14');

  run('DELETE FROM orders WHERE id IN (?, ?)', [a, b]);
});

test('التقرير المالي: أبعاد التجميع الأخرى تعمل', async () => {
  for (const g of ['day', 'week', 'month', 'governorate', 'service', 'agent', 'provider']) {
    const r = await api('GET', `/api/financial-report?group_by=${g}`, { token: tokens.admin });
    assert.equal(r.status, 200, `group_by=${g} → ` + JSON.stringify(r.json));
    assert.ok(Array.isArray(r.json.data.rows));
    for (const row of r.json.data.rows) assert.ok(row.label !== undefined && row.label !== '', `label لـ ${g}`);
  }
});

test('التقرير المالي: تحقق من المدخلات (400)', async () => {
  const cases = [
    '/api/financial-report?group_by=bogus',
    '/api/financial-report?from=not-a-date',
    '/api/financial-report?to=zzz',
    '/api/financial-report?from=2026-05-01&to=2026-04-01',
    '/api/financial-report?governorate_id=abc',
    '/api/financial-report?service_id=-3',
  ];
  for (const url of cases) {
    const r = await api('GET', url, { token: tokens.admin });
    assert.equal(r.status, 400, `${url} يجب أن يرفض (400)`);
  }
});

test('التقرير المالي: صلاحيات — زائر 401 وغير المسؤول 403', async () => {
  assert.equal((await api('GET', '/api/financial-report')).status, 401);
  assert.equal((await api('GET', '/api/financial-report', { token: tokens.customer })).status, 403);
  assert.equal((await api('GET', '/api/financial-report', { token: tokens.provider })).status, 403);
  assert.equal((await api('GET', '/api/financial-report', { token: tokens.agent })).status, 403);
  assert.equal((await api('GET', '/api/financial-report/export', { token: tokens.agent })).status, 403);
});

test('التقرير المالي: تصدير CSV مطابق لتجميع JSON', async () => {
  const json = await api('GET', '/api/financial-report?group_by=month', { token: tokens.admin });
  const csv = await api('GET', '/api/financial-report/export?group_by=month', { token: tokens.admin });
  assert.equal(csv.status, 200);
  assert.ok(csv.text.startsWith('\uFEFF'), 'BOM للعربية');
  assert.ok(csv.text.includes('التصنيف'));
  assert.ok(csv.text.includes('إيراد المنصة'));
  const lines = csv.text.split(/\r?\n/).filter(Boolean).slice(1);
  assert.equal(lines.length, json.json.data.rows.length, 'صفوف CSV تطابق صفوف JSON');
});
