require('dotenv').config();
const path = require('path');
const crypto = require('crypto');

const env = process.env.NODE_ENV || 'development';

// لا نستخدم أبداً سرّاً معروفًا علنًا. إن لم يُضبط JWT_SECRET:
//  - في الإنتاج: نرفض الإقلاع (فشل مغلق).
//  - في التطوير/الاختبار: نولّد سرًّا مؤقتًا لكل إقلاع (تُبطل الجلسات عند إعادة التشغيل، وهذا مقبول للتطوير).
let jwtSecret = process.env.JWT_SECRET;
if (!jwtSecret) {
  if (env === 'production') {
    throw new Error('يجب تعيين JWT_SECRET في بيئة الإنتاج قبل الإقلاع');
  }
  jwtSecret = crypto.randomBytes(32).toString('hex');
  process.env.JWT_SECRET = jwtSecret; // حتى يرثه عمال cluster (fork بعد تحميل config في primary)
  console.warn('[config] JWT_SECRET غير مضبوط — تم توليد سرّ مؤقت للتطوير. اضبط JWT_SECRET في الإنتاج/الاختبار.');
}

const config = {
  port: Number(process.env.PORT || 4001),
  jwtSecret,
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '1d',
  dbPath: process.env.DB_PATH
    ? path.resolve(process.env.DB_PATH)
    : path.join(__dirname, '../data/app.db'),
  appName: process.env.APP_NAME || 'سوق الرافدين',
  env,
  // خلف عكس الوكيل (nginx) يجب تفعيله ليُحتسب عنوان العميل الحقيقي من X-Forwarded-For.
  // مفعّل افتراضياً في الإنتاج، ويُعطّل صراحةً بـ TRUST_PROXY=0.
  trustProxy: process.env.TRUST_PROXY === undefined
    ? env === 'production'
    : (process.env.TRUST_PROXY === '1' || Number(process.env.TRUST_PROXY) === 1),
  corsOrigins: (process.env.CORS_ORIGINS || 'http://localhost:5173,http://localhost:5174,http://localhost:5175,http://localhost:5176,http://localhost:8081,http://localhost:8082,http://localhost:8083,http://localhost:8084')
    .split(',').map((s) => s.trim()).filter(Boolean),

  // قفل الحساب عند فشل الدخول المتكرر
  lockout: {
    maxFailures: Number(process.env.LOCKOUT_MAX_FAILURES || 5),
    windowMinutes: Number(process.env.LOCKOUT_WINDOW_MIN || 15),
    durationMinutes: Number(process.env.LOCKOUT_DURATION_MIN || 15),
  },

  // جلسات HttpOnly: اسم الكوكي ومدتها (تزامن مع JWT_EXPIRES_IN)
  // بادئة __Host- تُطبَّق تلقائياً في الإنتاج (HTTPS) لمنع حقن الكوكي من نطاقات فرعية؛
  // وتتطلب Secure + Path=/ بلا Domain (متحقِّق هنا)، فلا تُفعَّل إلا عندما يكون الكوكي Secure.
  cookie: (() => {
    const secure = process.env.COOKIE_SECURE === '1' || env === 'production';
    const baseSession = process.env.SESSION_COOKIE_NAME || 'rafidain_session';
    const baseCsrf = process.env.CSRF_COOKIE_NAME || 'rafidain_csrf';
    return {
      name: secure ? `__Host-${baseSession}` : baseSession,
      csrfName: secure ? `__Host-${baseCsrf}` : baseCsrf,
      secure,
    };
  })(),

  // حدود بث الإشعارات الحي (SSE) لمنع استنزاف الاتصالات/الذاكرة
  sse: {
    maxClients: Number(process.env.SSE_MAX_CLIENTS || 2000),
    maxPerUser: Number(process.env.SSE_MAX_PER_USER || 5),
  },
};

module.exports = config;
