const cluster = require('node:cluster');
const os = require('node:os');

const WORKER_COUNT = Math.min(
  Number(process.env.CLUSTER_WORKERS) || os.cpus().length,
  Number(process.env.CLUSTER_WORKERS_MAX) || 4
);

if (require.main === module) {
if (cluster.isPrimary) {
  const config = require('./config');
  const { migrate } = require('./db/migrate');
  const { checkpointAndBackup, pruneIdempotencyKeys, pruneRateLimits, endExpiredPromotions, rotateLogs, maintenanceSnapshot, checkAdminNotifications } = require('./utils/maintenance');
  const { pruneActivityLog } = require('./utils/log');
  const { pruneSessions } = require('./utils/session');

  function shutdown(signal) {
    console.log(`[cluster] استقبال ${signal} — بدء الإيقاف الرشيق`);
    for (const id in cluster.workers) {
      const w = cluster.workers[id];
      if (w) w.send({ type: 'shutdown' });
    }
    setTimeout(() => {
      for (const id in cluster.workers) {
        const w = cluster.workers[id];
        if (w) w.kill();
      }
      process.exit(0);
    }, 10000).unref();
  }
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('unhandledRejection', (reason) => console.error('[unhandledRejection]', reason));
  process.on('uncaughtException', (err) => { console.error('[uncaughtException]', err); process.exit(1); });

  try {
    migrate();
    pruneActivityLog();
    pruneIdempotencyKeys();
    pruneRateLimits();
    pruneSessions();
    endExpiredPromotions();
    rotateLogs();
  } catch (e) {
    console.error('[startup] فشل إجراءات الإقلاع الأولية:', e);
    process.exit(1);
  }

  const HOUR_MS = 3600000;
  const DAY_MS = 24 * HOUR_MS;
  const WEEK_MS = 7 * DAY_MS;

  setInterval(checkpointAndBackup, HOUR_MS);
  setInterval(endExpiredPromotions, HOUR_MS);
  setInterval(checkAdminNotifications, HOUR_MS);
  setInterval(rotateLogs, DAY_MS);
  setInterval(pruneActivityLog, WEEK_MS);
  setInterval(pruneIdempotencyKeys, WEEK_MS);
  setInterval(pruneRateLimits, WEEK_MS);
  setInterval(pruneSessions, WEEK_MS);

  cluster.on('message', (worker, msg) => {
    if (!msg || msg.type !== 'sse-forward') return;
    for (const id in cluster.workers) {
      const w = cluster.workers[id];
      if (w && w.id !== worker.id) {
        w.send({ type: 'sse-deliver', userId: msg.userId, event: msg.event, data: msg.data });
      }
    }
  });

  cluster.on('exit', (worker, code, signal) => {
    console.log(`[cluster] انتهى العامل ${worker.process.pid} (code=${code} signal=${signal}) — إعادة إقلاع`);
    cluster.fork();
  });

  for (let i = 0; i < WORKER_COUNT; i++) cluster.fork();

  console.log(`[cluster] ${config.appName} — ${WORKER_COUNT} عامل على ${os.cpus().length} نواة`);
  console.log(`[server] لوحة المسؤول: http://localhost:5175 | لوحة الوكيل: http://localhost:5174`);
  const snap = maintenanceSnapshot();
  console.log(`[server] snapshot: ${JSON.stringify(snap)}`);
} else {
  const app = require('./app');
  const config = require('./config');
  const { publishLocal, publishAllLocal } = require('./utils/sse');

  const server = app.listen(config.port, () => {
    console.log(`[server] ${config.appName} API يعمل على http://localhost:${config.port} (عامل ${process.pid})`);
  });

  process.on('message', (msg: any) => {
    if (!msg) return;
    if (msg.type === 'shutdown') {
      server.close(() => process.exit(0));
      setTimeout(() => process.exit(0), 5000).unref();
      return;
    }
    if (msg.type !== 'sse-deliver') return;
    if (msg.userId) publishLocal(msg.userId, msg.event, msg.data);
    else publishAllLocal(msg.event, msg.data);
  });
}
}
