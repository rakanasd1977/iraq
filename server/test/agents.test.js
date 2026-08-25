const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

process.env.NODE_ENV = 'test';
process.env.DB_PATH = path.join(os.tmpdir(), `rafidain-agents-${process.pid}-${crypto.randomUUID()}.db`);
process.env.JWT_SECRET = 'integration-test-secret';
process.env.RATE_LIMIT_MAX = '100000';
delete process.env.TRUST_PROXY;

require('../src/db/seed');

const app = require('../src/app');
const { get, all } = require('../src/db');
const server = app.listen(0);
const base = `http://127.0.0.1:${server.address().port}`;

async function api(method, url, { token, body } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(base + url, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  let json = null; try { json = await res.json(); } catch (e) { /* غير JSON */ }
  return { status: res.status, json };
}
async function login(email, password) {
  const r = await api('POST', '/api/auth/login', { body: { email, password } });
  assert.equal(r.status, 200, `تسجيل دخول ${email}`);
  return r.json.data.token;
}
function makeEmail() { return `agent.${crypto.randomUUID().slice(0, 8)}@rafidain.iq`; }

let adminToken, govId;

test.before(async () => {
  adminToken = await login('admin@rafidain.iq', 'Admin@123');
  const g = await api('GET', '/api/governorates', { token: adminToken });
  govId = g.json.data[0].id;
});

test.after(() => { server.close(); });

test('إنشاء وكيل باسم قضاء مكتوب حراً ينشئ القضاء ويربطه', async () => {
  const before = all('SELECT * FROM districts WHERE governorate_id = ?', [govId]).length;
  const r = await api('POST', '/api/agents', {
    token: adminToken,
    body: { name_ar: 'وكيل تلعفر', email: makeEmail(), governorate_id: govId, district_name: 'تلعفر تجريبي', commission_rate: 3 },
  });
  assert.equal(r.status, 201, JSON.stringify(r.json));
  assert.equal(r.json.data.district_name_ar, 'تلعفر تجريبي');
  const after = all('SELECT * FROM districts WHERE governorate_id = ?', [govId]).length;
  assert.equal(after, before + 1, 'يجب إنشاء صف قضاء جديد');
});

test('تكرار اسم القضاء المكتوب لنفس المحافظة يرفض (وكيل واحد لكل قضاء)', async () => {
  await api('POST', '/api/agents', {
    token: adminToken,
    body: { name_ar: 'وكيل قضاء أ', email: makeEmail(), governorate_id: govId, district_name: 'قضاء مكرر', commission_rate: 3 },
  });
  const r = await api('POST', '/api/agents', {
    token: adminToken,
    body: { name_ar: 'وكيل قضاء ب', email: makeEmail(), governorate_id: govId, district_name: 'قضاء مكرر', commission_rate: 3 },
  });
  assert.equal(r.status, 409, JSON.stringify(r.status));
});

test('تعديل وكيل: تغيير اسم القضاء المكتوب ينشئ القضاء الجديد ويربطه', async () => {
  const created = await api('POST', '/api/agents', {
    token: adminToken,
    body: { name_ar: 'وكيل للتعديل', email: makeEmail(), governorate_id: govId, district_name: 'قضاء قديم', commission_rate: 3 },
  });
  const id = created.json.data.id;
  const r = await api('PUT', `/api/agents/${id}`, {
    token: adminToken,
    body: { name_ar: 'وكيل للتعديل', email: created.json.data.email, governorate_id: govId, district_name: 'قضاء جديد تماماً' },
  });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.data.district_name_ar, 'قضاء جديد تماماً');
});
