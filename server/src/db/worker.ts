const { workerData } = require('node:worker_threads');
const { DatabaseSync } = require('node:sqlite');
const config = require('../config');

const mode = workerData.mode || 'writer';

const db = new DatabaseSync(config.dbPath);
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');
db.exec('PRAGMA busy_timeout = 5000;');
db.exec('PRAGMA synchronous = NORMAL;');
db.exec('PRAGMA cache_size = -64000;');
db.exec('PRAGMA mmap_size = 268435456;');
db.exec('PRAGMA temp_store = MEMORY;');
db.exec('PRAGMA wal_autocheckpoint = 1000;');
db.exec('PRAGMA journal_size_limit = 67108864;');
// جدول عدّادات حدّ الطلبات المشترك (آمن للعنقود عبر عامل الكتابة الوحيد لكل عملية،
// ومتسق عبر العمليات لأن الكل يصل إلى نفس ملف SQLite عبر قفل الكتابة).
db.exec('CREATE TABLE IF NOT EXISTS rate_limits (key TEXT PRIMARY KEY, count INTEGER NOT NULL, reset_at INTEGER NOT NULL)');

const port = workerData.port;
const signal = workerData.signal;

const sleep = new Int32Array(new SharedArrayBuffer(4));

const stmtCache = new Map();
const STMT_CACHE_MAX = 512;
function prepared(sql) {
  let stmt = stmtCache.get(sql);
  if (stmt) return stmt;
  if (stmtCache.size >= STMT_CACHE_MAX) {
    const first = stmtCache.keys().next().value;
    stmtCache.get(first).close();
    stmtCache.delete(first);
  }
  stmt = db.prepare(sql);
  stmtCache.set(sql, stmt);
  return stmt;
}

function withBusyRetry(fn, attempts = 3, delayMs = 60) {
  for (let i = 1; ; i++) {
    try {
      return fn();
    } catch (e: any) {
      const busy = e && /SQLITE_BUSY|SQLITE_LOCKED/.test(String(e.message));
      if (!busy || i >= attempts) throw e;
      Atomics.wait(sleep, 0, 0, delayMs * i);
    }
  }
}

function rateLimitOp(key, max, windowMs) {
  // معاملة فورية (BEGIN IMMEDIATE) لإجراء القراءة-التعديل-الكتابة ذرِّيًا عبر كل
  // عمال الكتابة (كل عملية لها عاملها، لكنهم يشاركون نفس ملف SQLite وقفل الكتابة).
  db.exec('BEGIN IMMEDIATE');
  try {
    const now = Date.now();
    const resetAt = now + windowMs;
    const row = prepared('SELECT count, reset_at FROM rate_limits WHERE key = ?').get(key);
    let allowed;
    let remaining;
    let reset;
    if (!row || row.reset_at <= now) {
      prepared('INSERT INTO rate_limits(key, count, reset_at) VALUES(?, ?, ?) ON CONFLICT(key) DO UPDATE SET count = excluded.count, reset_at = excluded.reset_at').run(key, 1, resetAt);
      allowed = true;
      remaining = max - 1;
      reset = resetAt;
    } else {
      const count = row.count + 1;
      if (count > max) {
        allowed = false;
        remaining = 0;
        reset = row.reset_at;
      } else {
        prepared('UPDATE rate_limits SET count = ? WHERE key = ?').run(count, key);
        allowed = true;
        remaining = max - count;
        reset = row.reset_at;
      }
    }
    db.exec('COMMIT');
    return { allowed, remaining, reset };
  } catch (e: any) {
    try { db.exec('ROLLBACK'); } catch (_) { /* تجاهل */ }
    throw e;
  }
}

function runOp(id, method, sql, params) {
  switch (method) {
    case 'get':
      return withBusyRetry(() => prepared(sql).get(...(params || [])));
    case 'all':
      return withBusyRetry(() => prepared(sql).all(...(params || [])));
    case 'run': {
      if (mode === 'reader') throw new Error('عملية كتابة على قارئ');
      const r = withBusyRetry(() => prepared(sql).run(...(params || [])));
      return { changes: r.changes, lastId: Number(r.lastInsertRowid) };
    }
    case 'exec':
      if (mode === 'reader') throw new Error('عملية كتابة على قارئ');
      withBusyRetry(() => db.exec(sql));
      return null;
    case 'begin':
      if (mode === 'reader') throw new Error('معاملة على قارئ');
      db.exec('BEGIN IMMEDIATE');
      return null;
    case 'commit':
      if (mode === 'reader') throw new Error('معاملة على قارئ');
      db.exec('COMMIT');
      return null;
    case 'rollback':
      if (mode === 'reader') throw new Error('معاملة على قارئ');
      db.exec('ROLLBACK');
      return null;
    case 'close':
      db.close();
      port.postMessage({ id, ok: true, result: null });
      return '__CLOSED__';
    case 'rateLimit':
      return rateLimitOp(params.key, params.max, params.windowMs);
    default:
      throw new Error('unknown db method: ' + method);
  }
}

port.on('message', ({ id, method, sql, params }) => {
  let closed = false;
  try {
    const result = runOp(id, method, sql, params);
    if (result === '__CLOSED__') closed = true;
    else port.postMessage({ id, ok: true, result });
  } catch (e: any) {
    port.postMessage({ id, ok: false, err: String((e && e.message) || e) });
  } finally {
    Atomics.add(signal, 0, 1);
    Atomics.notify(signal, 0);
    if (closed) process.exit(0);
  }
});

port.postMessage({ id: 'ready', ok: true, result: null });
