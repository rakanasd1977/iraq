"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// حدود بسيطة في الذاكرة لعدد الطلبات لكل عنوان IP ضمن نافذة زمنية.
// ملاحظة: المخزن في الذاكرة خاص بالمثيل الحالي؛ عند التوسع لمثيلات متعددة
// يجب استبداله بمخزن مشترك (Redis مثلاً) — انظر قسم قابلية التوسع في docs/system-analysis.md.
const config = require('../config');
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
function createRateLimiter(opts = {}) {
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
            if (v.resetAt <= now)
                hits.delete(k);
        }
    }, Math.max(windowMs, 60000)).unref();
    return rateLimit;
}
const rateLimit = createRateLimiter();
module.exports = { rateLimit, createRateLimiter, clientIp };
