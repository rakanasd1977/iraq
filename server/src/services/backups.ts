const fs = require('fs');
const path = require('path');
const { ApiError } = require('../utils/helpers');
const config = require('../config');
const { UPLOAD_DIR } = require('../utils/uploads');
const { extractZip, readCentral } = require('../utils/zip');

const BACKUP_DIR = path.join(path.dirname(config.dbPath), 'backups');
const DB_FILE = config.dbPath;
const NAME_RE = /^[A-Za-z0-9._-]+$/;

function ensureDir() {
  if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });
}

function stamp() {
  return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
}

function integrity(dbPath) {
  try {
    const { DatabaseSync } = require('node:sqlite');
    const d = new DatabaseSync(dbPath, { readOnly: true });
    try {
      const r = d.prepare('PRAGMA integrity_check').get();
      return r && r.integrity_check === 'ok';
    } finally {
      d.close();
    }
  } catch {
    return false;
  }
}

function resolveName(name) {
  if (!name || !NAME_RE.test(name)) throw new ApiError(400, 'اسم النسخة غير صالح');
  const full = path.join(BACKUP_DIR, name);
  if (path.dirname(full) !== BACKUP_DIR) throw new ApiError(400, 'اسم النسخة غير صالح');
  if (!fs.existsSync(full)) throw new ApiError(404, 'النسخة غير موجودة');
  return full;
}

function listBackups() {
  ensureDir();
  const files = fs.readdirSync(BACKUP_DIR).filter((f) => /\.(db|zip)$/.test(f)).sort();
  return files.map((name) => {
    const st = fs.statSync(path.join(BACKUP_DIR, name));
    return {
      name,
      size: st.size,
      created_at: st.mtimeMs ? new Date(st.mtimeMs).toISOString() : null,
      ext: path.extname(name).slice(1),
    };
  });
}

function createBackup() {
  ensureDir();
  const name = `manual-${stamp()}.db`;
  fs.copyFileSync(DB_FILE, path.join(BACKUP_DIR, name));
  const st = fs.statSync(path.join(BACKUP_DIR, name));
  return { name, size: st.size, created_at: new Date(st.mtimeMs).toISOString() };
}

function downloadBackup(name) {
  const full = resolveName(name);
  return { path: full, name };
}

function deleteBackup(name) {
  const full = resolveName(name);
  fs.unlinkSync(full);
  return { deleted: true };
}

function restoreBackup(name) {
  const full = resolveName(name);
  const isZip = full.endsWith('.zip');

  const tmp = fs.mkdtempSync(path.join(require('os').tmpdir(), 'rafidain-restore-'));
  let restoredDb;
  let hasUploads = false;
  try {
    if (isZip) {
      const entries = readCentral(fs.readFileSync(full));
      hasUploads = entries.some((e) => e.name.startsWith('uploads/'));
      if (!entries.some((e) => e.name === 'app.db')) throw new ApiError(400, 'الحزمة لا تضم قاعدة البيانات');
      extractZip(fs.readFileSync(full), tmp);
      restoredDb = path.join(tmp, 'app.db');
    } else {
      restoredDb = path.join(tmp, 'app.db');
      fs.copyFileSync(full, restoredDb);
    }

    if (!integrity(restoredDb)) throw new ApiError(400, 'النسخة تالفة (integrity_check فشل)');

    if (fs.existsSync(DB_FILE)) {
      const safety = `${DB_FILE}.pre-restore-${stamp()}`;
      fs.copyFileSync(DB_FILE, safety);
    }

    try {
      fs.copyFileSync(restoredDb, DB_FILE);
      for (const suffix of ['-wal', '-shm']) {
        const w = DB_FILE + suffix;
        if (fs.existsSync(w)) fs.unlinkSync(w);
      }
    } catch (e) {
      throw new ApiError(409, 'تعذّر استبدال قاعدة البيانات أثناء تشغيل الخادم. أوقف الخادم ثم نفّذ سكربت الاستعادة.');
    }

    if (hasUploads) {
      const srcUploads = path.join(tmp, 'uploads');
      fs.rmSync(UPLOAD_DIR, { recursive: true, force: true });
      fs.cpSync(srcUploads, UPLOAD_DIR, { recursive: true });
    }

    return { restored: true, restarted_required: true, message: 'أُبدلت قاعدة البيانات. أعد تشغيل الخادم لتطبيق النسخة.' };
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

async function uploadToCloud(name) {
  const full = resolveName(name);
  const bucket = process.env.GCS_BUCKET;
  const keyJson = process.env.GCS_CREDENTIALS_JSON || process.env.GOOGLE_CREDENTIALS_JSON;
  if (!bucket || !keyJson) return { configured: false };

  let Storage;
  try {
    ({ Storage } = await import('@google-cloud/storage'));
  } catch {
    throw new ApiError(500, 'مكتبة التخزين السحابي غير مثبّتة (@google-cloud/storage)');
  }

  const storage = new Storage({ credentials: JSON.parse(keyJson) });
  const dest = `rafidain-backups/${name}`;
  await storage.bucket(bucket).file(dest).save(fs.readFileSync(full));
  return { configured: true, uri: `gs://${bucket}/${dest}`, uploaded_at: new Date().toISOString() };
}

module.exports = { listBackups, createBackup, downloadBackup, deleteBackup, restoreBackup, uploadToCloud, BACKUP_DIR };
