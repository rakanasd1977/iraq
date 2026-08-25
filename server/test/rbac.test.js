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
const { get, run } = require('../src/db');
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

let adminToken;

test.before(async () => {
  adminToken = await login('admin@rafidain.iq', 'Admin@123');
});

test.after(() => { server.close(); });

test('قائمة الأدوار ترجع مصفوفة تتضمن أدوار النظام', async () => {
  const r = await api('GET', '/api/rbac/roles', { token: adminToken });
  assert.equal(r.status, 200);
  assert.ok(Array.isArray(r.json.data));
  const names = r.json.data.map((x) => x.name);
  assert.ok(names.includes('super_admin'));
  const superRole = r.json.data.find((x) => x.name === 'super_admin');
  assert.ok(superRole.is_system);
  assert.ok(Array.isArray(superRole.permissions) && superRole.permissions.length > 0);
});

test('قائمة الموارد ترجع الموارد وإجراءاتها', async () => {
  const r = await api('GET', '/api/rbac/resources', { token: adminToken });
  assert.equal(r.status, 200);
  assert.ok(Array.isArray(r.json.data) && r.json.data.length > 0);
  const roles = r.json.data.find((x) => x.key === 'roles');
  assert.ok(roles, 'يجب وجود مورد الأدوار');
  assert.ok(roles.actions.includes('view') && roles.actions.includes('edit'));
  const fin = r.json.data.find((x) => x.key === 'financial_reports');
  assert.ok(fin.actions.includes('export') && !fin.actions.includes('create'), 'التقارير المالية لا تدعم الإنشاء');
});

test('قائمة المستخدمين بأدوارهم', async () => {
  const r = await api('GET', '/api/rbac/users', { token: adminToken });
  assert.equal(r.status, 200);
  assert.ok(Array.isArray(r.json.data));
  const admin = r.json.data.find((u) => u.email === 'admin@rafidain.iq');
  assert.ok(admin);
  assert.ok((admin.assigned_roles || []).some((x) => x.name === 'super_admin'));
});

test('إنشاء دور مخصص وتعيين صلاحياته', async () => {
  const c = await api('POST', '/api/rbac/roles', { token: adminToken, body: { name: 'content_mgr', name_ar: 'مدير محتوى', description: 'test' } });
  assert.equal(c.status, 201, 'إنشاء دور');
  const id = c.json.data.id;
  const p = await api('PUT', `/api/rbac/roles/${id}/permissions`, { token: adminToken, body: { permissions: [{ resource: 'promotions', action: 'view' }, { resource: 'promotions', action: 'create' }] } });
  assert.equal(p.status, 200);
  const detail = await api('GET', `/api/rbac/roles/${id}`, { token: adminToken });
  assert.equal(detail.json.data.permissions.length, 2);
  return id;
});

test('رفض أسماء الأدوار غير الصالحة وتكرارها', async () => {
  const bad = await api('POST', '/api/rbac/roles', { token: adminToken, body: { name: 'Bad Name', name_ar: 'سيء' } });
  assert.equal(bad.status, 400);
  const dup = await api('POST', '/api/rbac/roles', { token: adminToken, body: { name: 'super_admin', name_ar: 'مكرر' } });
  assert.equal(dup.status, 409);
});

test('رفض تعديل أو حذف أدوار النظام', async () => {
  const sys = (await api('GET', '/api/rbac/roles', { token: adminToken })).json.data.find((x) => x.name === 'admin');
  const edit = await api('PUT', `/api/rbac/roles/${sys.id}`, { token: adminToken, body: { description: 'x' } });
  assert.equal(edit.status, 403);
  const del = await api('DELETE', `/api/rbac/roles/${sys.id}`, { token: adminToken });
  assert.equal(del.status, 403);
  const editPerm = await api('PUT', `/api/rbac/roles/${sys.id}/permissions`, { token: adminToken, body: { permissions: [] } });
  assert.equal(editPerm.status, 200, 'يُسمح بتعديل صلاحيات أدوار النظام عدا super_admin');
});

test('رفض تعديل صلاحيات super_admin', async () => {
  const sa = (await api('GET', '/api/rbac/roles', { token: adminToken })).json.data.find((x) => x.name === 'super_admin');
  const r = await api('PUT', `/api/rbac/roles/${sa.id}/permissions`, { token: adminToken, body: { permissions: [] } });
  assert.equal(r.status, 403);
});

test('إنفاذ الصلاحيات: مستخدم محدود الصلاحيات يُمنع من إجراء غير مصرّح به', async () => {
  const limitedRole = await api('POST', '/api/rbac/roles', { token: adminToken, body: { name: 'limited_admin', name_ar: 'مشرف محدود', description: 'view only' } });
  const limitedId = limitedRole.json.data.id;
  await api('PUT', `/api/rbac/roles/${limitedId}/permissions`, { token: adminToken, body: { permissions: [{ resource: 'roles', action: 'view' }] } });

  const uid = run(
    "INSERT INTO users (role, name_ar, email, password_hash, is_active) VALUES (?,?,?,?,1)",
    ['admin', 'مشرف محدود', `limited${process.pid}@rafidain.iq`, await hashPassword('Test@123')]
  ).lastId;
  await api('POST', `/api/rbac/users/${uid}/roles`, { token: adminToken, body: { role_id: limitedId } });

  const limitedToken = await login(`limited${process.pid}@rafidain.iq`, 'Test@123');
  const view = await api('GET', '/api/rbac/roles', { token: limitedToken });
  assert.equal(view.status, 200, 'مسموح بالعرض (roles:view)');
  const edit = await api('PUT', `/api/rbac/roles/${limitedId}`, { token: limitedToken, body: { description: 'x' } });
  assert.equal(edit.status, 403, 'ممنوع التعديل (لا يملك roles:edit)');
  const editPerm = await api('PUT', `/api/rbac/roles/${limitedId}/permissions`, { token: limitedToken, body: { permissions: [] } });
  assert.equal(editPerm.status, 403, 'ممنوع تعديل الصلاحيات (لا يملك roles:edit)');

  await api('DELETE', `/api/rbac/roles/${limitedId}`, { token: adminToken });
});

test('super_admin يتجاوز إنفاذ الصلاحيات الدقيقة', async () => {
  const sys = (await api('GET', '/api/rbac/roles', { token: adminToken })).json.data.find((x) => x.name === 'admin');
  const r = await api('PUT', `/api/rbac/roles/${sys.id}/permissions`, { token: adminToken, body: { permissions: [{ resource: 'roles', action: 'view' }] } });
  assert.equal(r.status, 200, 'super_admin يمكنه تعديل أي صلاحيات');
});

test('إنشاء مسؤول جديد عبر POST /rbac/users', async () => {
  const r = await api('POST', '/api/rbac/users', { token: adminToken, body: { name_ar: 'مسؤول تجريبي', email: `newadmin${process.pid}@rafidain.iq`, password: 'Test@123', is_active: true } });
  assert.equal(r.status, 201, 'إنشاء مسؤول');
  assert.equal(r.json.data.email, `newadmin${process.pid}@rafidain.iq`);
  assert.equal(r.json.data.role, 'admin');
  const list = await api('GET', '/api/rbac/users', { token: adminToken });
  assert.ok(list.json.data.some((u) => u.email === `newadmin${process.pid}@rafidain.iq`), 'يظهر في القائمة');
});

test('رفض إنشاء مسؤول ببريد مكرر أو حقول ناقصة أو بريد خاطئ', async () => {
  const dup = await api('POST', '/api/rbac/users', { token: adminToken, body: { name_ar: 'x', email: 'admin@rafidain.iq', password: 'Test@123' } });
  assert.equal(dup.status, 409, 'بريد مستخدم');
  const missing = await api('POST', '/api/rbac/users', { token: adminToken, body: { name_ar: 'x' } });
  assert.equal(missing.status, 400, 'حقول ناقصة');
  const badEmail = await api('POST', '/api/rbac/users', { token: adminToken, body: { name_ar: 'x', email: 'not-an-email', password: 'Test@123' } });
  assert.equal(badEmail.status, 400, 'بريد غير صالح');
});

test('تحديث حالة المسؤول عبر PATCH /rbac/users/:id', async () => {
  const created = await api('POST', '/api/rbac/users', { token: adminToken, body: { name_ar: 'مسؤول مؤقت', email: `tmp${process.pid}@rafidain.iq`, password: 'Test@123' } });
  const id = created.json.data.id;
  const upd = await api('PATCH', `/api/rbac/users/${id}`, { token: adminToken, body: { is_active: 0 } });
  assert.equal(upd.status, 200);
  const list = await api('GET', '/api/rbac/users', { token: adminToken });
  const u = list.json.data.find((x) => x.id === id);
  assert.equal(u.is_active, 0, 'أصبح موقوفاً');
});

test('حذف مسؤول (غير النفس) والرفض لحذف النفس/مستخدم غير مسؤول', async () => {
  const created = await api('POST', '/api/rbac/users', { token: adminToken, body: { name_ar: 'مسؤول للحذف', email: `del${process.pid}@rafidain.iq`, password: 'Test@123' } });
  const id = created.json.data.id;
  const del = await api('DELETE', `/api/rbac/users/${id}`, { token: adminToken });
  assert.equal(del.status, 200);
  const list = await api('GET', '/api/rbac/users', { token: adminToken });
  assert.ok(!list.json.data.some((x) => x.id === id), 'أُزيل من القائمة');

  const selfDel = await api('DELETE', '/api/rbac/users/1', { token: adminToken });
  assert.equal(selfDel.status, 400, 'يمنع حذف حسابك الخاص');

  const cust = get("SELECT id FROM users WHERE role='customer' LIMIT 1");
  const custDel = await api('DELETE', `/api/rbac/users/${cust.id}`, { token: adminToken });
  assert.equal(custDel.status, 404, 'مستخدم غير مسؤول');
});

test('إنفاذ الصلاحيات: مستخدم بـ users:view فقط يُمنع من إنشاء/تحديث/حذف مسؤول', async () => {
  const role = await api('POST', '/api/rbac/roles', { token: adminToken, body: { name: 'users_viewer', name_ar: 'مشاهد مستخدمين' } });
  const rid = role.json.data.id;
  await api('PUT', `/api/rbac/roles/${rid}/permissions`, { token: adminToken, body: { permissions: [{ resource: 'users', action: 'view' }] } });
  const uid = run(
    "INSERT INTO users (role, name_ar, email, password_hash, is_active) VALUES (?,?,?,?,1)",
    ['admin', 'مشاهد مستخدمين', `uviewer${process.pid}@rafidain.iq`, await hashPassword('Test@123')]
  ).lastId;
  await api('POST', `/api/rbac/users/${uid}/roles`, { token: adminToken, body: { role_id: rid } });
  const token = await login(`uviewer${process.pid}@rafidain.iq`, 'Test@123');

  const create = await api('POST', '/api/rbac/users', { token, body: { name_ar: 'x', email: `x${process.pid}@rafidain.iq`, password: 'Test@123' } });
  assert.equal(create.status, 403, 'ممنوع الإنشاء (users:create)');
  const patch = await api('PATCH', `/api/rbac/users/${uid}`, { token, body: { is_active: 0 } });
  assert.equal(patch.status, 403, 'ممنوع التحديث (users:edit)');
  const del = await api('DELETE', `/api/rbac/users/${uid}`, { token });
  assert.equal(del.status, 403, 'ممنوع الحذف (users:delete)');

  await api('DELETE', `/api/rbac/roles/${rid}`, { token: adminToken });
});

