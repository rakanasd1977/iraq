"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const { run, get } = require('../db');
const { clientIp } = require('./rateLimit');
const RETENTION_KEY = 'activity_log_retention_days';
const DEFAULT_RETENTION_DAYS = 90;
function logActivity(user, action, entityType, entityId, details, req = null) {
    try {
        run('INSERT INTO activity_log (user_id, actor_role, action, entity_type, entity_id, details, ip_address, user_agent) VALUES (?,?,?,?,?,?,?,?)', [
            user ? user.id : null,
            user ? user.role : 'system',
            action,
            entityType,
            entityId,
            details ? JSON.stringify(details) : null,
            req ? clientIp(req) : null,
            req ? req.headers['user-agent'] : null,
        ]);
    }
    catch (e) {
        console.error('[log]', e.message);
    }
}
// تدوير شهري: حذف السجلات الأقدم من فترة الاحتفاظ (إعداد في settings)، يُستدعى دورياً من الخادم
function pruneActivityLog() {
    try {
        const row = get("SELECT value FROM settings WHERE key = ?", [RETENTION_KEY]);
        const days = parseInt(row?.value, 10) || DEFAULT_RETENTION_DAYS;
        const cutoff = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10) + ' 00:00:00';
        const res = run("DELETE FROM activity_log WHERE created_at < ?", [cutoff]);
        if (res?.changes > 0)
            console.log(`[log] تقليم activity_log: حُذف ${res.changes} سجلاً أقدم من ${days} يوم`);
    }
    catch (e) {
        console.error('[log] prune failed:', e.message);
    }
}
module.exports = { logActivity, pruneActivityLog };
