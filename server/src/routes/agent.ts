const express = require('express');
const { ok, created } = require('../utils/response');
const { authenticate } = require('../middleware/auth');
const { requireRole, requireAgentLease } = require('../middleware/rbac');
const { csvEscape, round2 } = require('../utils/helpers');
const {
  getLease,
  renewLease,
  getCommissions,
  getDashboard,
  getDashboardExportData,
  listCustomers,
  getCustomersExportRows,
  getWallet,
  requestWithdrawal,
  getCommissionExportRows,
  getWalletExportData,
  broadcastToProviders,
  remindPendingOrders,
  getActivity,
} = require('../services/agent');

const router = express.Router();
router.use(authenticate, requireRole('agent'));

router.get('/lease', (req, res, next) => {
  try { return ok(res, getLease(req.user)); } catch (e: any) { next(e); }
});

router.post('/lease/renew', (req, res, next) => {
  try { return created(res, renewLease(req.user)); } catch (e: any) { next(e); }
});

router.get('/commissions', (req, res, next) => {
  try { return ok(res, getCommissions(req.user)); } catch (e: any) { next(e); }
});

router.get('/dashboard', (req, res, next) => {
  try { return ok(res, getDashboard(req.user)); } catch (e: any) { next(e); }
});

router.get('/dashboard/export', (req, res, next) => {
  try {
    const { gov, orders, byStatus, byService, monthly, topCustomers } = getDashboardExportData(req.user);

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="agent-dashboard-${Date.now()}.csv"`);
    const L = [];
    const pushRow = (cols) => L.push(cols.map(csvEscape).join(','));
    L.push(`لوحة الوكيل — محافظة ${gov.name_ar},تصدير ${new Date().toISOString().slice(0, 10)}`);
    pushRow(['إجمالي الطلبات', orders.c]);
    pushRow(['قيمة الطلبات (دينار)', round2(orders.value)]);
    pushRow(['أرباحي من العمولات (دينار)', round2(orders.agent_revenue)]);
    pushRow(['إيراد المنصة (دينار)', round2(orders.platform_revenue)]);
    L.push('');
    pushRow(['الطلبات حسب الحالة', 'العدد']);
    for (const s of byStatus) pushRow([s.status, s.count]);
    L.push('');
    pushRow(['الخدمة', 'عدد المزودين']);
    for (const s of byService) pushRow([s.name_ar, s.providers_count]);
    L.push('');
    pushRow(['الشهر', 'عدد الطلبات', 'القيمة (دينار)', 'عمولتي (دينار)']);
    for (const m of monthly) pushRow([m.month, m.orders_count, round2(m.orders_value), round2(m.commission)]);
    L.push('');
    pushRow(['الزبون', 'الهاتف', 'الطلبات', 'إجمالي المشتريات (دينار)']);
    for (const c of topCustomers) pushRow([c.name, c.phone || '', c.orders_count, round2(c.total_value)]);
    return res.send('﻿' + L.join('\r\n') + '\r\n');
  } catch (e: any) { next(e); }
});

router.get('/customers', (req, res, next) => {
  try {
    const { rows, meta } = listCustomers(req.user, req.query);
    return ok(res, rows, meta);
  } catch (e: any) { next(e); }
});

router.get('/customers/export', (req, res, next) => {
  try {
    const rows = getCustomersExportRows(req.user, req.query);

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="customers-${Date.now()}.csv"`);
    res.write('﻿' + ['الاسم', 'الهاتف', 'البريد', 'عدد الطلبات', 'إجمالي المشتريات (دينار)', 'طلبات معلقة', 'آخر طلب', 'مسجل من تاريخ'].map(csvEscape).join(',') + '\r\n');
    for (const r of rows) {
      res.write([r.name, r.phone, r.email || '', r.orders_count, round2(r.total_value), r.pending_count, r.last_order_at || '', r.registered_at || ''].map(csvEscape).join(',') + '\r\n');
    }
    return res.end();
  } catch (e: any) { next(e); }
});

router.get('/wallet', (req, res, next) => {
  try { return ok(res, getWallet(req.user)); } catch (e: any) { next(e); }
});

router.post('/wallet/withdraw', requireAgentLease(), (req, res, next) => {
  try { return created(res, requestWithdrawal(req.user, req.body)); } catch (e: any) { next(e); }
});

router.get('/commissions/export', (req, res, next) => {
  try {
    const rows = getCommissionExportRows(req.user, req.query);

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="commissions-${Date.now()}.csv"`);
    res.write('﻿' + ['رقم الطلب', 'التاريخ', 'المزود', 'الخدمة', 'الزبون', 'المبلغ (دينار)', 'نسبة العمولة', 'عمولتي (دينار)', 'عمولة المنصة (دينار)', 'الحالة'].map(csvEscape).join(',') + '\r\n');
    for (const o of rows) {
      res.write([o.order_number, o.created_at, o.provider_name, o.service_name, o.customer_name || '',
        round2(o.total_amount), `${o.commission_rate}%`, round2(o.agent_amount), round2(o.platform_amount), o.status].map(csvEscape).join(',') + '\r\n');
    }
    return res.end();
  } catch (e: any) { next(e); }
});

router.get('/wallet/export', (req, res, next) => {
  try {
    const { type, rows } = getWalletExportData(req.user, req.query.type);

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="wallet-${type}-${Date.now()}.csv"`);

    if (type === 'income') {
      res.write('﻿' + ['رقم الطلب', 'المزود', 'عمولتي (دينار)', 'التاريخ'].map(csvEscape).join(',') + '\r\n');
      for (const o of rows) {
        res.write([o.order_number, o.provider_name, round2(o.agent_amount), o.created_at].map(csvEscape).join(',') + '\r\n');
      }
    } else {
      res.write('﻿' + ['رقم السحب', 'المبلغ (دينار)', 'الحالة', 'الملاحظات', 'التاريخ', 'تاريخ القرار'].map(csvEscape).join(',') + '\r\n');
      for (const w of rows) {
        res.write([w.id, round2(w.amount), w.status, w.notes || '', w.created_at, w.decided_at || ''].map(csvEscape).join(',') + '\r\n');
      }
    }
    return res.end();
  } catch (e: any) { next(e); }
});

router.post('/providers/broadcast', requireAgentLease(), async (req, res, next) => {
  try { return ok(res, await broadcastToProviders(req.user, req.body)); } catch (e: any) { next(e); }
});

router.post('/orders/remind-pending', requireAgentLease(), async (req, res, next) => {
  try { return ok(res, await remindPendingOrders(req.user)); } catch (e: any) { next(e); }
});

router.get('/activity', (req, res, next) => {
  try {
    const { rows, meta } = getActivity(req.user, req.query);
    return ok(res, rows, meta);
  } catch (e: any) { next(e); }
});

module.exports = router;
