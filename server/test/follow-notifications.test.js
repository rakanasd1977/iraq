const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');

process.env.NODE_ENV = 'test';
process.env.DB_PATH = path.join(os.tmpdir(), `rafidain-follow-${process.pid}-${crypto.randomUUID()}.db`);
process.env.JWT_SECRET = 'follow-test-secret';
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
let store, rest, hotel, airline, travel;
let catId;

test.before(async () => {
  tokens.customer = await login('customer.demo@rafidain.iq', 'Customer@123');
  tokens.provider = await login('provider.demo@rafidain.iq', 'Provider@123');

  store = get('SELECT * FROM providers WHERE name_ar = ?', ['متجر الرافدين للتجارة']);
  rest = get("SELECT * FROM providers WHERE service_id = (SELECT id FROM services WHERE slug = 'restaurants') ORDER BY id ASC LIMIT 1");
  hotel = get("SELECT * FROM providers WHERE service_id = (SELECT id FROM services WHERE slug = 'hotels') ORDER BY id ASC LIMIT 1");
  airline = get("SELECT * FROM providers WHERE service_id = (SELECT id FROM services WHERE slug = 'flights') ORDER BY id ASC LIMIT 1");
  travel = get("SELECT * FROM providers WHERE service_id = (SELECT id FROM services WHERE slug = 'travel_offices') ORDER BY id ASC LIMIT 1");
  assert.ok(store && rest && hotel && airline && travel, 'بيانات seed متوفرة');
  const c = get('SELECT id FROM product_categories WHERE provider_id = ? ORDER BY id LIMIT 1', [store.id]);
  assert.ok(c, 'قسم منتجات للمتجر');
  catId = c.id;
});

test.after(() => {
  server.close();
  close();
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(process.env.DB_PATH + suffix); } catch (e) { /* تجاهل */ }
  }
});

// ------------------------- المتابعة -------------------------

test('متابعة مزود: تظهر في القائمة ويزداد عدد المتابعين ثم يلغى', async () => {
  const before = get('SELECT COUNT(*) AS c FROM provider_follows WHERE provider_id = ?', [store.id]).c;

  const f = await api('POST', '/api/customer/follow', { token: tokens.customer, body: { provider_id: store.id } });
  assert.equal(f.status, 200, JSON.stringify(f.json));
  assert.equal(f.json.data.following, true);

  const dup = await api('POST', '/api/customer/follow', { token: tokens.customer, body: { provider_id: store.id } });
  assert.equal(dup.status, 200, 'التكرار متسامح');
  assert.equal(get('SELECT COUNT(*) AS c FROM provider_follows WHERE provider_id = ?', [store.id]).c, before + 1, 'صف واحد فقط');

  const list = await api('GET', '/api/customer/following', { token: tokens.customer });
  assert.equal(list.status, 200);
  const row = list.json.data.find((p) => Number(p.provider_id) === store.id);
  assert.ok(row, 'المزود موجود في قائمة المتابعة');
  assert.ok(row.service_slug === 'stores' && row.governorate_name_ar, 'تفاصيل الخدمة والمحافظة مرفقة');

  const pub = await api('GET', `/api/public/providers/${store.id}`);
  assert.equal(Number(pub.json.data.followers_count), before + 1, 'عدد المتابعين زاد في الملف العام');

  const del = await api('DELETE', `/api/customer/follow/${store.id}`, { token: tokens.customer });
  assert.equal(del.status, 200, JSON.stringify(del.json));
  assert.equal(del.json.data.following, false);

  const after = await api('GET', '/api/customer/following', { token: tokens.customer });
  assert.ok(!after.json.data.some((p) => Number(p.provider_id) === store.id), 'أُزيل من القائمة');
});

test('متابعة مزود غير موجود ترفض', async () => {
  const r = await api('POST', '/api/customer/follow', { token: tokens.customer, body: { provider_id: 999999 } });
  assert.equal(r.status, 404);
});

test('المزود لا يستطيع متابعة', async () => {
  const r = await api('POST', '/api/customer/follow', { token: tokens.provider, body: { provider_id: rest.id } });
  assert.equal(r.status, 403);
});

// ------------------------- قائمة البنود المفضلة (الموحّدة) -------------------------

test('البنود المفضلة: تُرجع قائمة موحّدة لكل الأنواع الخمسة', async () => {
  const prod = get('SELECT * FROM products WHERE provider_id = ? ORDER BY id LIMIT 1', [store.id]);
  const menu = get('SELECT * FROM menu_items WHERE provider_id = ? ORDER BY id LIMIT 1', [rest.id]);
  const room = get('SELECT * FROM hotel_rooms WHERE provider_id = ? ORDER BY id LIMIT 1', [hotel.id]);
  const flight = get('SELECT * FROM flights WHERE provider_id = ? ORDER BY id LIMIT 1', [airline.id]);
  const pack = get('SELECT * FROM travel_packages WHERE provider_id = ? ORDER BY id LIMIT 1', [travel.id]);
  assert.ok(prod && menu && room && flight && pack, 'عناصر من كل نوع');

  const targets = [
    ['products', prod.id, prod.name_ar],
    ['menu', menu.id, menu.name_ar],
    ['rooms', room.id, room.name_ar],
    ['flights', flight.id, `${flight.origin_ar} → ${flight.destination_ar}`],
    ['packages', pack.id, pack.name_ar],
  ];

  for (const [type, id] of targets) {
    const add = await api('POST', '/api/customer/favorites/items', { token: tokens.customer, body: { item_type: type, item_id: id } });
    assert.equal(add.status, 200, `إضافة ${type}`);
    assert.equal(add.json.data.favorite, true);
  }

  const ids = await api('GET', '/api/customer/favorites/items-ids', { token: tokens.customer });
  assert.equal(ids.json.data.length, 5, 'خمسة مفاتيح');
  assert.ok(ids.json.data.includes('rooms:' + room.id));

  const list = await api('GET', '/api/customer/favorites/items', { token: tokens.customer });
  assert.equal(list.status, 200);
  assert.equal(list.json.data.length, 5, 'خمسة بنود موحّدة');

  for (const [i, [type, , title]] of targets.entries()) {
    const it = list.json.data.find((x) => x.kind === type);
    assert.ok(it, `بند ${type} موجود`);
    assert.equal(it.title, title, `عنوان ${type}`);
    assert.ok(it.id && it.provider_id && it.price !== undefined && it.unit, `حقول ${type} مكتملة`);
    assert.ok(it.rating !== undefined && it.rating_count !== undefined, `تقييم ${type}`);
    assert.ok(it.provider_name, `اسم المزود ${type}`);
  }

  const roomItem = list.json.data.find((x) => x.kind === 'rooms');
  assert.equal(roomItem.unit, 'ليلة');
  assert.equal(Number(roomItem.price), Number(room.price_per_night));
  const flightItem = list.json.data.find((x) => x.kind === 'flights');
  assert.equal(flightItem.unit, 'مقعد');
});

test('قائمة البنود المفضلة: الأحدث أولاً وتستبعد العناصر الموقوفة', async () => {
  const prod = get('SELECT * FROM products WHERE provider_id = ? ORDER BY id LIMIT 1', [store.id]);
  const del = await api('DELETE', `/api/customer/favorites/items/products/${prod.id}`, { token: tokens.customer });
  assert.equal(del.status, 200);
  const reAdd = await api('POST', '/api/customer/favorites/items', { token: tokens.customer, body: { item_type: 'products', item_id: prod.id } });
  assert.equal(reAdd.status, 200);

  const list1 = await api('GET', '/api/customer/favorites/items', { token: tokens.customer });
  assert.equal(list1.json.data[0].kind, 'products', 'الأحدث (المعاد إضافته) أولاً');

  run('UPDATE products SET is_active = 0 WHERE id = ?', [prod.id]);
  const list2 = await api('GET', '/api/customer/favorites/items', { token: tokens.customer });
  assert.ok(!list2.json.data.some((x) => x.kind === 'products'), 'المنتج الموقوف مستبعد');
  run('UPDATE products SET is_active = 1 WHERE id = ?', [prod.id]);
});

test('إضافة بند مفضل لنوع غير معروف ترفض', async () => {
  const r = await api('POST', '/api/customer/favorites/items', { token: tokens.customer, body: { item_type: 'pizzas', item_id: 1 } });
  assert.equal(r.status, 400);
});

test('غير الزبون ممنوع من قائمة البنود المفضلة', async () => {
  const anon = await api('GET', '/api/customer/favorites/items');
  assert.equal(anon.status, 401);
  const prov = await api('GET', '/api/customer/favorites/items', { token: tokens.provider });
  assert.equal(prov.status, 403, 'المزود ليس زبوناً');
});

// ------------------------- إشعار المتابعين عند نشر جديد -------------------------

test('نشر منتج جديد يصل إشعاراً للمتابعين', async () => {
  await api('POST', '/api/customer/follow', { token: tokens.customer, body: { provider_id: store.id } });

  const before = get('SELECT COUNT(*) AS c FROM notifications WHERE user_id = ?', [(get('SELECT id FROM users WHERE email = ?', ['customer.demo@rafidain.iq'])).id]).c;

  const create = await api('POST', '/api/provider/products', {
    token: tokens.provider,
    body: { category_id: catId, name_ar: 'منتج اختباري للنشر', name_en: 'Test Publish', price: 2500, stock: 5, is_active: true },
  });
  assert.equal(create.status, 201, JSON.stringify(create.json));
  const newId = create.json.data.id;
  assert.ok(newId, 'معرّف المنتج الجديد');

  const notifs = await api('GET', '/api/notifications', { token: tokens.customer });
  assert.equal(notifs.status, 200);
  const offer = notifs.json.data.find((n) => n.type === 'offer' && String(n.url).includes(`/item/${store.id}/products/${newId}`));
  assert.ok(offer, 'إشعار عرض للمنتج الجديد موجود');
  assert.ok(String(offer.title).includes('جديد من'), 'عنوان الإشعار');
  assert.ok(String(offer.body).includes('منتج'), 'محتوى الإشعار');
  assert.equal(offer.is_read, 0);

  const unread = await api('GET', '/api/notifications/unread-count', { token: tokens.customer });
  assert.equal(Number(unread.json.data.unread), before + 1, 'عدد غير المقروء زاد');

  const mark = await api('POST', '/api/notifications/read-all', { token: tokens.customer });
  assert.equal(mark.status, 200);
  const unread2 = await api('GET', '/api/notifications/unread-count', { token: tokens.customer });
  assert.equal(Number(unread2.json.data.unread), 0, 'تعلّم الكل كمقروء');
});
