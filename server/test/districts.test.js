const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

process.env.NODE_ENV = 'test';
process.env.DB_PATH = path.join(os.tmpdir(), `rafidain-districts-${process.pid}-${crypto.randomUUID()}.db`);
process.env.JWT_SECRET = 'integration-test-secret';
process.env.RATE_LIMIT_MAX = '100000';
delete process.env.TRUST_PROXY;

require('../src/db/seed');

const app = require('../src/app');
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
async function login(email, password) {
  const r = await api('POST', '/api/auth/login', { body: { email, password } });
  assert.equal(r.status, 200, `تسجيل دخول ${email} فشل`);
  return r.json.data.token;
}

let adminToken, viewerToken, govId;

test.before(async () => {
  adminToken = await login('admin@rafidain.iq', 'Admin@123');
  viewerToken = await login('viewer.demo@rafidain.iq', 'Viewer@123');
  const g = await api('GET', '/api/governorates', { token: adminToken });
  govId = g.json.data[0].id;
});

test.after(() => { server.close(); });

test('قائمة الأقضية تُرجع الأقضية المبذورة', async () => {
  const r = await api('GET', '/api/districts', { token: adminToken });
  assert.equal(r.status, 200);
  assert.ok(Array.isArray(r.json.data) && r.json.data.length >= 4, 'يجب أن توجد أقضية مبذورة');
  const linked = r.json.data.find((d) => d.agent);
  assert.ok(linked, 'يجب أن يظهر وكيل القضاء الرصافة مرتبطاً');
});

test('إنشاء قضاء بنجاح', async () => {
  const r = await api('POST', '/api/districts', { token: adminToken, body: { governorate_id: govId, name_ar: 'قضاء اختبار', name_en: 'Test', code: 'TST', lease_fee: 250000 } });
  assert.equal(r.status, 201);
  assert.equal(r.json.data.code, 'TST');
  assert.equal(r.json.data.lease_fee, 250000);
});

test('رفض رمز قضاء مكرر في نفس المحافظة', async () => {
  const r = await api('POST', '/api/districts', { token: adminToken, body: { governorate_id: govId, name_ar: 'مكرر', name_en: 'Dup', code: 'TST' } });
  assert.equal(r.status, 409);
});

test('وكيل قضاء: إنشاء + رفض التكرار + رسم إجارة القضاء', async () => {
  const d = await api('POST', '/api/districts', { token: adminToken, body: { governorate_id: govId, name_ar: 'قضاء وكيل', name_en: 'Agent', code: 'AGT', lease_fee: 432100 } });
  assert.equal(d.status, 201);
  const distId = d.json.data.id;
  const fee = d.json.data.lease_fee;

  const a = await api('POST', '/api/agents', { token: adminToken, body: { name_ar: 'وكيل القضاء', email: `agent.${crypto.randomUUID().slice(0, 8)}@rafidain.iq`, password: 'Xyz12345', district_id: distId, commission_rate: 3 } });
  assert.equal(a.status, 201);
  assert.equal(a.json.data.district_id, distId);
  assert.equal(a.json.data.district_name_ar, 'قضاء وكيل');

  // لا يجوز وكيل ثانٍ لنفس القضاء
  const dup = await api('POST', '/api/agents', { token: adminToken, body: { name_ar: 'وكيل ثان', email: `agent2.${crypto.randomUUID().slice(0, 8)}@rafidain.iq`, password: 'Xyz12345', district_id: distId } });
  assert.equal(dup.status, 409);

  // تجديد الإجارة يستخدم رسم القضاء (لا رسم المحافظة)
  const renew = await api('POST', `/api/agents/${a.json.data.id}/renew-lease`, { token: adminToken, body: { approve: 1 } });
  assert.equal(renew.status, 200);
  assert.equal(renew.json.data.amount, fee, 'يجب أن يُستخدم رسم إجارة القضاء');

  // لا يمكن حذف قضاء عليه وكيل
  const del = await api('DELETE', `/api/districts/${distId}`, { token: adminToken });
  assert.equal(del.status, 409);
});

test('الوكيل على مستوى المحافظة والوكيل على مستوى القضاء يتعايشان', async () => {
  // بغداد لها وكيل محافظة مبذور + وكيل قضاء الرصافة؛ التأكد أن إنشاء وكيل قضاء جديد ببغداد لا يتعارض مع وكيل المحافظة
  const r = await api('POST', '/api/districts', { token: adminToken, body: { governorate_id: govId, name_ar: 'قضاء ثانٍ', name_en: 'Second', code: 'SEC', lease_fee: 1000 } });
  assert.equal(r.status, 201);
  const a = await api('POST', '/api/agents', { token: adminToken, body: { name_ar: 'وكيل ثانٍ', email: `agent3.${crypto.randomUUID().slice(0, 8)}@rafidain.iq`, password: 'Xyz12345', district_id: r.json.data.id } });
  assert.equal(a.status, 201);
});

test('صلاحيات RBAC: المشاهد لا يمكنه إنشاء قضاء', async () => {
  const r = await api('POST', '/api/districts', { token: viewerToken, body: { governorate_id: govId, name_ar: 'ممنوع', name_en: 'No', code: 'NOO' } });
  assert.equal(r.status, 403);
});

test('المشاهد يستطيع عرض الأقضية', async () => {
  const r = await api('GET', '/api/districts', { token: viewerToken });
  assert.equal(r.status, 200);
});
