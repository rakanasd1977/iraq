const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const fs = require('node:fs');

const SERVER_ROOT = path.join(__dirname, '..');

function runNode(args, env = {}) {
  const r = spawnSync(process.execPath, ['--import', 'tsx', ...args], {
    cwd: SERVER_ROOT,
    env: { ...process.env, ...env },
    encoding: 'utf8',
    timeout: 30000,
  });
  return { status: r.status, out: r.stdout || '', err: r.stderr || '' };
}

const db = (name) => path.join(os.tmpdir(), `${name}-${crypto.randomUUID()}.db`);
const clearDb = (p) => { try { fs.rmSync(p); fs.rmSync(p + '-wal'); fs.rmSync(p + '-shm'); } catch (e) { /* غير موجود */ } };

test.after(() => {
  for (const f of fs.readdirSync(os.tmpdir())) {
    if (f.startsWith('rafidain-seed-')) {
      try { fs.rmSync(path.join(os.tmpdir(), f)); } catch (e) { /* مشغول */ }
    }
  }
});

test('الإقلاع في الإنتاج بدون JWT_SECRET مرفوض برسالة واضحة', () => {
  const r = runNode(['-e', "require('./src/config')"], {
    NODE_ENV: 'production',
    JWT_SECRET: '',
  });
  assert.notEqual(r.status, 0, 'يجب أن يفشل الإقلاع');
  assert.ok(/JWT_SECRET/.test(r.out + r.err), 'الرسالة تشير إلى JWT_SECRET');
});

test('بيئة التطوير تعمل بدون JWT_SECRET (السر الافتراضي للتطوير)', () => {
  const r = runNode(['-e', "const c = require('./src/config'); console.log('SECRET_OK', !!c.jwtSecret)"], {
    NODE_ENV: 'development',
    JWT_SECRET: '',
  });
  assert.equal(r.status, 0, r.out + r.err);
  assert.match(r.out, /SECRET_OK true/);
});

test('الـ seed لا يُشغَّل في الإنتاج بدون SEED_ALLOW=1', () => {
  const p = db(`rafidain-seed-blocked-${process.pid}.db`);
  clearDb(p);
  const r = runNode(['-e', "require('./src/db/seed')"], {
    NODE_ENV: 'production',
    JWT_SECRET: 'guard-test-secret',
    DB_PATH: p,
  });
  assert.equal(r.status, 0, r.out + r.err);
  assert.match(r.out + r.err, /تخطي تهيئة بيانات التجربة/);
  assert.doesNotMatch(r.out + r.err, /اكتمل التجهيز بنجاح/);
});

test('الـ seed يعمل في الإنتاج مع SEED_ALLOW=1', () => {
  const p = db(`rafidain-seed-allowed-${process.pid}.db`);
  clearDb(p);
  const r = runNode(['-e', "require('./src/db/seed')"], {
    NODE_ENV: 'production',
    JWT_SECRET: 'guard-test-secret',
    SEED_ALLOW: '1',
    DB_PATH: p,
  });
  assert.equal(r.status, 0, r.out + r.err);
  assert.match(r.out, /اكتمل التجهيز بنجاح/);
});

test('الـ seed يعمل في بيئة الاختبار/التطوير تلقائياً', () => {
  const p = db(`rafidain-seed-test-${process.pid}.db`);
  clearDb(p);
  const r = runNode(['-e', "require('./src/db/seed')"], {
    NODE_ENV: 'test',
    JWT_SECRET: 'guard-test-secret',
    DB_PATH: p,
  });
  assert.equal(r.status, 0, r.out + r.err);
  assert.match(r.out, /اكتمل التجهيز بنجاح/);
});
