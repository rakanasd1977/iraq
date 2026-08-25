const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

process.env.NODE_ENV = 'test';
process.env.DB_PATH = path.join(os.tmpdir(), `rafidain-i18n-test-${process.pid}-${crypto.randomUUID()}.db`);
process.env.JWT_SECRET = 'i18n-test-secret';
process.env.RATE_LIMIT_MAX = '100000';
delete process.env.TRUST_PROXY;

require('../src/db/seed');

const app = require('../src/app');
const server = app.listen(0);
const base = `http://127.0.0.1:${server.address().port}`;

async function api(method, url, { token, body, headers } = {}) {
  const h = { 'Content-Type': 'application/json', ...(headers || {}) };
  if (token) h.Authorization = `Bearer ${token}`;
  const res = await fetch(base + url, {
    method,
    headers: h,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try { json = await res.json(); } catch (e) { /* غير JSON */ }
  return { status: res.status, json };
}

test.after(() => {
  server.close();
  const { close } = require('../src/db');
  close();
  for (const s of ['', '-wal', '-shm']) {
    try { require('fs').unlinkSync(process.env.DB_PATH + s); } catch (e) { /* تجاهل */ }
  }
});

test('الافتراضي (بلا locale) يرجع الاسم العربي في حقل name', async () => {
  const r = await api('GET', '/api/public/providers?limit=1');
  assert.equal(r.status, 200);
  const p = r.json.data[0];
  assert.ok(p, 'يجب وجود مزوّد');
  assert.equal(p.name, p.name_ar, 'name يجب أن يطابق name_ar افتراضياً');
});

test('?locale=en يرجع name_en في حقل name (إن وُجد)', async () => {
  const ar = await api('GET', '/api/public/providers?limit=1');
  const arP = ar.json.data[0];
  const r = await api('GET', '/api/public/providers?locale=en&limit=1');
  assert.equal(r.status, 200);
  const p = r.json.data[0];
  if (arP.name_en) assert.equal(p.name, arP.name_en, 'name بـ en يجب أن يطابق name_en');
  else assert.equal(p.name, arP.name_ar, 'عند غياب name_en يُرجَع العربي');
});

test('ترويسة Accept-Language: en تُفعّل الترجمة', async () => {
  const ar = await api('GET', '/api/public/providers?limit=1');
  const arP = ar.json.data[0];
  const r = await api('GET', '/api/public/providers?limit=1', { headers: { 'Accept-Language': 'en-US,en;q=0.9' } });
  assert.equal(r.status, 200);
  const p = r.json.data[0];
  if (arP.name_en) assert.equal(p.name, arP.name_en);
  else assert.equal(p.name, arP.name_ar);
});

test('المحافظات والخدمات تدعم locale', async () => {
  const g = await api('GET', '/api/public/governorates?locale=en');
  assert.equal(g.status, 200);
  assert.ok(Array.isArray(g.json.data));
  const s = await api('GET', '/api/public/services?locale=en');
  assert.equal(s.status, 200);
  const svc = s.json.data[0];
  if (svc && svc.name_en) assert.equal(svc.name, svc.name_en);
  else if (svc) assert.equal(svc.name, svc.name_ar);
});

test('تفاصيل المزوّد تترجم الاسم والخدمة والمحافظة', async () => {
  const list = await api('GET', '/api/public/providers?limit=1');
  const id = list.json.data[0].id;
  const ar = await api('GET', `/api/public/providers/${id}`);
  const en = await api('GET', `/api/public/providers/${id}?locale=en`);
  assert.equal(ar.status, 200);
  assert.equal(en.status, 200);
  const a = ar.json.data, e = en.json.data;
  assert.equal(a.name, a.name_ar);
  if (a.name_en) assert.equal(e.name, a.name_en);
  if (a.service_name_en) assert.equal(e.service_name, a.service_name_en);
});
