// @ts-nocheck
// اختبارات تثبيت للإصلاحات الأمنية:
// 1) حماية CSRF العامة على أي طلب مصادَق عبر الكوكي (لا تتجاوزها).
// 2) عدم كشف مستندات الهوية/إثباتات الشحن عبر /uploads بمعرفة الرابط.
// 3) تقييد صلاحيات مسارات leases/recharges للأدوار المخوّلة فقط.
const path = require('path');
const fs = require('fs');
const os = require('os');
const http = require('http');
const crypto = require('crypto');
const { test, before, after } = require('node:test');
const assert = require('node:assert');

process.env.NODE_ENV = 'test';
process.env.DB_PATH = path.join(os.tmpdir(), `rafidain-sec-${process.pid}-${crypto.randomUUID()}.db`);
process.env.JWT_SECRET = 'sec-test-secret';
delete process.env.TRUST_PROXY;
process.env.RATE_LIMIT_MAX = '1000000';

const repoRoot = path.resolve(__dirname, '..', '..');
const db = require(path.join(repoRoot, 'server/src/db'));
require(path.join(repoRoot, 'server/src/db/seed'));
const app = require(path.join(repoRoot, 'server/src/app'));
const { UPLOAD_DIR } = require(path.join(repoRoot, 'server/src/utils/uploads'));

let server, base;

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52]);

function parseCookies(setCookie) {
  const out = {};
  for (const c of setCookie || []) {
    const pair = String(c).split(';')[0];
    const idx = pair.indexOf('=');
    if (idx > 0) out[pair.slice(0, idx).trim()] = pair.slice(idx + 1).trim();
  }
  return out;
}

function req(method, p, { cookie, csrf, body, json } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(base + p);
    const headers = { 'Content-Type': 'application/json' };
    if (cookie) headers['Cookie'] = cookie;
    if (csrf) headers['X-CSRF-Token'] = csrf;
    const data = body || (json ? JSON.stringify(json) : null);
    const r = http.request({ method, host: u.hostname, port: u.port, path: u.pathname + u.search, headers }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let parsed = null;
        try { parsed = JSON.parse(text); } catch (e) { /* لا شيء */ }
        resolve({ status: res.statusCode, json: parsed, setCookie: res.headers['set-cookie'] || [] });
      });
    });
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}

async function login(email, password, role) {
  const inferred = role || (email.includes('admin') ? 'admin' : email.includes('agent') ? 'agent' : email.includes('provider') ? 'provider' : 'customer');
  const res = await req('POST', '/api/auth/login', { json: { email, password, role: inferred } });
  const cookies = parseCookies(res.setCookie);
  return { cookie: `rafidain_session=${cookies['rafidain_session']}; rafidain_csrf=${cookies['rafidain_csrf']}`, csrf: cookies['rafidain_csrf'] };
}

before(async () => {
  server = app.listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  await db.close();
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(process.env.DB_PATH + suffix); } catch (e) { /* تجاهل */ }
  }
});

test('CSRF: طلب POST مصادَق عبر الكوكي بلا رمز CSRF يُرفض (403)', async () => {
  const auth = await login('customer.demo@rafidain.iq', 'Customer@123');
  const noToken = await req('POST', '/api/auth/logout', { cookie: auth.cookie });
  assert.strictEqual(noToken.status, 403);
  const withToken = await req('POST', '/api/auth/logout', { cookie: auth.cookie, csrf: auth.csrf });
  assert.strictEqual(withToken.status, 200);
});

test('uploads: صورة مستند هوية مربوطة بproviders لا تُقدَّم عامة (404)', async () => {
  const name = `sec-id-${Date.now()}-${Math.random().toString(36).slice(2)}.png`;
  const pub = `pub-${Date.now()}-${Math.random().toString(36).slice(2)}.png`;
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  fs.writeFileSync(path.join(UPLOAD_DIR, name), PNG_SIG);
  fs.writeFileSync(path.join(UPLOAD_DIR, pub), PNG_SIG);
  try {
    const pid = db.get("SELECT id FROM users WHERE email = 'provider.demo@rafidain.iq'").id;
    db.run('UPDATE providers SET national_id_image = ? WHERE user_id = ?', [`/uploads/${name}`, pid]);
    const blocked = await req('GET', `/uploads/${name}`);
    assert.strictEqual(blocked.status, 404);
    const open = await req('GET', `/uploads/${pub}`);
    assert.strictEqual(open.status, 200);
    db.run('UPDATE providers SET national_id_image = NULL WHERE user_id = ?', [pid]);
  } finally {
    fs.unlinkSync(path.join(UPLOAD_DIR, name));
    fs.unlinkSync(path.join(UPLOAD_DIR, pub));
  }
});

test('leases: مسؤول بلا صلاحية leases:view يُمنع (403)', async () => {
  const ph = db.get("SELECT password_hash FROM users WHERE email = 'admin@rafidain.iq'").password_hash;
  const uid = db.run("INSERT INTO users (role, name_ar, email, password_hash, is_active, is_verified) VALUES ('admin','بدون إجارات','nolease@rafidain.iq',?,1,1)", [ph]).lastId;
  const rid = db.run("INSERT INTO admin_roles (name, name_ar, description, is_system) VALUES ('test_nolease','بدون إجارات',NULL,0)").lastId;
  db.run('INSERT INTO admin_user_roles (user_id, role_id, assigned_by) VALUES (?,?,?)', [uid, rid, uid]);
  const auth = await login('nolease@rafidain.iq', 'Admin@123', 'admin');
  const denied = await req('GET', '/api/leases/agent/1', { cookie: auth.cookie, csrf: auth.csrf });
  assert.strictEqual(denied.status, 403);
  const superAuth = await login('admin@rafidain.iq', 'Admin@123');
  const allowed = await req('GET', '/api/leases/agent/1', { cookie: superAuth.cookie, csrf: superAuth.csrf });
  assert.strictEqual(allowed.status, 200);
});

test('recharges: مستخدم غير مسؤول لا يصل لتفاصيل طلب شحن (403)', async () => {
  const prov = await login('provider.demo@rafidain.iq', 'Provider@123', 'provider');
  const created = await req('POST', '/api/recharges', { cookie: prov.cookie, csrf: prov.csrf, json: { amount: 20000, payment_method: 'zain_cash', proof_image: 'https://example.com/proof.png' } });
  assert.strictEqual(created.status, 200);
  const rid = created.json.data.id;
  const auth = await login('customer.demo@rafidain.iq', 'Customer@123');
  const res = await req('GET', `/api/recharges/${rid}`, { cookie: auth.cookie, csrf: auth.csrf });
  assert.strictEqual(res.status, 403);
  db.run('DELETE FROM recharge_requests WHERE id = ?', [rid]);
});
