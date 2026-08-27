const express = require('express');
const { ok } = require('../utils/response');
const { authenticate } = require('../middleware/auth');
const { requireRole, requirePermissionForAdmin } = require('../middleware/rbac');
const { csvEscape } = require('../utils/helpers');
const activity = require('../services/activity');

const router = express.Router();
const view = requirePermissionForAdmin('activity_log', 'view');
const exp = requirePermissionForAdmin('activity_log', 'export');

router.use(authenticate, requireRole('admin'));

const list = (req, res, next) => {
  try {
    const { rows, total, page, limit, pages } = activity.listActivity(req.query);
    return ok(res, rows, { total, page, limit, pages });
  } catch (e: any) { next(e); }
};

const exportCsv = (req, res, next) => {
  try {
    const rows = activity.exportActivityRows(req.query);
    const headers = ['ID', 'التاريخ', 'المنفذ', 'البريد', 'الدور', 'العملية', 'نوع الجهة', 'معرف الجهة', 'IP', 'User Agent', 'التفاصيل'];
    const csv = [
      headers.join(','),
      ...rows.map((r) => [
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
    res.send('\uFEFF' + csv);
  } catch (e: any) { next(e); }
};

router.get('/', view, list);
router.get('/export', exp, exportCsv);

module.exports = router;
