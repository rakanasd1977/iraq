"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express = require('express');
const { get, all, run } = require('../db');
const { ApiError } = require('../utils/helpers');
const { ok } = require('../utils/response');
const { authenticate } = require('../middleware/auth');
const { requireRole } = require('../middleware/rbac');
const { logActivity } = require('../utils/log');
const router = express.Router();
// المسؤول فقط: نسب العمولة ونسب الوكيل وإعداداتها إعدادات داخلية للمنصة،
// والوكيل يطّلع على عمولاته عبر /api/agent/commissions الخاصة به.
router.use(authenticate, requireRole('admin'));
const KEYS = ['platform_commission_default', 'agent_default_commission', 'currency'];
// نسبة صالحة: عدد حقيقي محدود بين 0 و 100 (رفض NaN مثل Number("abc"))
function validRate(value) {
    const n = Number(value);
    return Number.isFinite(n) && n >= 0 && n <= 100;
}
// GET /api/commissions (المسؤول فقط)
router.get('/', (req, res, next) => {
    try {
        const rows = all('SELECT key, value FROM settings WHERE key IN (' + KEYS.map(() => '?').join(',') + ')', KEYS);
        const out = {};
        rows.forEach((r) => { out[r.key] = r.value; });
        return ok(res, out);
    }
    catch (e) {
        next(e);
    }
});
// PUT /api/commissions (المسؤول فقط)
router.put('/', (req, res, next) => {
    try {
        const { platform_commission_default, agent_default_commission, currency } = req.body || {};
        const updates = [];
        const params = [];
        if (platform_commission_default !== undefined) {
            if (!validRate(platform_commission_default)) {
                throw new ApiError(400, 'نسبة العمولة يجب أن تكون رقماً بين 0 و 100');
            }
            updates.push('platform_commission_default');
            params.push(String(platform_commission_default));
        }
        if (agent_default_commission !== undefined) {
            if (!validRate(agent_default_commission)) {
                throw new ApiError(400, 'نسبة عمولة الوكيل يجب أن تكون رقماً بين 0 و 100');
            }
            updates.push('agent_default_commission');
            params.push(String(agent_default_commission));
        }
        if (currency !== undefined) {
            updates.push('currency');
            params.push(String(currency));
        }
        for (let i = 0; i < updates.length; i++) {
            const exists = get('SELECT key FROM settings WHERE key = ?', [updates[i]]);
            if (exists) {
                run('UPDATE settings SET value = ?, updated_at = datetime(\'now\') WHERE key = ?', [params[i], updates[i]]);
            }
            else {
                run('INSERT INTO settings (key, value) VALUES (?,?)', [updates[i], params[i]]);
            }
        }
        logActivity(req.user, 'update', 'commissions', null, updates.reduce((o, k, i) => ({ ...o, [k]: params[i] }), {}));
        const rows = all('SELECT key, value FROM settings WHERE key IN (' + KEYS.map(() => '?').join(',') + ')', KEYS);
        const out = {};
        rows.forEach((r) => { out[r.key] = r.value; });
        return ok(res, out);
    }
    catch (e) {
        next(e);
    }
});
module.exports = router;
