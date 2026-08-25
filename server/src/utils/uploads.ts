// أدوات ملفات الصور: فحص magic bytes، الحفظ من base64، واستخراج/حذف مراجع /uploads.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { ApiError } = require('./helpers');

const UPLOAD_DIR = path.join(__dirname, '../../data/uploads');
const MAX_BYTES = 2 * 1024 * 1024;

// الصيغ المقبولة مع توقيع الملف (magic bytes) — أي صيغة غيرها (SVG/BMP...) تُرفض
// لأن /uploads يُقدَّم عاماً: SVG برمجي قد يُنفَّذ عبر /uploads.
const IMAGE_SPECS = {
  'image/png': { ext: 'png', sig: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  'image/jpeg': { ext: 'jpg', sig: [0xff, 0xd8, 0xff] },
  'image/jpg': { ext: 'jpg', sig: [0xff, 0xd8, 0xff] },
  'image/webp': { ext: 'webp', sig: [0x52, 0x49, 0x46, 0x46] },
  'image/gif': { ext: 'gif', sig: [0x47, 0x49, 0x46, 0x38] },
};

function validateImageBuffer(buf, mime) {
  const spec = IMAGE_SPECS[mime];
  if (!spec) throw new ApiError(400, 'صيغة الصورة غير مدعومة — يقبل PNG وJPG وWebP وGIF فقط');
  if (buf.length < spec.sig.length || !spec.sig.every((b, i) => buf[i] === b)) {
    throw new ApiError(400, 'محتوى الصورة لا يطابق النوع المعلن');
  }
  if (mime === 'image/webp' && (buf.length < 12 || buf.toString('latin1', 8, 12) !== 'WEBP')) {
    throw new ApiError(400, 'محتوى الصورة لا يطابق النوع المعلن');
  }
}

// فك رموز data:image/...;base64، التحقق من الصيغة والمحتوى، وحفظها كملف غير قابل للتخمين.
function saveBase64ToUpload(dataUri, opts: any = {}) {
  const maxBytes = opts.maxBytes || MAX_BYTES;
  const m = /^data:([a-z]+\/[a-z0-9.+-]+);base64,(.+)$/i.exec(String(dataUri || '').trim());
  if (!m) throw new ApiError(400, 'صيغة غير صالحة — أرسل الصورة بصيغة data:image/...;base64');
  const mime = m[1].toLowerCase();
  if (!mime.startsWith('image/')) throw new ApiError(400, 'يُقبل ملفات الصور فقط');
  const buf = Buffer.from(m[2], 'base64');
  if (buf.length === 0) throw new ApiError(400, 'الملف فارغ');
  if (buf.length > maxBytes) throw new ApiError(400, `حجم الصورة يتجاوز الحد الأقصى (${Math.round(maxBytes / 1024 / 1024)}MB)`);
  validateImageBuffer(buf, mime);
  const filename = `${Date.now()}-${crypto.randomBytes(8).toString('hex')}.${IMAGE_SPECS[mime].ext}`;
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  const filePath = path.join(UPLOAD_DIR, filename);
  fs.writeFileSync(filePath, buf);
  return { url: `/uploads/${filename}`, filename, filePath };
}

const UPLOAD_REF_RE = /\/uploads\/([A-Za-z0-9._-]+)/g;

// استخراج مراجع /uploads/<file> من أي قيمة (رابط مفرد، مصفوفة JSON، سلسلة مفصولة بفواصل).
function extractUploadRefs(value) {
  if (value === null || value === undefined) return [];
  const out = [];
  const s = String(value);
  const re = new RegExp(UPLOAD_REF_RE.source, 'g');
  let m;
  while ((m = re.exec(s)) !== null) out.push(`/uploads/${m[1]}`);
  return out;
}

// مسار ملف صالح داخل دليل uploads فقط (منع الخروج منه بأسماء ضارة)
function uploadFilePath(ref) {
  const m = /^\/uploads\/([A-Za-z0-9._-]+)$/.exec(String(ref || '').trim());
  if (!m) return null;
  const base = path.resolve(UPLOAD_DIR);
  const abs = path.resolve(base, m[1]);
  if (abs !== base && !abs.startsWith(base + path.sep)) return null;
  return abs;
}

// حذف ملف واحد إن وُجد (يتجاهل غياب الملف والأخطاء — لا يكسر الطلب)
function deleteUploadRef(ref) {
  const abs = uploadFilePath(ref);
  if (!abs) return;
  try {
    if (fs.existsSync(abs)) fs.unlinkSync(abs);
  } catch (e: any) { /* تجاهل */ }
}

// حذف كل الملفات المذكورة في قيمة
function deleteUploadValue(value) {
  for (const ref of extractUploadRefs(value)) deleteUploadRef(ref);
}

// حذف مراجع القيمة القديمة غير الموجودة في الجديدة (عند استبدال صورة)
function deleteRemovedImages(oldValue, newValue) {
  const kept = new Set(extractUploadRefs(newValue));
  for (const ref of extractUploadRefs(oldValue)) {
    if (!kept.has(ref)) deleteUploadRef(ref);
  }
}

// تحويل قيمة مخزنة (رابط مفرد أو مصفوفة JSON) من base64 إلى رابط /uploads — للترحيل.
function convertBase64Value(value) {
  if (value === null || value === undefined || value === '') return value;
  const s = String(value).trim();
  if (s.startsWith('[')) {
    let arr = null;
    try { arr = JSON.parse(s); } catch (e: any) { arr = null; }
    if (Array.isArray(arr)) {
      return JSON.stringify(arr.map((el) => {
        const es = String(el ?? '');
        return es.startsWith('data:image/') ? saveBase64ToUpload(es).url : es;
      }));
    }
  }
  if (s.startsWith('data:image/')) return saveBase64ToUpload(s).url;
  return value;
}

module.exports = {
  UPLOAD_DIR,
  MAX_BYTES,
  IMAGE_SPECS,
  validateImageBuffer,
  saveBase64ToUpload,
  extractUploadRefs,
  uploadFilePath,
  deleteUploadRef,
  deleteUploadValue,
  deleteRemovedImages,
  convertBase64Value,
};
