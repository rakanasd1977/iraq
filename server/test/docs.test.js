const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const express = require('express');

process.env.NODE_ENV = 'test';
process.env.DB_PATH = path.join(os.tmpdir(), `rafidain-docs-test-${process.pid}-${crypto.randomUUID()}.db`);
process.env.JWT_SECRET = 'docs-test-secret';
process.env.RATE_LIMIT_MAX = '100000';
delete process.env.TRUST_PROXY;

require('../src/db/seed');

const app = require('../src/app');
const docs = require('../src/routes/docs');

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
  const ct = res.headers.get('content-type') || '';
  let json = null;
  let text = '';
  if (ct.includes('application/json')) {
    json = await res.json();
  } else {
    text = await res.text();
  }
  return { status: res.status, json, text, contentType: ct };
}

test.after(() => {
  server.close();
  const { close } = require('../src/db');
  close();
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(process.env.DB_PATH + suffix); } catch (e) { /* تجاهل */ }
  }
});

// ------------------------- اختبارات الوحدة -------------------------
test('docs.getSpec يُرجع مواصفة OpenAPI صالبة مع مسارات', () => {
  const spec = docs.getSpec();
  assert.equal(spec.openapi, '3.0.3');
  assert.ok(spec.info && spec.info.title, 'يجب وجود عنوان');
  assert.ok(spec.servers && spec.servers.length > 0, 'يجب وجود خوادم');
  assert.ok(spec.components.securitySchemes.bearerAuth, 'يجب وجود مخطط bearerAuth');
  const paths = Object.keys(spec.paths);
  assert.ok(paths.length >= 30, `عدد المسارات منخفض: ${paths.length}`);
  assert.ok(spec.paths['/auth/login'], 'يجب توثيق تسجيل الدخول');
  assert.ok(spec.paths['/orders'], 'يجب توثيق الطلبات');
});

test('docs.registerDocs يُرجع موجّهاً Express فيه المساران', () => {
  const router = docs.registerDocs(express.Router());
  assert.ok(typeof router.use === 'function', 'ليس موجّهاً');
  assert.ok(router.stack.length >= 2, 'لم تُسجَّل المسارات');
});

// ------------------------- اختبارات التكامل -------------------------
test('GET /api/docs/openapi.json بدون توكن → 200 JSON صالب (عام)', async () => {
  const r = await api('GET', '/api/docs/openapi.json');
  assert.equal(r.status, 200, 'يجب أن يكون الوصول عاماً بلا مصادقة');
  assert.ok(r.contentType.includes('application/json'), `نوع غير متوقع: ${r.contentType}`);
  assert.equal(r.json.openapi, '3.0.3');
  assert.ok(Object.keys(r.json.paths).length >= 30);
});

test('GET /api/docs/ بدون توكن → 200 HTML فيه Swagger UI (عام)', async () => {
  const r = await api('GET', '/api/docs/');
  assert.equal(r.status, 200);
  assert.ok(r.contentType.includes('text/html'), `نوع غير متوقع: ${r.contentType}`);
  assert.ok(r.text.includes('swagger-ui'), 'غائب Swagger UI');
  assert.ok(r.text.includes('./openapi.json'), 'يجب أن يشير إلى المواصفة');
});

test('المواصفة متاحة أيضاً لمستخدم مصادَق (لا فرق في الصلاحية)', async () => {
  const login = await api('POST', '/api/auth/login', { body: { email: 'admin@rafidain.iq', password: 'Admin@123' } });
  assert.equal(login.status, 200);
  const token = login.json.data.token;
  const r = await api('GET', '/api/docs/openapi.json', { token });
  assert.equal(r.status, 200);
  assert.equal(r.json.openapi, '3.0.3');
});

test('التحقق من صحة بنية المواصفة (مسارات لها عمليات)', async () => {
  const r = await api('GET', '/api/docs/openapi.json');
  for (const [p, ops] of Object.entries(r.json.paths)) {
    if (p === '__INSERT__') continue;
    assert.ok(Object.keys(ops).length > 0, `المسار ${p} بلا عمليات`);
  }
});
