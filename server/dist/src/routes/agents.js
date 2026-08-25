"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express = require('express');
const { get, all, run, transaction } = require('../db');
const { ApiError, toId, nextLeasePeriod, round2, settingValue, paginate, assertLength } = require('../utils/helpers');
const { hashPassword, randomPassword } = require('../utils/password');
const { ok, created } = require('../utils/response');
const { authenticate } = require('../middleware/auth');
const { requireRole } = require('../middleware/rbac');
const { logActivity } = require('../utils/log');
const router = express.Router();
router.use(authenticate, requireRole('admin'));
const AGENT_SELECT = `
  SELECT a.id, a.user_id, a.governorate_id, a.commission_rate, a.lease_status,
         a.lease_expires_at, a.created_at, a.updated_at,
         u.name_ar, u.name_en, u.email, u.phone, u.is_active AS user_active, u.avatar,
         g.name_ar AS governorate_name_ar, g.code AS governorate_code, g.lease_fee
  FROM agents a
  JOIN users u ON u.id = a.user_id
  JOIN governorates g ON g.id = a.governorate_id
`;
// GET /api/agents?q=&governorate_id=&page=&limit=
router.get('/', (req, res, next) => {
    try {
        const { q, governorate_id } = req.query;
        const params = [];
        let where = '';
        const conds = [];
        if (q) {
            const like = `%${q}%`;
            conds.push('(u.name_ar LIKE ? OR u.name_en LIKE ? OR u.email LIKE ? OR u.phone LIKE ? OR g.name_ar LIKE ?)');
            params.push(like, like, like, like, like);
        }
        if (governorate_id) {
            conds.push('a.governorate_id = ?');
            params.push(Number(governorate_id));
        }
        if (conds.length)
            where = ' WHERE ' + conds.join(' AND ');
        // إحصائيات كل الوكيل بشركة واحدة (GROUP BY بدل 4 استعلامات N+1 لكل وكيل)
        const rows = all(AGENT_SELECT.replace('\n  FROM agents a', `,
         SUM(CASE WHEN o.status != 'cancelled' THEN 1 ELSE 0 END) AS orders_count,
         COALESCE(SUM(CASE WHEN o.status != 'cancelled' THEN o.total_amount END),0) AS governorate_orders_value,
         COALESCE(SUM(CASE WHEN o.status != 'cancelled' THEN o.agent_amount END),0) AS earnings,
         (SELECT COUNT(*) FROM providers pr WHERE pr.governorate_id = a.governorate_id) AS providers_count
  FROM agents a`).replace('JOIN governorates g ON g.id = a.governorate_id\n', `JOIN governorates g ON g.id = a.governorate_id
  LEFT JOIN providers p ON p.governorate_id = a.governorate_id
  LEFT JOIN orders o ON o.provider_id = p.id\n`) + where + ' GROUP BY a.id ORDER BY a.id DESC', params).map((a) => ({
            ...a,
            orders_count: Number(a.orders_count) || 0,
            governorate_orders_value: round2(Number(a.governorate_orders_value) || 0),
            earnings: round2(Number(a.earnings) || 0),
            providers_count: Number(a.providers_count) || 0,
        }));
        const pg = paginate(req, 50);
        if (pg.enabled) {
            return ok(res, rows.slice(pg.offset, pg.offset + pg.limit), {
                total: rows.length,
                page: pg.page,
                limit: pg.limit,
                pages: Math.max(1, Math.ceil(rows.length / pg.limit)),
            });
        }
        return ok(res, rows);
    }
    catch (e) {
        next(e);
    }
});
// GET /api/agents/:id
router.get('/:id', (req, res, next) => {
    try {
        const id = toId(req.params.id);
        const agent = get(AGENT_SELECT + ' WHERE a.id = ?', [id]);
        if (!agent)
            throw new ApiError(404, 'الوكيل غير موجود');
        return ok(res, agent);
    }
    catch (e) {
        next(e);
    }
});
// POST /api/agents
router.post('/', async (req, res, next) => {
    try {
        const { name_ar, name_en, email, phone, password, governorate_id, commission_rate = settingValue('agent_default_commission', 2) } = req.body || {};
        if (!name_ar || !email || !governorate_id)
            throw new ApiError(400, 'يرجى ملء الحقول المطلوبة (الاسم، البريد، المحافظة)');
        if (name_ar !== undefined && name_ar !== '')
            assertLength(name_ar, 100, 'الاسم');
        if (name_en !== undefined && name_en !== '')
            assertLength(name_en, 100, 'الاسم اللاتيني');
        const rate = Number(commission_rate);
        if (!Number.isFinite(rate) || rate < 0 || rate > 100) {
            throw new ApiError(400, 'نسبة عمولة الوكيل يجب أن تكون رقماً بين 0 و 100');
        }
        const gov = get('SELECT * FROM governorates WHERE id = ?', [Number(governorate_id)]);
        if (!gov)
            throw new ApiError(400, 'المحافظة غير موجودة');
        const existingAgent = get('SELECT id FROM agents WHERE governorate_id = ?', [gov.id]);
        if (existingAgent)
            throw new ApiError(409, 'يوجد وكيل مسجل لهذه المحافظة بالفعل');
        const existsUser = get('SELECT id FROM users WHERE email = ? OR (phone IS NOT NULL AND phone = ?)', [email, phone || '']);
        if (existsUser)
            throw new ApiError(409, 'البريد أو رقم الهاتف مستخدم مسبقاً');
        const finalPassword = password || randomPassword();
        const passwordHash = await hashPassword(finalPassword);
        let userId, agentId;
        transaction(() => {
            userId = run('INSERT INTO users (role, name_ar, name_en, email, phone, password_hash, governorate_id, is_active) VALUES (?,?,?,?,?,?,?,1)', ['agent', name_ar, name_en || null, String(email).toLowerCase(), phone || null, passwordHash, gov.id]).lastId;
            agentId = run('INSERT INTO agents (user_id, governorate_id, commission_rate, lease_status) VALUES (?,?,?,?)', [userId, gov.id, rate, 'pending']).lastId;
        });
        logActivity(req.user, 'create', 'agent', agentId, { name_ar, governorate: gov.name_ar });
        const createdAgent = get(AGENT_SELECT + ' WHERE a.id = ?', [agentId]);
        return created(res, { ...createdAgent, generated_password: password ? undefined : finalPassword });
    }
    catch (e) {
        next(e);
    }
});
// PUT /api/agents/:id
router.put('/:id', (req, res, next) => {
    try {
        const id = toId(req.params.id);
        const agent = get('SELECT * FROM agents WHERE id = ?', [id]);
        if (!agent)
            throw new ApiError(404, 'الوكيل غير موجود');
        const user = get('SELECT * FROM users WHERE id = ?', [agent.user_id]);
        const { name_ar, name_en, email, phone, governorate_id, commission_rate, is_active } = req.body || {};
        if (name_en !== undefined && name_en !== '')
            assertLength(name_en, 100, 'الاسم اللاتيني');
        if (commission_rate !== undefined) {
            const rate = Number(commission_rate);
            if (!Number.isFinite(rate) || rate < 0 || rate > 100) {
                throw new ApiError(400, 'نسبة عمولة الوكيل يجب أن تكون رقماً بين 0 و 100');
            }
        }
        const phoneNorm = phone === undefined ? user.phone : (String(phone).trim() ? String(phone).trim() : null);
        const emailNorm = email === undefined ? user.email : (String(email).trim() ? String(email).trim().toLowerCase() : null);
        if (governorate_id && Number(governorate_id) !== agent.governorate_id) {
            const dup = get('SELECT id FROM agents WHERE governorate_id = ? AND id != ?', [Number(governorate_id), id]);
            if (dup)
                throw new ApiError(409, 'يوجد وكيل مسجل لهذه المحافظة بالفعل');
            const gov = get('SELECT id FROM governorates WHERE id = ?', [Number(governorate_id)]);
            if (!gov)
                throw new ApiError(400, 'المحافظة غير موجودة');
        }
        if (emailNorm) {
            const dup = get('SELECT id FROM users WHERE email = ? AND id != ?', [emailNorm, user.id]);
            if (dup)
                throw new ApiError(409, 'البريد مستخدم مسبقاً');
        }
        if (phoneNorm) {
            const dup = get('SELECT id FROM users WHERE phone = ? AND id != ?', [phoneNorm, user.id]);
            if (dup)
                throw new ApiError(409, 'رقم الهاتف مستخدم مسبقاً');
        }
        transaction(() => {
            run('UPDATE users SET name_ar = ?, name_en = ?, email = ?, phone = ?, governorate_id = ?, is_active = ?, updated_at = datetime(\'now\') WHERE id = ?', [
                name_ar !== undefined ? name_ar : user.name_ar,
                name_en !== undefined ? name_en : user.name_en,
                emailNorm,
                phoneNorm,
                governorate_id !== undefined ? Number(governorate_id) : user.governorate_id,
                is_active !== undefined ? (Number(is_active) ? 1 : 0) : user.is_active,
                user.id,
            ]);
            run('UPDATE agents SET commission_rate = ?, updated_at = datetime(\'now\') WHERE id = ?', [commission_rate !== undefined ? Number(commission_rate) || 0 : agent.commission_rate, id]);
        });
        logActivity(req.user, 'update', 'agent', id, { name_ar });
        return ok(res, get(AGENT_SELECT + ' WHERE a.id = ?', [id]));
    }
    catch (e) {
        next(e);
    }
});
// DELETE /api/agents/:id
router.delete('/:id', (req, res, next) => {
    try {
        const id = toId(req.params.id);
        const agent = get(AGENT_SELECT + ' WHERE a.id = ?', [id]);
        if (!agent)
            throw new ApiError(404, 'الوكيل غير موجود');
        // حذف ناعم: نحتفظ بسجل الوكيل ودفعات إجارته (لا حذف CASCADE)، ونوقف الحساب فقط
        run("UPDATE users SET is_active = 0, updated_at = datetime('now') WHERE id = ?", [agent.user_id]);
        run("UPDATE agents SET lease_status = 'expired', updated_at = datetime('now') WHERE id = ?", [id]);
        logActivity(req.user, 'delete', 'agent', id, { name_ar: agent.name_ar, governorate: agent.governorate_name_ar, soft: true });
        return ok(res, { message: 'تم إيقاف الوكيل وحفظ سجل دفعات إجارته (تعطيل ناعم)' });
    }
    catch (e) {
        next(e);
    }
});
// POST /api/agents/:id/renew-lease (تجديد إجارة الوكالة من المسؤول)
router.post('/:id/renew-lease', (req, res, next) => {
    try {
        const id = toId(req.params.id);
        const agent = get('SELECT * FROM agents WHERE id = ?', [id]);
        if (!agent)
            throw new ApiError(404, 'الوكيل غير موجود');
        const gov = get('SELECT * FROM governorates WHERE id = ?', [agent.governorate_id]);
        const { approve = 0, amount } = req.body || {};
        const { start, end } = nextLeasePeriod(agent.lease_expires_at);
        const fee = amount !== undefined && Number(amount) > 0 ? Number(amount) : gov.lease_fee;
        let payId;
        transaction(() => {
            payId = run('INSERT INTO lease_payments (agent_id, governorate_id, amount, period_start, period_end, status, notes) VALUES (?,?,?,?,?,?,?)', [id, gov.id, fee, start.toISOString(), end.toISOString(), approve ? 'paid' : 'pending', approve ? 'تجديد مباشر من المسؤول' : 'طلب تجديد من الوكيل']).lastId;
            if (approve) {
                run('UPDATE agents SET lease_status = ?, lease_expires_at = ?, updated_at = datetime(\'now\') WHERE id = ?', ['active', end.toISOString(), id]);
                run('UPDATE lease_payments SET paid_at = datetime(\'now\') WHERE id = ?', [payId]);
            }
            else {
                run('UPDATE agents SET lease_status = ?, updated_at = datetime(\'now\') WHERE id = ?', ['pending', id]);
            }
        });
        logActivity(req.user, 'renew_lease', 'agent', id, { approve: !!approve, amount: fee, period_start: start.toISOString(), period_end: end.toISOString() });
        return ok(res, {
            lease_payment_id: payId,
            agent_id: id,
            amount: fee,
            period_start: start.toISOString(),
            period_end: end.toISOString(),
            status: approve ? 'paid' : 'pending',
            message: approve ? 'تم تجديد إجارة الوكالة بنجاح' : 'تم إرسال طلب التجديد بانتظار الموافقة',
        });
    }
    catch (e) {
        next(e);
    }
});
// GET /api/agents/:id/lease-payments
router.get('/:id/lease-payments', (req, res, next) => {
    try {
        const id = toId(req.params.id);
        const agent = get('SELECT id FROM agents WHERE id = ?', [id]);
        if (!agent)
            throw new ApiError(404, 'الوكيل غير موجود');
        const rows = all('SELECT lp.*, g.name_ar AS governorate_name_ar FROM lease_payments lp JOIN governorates g ON g.id = lp.governorate_id WHERE lp.agent_id = ? ORDER BY lp.id DESC', [id]);
        return ok(res, rows);
    }
    catch (e) {
        next(e);
    }
});
module.exports = router;
