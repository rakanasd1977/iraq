"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// سكربت استعادة نسخة احتياطية (قاعدة بيانات + مجلد الصور).
//
// الاستخدام:
//   node scripts/restore.js [--file <مسار النسخة>] [--yes] [--keep]
//
//   --file   مسار النسخة (zip كامل أو db فقط). بلا تحديد يُستعمل أحدث نسخة.
//   --yes    تجاوز سؤال التأكيد.
//   --keep   لا ينشئ نسخة أمان من الحالة الحالية قبل الاستعادة.
//
// يفترض السكربت أن الخادم متوقف. يُنشئ سابقاً نسخة أمان من app.db الحالي،
// ثم يستبدل قاعدة البيانات (مع حذف ملفات WAL/SHM القديمة) ويستبدل مجلد
// الصور إن كانت النسخة حزمة كاملة، ثم يتحقق من سلامة القاعدة بـ integrity_check.
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { DatabaseSync } = require('node:sqlite');
const config = require('../src/config');
const { UPLOAD_DIR } = require('../src/utils/uploads');
const { extractZip, readCentral } = require('../src/utils/zip');
const BACKUP_DIR = path.join(path.dirname(config.dbPath), 'backups');
const DB_FILE = config.dbPath;
const STAMP_RE = /^app-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.(zip|db)$/;
function arg(name) {
    const i = process.argv.indexOf(name);
    return i >= 0 ? process.argv[i + 1] : null;
}
const has = (name) => process.argv.includes(name);
function stamp() {
    return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
}
function fail(msg) {
    console.error(`[restore] ✖ ${msg}`);
    process.exit(1);
}
function log(msg) {
    console.log(`[restore] ${msg}`);
}
function pickBackup() {
    const explicit = arg('--file');
    if (explicit) {
        if (!fs.existsSync(explicit))
            fail(`الملف غير موجود: ${explicit}`);
        return path.resolve(explicit);
    }
    if (!fs.existsSync(BACKUP_DIR))
        fail('لا يوجد مجلد نسخ احتياطية: ' + BACKUP_DIR);
    const files = fs.readdirSync(BACKUP_DIR).filter((f) => STAMP_RE.test(f)).sort();
    if (!files.length)
        fail('لا توجد نسخ احتياطية في ' + BACKUP_DIR);
    // نفضّل الحزمة الكاملة (zip) الأحدث؛ فإن لم توجد نستخدم أحدث db
    const zips = files.filter((f) => f.endsWith('.zip'));
    const dbs = files.filter((f) => f.endsWith('.db'));
    const best = zips.length ? zips[zips.length - 1] : dbs[dbs.length - 1];
    return path.join(BACKUP_DIR, best);
}
function integrity(dbPath) {
    const d = new DatabaseSync(dbPath, { readOnly: true });
    try {
        const r = d.prepare('PRAGMA integrity_check').get();
        return r && r.integrity_check === 'ok';
    }
    finally {
        d.close();
    }
}
async function confirm() {
    if (has('--yes'))
        return true;
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    return new Promise((resolve) => {
        rl.question('أكمل الاستعادة؟ (نعم/لا) ', (ans) => {
            rl.close();
            resolve(/^(نعم|y|yes|ن)$/i.test(ans.trim()));
        });
    });
}
async function main() {
    const backup = pickBackup();
    const isZip = backup.endsWith('.zip');
    log(`النسخة: ${path.basename(backup)}${isZip ? ' (حزمة كاملة)' : ' (قاعدة بيانات فقط)'}`);
    if (!has('--keep') && fs.existsSync(DB_FILE)) {
        const safety = `${DB_FILE}.pre-restore-${stamp()}`;
        fs.copyFileSync(DB_FILE, safety);
        log(`نسخة أمان من الحالة الحالية: ${path.basename(safety)}`);
    }
    // تحضير محتوى الاستعادة في مجلد مؤقت
    const tmp = fs.mkdtempSync(path.join(require('os').tmpdir(), 'rafidain-restore-'));
    let restoredDb;
    let hasUploads = false;
    try {
        if (isZip) {
            const entries = readCentral(fs.readFileSync(backup));
            hasUploads = entries.some((e) => e.name.startsWith('uploads/'));
            if (!entries.some((e) => e.name === 'app.db'))
                fail('الحزمة لا تضم قاعدة بيانات (app.db)');
            log('استخراج الحزمة...');
            extractZip(fs.readFileSync(backup), tmp);
            restoredDb = path.join(tmp, 'app.db');
        }
        else {
            restoredDb = path.join(tmp, 'app.db');
            fs.copyFileSync(backup, restoredDb);
        }
        if (!integrity(restoredDb))
            fail('نسخة تالفة: integrity_check فشل — لم تُطبَّق الاستعادة');
        log('النسخة سليمة (integrity_check ok)');
        if (!(await confirm())) {
            log('أُلغي — لم تتغير أي ملفات.');
            process.exit(0);
        }
        // استبدال قاعدة البيانات وحذف WAL/SHM القديمة (قد تحمل بيانات أحدث/غير متناسقة)
        fs.copyFileSync(restoredDb, DB_FILE);
        for (const suffix of ['-wal', '-shm']) {
            const w = DB_FILE + suffix;
            if (fs.existsSync(w))
                fs.unlinkSync(w);
        }
        log('استُبدلت قاعدة البيانات: ' + DB_FILE);
        // استبدال مجلد الصور فقط إن كانت الحزمة كاملة
        if (hasUploads) {
            const srcUploads = path.join(tmp, 'uploads');
            fs.rmSync(UPLOAD_DIR, { recursive: true, force: true });
            fs.cpSync(srcUploads, UPLOAD_DIR, { recursive: true });
            log('استُبدل مجلد الصور: ' + UPLOAD_DIR);
        }
        else if (isZip) {
            log('الحزمة بلا مجلد صور — تُركت الصور الحالية كما هي.');
        }
        if (!integrity(DB_FILE))
            fail('فشل التحقق بعد الاستعادة — راجع نسخة الأمان.');
        log('اكتملت الاستعادة بنجاح. الترحيلات تُطبَّق تلقائياً عند الإقلاع.');
    }
    finally {
        fs.rmSync(tmp, { recursive: true, force: true });
    }
}
main().catch((e) => fail(e.message));
