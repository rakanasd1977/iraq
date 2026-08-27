// وسائط أمان عامة تُطبَّق على كل استجابات API:
// رؤوس حماية (clickjacking / MIME sniffing / كشف المرجِع / الأذونات) +
// حماية من حقن النموذج الأولي في أجسام JSON (مفاتيح __proto__/constructor/prototype).
const config = require('../config');

const BLOCKED_KEYS = ['__proto__', 'constructor', 'prototype'];

// تعقيم عميق لأجسام الطلبات: يزيل مفاتيح النموذج الأولي من كل مستوى
// حتى لا يُلوَّث Object.prototype عبر أي عملية دمج/نسخ لاحقة.
function sanitizeValue(value) {
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) value[i] = sanitizeValue(value[i]);
    return value;
  }
  if (value && typeof value === 'object') {
    for (const key of Object.keys(value)) {
      if (BLOCKED_KEYS.includes(key)) {
        delete value[key];
        continue;
      }
      value[key] = sanitizeValue(value[key]);
    }
  }
  return value;
}

function sanitizeBody(req, res, next) {
  if (req.body && typeof req.body === 'object') req.body = sanitizeValue(req.body);
  if (req.query && typeof req.query === 'object') req.query = sanitizeValue(req.query);
  if (req.params && typeof req.params === 'object') req.params = sanitizeValue(req.params);
  next();
}

// رؤوس الأمان على كل الاستجابات. يُستثنى /uploads من no-store لأن الصور تُخزَّن
// مؤقتاً بقصد (ويضبط مسار الصور رأس Cache-Control الخاص به لاحقاً).
function securityHeaders(req, res, next) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=()');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  // CSP للواجهة: يمنع تحميل أي مورد من نطاق API وتضمينه في إطار (clickjacking)
  res.setHeader("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'");
  if (config.env === 'production') {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  if (!req.path.startsWith('/uploads')) {
    // نقاط النهاية العامة (المجهولة) مستقرة نسبياً: نسمح بتخبيئها قصير الأمد
    // في المتصفح/الـ CDN لتقليل إعادة الجلب المكلفة عند التنقّل بين الصفحات.
    if (req.path.startsWith('/api/public/')) {
      res.setHeader('Cache-Control', 'public, max-age=60');
    } else {
      res.setHeader('Cache-Control', 'no-store');
    }
  }
  next();
}

module.exports = { securityHeaders, sanitizeBody, sanitizeValue };
