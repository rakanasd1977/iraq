"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// جلسات التوكن: سجلات في قاعدة البيانات تسمح بإبطال التوكن فوراً عند تسجيل الخروج
// (إبطال فردي أو شامل)، مقابل استعلام فهرس واحد في كل طلب مصادق. جلسات بلا توكن
// إصدار أقدم تبقى صالحة حتى انتهاء صلاحيتها (توافق تدريجي) لكنها غير قابلة للإبطال.
// كل جلسة مرتبطة ببصمة الجهاز الذي أنشأها (fingerprint) وترفض الاستخدام من جهاز آخر.
const crypto = require('crypto');
const { run, get } = require('../db');
const { signToken } = require('./jwt');
const { clientIp } = require('./rateLimit');
const { deviceFingerprint } = require('./fingerprint');
const config = require('../config');
const TWOFA_TTL_MS = 5 * 60000;
// تحليل jwtExpiresIn ('1d'، '12h'، '30m'…) إلى ملي ثانية لحفظ انتهاء الجلسة بالتزامن مع التوكن
function jwtTtlMs() {
    const s = String(config.jwtExpiresIn).trim();
    const m = /^(\d+)([smhd])$/.exec(s);
    if (!m)
        return 86400000;
    const mult = { s: 1000, m: 60000, h: 3600000, d: 86400000 }[m[2]];
    return Number(m[1]) * mult;
}
// فحص حياة الجلسة: استعلام فهرس واحد في كل طلب مصادق.
function isLiveSession(jti) {
    return !!get("SELECT 1 AS x FROM sessions WHERE id = ? AND expires_at > datetime('now')", [jti]);
}
// إنشاء جلسة + توقيع توكن يحمل معرفها (jti) + حفظ بصمة الجهاز
function issueToken(user, req) {
    const jti = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + jwtTtlMs()).toISOString().replace('T', ' ').slice(0, 19);
    run('INSERT INTO sessions (id, user_id, expires_at, user_agent, ip, fingerprint) VALUES (?,?,?,?,?,?)', [jti, user.id, expiresAt, String(req.headers['user-agent'] || '').slice(0, 200), clientIp(req), deviceFingerprint(req)]);
    return signToken(user, jti);
}
// توكن مؤقت لدخول المصادقة الثنائية: صالح 5 دقائق فقط، بلا جلسة في قاعدة البيانات
// ولا يحمل صلاحيات — يُستبدل فور التحقق بتوكن جلسة حقيقي.
function issue2FAChallenge(user, req) {
    return signToken(user, `2fa-${crypto.randomUUID()}`, TWOFA_TTL_MS, { twofa_pending: true });
}
// إبطال جلسة واحدة (تسجيل خروج من جهاز معين)
function revokeSession(jti) {
    if (!jti)
        return;
    run('DELETE FROM sessions WHERE id = ?', [jti]);
}
// إبطال كل جلسات المستخدم (تسجيل خروج من كل الأجهزة)
function revokeAllSessions(userId) {
    run('DELETE FROM sessions WHERE user_id = ?', [userId]);
}
// إبطال كل جلسات المستخدم عدا الجلسة الحالية (تُستخدم عند تغيير كلمة المرور)
function revokeAllExceptSession(userId, keepJti) {
    if (keepJti) {
        run('DELETE FROM sessions WHERE user_id = ? AND id != ?', [userId, keepJti]);
    }
    else {
        revokeAllSessions(userId);
    }
}
// تقليم الجلسات المنتهية (تُستدعى دورياً مع صيانة الخادم)
function pruneSessions() {
    try {
        const res = run("DELETE FROM sessions WHERE expires_at <= datetime('now')");
        if (res?.changes > 0)
            console.log(`[session] تقليم الجلسات المنتهية: حُذف ${res.changes} جلسة`);
    }
    catch (e) {
        console.error('[session] prune failed:', e.message);
    }
}
module.exports = { jwtTtlMs, isLiveSession, issueToken, issue2FAChallenge, revokeSession, revokeAllSessions, revokeAllExceptSession, pruneSessions };
