const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');

process.env.NODE_ENV = 'test';
process.env.DB_PATH = path.join(os.tmpdir(), `rafidain-sse-${process.pid}-${crypto.randomUUID()}.db`);
process.env.JWT_SECRET = 'sse-test-secret';
process.env.RATE_LIMIT_MAX = '100000';
delete process.env.TRUST_PROXY;

require('../src/db/seed');
const app = require('../src/app');
const { get, close } = require('../src/db');
const sse = require('../src/utils/sse');
const { notifyUser } = require('../src/utils/push');

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
  try { json = await res.json(); } catch (e) { /* قد لا يكون JSON */ }
  return { status: res.status, json };
}

async function login(email, password) {
  const r = await api('POST', '/api/auth/login', { body: { email, password } });
  assert.equal(r.status, 200, `فشل دخول ${email}`);
  return r.json.data.token;
}

function fakeRes() {
  const writes = [];
  let closed = false;
  const res = {
    writes,
    write(chunk) {
      if (!closed) writes.push(String(chunk));
      return true;
    },
    on(evt, fn) {
      if (evt === 'close') res._closeFns = res._closeFns || [];
      if (evt === 'close') res._closeFns.push(fn);
      return res;
    },
    _emitClose() {
      closed = true;
      (res._closeFns || []).forEach((f) => f());
    },
  };
  return res;
}

test.after(() => {
  if (server.closeAllConnections) server.closeAllConnections();
  server.close();
  close();
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(process.env.DB_PATH + suffix); } catch (e) { /* لا يوجد */ }
  }
});

test('محور SSE: نشر لاتصال معين والتوقف عن النشر بعد الإغلاق', () => {
  const res = fakeRes();
  const unsub = sse.subscribe(999, res);
  assert.equal(sse.publish(999, 'notification', { type: 'order' }), 1);
  assert.match(res.writes.join(''), /event: notification/);
  assert.equal(sse.publish(888, 'notification', {}), 0);
  unsub();
  res._emitClose();
  assert.equal(sse.publish(999, 'notification', {}), 0);
});

test('مسار /stream: وصول حدث إشعار حي عبر الاتصال المفتوح', async () => {
  const token = await login('provider.demo@rafidain.iq', 'Provider@123');
  const provider = get('SELECT id FROM users WHERE email = ?', ['provider.demo@rafidain.iq']);
  assert.ok(provider);

  const ctrl = new AbortController();
  const res = await fetch(base + '/api/notifications/stream', {
    headers: { Authorization: `Bearer ${token}` },
    signal: ctrl.signal,
  });
  assert.equal(res.status, 200);

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let received = '';
  const reading = (async () => {
    while (!/event: notification/.test(received)) {
      const { value, done } = await reader.read();
      if (done) break;
      received += decoder.decode(value, { stream: true });
    }
    return received;
  })().catch(() => received);

  await notifyUser(provider.id, { type: 'order', title: 'اختبار', body: 'إشعار حي', url: '/orders' });
  await Promise.race([reading, new Promise((r) => setTimeout(r, 3000))]);
  ctrl.abort();
  assert.match(received, /event: notification/, received.slice(0, 300));
});
