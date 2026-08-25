"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express = require('express');
const { get, all, run } = require('../db');
const { ApiError, toId, paginate } = require('../utils/helpers');
const { ok } = require('../utils/response');
const { authenticate } = require('../middleware/auth');
const { requireRole } = require('../middleware/rbac');
const { logActivity } = require('../utils/log');
const router = express.Router();
router.use(authenticate, requireRole('admin'));
const LEASE_SELECT = `
  SELECT lp.*, g.name_ar AS governorate_name_ar, g.code AS governorate_code,
         a.user_id AS agent_user_id,
         u.name_ar AS agent_name_ar, u.email AS agent_email,
         a.lease_status, a.lease_expires_at
  FROM lease_payments lp
  JOIN agents a ON a.id = lp.agent_id
  JOIN users u ON u.id = a.user_id
  JOIN governorates g ON g.id = lp.governorate_id
`;
// GET /api/leases
router.get('/', (req, res, next) => {
    try {
        const { status } = req.query;
        const pg = paginate(req);
        const params = [];
        let where = '';
        if (status) {
            where = ' WHERE lp.status = ?';
            params.push(status);
        }
        const total = get(`SELECT COUNT(*) AS c FROM lease_payments lp ${where}`, params).c;
        const rows = all(LEASE_SELECT + where + ' ORDER BY lp.id DESC LIMIT ? OFFSET ?', [...params, pg.limit, pg.offset]);
        return ok(res, rows, { total, page: pg.page, limit: pg.limit, pages: Math.max(1, Math.ceil(total / pg.limit)) });
    }
    catch (e) {
        next(e);
    }
});
function parseDate(v, fallback) {
    if (v === undefined || v === null || v === '')
        return fallback ? new Date(fallback) : null;
    const d = new Date(v);
    if (isNaN(d.getTime()))
        throw new ApiError(400, 'تاريخ غير صالح (التنسيق YYYY-MM-DD أو ISO)');
    return d;
}
function validatePeriod(start, end) {
    if (!start || !end)
        throw new ApiError(400, 'يرجى تحديد بداية الفترة ونهايتها');
    if (end <= start)
        throw new ApiError(400, 'نهاية الفترة يجب أن تكون بعد بدايتها');
}
// آخر تاريخ انتهاء بين دفعات الإجارة المدفوعة (غير المردودة).
// period_end مخزنة بصيغة ISO فتكافئ المقارنة النصية MAX الترتيب الزمني.
function latestPaidExpiry(agentId) {
    const row = get("SELECT MAX(period_end) AS latest FROM lease_payments WHERE agent_id = ? AND status = 'paid'", [agentId]);
    return row && row.latest ? row.latest : null;
}
// مزامنة إجارة الوكيل مع أقصى فترة مدفوعة: دفعة لاحقة/أقصر لا تُقصِّر إجارة سارية أبداً،
// وإلغاء الدفعة الوحيدة يُنهي الإجارة فقط دون بقاء أي فترة مدفوعة.
function syncAgentLease(agentId) {
    const expiry = latestPaidExpiry(agentId);
    if (expiry) {
        const status = new Date(expiry) > new Date() ? 'active' : 'expired';
        run("UPDATE agents SET lease_expires_at = ?, lease_status = ?, updated_at = datetime('now') WHERE id = ?", [expiry, status, agentId]);
    }
    else {
        run("UPDATE agents SET lease_expires_at = NULL, lease_status = 'expired', updated_at = datetime('now') WHERE id = ?", [agentId]);
    }
}
// POST /api/leases — دفعة إجارة يدوية من المسؤول (تحكم كامل بتاريخ التجديد والمبلغ)
router.post('/', (req, res, next) => {
    try {
        const { agent_id, period_start, period_end, amount, status = 'paid', notes } = req.body || {};
        const aid = toId(agent_id);
        const agent = get('SELECT * FROM agents WHERE id = ?', [aid]);
        if (!agent)
            throw new ApiError(404, 'الوكيل غير موجود');
        const fee = Number(amount);
        if (Number.isNaN(fee) || fee < 0)
            throw new ApiError(400, 'مبلغ الإجارة يجب أن يكون رقماً غير سالب');
        // بداية الفترة: تاريخ محدد أو استمرار من آخر إجارة (أو اليوم). النهاية: تاريخ محدد أو +1 سنة من البداية.
        const start = parseDate(period_start, agent.lease_expires_at || new Date().toISOString());
        let end = parseDate(period_end, null);
        if (!end) {
            end = new Date(start);
            end.setFullYear(start.getFullYear() + 1);
        }
        validatePeriod(start, end);
        const payStatus = status === 'pending' ? 'pending' : 'paid';
        const payId = run('INSERT INTO lease_payments (agent_id, governorate_id, amount, period_start, period_end, status, paid_at, notes) VALUES (?,?,?,?,?,?,?,?)', [aid, agent.governorate_id, fee, start.toISOString(), end.toISOString(), payStatus, payStatus === 'paid' ? new Date().toISOString() : null, notes || 'دفعة يدوية من المسؤول']).lastId;
        if (payStatus === 'paid') {
            syncAgentLease(aid);
        }
        logActivity(req.user, 'create_lease', 'agent', aid, { payment_id: payId, amount: fee, period_start: start.toISOString(), period_end: end.toISOString(), status: payStatus });
        return ok(res, get(LEASE_SELECT + ' WHERE lp.id = ?', [payId]), { created: true });
    }
    catch (e) {
        next(e);
    }
});
// PUT /api/leases/:id — تعديل مبلغ أو تواريخ دفعة إجارة
router.put('/:id', (req, res, next) => {
    try {
        const id = toId(req.params.id);
        const payment = get('SELECT * FROM lease_payments WHERE id = ?', [id]);
        if (!payment)
            throw new ApiError(404, 'الدفعة غير موجودة');
        if (payment.status === 'refunded')
            throw new ApiError(400, 'لا يمكن تعديل دفعة ملغاة/مستردة');
        const { period_start, period_end, amount, notes } = req.body || {};
        const start = period_start !== undefined ? parseDate(period_start, null) : new Date(payment.period_start);
        const end = period_end !== undefined ? parseDate(period_end, null) : new Date(payment.period_end);
        validatePeriod(start, end);
        const fee = amount !== undefined ? Number(amount) : payment.amount;
        if (Number.isNaN(fee) || fee < 0)
            throw new ApiError(400, 'مبلغ الإجارة يجب أن يكون رقماً غير سالب');
        run('UPDATE lease_payments SET period_start = ?, period_end = ?, amount = ?, notes = ?, updated_at = datetime(\'now\') WHERE id = ?', [start.toISOString(), end.toISOString(), fee, notes !== undefined ? notes : payment.notes, id]);
        // إن كانت الدفعة مدفوعة وفعّالة، نعيد حساب انتهاء إجارة الوكيل من كل الدفعات المدفوعة
        // (أقصى فترة — لا تُقصَّر إجارة سارية بتعديل فترة أقصر لدفعة أخرى)
        if (payment.status === 'paid') {
            syncAgentLease(payment.agent_id);
        }
        logActivity(req.user, 'update_lease', 'agent', payment.agent_id, { payment_id: id, amount: fee, period_start: start.toISOString(), period_end: end.toISOString() });
        return ok(res, get(LEASE_SELECT + ' WHERE lp.id = ?', [id]));
    }
    catch (e) {
        next(e);
    }
});
// POST /api/leases/:id/cancel — إلغاء دفعة قيد الانتظار أو إبطال إجارة مدفوعة مفعّلة
router.post('/:id/cancel', (req, res, next) => {
    try {
        const id = toId(req.params.id);
        const payment = get('SELECT * FROM lease_payments WHERE id = ?', [id]);
        if (!payment)
            throw new ApiError(404, 'الدفعة غير موجودة');
        if (payment.status === 'pending') {
            run("UPDATE lease_payments SET status = 'rejected', notes = ? WHERE id = ?", [req.body && req.body.reason ? req.body.reason : 'أُلغي من المسؤول', id]);
            const pending = get("SELECT id FROM lease_payments WHERE agent_id = ? AND status = 'pending'", [payment.agent_id]);
            if (!pending)
                syncAgentLease(payment.agent_id);
            logActivity(req.user, 'cancel_lease_payment', 'agent', payment.agent_id, { payment_id: id, reason: req.body && req.body.reason });
            return ok(res, get(LEASE_SELECT + ' WHERE lp.id = ?', [id]));
        }
        if (payment.status === 'paid') {
            run("UPDATE lease_payments SET status = 'refunded', notes = ?, updated_at = datetime('now') WHERE id = ?", [req.body && req.body.reason ? req.body.reason : 'أُلغيت إجارة الوكالة من المسؤول', id]);
            // إعادة حساب الإجارة من الدفعات المدفوعة المتبقية (لا تُنهى إجارة ما زالت مسدَّدة)
            syncAgentLease(payment.agent_id);
            logActivity(req.user, 'revoke_lease', 'agent', payment.agent_id, { payment_id: id, reason: req.body && req.body.reason });
            return ok(res, get(LEASE_SELECT + ' WHERE lp.id = ?', [id]));
        }
        throw new ApiError(400, 'هذه الدفعة لم تعد قابلة للإلغاء');
    }
    catch (e) {
        next(e);
    }
});
// GET /api/leases/agent/:agentId
router.get('/agent/:agentId', (req, res, next) => {
    try {
        const id = toId(req.params.agentId);
        const limit = Math.min(Number(req.query.limit) || 100, 500);
        return ok(res, all(LEASE_SELECT + ' WHERE lp.agent_id = ? ORDER BY lp.id DESC LIMIT ?', [id, limit]));
    }
    catch (e) {
        next(e);
    }
});
// POST /api/leases/:id/approve (موافقة المسؤول على تجديد إجارة الوكالة)
router.post('/:id/approve', (req, res, next) => {
    try {
        const id = toId(req.params.id);
        const payment = get('SELECT * FROM lease_payments WHERE id = ?', [id]);
        if (!payment)
            throw new ApiError(404, 'الدفعة غير موجودة');
        if (payment.status !== 'pending')
            throw new ApiError(400, 'هذه الدفعة ليست بانتظار الموافقة');
        run('UPDATE lease_payments SET status = ?, paid_at = datetime(\'now\') WHERE id = ?', ['paid', id]);
        // لا تُقصَّر إجارة سارية لاحقة: تُحسب من أقصى فترة مدفوعة
        syncAgentLease(payment.agent_id);
        const agent = get('SELECT * FROM agents WHERE id = ?', [payment.agent_id]);
        logActivity(req.user, 'approve_lease', 'agent', payment.agent_id, {
            payment_id: id, amount: payment.amount, period_end: payment.period_end, agent_name: agent ? agent.name_ar : null,
        });
        return ok(res, get(LEASE_SELECT + ' WHERE lp.id = ?', [id]));
    }
    catch (e) {
        next(e);
    }
});
// POST /api/leases/:id/reject
router.post('/:id/reject', (req, res, next) => {
    try {
        const id = toId(req.params.id);
        const payment = get('SELECT * FROM lease_payments WHERE id = ?', [id]);
        if (!payment)
            throw new ApiError(404, 'الدفعة غير موجودة');
        if (payment.status !== 'pending')
            throw new ApiError(400, 'هذه الدفعة ليست بانتظار الموافقة');
        run('UPDATE lease_payments SET status = ?, notes = ? WHERE id = ?', ['rejected', req.body && req.body.reason ? req.body.reason : null, id]);
        const pending = get("SELECT id FROM lease_payments WHERE agent_id = ? AND status = 'pending'", [payment.agent_id]);
        if (!pending)
            syncAgentLease(payment.agent_id);
        logActivity(req.user, 'reject_lease', 'agent', payment.agent_id, { payment_id: id, reason: req.body && req.body.reason });
        return ok(res, get(LEASE_SELECT + ' WHERE lp.id = ?', [id]));
    }
    catch (e) {
        next(e);
    }
});
module.exports = router;
