const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

process.env.NODE_ENV = 'test';
process.env.DB_PATH = path.join(os.tmpdir(), `rafidain-money-bounds-${process.pid}-${crypto.randomUUID()}.db`);
process.env.JWT_SECRET = 'integration-test-secret';
process.env.RATE_LIMIT_MAX = '100000';
delete process.env.TRUST_PROXY;

require('../src/db/seed');

const app = require('../src/app');
const { get } = require('../src/db');

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

let adminToken, providerToken, providerId;

test.before(async () => {
  adminToken = await login('admin@rafidain.iq', 'Admin@123');
  providerToken = await login('provider.demo@rafidain.iq', 'Provider@123');
  providerId = get('SELECT p.id FROM providers p JOIN users u ON u.id = p.user_id WHERE u.email = ?', ['provider.demo@rafidain.iq']).id;
});

test.after(() => { server.close(); });

test('رفض طلب بمبلغ بند خيالي (تجاوز سقف الأموال)', async () => {
  const provider = ({ id: providerId });
  const r = await api('POST', '/api/orders', {
    token: providerToken,
    body: { provider_id: provider.id, items: [{ title: 'بند', quantity: 1, unit_price: 1e15 }] },
  });
  assert.equal(r.status, 400, JSON.stringify(r.json));
});

test('رفض طلب بكمية خيالية (تجاوز سقف الكمية)', async () => {
  const provider = ({ id: providerId });
  const r = await api('POST', '/api/orders', {
    token: providerToken,
    body: { provider_id: provider.id, items: [{ title: 'بند', quantity: 500000, unit_price: 1000 }] },
  });
  assert.equal(r.status, 400, JSON.stringify(r.json));
});

test('رفض دفعة إجارة بمبلغ خيالي (تجاوز سقف الأموال)', async () => {
  const agent = get('SELECT * FROM agents ORDER BY id ASC LIMIT 1');
  const r = await api('POST', '/api/leases', {
    token: adminToken,
    body: { agent_id: agent.id, amount: 1e15, status: 'paid' },
  });
  assert.equal(r.status, 400, JSON.stringify(r.json));
});
