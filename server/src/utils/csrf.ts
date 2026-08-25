// حماية CSRF للجلسات القائمة على الكوكي: كل تغيير (POST/PUT/DELETE/PATCH) يجب أن
// يحمل رأس X-CSRF-Token مطابقاً لقيمة كوكي rafidain_csrf (أسلوب المزدوج). الكوكي
// غير HttpOnly لأن العميل يحتاج قراءته، لكن منع الوصول إليه من نصوص أجنبية يكفل
// SameSite=Lax (لا يُرسل عبر مواقع أجنبية) وفحص الرأس. طلبات Bearer لا تحتاج CSRF
// لأن التوكن لا يُرسل تلقائياً مع أي طلب.
const crypto = require('crypto');
const config = require('../config');
const { verifyToken } = require('./jwt');

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function cookieOptions(maxAgeMs) {
  const opts = [
    `Path=/`,
    `SameSite=Lax`,
    `Max-Age=${Math.floor((maxAgeMs || 86400000) / 1000)}`,
  ];
  if (config.cookie.secure) opts.push('Secure');
  return opts.join('; ');
}

function setCsrf(res, user, jwtTtlMs) {
  const token = crypto.randomBytes(32).toString('hex');
  // append حتى لا يمحو كوكي الجلسة المضبوط مسبقاً بـ setHeader
  res.append('Set-Cookie', `${config.cookie.csrfName}=${token}; ${cookieOptions(jwtTtlMs)}`);
  return token;
}

function clearCookies(res) {
  const now = 'Max-Age=0; Path=/; SameSite=Lax';
  res.append('Set-Cookie', `${config.cookie.name}=; ${now}`);
  res.append('Set-Cookie', `${config.cookie.csrfName}=; ${now}`);
}

function readCookie(req, name) {
  const header = req.headers.cookie || '';
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    const key = part.slice(0, eq).trim();
    if (key === name) return part.slice(eq + 1).trim();
  }
  return null;
}

// فحص CSRF على مستوى التطبيق (قبل المسارات). للطلبات الآمنة يمرر، وللطلبات المعدِّلة
// يشترط رأس X-CSRF-Token مطابقاً لكوكي rafidain_csrf فقط عندما يرسل العميل كوكي جلسة
// صالحاً (المصادقة بالكوكي). كوكي جلسة غير صالح/قديم (مثلاً بعد إعادة تشغيل الخادم بسرّ
// مختلف) يُسمح بمروره ليُرفض لاحقاً عبر authenticate بـ401 بدل رمي 403 محيّر لـCSRF.
// طلبات Bearer لا تحمل كوكي جلسة فتُستثنى أصلاً. كوكي الجلسة SameSite=Lax يمنع إرساله
// عبر مواقع أجنبية، وهذا الفحص طبقة دفاع إضافية.
function csrfProtect(req, res, next) {
  if (SAFE_METHODS.has(req.method)) return next();
  const sessionCookie = readCookie(req, config.cookie.name);
  if (!sessionCookie) return next();
  let validSession = false;
  try { validSession = !!verifyToken(sessionCookie); } catch (e) { validSession = false; }
  if (!validSession) return next();
  const cookieToken = readCookie(req, config.cookie.csrfName);
  const headerToken = req.headers['x-csrf-token'];
  if (!cookieToken || !headerToken || cookieToken !== headerToken) {
    return next(new (require('./helpers').ApiError)(403, 'طلب مرفوض (حماية CSRF)، يرجى تحديث الصفحة وإعادة المحاولة'));
  }
  return next();
}

module.exports = { setCsrf, clearCookies, readCookie, csrfProtect };
