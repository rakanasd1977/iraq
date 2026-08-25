"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// برنامج الولاء والنقاط + مكافآت الإحالة.
const { get, run } = require('../db');
const { settingValue, round2, ApiError } = require('./helpers');
const TIERS = [
    { key: 'bronze', name: 'برونزي', min: 0, icon: '🥉' },
    { key: 'silver', name: 'فضي', min: 500, icon: '🥈' },
    { key: 'gold', name: 'ذهبي', min: 1500, icon: '🥇' },
    { key: 'platinum', name: 'بلاتيني', min: 5000, icon: '💎' },
];
function tierOf(total) {
    const t = [...TIERS].reverse().find((x) => (Number(total) || 0) >= x.min);
    return t || TIERS[0];
}
function nextTier(total) {
    const t = TIERS.find((x) => (Number(total) || 0) < x.min);
    return t || null;
}
// خصم نقدي مقابل نقاط (يُصدَّق على أصل قبل الحسم).
function pointsDiscount(points) {
    const n = Math.floor(Number(points) || 0);
    if (!Number.isFinite(n) || n <= 0)
        return 0;
    const perPoint = settingValue('loyalty_point_value', 1);
    return round2(n * perPoint);
}
// إضافة نقاط للرصيد وتسجيل الحركة (داخل معاملة أو بعدها).
function awardPoints(userId, points, type, description, orderId) {
    const n = Math.round(Number(points) || 0);
    if (n === 0)
        return;
    run('UPDATE users SET points_balance = points_balance + ?, points_total = points_total + ? WHERE id = ?', [n, Math.max(n, 0), userId]);
    run('INSERT INTO loyalty_points (user_id, type, points, description, order_id) VALUES (?,?,?,?,?)', [userId, type, n, description, orderId]);
}
// تخطيط استبدال نقاط بخصم (قراءة فقط — تُستدعى قبل المعاملة لتحديد المبلغ، ثم يُطبَّق داخل المعاملة).
function planRedeem(userId, requested, maxDiscount) {
    const balance = Number(get('SELECT points_balance FROM users WHERE id = ?', [userId]).points_balance) || 0;
    const minRedeem = settingValue('loyalty_min_redeem', 100);
    let points = Math.floor(Number(requested) || 0);
    if (points <= 0)
        return { points: 0, discount: 0 };
    if (balance < minRedeem)
        throw new ApiError(400, 'رصيد النقاط أقل من الحد الأدنى للاستبدال');
    points = Math.min(points, balance);
    let discount = pointsDiscount(points);
    if (discount > maxDiscount) {
        points = Math.floor(maxDiscount / Math.max(settingValue('loyalty_point_value', 1), 1));
        discount = pointsDiscount(points);
    }
    return { points, discount };
}
// تطبيق الاستبدال فعلياً (داخل معاملة الطلب): خصم الرصيد + تسجيل الحركة.
function applyRedeem(userId, points, discount, orderId) {
    if (!points || points <= 0)
        return;
    run('UPDATE users SET points_balance = points_balance - ? WHERE id = ?', [points, userId]);
    run('INSERT INTO loyalty_points (user_id, type, points, description, order_id) VALUES (?,?,?,?,?)', [userId, 'redeem', -points, 'استبدال نقاط بخصم على الطلب', orderId]);
    return { points, discount };
}
// مكافآت الإحالة تُمنح مرة واحدة فقط عند اكتمال أول طلب للمدعو (لا تتكرر مع كل طلب لاحق).
function grantReferralRewards(order) {
    const customer = get('SELECT u.id, u.referred_by FROM users u WHERE u.id = ?', [order.customer_id]);
    if (!customer || !customer.referred_by)
        return;
    if (Number(order.total_amount) < settingValue('referral_min_order', 10000))
        return;
    const priorCompleted = get("SELECT id FROM orders WHERE customer_id = ? AND status = 'completed' AND id < ? LIMIT 1", [order.customer_id, order.id]);
    if (priorCompleted)
        return;
    const rewarded = get("SELECT id FROM loyalty_points WHERE order_id = ? AND type = 'referral' LIMIT 1", [order.id]);
    if (rewarded)
        return;
    const refBonus = settingValue('referral_bonus_referrer', 5000);
    const refBonusReferee = settingValue('referral_bonus_referee', 3000);
    awardPoints(customer.referred_by, refBonus, 'referral', 'مكافأة إحالة صديق', order.id);
    awardPoints(order.customer_id, refBonusReferee, 'referral', 'مكافأة أول طلب بدعوة صديق', order.id);
}
function referralLink(code) {
    return `${process.env.APP_URL || 'http://localhost:5173'}/#/register?ref=${code}`;
}
module.exports = { TIERS, tierOf, nextTier, pointsDiscount, awardPoints, planRedeem, applyRedeem, grantReferralRewards, referralLink };
