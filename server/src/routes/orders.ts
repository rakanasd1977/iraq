const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const { requireAgentLease, requirePermissionForAdmin } = require('../middleware/rbac');
const { ok, created } = require('../utils/response');
const { csvEscape, ApiError } = require('../utils/helpers');
const orders = require('../services/orders');

router.use(authenticate);

const listHandler = (req, res) => {
  const { rows, meta } = orders.listOrders(req.user, req.query);
  ok(res, rows, meta || {});
};

const statsHandler = (req, res) => {
  ok(res, orders.getOrderStats(req.user));
};

const exportHandler = (req, res) => {
  if (!['admin', 'agent', 'provider'].includes(req.user.role)) {
    throw new ApiError(403, 'غير مصرح لك بتصدير الطلبات');
  }
  const MAX_EXPORT_ROWS = 10000;
  const EXPORT_BATCH = 500;
  const { status, service_id, governorate_id, from, to, provider_id } = req.query;
  const maxRows = Math.min(Math.max(Number(req.query.limit) || MAX_EXPORT_ROWS, 1), MAX_EXPORT_ROWS);
  const { where, params } = orders.buildOrderFilters(req.user, req.query);
  const total = orders.getOrderExportTotal(req.user, req.query);
  const headers = [
    'رقم الطلب', 'الزبون', 'الهاتف', 'المزود', 'الخدمة', 'المحافظة',
    'الحالة', 'المبلغ', 'حصة المنصة', 'حصة الوكيل', 'تاريخ الإنشاء',
  ];
  const rowToLine = (o) => [
    o.order_number,
    o.customer_name_ref || o.customer_name || '',
    o.customer_phone || '',
    o.provider_name,
    o.service_name_ar,
    o.governorate_name_ar || '',
    o.status,
    o.total_amount,
    o.platform_amount,
    o.agent_amount,
    o.created_at,
  ].map(csvEscape).join(',');

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="orders-${Date.now()}.csv"`);
  res.write('﻿' + headers.map(csvEscape).join(',') + '\r\n');

  const pages = Math.ceil(Math.min(total, maxRows) / EXPORT_BATCH);
  let emitted = 0;
  for (let page = 0; page < pages; page++) {
    const rows = orders.getOrderExportRows(req.user, req.query, EXPORT_BATCH, page * EXPORT_BATCH);
    for (const o of rows) {
      if (emitted >= maxRows) break;
      res.write(rowToLine(o) + '\r\n');
      emitted++;
    }
  }
  if (emitted < total) {
    res.write(csvEscape(`... تم تصدير ${emitted} صف من ${total} — اقتُطع التصدير، زد ?limit (الأقصى ${MAX_EXPORT_ROWS})`) + '\r\n');
  }
  return res.end();
};

const getHandler = (req, res) => {
  ok(res, orders.getOrderById(req.user, req.params.id));
};

const createHandler = (req, res, next) => {
  try {
    const r = orders.createOrder(req.user, req.body, req.headers);
    if (r.reused) return ok(res, r.result);
    return created(res, r.result);
  } catch (e: any) { next(e); }
};

const statusHandler = (req, res, next) => {
  try {
    ok(res, orders.updateOrderStatus(req.user, req.params.id, req.body));
  } catch (e: any) { next(e); }
};

router.get('/', requirePermissionForAdmin('orders', 'view'), listHandler);
router.get('/stats', requirePermissionForAdmin('orders', 'view'), statsHandler);
router.get('/export', requirePermissionForAdmin('orders', 'export'), exportHandler);
router.get('/:id', requirePermissionForAdmin('orders', 'view'), getHandler);
router.post('/', requireAgentLease(), requirePermissionForAdmin('orders', 'create'), createHandler);
router.put('/:id/status', requireAgentLease(), requirePermissionForAdmin('orders', 'edit'), statusHandler);

module.exports = router;
