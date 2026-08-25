"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express = require('express');
const fs = require('fs');
const path = require('path');
const { get, all, run, transaction } = require('../db');
const { ApiError, toId, round2, settingValue, paginate, assertLength } = require('../utils/helpers');
const { hashPassword, randomPassword } = require('../utils/password');
const { ok, created } = require('../utils/response');
const { authenticate } = require('../middleware/auth');
const { requireRole, requireAdminOrAgent } = require('../middleware/rbac');
const { logActivity } = require('../utils/log');
const { deleteUploadValue, deleteRemovedImages, uploadFilePath } = require('../utils/uploads');
const { revokeAllSessions } = require('../utils/session');
const { notifyRole } = require('../utils/push');
const router = express.Router();
router.use(authenticate, requireAdminOrAgent());
const PROVIDER_SELECT = `
  SELECT p.*, s.name_ar AS service_name_ar, s.slug AS service_slug, s.icon AS service_icon,
         g.name_ar AS governorate_name_ar, g.code AS governorate_code,
         u.email, u.phone AS user_phone, u.is_active AS user_active,
         (SELECT COUNT(*) FROM orders o WHERE o.provider_id = p.id) AS orders_count,
         (SELECT COALESCE(SUM(o.total_amount),0) FROM orders o WHERE o.provider_id = p.id AND o.status != 'cancelled') AS total_value,
         (SELECT COALESCE(AVG(r.rating),0) FROM item_ratings r WHERE r.provider_id = p.id) AS rating,
         (SELECT COUNT(*) FROM item_ratings r WHERE r.provider_id = p.id) AS rating_count
  FROM providers p
  JOIN services s ON s.id = p.service_id
  JOIN governorates g ON g.id = p.governorate_id
  JOIN users u ON u.id = p.user_id
`;
function scopeClause(req) {
    if (req.user.role === 'agent') {
        return { sql: 'p.governorate_id = ?', params: [req.user.governorate_id] };
    }
    return { sql: '', params: [] };
}
function ensureCanManage(req, provider) {
    if (req.user.role === 'agent' && provider.governorate_id !== req.user.governorate_id) {
        throw new ApiError(403, 'لا تملك صلاحية التعامل مع هذا المزود خارج محافظتك');
    }
}
// الوكيل ذو الإجارة المنتهية لا يستطيع إجراء عمليات إدارية على المزودين (تبقى القراءة متاحة)
function ensureLeaseActive(req) {
    if (req.user.role !== 'agent')
        return;
    const active = req.user.lease_status === 'active'
        && req.user.lease_expires_at
        && new Date(req.user.lease_expires_at) > new Date();
    if (!active) {
        throw new ApiError(403, 'إجارة الوكالة منتهية، يرجى التواصل مع الإدارة لتجديد الإجارة قبل إدارة المزودين');
    }
}
// GET /api/providers
router.get('/', (req, res, next) => {
    try {
        const { service_id, governorate_id, q, service_slug, verified, sort } = req.query;
        const conditions = [];
        const params = [];
        const sc = scopeClause(req);
        if (sc.sql) {
            conditions.push(sc.sql);
            params.push(...sc.params);
        }
        if (service_id) {
            conditions.push('p.service_id = ?');
            params.push(Number(service_id));
        }
        if (service_slug) {
            conditions.push('s.slug = ?');
            params.push(service_slug);
        }
        if (governorate_id && req.user.role === 'admin') {
            conditions.push('p.governorate_id = ?');
            params.push(Number(governorate_id));
        }
        if (verified !== undefined) {
            conditions.push('p.is_verified = ?');
            params.push(Number(verified) ? 1 : 0);
        }
        if (q) {
            conditions.push('(p.name_ar LIKE ? OR u.email LIKE ?)');
            params.push(`%${q}%`, `%${q}%`);
        }
        const where = conditions.length ? ' WHERE ' + conditions.join(' AND ') : '';
        const pg = paginate(req);
        const orderBy = sort === 'rating' ? '(SELECT COALESCE(AVG(r.rating),0) FROM item_ratings r WHERE r.provider_id = p.id) DESC, p.id DESC' :
            sort === 'orders' ? 'orders_count DESC, p.id DESC' :
                sort === 'value' ? 'total_value DESC, p.id DESC' :
                    sort === 'name' ? 'p.name_ar ASC' :
                        'p.id DESC';
        if (pg.enabled) {
            const total = get(`SELECT COUNT(*) AS c FROM providers p JOIN services s ON s.id = p.service_id JOIN governorates g ON g.id = p.governorate_id JOIN users u ON u.id = p.user_id ${where}`, params).c;
            const rows = all(PROVIDER_SELECT + where + ' ORDER BY ' + orderBy + ' LIMIT ? OFFSET ?', [...params, pg.limit, pg.offset]);
            return ok(res, rows.map((r) => ({ ...r, total_value: round2(r.total_value) })), {
                total,
                page: pg.page,
                limit: pg.limit,
                pages: Math.max(1, Math.ceil(total / pg.limit)),
            });
        }
        const rows = all(PROVIDER_SELECT + where + ' ORDER BY ' + orderBy, params);
        return ok(res, rows.map((r) => ({ ...r, total_value: round2(r.total_value) })));
    }
    catch (e) {
        next(e);
    }
});
// GET /api/providers/:id
router.get('/:id', (req, res, next) => {
    try {
        const id = toId(req.params.id);
        const provider = get(PROVIDER_SELECT + ' WHERE p.id = ?', [id]);
        if (!provider)
            throw new ApiError(404, 'مزود الخدمة غير موجود');
        ensureCanManage(req, provider);
        return ok(res, { ...provider, total_value: round2(provider.total_value) });
    }
    catch (e) {
        next(e);
    }
});
// GET /api/providers/:id/overview - لوحة تفاصيل متكاملة للمزود (تقييم، محفظة، نشاط شهري، كتالوج، تقييمات الزبائن)
router.get('/:id/overview', (req, res, next) => {
    try {
        const id = toId(req.params.id);
        const provider = get(PROVIDER_SELECT + ' WHERE p.id = ?', [id]);
        if (!provider)
            throw new ApiError(404, 'مزود الخدمة غير موجود');
        ensureCanManage(req, provider);
        const wallet = get('SELECT * FROM provider_wallets WHERE provider_id = ?', [id]) || { provider_id: id, balance: 0 };
        const transactions = all('SELECT * FROM wallet_transactions WHERE provider_id = ? ORDER BY id DESC LIMIT 10', [id]);
        const monthly = all(`SELECT strftime('%Y-%m', o.created_at) AS month,
              COUNT(*) AS orders_count,
              COALESCE(SUM(o.total_amount),0) AS total_value,
              COALESCE(SUM(o.agent_amount),0) AS commission
       FROM orders o WHERE o.provider_id = ? AND o.status != 'cancelled'
         AND o.created_at >= datetime('now', '-5 months', 'start of month')
       GROUP BY month ORDER BY month DESC`, [id]);
        const byStatus = all('SELECT status, COUNT(*) AS count, COALESCE(SUM(total_amount),0) AS value FROM orders WHERE provider_id = ? GROUP BY status', [id]);
        const recentOrders = all(`SELECT o.order_number, o.status, o.total_amount, o.created_at, o.customer_name,
              COALESCE(cu.name_ar, o.customer_name) AS customer
       FROM orders o LEFT JOIN users cu ON cu.id = o.customer_id
       WHERE o.provider_id = ? ORDER BY o.id DESC LIMIT 6`, [id]);
        const catalog = {};
        for (const [table, label] of [['products', 'منتجات'], ['menu_items', 'أصناف قائمة'], ['hotel_rooms', 'غرف'], ['flights', 'رحلات'], ['travel_packages', 'باقات']]) {
            catalog[label] = get(`SELECT COUNT(*) AS c FROM ${table} WHERE provider_id = ? AND is_active = 1`, [id]).c;
        }
        const reviews = all(`SELECT r.id, r.item_type, r.item_id, r.rating, r.comment, r.created_at,
              cu.name_ar AS customer_name
       FROM item_ratings r LEFT JOIN users cu ON cu.id = r.customer_id
       WHERE r.provider_id = ? ORDER BY r.id DESC LIMIT 10`, [id]);
        return ok(res, {
            provider: { ...provider, total_value: round2(provider.total_value) },
            rating: Number(provider.rating) || 0,
            rating_count: provider.rating_count,
            wallet: { balance: round2(wallet.balance) },
            transactions: transactions.map((t) => ({ ...t, amount: round2(t.amount), balance_after: round2(t.balance_after) })),
            monthly: monthly.map((m) => ({ ...m, total_value: round2(m.total_value), commission: round2(m.commission) })),
            orders_by_status: byStatus,
            recent_orders: recentOrders,
            catalog,
            reviews,
        });
    }
    catch (e) {
        next(e);
    }
});
// POST /api/providers
router.post('/', async (req, res, next) => {
    try {
        ensureLeaseActive(req);
        const { name_ar, name_en, email, phone, password, governorate_id, service_id, commission_rate = settingValue('platform_commission_default', 5), address, description, website, logo, is_active = 1, is_featured = 0, is_verified = 0, } = req.body || {};
        if (!name_ar || !email || !service_id)
            throw new ApiError(400, 'يرجى ملء الحقول المطلوبة (الاسم، البريد، نوع الخدمة)');
        if (name_ar !== undefined && name_ar !== '')
            assertLength(name_ar, 100, 'الاسم');
        if (name_en !== undefined && name_en !== '')
            assertLength(name_en, 100, 'الاسم اللاتيني');
        if (commission_rate !== undefined) {
            const rate = Number(commission_rate);
            if (!Number.isFinite(rate) || rate < 0 || rate > 100) {
                throw new ApiError(400, 'نسبة العمولة يجب أن تكون بين 0 و 100');
            }
        }
        // الوكيل لا يستطيع منح التوثيق/التمييز — المسؤول فقط عبر POST /:id/verify أو PUT
        const canModifyFlags = req.user.role === 'admin';
        const finalFeatured = canModifyFlags ? (Number(is_featured) ? 1 : 0) : 0;
        const finalVerified = canModifyFlags ? (Number(is_verified) ? 1 : 0) : 0;
        let govId = governorate_id ? Number(governorate_id) : null;
        if (req.user.role === 'agent')
            govId = req.user.governorate_id;
        if (!govId)
            throw new ApiError(400, 'يرجى تحديد المحافظة');
        const gov = get('SELECT * FROM governorates WHERE id = ?', [govId]);
        if (!gov)
            throw new ApiError(400, 'المحافظة غير موجودة');
        const svc = get('SELECT * FROM services WHERE id = ?', [Number(service_id)]);
        if (!svc)
            throw new ApiError(400, 'الخدمة غير موجودة');
        const existsUser = get('SELECT id FROM users WHERE email = ? OR (phone IS NOT NULL AND phone = ?)', [email, phone || '']);
        if (existsUser)
            throw new ApiError(409, 'البريد أو رقم الهاتف مستخدم مسبقاً');
        const finalPassword = password || randomPassword();
        const passwordHash = await hashPassword(finalPassword);
        let userId, providerId;
        transaction(() => {
            userId = run('INSERT INTO users (role, name_ar, name_en, email, phone, password_hash, governorate_id, service_type, is_active) VALUES (?,?,?,?,?,?,?,?,?)', ['provider', name_ar, name_en || null, String(email).toLowerCase(), phone || null, passwordHash, govId, svc.slug, Number(is_active) ? 1 : 0]).lastId;
            providerId = run('INSERT INTO providers (user_id, governorate_id, service_id, name_ar, name_en, commission_rate, address, description, website, logo, is_active, is_featured, is_verified) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)', [userId, govId, svc.id, name_ar, name_en || null, Number(commission_rate) || 0, address || null, description || null, website || null, logo || null, Number(is_active) ? 1 : 0, finalFeatured, finalVerified]).lastId;
        });
        logActivity(req.user, 'create', 'provider', providerId, { name_ar, service: svc.name_ar, governorate: gov.name_ar });
        // إشعار للمسؤولين
        notifyRole('admin', {
            type: 'provider_created',
            title: 'مزود جديد بانتظار التفعيل 🏪',
            body: `مزود جديد «${name_ar}» (${svc.name_ar} — ${gov.name_ar}) تم إنشاؤه وبانتظار التفعيل/التوثيق.`,
            url: '/providers',
            icon: '🏪',
        });
        const provider = get(PROVIDER_SELECT + ' WHERE p.id = ?', [providerId]);
        return created(res, { ...provider, generated_password: password ? undefined : finalPassword });
    }
    catch (e) {
        next(e);
    }
});
// PUT /api/providers/:id
router.put('/:id', (req, res, next) => {
    try {
        const id = toId(req.params.id);
        const provider = get('SELECT * FROM providers WHERE id = ?', [id]);
        if (!provider)
            throw new ApiError(404, 'مزود الخدمة غير موجود');
        ensureCanManage(req, provider);
        ensureLeaseActive(req);
        const user = get('SELECT * FROM users WHERE id = ?', [provider.user_id]);
        const { name_ar, name_en, email, phone, service_id, commission_rate, address, description, website, logo, is_active, is_featured, is_verified, governorate_id, } = req.body || {};
        if (name_ar !== undefined && name_ar !== '')
            assertLength(name_ar, 100, 'الاسم');
        if (name_en !== undefined && name_en !== '')
            assertLength(name_en, 100, 'الاسم اللاتيني');
        // المسؤول وحده يغيّر التوثيق/التمييز؛ الوكيل يحتفظ بالقيم الحالية (لا يتجاوز POST /:id/verify)
        const canModifyFlags = req.user.role === 'admin';
        const finalFeatured = canModifyFlags ? (is_featured !== undefined ? (Number(is_featured) ? 1 : 0) : provider.is_featured) : provider.is_featured;
        const finalVerified = canModifyFlags ? (is_verified !== undefined ? (Number(is_verified) ? 1 : 0) : provider.is_verified) : provider.is_verified;
        if (commission_rate !== undefined) {
            const rate = Number(commission_rate);
            if (!Number.isFinite(rate) || rate < 0 || rate > 100) {
                throw new ApiError(400, 'نسبة العمولة يجب أن تكون رقماً بين 0 و 100');
            }
        }
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
        if (service_id) {
            const svc = get('SELECT id FROM services WHERE id = ?', [Number(service_id)]);
            if (!svc)
                throw new ApiError(400, 'الخدمة غير موجودة');
        }
        let govId = provider.governorate_id;
        if (req.user.role === 'admin' && governorate_id) {
            const gov = get('SELECT id FROM governorates WHERE id = ?', [Number(governorate_id)]);
            if (!gov)
                throw new ApiError(400, 'المحافظة غير موجودة');
            govId = Number(governorate_id);
        }
        const newActive = is_active !== undefined ? (Number(is_active) ? 1 : 0) : provider.is_active;
        const newLogo = logo !== undefined ? logo : provider.logo;
        run('UPDATE users SET name_ar = ?, name_en = ?, email = ?, phone = ?, governorate_id = ?, is_active = ?, updated_at = datetime(\'now\') WHERE id = ?', [
            name_ar !== undefined ? name_ar : user.name_ar,
            name_en !== undefined ? name_en : user.name_en,
            email !== undefined ? String(email).toLowerCase() : user.email,
            phone !== undefined ? phone : user.phone,
            govId,
            newActive,
            user.id,
        ]);
        run(`UPDATE providers SET name_ar = ?, name_en = ?, governorate_id = ?, service_id = ?, commission_rate = ?,
        address = ?, description = ?, website = ?, logo = ?, is_active = ?, is_featured = ?,
        is_verified = ?, verified_at = ?, updated_at = datetime('now') WHERE id = ?`, [
            name_ar !== undefined ? name_ar : provider.name_ar,
            name_en !== undefined ? name_en : provider.name_en,
            govId,
            service_id !== undefined ? Number(service_id) : provider.service_id,
            commission_rate !== undefined ? Number(commission_rate) || 0 : provider.commission_rate,
            address !== undefined ? address : provider.address,
            description !== undefined ? description : provider.description,
            website !== undefined ? website : provider.website,
            newLogo,
            newActive,
            finalFeatured,
            finalVerified,
            finalVerified ? new Date().toISOString() : provider.verified_at,
            id,
        ]);
        deleteRemovedImages(provider.logo, newLogo);
        logActivity(req.user, 'update', 'provider', id, { name_ar });
        return ok(res, get(PROVIDER_SELECT + ' WHERE p.id = ?', [id]));
    }
    catch (e) {
        next(e);
    }
});
// POST /api/providers/:id/toggle
router.post('/:id/toggle', (req, res, next) => {
    try {
        const id = toId(req.params.id);
        const provider = get('SELECT * FROM providers WHERE id = ?', [id]);
        if (!provider)
            throw new ApiError(404, 'مزود الخدمة غير موجود');
        ensureCanManage(req, provider);
        ensureLeaseActive(req);
        const nextState = provider.is_active ? 0 : 1;
        run('UPDATE providers SET is_active = ?, updated_at = datetime(\'now\') WHERE id = ?', [nextState, id]);
        run('UPDATE users SET is_active = ?, updated_at = datetime(\'now\') WHERE id = ?', [nextState, provider.user_id]);
        logActivity(req.user, nextState ? 'activate' : 'deactivate', 'provider', id);
        return ok(res, get(PROVIDER_SELECT + ' WHERE p.id = ?', [id]));
    }
    catch (e) {
        next(e);
    }
});
// GET /api/providers/:id/documents/:field — مستندات التوثيق (البطاقة الوطنية / تأييد السكن)
// لا تُقدَّم من /uploads عاماً (تفحصها app.js وترفضها): تُقدَّم هنا للمسؤول/الوكيل المصرَّح فقط.
const DOC_FIELDS = { national_id: 'national_id_image', residency: 'residency_doc_image' };
router.get('/:id/documents/:field', (req, res, next) => {
    try {
        const id = toId(req.params.id);
        const col = DOC_FIELDS[req.params.field];
        if (!col)
            throw new ApiError(400, 'حقل مستند غير معروف');
        const provider = get(`SELECT id, governorate_id, ${col} AS doc FROM providers WHERE id = ?`, [id]);
        if (!provider)
            throw new ApiError(404, 'مزود الخدمة غير موجود');
        ensureCanManage(req, provider);
        if (!provider.doc)
            throw new ApiError(404, 'لا يوجد مستند مرفوع لهذا المزود');
        const abs = uploadFilePath(provider.doc);
        if (!abs || !fs.existsSync(abs))
            throw new ApiError(404, 'الملف غير موجود');
        const ext = path.extname(abs).toLowerCase().slice(1);
        const mime = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : ext === 'gif' ? 'image/gif' : 'image/jpeg';
        res.setHeader('Content-Type', mime);
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('Content-Disposition', `inline; filename="${path.basename(abs)}"`);
        const stream = fs.createReadStream(abs);
        stream.on('error', () => res.status(404).end());
        return stream.pipe(res);
    }
    catch (e) {
        next(e);
    }
});
// POST /api/providers/:id/verify — موافقة/رفض التوثيق (مع إبقاء التبديل القديم متوافقاً)
router.post('/:id/verify', (req, res, next) => {
    try {
        const id = toId(req.params.id);
        const provider = get('SELECT * FROM providers WHERE id = ?', [id]);
        if (!provider)
            throw new ApiError(404, 'مزود الخدمة غير موجود');
        ensureCanManage(req, provider);
        ensureLeaseActive(req);
        const { status, note } = req.body || {};
        if (status && ['approved', 'rejected', 'none'].includes(status)) {
            const cleanNote = note ? String(note).trim().slice(0, 500) : null;
            const verified = status === 'approved' ? 1 : 0;
            run(`UPDATE providers SET is_verified = ?, verification_status = ?, verification_note = ?,
                verified_at = ?, reviewed_at = datetime('now'), updated_at = datetime('now')
         WHERE id = ?`, [verified, status, status === 'approved' ? null : cleanNote, verified ? new Date().toISOString() : null, id]);
            logActivity(req.user, status === 'approved' ? 'verify' : status === 'rejected' ? 'reject_verification' : 'reset_verification', 'provider', id, { note: cleanNote });
            return ok(res, get(PROVIDER_SELECT + ' WHERE p.id = ?', [id]));
        }
        const nextState = provider.is_verified ? 0 : 1;
        run('UPDATE providers SET is_verified = ?, verified_at = ?, verification_status = ?, reviewed_at = datetime(\'now\'), updated_at = datetime(\'now\') WHERE id = ?', [nextState, nextState ? new Date().toISOString() : null, nextState ? 'approved' : 'none', id]);
        logActivity(req.user, nextState ? 'verify' : 'unverify', 'provider', id);
        return ok(res, get(PROVIDER_SELECT + ' WHERE p.id = ?', [id]));
    }
    catch (e) {
        next(e);
    }
});
// POST /api/providers/:id/reset-password
router.post('/:id/reset-password', async (req, res, next) => {
    try {
        const id = toId(req.params.id);
        const provider = get('SELECT * FROM providers WHERE id = ?', [id]);
        if (!provider)
            throw new ApiError(404, 'مزود الخدمة غير موجود');
        ensureCanManage(req, provider);
        ensureLeaseActive(req);
        const newPassword = randomPassword();
        run('UPDATE users SET password_hash = ?, updated_at = datetime(\'now\') WHERE id = ?', [await hashPassword(newPassword), provider.user_id]);
        revokeAllSessions(provider.user_id);
        logActivity(req.user, 'reset_password', 'provider', id);
        return ok(res, { message: 'تم إعادة تعيين كلمة المرور', generated_password: newPassword });
    }
    catch (e) {
        next(e);
    }
});
// DELETE /api/providers/:id
router.delete('/:id', (req, res, next) => {
    try {
        const id = toId(req.params.id);
        const provider = get('SELECT * FROM providers WHERE id = ?', [id]);
        if (!provider)
            throw new ApiError(404, 'مزود الخدمة غير موجود');
        ensureCanManage(req, provider);
        ensureLeaseActive(req);
        const orders = get('SELECT COUNT(*) AS c FROM orders WHERE provider_id = ?', [id]).c;
        if (orders > 0) {
            run('UPDATE providers SET is_active = 0, updated_at = datetime(\'now\') WHERE id = ?', [id]);
            run('UPDATE users SET is_active = 0, updated_at = datetime(\'now\') WHERE id = ?', [provider.user_id]);
            logActivity(req.user, 'deactivate', 'provider', id, { reason: 'delete_with_orders' });
            return ok(res, { message: 'لا يمكن حذف المزود لوجود طلبات مرتبطة، تم إيقافه بدلاً من ذلك' });
        }
        // حذف الملفات المرتبطة بالمزوّد (شعار/غلاف/مستندات) وصورة المستخدم قبل حذف الحساب
        deleteUploadValue([provider.logo, provider.cover, provider.national_id_image, provider.residency_doc_image].join(','));
        const delUser = get('SELECT avatar FROM users WHERE id = ?', [provider.user_id]);
        if (delUser)
            deleteUploadValue(delUser.avatar);
        run('DELETE FROM users WHERE id = ?', [provider.user_id]);
        logActivity(req.user, 'delete', 'provider', id, { name_ar: provider.name_ar });
        return ok(res, { message: 'تم حذف مزود الخدمة بنجاح' });
    }
    catch (e) {
        next(e);
    }
});
module.exports = router;
