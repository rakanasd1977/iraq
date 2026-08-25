"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express = require('express');
const multer = require('multer');
const csv = require('csv-parser');
const { Readable } = require('stream');
const { get, all, run, transaction } = require('../db');
const { ApiError, csvEscape, toId, assertLength, round2 } = require('../utils/helpers');
const { ok, created } = require('../utils/response');
const { authenticate } = require('../middleware/auth');
const { requireRole } = require('../middleware/rbac');
const { logActivity } = require('../utils/log');
const router = express.Router();
router.use(authenticate, requireRole('admin'));
// إعداد Multer لرفع الملفات في الذاكرة
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB
    fileFilter: (req, file, cb) => {
        if (file.mimetype === 'text/csv' || file.originalname.endsWith('.csv')) {
            cb(null, true);
        }
        else {
            cb(new ApiError(400, 'يجب أن يكون الملف بصيغة CSV'));
        }
    },
});
// ============ القوالب (Templates) ============
// GET /api/bulk/template/:entity — تحميل قالب CSV للجهة
router.get('/template/:entity', (req, res, next) => {
    try {
        const { entity } = req.params;
        const templates = {
            agents: {
                headers: ['name_ar', 'name_en', 'email', 'phone', 'password', 'governorate_code', 'commission_rate', 'lease_years'],
                sample: [
                    { name_ar: 'وكيل بغداد', name_en: 'Baghdad Agent', email: 'agent.baghdad@rafidain.iq', phone: '07701234567', password: 'Agent@123', governorate_code: 'BAG', commission_rate: 3, lease_years: 1 },
                ],
            },
            providers: {
                headers: ['name_ar', 'name_en', 'email', 'phone', 'password', 'governorate_code', 'service_slug', 'commission_rate', 'address', 'description', 'website', 'is_active', 'is_featured', 'is_verified'],
                sample: [
                    { name_ar: 'مطعم الأصيل', name_en: 'Al-Asil Restaurant', email: 'restaurant@rafidain.iq', phone: '07801234567', password: 'Provider@123', governorate_code: 'BAG', service_slug: 'restaurants', commission_rate: 5, address: 'بغداد، الكرادة', description: 'مطعم عراقي أصيل', website: 'https://example.com', is_active: 1, is_featured: 0, is_verified: 1 },
                ],
            },
            products: {
                headers: ['provider_email', 'category_name_ar', 'name_ar', 'name_en', 'description', 'price', 'old_price', 'stock', 'image_urls_comma', 'is_active', 'is_featured'],
                sample: [
                    { provider_email: 'restaurant@rafidain.iq', category_name_ar: 'أطباق رئيسية', name_ar: 'مشاوي مشكلة', name_en: 'Mixed Grill', description: 'مشاوي لحم ودجاج', price: 25000, old_price: 30000, stock: 50, image_urls_comma: 'https://example.com/img1.jpg,https://example.com/img2.jpg', is_active: 1, is_featured: 1 },
                ],
            },
            coupons: {
                headers: ['provider_email', 'code', 'title', 'discount_type', 'discount_value', 'min_amount', 'starts_at', 'ends_at', 'max_uses', 'per_customer_limit', 'is_active'],
                sample: [
                    { provider_email: 'restaurant@rafidain.iq', code: 'WELCOME10', title: 'خصم ترحيبي', discount_type: 'percent', discount_value: 10, min_amount: 15000, starts_at: '2025-01-01 00:00:00', ends_at: '2025-12-31 23:59:59', max_uses: 100, per_customer_limit: 1, is_active: 1 },
                ],
            },
        };
        const tmpl = templates[entity];
        if (!tmpl)
            throw new ApiError(404, 'الجهة غير مدعومة. المدعومة: agents, providers, products, coupons');
        const csv = [tmpl.headers.join(','), ...tmpl.sample.map(r => tmpl.headers.map(h => csvEscape(r[h] || '')).join(','))].join('\n');
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="${entity}-template.csv"`);
        res.send('\uFEFF' + csv); // BOM for Excel
    }
    catch (e) {
        next(e);
    }
});
// ============ الاستيراد مع المعاينة (Import with Preview) ============
// POST /api/bulk/preview/:entity — معاينة الاستيراد بدون حفظ
router.post('/preview/:entity', upload.single('file'), async (req, res, next) => {
    try {
        const { entity } = req.params;
        if (!req.file)
            throw new ApiError(400, 'لم يتم رفع ملف');
        const results = await parseCSV(req.file.buffer);
        const validation = validateRows(entity, results.rows);
        return ok(res, {
            total: results.rows.length,
            valid: validation.valid.length,
            invalid: validation.invalid.length,
            preview: validation.valid.slice(0, 50), // أول 50 صف صالح
            errors: validation.invalid.slice(0, 100),
        });
    }
    catch (e) {
        next(e);
    }
});
// POST /api/bulk/import/:entity — تنفيذ الاستيراد
router.post('/import/:entity', upload.single('file'), async (req, res, next) => {
    try {
        const { entity } = req.params;
        if (!req.file)
            throw new ApiError(400, 'لم يتم رفع ملف');
        const { skipErrors = 'false' } = req.body;
        const results = await parseCSV(req.file.buffer);
        const validation = validateRows(entity, results.rows);
        if (validation.invalid.length > 0 && skipErrors !== 'true') {
            return res.status(400).json({
                error: 'يوجد أخطاء في البيانات. استخدم skipErrors=true لتخطي الصفوف الخاطئة.',
                invalidCount: validation.invalid.length,
                errors: validation.invalid.slice(0, 50),
            });
        }
        const imported = importRows(entity, validation.valid, req.user.id);
        logActivity(req.user, 'bulk_import', entity, null, { entity, count: imported.count, skipped: validation.invalid.length });
        return ok(res, imported);
    }
    catch (e) {
        next(e);
    }
});
// ============ التصدير (Export) ============
// GET /api/bulk/export/:entity — تصدير البيانات كـ CSV
router.get('/export/:entity', (req, res, next) => {
    try {
        const { entity } = req.params;
        const { from, to, status } = req.query;
        const { rows, headers } = exportEntity(entity, req.query);
        const csv = [headers.join(','), ...rows.map(r => headers.map(h => csvEscape(r[h] || '')).join(','))].join('\n');
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="${entity}-export-${new Date().toISOString().slice(0, 10)}.csv"`);
        res.send('\uFEFF' + csv);
    }
    catch (e) {
        next(e);
    }
});
module.exports = router;
// ============================================================
// دوال مساعدة
// ============================================================
function parseCSV(buffer) {
    return new Promise((resolve, reject) => {
        const rows = [];
        const stream = Readable.from(buffer.toString('utf-8'));
        stream
            .pipe(csv({ mapHeaders: ({ header }) => header.trim() }))
            .on('data', (row) => rows.push(row))
            .on('end', () => resolve({ rows }))
            .on('error', reject);
    });
}
function validateRows(entity, rows) {
    const valid = [];
    const invalid = [];
    for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const errors = [];
        switch (entity) {
            case 'agents':
                if (!row.name_ar?.trim())
                    errors.push('name_ar مطلوب');
                if (!row.email?.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(row.email))
                    errors.push('email غير صالح');
                if (!row.phone?.trim())
                    errors.push('phone مطلوب');
                if (!row.password?.trim())
                    errors.push('password مطلوب');
                if (!row.governorate_code?.trim())
                    errors.push('governorate_code مطلوب');
                break;
            case 'providers':
                if (!row.name_ar?.trim())
                    errors.push('name_ar مطلوب');
                if (!row.email?.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(row.email))
                    errors.push('email غير صالح');
                if (!row.phone?.trim())
                    errors.push('phone مطلوب');
                if (!row.password?.trim())
                    errors.push('password مطلوب');
                if (!row.governorate_code?.trim())
                    errors.push('governorate_code مطلوب');
                if (!row.service_slug?.trim())
                    errors.push('service_slug مطلوب');
                break;
            case 'products':
                if (!row.provider_email?.trim())
                    errors.push('provider_email مطلوب');
                if (!row.name_ar?.trim())
                    errors.push('name_ar مطلوب');
                if (!row.category_name_ar?.trim())
                    errors.push('category_name_ar مطلوب');
                const price = Number(row.price);
                if (isNaN(price) || price < 0)
                    errors.push('price يجب أن يكون رقمًا موجبًا');
                break;
            case 'coupons':
                if (!row.provider_email?.trim())
                    errors.push('provider_email مطلوب');
                if (!row.code?.trim())
                    errors.push('code مطلوب');
                if (!['percent', 'fixed'].includes(row.discount_type))
                    errors.push('discount_type يجب أن يكون percent أو fixed');
                const dv = Number(row.discount_value);
                if (isNaN(dv) || dv <= 0)
                    errors.push('discount_value يجب أن يكون رقمًا موجبًا');
                break;
        }
        if (errors.length === 0) {
            valid.push({ rowNum: i + 1, data: row });
        }
        else {
            invalid.push({ rowNum: i + 1, data: row, errors });
        }
    }
    return { valid, invalid };
}
function importRows(entity, validRows, userId) {
    let count = 0;
    const errors = [];
    for (const { rowNum, data } of validRows) {
        try {
            transaction(() => {
                switch (entity) {
                    case 'agents':
                        importAgent(data);
                        break;
                    case 'providers':
                        importProvider(data, userId);
                        break;
                    case 'products':
                        importProduct(data);
                        break;
                    case 'coupons':
                        importCoupon(data);
                        break;
                }
                count++;
            });
        }
        catch (e) {
            errors.push({ rowNum, error: e.message });
        }
    }
    return { count, errors };
}
function importAgent(data) {
    const { name_ar, name_en, email, phone, password, governorate_code, commission_rate, lease_years } = data;
    // البحث أو إنشاء المستخدم
    let user = get('SELECT * FROM users WHERE email = ?', [email.toLowerCase()]);
    if (!user) {
        const { hashPassword } = require('../utils/password');
        const passwordHash = hashPassword(password || 'Agent@123');
        user = { id: run('INSERT INTO users (role, name_ar, name_en, email, phone, password_hash, is_active) VALUES (?,?,?,?,?,?,1)', ['agent', name_ar, name_en || null, email.toLowerCase(), phone, passwordHash]).lastId };
    }
    const governorate = get('SELECT id FROM governorates WHERE code = ?', [governorate_code.toUpperCase()]);
    if (!governorate)
        throw new Error(`محافظة غير موجودة: ${governorate_code}`);
    // التحقق من وجود وكيل لنفس المحافظة
    const existingAgent = get('SELECT id FROM agents WHERE governorate_id = ?', [governorate.id]);
    if (existingAgent)
        throw new Error(`المحافظة ${governorate_code} لديها وكيل بالفعل`);
    const leaseYears = Number(lease_years) || 1;
    const start = new Date();
    const end = new Date(start.getFullYear() + leaseYears, start.getMonth(), start.getDate());
    run('INSERT INTO agents (user_id, governorate_id, commission_rate, lease_status, lease_expires_at) VALUES (?,?,?,?,?)', [user.id, governorate.id, Number(commission_rate) || 3, 'active', end.toISOString().replace('T', ' ').slice(0, 19)]);
}
function importProvider(data, userId) {
    const { name_ar, name_en, email, phone, password, governorate_code, service_slug, commission_rate, address, description, website, is_active, is_featured, is_verified } = data;
    let user = get('SELECT * FROM users WHERE email = ?', [email.toLowerCase()]);
    if (!user) {
        const { hashPassword } = require('../utils/password');
        const passwordHash = hashPassword(password || 'Provider@123');
        user = { id: run('INSERT INTO users (role, name_ar, name_en, email, phone, password_hash, is_active) VALUES (?,?,?,?,?,?,1)', ['provider', name_ar, name_en || null, email.toLowerCase(), phone, passwordHash]).lastId };
    }
    const governorate = get('SELECT id FROM governorates WHERE code = ?', [governorate_code.toUpperCase()]);
    if (!governorate)
        throw new Error(`محافظة غير موجودة: ${governorate_code}`);
    const service = get('SELECT id FROM services WHERE slug = ?', [service_slug]);
    if (!service)
        throw new Error(`خدمة غير موجودة: ${service_slug}`);
    const existingProvider = get('SELECT id FROM providers WHERE user_id = ?', [user.id]);
    if (existingProvider)
        throw new Error(`المستخدم ${email} لديه مزود بالفعل`);
    run(`INSERT INTO providers (user_id, governorate_id, service_id, name_ar, name_en, commission_rate, address, description, website, is_active, is_featured, is_verified)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`, [user.id, governorate.id, service.id, name_ar, name_en || null, Number(commission_rate) || 5, address || null, description || null, website || null, Number(is_active) || 1, Number(is_featured) || 0, Number(is_verified) || 0]);
}
function importProduct(data) {
    const { provider_email, category_name_ar, name_ar, name_en, description, price, old_price, stock, image_urls_comma, is_active, is_featured } = data;
    const provider = get('SELECT p.id FROM providers p JOIN users u ON u.id = p.user_id WHERE u.email = ?', [provider_email.toLowerCase()]);
    if (!provider)
        throw new Error(`مزود غير موجود: ${provider_email}`);
    let category = get('SELECT id FROM product_categories WHERE provider_id = ? AND name_ar = ?', [provider.id, category_name_ar]);
    if (!category) {
        category = { id: run('INSERT INTO product_categories (provider_id, name_ar, sort_order) VALUES (?,?,99)', [provider.id, category_name_ar]).lastId };
    }
    const images = image_urls_comma ? image_urls_comma.split(',').map(u => u.trim()).filter(Boolean) : [];
    run(`INSERT INTO products (provider_id, category_id, name_ar, name_en, description, price, old_price, stock, images_json, is_active, is_featured)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`, [provider.id, category.id, name_ar, name_en || null, description || null, Number(price), old_price ? Number(old_price) : null, Number(stock) || 0, JSON.stringify(images), Number(is_active) || 1, Number(is_featured) || 0]);
}
function importCoupon(data) {
    const { provider_email, code, title, discount_type, discount_value, min_amount, starts_at, ends_at, max_uses, per_customer_limit, is_active } = data;
    const provider = get('SELECT p.id FROM providers p JOIN users u ON u.id = p.user_id WHERE u.email = ?', [provider_email.toLowerCase()]);
    if (!provider)
        throw new Error(`مزود غير موجود: ${provider_email}`);
    const existing = get('SELECT id FROM coupons WHERE code = ?', [code.toUpperCase()]);
    if (existing)
        throw new Error(`رمز الكوبون مستخدم: ${code}`);
    const settings = require('../utils/settings');
    const maxPct = settingValue('provider_coupon_max_percent', 50);
    const maxFixed = settingValue('provider_coupon_max_fixed', 100000);
    const discountType = discount_type;
    const discountValue = Number(discount_value);
    if (discountType === 'percent' && (discountValue < 1 || discountValue > maxPct))
        throw new Error(`نسبة الخصم يجب أن تكون بين 1% و ${maxPct}%`);
    if (discountType === 'fixed' && (discountValue < 1 || discountValue > maxFixed))
        throw new Error(`الخصم الثابت يجب أن يكون بين 1 و ${maxFixed} دينار`);
    run(`INSERT INTO coupons (code, title, discount_type, discount_value, min_amount, provider_id, starts_at, ends_at, max_uses, per_customer_limit, is_active)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`, [code.toUpperCase(), title || null, discountType, discountValue, Number(min_amount) || 0, provider.id, starts_at || null, ends_at || null, Number(max_uses) || 0, Number(per_customer_limit) || 1, Number(is_active) || 1]);
}
function exportEntity(entity, query) {
    const { from, to, status } = query;
    let rows, headers;
    switch (entity) {
        case 'agents':
            headers = ['id', 'name_ar', 'name_en', 'email', 'phone', 'governorate', 'commission_rate', 'lease_status', 'lease_expires_at', 'created_at'];
            const agentWhere = [];
            const agentParams = [];
            if (status) {
                agentWhere.push('a.lease_status = ?');
                agentParams.push(status);
            }
            const agentWhereSql = agentWhere.length ? ' WHERE ' + agentWhere.join(' AND ') : '';
            rows = all(`
        SELECT a.id, u.name_ar, u.name_en, u.email, u.phone, g.name_ar AS governorate,
               a.commission_rate, a.lease_status, a.lease_expires_at, a.created_at
        FROM agents a
        JOIN users u ON u.id = a.user_id
        JOIN governorates g ON g.id = a.governorate_id
        ${agentWhereSql} ORDER BY a.id DESC
      `, agentParams);
            break;
        case 'providers':
            headers = ['id', 'name_ar', 'name_en', 'email', 'phone', 'governorate', 'service', 'commission_rate', 'is_active', 'is_verified', 'is_featured', 'created_at'];
            const provWhere = [];
            const provParams = [];
            if (status) {
                provWhere.push('p.is_active = ?');
                provParams.push(Number(status));
            }
            const provWhereSql = provWhere.length ? ' WHERE ' + provWhere.join(' AND ') : '';
            rows = all(`
        SELECT p.id, p.name_ar, p.name_en, u.email, u.phone, g.name_ar AS governorate, s.name_ar AS service,
               p.commission_rate, p.is_active, p.is_verified, p.is_featured, p.created_at
        FROM providers p
        JOIN users u ON u.id = p.user_id
        JOIN governorates g ON g.id = p.governorate_id
        JOIN services s ON s.id = p.service_id
        ${provWhereSql} ORDER BY p.id DESC
      `, provParams);
            break;
        case 'products':
            headers = ['id', 'provider', 'category', 'name_ar', 'name_en', 'price', 'old_price', 'stock', 'is_active', 'is_featured', 'created_at'];
            rows = all(`
        SELECT p.id, pr.name_ar AS provider, pc.name_ar AS category, p.name_ar, p.name_en, p.price, p.old_price, p.stock, p.is_active, p.is_featured, p.created_at
        FROM products p
        JOIN providers pr ON pr.id = p.provider_id
        JOIN product_categories pc ON pc.id = p.category_id
        ORDER BY p.id DESC
      `);
            break;
        case 'coupons':
            headers = ['id', 'code', 'title', 'provider', 'discount_type', 'discount_value', 'min_amount', 'starts_at', 'ends_at', 'max_uses', 'per_customer_limit', 'is_active', 'created_at'];
            rows = all(`
        SELECT c.id, c.code, c.title, pr.name_ar AS provider, c.discount_type, c.discount_value, c.min_amount, c.starts_at, c.ends_at, c.max_uses, c.per_customer_limit, c.is_active, c.created_at
        FROM coupons c
        JOIN providers pr ON pr.id = c.provider_id
        ORDER BY c.id DESC
      `);
            break;
        default:
            throw new Error('جهة غير مدعومة للتصدير');
    }
    return { rows, headers };
}
// تحتاج هذه الدالة للوصول إليها من importCoupon
const { settingValue } = require('../utils/helpers');
