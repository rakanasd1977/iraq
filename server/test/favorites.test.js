const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');

process.env.NODE_ENV = 'test';
process.env.DB_PATH = path.join(os.tmpdir(), `rafidain-fav-${process.pid}-${crypto.randomUUID()}.db`);
process.env.JWT_SECRET = 'favorites-test-secret';
process.env.RATE_LIMIT_MAX = '100000';
delete process.env.TRUST_PROXY;

const { generateVAPIDKeys } = require('web-push');
const _testVapid = generateVAPIDKeys();
process.env.VAPID_PUBLIC_KEY = _testVapid.publicKey;
process.env.VAPID_PRIVATE_KEY = _testVapid.privateKey;

require('../src/db/seed');
const app = require('../src/app');
const { get, all, run, close } = require('../src/db');

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

let tokens = {};
let store, rest, hotel;

test.before(async () => {
  tokens.customer = await login('customer.demo@rafidain.iq', 'Customer@123');
  tokens.provider = await login('provider.demo@rafidain.iq', 'Provider@123');

  store = get('SELECT * FROM providers WHERE name_ar = ?', ['متجر الرافدين للتجارة']);
  rest = get("SELECT * FROM providers WHERE service_id = (SELECT id FROM services WHERE slug = 'restaurants') ORDER BY id ASC LIMIT 1");
  hotel = get("SELECT * FROM providers WHERE service_id = (SELECT id FROM services WHERE slug = 'hotels') ORDER BY id ASC LIMIT 1");
  assert.ok(store && rest && hotel, 'بيانات seed متوفرة');
});

test.after(() => {
  server.close();
  close();
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(process.env.DB_PATH + suffix); } catch (e) { /* تجاهل */ }
  }
});

test('بداية: قائمة المفضلة فارغة ومعرفات فارغة', async () => {
  const list = await api('GET', '/api/customer/favorites', { token: tokens.customer });
  assert.equal(list.status, 200);
  assert.equal(list.json.data.length, 0);

  const ids = await api('GET', '/api/customer/favorites/ids', { token: tokens.customer });
  assert.equal(ids.status, 200);
  assert.deepEqual(ids.json.data, []);
});

test('إضافة مفضلة تنجح وتظهر في القائمة والمعرفات', async () => {
  const add = await api('POST', '/api/customer/favorites', { token: tokens.customer, body: { provider_id: store.id } });
  assert.equal(add.status, 200, JSON.stringify(add.json));
  assert.equal(add.json.data.favorite, true);

  const ids = await api('GET', '/api/customer/favorites/ids', { token: tokens.customer });
  assert.ok(ids.json.data.includes(store.id), 'المعرفات تشمل المتجر');

  const list = await api('GET', '/api/customer/favorites', { token: tokens.customer });
  assert.equal(list.json.data.length, 1);
  const row = list.json.data[0];
  assert.equal(row.id, store.id);
  assert.equal(row.name_ar, 'متجر الرافدين للتجارة');
  assert.equal(row.favorite_id, 1);
  assert.ok(row.favorited_at, 'تاريخ الإضافة محفوظ');
  assert.ok(row.service_name_ar && row.governorate_name_ar, 'تفاصيل الخدمة والمحافظة مرفقة');
});

test('إضافة مكررة متسامحة ولا تكرر في القائمة', async () => {
  const again = await api('POST', '/api/customer/favorites', { token: tokens.customer, body: { provider_id: store.id } });
  assert.equal(again.status, 200, JSON.stringify(again.json));

  const list = await api('GET', '/api/customer/favorites', { token: tokens.customer });
  assert.equal(list.json.data.filter((r) => r.id === store.id).length, 1, 'لا تكرار');

  const cnt = get('SELECT COUNT(*) AS c FROM customer_favorites WHERE customer_id = (SELECT id FROM users WHERE email = ?)', ['customer.demo@rafidain.iq']).c;
  assert.equal(cnt, 1, 'صف واحد في قاعدة البيانات');
});

test('إضافة مزود غير موجود تُرفض', async () => {
  const add = await api('POST', '/api/customer/favorites', { token: tokens.customer, body: { provider_id: 999999 } });
  assert.equal(add.status, 404);
});

test('غير الزبون ممنوع من المفضلة', async () => {
  const anon = await api('GET', '/api/customer/favorites');
  assert.equal(anon.status, 401);
  const prov = await api('POST', '/api/customer/favorites', { token: tokens.provider, body: { provider_id: store.id } });
  assert.equal(prov.status, 403, 'المزود ليس زبوناً');
});

test('حذف المفضلة يزيلها من القائمة والمعرفات', async () => {
  const del = await api('DELETE', `/api/customer/favorites/${store.id}`, { token: tokens.customer });
  assert.equal(del.status, 200, JSON.stringify(del.json));
  assert.equal(del.json.data.favorite, false);

  const ids = await api('GET', '/api/customer/favorites/ids', { token: tokens.customer });
  assert.ok(!ids.json.data.includes(store.id));

  const list = await api('GET', '/api/customer/favorites', { token: tokens.customer });
  assert.equal(list.json.data.length, 0);
});

test('مزود موقوف لا يظهر في قائمة المفضلة', async () => {
  await api('POST', '/api/customer/favorites', { token: tokens.customer, body: { provider_id: hotel.id } });
  run('UPDATE providers SET is_active = 0 WHERE id = ?', [hotel.id]);

  const list = await api('GET', '/api/customer/favorites', { token: tokens.customer });
  assert.ok(!list.json.data.some((r) => r.id === hotel.id), 'المزود الموقوف مستبعد من القائمة');
  run('UPDATE providers SET is_active = 1 WHERE id = ?', [hotel.id]);

  const ids = await api('GET', '/api/customer/favorites/ids', { token: tokens.customer });
  assert.ok(ids.json.data.includes(hotel.id), 'المعرفات تحتفظ بالصف حتى مع الإيقاف');
  run('DELETE FROM customer_favorites WHERE customer_id = (SELECT id FROM users WHERE email = ?)', ['customer.demo@rafidain.iq']);
});

test('مضاعفة بين زبونين: كل زبون يرى مفضلته فقط', async () => {
  const gov = get('SELECT * FROM governorates ORDER BY id ASC LIMIT 1');
  const r = await api('POST', '/api/auth/register-customer', {
    body: {
      name_ar: 'زبون ثانٍ', name_en: 'Second Customer',
      email: 'customer2.fav@test.iq', password: 'Test@1234', phone: '0771000222', governorate_id: gov.id,
    },
  });
  assert.equal(r.status, 201, JSON.stringify(r.json));
  const verify = await api('POST', '/api/auth/verify-email', { body: { token: r.json.data.verification_token } });
  assert.equal(verify.status, 200, JSON.stringify(verify.json));
  const t2 = verify.json.data.token;

  await api('POST', '/api/customer/favorites', { token: tokens.customer, body: { provider_id: rest.id } });
  await api('POST', '/api/customer/favorites', { token: t2, body: { provider_id: store.id } });

  const list2 = await api('GET', '/api/customer/favorites', { token: t2 });
  assert.equal(list2.json.data.length, 1);
  assert.equal(list2.json.data[0].id, store.id, 'الزبون الثاني يرى مفضلته فقط');

  const list1 = await api('GET', '/api/customer/favorites', { token: tokens.customer });
  assert.equal(list1.json.data.length, 1);
  assert.equal(list1.json.data[0].id, rest.id, 'الزبون الأول يرى مفضلته فقط');

  const totalRows = all('SELECT COUNT(*) AS c FROM customer_favorites').map((x) => x.c)[0];
  assert.equal(totalRows, 2, 'صفان في المجموع (عزل كامل بين الزبائن)');
});
