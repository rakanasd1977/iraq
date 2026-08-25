"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express = require('express');
const { get, all, run } = require('../db');
const { ApiError, paginate } = require('../utils/helpers');
const { ok } = require('../utils/response');
const { authenticate } = require('../middleware/auth');
const sse = require('../utils/sse');
const router = express.Router();
router.use(authenticate);
// تيار الأحداث (SSE): يبقي اتصالاً مفتوحاً ويرسل حدثاً عند وصول إشعار جديد للمستخدم.
// يُستخدم EventSource مع الكوكي نفسه؛ نبض كل 25 ثانية يمنع قطع الاتصال خلف الوسطاء.
router.get('/stream', (req, res) => {
    res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
    });
    res.write(': connected\n\n');
    sse.subscribe(req.user.id, res);
});
// قائمة إشعارات المستخدم (أحدثها أولاً) مع عدد غير المقروء
router.get('/', (req, res, next) => {
    try {
        const { page, limit } = paginate(req, 30);
        const total = get('SELECT COUNT(*) AS c FROM notifications WHERE user_id = ?', [req.user.id]).c;
        const rows = all('SELECT id, type, title, body, url, icon, is_read, created_at FROM notifications WHERE user_id = ? ORDER BY id DESC LIMIT ? OFFSET ?', [req.user.id, limit, (page - 1) * limit]);
        const unread = get('SELECT COUNT(*) AS c FROM notifications WHERE user_id = ? AND is_read = 0', [req.user.id]).c;
        return ok(res, rows, {
            total,
            page,
            limit,
            pages: Math.max(1, Math.ceil(total / limit)),
            unread,
        });
    }
    catch (e) {
        next(e);
    }
});
// تحديد إشعار كمقروء (إشعارات المستخدم فقط)
router.post('/:id/read', (req, res, next) => {
    try {
        const id = Number(req.params.id);
        if (!Number.isInteger(id))
            throw new ApiError(400, 'معرّف غير صالح');
        const r = run('UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ?', [id, req.user.id]);
        if (r.changes === 0) {
            const exists = get('SELECT id FROM notifications WHERE id = ?', [id]);
            if (exists)
                throw new ApiError(403, 'هذا الإشعار ليس لك');
            throw new ApiError(404, 'الإشعار غير موجود');
        }
        const unread = get('SELECT COUNT(*) AS c FROM notifications WHERE user_id = ? AND is_read = 0', [req.user.id]).c;
        return ok(res, { id, read: true, unread });
    }
    catch (e) {
        next(e);
    }
});
// تحديد كل إشعارات المستخدم كمقروءة
router.post('/read-all', (req, res, next) => {
    try {
        run('UPDATE notifications SET is_read = 1 WHERE user_id = ? AND is_read = 0', [req.user.id]);
        return ok(res, { read_all: true, unread: 0 });
    }
    catch (e) {
        next(e);
    }
});
// عدد الإشعارات غير المقروءة (للجرس)
router.get('/unread-count', (req, res, next) => {
    try {
        const unread = get('SELECT COUNT(*) AS c FROM notifications WHERE user_id = ? AND is_read = 0', [req.user.id]).c;
        return ok(res, { unread });
    }
    catch (e) {
        next(e);
    }
});
module.exports = router;
