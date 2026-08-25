"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express = require('express');
const { get, all, run, transaction } = require('../db');
const { ApiError, toId, round2, assertLength, paginate } = require('../utils/helpers');
const { ok } = require('../utils/response');
const { authenticate } = require('../middleware/auth');
const { requireRole } = require('../middleware/rbac');
const { logActivity } = require('../utils/log');
const { notifyUser, notifyRole } = require('../utils/push');
const { ensureWallet } = require('../utils/wallet');
const router = express.Router();
router.use(authenticate);
// طرق الدفع المقبولة للشحن المسبق — يدفع المزوّد خارجياً ثم يرسل لقطة الشاشة كإثبات
const PAYMENT_METHODS = {
    zain_cash: { label: 'زين كاش', hint: 'Zain Cash' },
    asia_pay: { label: 'آسيا باي', hint: 'Asia Pay' },
    first_iraqi_bank: { label: 'مصرف العراق الأول', hint: 'First Iraqi Bank' },
    al_ahli_bank: { label: 'المصرف الأهلي', hint: 'Al-Ahli Bank' },
};
const PROOF_MAX_LENGTH = 4_000_000; // حوالي 3 ميغابايت بعد فك الترميز
function paymentLabel(method) {
    const m = PAYMENT_METHODS[method];
    return m ? `${m.label} (${m.hint})` : method;
}
function generateReference() {
    const now = new Date();
    const rand = Math.floor(100000 + Math.random() * 900000);
    return `RCH-${now.getFullYear()}-${rand}`;
}
// GET /api/recharges?status=&q= — قائمة طلبات الشحن للمسؤول (بدون الصور لتقليل الحجم)
router.get('/', requireRole('admin'), (req, res, next) => {
    try {
        const { status, q } = req.query;
        const where = [];
        const params = [];
        if (status) {
            if (!['pending', 'approved', 'rejected'].includes(status))
                throw new ApiError(400, 'حالة غير صحيحة');
            where.push('r.status = ?');
            params.push(status);
        }
        if (q) {
            where.push('(r.reference LIKE ? OR p.name_ar LIKE ? OR u.email LIKE ?)');
            const like = `%${String(q)}%`;
            params.push(like, like, like);
        }
        const wSql = where.length ? ' WHERE ' + where.join(' AND ') : '';
        const pg = paginate(req, 50);
        const total = get(`SELECT COUNT(*) AS c
       FROM recharge_requests r
       JOIN providers p ON p.id = r.provider_id
       JOIN users u ON u.id = p.user_id
       ${wSql}`, params).c;
        const rows = all(`
      SELECT r.id, r.reference, r.amount, r.payment_method, r.note, r.status, r.admin_note,
             r.created_at, r.handled_at, r.handled_by,
             p.id AS provider_id, p.name_ar AS provider_name, p.commission_rate,
             g.name_ar AS governorate_name_ar, s.name_ar AS service_name_ar
      FROM recharge_requests r
      JOIN providers p ON p.id = r.provider_id
      JOIN users u ON u.id = p.user_id
      LEFT JOIN governorates g ON g.id = p.governorate_id
      LEFT JOIN services s ON s.id = p.service_id
      ${wSql}
      ORDER BY r.id DESC
      LIMIT ? OFFSET ?
    `, [...params, pg.limit, pg.offset]);
        return ok(res, rows.map((r) => ({ ...r, payment_method_label: paymentLabel(r.payment_method) })), {
            total,
            page: pg.page,
            limit: pg.limit,
            pages: Math.max(1, Math.ceil(total / pg.limit)),
        });
    }
    catch (e) {
        next(e);
    }
});
// GET /api/recharges/provider — طلبات المزوّد الخاصة (تشمل إثباته)
router.get('/provider', (req, res, next) => {
    try {
        if (req.user.role !== 'provider')
            throw new ApiError(403, 'خاص بحسابات المزودين');
        const pid = req.user.provider_id;
        const rows = all(`
      SELECT id, reference, amount, payment_method, note, proof_image, status, admin_note, created_at, handled_at, handled_by
      FROM recharge_requests WHERE provider_id = ? ORDER BY id DESC LIMIT 100
    `, [pid]);
        return ok(res, rows.map((r) => ({ ...r, payment_method_label: paymentLabel(r.payment_method) })));
    }
    catch (e) {
        next(e);
    }
});
// GET /api/recharges/:id — تفاصيل طلب (المسؤول أو المزوّد صاحب الطلب)
router.get('/:id', (req, res, next) => {
    try {
        const id = toId(req.params.id);
        const r = get(`
      SELECT r.*, p.name_ar AS provider_name, g.name_ar AS governorate_name_ar,
             (SELECT balance FROM provider_wallets WHERE provider_id = r.provider_id) AS balance
      FROM recharge_requests r
      JOIN providers p ON p.id = r.provider_id
      LEFT JOIN governorates g ON g.id = p.governorate_id
      WHERE r.id = ?
    `, [id]);
        if (!r)
            throw new ApiError(404, 'طلب الشحن غير موجود');
        // المسؤول فقط أو المزوّد صاحب الطلب — أي دور آخر (وكيل/زبون) ممنوع تماماً
        const isOwnerProvider = req.user.role === 'provider' && r.provider_id === req.user.provider_id;
        if (req.user.role !== 'admin' && !isOwnerProvider)
            throw new ApiError(403, 'لا تملك صلاحية الاطلاع على هذا الطلب');
        return ok(res, { ...r, payment_method_label: paymentLabel(r.payment_method) });
    }
    catch (e) {
        next(e);
    }
});
// POST /api/recharges — المزوّد ينشئ طلب شحن مسبق بعد الدفع عبر زين كاش/آسيا باي/المصرفين مع إثبات
router.post('/', (req, res, next) => {
    try {
        if (req.user.role !== 'provider')
            throw new ApiError(403, 'خاص بحسابات المزودين');
        const pid = req.user.provider_id;
        const provider = get('SELECT * FROM providers WHERE id = ?', [pid]);
        if (!provider)
            throw new ApiError(404, 'حساب المزوّد غير موجود');
        const amount = Number(req.body && req.body.amount);
        if (!Number.isFinite(amount) || amount <= 0)
            throw new ApiError(400, 'أدخل مبلغ شحن صحيحاً أكبر من صفر');
        if (amount > 100_000_000)
            throw new ApiError(400, 'المبلغ يتجاوز الحد الأقصى المسموح للشحن');
        const method = String((req.body && req.body.payment_method) || '');
        if (!PAYMENT_METHODS[method])
            throw new ApiError(400, 'طريقة الدفع غير مدعومة — اختر زين كاش أو آسيا باي أو مصرف العراق الأول أو المصرف الأهلي');
        const note = req.body && req.body.note ? String(req.body.note).trim() : '';
        if (note.length > 500)
            throw new ApiError(400, 'الملاحظة تتجاوز الحد المسموح');
        const proof = String((req.body && req.body.proof_image) || '');
        if (!/^(data:image\/|\/uploads\/|https:\/\/)/.test(proof))
            throw new ApiError(400, 'يرجى إرفاق لقطة شاشة للإثبات بصيغة صورة أو ملف مرفوع');
        if (proof.startsWith('data:') && proof.length > PROOF_MAX_LENGTH)
            throw new ApiError(400, 'حجم لقطة الشاشة كبير جداً (الحد الأقصى حوالي 3 ميغابايت)');
        let reference = '';
        let created;
        for (let attempt = 0; attempt < 5; attempt++) {
            reference = generateReference();
            const r = run('INSERT OR IGNORE INTO recharge_requests (provider_id, reference, amount, payment_method, note, proof_image) VALUES (?,?,?,?,?,?)', [pid, reference, round2(amount), method, note || null, proof]);
            if (r.changes === 1) {
                created = get('SELECT * FROM recharge_requests WHERE id = ?', [r.lastId]);
                break;
            }
        }
        if (!created)
            throw new ApiError(500, 'تعذر إنشاء طلب الشحن، حاول مجدداً');
        logActivity(req.user, 'recharge_request', 'provider', pid, {
            reference,
            amount: round2(amount),
            method: paymentLabel(method),
        });
        // إشعار فوري لمسؤولي المنصة بطلب شحن جديد (بالإضافة إلى التنبيه الصوتي في اللوحة)
        notifyRole('admin', {
            type: 'recharge',
            title: '💸 طلب شحن جديد',
            body: `${reference} — ${round2(amount)} دينار عبر ${paymentLabel(method)}`,
            url: '/wallets',
        });
        return ok(res, {
            id: created.id,
            reference: created.reference,
            amount: created.amount,
            payment_method: created.payment_method,
            payment_method_label: paymentLabel(created.payment_method),
            status: created.status,
            created_at: created.created_at,
        });
    }
    catch (e) {
        next(e);
    }
});
// POST /api/recharges/:id/approve — المسؤول يوافق على طلب الشحن فيُضاف الرصيد تلقائياً
router.post('/:id/approve', requireRole('admin'), (req, res, next) => {
    try {
        const id = toId(req.params.id);
        const balanceAfter = transaction(() => {
            const r = get('SELECT * FROM recharge_requests WHERE id = ?', [id]);
            if (!r)
                throw new ApiError(404, 'طلب الشحن غير موجود');
            if (r.status !== 'pending')
                throw new ApiError(409, 'هذا الطلب عولج سابقاً');
            const w = ensureWallet(r.provider_id);
            const nextBalance = round2(Number(w.balance) + Number(r.amount));
            run('UPDATE provider_wallets SET balance = ?, updated_at = datetime(\'now\') WHERE provider_id = ?', [nextBalance, r.provider_id]);
            run('INSERT INTO wallet_transactions (provider_id, type, amount, agent_amount, platform_amount, balance_after, note, created_by) VALUES (?,?,?,?,?,?,?,?)', [r.provider_id, 'recharge', round2(r.amount), 0, 0, nextBalance,
                `قبول طلب الشحن ${r.reference} (${paymentLabel(r.payment_method)})`,
                req.user.name_ar || req.user.email]);
            run("UPDATE recharge_requests SET status = 'approved', handled_at = datetime('now'), handled_by = ? WHERE id = ?", [req.user.name_ar || req.user.email, id]);
            return nextBalance;
        });
        const r = get('SELECT reference, provider_id, amount, payment_method FROM recharge_requests WHERE id = ?', [id]);
        logActivity(req.user, 'recharge_approve', 'provider', r.provider_id, {
            reference: r.reference,
            amount: round2(r.amount),
            balance: balanceAfter,
        });
        // إشعار للمزوّد بقبول شحنه
        const provUser = get('SELECT user_id FROM providers WHERE id = ?', [r.provider_id]);
        if (provUser) {
            notifyUser(provUser.user_id, {
                type: 'recharge',
                title: '✅ تم قبول شحنك',
                body: `${r.reference} — أُضيف ${round2(r.amount)} دينار لمحفظتك (الرصيد: ${round2(balanceAfter)})`,
                url: '/wallet',
            });
        }
        return ok(res, { id, status: 'approved', reference: r.reference, balance: balanceAfter, amount: round2(r.amount) });
    }
    catch (e) {
        next(e);
    }
});
// POST /api/recharges/:id/reject — المسؤول يرفض طلب الشحن مع سبب
router.post('/:id/reject', requireRole('admin'), (req, res, next) => {
    try {
        const id = toId(req.params.id);
        const reason = assertLength(req.body && req.body.reason, 500, 'سبب الرفض');
        const r = transaction(() => {
            const reqRow = get('SELECT * FROM recharge_requests WHERE id = ?', [id]);
            if (!reqRow)
                throw new ApiError(404, 'طلب الشحن غير موجود');
            if (reqRow.status !== 'pending')
                throw new ApiError(409, 'هذا الطلب عولج سابقاً');
            run("UPDATE recharge_requests SET status = 'rejected', admin_note = ?, handled_at = datetime('now'), handled_by = ? WHERE id = ?", [reason, req.user.name_ar || req.user.email, id]);
            return reqRow;
        });
        logActivity(req.user, 'recharge_reject', 'provider', r.provider_id, {
            reference: r.reference,
            amount: round2(r.amount),
            reason,
        });
        // إشعار للمزوّد برفض شحنه مع السبب
        const provUser = get('SELECT user_id FROM providers WHERE id = ?', [r.provider_id]);
        if (provUser) {
            notifyUser(provUser.user_id, {
                type: 'recharge',
                title: '❌ رُفض طلب الشحن',
                body: `${r.reference} — ${reason}`,
                url: '/wallet',
            });
        }
        return ok(res, { id, status: 'rejected', reference: r.reference });
    }
    catch (e) {
        next(e);
    }
});
module.exports = router;
