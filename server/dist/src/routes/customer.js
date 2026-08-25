"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express = require('express');
const { get, all, run, transaction } = require('../db');
const { ApiError, toId, round2, assertLength } = require('../utils/helpers');
const { ok, created } = require('../utils/response');
const { authenticate } = require('../middleware/auth');
const { requireRole } = require('../middleware/rbac');
const { logActivity } = require('../utils/log');
const { deleteRemovedImages } = require('../utils/uploads');
const { validateCoupon } = require('../utils/coupons');
const { buildSoldMap } = require('../utils/itemSold');
const { tierOf, nextTier, referralLink } = require('../utils/loyalty');
const { settingValue } = require('../utils/helpers');
const router = express.Router();
router.use(authenticate, requireRole('customer'));
// GET /api/customer/dashboard
router.get('/dashboard', (req, res, next) => {
    try {
        const uid = req.user.id;
        const summary = get(`SELECT COUNT(*) AS orders_count,
              COALESCE(SUM(CASE WHEN status != 'cancelled' THEN total_amount END),0) AS orders_value,
              SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending_count,
              SUM(CASE WHEN status = 'in_progress' THEN 1 ELSE 0 END) AS active_count,
              SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS completed_count
       FROM orders WHERE customer_id = ?`, [uid]);
        const recent = all(`SELECT o.*, p.name_ar AS provider_name, s.name_ar AS service_name_ar, s.slug AS service_slug, s.icon AS service_icon
       FROM orders o JOIN providers p ON p.id = o.provider_id JOIN services s ON s.id = o.service_id
       WHERE o.customer_id = ? ORDER BY o.id DESC LIMIT 10`, [uid]);
        const byStatus = all('SELECT status, COUNT(*) AS count FROM orders WHERE customer_id = ? GROUP BY status', [uid]);
        return ok(res, {
            orders_count: summary.orders_count,
            orders_value: round2(summary.orders_value),
            pending_count: summary.pending_count,
            active_count: summary.active_count,
            completed_count: summary.completed_count,
            orders_by_status: byStatus,
            recent_orders: recent,
        });
    }
    catch (e) {
        next(e);
    }
});
// GET /api/customer/profile
router.get('/profile', (req, res, next) => {
    try {
        const uid = req.user.id;
        const user = get('SELECT id, name_ar, name_en, email, phone, governorate_id, avatar FROM users WHERE id = ?', [uid]);
        const cust = get('SELECT * FROM customers WHERE user_id = ?', [uid]);
        let governorate = null;
        if (user.governorate_id) {
            governorate = get('SELECT id, name_ar, code FROM governorates WHERE id = ?', [user.governorate_id]);
        }
        return ok(res, { user, customer: cust, governorate });
    }
    catch (e) {
        next(e);
    }
});
// PUT /api/customer/profile
router.put('/profile', (req, res, next) => {
    try {
        const uid = req.user.id;
        const user = get('SELECT * FROM users WHERE id = ?', [uid]);
        const cust = get('SELECT * FROM customers WHERE user_id = ?', [uid]);
        const { name_ar, name_en, email, phone, governorate_id, address, avatar, } = req.body || {};
        if (name_ar !== undefined && name_ar !== '')
            assertLength(name_ar, 100, 'الاسم');
        if (name_en !== undefined && name_en !== '')
            assertLength(name_en, 100, 'الاسم اللاتيني');
        if (avatar !== undefined && avatar !== '')
            assertLength(avatar, 500, 'الصورة الرمزية');
        if (address !== undefined && address !== '')
            assertLength(address, 500, 'العنوان');
        if (email) {
            const dup = get('SELECT id FROM users WHERE email = ? AND id != ?', [String(email).toLowerCase(), uid]);
            if (dup)
                throw new ApiError(409, 'البريد مستخدم مسبقاً');
        }
        if (phone !== undefined && phone) {
            const dup = get('SELECT id FROM users WHERE phone = ? AND id != ?', [phone, uid]);
            if (dup)
                throw new ApiError(409, 'رقم الهاتف مستخدم مسبقاً');
        }
        let govId = user.governorate_id;
        if (governorate_id) {
            const gov = get('SELECT id FROM governorates WHERE id = ? AND is_active = 1', [Number(governorate_id)]);
            if (!gov)
                throw new ApiError(400, 'المحافظة غير موجودة');
            govId = Number(governorate_id);
        }
        const newAvatar = avatar !== undefined ? avatar : user.avatar;
        transaction(() => {
            run(`UPDATE users SET name_ar = ?, name_en = ?, email = ?, phone = ?, governorate_id = ?, avatar = ?, updated_at = datetime('now') WHERE id = ?`, [
                name_ar !== undefined ? name_ar : user.name_ar,
                name_en !== undefined ? name_en : user.name_en,
                email !== undefined ? String(email).toLowerCase() : user.email,
                phone !== undefined ? phone : user.phone,
                govId,
                newAvatar,
                uid,
            ]);
            if (cust) {
                run(`UPDATE customers SET governorate_id = ?, address = ?, updated_at = datetime('now') WHERE id = ?`, [govId, address !== undefined ? address : cust.address, cust.id]);
            }
        });
        deleteRemovedImages(user.avatar, newAvatar);
        logActivity(req.user, 'update', 'customer', uid, { profile: true });
        const fresh = get('SELECT id, name_ar, name_en, email, phone, governorate_id, avatar FROM users WHERE id = ?', [uid]);
        return ok(res, fresh);
    }
    catch (e) {
        next(e);
    }
});
function recomputeProviderRating(providerId) {
    const rows = all('SELECT rating FROM provider_ratings WHERE provider_id = ?', [providerId]);
    if (rows.length === 0) {
        run('UPDATE providers SET rating = 0, rating_count = 0, updated_at = datetime(\'now\') WHERE id = ?', [providerId]);
        return { rating: 0, rating_count: 0 };
    }
    const sum = rows.reduce((s, x) => s + x.rating, 0);
    const rating = Math.round((sum / rows.length) * 10) / 10;
    run('UPDATE providers SET rating = ?, rating_count = ?, updated_at = datetime(\'now\') WHERE id = ?', [rating, rows.length, providerId]);
    return { rating, rating_count: rows.length };
}
// GET /api/customer/rate/:providerId — تقييم الزبون لهذا المزود + المعدل العام
router.get('/rate/:providerId', (req, res, next) => {
    try {
        const providerId = toId(req.params.providerId);
        const provider = get('SELECT id, rating, rating_count FROM providers WHERE id = ?', [providerId]);
        if (!provider)
            throw new ApiError(404, 'مزود الخدمة غير موجود');
        const mine = get('SELECT rating, comment FROM provider_ratings WHERE provider_id = ? AND customer_id = ?', [providerId, req.user.id]);
        return ok(res, {
            provider_id: providerId,
            rating: provider.rating,
            rating_count: provider.rating_count,
            my_rating: mine ? mine.rating : 0,
            my_comment: mine ? mine.comment : null,
        });
    }
    catch (e) {
        next(e);
    }
});
// POST /api/customer/rate/:providerId — تقييم/تحديث تقييم (يتطلب طلباً مكتملاً)
router.post('/rate/:providerId', (req, res, next) => {
    try {
        const providerId = toId(req.params.providerId);
        const { rating, comment } = req.body || {};
        const r = Number(rating);
        if (!Number.isInteger(r) || r < 1 || r > 5)
            throw new ApiError(400, 'التقييم يجب أن يكون عدداً صحيحاً بين 1 و 5');
        const provider = get('SELECT * FROM providers WHERE id = ?', [providerId]);
        if (!provider)
            throw new ApiError(404, 'مزود الخدمة غير موجود');
        const existing = get('SELECT * FROM provider_ratings WHERE provider_id = ? AND customer_id = ?', [providerId, req.user.id]);
        if (!existing) {
            const order = get('SELECT id FROM orders WHERE customer_id = ? AND provider_id = ? AND status = ? ORDER BY id DESC LIMIT 1', [req.user.id, providerId, 'completed']);
            if (!order)
                throw new ApiError(403, 'يمكنك التقييم فقط بعد إتمام طلب مع هذا المزود');
        }
        const cleanComment = comment ? String(comment).trim().slice(0, 500) : null;
        const { rating: newRating, rating_count } = transaction(() => {
            if (existing) {
                run('UPDATE provider_ratings SET rating = ?, comment = ?, updated_at = datetime(\'now\') WHERE id = ?', [r, cleanComment, existing.id]);
            }
            else {
                run('INSERT INTO provider_ratings (provider_id, customer_id, order_id, rating, comment) VALUES (?,?,?,?,?)', [
                    providerId,
                    req.user.id,
                    get('SELECT id FROM orders WHERE customer_id = ? AND provider_id = ? AND status = ? ORDER BY id DESC LIMIT 1', [req.user.id, providerId, 'completed']).id,
                    r,
                    cleanComment,
                ]);
            }
            return recomputeProviderRating(providerId);
        });
        logActivity(req.user, existing ? 'update_rating' : 'rate', 'provider', providerId, { rating: r });
        return ok(res, { provider_id: providerId, rating: newRating, rating_count, my_rating: r });
    }
    catch (e) {
        next(e);
    }
});
// ------------------------- تقييمات البنود (منتجات/أصناف/باقات/غرف/رحلات) -------------------------
const { itemKindOf, findItem, recomputeItemRating, hasPurchasedItem } = require('../utils/itemRatings');
// GET /api/customer/rate-item/:kind/:itemId — تقييم الزبون للبند + المعدل العام
router.get('/rate-item/:kind/:itemId', (req, res, next) => {
    try {
        const kind = itemKindOf(req.params.kind);
        if (!kind)
            throw new ApiError(400, 'نوع البند غير معروف');
        const itemId = toId(req.params.itemId);
        const item = findItem(kind, itemId);
        if (!item)
            throw new ApiError(404, 'البند غير موجود');
        const sum = get('SELECT rating, rating_count FROM item_rating_sums WHERE item_type = ? AND item_id = ?', [kind, itemId]);
        const mine = get('SELECT rating, comment FROM item_ratings WHERE item_type = ? AND item_id = ? AND customer_id = ?', [kind, itemId, req.user.id]);
        return ok(res, {
            item_type: kind,
            item_id: itemId,
            rating: sum ? sum.rating : 0,
            rating_count: sum ? sum.rating_count : 0,
            my_rating: mine ? mine.rating : 0,
            my_comment: mine ? mine.comment : null,
        });
    }
    catch (e) {
        next(e);
    }
});
// POST /api/customer/rate-item/:kind/:itemId — تقييم/تحديث تقييم بند (يتطلب طلباً مكتملاً يشمله)
router.post('/rate-item/:kind/:itemId', (req, res, next) => {
    try {
        const kind = itemKindOf(req.params.kind);
        if (!kind)
            throw new ApiError(400, 'نوع البند غير معروف');
        const itemId = toId(req.params.itemId);
        const item = findItem(kind, itemId);
        if (!item)
            throw new ApiError(404, 'البند غير موجود');
        const { rating, comment } = req.body || {};
        const r = Number(rating);
        if (!Number.isInteger(r) || r < 1 || r > 5)
            throw new ApiError(400, 'التقييم يجب أن يكون عدداً صحيحاً بين 1 و 5');
        const existing = get('SELECT * FROM item_ratings WHERE item_type = ? AND item_id = ? AND customer_id = ?', [kind, itemId, req.user.id]);
        const orderId = existing ? existing.order_id : hasPurchasedItem(req.user.id, kind, itemId);
        if (!orderId)
            throw new ApiError(403, 'يمكنك تقييم البند فقط بعد إتمام طلب يشمله');
        const cleanComment = comment ? String(comment).trim().slice(0, 500) : null;
        const { rating: newRating, rating_count } = transaction(() => {
            if (existing) {
                run('UPDATE item_ratings SET rating = ?, comment = ?, updated_at = datetime(\'now\') WHERE id = ?', [r, cleanComment, existing.id]);
            }
            else {
                run('INSERT INTO item_ratings (item_type, item_id, provider_id, customer_id, order_id, rating, comment) VALUES (?,?,?,?,?,?,?)', [
                    kind,
                    itemId,
                    item.provider_id,
                    req.user.id,
                    orderId,
                    r,
                    cleanComment,
                ]);
            }
            return recomputeItemRating(kind, itemId, item.provider_id);
        });
        logActivity(req.user, existing ? 'update_rating' : 'rate', `item:${kind}`, itemId, { rating: r });
        return ok(res, { item_type: kind, item_id: itemId, rating: newRating, rating_count, my_rating: r });
    }
    catch (e) {
        next(e);
    }
});
// ------------------------- المفضلة (تتبّع المتاجر) -------------------------
// GET /api/customer/favorites — قائمة المتاجر المفضلة للزبون
router.get('/favorites', (req, res, next) => {
    try {
        const rows = all(`SELECT f.id AS favorite_id, f.created_at AS favorited_at, p.id AS id, p.name_ar, p.name_en,
              p.logo, p.cover, p.rating, p.rating_count, p.is_verified, p.is_active,
              s.name_ar AS service_name_ar, s.slug AS service_slug, s.icon AS service_icon,
              g.name_ar AS governorate_name_ar, g.code AS governorate_code
       FROM customer_favorites f
       JOIN providers p ON p.id = f.provider_id
       JOIN services s ON s.id = p.service_id
       JOIN governorates g ON g.id = p.governorate_id
       WHERE f.customer_id = ? AND p.is_active = 1
       ORDER BY f.id DESC`, [req.user.id]);
        return ok(res, rows);
    }
    catch (e) {
        next(e);
    }
});
// GET /api/customer/favorites/ids — معرفات المتاجر المفضلة (لتلوين القلب في التصفح)
router.get('/favorites/ids', (req, res, next) => {
    try {
        const rows = all('SELECT provider_id FROM customer_favorites WHERE customer_id = ?', [req.user.id]);
        return ok(res, rows.map((r) => Number(r.provider_id)));
    }
    catch (e) {
        next(e);
    }
});
// POST /api/customer/favorites — إضافة متجر للمفضلة (متسامح مع التكرار)
router.post('/favorites', (req, res, next) => {
    try {
        const providerId = toId((req.body || {}).provider_id);
        const provider = get('SELECT id FROM providers WHERE id = ?', [providerId]);
        if (!provider)
            throw new ApiError(404, 'مزود الخدمة غير موجود');
        run('INSERT OR IGNORE INTO customer_favorites (customer_id, provider_id) VALUES (?,?)', [req.user.id, providerId]);
        return ok(res, { provider_id: providerId, favorite: true });
    }
    catch (e) {
        next(e);
    }
});
// DELETE /api/customer/favorites/:providerId — إزالة من المفضلة
router.delete('/favorites/:providerId', (req, res, next) => {
    try {
        const providerId = toId(req.params.providerId);
        run('DELETE FROM customer_favorites WHERE customer_id = ? AND provider_id = ?', [req.user.id, providerId]);
        return ok(res, { provider_id: providerId, favorite: false });
    }
    catch (e) {
        next(e);
    }
});
// ------------------------- مفضلة البنود (منتجات/أصناف/باقات/غرف/رحلات) -------------------------
// GET /api/customer/favorites/items-ids — مفاتيح البنود المفضلة (item_type:item_id) لتلوين القلب
router.get('/favorites/items-ids', (req, res, next) => {
    try {
        const rows = all('SELECT item_type, item_id FROM item_favorites WHERE customer_id = ?', [req.user.id]);
        return ok(res, rows.map((r) => `${r.item_type}:${Number(r.item_id)}`));
    }
    catch (e) {
        next(e);
    }
});
// استعلامات جلب تفاصيل بند مفضل موحّد حسب نوع البند (لقسم "المنتجات المفضلة")
const FAVORITE_ITEM_QUERIES = {
    products: `SELECT p.id, p.provider_id, p.name_ar, p.price, p.old_price, p.images_json, p.stock,
                    COALESCE(irs.rating,0) AS rating, COALESCE(irs.rating_count,0) AS rating_count,
                    pr.name_ar AS provider_name, pr.is_verified AS provider_verified
             FROM products p
             LEFT JOIN providers pr ON pr.id = p.provider_id
             LEFT JOIN item_rating_sums irs ON irs.item_type = 'products' AND irs.item_id = p.id
             WHERE p.id = ? AND p.is_active = 1`,
    menu: `SELECT m.id, m.provider_id, m.name_ar, m.price, m.images_json,
                COALESCE(irs.rating,0) AS rating, COALESCE(irs.rating_count,0) AS rating_count,
                pr.name_ar AS provider_name, pr.is_verified AS provider_verified
         FROM menu_items m
         LEFT JOIN providers pr ON pr.id = m.provider_id
         LEFT JOIN item_rating_sums irs ON irs.item_type = 'menu' AND irs.item_id = m.id
         WHERE m.id = ? AND m.is_active = 1`,
    rooms: `SELECT hr.id, hr.provider_id, hr.name_ar, hr.price_per_night, hr.room_type, hr.max_guests, hr.images_json,
                 COALESCE(irs.rating,0) AS rating, COALESCE(irs.rating_count,0) AS rating_count,
                 pr.name_ar AS provider_name, pr.is_verified AS provider_verified
          FROM hotel_rooms hr
          LEFT JOIN providers pr ON pr.id = hr.provider_id
          LEFT JOIN item_rating_sums irs ON irs.item_type = 'rooms' AND irs.item_id = hr.id
          WHERE hr.id = ? AND hr.is_active = 1`,
    flights: `SELECT f.id, f.provider_id, f.flight_number, f.airline, f.origin, f.origin_ar, f.destination,
                   f.destination_ar, f.departure_at, f.price, f.seats, f.images_json,
                   COALESCE(irs.rating,0) AS rating, COALESCE(irs.rating_count,0) AS rating_count,
                   pr.name_ar AS provider_name, pr.is_verified AS provider_verified
            FROM flights f
            LEFT JOIN providers pr ON pr.id = f.provider_id
            LEFT JOIN item_rating_sums irs ON irs.item_type = 'flights' AND irs.item_id = f.id
            WHERE f.id = ? AND f.is_active = 1`,
    packages: `SELECT p.id, p.provider_id, p.name_ar, p.price, p.destination, p.duration_days, p.images_json,
                    COALESCE(irs.rating,0) AS rating, COALESCE(irs.rating_count,0) AS rating_count,
                    pr.name_ar AS provider_name, pr.is_verified AS provider_verified
             FROM travel_packages p
             LEFT JOIN providers pr ON pr.id = p.provider_id
             LEFT JOIN item_rating_sums irs ON irs.item_type = 'packages' AND irs.item_id = p.id
             WHERE p.id = ? AND p.is_active = 1`,
};
function unifyFavoriteItem(kind, row) {
    let images = [];
    try {
        images = JSON.parse(row.images_json || '[]');
    }
    catch (e) {
        images = [];
    }
    const base = {
        id: Number(row.id),
        provider_id: Number(row.provider_id),
        kind,
        title: row.name_ar || row.flight_number,
        image: images[0] || null,
        rating: Number(row.rating || 0),
        rating_count: Number(row.rating_count || 0),
        provider_name: row.provider_name || '',
        provider_verified: Boolean(row.provider_verified),
    };
    switch (kind) {
        case 'products':
            return { ...base, unit: 'قطعة', price: Number(row.price), old_price: row.old_price ? Number(row.old_price) : null, stock: Number(row.stock || 0) };
        case 'menu':
            return { ...base, unit: 'صنف', price: Number(row.price) };
        case 'rooms':
            return { ...base, unit: 'ليلة', price: Number(row.price_per_night), room_type: row.room_type, max_guests: Number(row.max_guests || 0) };
        case 'flights':
            return {
                ...base,
                title: `${row.origin_ar || row.origin} → ${row.destination_ar || row.destination}`,
                unit: 'مقعد',
                price: Number(row.price),
                airline: row.airline,
                seats: Number(row.seats || 0),
                departure_at: row.departure_at,
            };
        case 'packages':
            return { ...base, unit: 'باقة', price: Number(row.price), destination: row.destination, duration_days: Number(row.duration_days || 0) };
        default:
            return base;
    }
}
// GET /api/customer/favorites/items — تفاصيل البنود المفضلة موحّدة (لقسم "المنتجات المفضلة")
router.get('/favorites/items', (req, res, next) => {
    try {
        const rows = all('SELECT item_type, item_id FROM item_favorites WHERE customer_id = ? ORDER BY id DESC', [req.user.id]);
        const soldMap = buildSoldMap();
        const items = [];
        for (const r of rows) {
            const kind = itemKindOf(r.item_type);
            const sql = kind && FAVORITE_ITEM_QUERIES[kind];
            const row = sql ? get(sql, [Number(r.item_id)]) : null;
            if (!row)
                continue;
            const item = unifyFavoriteItem(kind, row);
            item.sold = soldMap.get(`${kind}:${item.id}`) || 0;
            items.push(item);
        }
        return ok(res, items);
    }
    catch (e) {
        next(e);
    }
});
// POST /api/customer/favorites/items — إضافة بند للمفضلة (متسامح مع التكرار)
router.post('/favorites/items', (req, res, next) => {
    try {
        const itemType = itemKindOf((req.body || {}).item_type);
        if (!itemType)
            throw new ApiError(400, 'نوع البند غير معروف');
        const itemId = toId((req.body || {}).item_id, 'البند');
        const item = findItem(itemType, itemId);
        if (!item)
            throw new ApiError(404, 'البند غير موجود');
        run('INSERT OR IGNORE INTO item_favorites (customer_id, item_type, item_id, provider_id) VALUES (?,?,?,?)', [
            req.user.id, itemType, itemId, item.provider_id,
        ]);
        return ok(res, { item_type: itemType, item_id: itemId, favorite: true });
    }
    catch (e) {
        next(e);
    }
});
// DELETE /api/customer/favorites/items/:itemType/:itemId — إزالة بند من المفضلة
router.delete('/favorites/items/:itemType/:itemId', (req, res, next) => {
    try {
        const itemType = itemKindOf(req.params.itemType);
        if (!itemType)
            throw new ApiError(400, 'نوع البند غير معروف');
        const itemId = toId(req.params.itemId, 'البند');
        run('DELETE FROM item_favorites WHERE customer_id = ? AND item_type = ? AND item_id = ?', [req.user.id, itemType, itemId]);
        return ok(res, { item_type: itemType, item_id: itemId, favorite: false });
    }
    catch (e) {
        next(e);
    }
});
// ------------------------- متابعة مزودي الخدمات -------------------------
// GET /api/customer/following — معرفات المزودين الذين يتابعهم الزبون
router.get('/following', (req, res, next) => {
    try {
        const rows = all(`SELECT f.provider_id, f.created_at AS followed_at, p.name_ar, p.logo, p.rating, p.rating_count,
              s.name_ar AS service_name_ar, s.slug AS service_slug, s.icon AS service_icon,
              g.name_ar AS governorate_name_ar
       FROM provider_follows f
       JOIN providers p ON p.id = f.provider_id
       JOIN services s ON s.id = p.service_id
       JOIN governorates g ON g.id = p.governorate_id
       WHERE f.customer_id = ? AND p.is_active = 1
       ORDER BY f.id DESC`, [req.user.id]);
        return ok(res, rows);
    }
    catch (e) {
        next(e);
    }
});
// POST /api/customer/follow — متابعة مزوّد
router.post('/follow', (req, res, next) => {
    try {
        const providerId = toId((req.body || {}).provider_id);
        const provider = get('SELECT id FROM providers WHERE id = ?', [providerId]);
        if (!provider)
            throw new ApiError(404, 'مزود الخدمة غير موجود');
        run('INSERT OR IGNORE INTO provider_follows (customer_id, provider_id) VALUES (?,?)', [req.user.id, providerId]);
        return ok(res, { provider_id: providerId, following: true });
    }
    catch (e) {
        next(e);
    }
});
// DELETE /api/customer/follow/:providerId — إلغاء متابعة مزوّد
router.delete('/follow/:providerId', (req, res, next) => {
    try {
        const providerId = toId(req.params.providerId);
        run('DELETE FROM provider_follows WHERE customer_id = ? AND provider_id = ?', [req.user.id, providerId]);
        return ok(res, { provider_id: providerId, following: false });
    }
    catch (e) {
        next(e);
    }
});
// ------------------------- دفتر العناوين -------------------------
// GET /api/customer/addresses — عناوين الزبون المحفوظة
router.get('/addresses', (req, res, next) => {
    try {
        const rows = all(`SELECT a.*, g.name_ar AS governorate_name_ar, g.code AS governorate_code
       FROM addresses a
       LEFT JOIN governorates g ON g.id = a.governorate_id
       WHERE a.customer_id = ?
       ORDER BY a.is_default DESC, a.id DESC`, [req.user.id]);
        return ok(res, rows);
    }
    catch (e) {
        next(e);
    }
});
function sanitizeAddress(body) {
    const label = body.label ? String(body.label).trim().slice(0, 50) : null;
    const name_ar = body.name_ar !== undefined ? String(body.name_ar).trim().slice(0, 100) : null;
    const phone = body.phone !== undefined ? String(body.phone).trim().slice(0, 30) : null;
    const address = String(body.address || '').trim().slice(0, 500);
    if (!address)
        throw new ApiError(400, 'عنوان التوصيل مطلوب');
    let governorate_id = null;
    if (body.governorate_id) {
        const gov = get('SELECT id FROM governorates WHERE id = ?', [Number(body.governorate_id)]);
        if (!gov)
            throw new ApiError(400, 'المحافظة غير موجودة');
        governorate_id = Number(body.governorate_id);
    }
    return { label, name_ar, phone, address, governorate_id };
}
// POST /api/customer/addresses — إضافة عنوان
router.post('/addresses', (req, res, next) => {
    try {
        const data = sanitizeAddress(req.body || {});
        const isDefault = Number((req.body || {}).is_default) ? 1 : 0;
        const count = get('SELECT COUNT(*) AS c FROM addresses WHERE customer_id = ?', [req.user.id]).c;
        const defaultFlag = isDefault || count === 0 ? 1 : 0;
        const id = transaction(() => {
            if (defaultFlag)
                run('UPDATE addresses SET is_default = 0 WHERE customer_id = ?', [req.user.id]);
            return run('INSERT INTO addresses (customer_id, label, name_ar, phone, governorate_id, address, is_default) VALUES (?,?,?,?,?,?,?)', [req.user.id, data.label, data.name_ar, data.phone, data.governorate_id, data.address, defaultFlag]).lastId;
        });
        return created(res, get('SELECT * FROM addresses WHERE id = ?', [id]));
    }
    catch (e) {
        next(e);
    }
});
// PUT /api/customer/addresses/:id — تعديل عنوان
router.put('/addresses/:id', (req, res, next) => {
    try {
        const id = toId(req.params.id);
        const existing = get('SELECT * FROM addresses WHERE id = ? AND customer_id = ?', [id, req.user.id]);
        if (!existing)
            throw new ApiError(404, 'العنوان غير موجود');
        const data = sanitizeAddress({ ...(req.body || {}), address: (req.body || {}).address !== undefined ? (req.body || {}).address : existing.address });
        run('UPDATE addresses SET label = ?, name_ar = ?, phone = ?, governorate_id = ?, address = ?, updated_at = datetime(\'now\') WHERE id = ?', [
            data.label !== null ? data.label : existing.label,
            data.name_ar !== null ? data.name_ar : existing.name_ar,
            data.phone !== null ? data.phone : existing.phone,
            data.governorate_id !== null ? data.governorate_id : existing.governorate_id,
            data.address,
            id,
        ]);
        return ok(res, get('SELECT * FROM addresses WHERE id = ?', [id]));
    }
    catch (e) {
        next(e);
    }
});
// POST /api/customer/addresses/:id/default — تعيين عنوان افتراضياً
router.post('/addresses/:id/default', (req, res, next) => {
    try {
        const id = toId(req.params.id);
        const existing = get('SELECT * FROM addresses WHERE id = ? AND customer_id = ?', [id, req.user.id]);
        if (!existing)
            throw new ApiError(404, 'العنوان غير موجود');
        transaction(() => {
            run('UPDATE addresses SET is_default = 0 WHERE customer_id = ?', [req.user.id]);
            run('UPDATE addresses SET is_default = 1 WHERE id = ?', [id]);
        });
        return ok(res, { id, is_default: 1 });
    }
    catch (e) {
        next(e);
    }
});
// DELETE /api/customer/addresses/:id — حذف عنوان
router.delete('/addresses/:id', (req, res, next) => {
    try {
        const id = toId(req.params.id);
        const existing = get('SELECT * FROM addresses WHERE id = ? AND customer_id = ?', [id, req.user.id]);
        if (!existing)
            throw new ApiError(404, 'العنوان غير موجود');
        transaction(() => {
            run('DELETE FROM addresses WHERE id = ?', [id]);
            if (existing.is_default) {
                const nextDefault = get('SELECT id FROM addresses WHERE customer_id = ? ORDER BY id DESC LIMIT 1', [req.user.id]);
                if (nextDefault)
                    run('UPDATE addresses SET is_default = 1 WHERE id = ?', [nextDefault.id]);
            }
        });
        return ok(res, { message: 'تم حذف العنوان بنجاح' });
    }
    catch (e) {
        next(e);
    }
});
// ------------------------- الكوبونات (الزبون) -------------------------
// GET /api/customer/coupons/preview?code=&amount=&provider_id= — معاينة الخصم قبل الطلب
router.get('/coupons/preview', (req, res, next) => {
    try {
        const { code, amount, provider_id } = req.query;
        try {
            const { coupon, discount } = validateCoupon(code, {
                providerId: provider_id ? Number(provider_id) : null,
                amount,
                customerId: req.user.id,
            });
            return ok(res, {
                valid: true,
                code: coupon.code,
                title: coupon.title,
                discount_type: coupon.discount_type,
                discount_value: coupon.discount_value,
                discount,
                message: 'الكوبون صالح',
            });
        }
        catch (e) {
            if (e instanceof ApiError) {
                return ok(res, { valid: false, discount: 0, message: e.message });
            }
            throw e;
        }
    }
    catch (e) {
        next(e);
    }
});
// ------------------------- الولاء والإحالة -------------------------
// GET /api/customer/loyalty — رصيد النقاط والمستوى وسجل الحركات
router.get('/loyalty', (req, res, next) => {
    try {
        const user = get('SELECT points_balance, points_total FROM users WHERE id = ?', [req.user.id]);
        const tier = tierOf(user.points_total);
        const next = nextTier(user.points_total);
        const history = all(`SELECT lp.*, o.order_number FROM loyalty_points lp
       LEFT JOIN orders o ON o.id = lp.order_id
       WHERE lp.user_id = ? ORDER BY lp.id DESC LIMIT 50`, [req.user.id]);
        return ok(res, {
            points_balance: Number(user.points_balance) || 0,
            points_total: Number(user.points_total) || 0,
            point_value: Number(settingValue('loyalty_point_value', 1)),
            min_redeem: Number(settingValue('loyalty_min_redeem', 100)),
            tier,
            next_tier: next,
            history,
        });
    }
    catch (e) {
        next(e);
    }
});
// GET /api/customer/referral — كود الإحالة ورابط الدعوة ومكافآته
router.get('/referral', (req, res, next) => {
    try {
        const user = get('SELECT referral_code, referred_by FROM users WHERE id = ?', [req.user.id]);
        if (!user.referral_code)
            throw new ApiError(404, 'لا يوجد كود إحالة لهذا الحساب');
        const bonusReferee = Number(settingValue('referral_bonus_referee', 3000));
        const bonusReferrer = Number(settingValue('referral_bonus_referrer', 5000));
        const minOrder = Number(settingValue('referral_min_order', 10000));
        const invited = all('SELECT COUNT(*) AS c FROM users WHERE referred_by = ?', [req.user.id])[0].c;
        return ok(res, {
            code: user.referral_code,
            link: referralLink(user.referral_code),
            bonus_referee: bonusReferee,
            bonus_referrer: bonusReferrer,
            min_order: minOrder,
            invited_count: invited,
        });
    }
    catch (e) {
        next(e);
    }
});
module.exports = router;
