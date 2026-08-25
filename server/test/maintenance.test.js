const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');

process.env.NODE_ENV = 'test';
process.env.DB_PATH = path.join(os.tmpdir(), `rafidain-maint-${process.pid}-${crypto.randomUUID()}.db`);
process.env.JWT_SECRET = 'maintenance-test-secret';
delete process.env.TRUST_PROXY;

// مفاتيح VAPID مستقلة للاختبار (لا تُكتب في data/)
const { generateVAPIDKeys } = require('web-push');
const _testVapid = generateVAPIDKeys();
process.env.VAPID_PUBLIC_KEY = _testVapid.publicKey;
process.env.VAPID_PRIVATE_KEY = _testVapid.privateKey;

require('../src/db/seed');
const { get, run, close } = require('../src/db');
const { checkpointAndBackup, pushOffsiteBackup, pruneBackups, endExpiredPromotions, BACKUP_KEEP, BACKUP_DIR, OFFSITE_BACKUP_CMD, createBackupBundle, UPLOAD_DIR } = require('../src/utils/maintenance');
const { extractZip, readCentral } = require('../src/utils/zip');

const { DatabaseSync } = require('node:sqlite');
const STAMP_RE = /^app-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.db$/;

function backupFiles() {
  if (!fs.existsSync(BACKUP_DIR)) return [];
  return fs.readdirSync(BACKUP_DIR).filter((f) => STAMP_RE.test(f)).sort();
}

function latestBackup() {
  const files = backupFiles();
  assert.ok(files.length > 0, 'يوجد ملف نسخة احتياطية');
  return path.join(BACKUP_DIR, files[files.length - 1]);
}

test.before(() => {
  fs.rmSync(BACKUP_DIR, { recursive: true, force: true });
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
});

test.after(() => {
  close();
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(process.env.DB_PATH + suffix); } catch (e) { /* تجاهل */ }
  }
});

test('النسخ الاحتياطي ينشئ ملفاً سليماً من قاعدة WAL', async () => {
  run("INSERT INTO settings (key, value, label) VALUES ('maint_marker', '1', 'حارس النسخ')");
  assert.equal(get("SELECT value FROM settings WHERE key = 'maint_marker'").value, '1');

  checkpointAndBackup();
  await new Promise((r) => setTimeout(r, 1100)); // طابع الثانية — لضمان اسم ملف مختلف
  checkpointAndBackup();

  const files = backupFiles();
  assert.ok(files.length >= 2, `نسختان على الأقل (الموجود: ${files.length})`);
});

test('النسخة قابلة للاستعادة: integrity_check سليم ويحتوي على البيانات', () => {
  const db = new DatabaseSync(latestBackup());
  try {
    const integrity = db.prepare('PRAGMA integrity_check').get();
    assert.equal(integrity.integrity_check, 'ok');

    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r) => r.name);
    for (const t of ['users', 'agents', 'providers', 'orders', 'products', 'settings']) {
      assert.ok(tables.includes(t), `الجدول ${t} في النسخة`);
    }

    const marker = db.prepare("SELECT value FROM settings WHERE key = 'maint_marker'").get();
    assert.equal(marker && marker.value, '1', 'سجل الحارس موجود في النسخة');

    const liveCount = get("SELECT COUNT(*) AS c FROM settings").c;
    const backupCount = db.prepare('SELECT COUNT(*) AS c FROM settings').get().c;
    assert.equal(backupCount, liveCount, 'عدد السجلات مطابق للقاعدة الحية');
  } finally {
    db.close();
  }
});

test('محاكاة الاستعادة: نسخ ملف النسخة إلى مسار جديد ثم فتحه سليماً', () => {
  const target = path.join(os.tmpdir(), `rafidain-restored-${process.pid}.db`);
  fs.copyFileSync(latestBackup(), target);
  try {
    const db = new DatabaseSync(target);
    try {
      const integrity = db.prepare('PRAGMA integrity_check').get();
      assert.equal(integrity.integrity_check, 'ok');
      const count = db.prepare('SELECT COUNT(*) AS c FROM users').get().c;
      assert.ok(count >= 4, `المستخدمون في النسخة المستعادة (${count})`);
    } finally {
      db.close();
    }
  } finally {
    fs.rmSync(target, { force: true });
  }
});

test('الحزمة الكاملة: zip يضم قاعدة البيانات ومجلد الصور وقابل للاستخراج', () => {
  // صورة تجريبية في مجلد الصور
  const probeFile = path.join(UPLOAD_DIR, `probe-${process.pid}.png`);
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  fs.writeFileSync(probeFile, 'probe-image-content');

  try {
    const dbBackup = latestBackup();
    const bundle = createBackupBundle(dbBackup, '2025-05-05T12-00-00');
    assert.ok(bundle, 'أُنشئت الحزمة');
    assert.ok(bundle.endsWith('.zip'), 'الامتداد zip');
    assert.ok(fs.existsSync(bundle), 'ملف الحزمة موجود');

    const zip = fs.readFileSync(bundle);
    const entries = readCentral(zip);
    const names = entries.map((e) => e.name);
    assert.ok(names.includes('app.db'), 'الحزمة تضم قاعدة البيانات');
    assert.ok(names.some((n) => n.startsWith('uploads/')), 'الحزمة تضم مجلد الصور');
    assert.ok(names.some((n) => n.endsWith(`probe-${process.pid}.png`)), 'الصورة التجريبية في الحزمة');

    // استخراج كامل وإعادة فتح قاعدة البيانات + استرجاع الصورة
    const dest = fs.mkdtempSync(path.join(os.tmpdir(), 'rafidain-bundle-extract-'));
    try {
      const written = extractZip(zip, dest);
      assert.ok(written.some((w) => w.endsWith('app.db')), 'استُخرجت قاعدة البيانات');
      const restoredProbe = written.find((w) => w.endsWith(`probe-${process.pid}.png`));
      assert.ok(restoredProbe, 'استُرجعت الصورة');
      assert.equal(fs.readFileSync(restoredProbe, 'utf8'), 'probe-image-content', 'محتوى الصورة مطابق');

      const restoredDb = new DatabaseSync(path.join(dest, 'app.db'));
      try {
        assert.equal(restoredDb.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
      } finally {
        restoredDb.close();
      }
    } finally {
      fs.rmSync(dest, { recursive: true, force: true });
    }
  } finally {
    fs.unlinkSync(probeFile);
  }
});

test('الاستعادة الآمنة من أرشيف ضار: إدخال متجاوز لا يخرج عن الوجهة', () => {
  const zip = fs.readFileSync(path.join(BACKUP_DIR, 'app-2025-05-05T12-00-00.zip'));
  // أرشيف يدوي بأسماء متجاوزة (.. / مطلقة) — يجب أن تبقى الاستخراجات داخل الوجهة
  const { createZip } = require('../src/utils/zip');
  const evil = createZip([
    { name: 'app.db', data: Buffer.from('db') },
    { name: '../../evil.txt', data: Buffer.from('x') },
    { name: '/etc/pwned.txt', data: Buffer.from('x') },
  ]);
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), 'rafidain-evil-'));
  const outsideProbe = path.join(os.tmpdir(), `rafidain-outside-${process.pid}.txt`);
  try {
    const written = extractZip(evil, dest);
    for (const w of written) {
      assert.ok(w.startsWith(dest + path.sep), `كل مستخرج داخل الوجهة: ${w}`);
    }
    assert.ok(written.some((w) => w.endsWith('evil.txt')), 'الاسم المجرد داخل الوجهة');
    assert.equal(fs.existsSync(outsideProbe), false, 'لا ملف خارج الوجهة');
  } finally {
    fs.rmSync(dest, { recursive: true, force: true });
  }
  assert.ok(zip.length > 0, 'قراءة الحزمة النظيفة نجحت سابقاً');
});

test('الاحتفاظ: تُحذف النسخ الأقدم بعد تجاوز BACKUP_KEEP', () => {
  for (let i = 0; i < BACKUP_KEEP + 3; i++) {
    const stamp = `2025-01-${String(i + 1).padStart(2, '0')}T00-00-00`;
    fs.writeFileSync(path.join(BACKUP_DIR, `app-${stamp}.db`), 'x');
  }
  pruneBackups();
  const files = backupFiles();
  assert.ok(files.length <= BACKUP_KEEP, `يحتفظ بآخر ${BACKUP_KEEP} نسخ (الموجود: ${files.length})`);
});

test('الدفع خارج الموقع: لا يُنفَّذ بلا أمر مكوَّن، ويحل {file} وينسخ فعلياً عند تفعيله', async () => {
  assert.equal(OFFSITE_BACKUP_CMD, '', 'لا يُفعَّل الأمر خارجياً في بيئة الاختبار الافتراضية');
  assert.equal(await pushOffsiteBackup(latestBackup()), undefined, 'بلا أمر → لا تنفيذ وفوري');

  const offsiteDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rafidain-offsite-'));
  try {
    const source = path.join(BACKUP_DIR, 'app-2025-03-01T09-00-00.db');
    fs.writeFileSync(source, 'offsite-content');
    const dest = path.join(offsiteDir, 'pushed.db');

    const script = "require('fs').copyFileSync(process.argv[1],process.argv[2])";
    const cmd = `node -e ${script} {file} ${dest}`;
    await pushOffsiteBackup(source, cmd);

    assert.equal(fs.existsSync(dest), true, 'الملف وصل إلى الوجهة خارج الموقع');
    assert.equal(fs.readFileSync(dest, 'utf8'), 'offsite-content', 'المحتوى مطابق');
    assert.equal(fs.existsSync(source), true, 'المصدر المحلي باقٍ');
  } finally {
    fs.rmSync(offsiteDir, { recursive: true, force: true });
    fs.unlinkSync(path.join(BACKUP_DIR, 'app-2025-03-01T09-00-00.db'));
  }
});

test('الإعلان المنتهي يُنهى ويُخطر مزوده، والقريب من الانتهاء يتلقى تذكيراً واحداً', () => {
  const prov = get(
    "SELECT p.id, p.user_id, p.service_id, p.governorate_id FROM providers p JOIN users u ON u.id = p.user_id WHERE u.email = 'provider.demo@rafidain.iq'"
  );
  assert.ok(prov, 'المزود التجريبي موجود');

  run(
    `INSERT INTO promotions (provider_id, service_id, item_type, item_id, item_title, item_price, item_link, governorate_id, cost, status, ends_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,datetime('now','-1 hour'))`,
    [prov.id, prov.service_id, 'products', 1, 'منتج منتهي للاختبار', 1000, 'products', prov.governorate_id, 500, 'active']
  );
  run(
    `INSERT INTO promotions (provider_id, service_id, item_type, item_id, item_title, item_price, item_link, governorate_id, cost, status, ends_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,datetime('now','+10 hours'))`,
    [prov.id, prov.service_id, 'products', 1, 'منتج قارب الانتهاء للاختبار', 1000, 'products', prov.governorate_id, 500, 'active']
  );
  const expiredId = get("SELECT id FROM promotions WHERE item_title = 'منتج منتهي للاختبار'").id;
  const expiringId = get("SELECT id FROM promotions WHERE item_title = 'منتج قارب الانتهاء للاختبار'").id;

  endExpiredPromotions();

  assert.equal(get('SELECT status FROM promotions WHERE id = ?', [expiredId]).status, 'ended', 'المنتهي أصبح ended');
  assert.equal(get('SELECT status FROM promotions WHERE id = ?', [expiringId]).status, 'active', 'القريب من الانتهاء ما زال active');

  const endedNotice = get("SELECT * FROM notifications WHERE user_id = ? AND type = 'promotion_ended'", [prov.user_id]);
  assert.ok(endedNotice, 'أُرسل إشعار انتهاء للمزود');
  assert.ok(String(endedNotice.body).includes('منتج منتهي للاختبار'), 'جسم الإشعار يذكر اسم الإعلان');

  const expiringCount = () => get("SELECT COUNT(*) AS c FROM notifications WHERE user_id = ? AND type = 'promotion_expiring'", [prov.user_id]).c;
  assert.equal(expiringCount(), 1, 'أُرسل تذكير واحد للقريب من الانتهاء');

  endExpiredPromotions();
  assert.equal(expiringCount(), 1, 'التشغيل التالي لا يكرر التذكير');
});
