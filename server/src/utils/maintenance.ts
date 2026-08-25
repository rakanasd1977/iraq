const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { db, all, get, run } = require('../db');
const config = require('../config');
const { notifyUser, notifyRole } = require('./push');
const { createZip } = require('./zip');
const { UPLOAD_DIR } = require('./uploads');

const SERVER_ROOT = path.join(__dirname, '../..');
const LOG_FILES = ['server.log', 'server.out.log', 'server.err.log'];
const LOG_ROTATE_BYTES = Number(process.env.LOG_ROTATE_BYTES) || 10 * 1024 * 1024;
const LOG_KEEP = 3;
const BACKUP_DIR = path.join(path.dirname(config.dbPath), 'backups');
const BACKUP_KEEP = 7;
// سقف حجم مجلد الصور المسموح تضمينه في الحزمة (حماية الذاكرة في الخادم الصغير)
const BUNDLE_MAX_BYTES = Number(process.env.BACKUP_BUNDLE_MAX_BYTES) || 1024 * 1024 * 1024;
// أمر اختياري يدفع النسخة إلى موقع خارجي (rclone/scp/cp إلى قرص مثبّت...).
// يُستبدل فيه {file} بالمسار الكامل للنسخة. مثال:
//   OFFSITE_BACKUP_CMD=rclone copy {file} remote:rafidain-backups
// التشغيل غير متزامن ولا يكسر النسخ المحلي عند فشل الأمر.
const OFFSITE_BACKUP_CMD = process.env.OFFSITE_BACKUP_CMD || '';

// دمج WAL مع الملف الرئيسي ثم نسخ ذري — نستخدم نقطة تفتيش WAL غير حاصرة + نسخ الملفات
// لتقليل فترة القفل إلى الحد الأدنى (VACUUM INTO يقفل قاعدة البيانات بالكامل ويحصر جميع العمال)
function checkpointAndBackup() {
  try {
    // نقطة تفتيش غير حارسة: تدمج WAL في الملف الرئيسي دون حصر القراء/الكتّاب لفترة طويلة
    db.exec('PRAGMA wal_checkpoint(PASSIVE);');
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const target = path.join(BACKUP_DIR, `app-${stamp}.db`);
    
    // نسخ الملفات مباشرة بعد نقطة التفتيش (فترة قفل قصيرة جداً)
    // ننسخ ملف قاعدة البيانات وملف WAL إن وجد
    fs.copyFileSync(config.dbPath, target);
    const walPath = config.dbPath + '-wal';
    if (fs.existsSync(walPath)) {
      fs.copyFileSync(walPath, target + '-wal');
    }
    const shmPath = config.dbPath + '-shm';
    if (fs.existsSync(shmPath)) {
      fs.copyFileSync(shmPath, target + '-shm');
    }
    
    console.log(`[maintenance] نسخة احتياطية (non-blocking): ${path.basename(target)}`);
    // حزمة كاملة (قاعدة البيانات + مجلد الصور) في ملف واحد للاستعادة الشاملة
    const bundle = createBackupBundle(target, stamp);
    if (bundle) console.log(`[maintenance] حزمة كاملة: ${path.basename(bundle)}`);
    pruneBackups();
    const toPush = bundle || target;
    if (OFFSITE_BACKUP_CMD) pushOffsiteBackup(toPush);
  } catch (e: any) {
    console.error('[maintenance] checkpoint/backup failed:', e.message);
  }
}

// حزمة ZIP تضم نسخة قاعدة البيانات + كل ملفات /uploads (للحفاظ على الصور عند الاستعادة).
// تُتخطى بحذر إذا تجاوزت الصور سقف الحجم أو فشل التغليف (لا يكسر النسخة المحلية).
function createBackupBundle(dbBackupFile, stamp) {
  try {
    let total = 0;
    const uploadEntries = [];
    if (fs.existsSync(UPLOAD_DIR)) {
      for (const f of fs.readdirSync(UPLOAD_DIR)) {
        const fp = path.join(UPLOAD_DIR, f);
        const st = fs.statSync(fp);
        if (!st.isFile()) continue;
        total += st.size;
        uploadEntries.push({ name: `uploads/${f}`, file: fp });
      }
    }
    if (total > BUNDLE_MAX_BYTES) {
      console.warn(`[maintenance] تخطت الصور السقف (${(total / 1048576).toFixed(1)}MB) — الحزمة بلا صور.`);
      uploadEntries.length = 0;
    }
    const bundle = path.join(BACKUP_DIR, `app-${stamp}.zip`);
    const zip = createZip([
      { name: 'app.db', file: dbBackupFile },
      ...uploadEntries,
    ]);
    fs.writeFileSync(bundle, zip);
    return bundle;
  } catch (e: any) {
    console.error('[maintenance] backup bundle failed:', e.message);
    return null;
  }
}

// دفع النسخة إلى موقع خارجي عبر الأمر المكوَّن ({file} = مسار النسخة).
// يُعيد Promise لحين اكتمال الأمر (بدون كسر سلسلة النسخ المحلي عند الفشل).
function pushOffsiteBackup(backupFile, cmd = process.env.OFFSITE_BACKUP_CMD || '') {
  const parts = cmd.split(/\s+/).filter(Boolean);
  if (!parts.length) return Promise.resolve();
  const [exec, ...args] = parts;
  const resolved = args.map((a) => a.replace('{file}', backupFile));
  return new Promise<void>((resolve) => {
    execFile(exec, resolved, { timeout: 300000 }, (err, stdout, stderr) => {
      if (err) {
        console.error(`[maintenance] offsite backup failed: ${err.message}${stderr ? ` (${String(stderr).slice(0, 300)})` : ''}`);
      } else {
        console.log(`[maintenance] offsite backup ok: ${path.basename(backupFile)}`);
      }
      resolve();
    });
  });
}

function pruneBackups() {
  try {
    const files = fs.readdirSync(BACKUP_DIR)
      .filter((f) => /^app-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.(db|zip)$/.test(f))
      .sort();
    while (files.length > BACKUP_KEEP) {
      const old = files.shift();
      fs.unlinkSync(path.join(BACKUP_DIR, old));
      console.log(`[maintenance] حُذف نسخة قديمة: ${old}`);
    }
  } catch (e: any) {
    console.error('[maintenance] prune backups failed:', e.message);
  }
}

function maintenanceSnapshot() {
  const counters = {
    activity_log: getRowCount('activity_log'),
    orders: getRowCount('orders'),
    bookings: getRowCount('bookings'),
    idempotency_keys: getRowCount('idempotency_keys'),
  };
  const wal = db.prepare('PRAGMA wal_size').get();
  return { counters, walPages: wal && Object.values(wal)[0] };
}

const IDEMPOTENCY_RETENTION_KEY = 'idempotency_retention_days';
const IDEMPOTENCY_RETENTION_DAYS = 7;

// تقليم مفاتيح idempotency المنتهية: تبقى فقط بقدر ما يلزم لامتصاص إعادة الإرسال
function pruneIdempotencyKeys() {
  try {
    const row = all('SELECT value FROM settings WHERE key = ?', [IDEMPOTENCY_RETENTION_KEY])[0];
    const days = parseInt(row?.value, 10) || IDEMPOTENCY_RETENTION_DAYS;
    const cutoff = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10) + ' 00:00:00';
    const res = run('DELETE FROM idempotency_keys WHERE created_at < ?', [cutoff]);
    if (res?.changes > 0) console.log(`[maintenance] تقليم idempotency_keys: حُذف ${res.changes} مفتاحاً أقدم من ${days} يوم`);
  } catch (e: any) {
    console.error('[maintenance] prune idempotency_keys failed:', e.message);
  }
}

// تنظيف عدّادات حدّ الطلبات منتهية النافذة (تمنع نمو الجدول بلا حد)
function pruneRateLimits() {
  try {
    const res = run('DELETE FROM rate_limits WHERE reset_at <= ?', [Date.now()]);
    if (res?.changes > 0) console.log(`[maintenance] تقليم rate_limits: حُذف ${res.changes} عدّاداً منتهياً`);
  } catch (e: any) {
    console.error('[maintenance] prune rate_limits failed:', e.message);
  }
}

function getRowCount(table) {
  try {
    const row = all(`SELECT COUNT(*) AS c FROM ${table}`)[0];
    return row ? Number(row.c) : 0;
  } catch {
    return -1;
  }
}

// إنهاء الترويجات التي انتهت مدتها تلقائياً (تُستدعى عند الإقلاع وكل ساعة)
// مع إشعار المزود عند الانتهاء، وتذكيره قبل 24 ساعة من الانتهاء (مرة لكل موعد).
function endExpiredPromotions() {
  try {
    const expired = all(
      `SELECT pr.id, pr.item_title, pr.ends_at, u.id AS user_id, p.name_ar AS provider_name
       FROM promotions pr
       JOIN providers p ON p.id = pr.provider_id
       JOIN users u ON u.id = p.user_id
       WHERE pr.status = 'active' AND pr.ends_at IS NOT NULL AND pr.ends_at <= datetime('now')`
    );
    for (const pr of expired) {
      run("UPDATE promotions SET status = 'ended', updated_at = datetime('now') WHERE id = ? AND status = 'active'", [pr.id]);
      notifyUser(pr.user_id, {
        type: 'promotion_ended',
        title: 'انتهى إعلانك 📢',
        body: `إعلان «${pr.item_title}» انتهى ولم يعد يظهر للزبائن. جدّده الآن من صفحة الترويج والإعلانات ليبقى نشطاً.`,
        url: '/promotions',
        icon: '📢',
      });
    }
    if (expired.length) console.log(`[maintenance] إنهاء ترويجات منتهية: ${expired.length} + إشعار لكل مزود`);

    const expiring = all(
      `SELECT pr.id, pr.item_title, pr.ends_at, u.id AS user_id
       FROM promotions pr
       JOIN providers p ON p.id = pr.provider_id
       JOIN users u ON u.id = p.user_id
       WHERE pr.status = 'active' AND pr.ends_at > datetime('now')
         AND pr.ends_at <= datetime('now', '+1 day')`
    );
    for (const pr of expiring) {
      const body = `تذكير: إعلان «${pr.item_title}» سينتهي خلال 24 ساعة (عند ${pr.ends_at} بالتوقيت العالمي). جدّده قبل الانتهاء.`;
      const sent = get(
        "SELECT id FROM notifications WHERE user_id = ? AND type = 'promotion_expiring' AND body = ?",
        [pr.user_id, body]
      );
      if (sent) continue;
      notifyUser(pr.user_id, {
        type: 'promotion_expiring',
        title: 'إعلانك سينتهي قريباً ⏳',
        body,
        url: '/promotions',
        icon: '⏳',
      });
    }
    if (expiring.length) console.log(`[maintenance] تذكير انتهاء قريب: ${expiring.length} إعلاناً خلال 24 ساعة`);
  } catch (e: any) {
    console.error('[maintenance] end expired promotions failed:', e.message);
  }
}

// تدوير سجلات نصية حسب الحجم: أرشفة + قص، مع إبقاء آخر LOG_KEEP نسخ لكل ملف.
// إذا كان الملف مقفلاً من كاتب خارجي (إعادة توجيه إقلاع قديمة) تُأرشف نسخة فقط
// ثم يُقص الأصلي عند توفر الفرصة — لا يكسر العملية الحالية أبداً.
function rotateLogs() {
  for (const name of LOG_FILES) {
    const file = path.join(SERVER_ROOT, name);
    try {
      const size = fs.statSync(file).size;
      if (size < LOG_ROTATE_BYTES) continue;
      const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const archive = path.join(SERVER_ROOT, `${name}.${stamp}.log`);
      fs.renameSync(file, archive);
      console.log(`[maintenance] تدوير السجل: ${name} → ${path.basename(archive)}`);
      pruneLogs(name);
    } catch (e: any) {
      if (e.code !== 'ENOENT') console.error(`[maintenance] rotate ${name} failed:`, e.message);
    }
  }
}

function pruneLogs(name) {
  try {
    const files = fs.readdirSync(SERVER_ROOT)
      .filter((f) => f.startsWith(name + '.') && f.endsWith('.log'))
      .sort();
    while (files.length > LOG_KEEP) {
      const old = files.shift();
      fs.unlinkSync(path.join(SERVER_ROOT, old));
      console.log(`[maintenance] حُذف سجل قديم: ${old}`);
    }
  } catch (e: any) {
    console.error('[maintenance] prune logs failed:', e.message);
  }
}

// فحص الإشعارات الإدارية الدورية
async function checkAdminNotifications() {
  try {
    // 1. طلبات سحب معلقة (أكثر من 24 ساعة)
    const pendingWithdrawals = all(
      `       SELECT aw.id, aw.amount, aw.created_at, u.name_ar AS agent_name, u.id AS user_id
       FROM agent_withdrawals aw
       JOIN agents a ON a.id = aw.agent_id
       JOIN users u ON u.id = a.user_id
       WHERE aw.status = 'pending' AND aw.created_at <= datetime('now', '-1 day')
       ORDER BY aw.created_at ASC`
    );
    for (const w of pendingWithdrawals) {
      const alreadyNotified = get(
        "SELECT id FROM notifications WHERE user_id = ? AND type = 'withdrawal_pending' AND body LIKE ?",
        [0, `%السحب #${w.id}%`] // user_id=0 placeholder, will use role
      );
      // سنستخدم notifyRole للأدمنز
      const exists = get(
        "SELECT id FROM notifications WHERE type = 'withdrawal_pending' AND body LIKE ?",
        [`%السحب #${w.id}%`]
      );
      if (!exists) {
        await notifyRole('admin', {
          type: 'withdrawal_pending',
          title: 'طلب سحب معلق ⏳',
          body: `طلب سحب #${w.id} للوكيل «${w.agent_name}» بمبلغ ${w.amount} دينار معلق منذ أكثر من 24 ساعة.`,
          url: '/agent-withdrawals',
          icon: '💸',
        });
      }
    }

    // 2. مزودون جدد بانتظار التفعيل (غير موثقين/غير نشطين منذ أكثر من 3 أيام)
    const pendingProviders = all(
      `SELECT p.id, p.name_ar, p.created_at, u.id AS user_id
       FROM providers p
       JOIN users u ON u.id = p.user_id
       WHERE (p.is_active = 0 OR p.is_verified = 0) AND p.created_at <= datetime('now', '-3 day')
       ORDER BY p.created_at ASC`
    );
    for (const p of pendingProviders) {
      const exists = get(
        "SELECT id FROM notifications WHERE type = 'provider_pending' AND body LIKE ?",
        [`%المزود #${p.id}%`]
      );
      if (!exists) {
        await notifyRole('admin', {
          type: 'provider_pending',
          title: 'مزود بانتظار التفعيل ⏳',
          body: `المزود «${p.name_ar}» (#${p.id}) بانتظار التفعيل/التوثيق منذ أكثر من 3 أيام.`,
          url: '/providers',
          icon: '🏪',
        });
      }
    }

    // 3. كوبونات منتهية الصلاحية (خلال 7 أيام)
    const expiringCoupons = all(
      `SELECT c.id, c.code, c.ends_at, p.name_ar AS provider_name, u.id AS user_id
       FROM coupons c
       JOIN providers p ON p.id = c.provider_id
       JOIN users u ON u.id = p.user_id
       WHERE c.is_active = 1 AND c.ends_at IS NOT NULL AND c.ends_at > datetime('now')
         AND c.ends_at <= datetime('now', '+7 day')
       ORDER BY c.ends_at ASC`
    );
    for (const c of expiringCoupons) {
      const daysLeft = Math.ceil((new Date(c.ends_at).getTime() - Date.now()) / 86400000);
      const body = `كوبون «${c.code}» للمزود «${c.provider_name}» سينتهي خلال ${daysLeft} يوم (${c.ends_at}).`;
      const exists = get(
        "SELECT id FROM notifications WHERE type = 'coupon_expiring' AND body = ?",
        [body]
      );
      if (!exists) {
        await notifyRole('admin', {
          type: 'coupon_expiring',
          title: 'كوبون سينتهي قريباً ⏳',
          body,
          url: '/coupons',
          icon: '🎫',
        });
      }
    }

    // 4. كوبونات منتهية بالفعل (غير نشطة تلقائياً)
    const expiredCoupons = all(
      `SELECT c.id, c.code, p.name_ar AS provider_name
       FROM coupons c
       JOIN providers p ON p.id = c.provider_id
       WHERE c.is_active = 1 AND c.ends_at IS NOT NULL AND c.ends_at <= datetime('now')`
    );
    for (const c of expiredCoupons) {
      run("UPDATE coupons SET is_active = 0, updated_at = datetime('now') WHERE id = ? AND is_active = 1", [c.id]);
      await notifyRole('admin', {
        type: 'coupon_expired',
        title: 'كوبون انتهت صلاحيته 🎫',
        body: `كوبون «${c.code}» للمزود «${c.provider_name}» انتهت صلاحيته وأصبح غير نشط.`,
        url: '/coupons',
        icon: '🎫',
      });
    }

    // 5. أخطاء نظام حرجة (يمكن إضافة المزيد لاحقاً)
    // مثال: فشل النسخ الاحتياطي، امتلاء القرص، إلخ.
    // هذا مجرد مثال — يمكن توسعته لاحقاً

    if (pendingWithdrawals.length || pendingProviders.length || expiringCoupons.length || expiredCoupons.length) {
      console.log(`[admin-notify] Withdrawals: ${pendingWithdrawals.length}, Providers: ${pendingProviders.length}, Expiring coupons: ${expiringCoupons.length}, Expired coupons: ${expiredCoupons.length}`);
    }
  } catch (e: any) {
    console.error('[admin-notify] check failed:', e.message);
  }
}

module.exports = { checkpointAndBackup, createBackupBundle, pushOffsiteBackup, pruneBackups, pruneIdempotencyKeys, pruneRateLimits, endExpiredPromotions, rotateLogs, maintenanceSnapshot, checkAdminNotifications, BACKUP_KEEP, BACKUP_DIR, OFFSITE_BACKUP_CMD, UPLOAD_DIR };
