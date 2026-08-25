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

require('../src/db/seed');

const app = require('../src/app');
const server = app.listen(0);
const base = `http://127.0.0.1:${server.address().port}`;
const { get, run } = require('../src/db');
const { hashPassword } = require('../src/utils/password');

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

async function login(email, password, role) {
  const r = await api('POST', '/api/auth/login', { body: { email, password, role } });
  assert.equal(r.status, 200, `تسجيل دخول ${email}`);
  return r.json.data.token;
}

function randName() {
  return Array.from(crypto.randomBytes(6)).map((b) => String.fromCharCode(97 + (b % 26))).join('');
}

let adminToken, agentToken, customerToken;

test.before(async () => {
  adminToken = await login('admin@rafidain.iq', 'Admin@123', 'admin');
  agentToken = await login('agent.baghdad@rafidain.iq', 'Agent@123', 'agent');
  customerToken = await login('customer.demo@rafidain.iq', 'Customer@123', 'customer');
});

test.after(() => { server.close(); });

test('زبون لا يمكنه إعادة تعيين كلمة مرور حساب آخر (403)', async () => {
  const targetId = get('SELECT id FROM users WHERE email = ?', ['provider.demo@rafidain.iq']).id;
  const r = await api('POST', '/api/auth/reset-password', { token: customerToken, body: { user_id: targetId, new_password: 'Temp@123' } });
  assert.equal(r.status, 403);
});

test('وكيل لا يمكنه إعادة تعيين كلمة مرور المسؤول (403)', async () => {
  const adminId = get('SELECT id FROM users WHERE email = ?', ['admin@rafidain.iq']).id;
  const r = await api('POST', '/api/auth/reset-password', { token: agentToken, body: { user_id: adminId, new_password: 'Temp@123' } });
  assert.equal(r.status, 403);
});

test('مسؤول أعلى يمكنه إعادة تعيين كلمة مرور زبون (200)', async () => {
  const custId = get('SELECT id FROM users WHERE email = ?', ['customer.demo@rafidain.iq']).id;
  const r = await api('POST', '/api/auth/reset-password', { token: adminToken, body: { user_id: custId, new_password: 'Temp@123' } });
  assert.equal(r.status, 200);
});

test('مسؤول غير أعلى لا يمكنه منح دور المسؤول الأعلى (403)', async () => {
  const superRoleId = get("SELECT id FROM admin_roles WHERE name = 'super_admin'").id;
  const role = await api('POST', '/api/rbac/roles', { token: adminToken, body: { name: `usr_${randName()}`, name_ar: 'مستخدم صلاحيات', description: 'test' } });
  const roleId = role.json.data.id;
  await api('PUT', `/api/rbac/roles/${roleId}/permissions`, { token: adminToken, body: { permissions: [{ resource: 'users', action: 'edit' }] } });
  const uid = run(
    "INSERT INTO users (role, name_ar, email, password_hash, is_active) VALUES (?,?,?,?,1)",
    ['admin', 'مُختبر', `limited${process.pid}@rafidain.iq`, await hashPassword('Test@123')]
  ).lastId;
  await api('POST', `/api/rbac/users/${uid}/roles`, { token: adminToken, body: { role_id: roleId } });
  const limitedToken = await login(`limited${process.pid}@rafidain.iq`, 'Test@123', 'admin');
  const r = await api('POST', `/api/rbac/users/${uid}/roles`, { token: limitedToken, body: { role_id: superRoleId } });
  assert.equal(r.status, 403);
});

test('مسؤول أعلى يمكنه منح دور المسؤول الأعلى (200)', async () => {
  const superRoleId = get("SELECT id FROM admin_roles WHERE name = 'super_admin'").id;
  const uid = run(
    "INSERT INTO users (role, name_ar, email, password_hash, is_active) VALUES (?,?,?,?,1)",
    ['admin', 'مُختبر2', `limited2${process.pid}@rafidain.iq`, await hashPassword('Test@123')]
  ).lastId;
  const r = await api('POST', `/api/rbac/users/${uid}/roles`, { token: adminToken, body: { role_id: superRoleId } });
  assert.ok(r.status === 200 || r.status === 201);
});
