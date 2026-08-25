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
  const r = await api('POST', '/api/auth/login', { body: { email, password, role: 'admin' } });
  assert.equal(r.status, 200, `تسجيل دخول ${email}`);
  return r.json.data.token;
}

async function loginAs(email, password, role) {
  const r = await api('POST', '/api/auth/login', { body: { email, password, role } });
  assert.equal(r.status, 200, `تسجيل دخول ${email} بدور ${role}`);
  return r.json.data.token;
}

let adminToken;

test.before(async () => {
  adminToken = await login('admin@rafidain.iq', 'Admin@123');
});

test.after(() => { server.close(); });

// اسم حروف إنجليزية صغيرة وشرطات سفلية فقط (لا أرقام — يرفضه التحقق)
function randName() {
  return Array.from(crypto.randomBytes(6)).map((b) => String.fromCharCode(97 + (b % 26))).join('');
}

// مستخدم محدود الصلاحيات: يملك orders:view فقط
async function makeLimitedUser() {
  const role = await api('POST', '/api/rbac/roles', { token: adminToken, body: { name: `ord_${randName()}`, name_ar: 'عارض طلبات', description: 'test' } });
  const roleId = role.json.data.id;
  await api('PUT', `/api/rbac/roles/${roleId}/permissions`, { token: adminToken, body: { permissions: [{ resource: 'orders', action: 'view' }] } });
  const uid = run(
    "INSERT INTO users (role, name_ar, email, password_hash, is_active) VALUES (?,?,?,?,1)",
    ['admin', 'عارض طلبات', `ordview${process.pid}@rafidain.iq`, await hashPassword('Test@123')]
  ).lastId;
  await api('POST', `/api/rbac/users/${uid}/roles`, { token: adminToken, body: { role_id: roleId } });
  const token = await login(`ordview${process.pid}@rafidain.iq`, 'Test@123');
  return { token, roleId };
}

test('المسؤول الأعلى (super_admin) يتجاوز كل الصلاحيات الدقيقة', async () => {
  const settings = await api('GET', '/api/settings', { token: adminToken });
  assert.equal(settings.status, 200);
  const roles = await api('GET', '/api/rbac/roles', { token: adminToken });
  assert.equal(roles.status, 200);
  const gov = await api('GET', '/api/governorates', { token: adminToken });
  assert.equal(gov.status, 200);
});

test('مستخدم محدود الصلاحيات: يُمنح ما يملكه ويُمنع ما لا يملكه', async () => {
  const { token } = await makeLimitedUser();

  const ordersView = await api('GET', '/api/orders', { token });
  assert.equal(ordersView.status, 200, 'يملك orders:view');

  const ordersCreate = await api('POST', '/api/orders', { token, body: {} });
  assert.equal(ordersCreate.status, 403, 'لا يملك orders:create');

  const agentsView = await api('GET', '/api/agents', { token });
  assert.equal(agentsView.status, 403, 'لا يملك agents:view');

  const govView = await api('GET', '/api/governorates', { token });
  assert.equal(govView.status, 403, 'لا يملك governorates:view (مورد جديد)');

  const rolesView = await api('GET', '/api/rbac/roles', { token });
  assert.equal(rolesView.status, 403, 'لا يملك roles:view');
});

test('دور المسؤول (admin) يملك الموارد الجديدة ويستثنى system/users/roles', async () => {
  const created = await api('POST', '/api/rbac/users', {
    token: adminToken,
    body: { name_ar: 'مسؤول كامل', email: `admrole${process.pid}@rafidain.iq`, password: 'Test@123' },
  });
  const uid = created.json.data.id;
  await api('PATCH', `/api/rbac/users/${uid}`, { token: adminToken, body: { is_active: true } });
  const rolesList = (await api('GET', '/api/rbac/roles', { token: adminToken })).json.data;
  const adminRole = rolesList.find((r) => r.name === 'admin');
  await api('POST', `/api/rbac/users/${uid}/roles`, { token: adminToken, body: { role_id: adminRole.id } });
  const token = await login(`admrole${process.pid}@rafidain.iq`, 'Test@123');

  const gov = await api('GET', '/api/governorates', { token });
  assert.equal(gov.status, 200, 'دور المسؤول يملك governorates:view (مورد جديد)');

  const agents = await api('GET', '/api/agents', { token });
  assert.equal(agents.status, 200, 'دور المسؤول يملك agents:view');

  const govCreate = await api('POST', '/api/governorates', { token, body: {} });
  assert.notEqual(govCreate.status, 403, 'دور المسؤول يملك governorates:create (يتجاوز التحقق إلى 400)');

  const roles = await api('GET', '/api/rbac/roles', { token });
  assert.equal(roles.status, 403, 'دور المسؤول لا يملك roles:view');

  const users = await api('GET', '/api/rbac/users', { token });
  assert.equal(users.status, 403, 'دور المسؤول لا يملك users:view');

  await api('DELETE', `/api/rbac/users/${uid}`, { token: adminToken });
});

test('المسؤول فقط والوكيل بعقد نشط يديران المزودين — لا الزبون ولا المزود', async () => {
  const customerToken = await loginAs('customer.demo@rafidain.iq', 'Customer@123', 'customer');
  const providerToken = await loginAs('provider.demo@rafidain.iq', 'Provider@123', 'provider');
  const agentToken = await loginAs('agent.baghdad@rafidain.iq', 'Agent@123', 'agent');

  const customerCreate = await api('POST', '/api/providers', { token: customerToken, body: { name_ar: 'x' } });
  assert.equal(customerCreate.status, 403, 'الزبون لا يملك إدارة المزودين');

  const providerCreate = await api('POST', '/api/providers', { token: providerToken, body: { name_ar: 'x' } });
  assert.equal(providerCreate.status, 403, 'المزود لا يملك إدارة المزودين');

  const customerDelete = await api('DELETE', '/api/providers/1', { token: customerToken });
  assert.equal(customerDelete.status, 403, 'الزبون لا يملك حذف المزودين');

  const agentCreate = await api('POST', '/api/providers', { token: agentToken, body: { name_ar: 'x' } });
  assert.notEqual(agentCreate.status, 403, 'الوكيل بعقد نشط يتجاوز بوابة الصلاحية (يفشل على التحقق 400)');

  const adminCreate = await api('POST', '/api/providers', { token: adminToken, body: { name_ar: 'x' } });
  assert.notEqual(adminCreate.status, 403, 'المسؤول يتجاوز بوابة الصلاحية');
});
