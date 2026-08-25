"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// بصمة الجهاز/المتصفح: ربط الجلسة بالجهاز الذي أنشأها بحيث لا يمكن نقل التوكن
// إلى جهاز آخر واستخدامه. تُحسب من عنوان IP + وكيل المتصفح (تطبيع خفيف) وتُخزَّن
// بلا معرفات إضافية. أي تغيير كبير في البصمة يُبطل الجلسة فوراً (إعادة دخول).
const crypto = require('crypto');
const { clientIp } = require('./rateLimit');
// تطبيع وكيل المتصفح: يُؤخذ أصل المتصفح/نظام التشغيل/الجهاز الرئيسي لا رقم الإصدار
// التفصيلي حتى لا تُبطل الجلسة عند تحديث بسيط للمتصفح.
function normalizeUA(ua) {
    const s = String(ua || '').slice(0, 300);
    const match = s.match(/(Chrome|Firefox|Safari|Edg\/|OPR\/|Version\/|Android|iPhone|iPad|Windows|Macintosh|Linux)[^()]*/);
    return match ? match[0].trim() : s.split('(')[0].trim().slice(0, 80) || 'unknown';
}
function deviceFingerprint(req) {
    const raw = `${normalizeUA(req.headers['user-agent'])}|${clientIp(req)}`;
    return crypto.createHash('sha256').update(raw).digest('hex');
}
// مقارنة آمنة بالزمن الثابت بين البصمة المخزنة والحالية
function fingerprintsMatch(a, b) {
    if (!a || !b)
        return false;
    const bufA = Buffer.from(String(a));
    const bufB = Buffer.from(String(b));
    if (bufA.length !== bufB.length)
        return false;
    return crypto.timingSafeEqual(bufA, bufB);
}
module.exports = { deviceFingerprint, fingerprintsMatch };
