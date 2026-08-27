const express = require('express');
const { get } = require('../db');
const { round2, csvEscape } = require('../utils/helpers');
const { ok } = require('../utils/response');
const { authenticate } = require('../middleware/auth');
const { requireRole, requirePermissionForAdmin } = require('../middleware/rbac');
const { createSharedRateLimiter } = require('../utils/rateLimit');
const {
  buildPromotionFilters,
  governorateCache,
  targetLabel,
  queryAllPromotionRows,
  listProviderPromotions,
  createProviderPromotion,
  extendProviderPromotion,
  endPromotion,
  listAdminItems,
  createAdminPromotion,
  listAllPromotions,
  listPublicPromotions,
  clickPromotion,
} = require('../services/promotions');

const EXPORT_BATCH = 500;
const MAX_EXPORT_ROWS = 5000;

const router = express.Router();
router.use(authenticate);

// ============ المزود: إدارة ترويجاته ============
router.get('/', requireRole('provider'), (req, res, next) => {
  try {
    const { rows, meta } = listProviderPromotions(req.user.provider_id, req.query);
    return ok(res, rows, meta);
  } catch (e: any) { next(e); }
});

router.post('/', requireRole('provider'), (req, res, next) => {
  try {
    return ok(res, createProviderPromotion(req.user, req.body));
  } catch (e: any) { next(e); }
});

router.post('/:id/extend', requireRole('provider'), (req, res, next) => {
  try {
    return ok(res, extendProviderPromotion(req.user, Number(req.params.id)));
  } catch (e: any) { next(e); }
});

router.delete('/:id', requireRole('provider', 'admin'), requirePermissionForAdmin('promotions', 'delete'), (req, res, next) => {
  try {
    return ok(res, endPromotion(req.user, Number(req.params.id)));
  } catch (e: any) { next(e); }
});

// ============ المسؤول ============
router.get('/admin/items', requireRole('admin'), requirePermissionForAdmin('promotions', 'view'), (req, res, next) => {
  try {
    return ok(res, listAdminItems(Number(req.query.provider_id), req.query.item_type));
  } catch (e: any) { next(e); }
});

router.post('/admin/create', requireRole('admin'), requirePermissionForAdmin('promotions', 'create'), (req, res, next) => {
  try {
    return ok(res, createAdminPromotion(req.user, req.body));
  } catch (e: any) { next(e); }
});

router.get('/all', requireRole('admin'), requirePermissionForAdmin('promotions', 'view'), (req, res, next) => {
  try {
    const { rows, meta } = listAllPromotions(req.query);
    return ok(res, rows, meta);
  } catch (e: any) { next(e); }
});

// ============ المسؤول: تصدير الإعلانات CSV (نفس فلاتر القائمة) ============
router.get('/all/export', requireRole('admin'), requirePermissionForAdmin('promotions', 'export'), (req, res, next) => {
  try {
    const { whereSql, params } = buildPromotionFilters(req.query);
    const maxRows = Math.min(Math.max(Number(req.query.limit) || MAX_EXPORT_ROWS, 1), MAX_EXPORT_ROWS);
    const total = get(`SELECT COUNT(*) AS c FROM promotions pr JOIN providers p ON p.id = pr.provider_id${whereSql}`, params).c;
    const cache = governorateCache();

    const headers = ['رقم الإعلان', 'اسم الإعلان', 'المزود', 'الخدمة', 'النطاق/المحافظة', 'السعر', 'التكلفة', 'الحالة', 'الظهور', 'النقرات', 'CTR%', 'البداية', 'النهاية'];
    const rowToLine = (r) => [
      r.id, r.item_title, r.provider_name, r.service_name_ar, r.target_label, r.item_price, r.cost, r.status, r.impressions, r.clicks, r.ctr, r.starts_at, r.ends_at,
    ].map(csvEscape).join(',');

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="promotions-${Date.now()}.csv"`);
    res.write('﻿' + headers.map(csvEscape).join(',') + '\r\n');

    const pages = Math.ceil(Math.min(total, maxRows) / EXPORT_BATCH);
    let emitted = 0;
    for (let page = 0; page < pages; page++) {
      const rows = queryAllPromotionRows(req.query, EXPORT_BATCH, page * EXPORT_BATCH);
      for (const r of rows) {
        if (emitted >= maxRows) break;
        const ri = Number(r.impressions) || 0;
        res.write(rowToLine({ ...r, ctr: ri > 0 ? round2((Number(r.clicks) / ri) * 100) : 0, target_label: targetLabel(r, cache) }) + '\r\n');
        emitted++;
      }
    }
    if (emitted < total) {
      res.write(csvEscape(`... اقتُطع التصدير عند ${emitted} صف من أصل ${total} — أضف فلاتر أو زد ?limit (الحد الأقصى ${MAX_EXPORT_ROWS})`) + '\r\n');
    }
    return res.end();
  } catch (e: any) { next(e); }
});

const publicRouter = express.Router();

// حدود مخففة للعدّادات العامة: تمنع البرمجة النصية من تضخيم الظهور/النقرات مع السماح بالاستخدام العادي
const impressionsLimiter = createSharedRateLimiter({ windowMs: 60000, max: 120, scope: 'promo-impressions', message: 'طلبات كثيرة، يرجى المحاولة بعد قليل' });
const clicksLimiter = createSharedRateLimiter({ windowMs: 60000, max: 30, scope: 'promo-clicks', message: 'نقرات كثيرة، يرجى المحاولة بعد قليل' });

publicRouter.get('/', impressionsLimiter, (req, res, next) => {
  try {
    return ok(res, listPublicPromotions(req.query));
  } catch (e: any) { next(e); }
});

publicRouter.post('/:id/click', clicksLimiter, (req, res, next) => {
  try {
    return ok(res, clickPromotion(Number(req.params.id)));
  } catch (e: any) { next(e); }
});

module.exports = { router, publicRouter };
