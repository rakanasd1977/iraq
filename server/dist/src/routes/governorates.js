"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express = require('express');
const { get, all, run } = require('../db');
const { ApiError, toId } = require('../utils/helpers');
const { ok, created } = require('../utils/response');
const { authenticate } = require('../middleware/auth');
const { requireRole } = require('../middleware/rbac');
const { logActivity } = require('../utils/log');
const router = express.Router();
router.use(authenticate);
// GET /api/governorates
router.get('/', (req, res, next) => {
    try {
        const { active } = req.query;
        const rows = active !== undefined
            ? all('SELECT * FROM governorates WHERE is_active = ? ORDER BY sort_order ASC', [Number(active) ? 1 : 0])
            : all('SELECT * FROM governorates ORDER BY sort_order ASC');
        const withLinks = rows.map((g) => {
            const agent = get(`SELECT a.id, a.lease_status, a.lease_expires_at, a.commission_rate,
                u.name_ar AS agent_name, u.email AS agent_email, u.is_active AS agent_active
         FROM agents a JOIN users u ON u.id = a.user_id WHERE a.governorate_id = ?`, [g.id]);
            const providersCount = get('SELECT COUNT(*) AS c FROM providers WHERE governorate_id = ?', [g.id]).c;
            return { ...g, agent, providers_count: providersCount };
        });
        return ok(res, withLinks);
    }
    catch (e) {
        next(e);
    }
});
// GET /api/governorates/:id
router.get('/:id', (req, res, next) => {
    try {
        const id = toId(req.params.id);
        const gov = get('SELECT * FROM governorates WHERE id = ?', [id]);
        if (!gov)
            throw new ApiError(404, 'المحافظة غير موجودة');
        const agentsCount = get('SELECT COUNT(*) AS c FROM agents WHERE governorate_id = ?', [id]).c;
        const providersCount = get('SELECT COUNT(*) AS c FROM providers WHERE governorate_id = ?', [id]).c;
        const agent = get(`SELECT a.id, a.lease_status, a.lease_expires_at, a.commission_rate,
              u.name_ar AS agent_name, u.email AS agent_email, u.is_active AS agent_active
       FROM agents a JOIN users u ON u.id = a.user_id WHERE a.governorate_id = ?`, [id]);
        return ok(res, { ...gov, agents_count: agentsCount, providers_count: providersCount, agent });
    }
    catch (e) {
        next(e);
    }
});
// POST /api/governorates (admin)
router.post('/', requireRole('admin'), (req, res, next) => {
    try {
        const { name_ar, name_en, code, lease_fee = 0, is_active = 1, sort_order = 0 } = req.body || {};
        if (!name_ar || !name_en || !code)
            throw new ApiError(400, 'يرجى ملء جميع الحقول المطلوبة (الاسم عربي، إنجليزي، الرمز)');
        const dup = get('SELECT id FROM governorates WHERE code = ?', [String(code).toUpperCase()]);
        if (dup)
            throw new ApiError(409, 'رمز المحافظة مستخدم مسبقاً');
        const id = run('INSERT INTO governorates (name_ar, name_en, code, lease_fee, is_active, sort_order) VALUES (?,?,?,?,?,?)', [name_ar, name_en, String(code).toUpperCase(), Number(lease_fee) || 0, Number(is_active) ? 1 : 0, Number(sort_order) || 0]).lastId;
        logActivity(req.user, 'create', 'governorate', id, { name_ar });
        return created(res, get('SELECT * FROM governorates WHERE id = ?', [id]));
    }
    catch (e) {
        next(e);
    }
});
// PUT /api/governorates/:id (admin)
router.put('/:id', requireRole('admin'), (req, res, next) => {
    try {
        const id = toId(req.params.id);
        const gov = get('SELECT * FROM governorates WHERE id = ?', [id]);
        if (!gov)
            throw new ApiError(404, 'المحافظة غير موجودة');
        const { name_ar, name_en, code, lease_fee, is_active, sort_order } = req.body || {};
        if (code) {
            const dup = get('SELECT id FROM governorates WHERE code = ? AND id != ?', [String(code).toUpperCase(), id]);
            if (dup)
                throw new ApiError(409, 'رمز المحافظة مستخدم مسبقاً');
        }
        run('UPDATE governorates SET name_ar = ?, name_en = ?, code = ?, lease_fee = ?, is_active = ?, sort_order = ?, updated_at = datetime(\'now\') WHERE id = ?', [
            name_ar !== undefined ? name_ar : gov.name_ar,
            name_en !== undefined ? name_en : gov.name_en,
            code !== undefined ? String(code).toUpperCase() : gov.code,
            lease_fee !== undefined ? Number(lease_fee) || 0 : gov.lease_fee,
            is_active !== undefined ? (Number(is_active) ? 1 : 0) : gov.is_active,
            sort_order !== undefined ? Number(sort_order) || 0 : gov.sort_order,
            id,
        ]);
        logActivity(req.user, 'update', 'governorate', id, { name_ar });
        return ok(res, get('SELECT * FROM governorates WHERE id = ?', [id]));
    }
    catch (e) {
        next(e);
    }
});
// DELETE /api/governorates/:id (admin)
router.delete('/:id', requireRole('admin'), (req, res, next) => {
    try {
        const id = toId(req.params.id);
        const gov = get('SELECT * FROM governorates WHERE id = ?', [id]);
        if (!gov)
            throw new ApiError(404, 'المحافظة غير موجودة');
        const agents = get('SELECT COUNT(*) AS c FROM agents WHERE governorate_id = ?', [id]).c;
        const providers = get('SELECT COUNT(*) AS c FROM providers WHERE governorate_id = ?', [id]).c;
        if (agents > 0 || providers > 0) {
            throw new ApiError(409, 'لا يمكن حذف المحافظة لوجود وكلاء أو مزودي خدمة مرتبطين بها، يمكنك إيقافها بدلاً من ذلك');
        }
        run('DELETE FROM governorates WHERE id = ?', [id]);
        logActivity(req.user, 'delete', 'governorate', id, { name_ar: gov.name_ar });
        return ok(res, { message: 'تم حذف المحافظة بنجاح' });
    }
    catch (e) {
        next(e);
    }
});
// POST /api/governorates/:id/toggle (admin)
router.post('/:id/toggle', requireRole('admin'), (req, res, next) => {
    try {
        const id = toId(req.params.id);
        const gov = get('SELECT * FROM governorates WHERE id = ?', [id]);
        if (!gov)
            throw new ApiError(404, 'المحافظة غير موجودة');
        run('UPDATE governorates SET is_active = ?, updated_at = datetime(\'now\') WHERE id = ?', [gov.is_active ? 0 : 1, id]);
        logActivity(req.user, gov.is_active ? 'deactivate' : 'activate', 'governorate', id);
        return ok(res, get('SELECT * FROM governorates WHERE id = ?', [id]));
    }
    catch (e) {
        next(e);
    }
});
module.exports = router;
