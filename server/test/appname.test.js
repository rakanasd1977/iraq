const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

process.env.NODE_ENV = 'test';
process.env.DB_PATH = path.join(os.tmpdir(), `rafidain-appname-${process.pid}-${crypto.randomUUID()}.db`);
process.env.JWT_SECRET = 'appname-test-secret';
process.env.RATE_LIMIT_MAX = '100000';
delete process.env.TRUST_PROXY;

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

test.after(() => { server.close(); });

test('اسم التطبيق يظهر في الإعدادات العامة', async () => {
  const r = await api('GET', '/api/public/config');
  assert.equal(r.status, 200);
  assert.equal(r.json.data.app_name, 'سوق الرافدين');
});

test('تحديث اسم التطبيق ينعكس في الإعدادات العامة', async () => {
  const token = await login('admin@rafidain.iq', 'Admin@123');
  const newName = 'متجر الرافدين الجديد ' + Date.now();
  const upd = await api('PUT', '/api/settings/app_name', { token, body: { value: newName, label: 'اسم التطبيق' } });
  assert.equal(upd.status, 200, 'تحديث اسم التطبيق');
  const r = await api('GET', '/api/public/config');
  assert.equal(r.json.data.app_name, newName);
});
