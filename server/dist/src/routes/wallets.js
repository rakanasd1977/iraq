"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express = require('express');
const { get, all, run, transaction } = require('../db');
const { ApiError, toId, round2, paginate } = require('../utils/helpers');
const { ok } = require('../utils/response');
const { authenticate } = require('../middleware/auth');
const { requireRole } = require('../middleware/rbac');
const { logActivity } = require('../utils/log');
const { ensureWallet } = require('../utils/wallet');
const router = express.Router();
router.use(authenticate);
// GET /api/wallets/provider — محفظة المزود: رصيد + سجل حركات شفاف
router.get('/provider', (req, res, next) => {
    try {
        if (req.user.role !== 'provider')
            throw new ApiError(403, 'خاص بحسابات المزودين');
        const pid = req.user.provider_id;
        const w = ensureWallet(pid);
        const txs = all('SELECT * FROM wallet_transactions WHERE provider_id = ? ORDER BY id DESC LIMIT 100', [pid]);
        return ok(res, { provider_id: pid, balance: round2(w.balance), transactions: txs });
    }
    catch (e) {
        next(e);
    }
});
// GET /api/wallets — قائمة محافظ جميع المزودين (المسؤول)
router.get('/', requireRole('admin'), (req, res, next) => {
    try {
        const { q } = req.query;
        const where = [];
        const params = [];
        if (q) {
            where.push('(p.name_ar LIKE ? OR u.email LIKE ? OR g.name_ar LIKE ?)');
            const like = `%${String(q)}%`;
            params.push(like, like, like);
        }
        const wSql = where.length ? ' WHERE ' + where.join(' AND ') : '';
        const pg = paginate(req);
        const total = get(`SELECT COUNT(*) AS c FROM providers p JOIN users u ON u.id = p.user_id LEFT JOIN governorates g ON g.id = p.governorate_id ${wSql}`, params).c;
        const rows = all(`
      SELECT p.id AS provider_id, p.name_ar AS provider_name, p.commission_rate,
             p.governorate_id, g.name_ar AS governorate_name_ar, s.name_ar AS service_name_ar,
             COALESCE(w.balance, 0) AS balance,
             (SELECT COUNT(*) FROM wallet_transactions wt WHERE wt.provider_id = p.id) AS tx_count
      FROM providers p
      JOIN users u ON u.id = p.user_id
      LEFT JOIN governorates g ON g.id = p.governorate_id
      LEFT JOIN services s ON s.id = p.service_id
      LEFT JOIN provider_wallets w ON w.provider_id = p.id
      ${wSql}
      ORDER BY p.id ASC
      LIMIT ? OFFSET ?
    `, [...params, pg.limit, pg.offset]);
        return ok(res, rows, { total, page: pg.page, limit: pg.limit, pages: Math.max(1, Math.ceil(total / pg.limit)) });
    }
    catch (e) {
        next(e);
    }
});
// GET /api/wallets/agent/ledger — دفتر استقطاعات الوكيل لمزودي محافظته
router.get('/agent/ledger', (req, res, next) => {
    try {
        if (req.user.role !== 'agent')
            throw new ApiError(403, 'خاص بحسابات الوكلاء');
        const gid = req.user.governorate_id;
        const providers = all(`
      SELECT p.id AS provider_id, p.name_ar AS provider_name,
             COALESCE(w.balance, 0) AS balance
      FROM providers p
      LEFT JOIN provider_wallets w ON w.provider_id = p.id
      WHERE p.governorate_id = ?
      ORDER BY p.id
    `, [gid]);
        const txs = all(`
      SELECT wt.*, p.name_ar AS provider_name
      FROM wallet_transactions wt
      JOIN providers p ON p.id = wt.provider_id
      WHERE p.governorate_id = ? AND (wt.type = 'commission' OR wt.type = 'refund')
      ORDER BY wt.id DESC LIMIT 200
    `, [gid]);
        return ok(res, { providers, transactions: txs });
    }
    catch (e) {
        next(e);
    }
});
// GET /api/wallets/:id — تفاصيل محفظة مزود (رصيد + حركات) — المسؤول
router.get('/:id', requireRole('admin'), (req, res, next) => {
    try {
        const id = toId(req.params.id);
        const p = get('SELECT * FROM providers WHERE id = ?', [id]);
        if (!p)
            throw new ApiError(404, 'المزود غير موجود');
        const w = ensureWallet(id);
        const txs = all('SELECT * FROM wallet_transactions WHERE provider_id = ? ORDER BY id DESC LIMIT 200', [id]);
        return ok(res, { provider_id: id, balance: round2(w.balance), transactions: txs });
    }
    catch (e) {
        next(e);
    }
});
// POST /api/wallets/:id/recharge — شحن رصيد محفظة المزود (المسؤول فقط)
router.post('/:id/recharge', requireRole('admin'), (req, res, next) => {
    try {
        const id = toId(req.params.id);
        const p = get('SELECT * FROM providers WHERE id = ?', [id]);
        if (!p)
            throw new ApiError(404, 'المزود غير موجود');
        const amount = Number(req.body && req.body.amount);
        if (!Number.isFinite(amount) || amount <= 0)
            throw new ApiError(400, 'أدخل مبلغ شحن صحيحاً أكبر من صفر');
        const note = req.body && req.body.note ? String(req.body.note).trim() : 'شحن رصيد';
        const balanceAfter = transaction(() => {
            const w = ensureWallet(id);
            const nextBalance = round2(Number(w.balance) + amount);
            run("UPDATE provider_wallets SET balance = ?, updated_at = datetime('now') WHERE provider_id = ?", [nextBalance, id]);
            run('INSERT INTO wallet_transactions (provider_id, type, amount, agent_amount, platform_amount, balance_after, note, created_by) VALUES (?,?,?,?,?,?,?,?)', [id, 'recharge', round2(amount), 0, 0, nextBalance, note, req.user.name_ar || req.user.email]);
            return nextBalance;
        });
        logActivity(req.user, 'wallet_recharge', 'provider', id, { amount: round2(amount), balance: balanceAfter });
        return ok(res, { provider_id: id, balance: balanceAfter, amount: round2(amount) });
    }
    catch (e) {
        next(e);
    }
});
module.exports = router;
