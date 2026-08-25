const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

process.env.NODE_ENV = 'test';
process.env.DB_PATH = path.join(os.tmpdir(), `rafidain-csrf-${process.pid}-${crypto.randomUUID()}.db`);
process.env.JWT_SECRET = 'integration-test-secret';
process.env.RATE_LIMIT_MAX = '100000';
delete process.env.TRUST_PROXY;

require('../src/db/seed');

const app = require('../src/app');
const server = app.listen(0);
const base = `http://127.0.0.1:${server.address().port}`;

function parseCookies(res) {
  const sc = res.headers.get('set-cookie');
  if (!sc) return {};
  const out = {};
  for (const c of sc.split(',')) {
    const [kv] = c.split(';');
    const i = kv.indexOf('=');
    out[kv.slice(0, i).trim()] = kv.slice(i + 1).trim();
  }
  return out;
}
async function api(method, url, { token, cookie, csrf, body } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (cookie) headers.Cookie = cookie;
  if (csrf) headers['X-CSRF-Token'] = csrf;
  const res = await fetch(base + url, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  return res.status;
}

let cookieHeader, csrfToken, bearerToken;

test.before(async () => {
  const r = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'admin@rafidain.iq', password: 'Admin@123' }) });
  const cks = parseCookies(r);
  cookieHeader = `rafidain_session=${cks['rafidain_session']}; rafidain_csrf=${cks['rafidain_csrf']}`;
  csrfToken = cks['rafidain_csrf'];
  bearerToken = (await r.json()).data.token;
});

test.after(() => { server.close(); });

test('جلسة صالحة + رأس CSRF مطابق: يمرّ الطلب', async () => {
  const s = await api('POST', '/api/districts', { cookie: cookieHeader, csrf: csrfToken, body: { governorate_id: 1, name_ar: 'ت', name_en: 't', code: 'CS1' } });
  assert.ok(s === 201 || s === 409, `status ${s}`);
});

test('جلسة صالحة بدون رأس CSRF: يُرفض بـ403', async () => {
  const s = await api('POST', '/api/districts', { cookie: cookieHeader, body: { governorate_id: 1, name_ar: 'ت', name_en: 't', code: 'CS2' } });
  assert.equal(s, 403);
});

test('كوكي جلسة غير صالح (قديم/مزوّر): لا يرمي 403 CSRF بل 401', async () => {
  const badCookie = `rafidain_session=invalid.jwt.token; rafidain_csrf=whatever`;
  const s = await api('POST', '/api/districts', { cookie: badCookie, body: { governorate_id: 1, name_ar: 'ت', name_en: 't', code: 'CS3' } });
  assert.equal(s, 401);
});

test('طلب Bearer (بلا كوكي جلسة) معفى من CSRF', async () => {
  const s = await api('GET', '/api/districts', { token: bearerToken });
  assert.equal(s, 200);
});
