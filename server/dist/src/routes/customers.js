"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express = require('express');
const { get, all, run, transaction } = require('../db');
const { ApiError, toId, paginate } = require('../utils/helpers');
const { hashPassword } = require('../utils/password');
const { ok, created } = require('../utils/response');
const { authenticate } = require('../middleware/auth');
const { requireRole } = require('../middleware/rbac');
const { logActivity } = require('../utils/log');
const router = express.Router();
router.use(authenticate, requireRole('admin'));
const CUSTOMER_SELECT = `
  SELECT c.id, c.user_id, c.governorate_id, c.address, c.created_at AS customer_created_at,
         u.name_ar, u.name_en, u.email, u.phone, u.is_active AS user_active, u.avatar,
         g.name_ar AS governorate_name_ar,
         (SELECT COUNT(*) FROM orders o WHERE o.customer_id = u.id) AS orders_count,
         (SELECT COALESCE(SUM(o.total_amount),0) FROM orders o WHERE o.customer_id = u.id AND o.status != 'cancelled') AS total_value
  FROM customers c
  JOIN users u ON u.id = c.user_id
  LEFT JOIN governorates g ON g.id = c.governorate_id
`;
// GET /api/customers
router.get('/', (req, res, next) => {
    try {
        const { q } = req.query;
        let sql = CUSTOMER_SELECT;
        const params = [];
        if (q) {
            sql += ' WHERE (u.name_ar LIKE ? OR u.email LIKE ? OR u.phone LIKE ?)';
            params.push(`%${q}%`, `%${q}%`, `%${q}%`);
        }
        const pg = paginate(req);
        if (pg.enabled) {
            const total = get(`SELECT COUNT(*) AS c FROM customers c JOIN users u ON u.id = c.user_id LEFT JOIN governorates g ON g.id = c.governorate_id ${q ? ' WHERE (u.name_ar LIKE ? OR u.email LIKE ? OR u.phone LIKE ?)' : ''}`, q ? [`%${q}%`, `%${q}%`, `%${q}%`] : []).c;
            const rows = all(sql + ' ORDER BY c.id DESC LIMIT ? OFFSET ?', [...params, pg.limit, pg.offset]);
            return ok(res, rows, { total, page: pg.page, limit: pg.limit, pages: Math.max(1, Math.ceil(total / pg.limit)) });
        }
        return ok(res, all(sql + ' ORDER BY c.id DESC', params));
    }
    catch (e) {
        next(e);
    }
});
// GET /api/customers/:id
router.get('/:id', (req, res, next) => {
    try {
        const id = toId(req.params.id);
        const customer = get(CUSTOMER_SELECT + ' WHERE c.id = ?', [id]);
        if (!customer)
            throw new ApiError(404, 'الزبون غير موجود');
        return ok(res, customer);
    }
    catch (e) {
        next(e);
    }
});
// POST /api/customers
router.post('/', async (req, res, next) => {
    try {
        const { name_ar, name_en, email, phone, password, governorate_id, address } = req.body || {};
        if (!name_ar || !email || !phone || !password)
            throw new ApiError(400, 'يرجى ملء الحقول المطلوبة');
        const exists = get('SELECT id FROM users WHERE email = ? OR phone = ?', [email, phone]);
        if (exists)
            throw new ApiError(409, 'البريد أو رقم الهاتف مستخدم مسبقاً');
        const govId = governorate_id ? Number(governorate_id) : null;
        const passwordHash = await hashPassword(password);
        let userId, customerId;
        transaction(() => {
            userId = run('INSERT INTO users (role, name_ar, name_en, email, phone, password_hash, governorate_id, is_active) VALUES (?,?,?,?,?,?,?,1)', ['customer', name_ar, name_en || null, String(email).toLowerCase(), phone, passwordHash, govId]).lastId;
            customerId = run('INSERT INTO customers (user_id, governorate_id, address) VALUES (?,?,?)', [userId, govId, address || null]).lastId;
        });
        logActivity(req.user, 'create', 'customer', customerId, { name_ar });
        return created(res, get(CUSTOMER_SELECT + ' WHERE c.id = ?', [customerId]));
    }
    catch (e) {
        next(e);
    }
});
// PUT /api/customers/:id
router.put('/:id', (req, res, next) => {
    try {
        const id = toId(req.params.id);
        const customer = get('SELECT * FROM customers WHERE id = ?', [id]);
        if (!customer)
            throw new ApiError(404, 'الزبون غير موجود');
        const user = get('SELECT * FROM users WHERE id = ?', [customer.user_id]);
        const { name_ar, name_en, email, phone, governorate_id, address, is_active } = req.body || {};
        if (email) {
            const dup = get('SELECT id FROM users WHERE email = ? AND id != ?', [String(email).toLowerCase(), user.id]);
            if (dup)
                throw new ApiError(409, 'البريد مستخدم مسبقاً');
        }
        if (phone) {
            const dup = get('SELECT id FROM users WHERE phone = ? AND id != ?', [phone, user.id]);
            if (dup)
                throw new ApiError(409, 'رقم الهاتف مستخدم مسبقاً');
        }
        transaction(() => {
            run('UPDATE users SET name_ar = ?, name_en = ?, email = ?, phone = ?, governorate_id = ?, is_active = ?, updated_at = datetime(\'now\') WHERE id = ?', [
                name_ar !== undefined ? name_ar : user.name_ar,
                name_en !== undefined ? name_en : user.name_en,
                email !== undefined ? String(email).toLowerCase() : user.email,
                phone !== undefined ? phone : user.phone,
                governorate_id !== undefined ? Number(governorate_id) : user.governorate_id,
                is_active !== undefined ? (Number(is_active) ? 1 : 0) : user.is_active,
                user.id,
            ]);
            run('UPDATE customers SET governorate_id = ?, address = ?, updated_at = datetime(\'now\') WHERE id = ?', [
                governorate_id !== undefined ? Number(governorate_id) : customer.governorate_id,
                address !== undefined ? address : customer.address,
                id,
            ]);
        });
        logActivity(req.user, 'update', 'customer', id, { name_ar });
        return ok(res, get(CUSTOMER_SELECT + ' WHERE c.id = ?', [id]));
    }
    catch (e) {
        next(e);
    }
});
// DELETE /api/customers/:id
router.delete('/:id', (req, res, next) => {
    try {
        const id = toId(req.params.id);
        const customer = get('SELECT * FROM customers WHERE id = ?', [id]);
        if (!customer)
            throw new ApiError(404, 'الزبون غير موجود');
        const orders = get('SELECT COUNT(*) AS c FROM orders WHERE customer_id = ?', [customer.user_id]).c;
        if (orders > 0) {
            run('UPDATE users SET is_active = 0, updated_at = datetime(\'now\') WHERE id = ?', [customer.user_id]);
            return ok(res, { message: 'لا يمكن حذف الزبون لوجود طلبات، تم إيقافه بدلاً من ذلك' });
        }
        transaction(() => {
            run('DELETE FROM customers WHERE user_id = ?', [customer.user_id]);
            run('DELETE FROM users WHERE id = ?', [customer.user_id]);
        });
        logActivity(req.user, 'delete', 'customer', id, { name_ar: customer.name_ar });
        return ok(res, { message: 'تم حذف الزبون بنجاح' });
    }
    catch (e) {
        next(e);
    }
});
module.exports = router;
