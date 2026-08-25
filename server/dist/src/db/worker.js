"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
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
const port = workerData.port;
const signal = workerData.signal;
const sleep = new Int32Array(new SharedArrayBuffer(4));
const stmtCache = new Map();
const STMT_CACHE_MAX = 512;
function prepared(sql) {
    let stmt = stmtCache.get(sql);
    if (stmt)
        return stmt;
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
    for (let i = 1;; i++) {
        try {
            return fn();
        }
        catch (e) {
            const busy = e && /SQLITE_BUSY|SQLITE_LOCKED/.test(String(e.message));
            if (!busy || i >= attempts)
                throw e;
            Atomics.wait(sleep, 0, 0, delayMs * i);
        }
    }
}
function runOp(id, method, sql, params) {
    switch (method) {
        case 'get':
            return withBusyRetry(() => prepared(sql).get(...(params || [])));
        case 'all':
            return withBusyRetry(() => prepared(sql).all(...(params || [])));
        case 'run': {
            if (mode === 'reader')
                throw new Error('عملية كتابة على قارئ');
            const r = withBusyRetry(() => prepared(sql).run(...(params || [])));
            return { changes: r.changes, lastId: Number(r.lastInsertRowid) };
        }
        case 'exec':
            if (mode === 'reader')
                throw new Error('عملية كتابة على قارئ');
            withBusyRetry(() => db.exec(sql));
            return null;
        case 'begin':
            if (mode === 'reader')
                throw new Error('معاملة على قارئ');
            db.exec('BEGIN');
            return null;
        case 'commit':
            if (mode === 'reader')
                throw new Error('معاملة على قارئ');
            db.exec('COMMIT');
            return null;
        case 'rollback':
            if (mode === 'reader')
                throw new Error('معاملة على قارئ');
            db.exec('ROLLBACK');
            return null;
        case 'close':
            db.close();
            port.postMessage({ id, ok: true, result: null });
            return '__CLOSED__';
        default:
            throw new Error('unknown db method: ' + method);
    }
}
port.on('message', ({ id, method, sql, params }) => {
    let closed = false;
    try {
        const result = runOp(id, method, sql, params);
        if (result === '__CLOSED__')
            closed = true;
        else
            port.postMessage({ id, ok: true, result });
    }
    catch (e) {
        port.postMessage({ id, ok: false, err: String((e && e.message) || e) });
    }
    finally {
        Atomics.add(signal, 0, 1);
        Atomics.notify(signal, 0);
        if (closed)
            process.exit(0);
    }
});
port.postMessage({ id: 'ready', ok: true, result: null });
