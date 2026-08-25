const { Worker, MessageChannel, receiveMessageOnPort } = require('node:worker_threads');
const path = require('node:path');
const fs = require('node:fs');
const config = require('../config');

fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });

const READER_COUNT = Math.max(1, Math.min(2, Number(process.env.DB_READ_WORKERS) || 2));

let writerWorker = null;
let writerPort = null;
const readerWorkers = [];
let readerRr = 0;

let seq = 0;
let txDepth = 0;
const inflight = new Map();

const signal = new Int32Array(new SharedArrayBuffer(4));

function attachWorker(w, port) {
  w.unref();
  w.on('error', (err) => {
    const pending = [...inflight.values()].filter((p) => p.worker === port);
    for (const p of pending) {
      inflight.delete(p.id);
      p.setError(err);
    }
  });
  w.on('exit', (code) => {
    if (code !== 0) {
      const pending = [...inflight.values()].filter((p) => p.worker === port);
      for (const p of pending) {
        inflight.delete(p.id);
        p.setError(new Error('db worker exited: ' + code));
      }
    }
  });
}

function ensureWorkers() {
  if (writerWorker) return;

  function spawnWorker(mode) {
    const channel = new MessageChannel();
    // في الإنتاج المُجمّع يُحمَّل worker.js (إن وُجد)، وإلا (تشغيل عبر tsx) يُحمَّل worker.ts
    const jsWorker = path.join(__dirname, 'worker.js');
    const workerFile = fs.existsSync(jsWorker) ? 'worker.js' : 'worker.ts';
    const worker = new Worker(path.join(__dirname, workerFile), {
      workerData: { signal, port: channel.port2, mode },
      transferList: [channel.port2],
    });
    attachWorker(worker, channel.port1);
    const deadline = Date.now() + 15000;
    for (;;) {
      const msg = receiveMessageOnPort(channel.port1);
      if (msg && msg.message && msg.message.id === 'ready') break;
      if (Date.now() > deadline) throw new Error('db worker did not become ready: ' + mode);
      Atomics.wait(signal, 0, Atomics.load(signal, 0), 10);
    }
    return { worker, port: channel.port1 };
  }

  const writer = spawnWorker('writer');
  writerWorker = writer.worker;
  writerPort = writer.port;
  for (let i = 0; i < READER_COUNT; i++) {
    readerWorkers.push(spawnWorker('reader'));
  }
}

function trackTxDelta(method, sql) {
  if (method === 'begin') return 1;
  if (method === 'commit' || method === 'rollback') return -1;
  if (method === 'exec' && sql) {
    const s = String(sql).trim().toUpperCase();
    if (s.startsWith('BEGIN')) return 1;
    if (s.startsWith('COMMIT') || s.startsWith('ROLLBACK') || s.startsWith('END')) return -1;
  }
  return 0;
}

function call(method, sql, params): any {
  ensureWorkers();
  const id = ++seq;
  let value;
  let error = null;

  const isRead = method === 'get' || method === 'all';
  const inTx = txDepth > 0;
  const port = isRead && !inTx ? readerWorkers[readerRr++ % readerWorkers.length].port : writerPort;
  inflight.set(id, {
    id,
    worker: port,
    setResult(v) { value = v; },
    setError(e) { error = e; },
  });
  port.postMessage({ id, method, sql, params: params || [] });
  const started = Date.now();
  let warned = false;
  for (;;) {
    const msg = receiveMessageOnPort(port);
    if (msg) {
      const m = msg.message;
      const p = inflight.get(m.id);
      if (p) {
        inflight.delete(m.id);
        if (m.ok) p.setResult(m.result);
        else p.setError(new Error(m.err));
      }
      if (m.id === id) break;
      continue;
    }
    if (!warned && Date.now() - started > 5000) {
      warned = true;
      console.error(`[db] انتظار استجابة العامل >5s: ${method} ${String(sql).slice(0, 120)}`);
    }
    const before = Atomics.load(signal, 0);
    Atomics.wait(signal, 0, before, 50);
  }
  txDepth += trackTxDelta(method, sql);
  if (error) throw error;
  return value;
}

function get(sql, params): any {
  return call('get', sql, params);
}

function all(sql, params): any {
  return call('all', sql, params);
}

function run(sql, params): any {
  return call('run', sql, params);
}

function transaction(fn): any {
  call('begin', null, null);
  try {
    const out = fn();
    call('commit', null, null);
    return out;
  } catch (e: any) {
    try { call('rollback', null, null); } catch (e2: any) { /* تجاهل فشل التراجع */ }
    throw e;
  }
}

const db = {
  exec(sql) {
    call('exec', sql, null);
  },
  prepare(sql) {
    return {
      get: (...params) => call('get', sql, params),
      all: (...params) => call('all', sql, params),
      run: (...params) => call('run', sql, params),
    };
  },
  close,
};

const sleep = new Int32Array(new SharedArrayBuffer(4));

function rateLimitCheck(key, max, windowMs): any {
  return call('rateLimit', null, { key, max, windowMs });
}

function close() {
  const workers = [
    ...(writerWorker ? [{ w: writerWorker, p: writerPort }] : []),
    ...readerWorkers.map((rw) => ({ w: rw.worker, p: rw.port })),
  ];
  writerWorker = null;
  writerPort = null;
  readerWorkers.length = 0;
  for (const { w, p } of workers) {
    try {
      p.postMessage({ id: 'close', method: 'close', sql: null, params: [] });
    } catch (e: any) { /* العامل متوقف */ }
    for (let i = 0; i < 1000; i++) {
      const msg = receiveMessageOnPort(p);
      if (msg && msg.message && msg.message.id === 'close') {
        try { w.terminate(); } catch (e: any) { /* تجاهل */ }
        break;
      }
      Atomics.wait(sleep, 0, 0, 1);
    }
    try { w.terminate(); } catch (e: any) { /* تجاهل */ }
  }
}

module.exports = { db, get, all, run, transaction, close, rateLimitCheck };
