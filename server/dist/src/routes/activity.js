"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express = require('express');
const { get, all } = require('../db');
const { ok } = require('../utils/response');
const { authenticate } = require('../middleware/auth');
const { requireRole } = require('../middleware/rbac');
const { paginate, parseDateRange, csvEscape } = require('../utils/helpers');
const router = express.Router();
router.use(authenticate, requireRole('admin'));
// GET /api/activity?action=&entity_type=&entity_id=&actor_id=&from=&to=&limit=&page=
router.get('/', (req, res, next) => {
    try {
        const { action, entity_type, entity_id, actor_id } = req.query;
        const { fromUtc, toUtc } = parseDateRange(req.query.from, req.query.to);
        const params = [];
        const conditions = [];
        if (action) {
            conditions.push('a.action = ?');
            params.push(action);
        }
        if (entity_type) {
            conditions.push('a.entity_type = ?');
            params.push(entity_type);
        }
        if (entity_id) {
            conditions.push('a.entity_id = ?');
            params.push(Number(entity_id));
        }
        if (actor_id) {
            conditions.push('a.user_id = ?');
            params.push(Number(actor_id));
        }
        if (fromUtc) {
            conditions.push("strftime('%s', a.created_at) >= strftime('%s', ?)");
            params.push(fromUtc);
        }
        if (toUtc) {
            conditions.push("strftime('%s', a.created_at) <= strftime('%s', ?)");
            params.push(toUtc);
        }
        const where = conditions.length ? ' WHERE ' + conditions.join(' AND ') : '';
        const pg = paginate(req, 100);
        const total = get(`SELECT COUNT(*) AS c FROM activity_log a ${where}`, params).c;
        const rows = all(`SELECT a.*, u.name_ar AS actor_name, u.email AS actor_email
       FROM activity_log a
       LEFT JOIN users u ON u.id = a.user_id
       ${where} ORDER BY a.id DESC LIMIT ? OFFSET ?`, [...params, pg.limit, pg.offset]);
        return ok(res, rows, { total, page: pg.page, limit: pg.limit, pages: Math.max(1, Math.ceil(total / pg.limit)) });
    }
    catch (e) {
        next(e);
    }
});
// GET /api/activity/export?action=&entity_type=&entity_id=&actor_id=&from=&to=
router.get('/export', (req, res, next) => {
    try {
        const { action, entity_type, entity_id, actor_id } = req.query;
        const { fromUtc, toUtc } = parseDateRange(req.query.from, req.query.to);
        const params = [];
        const conditions = [];
        if (action) {
            conditions.push('a.action = ?');
            params.push(action);
        }
        if (entity_type) {
            conditions.push('a.entity_type = ?');
            params.push(entity_type);
        }
        if (entity_id) {
            conditions.push('a.entity_id = ?');
            params.push(Number(entity_id));
        }
        if (actor_id) {
            conditions.push('a.user_id = ?');
            params.push(Number(actor_id));
        }
        if (fromUtc) {
            conditions.push("strftime('%s', a.created_at) >= strftime('%s', ?)");
            params.push(fromUtc);
        }
        if (toUtc) {
            conditions.push("strftime('%s', a.created_at) <= strftime('%s', ?)");
            params.push(toUtc);
        }
        const where = conditions.length ? ' WHERE ' + conditions.join(' AND ') : '';
        const rows = all(`SELECT a.*, u.name_ar AS actor_name, u.email AS actor_email
       FROM activity_log a
       LEFT JOIN users u ON u.id = a.user_id
       ${where} ORDER BY a.id DESC`, params);
        const headers = ['ID', 'التاريخ', 'المنفذ', 'البريد', 'الدور', 'العملية', 'نوع الجهة', 'معرف الجهة', 'IP', 'User Agent', 'التفاصيل'];
        const csv = [
            headers.join(','),
            ...rows.map(r => [
                r.id,
                r.created_at,
                csvEscape(r.actor_name || 'النظام'),
                csvEscape(r.actor_email || ''),
                csvEscape(r.actor_role || ''),
                csvEscape(r.action),
                csvEscape(r.entity_type || ''),
                r.entity_id || '',
                csvEscape(r.ip_address || ''),
                csvEscape(r.user_agent || ''),
                csvEscape(r.details || ''),
            ].join(','))
        ].join('\n');
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="audit-log-${new Date().toISOString().slice(0, 10)}.csv"`);
        res.send('\uFEFF' + csv); // BOM for Excel
    }
    catch (e) {
        next(e);
    }
});
module.exports = router;
