const express = require('express');
const { ok } = require('../utils/response');
const { authenticate } = require('../middleware/auth');
const { requireRole, requirePermissionForAdmin } = require('../middleware/rbac');
const { round2, csvEscape } = require('../utils/helpers');
const fr = require('../services/financial-report');

const router = express.Router();
router.use(authenticate, requireRole('admin'));

const view = requirePermissionForAdmin('financial_reports', 'view');
const exp = requirePermissionForAdmin('financial_reports', 'export');

const report = (req, res, next) => {
  try { ok(res, fr.getFinancialReport(req.query)); } catch (e: any) { next(e); }
};

const exportCsv = (req, res, next) => {
  try {
    const rows = fr.exportFinancialReportRows(req.query);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="financial-report-${Date.now()}.csv"`);
    const lines = ['\uFEFF' + ['التصنيف', 'عدد الطلبات', 'قيمة الطلبات (دينار)', 'إيراد المنصة (دينار)', 'أرباح الوكلاء (دينار)', 'طلبات ملغاة'].map(csvEscape).join(',')];
    for (const r of rows) {
      lines.push([r.label, r.orders_count, round2(r.orders_value), round2(r.platform_revenue), round2(r.agent_revenue), r.cancelled_count].map(csvEscape).join(','));
    }
    return res.send(lines.join('\r\n') + '\r\n');
  } catch (e: any) { next(e); }
};

router.get('/', view, report);
router.get('/export', exp, exportCsv);

module.exports = router;
