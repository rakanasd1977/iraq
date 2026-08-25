"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express = require('express');
const { get, all, run } = require('../db');
const { ok } = require('../utils/response');
const { authenticate } = require('../middleware/auth');
const { requireRole } = require('../middleware/rbac');
const { logActivity } = require('../utils/log');
const { ApiError } = require('../utils/helpers');
const router = express.Router();
router.use(authenticate, requireRole('admin'));
// GET /api/settings
router.get('/', (req, res, next) => {
    try {
        const rows = all('SELECT key, value, label FROM settings ORDER BY key ASC');
        const out = {};
        rows.forEach((r) => { out[r.key] = { value: r.value, label: r.label }; });
        return ok(res, out);
    }
    catch (e) {
        next(e);
    }
});
// PUT /api/settings (bulk update)
router.put('/', (req, res, next) => {
    try {
        const body = req.body || {};
        const updated = [];
        for (const [key, val] of Object.entries(body)) {
            if (typeof val === 'object' && val !== null && 'value' in val) {
                const exists = get('SELECT key FROM settings WHERE key = ?', [key]);
                if (exists) {
                    run('UPDATE settings SET value = ?, updated_at = datetime(\'now\') WHERE key = ?', [String(val.value), key]);
                }
                else {
                    run('INSERT INTO settings (key, value, label) VALUES (?,?,?)', [key, String(val.value), val.label || null]);
                }
                updated.push(key);
            }
        }
        if (updated.length)
            logActivity(req.user, 'update', 'settings', null, { keys: updated });
        const rows = all('SELECT key, value, label FROM settings ORDER BY key ASC');
        const out = {};
        rows.forEach((r) => { out[r.key] = { value: r.value, label: r.label }; });
        return ok(res, out);
    }
    catch (e) {
        next(e);
    }
});
// PUT /api/settings/:key (single update with validation)
router.put('/:key', (req, res, next) => {
    try {
        const key = req.params.key;
        const { value, label } = req.body || {};
        if (value === undefined)
            throw new ApiError(400, 'القيمة مطلوبة');
        // Validation rules per key
        const validators = {
            promo_price: (v) => { const n = Number(v); if (isNaN(n) || n < 0)
                throw new ApiError(400, 'سعر الترويج يجب أن يكون رقمًا موجبًا'); },
            promo_duration_days: (v) => { const n = Number(v); if (isNaN(n) || n < 1 || n > 365)
                throw new ApiError(400, 'مدة الترويج بين 1 و 365 يوم'); },
            promo_max_active: (v) => { const n = Number(v); if (isNaN(n) || n < 1 || n > 100)
                throw new ApiError(400, 'الحد الأقصى للترويجات بين 1 و 100'); },
            agent_default_commission: (v) => { const n = Number(v); if (isNaN(n) || n < 0 || n > 100)
                throw new ApiError(400, 'عمولة الوكيل بين 0% و 100%'); },
            platform_commission_default: (v) => { const n = Number(v); if (isNaN(n) || n < 0 || n > 100)
                throw new ApiError(400, 'عمولة المنصة بين 0% و 100%'); },
            free_shipping_min: (v) => { const n = Number(v); if (isNaN(n) || n < 0)
                throw new ApiError(400, 'الحد الأدنى للشحن المجاني يجب أن يكون رقمًا موجبًا'); },
            loyalty_point_value: (v) => { const n = Number(v); if (isNaN(n) || n < 1)
                throw new ApiError(400, 'قيمة النقطة يجب أن تكون 1 أو أكثر'); },
            loyalty_min_redeem: (v) => { const n = Number(v); if (isNaN(n) || n < 1)
                throw new ApiError(400, 'الحد الأدنى للنقاط يجب أن يكون 1 أو أكثر'); },
            loyalty_earn_per_1000: (v) => { const n = Number(v); if (isNaN(n) || n < 0)
                throw new ApiError(400, 'نقاط الولاء لكل 1000 دينار يجب أن يكون رقمًا موجبًا'); },
            referral_bonus_referrer: (v) => { const n = Number(v); if (isNaN(n) || n < 0)
                throw new ApiError(400, 'مكافأة الداعي يجب أن تكون رقمًا موجبًا'); },
            referral_bonus_referee: (v) => { const n = Number(v); if (isNaN(n) || n < 0)
                throw new ApiError(400, 'مكافأة المدعو يجب أن تكون رقمًا موجبًا'); },
            referral_min_order: (v) => { const n = Number(v); if (isNaN(n) || n < 0)
                throw new ApiError(400, 'الحد الأدنى للطلب يجب أن يكون رقمًا موجبًا'); },
            provider_coupon_max_percent: (v) => { const n = Number(v); if (isNaN(n) || n < 0 || n > 100)
                throw new ApiError(400, 'نسبة كوبونات المزودين بين 0% و 100%'); },
            provider_coupon_max_fixed: (v) => { const n = Number(v); if (isNaN(n) || n < 0)
                throw new ApiError(400, 'الحد الأقصى للخصم الثابت يجب أن يكون رقمًا موجبًا'); },
            activity_log_retention_days: (v) => { const n = Number(v); if (isNaN(n) || n < 1 || n > 3650)
                throw new ApiError(400, 'أيام الاحتفاظ بين 1 و 3650'); },
            require_agent_lease: (v) => { if (v !== '0' && v !== '1' && v !== 'true' && v !== 'false')
                throw new ApiError(400, 'القيمة يجب أن تكون 0 أو 1'); },
        };
        if (validators[key])
            validators[key](value);
        const exists = get('SELECT key FROM settings WHERE key = ?', [key]);
        if (exists) {
            run('UPDATE settings SET value = ?, updated_at = datetime(\'now\') WHERE key = ?', [String(value), key]);
        }
        else {
            run('INSERT INTO settings (key, value, label) VALUES (?,?,?)', [key, String(value), label || null]);
        }
        logActivity(req.user, 'update', 'settings', null, { keys: [key] });
        const row = get('SELECT key, value, label FROM settings WHERE key = ?', [key]);
        return ok(res, { [row.key]: { value: row.value, label: row.label } });
    }
    catch (e) {
        next(e);
    }
});
// GET /api/settings/:key
router.get('/:key', (req, res, next) => {
    try {
        const row = get('SELECT key, value, label FROM settings WHERE key = ?', [req.params.key]);
        if (!row)
            throw new (require('../utils/helpers').ApiError)(404, 'الإعداد غير موجود');
        return ok(res, { [row.key]: { value: row.value, label: row.label } });
    }
    catch (e) {
        next(e);
    }
});
module.exports = router;
