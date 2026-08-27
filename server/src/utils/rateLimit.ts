// حدود بسيطة في الذاكرة لعدد الطلبات لكل عنوان IP ضمن نافذة زمنية.
// ملاحظة: المخزن في الذاكرة خاص بالمثيل الحالي؛ عند التوسع لمثيلات متعددة
// يجب استبداله بمخزن مشترك (Redis مثلاً) — انظر قسم قابلية التوسع في docs/system-analysis.md.
const config = require('../config');
const { rateLimitCheck } = require('../db');
const DEFAULT_WINDOW_MS = Number(process.env.RATE_LIMIT_WINDOW_MS) || 60000;
const DEFAULT_MAX = Number(process.env.RATE_LIMIT_MAX) || 10;

// عناوين خاصة/محلية فقط تصل عادةً من موازن التحميل أو nginx على نفس الجهة
const PRIVATE_IP = /^127\.|^10\.|^192\.168\.|^172\.(1[6-9]|2\d|3[01])\.|^::1$|^::ffff:127\.|^::ffff:10\./;

// استخدام X-Forwarded-For (عبر req.ip) فقط خلف موازن حقيقي: عندما يكون TRUST_PROXY مفعلاً
// ويرى الخادم اتصالاً من جهة خاصة. عند الاتصال المباشر يُتجاهل XFF فوراً وإلا أمكن تزوير
// الرأس والالتفاف على الحد.
function clientIp(req) {
  const socketIp = req.socket && req.socket.remoteAddress || 'unknown';
  if (config.trustProxy && PRIVATE_IP.test(String(socketIp))) {
    return req.ip || socketIp;
  }
  return socketIp;
}

// مصنع عدّاد حد: نافذة/سقف قابلان للضبط عبر متغيرات بيئة أو وسائط الاستدعاء.
// لكل مثيل مخزنه الخاص حتى لا تُدمج عدّادات الحدود المختلفة على نفس المفتاح.
function createRateLimiter(opts: any = {}) {
  const windowMs = opts.windowMs || DEFAULT_WINDOW_MS;
  const max = opts.max || DEFAULT_MAX;
  const message = opts.message || 'محاولات كثيرة، يرجى المحاولة بعد قليل';
  const hits = new Map();

  const rateLimit = function rateLimit(req, res, next) {
    const key = clientIp(req);
    const now = Date.now();
    const entry = hits.get(key);

    if (!entry || entry.resetAt <= now) {
      hits.set(key, { count: 1, resetAt: now + windowMs });
      return next();
    }

    entry.count += 1;
    if (entry.count > max) {
      return res.status(429).json({ success: false, message });
    }
    return next();
  };

  // تنظيف دوري للذاكرة خاص بالمثيل
  setInterval(() => {
    const now = Date.now();
    for (const [k, v] of hits) {
      if (v.resetAt <= now) hits.delete(k);
    }
  }, Math.max(windowMs, 60000)).unref();

  return rateLimit;
}

// عدّاد احتياطي في الذاكرة (يُستخدم عند تعذّر الوصول لقاعدة البيانات)
function localCheck(map, key, max, windowMs) {
  const now = Date.now();
  const entry = map.get(key);
  if (!entry || entry.resetAt <= now) {
    map.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true };
  }
  entry.count += 1;
  if (entry.count > max) return { allowed: false };
  return { allowed: true };
}

// عدّاد مشترك عبر قاعدة البيانات: يرى كل عمال العنقود نفس العدّاد (آمن للتوسع)
// ومستديم عبر إعادة التشغيل. عند أي خلل في قاعدة البيانات يتراجع إلى العدّاد المحلي
// كي لا يحجب المستخدمين (fail-open).
function createSharedRateLimiter(opts: any = {}) {
  const windowMs = opts.windowMs || DEFAULT_WINDOW_MS;
  const max = opts.max || DEFAULT_MAX;
  const message = opts.message || 'محاولات كثيرة، يرجى المحاولة بعد قليل';
  const scope = opts.scope || 'default';
  const fallback = new Map();
  const limiter = function rateLimit(req, res, next) {
    const key = 'rl:' + scope + ':' + clientIp(req);
    let decision;
    try {
      decision = rateLimitCheck(key, max, windowMs);
    } catch (e: any) {
      // في الإنتاج نرفض الطلب عند فشل قاعدة البيانات (fail-closed) لئلا يُعطَّل الحدّ؛
      // في التطوير/الاختبار نتراجع إلى عدّاد محلي كي لا نعيق التطوير.
      if (config.env === 'production') {
        return res.status(503).json({ success: false, message: 'الخدمة مشغولة، يرجى المحاولة بعد قليل' });
      }
      decision = localCheck(fallback, key, max, windowMs);
    }
    if (!decision.allowed) return res.status(429).json({ success: false, message });
    return next();
  };
  return limiter;
}

// في الإنتاج نستخدم العدّاد المشترك (آمن للعنقود)؛ في التطوير/الاختبار نكتفي بالعدّاد
// المحلي المتزامن لأن الاختبارات تعتمد سلوكه ولا نريد كتابة قاعدة البيانات أثناء الاختبار.
const rateLimit = (config.env === 'production') ? createSharedRateLimiter() : createRateLimiter();

module.exports = { rateLimit, createRateLimiter, createSharedRateLimiter, clientIp };
