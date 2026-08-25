"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// قفل الحساب عند فشل الدخول المتكرر — يمنع تخمين كلمات المرور (تفجير القوة)
// ويستخدم جدول login_failures. تُسجَّل كل محاولة فاشلة مع هوية الدخول وعنوان IP.
// تُقفَل الهوية عند تجاوز العتبة؛ ويُقفَل العنوان عند عتبة أعلى (كشف القصف بعناوين
// كثيرة من IP واحد) حتى لا يُحجب جميع المستخدمين خلف نفس العنوان (NAT/مكاتب).
const { get, run } = require('../db');
const config = require('../config');
const { maxFailures, windowMinutes, durationMinutes } = config.lockout;
const WINDOW_MS = windowMinutes * 60000;
const DURATION_MS = durationMinutes * 60000;
// عتبة العنوان أعلى من عتبة الهوية: الحساب يُقفل أسرع من الشبكة المشتركة
const IP_THRESHOLD = Math.max(maxFailures * 2, 10);
function iso(ms) {
    return new Date(ms).toISOString().replace('T', ' ').slice(0, 19);
}
// عتبة عدد المحاولات الفاشلة خلال نافذة زمنية
function recentFailures(identifier, ip) {
    const since = iso(Date.now() - WINDOW_MS);
    const byIdentifier = get('SELECT COUNT(*) AS c FROM login_failures WHERE identifier = ? AND created_at > ?', [identifier, since]);
    const byIp = get('SELECT COUNT(*) AS c FROM login_failures WHERE ip = ? AND created_at > ?', [ip, since]);
    return { byIdentifier: byIdentifier ? byIdentifier.c : 0, byIp: byIp ? byIp.c : 0 };
}
// هل الحساب/العنوان مقفول الآن؟ يُعيد المدة المتبقية بالثواني أو null
function lockRemaining(identifier, ip) {
    const { byIdentifier, byIp } = recentFailures(identifier, ip);
    const hitMax = byIdentifier >= maxFailures || byIp >= IP_THRESHOLD;
    if (!hitMax)
        return null;
    // أول محاولة تجاوزت العتبة حددت بداية القفل؛ نحسب الباقي من أحدث قيد داخل النافذة
    const latest = get('SELECT MAX(created_at) AS m FROM login_failures WHERE (identifier = ? OR ip = ?) AND created_at > ?', [identifier, ip, iso(Date.now() - WINDOW_MS)]);
    const latestMs = latest && latest.m ? new Date(latest.m + 'Z').getTime() : Date.now();
    const remaining = DURATION_MS - (Date.now() - latestMs);
    return remaining > 0 ? Math.ceil(remaining / 1000) : null;
}
// تسجيل محاولة فاشلة (تُستدعى قبل رمي خطأ 401)
function recordFailure(identifier, ip) {
    run('INSERT INTO login_failures (identifier, ip) VALUES (?,?)', [identifier, ip]);
    // تقليم قديم لتحديد الحجم
    run("DELETE FROM login_failures WHERE created_at <= datetime('now', '-1 day')");
}
// عند نجاح الدخول: مسح سجل الفشل لهذه الهوية حتى لا تُعاقب جلسة ناجحة لاحقاً
function clearFailures(identifier, ip) {
    run('DELETE FROM login_failures WHERE identifier = ? OR ip = ?', [identifier, ip]);
}
module.exports = { recordFailure, clearFailures, lockRemaining, recentFailures };
