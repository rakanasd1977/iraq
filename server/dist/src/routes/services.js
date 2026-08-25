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
// GET /api/services
router.get('/', (req, res, next) => {
    try {
        const rows = all('SELECT * FROM services ORDER BY sort_order ASC');
        const withCounts = rows.map((s) => {
            s.providers_count = get('SELECT COUNT(*) AS c FROM providers WHERE service_id = ?', [s.id]).c;
            return s;
        });
        return ok(res, withCounts);
    }
    catch (e) {
        next(e);
    }
});
// POST /api/services (admin)
router.post('/', requireRole('admin'), (req, res, next) => {
    try {
        const { slug, name_ar, name_en, description, icon, is_active = 1, sort_order = 0 } = req.body || {};
        if (!slug || !name_ar || !name_en)
            throw new ApiError(400, 'يرجى ملء الحقول المطلوبة');
        const dup = get('SELECT id FROM services WHERE slug = ?', [String(slug).toLowerCase()]);
        if (dup)
            throw new ApiError(409, 'رمز الخدمة مستخدم مسبقاً');
        const id = run('INSERT INTO services (slug, name_ar, name_en, description, icon, is_active, sort_order) VALUES (?,?,?,?,?,?,?)', [String(slug).toLowerCase(), name_ar, name_en, description || null, icon || null, Number(is_active) ? 1 : 0, Number(sort_order) || 0]).lastId;
        logActivity(req.user, 'create', 'service', id, { name_ar });
        return created(res, get('SELECT * FROM services WHERE id = ?', [id]));
    }
    catch (e) {
        next(e);
    }
});
// PUT /api/services/:id (admin)
router.put('/:id', requireRole('admin'), (req, res, next) => {
    try {
        const id = toId(req.params.id);
        const svc = get('SELECT * FROM services WHERE id = ?', [id]);
        if (!svc)
            throw new ApiError(404, 'الخدمة غير موجودة');
        const { slug, name_ar, name_en, description, icon, is_active, sort_order } = req.body || {};
        if (slug) {
            const dup = get('SELECT id FROM services WHERE slug = ? AND id != ?', [String(slug).toLowerCase(), id]);
            if (dup)
                throw new ApiError(409, 'رمز الخدمة مستخدم مسبقاً');
        }
        run('UPDATE services SET slug = ?, name_ar = ?, name_en = ?, description = ?, icon = ?, is_active = ?, sort_order = ? WHERE id = ?', [
            slug !== undefined ? String(slug).toLowerCase() : svc.slug,
            name_ar !== undefined ? name_ar : svc.name_ar,
            name_en !== undefined ? name_en : svc.name_en,
            description !== undefined ? description : svc.description,
            icon !== undefined ? icon : svc.icon,
            is_active !== undefined ? (Number(is_active) ? 1 : 0) : svc.is_active,
            sort_order !== undefined ? Number(sort_order) || 0 : svc.sort_order,
            id,
        ]);
        logActivity(req.user, 'update', 'service', id, { name_ar });
        return ok(res, get('SELECT * FROM services WHERE id = ?', [id]));
    }
    catch (e) {
        next(e);
    }
});
// POST /api/services/:id/toggle (admin)
router.post('/:id/toggle', requireRole('admin'), (req, res, next) => {
    try {
        const id = toId(req.params.id);
        const svc = get('SELECT * FROM services WHERE id = ?', [id]);
        if (!svc)
            throw new ApiError(404, 'الخدمة غير موجودة');
        run('UPDATE services SET is_active = ? WHERE id = ?', [svc.is_active ? 0 : 1, id]);
        logActivity(req.user, svc.is_active ? 'deactivate' : 'activate', 'service', id);
        return ok(res, get('SELECT * FROM services WHERE id = ?', [id]));
    }
    catch (e) {
        next(e);
    }
});
// DELETE /api/services/:id (admin)
router.delete('/:id', requireRole('admin'), (req, res, next) => {
    try {
        const id = toId(req.params.id);
        const svc = get('SELECT * FROM services WHERE id = ?', [id]);
        if (!svc)
            throw new ApiError(404, 'الخدمة غير موجودة');
        const providers = get('SELECT COUNT(*) AS c FROM providers WHERE service_id = ?', [id]).c;
        if (providers > 0) {
            throw new ApiError(409, 'لا يمكن حذف الخدمة لوجود مزودي خدمة مرتبطين بها، يمكنك إيقافها بدلاً من ذلك');
        }
        run('DELETE FROM services WHERE id = ?', [id]);
        logActivity(req.user, 'delete', 'service', id, { name_ar: svc.name_ar });
        return ok(res, { message: 'تم حذف الخدمة بنجاح' });
    }
    catch (e) {
        next(e);
    }
});
module.exports = router;
