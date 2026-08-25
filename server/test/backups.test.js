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
delete process.env.GCS_BUCKET;
delete process.env.GCS_CREDENTIALS_JSON;
delete process.env.GOOGLE_CREDENTIALS_JSON;

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

async function login(email, password, role) {
  const r = await api('POST', '/api/auth/login', { body: { email, password, role } });
  assert.equal(r.status, 200, `تسجيل دخول ${email}`);
  return r.json.data.token;
}

let adminToken, customerToken;

test.before(async () => {
  adminToken = await login('admin@rafidain.iq', 'Admin@123', 'admin');
  customerToken = await login('customer.demo@rafidain.iq', 'Customer@123', 'customer');
});

test.after(() => { server.close(); });

test('المسؤول يُدرج النسخ الاحتياطية (مصفوفة)', async () => {
  const r = await api('GET', '/api/backups', { token: adminToken });
  assert.equal(r.status, 200);
  assert.ok(Array.isArray(r.json.data));
});

test('المسؤول يُنشئ نسخة احتياطية', async () => {
  const r = await api('POST', '/api/backups', { token: adminToken });
  assert.equal(r.status, 200);
  assert.match(r.json.data.name, /\.db$/);
  assert.ok(r.json.data.size > 0);
});

test('المسؤول يُنزّل نسخة احتياطية', async () => {
  const created = await api('POST', '/api/backups', { token: adminToken });
  const name = created.json.data.name;
  const headers = { Authorization: `Bearer ${adminToken}` };
  const res = await fetch(base + '/api/backups/' + encodeURIComponent(name), { headers });
  assert.equal(res.status, 200);
});

test('الرفع للسحابة يعود مُصرّحاً بعدم الضبط عند غياب إعدادات GCS', async () => {
  const created = await api('POST', '/api/backups', { token: adminToken });
  const name = created.json.data.name;
  const r = await api('POST', `/api/backups/${encodeURIComponent(name)}/upload`, { token: adminToken });
  assert.equal(r.status, 200);
  assert.equal(r.json.data.configured, false);
});

test('اسم نسخة غير صالح يُرفض بـ 400', async () => {
  const r = await api('GET', '/api/backups/..%2F..%2Fapp.db', { token: adminToken });
  assert.equal(r.status, 400);
});

test('زبون لا يمكنه الوصول لنسخ النظام (403)', async () => {
  const r = await api('GET', '/api/backups', { token: customerToken });
  assert.equal(r.status, 403);
});

test('المسؤول يحذف نسخة احتياطية', async () => {
  const created = await api('POST', '/api/backups', { token: adminToken });
  const name = created.json.data.name;
  const r = await api('DELETE', `/api/backups/${encodeURIComponent(name)}`, { token: adminToken });
  assert.equal(r.status, 200);
  const after = await api('GET', '/api/backups', { token: adminToken });
  assert.ok(!after.json.data.some((b) => b.name === name));
});
