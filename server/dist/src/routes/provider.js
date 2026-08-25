"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express = require('express');
const { get, all, run, transaction } = require('../db');
const { ApiError, toId, round2, paginate, assertLength, settingValue, parseImages, parseIncludes } = require('../utils/helpers');
const { ok, created } = require('../utils/response');
const { authenticate } = require('../middleware/auth');
const { requireRole } = require('../middleware/rbac');
const { logActivity } = require('../utils/log');
const { deleteUploadValue, deleteRemovedImages, saveBase64ToUpload } = require('../utils/uploads');
const { notifyProviderFollowers, notifyRole } = require('../utils/push');
const router = express.Router();
router.use(authenticate, requireRole('provider'));
// حدّ المخزون المنخفض الذي يعتبر إنذاراً للمتاجر
const LOW_STOCK_THRESHOLD = 5;
// يرفق بيانات حساب المزود الحالي بكل الطلبات
router.use((req, res, next) => {
    try {
        const p = get(`SELECT p.*, s.slug AS service_slug, s.name_ar AS service_name_ar, s.icon AS service_icon,
              g.name_ar AS governorate_name_ar, g.code AS governorate_code
       FROM providers p
       JOIN services s ON s.id = p.service_id
       JOIN governorates g ON g.id = p.governorate_id
       WHERE p.id = ?`, [req.user.provider_id]);
        if (!p)
            throw new ApiError(403, 'حساب مزود الخدمة غير مكتمل');
        if (!p.is_active)
            throw new ApiError(403, 'حساب مزود الخدمة موقوف، تواصل مع المسؤول');
        req.provider = p;
        next();
    }
    catch (e) {
        next(e);
    }
});
const CATALOG_TABLES = {
    stores: 'products',
    restaurants: 'menu_items',
    hotels: 'hotel_rooms',
    flights: 'flights',
    travel_offices: 'travel_packages',
};
// أسماء العناصر وروابطها العميقة (لإشعارات المتابعين عند نشر عنصر جديد)
const ENTITY_LABEL = {
    products: 'منتج',
    menu_items: 'صنف',
    hotel_rooms: 'غرفة',
    flights: 'رحلة',
    travel_packages: 'باقة',
};
const ITEM_LINK = {
    products: (p, i) => `/item/${p}/products/${i}`,
    menu_items: (p, i) => `/item/${p}/menu/${i}`,
    hotel_rooms: (p) => `/provider/${p}/rooms`,
    flights: (p) => `/provider/${p}/flights`,
    travel_packages: (p, i) => `/item/${p}/packages/${i}`,
};
// ============ مولّد فهرس (CRUD) عام لكل أقسام الكتالوج ============
function catalogModule({ service, table, entity, cols, listSelect = '', searchCols = [], filters = [], idPrefix = '' }) {
    const r = express.Router();
    const requiredCols = cols.filter((c) => c.required);
    r.use((req, res, next) => {
        if (req.provider.service_slug !== service) {
            return next(new ApiError(403, 'هذا القسم غير متاح لنوع خدمتك'));
        }
        next();
    });
    function normalize(c, v) {
        if (v === undefined || v === null || v === '')
            return null;
        if (c.type === 'bool') {
            if (typeof v === 'boolean')
                return v ? 1 : 0;
            const s = String(v).toLowerCase();
            return s === '1' || s === 'true' ? 1 : 0;
        }
        if (c.type === 'json')
            return JSON.stringify(Array.isArray(v) ? v : []);
        if (c.type === 'int') {
            const n = Math.round(Number(v) || 0);
            if (n < 0)
                throw new ApiError(400, `${c.label} يجب أن يكون رقماً غير سالب`);
            return n;
        }
        if (c.type === 'real') {
            const n = Number(v) || 0;
            if (n < 0)
                throw new ApiError(400, `${c.label} يجب أن يكون رقماً غير سالب`);
            return n;
        }
        if (c.type === 'date') {
            const d = v ? new Date(v) : null;
            return d && !Number.isNaN(d.getTime()) ? d.toISOString() : null;
        }
        return String(v);
    }
    function applyFilters(req, baseSql, baseParams) {
        let sql = baseSql;
        const params = [...baseParams];
        for (const f of filters) {
            if (req.query[f.key] === undefined)
                continue;
            const built = f.build ? f.build(req.query[f.key], req) : null;
            if (typeof built === 'string') {
                sql += ' AND ' + built;
            }
            else if (built) {
                sql += ' AND ' + built.sql;
                params.push(...built.params);
            }
        }
        return { sql, params };
    }
    // قائمة العناصر
    r.get('/', (req, res, next) => {
        try {
            const pid = req.provider.id;
            let sql = listSelect || `SELECT * FROM ${table} WHERE provider_id = ?`;
            const params = [pid];
            if (req.query.q && searchCols.length) {
                const ors = searchCols.map((c) => `${c} LIKE ?`).join(' OR ');
                sql += ' AND (' + ors + ')';
                searchCols.forEach(() => params.push(`%${req.query.q}%`));
            }
            const { sql: fsql, params: fparams } = applyFilters(req, sql, params);
            const pg = paginate(req, 50);
            const total = get(`SELECT COUNT(*) AS c FROM (${fsql})`, fparams).c;
            const rows = all(fsql + ' ORDER BY ' + idPrefix + 'id DESC LIMIT ? OFFSET ?', [...fparams, pg.limit, pg.offset]);
            return ok(res, rows.map((row) => ({ ...row, images: parseImages(row.images_json), includes: parseIncludes(row.includes_json) })), { total, page: pg.page, limit: pg.limit, pages: Math.max(1, Math.ceil(total / pg.limit)) });
        }
        catch (e) {
            next(e);
        }
    });
    // عدد العناصر
    r.get('/count', (req, res, next) => {
        try {
            const c = get(`SELECT COUNT(*) AS c FROM ${table} WHERE provider_id = ?`, [req.provider.id]).c;
            return ok(res, { count: c });
        }
        catch (e) {
            next(e);
        }
    });
    // إنشاء عنصر
    r.post('/', (req, res, next) => {
        try {
            const body = req.body || {};
            for (const c of requiredCols) {
                if (body[c.name] === undefined || body[c.name] === null || body[c.name] === '') {
                    throw new ApiError(400, `يرجى ملء الحقل المطلوب: ${c.label}`);
                }
            }
            const provided = cols.filter((c) => body[c.name] !== undefined && body[c.name] !== null && body[c.name] !== '');
            const colNames = ['provider_id', ...provided.map((c) => c.name)];
            const values = [req.provider.id, ...provided.map((c) => normalize(c, body[c.name]))];
            const id = run(`INSERT INTO ${table} (${colNames.join(',')}) VALUES (${colNames.map(() => '?').join(',')})`, values).lastId;
            logActivity(req.user, 'create', entity, id, { provider_id: req.provider.id });
            // إشعار المتابعين عند نشر عنصر جديد (منتج/صنف/غرفة/رحلة/باقة) مفعّل
            const createdRow = get(`SELECT * FROM ${table} WHERE id = ?`, [id]);
            if (createdRow && Number(createdRow.is_active) === 1) {
                notifyProviderFollowers(req.provider.id, {
                    type: 'offer',
                    title: `جديد من ${req.provider.name_ar}`,
                    body: `تم نشر ${ENTITY_LABEL[table]}: ${createdRow.name_ar || createdRow.flight_number || createdRow.name_en || id}`,
                    url: (ITEM_LINK[table] || ITEM_LINK.products)(req.provider.id, id),
                    icon: '🛍️',
                }).catch(() => { });
            }
            return created(res, createdRow || get(`SELECT * FROM ${table} WHERE id = ?`, [id]));
        }
        catch (e) {
            next(e);
        }
    });
    // عنصر واحد
    r.get('/:id', (req, res, next) => {
        try {
            const id = toId(req.params.id);
            const row = get(`SELECT * FROM ${table} WHERE id = ? AND provider_id = ?`, [id, req.provider.id]);
            if (!row)
                throw new ApiError(404, `ال${entity} غير موجود`);
            return ok(res, row);
        }
        catch (e) {
            next(e);
        }
    });
    // تعديل عنصر
    r.put('/:id', (req, res, next) => {
        try {
            const id = toId(req.params.id);
            const row = get(`SELECT * FROM ${table} WHERE id = ? AND provider_id = ?`, [id, req.provider.id]);
            if (!row)
                throw new ApiError(404, `ال${entity} غير موجود`);
            const body = req.body || {};
            const sets = [];
            const params = [];
            for (const c of cols) {
                if (body[c.name] === undefined || body[c.name] === '')
                    continue;
                sets.push(`${c.name} = ?`);
                params.push(normalize(c, body[c.name]));
            }
            sets.push("updated_at = datetime('now')");
            params.push(id, req.provider.id);
            run(`UPDATE ${table} SET ${sets.join(', ')} WHERE id = ? AND provider_id = ?`, params);
            // حذف الصور القديمة التي استُبدلت (تُزال ملفاتها من data/uploads)
            const fresh = get(`SELECT * FROM ${table} WHERE id = ?`, [id]);
            deleteRemovedImages(row.images_json, fresh.images_json);
            logActivity(req.user, 'update', entity, id, { provider_id: req.provider.id });
            return ok(res, fresh);
        }
        catch (e) {
            next(e);
        }
    });
    // حذف عنصر
    r.delete('/:id', (req, res, next) => {
        try {
            const id = toId(req.params.id);
            const row = get(`SELECT * FROM ${table} WHERE id = ? AND provider_id = ?`, [id, req.provider.id]);
            if (!row)
                throw new ApiError(404, `ال${entity} غير موجود`);
            run(`DELETE FROM ${table} WHERE id = ? AND provider_id = ?`, [id, req.provider.id]);
            deleteUploadValue(row.images_json);
            logActivity(req.user, 'delete', entity, id, { provider_id: req.provider.id });
            return ok(res, { message: `تم حذف ال${entity} بنجاح` });
        }
        catch (e) {
            next(e);
        }
    });
    // تفعيل/إيقاف
    r.post('/:id/toggle', (req, res, next) => {
        try {
            const id = toId(req.params.id);
            const row = get(`SELECT * FROM ${table} WHERE id = ? AND provider_id = ?`, [id, req.provider.id]);
            if (!row)
                throw new ApiError(404, `ال${entity} غير موجود`);
            const nextState = row.is_active ? 0 : 1;
            run(`UPDATE ${table} SET is_active = ?, updated_at = datetime('now') WHERE id = ? AND provider_id = ?`, [nextState, id, req.provider.id]);
            logActivity(req.user, nextState ? 'activate' : 'deactivate', entity, id);
            return ok(res, get(`SELECT * FROM ${table} WHERE id = ?`, [id]));
        }
        catch (e) {
            next(e);
        }
    });
    return r;
}
const CATEGORY_COLS = [
    { name: 'name_ar', label: 'الاسم بالعربية', required: true, type: 'text' },
    { name: 'name_en', label: 'الاسم بالإنجليزية', type: 'text' },
    { name: 'icon', label: 'أيقونة', type: 'text' },
    { name: 'sort_order', label: 'الترتيب', type: 'int' },
    { name: 'is_active', label: 'مفعل', type: 'bool' },
];
const PRODUCT_COLS = [
    { name: 'name_ar', label: 'اسم المنتج', required: true, type: 'text' },
    { name: 'name_en', label: 'الاسم بالإنجليزية', type: 'text' },
    { name: 'category_id', label: 'القسم', type: 'int' },
    { name: 'description', label: 'الوصف', type: 'text' },
    { name: 'price', label: 'السعر (دينار)', required: true, type: 'real' },
    { name: 'old_price', label: 'السعر قبل الخصم', type: 'real' },
    { name: 'images_json', label: 'روابط الصور', type: 'json' },
    { name: 'stock', label: 'المخزون', type: 'int' },
    { name: 'is_active', label: 'متوفر', type: 'bool' },
    { name: 'is_featured', label: 'عرض مميز', type: 'bool' },
];
const MENU_ITEM_COLS = [
    { name: 'name_ar', label: 'اسم الصنف', required: true, type: 'text' },
    { name: 'name_en', label: 'الاسم بالإنجليزية', type: 'text' },
    { name: 'category_id', label: 'القسم', type: 'int' },
    { name: 'description', label: 'الوصف', type: 'text' },
    { name: 'price', label: 'السعر (دينار)', required: true, type: 'real' },
    { name: 'images_json', label: 'روابط الصور', type: 'json' },
    { name: 'is_active', label: 'مفعل', type: 'bool' },
    { name: 'is_featured', label: 'مميز', type: 'bool' },
    { name: 'is_available', label: 'متوفر الآن', type: 'bool' },
];
const ROOM_COLS = [
    { name: 'name_ar', label: 'اسم الغرفة', required: true, type: 'text' },
    { name: 'name_en', label: 'الاسم بالإنجليزية', type: 'text' },
    { name: 'room_type', label: 'نوع الغرفة', type: 'text' },
    { name: 'description', label: 'الوصف', type: 'text' },
    { name: 'price_per_night', label: 'السعر لليلة (دينار)', required: true, type: 'real' },
    { name: 'max_guests', label: 'الحد الأقصى للنزلاء', type: 'int' },
    { name: 'images_json', label: 'روابط الصور', type: 'json' },
    { name: 'is_featured', label: 'عرض مميز', type: 'bool' },
    { name: 'is_active', label: 'مفعل', type: 'bool' },
];
const FLIGHT_COLS = [
    { name: 'flight_number', label: 'رقم الرحلة', type: 'text' },
    { name: 'airline', label: 'شركة الطيران', type: 'text' },
    { name: 'origin', label: 'المغادرة (رمز)', type: 'text' },
    { name: 'origin_ar', label: 'مدينة المغادرة', type: 'text' },
    { name: 'destination', label: 'الوصول (رمز)', type: 'text' },
    { name: 'destination_ar', label: 'مدينة الوصول', type: 'text' },
    { name: 'departure_at', label: 'موعد الإقلاع', required: true, type: 'date' },
    { name: 'arrival_at', label: 'موعد الوصول', type: 'date' },
    { name: 'price', label: 'سعر التذكرة (دينار)', required: true, type: 'real' },
    { name: 'seats', label: 'المقاعد المتاحة', type: 'int' },
    { name: 'is_featured', label: 'عرض مميز', type: 'bool' },
    { name: 'is_active', label: 'مفعل', type: 'bool' },
];
const PACKAGE_COLS = [
    { name: 'name_ar', label: 'اسم الباقة', required: true, type: 'text' },
    { name: 'name_en', label: 'الاسم بالإنجليزية', type: 'text' },
    { name: 'destination', label: 'الوجهة', type: 'text' },
    { name: 'description', label: 'الوصف', type: 'text' },
    { name: 'duration_days', label: 'عدد الأيام', type: 'int' },
    { name: 'price', label: 'السعر (دينار)', required: true, type: 'real' },
    { name: 'includes_json', label: 'ماذا تشمل الباقة', type: 'json' },
    { name: 'images_json', label: 'روابط الصور', type: 'json' },
    { name: 'is_featured', label: 'عرض مميز', type: 'bool' },
    { name: 'is_active', label: 'مفعل', type: 'bool' },
];
// ===================== أقسام الفهرس حسب نوع الخدمة =====================
router.use('/product-categories', catalogModule({
    service: 'stores',
    table: 'product_categories',
    entity: 'قسم',
    cols: CATEGORY_COLS,
}));
router.use('/products', catalogModule({
    service: 'stores',
    table: 'products',
    entity: 'منتج',
    cols: PRODUCT_COLS,
    listSelect: 'SELECT p.*, pc.name_ar AS category_name FROM products p LEFT JOIN product_categories pc ON pc.id = p.category_id WHERE p.provider_id = ?',
    searchCols: ['p.name_ar', 'p.name_en'],
    idPrefix: 'p.',
    filters: [
        { key: 'offers', build: () => '(p.is_featured = 1 OR (p.old_price IS NOT NULL AND p.old_price > p.price))' },
        { key: 'category_id', build: (v) => ({ sql: 'p.category_id = ?', params: [Number(v)] }) },
    ],
}));
router.use('/menu-categories', catalogModule({
    service: 'restaurants',
    table: 'menu_categories',
    entity: 'قسم',
    cols: CATEGORY_COLS,
}));
router.use('/menu-items', catalogModule({
    service: 'restaurants',
    table: 'menu_items',
    entity: 'صنف',
    cols: MENU_ITEM_COLS,
    listSelect: 'SELECT m.*, mc.name_ar AS category_name FROM menu_items m LEFT JOIN menu_categories mc ON mc.id = m.category_id WHERE m.provider_id = ?',
    searchCols: ['m.name_ar', 'm.name_en'],
    idPrefix: 'm.',
    filters: [
        { key: 'category_id', build: (v) => ({ sql: 'm.category_id = ?', params: [Number(v)] }) },
        { key: 'available', build: (v) => ({ sql: 'm.is_available = ?', params: [Number(v) ? 1 : 0] }) },
        { key: 'offers', build: () => 'm.is_featured = 1' },
    ],
}));
router.use('/rooms', catalogModule({
    service: 'hotels',
    table: 'hotel_rooms',
    entity: 'غرفة',
    cols: ROOM_COLS,
    searchCols: ['name_ar', 'name_en'],
    filters: [
        { key: 'offers', build: () => 'is_featured = 1' },
    ],
}));
router.use('/flights', catalogModule({
    service: 'flights',
    table: 'flights',
    entity: 'رحلة',
    cols: FLIGHT_COLS,
    searchCols: ['flight_number', 'origin', 'destination', 'origin_ar', 'destination_ar', 'airline'],
    filters: [
        { key: 'offers', build: () => 'is_featured = 1' },
    ],
}));
router.use('/packages', catalogModule({
    service: 'travel_offices',
    table: 'travel_packages',
    entity: 'باقة',
    cols: PACKAGE_COLS,
    searchCols: ['name_ar', 'name_en', 'destination'],
    filters: [
        { key: 'offers', build: () => 'is_featured = 1' },
    ],
}));
// ===================== صافي إيراد كل عنصر في كتالوج المزود =====================
// يُوزع provider_amount (المبلغ الصافي بعد خصم عمولة المنصة والوكيل) على بنود الطلب
// بنسبة خطوط كل طلب — يعطي "صافي إيرادك" لكل منتج/صنف/غرفة/رحلة/باقة.
const ORDER_KIND = { products: 'products', menu_items: 'menu', hotel_rooms: 'rooms', flights: 'flights', travel_packages: 'packages' };
router.get('/catalog-net', (req, res, next) => {
    try {
        const table = CATALOG_TABLES[req.provider.service_slug];
        if (!table)
            throw new ApiError(404, 'لا يوجد كتالوج لهذه الخدمة');
        const orders = all(`SELECT id, total_amount, provider_amount, items_json FROM orders
       WHERE provider_id = ? AND status != 'cancelled'`, [req.provider.id]);
        const kind = ORDER_KIND[table];
        const net = {};
        for (const o of orders) {
            let items = [];
            try {
                items = JSON.parse(o.items_json || '[]');
            }
            catch (e) {
                items = [];
            }
            const total = Number(o.total_amount) || 0;
            const prov = Number(o.provider_amount) || 0;
            if (total <= 0)
                continue;
            for (const it of items) {
                if (!it || !Number(it.item_id) || !Number(it.total) || it.kind !== kind)
                    continue;
                const key = String(it.item_id);
                net[key] = round2((net[key] || 0) + (prov * Number(it.total)) / total);
            }
        }
        return ok(res, net);
    }
    catch (e) {
        next(e);
    }
});
// ===================== لوحة معلومات المزود =====================
router.get('/dashboard', (req, res, next) => {
    try {
        const p = req.provider;
        const pid = p.id;
        const table = CATALOG_TABLES[p.service_slug];
        const catalogCount = table ? get(`SELECT COUNT(*) AS c FROM ${table} WHERE provider_id = ?`, [pid]).c : 0;
        const orders = get(`SELECT COUNT(*) AS c,
              COALESCE(SUM(total_amount),0) AS value,
              COALESCE(SUM(provider_amount),0) AS revenue,
              COALESCE(SUM(commission_amount),0) AS commission
       FROM orders WHERE provider_id = ? AND status != 'cancelled'`, [pid]);
        const byStatus = all('SELECT status, COUNT(*) AS count FROM orders WHERE provider_id = ? GROUP BY status', [pid]);
        const monthly = all(`SELECT strftime('%Y-%m', created_at) AS month, COUNT(*) AS orders_count,
              COALESCE(SUM(provider_amount),0) AS revenue
       FROM orders WHERE provider_id = ? AND status != 'cancelled'
       GROUP BY month ORDER BY month DESC LIMIT 6`, [pid]);
        const recent = all(`SELECT o.id, o.order_number, o.status, o.total_amount, o.provider_amount, o.commission_amount, o.created_at, o.customer_name
       FROM orders o WHERE o.provider_id = ? ORDER BY o.id DESC LIMIT 10`, [pid]);
        const promoActive = get(`SELECT COUNT(*) AS c FROM promotions WHERE provider_id = ? AND status = 'active' AND (ends_at IS NULL OR ends_at > datetime('now'))`, [pid]).c;
        const promoStats = get(`SELECT COALESCE(SUM(impressions),0) AS impressions, COALESCE(SUM(clicks),0) AS clicks
       FROM promotions WHERE provider_id = ? AND status = 'active'`, [pid]);
        const promoImpressions = promoStats ? Number(promoStats.impressions) : 0;
        const promoClicks = promoStats ? Number(promoStats.clicks) : 0;
        // ===== تنبيهات خاصة بنوع الخدمة =====
        const type_alerts = {};
        const nowIso = new Date().toISOString();
        const in7d = new Date(Date.now() + 7 * 86400000).toISOString();
        switch (p.service_slug) {
            case 'stores':
                type_alerts.out_of_stock = get(`SELECT COUNT(*) AS c FROM products WHERE provider_id = ? AND is_active = 1 AND stock <= 0`, [pid]).c;
                type_alerts.low_stock = get(`SELECT COUNT(*) AS c FROM products WHERE provider_id = ? AND is_active = 1 AND stock > 0 AND stock <= ?`, [pid, LOW_STOCK_THRESHOLD]).c;
                break;
            case 'restaurants':
                type_alerts.unavailable = get(`SELECT COUNT(*) AS c FROM menu_items WHERE provider_id = ? AND is_active = 1 AND is_available = 0`, [pid]).c;
                break;
            case 'hotels':
            case 'flights':
            case 'travel_offices':
                type_alerts.upcoming = get(`SELECT COUNT(*) AS c FROM bookings b JOIN orders o ON o.id = b.order_id
           WHERE b.provider_id = ? AND o.status IN ('confirmed','in_progress')
             AND b.booking_date IS NOT NULL
             AND date(b.booking_date) >= date(?) AND date(b.booking_date) <= date(?)`, [pid, nowIso, in7d]).c;
                break;
            default:
                break;
        }
        return ok(res, {
            provider: {
                id: p.id,
                name_ar: p.name_ar,
                name_en: p.name_en,
                logo: p.logo,
                cover: p.cover,
                service_slug: p.service_slug,
                service_name_ar: p.service_name_ar,
                service_icon: p.service_icon,
                governorate_name_ar: p.governorate_name_ar,
                governorate_code: p.governorate_code,
                commission_rate: p.commission_rate,
                is_verified: p.is_verified,
                is_active: p.is_active,
                rating: p.rating,
                rating_count: p.rating_count,
            },
            catalog_count: catalogCount,
            orders_count: orders.c,
            orders_value: round2(orders.value),
            revenue: round2(orders.revenue),
            commission: round2(orders.commission),
            orders_by_status: byStatus,
            monthly,
            recent_orders: recent,
            promotions: {
                active_count: promoActive,
                impressions: promoImpressions,
                clicks: promoClicks,
                ctr: promoImpressions > 0 ? round2((promoClicks / promoImpressions) * 100) : 0,
            },
            type_alerts,
        });
    }
    catch (e) {
        next(e);
    }
});
// ===================== الملف الشخصي =====================
router.get('/profile', (req, res, next) => {
    try {
        const p = req.provider;
        const user = get('SELECT id, name_ar, name_en, email, phone, avatar, totp_enabled FROM users WHERE id = ?', [p.user_id]);
        return ok(res, {
            provider: {
                id: p.id,
                name_ar: p.name_ar,
                name_en: p.name_en,
                logo: p.logo,
                cover: p.cover,
                description: p.description,
                address: p.address,
                phone: p.phone,
                website: p.website,
                service_name_ar: p.service_name_ar,
                governorate_name_ar: p.governorate_name_ar,
                commission_rate: p.commission_rate,
                is_verified: p.is_verified,
                rating: p.rating,
                rating_count: p.rating_count,
            },
            user,
        });
    }
    catch (e) {
        next(e);
    }
});
router.put('/profile', (req, res, next) => {
    try {
        const p = req.provider;
        const user = get('SELECT * FROM users WHERE id = ?', [p.user_id]);
        const { name_ar, name_en, email, phone, description, address, website, logo, cover, avatar, } = req.body || {};
        if (name_ar !== undefined && name_ar !== '')
            assertLength(name_ar, 100, 'الاسم');
        if (name_en !== undefined && name_en !== '')
            assertLength(name_en, 100, 'الاسم اللاتيني');
        if (avatar !== undefined && avatar !== '')
            assertLength(avatar, 500, 'الصورة الرمزية');
        if (description !== undefined && description !== '')
            assertLength(description, 3000, 'الوصف');
        if (address !== undefined && address !== '')
            assertLength(address, 500, 'العنوان');
        if (website !== undefined && website !== '')
            assertLength(website, 500, 'الموقع');
        if (website !== undefined && website !== null && website !== '' && !/^https?:\/\//i.test(String(website))) {
            throw new ApiError(400, 'رابط الموقع يجب أن يبدأ بـ http:// أو https://');
        }
        if (email) {
            const dup = get('SELECT id FROM users WHERE email = ? AND id != ?', [String(email).toLowerCase(), user.id]);
            if (dup)
                throw new ApiError(409, 'البريد مستخدم مسبقاً');
        }
        if (phone !== undefined && phone) {
            const dup = get('SELECT id FROM users WHERE phone = ? AND id != ?', [phone, user.id]);
            if (dup)
                throw new ApiError(409, 'رقم الهاتف مستخدم مسبقاً');
        }
        const newLogo = logo !== undefined ? logo : p.logo;
        const newCover = cover !== undefined ? cover : p.cover;
        const newAvatar = avatar !== undefined ? avatar : user.avatar;
        transaction(() => {
            run(`UPDATE users SET name_ar = ?, name_en = ?, email = ?, phone = ?, avatar = ?, updated_at = datetime('now') WHERE id = ?`, [
                name_ar !== undefined ? name_ar : user.name_ar,
                name_en !== undefined ? name_en : user.name_en,
                email !== undefined ? String(email).toLowerCase() : user.email,
                phone !== undefined ? phone : user.phone,
                newAvatar,
                user.id,
            ]);
            run(`UPDATE providers SET name_ar = ?, name_en = ?, description = ?, address = ?, phone = ?,
          website = ?, logo = ?, cover = ?, updated_at = datetime('now') WHERE id = ?`, [
                name_ar !== undefined ? name_ar : p.name_ar,
                name_en !== undefined ? name_en : p.name_en,
                description !== undefined ? description : p.description,
                address !== undefined ? address : p.address,
                phone !== undefined ? phone : p.phone,
                website !== undefined ? website : p.website,
                newLogo,
                newCover,
                p.id,
            ]);
        });
        // حذف الصور القديمة المستبدَلة (يُحتفظ بالملف إن ما زال مستخدماً في أيٍّ من الحقول الثلاثة)
        deleteRemovedImages([p.logo, p.cover, user.avatar].join(','), [newLogo, newCover, newAvatar].join(','));
        logActivity(req.user, 'update', 'provider', p.id, { profile: true });
        return ok(res, get('SELECT * FROM providers WHERE id = ?', [p.id]));
    }
    catch (e) {
        next(e);
    }
});
// ===================== الحجوزات (فنادق / طيران / مكاتب سفر) =====================
router.get('/bookings', (req, res, next) => {
    try {
        const pid = req.provider.id;
        const pg = paginate(req, 50);
        const total = get('SELECT COUNT(*) AS c FROM orders WHERE provider_id = ?', [pid]).c;
        const rows = all(`SELECT o.*, b.id AS booking_id, b.booking_type, b.booking_date, b.check_in, b.check_out,
              b.guests, b.details_json AS booking_details
       FROM orders o LEFT JOIN bookings b ON b.order_id = o.id
       WHERE o.provider_id = ?
       ORDER BY o.id DESC
       LIMIT ? OFFSET ?`, [pid, pg.limit, pg.offset]);
        return ok(res, rows, { total, page: pg.page, limit: pg.limit, pages: Math.max(1, Math.ceil(total / pg.limit)) });
    }
    catch (e) {
        next(e);
    }
});
// ===================== ملخص إشعارات المزود (طلبات جديدة) =====================
router.get('/orders-summary', (req, res, next) => {
    try {
        const pid = req.provider.id;
        const pending = get("SELECT COUNT(*) AS c FROM orders WHERE provider_id = ? AND status = 'pending'", [pid]).c;
        return ok(res, { pending });
    }
    catch (e) {
        next(e);
    }
});
// ===================== توفر غرف الفندق حسب التاريخ =====================
router.get('/rooms/availability', (req, res, next) => {
    try {
        if (req.provider.service_slug !== 'hotels')
            throw new ApiError(403, 'متاح للفنادق فقط');
        const pid = req.provider.id;
        const from = req.query.from ? String(req.query.from) : null;
        const to = req.query.to ? String(req.query.to) : null;
        const rooms = all('SELECT id, name_ar, room_type, price_per_night, max_guests FROM hotel_rooms WHERE provider_id = ? AND is_active = 1 ORDER BY id ASC', [pid]);
        const ranges = all(`SELECT b.check_in, b.check_out, o.order_number, o.status, o.items_json
       FROM bookings b JOIN orders o ON o.id = b.order_id
       WHERE b.provider_id = ? AND o.status IN ('confirmed','in_progress')
         AND b.check_in IS NOT NULL AND b.check_out IS NOT NULL`, [pid]);
        const rows = rooms.map((room) => {
            const booked = ranges.filter((b) => {
                try {
                    return String(b.items_json).includes(`"item_id":${room.id},`);
                }
                catch (e) {
                    return false;
                }
            });
            const is_available = from && to
                ? !booked.some((b) => String(b.check_in) < to && String(b.check_out) > from)
                : null;
            return {
                ...room,
                booked_ranges: booked.map(({ check_in, check_out, order_number, status }) => ({ check_in, check_out, order_number, status })),
                is_available,
            };
        });
        return ok(res, rows);
    }
    catch (e) {
        next(e);
    }
});
// ===================== تقييمات ومراجعات المزود =====================
router.get('/ratings', (req, res, next) => {
    try {
        const pid = req.provider.id;
        const summary = get(`SELECT COUNT(*) AS count, COALESCE(SUM(rating),0) AS total,
              COALESCE(AVG(rating),0) AS avg
       FROM provider_ratings WHERE provider_id = ?`, [pid]);
        const pg = paginate(req, 20);
        const rows = all(`SELECT pr.*, u.name_ar AS customer_name, u.avatar AS customer_avatar,
              o.order_number, o.created_at AS order_date
       FROM provider_ratings pr
       LEFT JOIN users u ON u.id = pr.customer_id
       LEFT JOIN orders o ON o.id = pr.order_id
       WHERE pr.provider_id = ?
       ORDER BY pr.id DESC
       LIMIT ? OFFSET ?`, [pid, pg.limit, pg.offset]);
        return ok(res, rows, {
            total: summary.count,
            rating: summary.count > 0 ? Math.round((Number(summary.total) / Number(summary.count)) * 10) / 10 : 0,
            rating_count: summary.count,
            page: pg.page,
            limit: pg.limit,
            pages: Math.max(1, Math.ceil(summary.count / pg.limit)),
        });
    }
    catch (e) {
        next(e);
    }
});
// رد المزود على تقييم
router.put('/ratings/:id/reply', (req, res, next) => {
    try {
        const id = toId(req.params.id);
        const row = get('SELECT * FROM provider_ratings WHERE id = ? AND provider_id = ?', [id, req.provider.id]);
        if (!row)
            throw new ApiError(404, 'التقييم غير موجود');
        const reply = String((req.body || {}).reply || '').trim();
        if (reply.length > 1000)
            throw new ApiError(400, 'الرد طويل جداً (الحد 1000 حرف)');
        run("UPDATE provider_ratings SET reply = NULLIF(?, ''), replied_at = CASE WHEN ? = '' THEN NULL ELSE datetime('now') END, updated_at = datetime('now') WHERE id = ?", [reply, reply, id]);
        logActivity(req.user, 'reply_rating', 'provider_rating', id, { provider_id: req.provider.id });
        return ok(res, get('SELECT * FROM provider_ratings WHERE id = ?', [id]));
    }
    catch (e) {
        next(e);
    }
});
// ===================== مستندات توثيق المزود =====================
const MAX_DOC_SIZE = 2 * 1024 * 1024; // 2MB لكل مستند (base64)
function validateDocImage(value, label) {
    if (!value)
        return null;
    const s = String(value);
    if (s.startsWith('data:')) {
        const { url } = saveBase64ToUpload(s);
        return url;
    }
    if (s.startsWith('https://') || s.startsWith('http://localhost') || s.startsWith('/uploads/')) {
        return s;
    }
    throw new ApiError(400, `${label} يجب أن تكون صورة (data:image/...) أو رابطاً أو ملفاً مرفوعاً`);
}
// حالة التوثيق الحالية للمزود
router.get('/verification', (req, res, next) => {
    try {
        const p = req.provider;
        return ok(res, {
            verification_status: p.verification_status || 'none',
            verification_note: p.verification_note || null,
            national_id_image: p.national_id_image || null,
            residency_doc_image: p.residency_doc_image || null,
            submitted_at: p.submitted_at || null,
            reviewed_at: p.reviewed_at || null,
            is_verified: !!p.is_verified,
        });
    }
    catch (e) {
        next(e);
    }
});
// رفع/تحديث مستندات التوثيق (بطاقة وطنية وتأييد سكن)
router.put('/verification', (req, res, next) => {
    try {
        const p = req.provider;
        const { national_id_image, residency_doc_image } = req.body || {};
        if (!national_id_image && !residency_doc_image) {
            throw new ApiError(400, 'ارفع صورة البطاقة الوطنية أو تأييد السكن على الأقل');
        }
        const national = validateDocImage(national_id_image, 'البطاقة الوطنية');
        const residency = validateDocImage(residency_doc_image, 'تأييد السكن');
        const newNational = national ?? p.national_id_image;
        const newResidency = residency ?? p.residency_doc_image;
        run(`UPDATE providers SET national_id_image = ?, residency_doc_image = ?, verification_status = 'pending',
        verification_note = NULL, submitted_at = datetime('now'), reviewed_at = NULL, updated_at = datetime('now')
       WHERE id = ?`, [newNational, newResidency, p.id]);
        // حذف المستندات القديمة المستبدَلة
        deleteRemovedImages([p.national_id_image, p.residency_doc_image].join(','), [newNational, newResidency].join(','));
        logActivity(req.user, 'submit_verification', 'provider', p.id, {});
        return ok(res, get('SELECT id, verification_status, verification_note, submitted_at FROM providers WHERE id = ?', [p.id]));
    }
    catch (e) {
        next(e);
    }
});
// ============ كوبونات الخصم (ينشرها مزود الخدمة لمتجره) ============
// كل كوبون يقترن بمتجر المزود نفسه: لا يمكن للمزود إنشاء كوبون عام أو كوبون لمتجر آخر.
// سقف الخصم قابل للتحكم من إعدادات المنصة (provider_coupon_max_percent / provider_coupon_max_fixed).
function normalizeCouponCode(raw) {
    const code = String(raw || '').trim().toUpperCase().replace(/\s+/g, '-');
    if (!code)
        throw new ApiError(400, 'رمز الكوبون مطلوب');
    if (code.length > 40)
        throw new ApiError(400, 'رمز الكوبون يتجاوز الحد المسموح (40 حرفاً)');
    return code;
}
const COUPON_SELECT = `
  SELECT c.*,
         (SELECT COUNT(*) FROM coupon_usages u WHERE u.coupon_id = c.id) AS used_count
  FROM coupons c
`;
function assertCouponValue(type, value) {
    const discountType = type === 'fixed' ? 'fixed' : 'percent';
    const discountValue = Number(value);
    if (!Number.isFinite(discountValue) || discountValue <= 0) {
        throw new ApiError(400, 'قيمة الخصم يجب أن تكون رقماً موجباً');
    }
    if (discountType === 'percent') {
        const maxPct = settingValue('provider_coupon_max_percent', 50);
        if (discountValue > maxPct)
            throw new ApiError(400, `نسبة الخصم لا يمكن أن تتجاوز ${maxPct}% لمزود الخدمة`);
    }
    else {
        const maxFixed = settingValue('provider_coupon_max_fixed', 100000);
        if (discountValue > maxFixed)
            throw new ApiError(400, `الخصم الثابت لا يمكن أن يتجاوز ${round2(maxFixed)} دينار لمزود الخدمة`);
    }
    return { discountType, discountValue };
}
// تطبيع تاريخ كوبون: يعيد null للمفقود، أو ISO صالح، ويرفض التالف (يُخزن نصاً يفسّره الجميع بالتساوي)
function normalizeCouponDate(value, label) {
    if (value === undefined || value === null || value === '')
        return null;
    const d = new Date(value);
    if (Number.isNaN(d.getTime()))
        throw new ApiError(400, `${label} بتنسيق غير صالح (استخدم YYYY-MM-DD أو ISO)`);
    return d.toISOString();
}
// GET /api/provider/coupons — كوبونات متجري
router.get('/coupons', (req, res, next) => {
    try {
        const pg = paginate(req);
        const total = get('SELECT COUNT(*) AS c FROM coupons WHERE provider_id = ?', [req.provider.id]).c;
        const rows = all(COUPON_SELECT + ' WHERE c.provider_id = ? ORDER BY c.id DESC LIMIT ? OFFSET ?', [req.provider.id, pg.limit, pg.offset]);
        return ok(res, rows, { total, page: pg.page, limit: pg.limit, pages: Math.max(1, Math.ceil(total / pg.limit)) });
    }
    catch (e) {
        next(e);
    }
});
// POST /api/provider/coupons — إنشاء كوبون جديد لمتجري
router.post('/coupons', (req, res, next) => {
    try {
        const body = req.body || {};
        const code = normalizeCouponCode(body.code);
        const { discountType, discountValue } = assertCouponValue(body.discount_type, body.discount_value);
        if (body.title !== undefined && body.title !== '')
            assertLength(body.title, 100, 'الاسم');
        const dup = get('SELECT id FROM coupons WHERE code = ?', [code]);
        if (dup)
            throw new ApiError(409, 'رمز الكوبون مستخدم مسبقاً');
        const perCustomerLimit = body.per_customer_limit === undefined || body.per_customer_limit === null || body.per_customer_limit === ''
            ? 1 : Math.max(0, Number(body.per_customer_limit) || 0);
        const startsAt = normalizeCouponDate(body.starts_at, 'تاريخ بداية الكوبون');
        const endsAt = normalizeCouponDate(body.ends_at, 'تاريخ نهاية الكوبون');
        if (startsAt && endsAt && new Date(endsAt) <= new Date(startsAt)) {
            throw new ApiError(400, 'تاريخ نهاية الكوبون يجب أن يكون بعد تاريخ بدايته');
        }
        const id = run(`INSERT INTO coupons (code, title, discount_type, discount_value, min_amount, provider_id, starts_at, ends_at, max_uses, per_customer_limit, is_active)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`, [
            code,
            body.title || null,
            discountType,
            round2(discountValue),
            round2(Math.max(0, Number(body.min_amount) || 0)),
            req.provider.id,
            startsAt,
            endsAt,
            Math.max(0, Number(body.max_uses) || 0),
            perCustomerLimit,
            body.is_active === undefined ? 1 : (Number(body.is_active) ? 1 : 0),
        ]).lastId;
        logActivity(req.user, 'create', 'coupon', id, { code });
        // إشعار للمسؤولين
        notifyRole('admin', {
            type: 'coupon_created',
            title: 'كوبون جديد تم إنشاؤه 🎫',
            body: `المزود «${req.provider.name_ar}» أنشأ كوبون «${code}».`,
            url: '/coupons',
            icon: '🎫',
        });
        return created(res, get(COUPON_SELECT + ' WHERE c.id = ?', [id]));
    }
    catch (e) {
        next(e);
    }
});
// PUT /api/provider/coupons/:id — تعديل كوبون خاص بمتجري
router.put('/coupons/:id', (req, res, next) => {
    try {
        const id = toId(req.params.id);
        const c = get('SELECT * FROM coupons WHERE id = ?', [id]);
        if (!c || Number(c.provider_id) !== req.provider.id)
            throw new ApiError(404, 'الكوبون غير موجود');
        const body = req.body || {};
        const code = body.code !== undefined ? normalizeCouponCode(body.code) : c.code;
        if (code !== c.code) {
            const dup = get('SELECT id FROM coupons WHERE code = ? AND id != ?', [code, id]);
            if (dup)
                throw new ApiError(409, 'رمز الكوبون مستخدم مسبقاً');
        }
        let discountType = c.discount_type;
        let discountValue = Number(c.discount_value);
        if (body.discount_type !== undefined || body.discount_value !== undefined) {
            ({ discountType, discountValue } = assertCouponValue(body.discount_type !== undefined ? body.discount_type : c.discount_type, body.discount_value !== undefined ? body.discount_value : c.discount_value));
        }
        if (body.title !== undefined && body.title !== '')
            assertLength(body.title, 100, 'الاسم');
        const startsAt = body.starts_at !== undefined
            ? normalizeCouponDate(body.starts_at, 'تاريخ بداية الكوبون')
            : (c.starts_at ? new Date(c.starts_at).toISOString() : null);
        const endsAt = body.ends_at !== undefined
            ? normalizeCouponDate(body.ends_at, 'تاريخ نهاية الكوبون')
            : (c.ends_at ? new Date(c.ends_at).toISOString() : null);
        if (startsAt && endsAt && new Date(endsAt) <= new Date(startsAt)) {
            throw new ApiError(400, 'تاريخ نهاية الكوبون يجب أن يكون بعد تاريخ بدايته');
        }
        run(`UPDATE coupons SET code = ?, title = ?, discount_type = ?, discount_value = ?, min_amount = ?,
        starts_at = ?, ends_at = ?, max_uses = ?, per_customer_limit = ?, is_active = ?, updated_at = datetime('now')
       WHERE id = ?`, [
            code,
            body.title !== undefined ? body.title : c.title,
            discountType,
            round2(discountValue),
            round2(Math.max(0, body.min_amount !== undefined ? Number(body.min_amount) : c.min_amount)),
            startsAt,
            endsAt,
            body.max_uses !== undefined ? Math.max(0, Number(body.max_uses) || 0) : c.max_uses,
            body.per_customer_limit !== undefined ? Math.max(0, Number(body.per_customer_limit) || 0) : c.per_customer_limit,
            body.is_active !== undefined ? (Number(body.is_active) ? 1 : 0) : c.is_active,
            id,
        ]);
        logActivity(req.user, 'update', 'coupon', id, { code });
        return ok(res, get(COUPON_SELECT + ' WHERE c.id = ?', [id]));
    }
    catch (e) {
        next(e);
    }
});
// POST /api/provider/coupons/:id/toggle — تفعيل/إيقاف
router.post('/coupons/:id/toggle', (req, res, next) => {
    try {
        const id = toId(req.params.id);
        const c = get('SELECT * FROM coupons WHERE id = ?', [id]);
        if (!c || Number(c.provider_id) !== req.provider.id)
            throw new ApiError(404, 'الكوبون غير موجود');
        run('UPDATE coupons SET is_active = ?, updated_at = datetime(\'now\') WHERE id = ?', [c.is_active ? 0 : 1, id]);
        logActivity(req.user, c.is_active ? 'deactivate' : 'activate', 'coupon', id, { code: c.code });
        return ok(res, get(COUPON_SELECT + ' WHERE c.id = ?', [id]));
    }
    catch (e) {
        next(e);
    }
});
// DELETE /api/provider/coupons/:id — حذف كوبون (يُمنع إذا استُخدم في طلبات)
router.delete('/coupons/:id', (req, res, next) => {
    try {
        const id = toId(req.params.id);
        const c = get('SELECT * FROM coupons WHERE id = ?', [id]);
        if (!c || Number(c.provider_id) !== req.provider.id)
            throw new ApiError(404, 'الكوبون غير موجود');
        const used = get('SELECT COUNT(*) AS c FROM coupon_usages WHERE coupon_id = ?', [id]).c;
        if (used > 0)
            throw new ApiError(400, 'الكوبون مستخدم في طلبات ولا يمكن حذفه — يمكنك إيقافه بدلاً من ذلك');
        run('DELETE FROM coupons WHERE id = ?', [id]);
        logActivity(req.user, 'delete', 'coupon', id, { code: c.code });
        return ok(res, { message: 'تم حذف الكوبون بنجاح' });
    }
    catch (e) {
        next(e);
    }
});
module.exports = router;
