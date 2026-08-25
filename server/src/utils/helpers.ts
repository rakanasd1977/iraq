class ApiError extends Error {
  status: any;
  details: any;
  constructor(status, message, details = null) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

function toId(value, name = 'المعرف') {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) throw new ApiError(400, `قيمة ${name} غير صحيحة`);
  return id;
}

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

// حدود أمان للقيم المالية والكميات لمنع إدخال مبالغ/كميات خيالية (تضخّم الإيرادات/العمولات أو تجاوز دقة العائمة)
const MAX_MONEY = 1e12; // تريليون دينار كحد أعلى لأي مبلغ
const MAX_QUANTITY = 100000;

function assertAmount(value, label = 'المبلغ') {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) throw new ApiError(400, `${label} يجب أن يكون رقماً غير سالب`);
  if (n > MAX_MONEY) throw new ApiError(400, `${label} يتجاوز الحد المسموح`);
  // تثبيت الدقة عند منزلتين عشريتين كحد أقصى؛ أي كسر أدق يُرفض لمنع "غبار" الأرقام
  // العشرية الذي يولّد أخطاء تقريب عند التخزين ضمن أعداد ذات فاصلة عائمة.
  const rounded = Math.round(n * 100) / 100;
  if (Math.abs(rounded - n) > 1e-9) throw new ApiError(400, `${label} لا يُقبل بأكثر من منزلتين عشريتين`);
  return rounded;
}

function assertQuantity(value, label = 'الكمية') {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) throw new ApiError(400, `${label} يجب أن تكون عدداً صحيحاً موجباً`);
  if (n > MAX_QUANTITY) throw new ApiError(400, `${label} تتجاوز الحد المسموح`);
  return n;
}

function addYears(date, years) {
  const d = new Date(date);
  d.setFullYear(d.getFullYear() + years);
  return d;
}

function nextLeasePeriod(currentExpiry) {
  const base = currentExpiry && new Date(currentExpiry) > new Date() ? new Date(currentExpiry) : new Date();
  const end = addYears(base, 1);
  return { start: base, end };
}

function settingValue(key, fallback) {
  const { get } = require('../db');
  const row = get('SELECT value FROM settings WHERE key = ?', [key]);
  const n = Number(row ? row.value : NaN);
  return Number.isFinite(n) ? n : fallback;
}

// ترقيم صفحات إلزامي بحد أقصى: كل قائمة تُقصّ دائماً (افتراضي 50 / سقف 100)
// حتى لو لم يمرر العميل page/limit — فلا تُرد قائمة بلا حدود إطلاقاً.
function paginate(req, defaultLimit = 50) {
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || defaultLimit));
  const offset = (page - 1) * limit;
  return { page, limit, offset, enabled: true };
}

// تقييد أطوال الحقول النصية الحساسة (الوقاية من تضخيم الطلبات)
function assertLength(value, max, name, min = 1) {
  const s = String(value ?? '');
  if (s.length < min) throw new ApiError(400, `قيمة ${name} قصيرة جداً`);
  if (s.length > max) throw new ApiError(400, `قيمة ${name} تتجاوز الحد المسموح (${max} حرفاً)`);
  return s;
}

// كشف اصطدام UNIQUE في node:sqlite (يرمي code=ERR_SQLITE_ERROR / errcode=2067،
// وليس SQLITE_CONSTRAINT_UNIQUE) — يغطي أيضاً إصدارات أخرى من الاسم القديم/الرسالة.
function isUniqueViolation(e) {
  return !!(e && (
    e.errcode === 2067
    || e.code === 'SQLITE_CONSTRAINT_UNIQUE'
    || e.code === 'SQLITE_CONSTRAINT'
    || /UNIQUE constraint failed/i.test(String(e.message || ''))
  ));
}

function csvEscape(value) {
  const s = value === null || value === undefined ? '' : String(value);
  // حقن CSV: بادئة ' تُبطل تفسير الصيغ (=,+,-,@) في Excel
  if (/^[=+\-@]/.test(s)) return "'" + s;
  if (/[",\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

// تحويل تاريخ محلي (YYYY-MM-DD) إلى حد UTC: بداية اليوم أو نهايته (آخر مللي ثانية).
// created_at مخزنة UTC، و`from`/`to` يُفسران بمنطقة الخادم المحلية ليشمل اليوم كاملاً.
function localDayUtcBoundary(dateStr, endOfDay) {
  const m = String(dateStr).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const d = new Date(
    Number(m[1]), Number(m[2]) - 1, Number(m[3]),
    endOfDay ? 23 : 0, endOfDay ? 59 : 0, endOfDay ? 59 : 0, endOfDay ? 999 : 0
  );
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

function parseJsonArray(json) {
  if (!json) return [];
  try { const v = JSON.parse(json); return Array.isArray(v) ? v : []; } catch (e: any) { return []; }
}

function parseImages(json) {
  return parseJsonArray(json);
}

function parseIncludes(json) {
  return parseJsonArray(json);
}

// تحقق من نطاق تاريخ YYYY-MM-DD وتحويل حديه إلى UTC (يرمي 400 عند الصيغة الخاطئة أو انعكاس النطاق)
function parseDateRange(from, to) {
  let fromUtc = null;
  let toUtc = null;
  if (from !== undefined && from !== null && from !== '') {
    fromUtc = localDayUtcBoundary(from, false);
    if (!fromUtc) throw new ApiError(400, 'تاريخ البداية غير صالح (الصيغة YYYY-MM-DD)');
  }
  if (to !== undefined && to !== null && to !== '') {
    toUtc = localDayUtcBoundary(to, true);
    if (!toUtc) throw new ApiError(400, 'تاريخ النهاية غير صالح (الصيغة YYYY-MM-DD)');
  }
  if (fromUtc && toUtc && fromUtc > toUtc) throw new ApiError(400, 'تاريخ البداية يسبق تاريخ النهاية');
  return { fromUtc, toUtc };
}

module.exports = { ApiError, toId, round2, nextLeasePeriod, settingValue, paginate, csvEscape, assertLength, isUniqueViolation, localDayUtcBoundary, parseDateRange, parseImages, parseIncludes, MAX_MONEY, MAX_QUANTITY, assertAmount, assertQuantity };
