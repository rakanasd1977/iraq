const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

process.env.NODE_ENV = 'test';
process.env.DB_PATH = path.join(os.tmpdir(), `rafidain-geo-${process.pid}-${crypto.randomUUID()}.db`);
process.env.JWT_SECRET = 'geo-test-secret';
process.env.RATE_LIMIT_MAX = '100000';
delete process.env.TRUST_PROXY;

require('../src/db/seed');

const app = require('../src/app');
const { run } = require('../src/db');

const server = app.listen(0);
const base = `http://127.0.0.1:${server.address().port}`;

async function api(method, url, { token } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(base + url, { method, headers });
  let json = null;
  try { json = await res.json(); } catch (e) { /* غير JSON */ }
  return { status: res.status, json };
}

test.after(() => { server.close(); });

test('قائمة المحافظات تُرجع مع حقول الإحداثيات', async () => {
  const r = await api('GET', '/api/public/governorates');
  assert.equal(r.status, 200);
  const bag = r.json.data.find((g) => g.code === 'BAG');
  assert.ok(bag, 'محافظة بغداد موجودة');
  assert.equal(typeof bag.lat, 'number');
  assert.equal(typeof bag.lng, 'number');
});

test('تحديد المحافظة من إحداثيات بغداد يُرجع BAG', async () => {
  const r = await api('GET', '/api/public/governorates/by-geo?lat=33.3152&lng=44.3661');
  assert.equal(r.status, 200);
  assert.equal(r.json.data.code, 'BAG');
  assert.equal(typeof r.json.data.distance_km, 'number');
});

test('تحديد المحافظة من إحداثيات الموصل يُرجع NIN', async () => {
  const r = await api('GET', '/api/public/governorates/by-geo?lat=36.345&lng=43.145');
  assert.equal(r.status, 200);
  assert.equal(r.json.data.code, 'NIN');
});

test('غياب خط العرض يُرجع 400', async () => {
  const r = await api('GET', '/api/public/governorates/by-geo?lng=44.3661');
  assert.equal(r.status, 400);
});

test('إحداثيات غير رقمية تُرجع 400', async () => {
  const r = await api('GET', '/api/public/governorates/by-geo?lat=abc&lng=44');
  assert.equal(r.status, 400);
});

test('إحداثيات خارج النطاق تُرجع 400', async () => {
  const r = await api('GET', '/api/public/governorates/by-geo?lat=999&lng=44');
  assert.equal(r.status, 400);
});

test('جميع المحافظات بلا إحداثيات تُرجع 200 مع null', async () => {
  run('UPDATE governorates SET lat = NULL, lng = NULL');
  const r = await api('GET', '/api/public/governorates/by-geo?lat=33.3152&lng=44.3661');
  assert.equal(r.status, 200);
  assert.equal(r.json.data, null);
});

test('المسار متاح للزوار بدون توكن (عام)', async () => {
  const r = await api('GET', '/api/public/governorates/by-geo?lat=33.3152&lng=44.3661');
  assert.notEqual(r.status, 401);
});
