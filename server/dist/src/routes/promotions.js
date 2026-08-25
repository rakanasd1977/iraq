"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express = require('express');
const { get, all, run, transaction } = require('../db');
const { ApiError, toId, round2, paginate, settingValue, csvEscape } = require('../utils/helpers');
const { ok } = require('../utils/response');
const { authenticate } = require('../middleware/auth');
const { requireRole } = require('../middleware/rbac');
const { createRateLimiter } = require('../utils/rateLimit');
const { logActivity } = require('../utils/log');
const { notifyProviderFollowers } = require('../utils/push');
const { ensureWallet } = require('../utils/wallet');
const PROMO_PRICE_KEY = 'promo_price';
const PROMO_DURATION_KEY = 'promo_duration_days';
const PROMO_MAX_KEY = 'promo_max_active';
// أنواع كتالوج المزودين القابلة للترويج
const ITEM_TYPES = {
    products: { service: 'stores', table: 'products', titleCol: 'name_ar', priceCol: 'price', imageCol: 'images_json', kind: 'products' },
    menu_items: { service: 'restaurants', table: 'menu_items', titleCol: 'name_ar', priceCol: 'price', imageCol: 'images_json', kind: 'menu' },
    hotel_rooms: { service: 'hotels', table: 'hotel_rooms', titleCol: 'name_ar', priceCol: 'price_per_night', imageCol: 'images_json', kind: 'rooms' },
    flights: { service: 'flights', table: 'flights', titleCol: 'flight_number', priceCol: 'price', imageCol: null, kind: 'flights' },
    travel_packages: { service: 'travel_offices', table: 'travel_packages', titleCol: 'name_ar', priceCol: 'price', imageCol: 'images_json', kind: 'packages' },
};
function firstImage(raw) {
    if (!raw)
        return null;
    let list = raw;
    try {
        list = JSON.parse(raw);
    }
    catch (e) { /* نص مفصول بفواصل */ }
    if (Array.isArray(list))
        list = list.join(',');
    return String(list).split(',').map((s) => s.trim()).filter(Boolean)[0] || null;
}
function utcFormat(d) {
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`;
}
function utcNowPlus(days) {
    return utcFormat(new Date(Date.now() + days * 86400000));
}
// التمديد يُضاف لنهاية المدة الحالية (أو من الآن إذا كانت منتهية) — يضمن دائماً مدة أكبر
function extendEndsAt(currentEndsAt, days) {
    const cur = currentEndsAt ? new Date(String(currentEndsAt).replace(' ', 'T') + 'Z') : null;
    const base = cur && cur > new Date() ? cur : new Date();
    return utcFormat(new Date(base.getTime() + days * 86400000));
}
const activeClause = ` status = 'active' AND (ends_at IS NULL OR ends_at > datetime('now')) `;
function loadItem(def, providerId, itemId) {
    const row = get(`SELECT * FROM ${def.table} WHERE id = ? AND provider_id = ?`, [itemId, providerId]);
    if (!row)
        throw new ApiError(404, 'العنصر غير موجود أو لا يملكه هذا المزود');
    if (Number(row.is_active) !== 1)
        throw new ApiError(400, 'لا يمكن الترويج لعنصر غير مفعل');
    return row;
}
function promotionCost(durationDays) {
    const price = settingValue(PROMO_PRICE_KEY, 5000);
    const base = Math.max(1, settingValue(PROMO_DURATION_KEY, 7));
    return round2((price / base) * durationDays);
}
function governorateCache() {
    return new Map(all('SELECT id, name_ar FROM governorates').map((g) => [Number(g.id), g.name_ar]));
}
// إعلان يستهدف كل المحافظات: محافظته التمثيلية هي أقل معرف (للتوافق مع governorate_id NOT NULL)
function representativeGovernorate() {
    return Math.min(...all('SELECT id FROM governorates').map((g) => Number(g.id)));
}
function resolveTargets(body) {
    const target = body && body.target === 'all' ? 'all' : 'governorate';
    let ids = [];
    if (target === 'governorate') {
        const raw = Array.isArray(body && body.governorate_ids) ? body.governorate_ids : [];
        ids = [...new Set(raw.map(Number).filter((n) => Number.isFinite(n) && n > 0))];
        if (ids.length === 0)
            throw new ApiError(400, 'اختر محافظة واحدة أو أكثر للإعلان');
        const valid = new Set(all('SELECT id FROM governorates').map((g) => Number(g.id)));
        const bad = ids.filter((n) => !valid.has(n));
        if (bad.length)
            throw new ApiError(400, 'محافظة غير موجودة: ' + bad.join('، '));
    }
    return { targetType: target, governorateIds: ids };
}
function targetCount(targetType, governorateIds) {
    return targetType === 'all' ? all('SELECT COUNT(*) AS c FROM governorates').map((r) => Number(r.c))[0] : governorateIds.length;
}
// إدراج صف الإعلان (يعمل مع أي محاسبة)
function insertPromotionRow({ provider, def, item, durationDays, cost, targetType, governorateIds, billing, endsAt }) {
    const representativeGovId = targetType === 'all' ? representativeGovernorate() : governorateIds[0];
    const idsCsv = targetType === 'all' ? null : [...governorateIds].sort((a, b) => a - b).join(',');
    return run(`INSERT INTO promotions (provider_id, service_id, item_type, item_id, item_title, item_price, item_image, item_link,
                             governorate_id, target_type, target_governorate_ids, billing, cost, status, ends_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,'active',?)`, [provider.id, provider.service_id, def.table, item.id, item[def.titleCol], round2(item[def.priceCol]),
        firstImage(item[def.imageCol]), def.kind, representativeGovId, targetType, idsCsv, billing, cost, endsAt]).lastId;
}
// إنشاء إعلان: تُخصم التكلفة من محفظة المزود (wallet) أو إعلان مجاني من المنصة (free)
// التكلفة = سعر الفترة × عدد المحافظات المستهدفة
function createPromotion({ provider, def, item, durationDays, note = '', user, targetType = 'governorate', governorateIds = [], billing = 'wallet' }) {
    const count = targetCount(targetType, governorateIds);
    const unitCost = billing === 'wallet' ? promotionCost(durationDays) : 0;
    const cost = round2(unitCost * count);
    const endsAt = utcNowPlus(durationDays);
    let promoId;
    if (billing === 'wallet') {
        const w = ensureWallet(provider.id);
        if (Number(w.balance) < cost) {
            throw new ApiError(400, `رصيد المحفظة غير كافٍ لدفع تكلفة الترويج (${cost} دينار). اشحن رصيدك أولاً`);
        }
        promoId = transaction(() => {
            const balanceAfter = round2(Number(w.balance) - cost);
            run("UPDATE provider_wallets SET balance = ?, updated_at = datetime('now') WHERE provider_id = ?", [balanceAfter, provider.id]);
            run('INSERT INTO wallet_transactions (provider_id, type, amount, agent_amount, platform_amount, balance_after, note, created_by) VALUES (?,?,?,?,?,?,?,?)', [provider.id, 'promotion', -cost, 0, cost, balanceAfter, `ترويج: ${item[def.titleCol]}`, note]);
            return insertPromotionRow({ provider, def, item, durationDays, cost, targetType, governorateIds, billing, endsAt });
        });
    }
    else {
        promoId = insertPromotionRow({ provider, def, item, durationDays, cost, targetType, governorateIds, billing, endsAt });
    }
    logActivity(user, 'promotion_create', 'promotion', promoId, { item_id: item.id, cost, days: durationDays, target_type: targetType, billing });
    return get('SELECT * FROM promotions WHERE id = ?', [promoId]);
}
function targetLabel(row, cache) {
    if (row.target_type === 'all')
        return 'كل المحافظات';
    const ids = String(row.target_governorate_ids || row.governorate_id).split(',').map((n) => Number(n)).filter(Boolean);
    if (ids.length <= 1)
        return row.governorate_name_ar;
    return ids.map((id) => cache.get(id) || id).join('، ');
}
function decoratePromotion(row) {
    if (!row)
        return null;
    const p = get('SELECT name_ar FROM providers WHERE id = ?', [row.provider_id]);
    const g = get('SELECT name_ar, code FROM governorates WHERE id = ?', [row.governorate_id]);
    const s = get('SELECT slug, name_ar, icon FROM services WHERE id = ?', [row.service_id]);
    const impressions = Number(row.impressions) || 0;
    const clicks = Number(row.clicks) || 0;
    const targetType = row.target_type || 'governorate';
    return {
        ...row,
        provider_name: p && p.name_ar,
        governorate_name_ar: targetType === 'all' ? 'كل المحافظات' : (g && g.name_ar),
        governorate_code: g && g.code,
        service_slug: s && s.slug,
        service_name_ar: s && s.name_ar,
        service_icon: s && s.icon,
        ctr: impressions > 0 ? round2((clicks / impressions) * 100) : 0,
        remaining_days: row.ends_at ? Math.max(0, Math.ceil((new Date(String(row.ends_at).replace(' ', 'T') + 'Z').getTime() - Date.now()) / 86400000)) : null,
        target_type: targetType,
        target_count: targetType === 'all' ? all('SELECT COUNT(*) AS c FROM governorates').map((r) => Number(r.c))[0] : (row.target_governorate_ids ? String(row.target_governorate_ids).split(',').length : 1),
        billing: row.billing || 'wallet',
    };
}
const router = express.Router();
router.use(authenticate);
// ============ المزود: إدارة ترويجاته ============
router.get('/', requireRole('provider'), (req, res, next) => {
    try {
        const pg = paginate(req, 20);
        const total = get('SELECT COUNT(*) AS c FROM promotions WHERE provider_id = ?', [req.user.provider_id]).c;
        const rows = all('SELECT * FROM promotions WHERE provider_id = ? ORDER BY id DESC LIMIT ? OFFSET ?', [req.user.provider_id, pg.limit, pg.offset]);
        const p = get(`SELECT p.governorate_id, g.name_ar AS governorate_name_ar, w.balance
       FROM providers p JOIN governorates g ON g.id = p.governorate_id
       LEFT JOIN provider_wallets w ON w.provider_id = p.id
       WHERE p.id = ?`, [req.user.provider_id]);
        const activeCount = get('SELECT COUNT(*) AS c FROM promotions WHERE provider_id = ? AND ' + activeClause, [req.user.provider_id]).c;
        const totals = get('SELECT COALESCE(SUM(impressions),0) AS impressions, COALESCE(SUM(clicks),0) AS clicks FROM promotions WHERE provider_id = ?', [req.user.provider_id]);
        const tImp = Number(totals.impressions) || 0;
        return ok(res, rows.map(decoratePromotion), {
            total,
            page: pg.page,
            limit: pg.limit,
            pages: Math.max(1, Math.ceil(total / pg.limit)),
            settings: {
                price: settingValue(PROMO_PRICE_KEY, 5000),
                duration_days: Math.max(1, settingValue(PROMO_DURATION_KEY, 7)),
                max_active: Math.max(1, settingValue(PROMO_MAX_KEY, 3)),
            },
            wallet_balance: round2(p ? p.balance : 0),
            active_count: activeCount,
            impressions: tImp,
            clicks: Number(totals.clicks) || 0,
            ctr: tImp > 0 ? round2((Number(totals.clicks) / tImp) * 100) : 0,
            governorate_name_ar: p ? p.governorate_name_ar : null,
        });
    }
    catch (e) {
        next(e);
    }
});
router.post('/', requireRole('provider'), (req, res, next) => {
    try {
        const { item_type, item_id, duration_days } = req.body || {};
        const def = ITEM_TYPES[item_type];
        if (!def)
            throw new ApiError(400, 'نوع العنصر غير صحيح');
        const provider = get('SELECT p.*, s.slug AS service_slug FROM providers p JOIN services s ON s.id = p.service_id WHERE p.id = ?', [req.user.provider_id]);
        if (def.service !== provider.service_slug)
            throw new ApiError(403, 'نوع العنصر لا يخص نوع خدمتك');
        const duration = Math.max(1, Math.min(90, Number(duration_days) || settingValue(PROMO_DURATION_KEY, 7)));
        const maxActive = Math.max(1, settingValue(PROMO_MAX_KEY, 3));
        const activeCount = get('SELECT COUNT(*) AS c FROM promotions WHERE provider_id = ? AND ' + activeClause, [provider.id]).c;
        if (activeCount >= maxActive) {
            throw new ApiError(400, `وصلت إلى الحد الأقصى من الترويجات النشطة (${maxActive}). أنهِ أحدها أو انتظر انتهاءه`);
        }
        const item = loadItem(def, provider.id, toId(item_id));
        const promo = createPromotion({
            provider, def, item, durationDays: duration,
            note: `ترويج ${provider.name_ar}`, user: req.user,
            targetType: 'governorate', governorateIds: [provider.governorate_id], billing: 'wallet',
        });
        // إشعار متابعي المزود بعرض ترويجي جديد
        const promoLink = def.kind === 'products' || def.kind === 'menu' || def.kind === 'packages'
            ? `/item/${provider.id}/${def.kind}/${item.id}`
            : `/provider/${provider.id}/${def.kind}`;
        notifyProviderFollowers(provider.id, {
            type: 'offer',
            title: `عرض جديد من ${provider.name_ar}`,
            body: `خصم وترويج: ${promo.item_title} بسعر ${promo.item_price} د.ع`,
            url: promoLink,
            icon: '🔥',
        }).catch(() => { });
        return ok(res, decoratePromotion(promo));
    }
    catch (e) {
        next(e);
    }
});
router.post('/:id/extend', requireRole('provider'), (req, res, next) => {
    try {
        const id = toId(req.params.id);
        const row = get('SELECT * FROM promotions WHERE id = ? AND provider_id = ?', [id, req.user.provider_id]);
        if (!row)
            throw new ApiError(404, 'الترويج غير موجود');
        if (row.status !== 'active')
            throw new ApiError(400, 'يمكن تمديد الترويج النشط فقط');
        const def = ITEM_TYPES[row.item_type];
        if (!def)
            throw new ApiError(400, 'نوع العنصر غير مدعوم');
        const provider = get('SELECT * FROM providers WHERE id = ?', [req.user.provider_id]);
        const days = Math.max(1, settingValue(PROMO_DURATION_KEY, 7));
        const isFree = (row.billing || 'wallet') === 'free';
        let cost = 0;
        if (!isFree) {
            cost = promotionCost(days);
            const w = ensureWallet(provider.id);
            if (Number(w.balance) < cost)
                throw new ApiError(400, `رصيد المحفظة غير كافٍ للتمديد (${cost} دينار)`);
            transaction(() => {
                const balanceAfter = round2(Number(w.balance) - cost);
                run("UPDATE provider_wallets SET balance = ?, updated_at = datetime('now') WHERE provider_id = ?", [balanceAfter, provider.id]);
                run('INSERT INTO wallet_transactions (provider_id, type, amount, agent_amount, platform_amount, balance_after, note, created_by) VALUES (?,?,?,?,?,?,?,?)', [provider.id, 'promotion', -cost, 0, cost, balanceAfter, `تمديد ترويج: ${row.item_title}`, req.user.name_ar || req.user.email]);
                run("UPDATE promotions SET ends_at = ?, updated_at = datetime('now') WHERE id = ?", [extendEndsAt(row.ends_at, days), id]);
            });
        }
        else {
            run("UPDATE promotions SET ends_at = ?, updated_at = datetime('now') WHERE id = ?", [extendEndsAt(row.ends_at, days), id]);
        }
        logActivity(req.user, 'promotion_extend', 'promotion', id, { cost, days });
        return ok(res, decoratePromotion(get('SELECT * FROM promotions WHERE id = ?', [id])));
    }
    catch (e) {
        next(e);
    }
});
router.delete('/:id', requireRole('provider', 'admin'), (req, res, next) => {
    try {
        const id = toId(req.params.id);
        const scope = req.user.role === 'admin' ? '1=1' : 'provider_id = ?';
        const params = req.user.role === 'admin' ? [id] : [id, req.user.provider_id];
        const row = get(`SELECT * FROM promotions WHERE id = ? AND ${scope}`, params);
        if (!row)
            throw new ApiError(404, 'الترويج غير موجود');
        run("UPDATE promotions SET status = 'ended', updated_at = datetime('now') WHERE id = ?", [id]);
        logActivity(req.user, 'promotion_end', 'promotion', id, {});
        return ok(res, { id, status: 'ended' });
    }
    catch (e) {
        next(e);
    }
});
// ============ المسؤول: سرد الترويجات (فلاتر + إحصاءات) ============
// GET /api/promotions/admin/items — عناصر مزوّد لإنشاء إعلان (كل الأنواع)
router.get('/admin/items', requireRole('admin'), (req, res, next) => {
    try {
        const providerId = toId(req.query.provider_id);
        const def = ITEM_TYPES[req.query.item_type];
        if (!def)
            throw new ApiError(400, 'نوع العنصر غير صحيح');
        const provider = get('SELECT id FROM providers WHERE id = ?', [providerId]);
        if (!provider)
            throw new ApiError(404, 'مزود الخدمة غير موجود');
        const rows = all(`SELECT id, ${def.titleCol} AS title, ${def.priceCol} AS price, ${def.imageCol ? `${def.imageCol} AS images_json` : 'NULL AS images_json'}
       FROM ${def.table} WHERE provider_id = ? AND is_active = 1 ORDER BY id ASC`, [providerId]);
        return ok(res, rows.map((r) => ({ id: r.id, title: r.title, price: round2(r.price), image: firstImage(r.images_json) })));
    }
    catch (e) {
        next(e);
    }
});
// POST /api/promotions/admin/create — إنشاء إعلان من المسؤول (أي نوع، محافظة/أكثر/كل المحافظات، مجاني/محفظة)
router.post('/admin/create', requireRole('admin'), (req, res, next) => {
    try {
        const { provider_id, item_type, item_id, duration_days, billing } = req.body || {};
        const def = ITEM_TYPES[item_type];
        if (!def)
            throw new ApiError(400, 'نوع العنصر غير صحيح');
        const provider = get('SELECT p.*, s.slug AS service_slug FROM providers p JOIN services s ON s.id = p.service_id WHERE p.id = ?', [toId(provider_id)]);
        if (!provider)
            throw new ApiError(404, 'مزود الخدمة غير موجود');
        if (Number(provider.is_active) !== 1)
            throw new ApiError(400, 'لا يمكن إنشاء إعلان لمزود موقوف');
        const duration = Math.max(1, Math.min(90, Number(duration_days) || settingValue(PROMO_DURATION_KEY, 7)));
        const { targetType, governorateIds } = resolveTargets(req.body);
        const b = billing === 'free' ? 'free' : 'wallet';
        const item = loadItem(def, provider.id, toId(item_id));
        const promo = createPromotion({
            provider, def, item, durationDays: duration,
            note: `إعلان من الإدارة: ${provider.name_ar}`, user: req.user,
            targetType, governorateIds, billing: b,
        });
        return ok(res, decoratePromotion(promo));
    }
    catch (e) {
        next(e);
    }
});
// ============ المسؤول: سرد كل الترويجات (فلاتر + إحصاءات) ============
router.get('/all', requireRole('admin'), (req, res, next) => {
    try {
        const pg = paginate(req, 20);
        const { status, governorate_id, service_id, q } = req.query;
        const where = [];
        const params = [];
        if (status === 'active' || status === 'ended') {
            where.push('pr.status = ?');
            params.push(status);
        }
        if (governorate_id) {
            where.push(`(pr.governorate_id = ? OR pr.target_type = 'all'
        OR (pr.target_type = 'governorate' AND (',' || COALESCE(pr.target_governorate_ids, CAST(pr.governorate_id AS TEXT)) || ',') LIKE '%,' || ? || ',%'))`);
            params.push(Number(governorate_id), String(Number(governorate_id)));
        }
        if (service_id) {
            where.push('pr.service_id = ?');
            params.push(Number(service_id));
        }
        const qq = q ? String(q).trim() : '';
        if (qq) {
            where.push('p.name_ar LIKE ?');
            params.push(`%${qq}%`);
        }
        const whereSql = where.length ? ` WHERE ${where.join(' AND ')}` : '';
        const total = get(`SELECT COUNT(*) AS c FROM promotions pr JOIN providers p ON p.id = pr.provider_id${whereSql}`, params).c;
        const rows = all(`SELECT pr.*, p.name_ar AS provider_name, g.name_ar AS governorate_name_ar, g.code AS governorate_code,
              s.slug AS service_slug, s.name_ar AS service_name_ar, s.icon AS service_icon
       FROM promotions pr
       JOIN providers p ON p.id = pr.provider_id
       JOIN governorates g ON g.id = pr.governorate_id
       JOIN services s ON s.id = pr.service_id
       ${whereSql}
       ORDER BY pr.id DESC LIMIT ? OFFSET ?`, [...params, pg.limit, pg.offset]);
        const stats = {
            total_active: get("SELECT COUNT(*) AS c FROM promotions WHERE status = 'active'").c,
            total_ended: get("SELECT COUNT(*) AS c FROM promotions WHERE status = 'ended'").c,
            active_revenue: round2(get("SELECT COALESCE(SUM(cost),0) AS v FROM promotions WHERE status = 'active'").v),
            total_revenue: round2(get('SELECT COALESCE(SUM(cost),0) AS v FROM promotions').v),
            total_impressions: get('SELECT COALESCE(SUM(impressions),0) AS v FROM promotions').v,
            total_clicks: get('SELECT COALESCE(SUM(clicks),0) AS v FROM promotions').v,
        };
        const imp = Number(stats.total_impressions) || 0;
        stats.total_ctr = imp > 0 ? round2((Number(stats.total_clicks) / imp) * 100) : 0;
        const cache = governorateCache();
        rows.forEach((r) => {
            const ri = Number(r.impressions) || 0;
            r.ctr = ri > 0 ? round2((Number(r.clicks) / ri) * 100) : 0;
            r.target_label = targetLabel(r, cache);
            r.target_count = r.target_type === 'all'
                ? all('SELECT COUNT(*) AS c FROM governorates').map((x) => Number(x.c))[0]
                : (r.target_governorate_ids ? String(r.target_governorate_ids).split(',').length : 1);
            if (r.target_type === 'all')
                r.governorate_name_ar = 'كل المحافظات';
        });
        return ok(res, rows, {
            total,
            page: pg.page,
            limit: pg.limit,
            pages: Math.max(1, Math.ceil(total / pg.limit)),
            ...stats,
            settings: {
                price: settingValue(PROMO_PRICE_KEY, 5000),
                duration_days: Math.max(1, settingValue(PROMO_DURATION_KEY, 7)),
                max_active: Math.max(1, settingValue(PROMO_MAX_KEY, 3)),
            },
        });
    }
    catch (e) {
        next(e);
    }
});
// ============ المسؤول: تصدير الإعلانات CSV (نفس فلاتر القائمة) ============
const EXPORT_BATCH = 500;
const MAX_EXPORT_ROWS = 5000;
router.get('/all/export', requireRole('admin'), (req, res, next) => {
    try {
        const { status, governorate_id, service_id, q } = req.query;
        const where = [];
        const params = [];
        if (status === 'active' || status === 'ended') {
            where.push('pr.status = ?');
            params.push(status);
        }
        if (governorate_id) {
            where.push(`(pr.governorate_id = ? OR pr.target_type = 'all'
        OR (pr.target_type = 'governorate' AND (',' || COALESCE(pr.target_governorate_ids, CAST(pr.governorate_id AS TEXT)) || ',') LIKE '%,' || ? || ',%'))`);
            params.push(Number(governorate_id), String(Number(governorate_id)));
        }
        if (service_id) {
            where.push('pr.service_id = ?');
            params.push(Number(service_id));
        }
        const qq = q ? String(q).trim() : '';
        if (qq) {
            where.push('p.name_ar LIKE ?');
            params.push(`%${qq}%`);
        }
        const whereSql = where.length ? ` WHERE ${where.join(' AND ')}` : '';
        const maxRows = Math.min(Math.max(Number(req.query.limit) || MAX_EXPORT_ROWS, 1), MAX_EXPORT_ROWS);
        const total = get(`SELECT COUNT(*) AS c FROM promotions pr JOIN providers p ON p.id = pr.provider_id${whereSql}`, params).c;
        const cache = governorateCache();
        const headers = ['رقم الإعلان', 'اسم الإعلان', 'المزود', 'الخدمة', 'النطاق/المحافظة', 'السعر', 'التكلفة', 'الحالة', 'الظهور', 'النقرات', 'CTR%', 'البداية', 'النهاية'];
        const rowToLine = (r) => [
            r.id,
            r.item_title,
            r.provider_name,
            r.service_name_ar,
            r.target_label,
            r.item_price,
            r.cost,
            r.status,
            r.impressions,
            r.clicks,
            r.ctr,
            r.starts_at,
            r.ends_at,
        ].map(csvEscape).join(',');
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="promotions-${Date.now()}.csv"`);
        res.write('\uFEFF' + headers.map(csvEscape).join(',') + '\r\n');
        const pages = Math.ceil(Math.min(total, maxRows) / EXPORT_BATCH);
        let emitted = 0;
        for (let page = 0; page < pages; page++) {
            const rows = all(`SELECT pr.*, p.name_ar AS provider_name, g.name_ar AS governorate_name_ar,
                s.name_ar AS service_name_ar
         FROM promotions pr
         JOIN providers p ON p.id = pr.provider_id
         JOIN governorates g ON g.id = pr.governorate_id
         JOIN services s ON s.id = pr.service_id
         ${whereSql}
         ORDER BY pr.id DESC LIMIT ? OFFSET ?`, [...params, EXPORT_BATCH, page * EXPORT_BATCH]);
            for (const r of rows) {
                if (emitted >= maxRows)
                    break;
                const ri = Number(r.impressions) || 0;
                res.write(rowToLine({ ...r, ctr: ri > 0 ? round2((Number(r.clicks) / ri) * 100) : 0, target_label: targetLabel(r, cache) }) + '\r\n');
                emitted++;
            }
        }
        if (emitted < total) {
            res.write(csvEscape(`... اقتُطع التصدير عند ${emitted} صف من أصل ${total} — أضف فلاتر أو زد ?limit (الحد الأقصى ${MAX_EXPORT_ROWS})`) + '\r\n');
        }
        return res.end();
    }
    catch (e) {
        next(e);
    }
});
const publicRouter = express.Router();
// حدود مخففة للعدّادات العامة: تمنع البرمجة النصية من تضخيم الظهور/النقرات مع السماح بالاستخدام العادي
const impressionsLimiter = createRateLimiter({ windowMs: 60000, max: 120, message: 'طلبات كثيرة، يرجى المحاولة بعد قليل' });
const clicksLimiter = createRateLimiter({ windowMs: 60000, max: 30, message: 'نقرات كثيرة، يرجى المحاولة بعد قليل' });
publicRouter.get('/', impressionsLimiter, (req, res, next) => {
    try {
        const { governorate_code, governorate_id } = req.query;
        const limit = Math.min(30, Math.max(1, Number(req.query.limit) || 10));
        let sql = `SELECT pr.*, p.name_ar AS provider_name, g.code AS governorate_code,
                      s.slug AS service_slug, s.name_ar AS service_name_ar, s.icon AS service_icon
               FROM promotions pr
               JOIN providers p ON p.id = pr.provider_id
               LEFT JOIN governorates g ON g.id = pr.governorate_id
               JOIN services s ON s.id = pr.service_id
               WHERE pr.status = 'active' AND (pr.ends_at IS NULL OR pr.ends_at > datetime('now'))`;
        const params = [];
        let govId = null;
        if (governorate_code) {
            const g = get('SELECT id FROM governorates WHERE code = ?', [String(governorate_code).toUpperCase()]);
            govId = g && g.id;
        }
        else if (governorate_id) {
            govId = Number(governorate_id) || null;
        }
        if (govId) {
            sql += ` AND (pr.target_type = 'all'
        OR (pr.target_type = 'governorate' AND (',' || COALESCE(pr.target_governorate_ids, CAST(pr.governorate_id AS TEXT)) || ',') LIKE '%,' || ? || ',%'))`;
            params.push(String(govId));
        }
        sql += ' ORDER BY pr.id DESC LIMIT ?';
        params.push(limit);
        const rows = all(sql, params);
        for (const r of rows)
            run('UPDATE promotions SET impressions = impressions + 1 WHERE id = ?', [r.id]);
        return ok(res, rows);
    }
    catch (e) {
        next(e);
    }
});
publicRouter.post('/:id/click', clicksLimiter, (req, res, next) => {
    try {
        const id = toId(req.params.id);
        // لا نُعدّ النقرة إلا على ترويج قائم ونشط (منع تضخيم عدّادات لعناصر عشوائية/منتهية)
        const promo = get('SELECT id FROM promotions WHERE id = ? AND ' + activeClause, [id]);
        if (!promo)
            throw new ApiError(404, 'الترويج غير موجود أو غير نشط');
        run('UPDATE promotions SET clicks = clicks + 1, updated_at = datetime(\'now\') WHERE id = ?', [id]);
        return ok(res, { id });
    }
    catch (e) {
        next(e);
    }
});
module.exports = { router, publicRouter };
