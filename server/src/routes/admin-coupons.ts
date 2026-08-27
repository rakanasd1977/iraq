const express = require('express');
const { authenticate } = require('../middleware/auth');
const { requireRole, requirePermissionForAdmin } = require('../middleware/rbac');
const { ok, created } = require('../utils/response');
const svc = require('../services/admin-coupons');

const router = express.Router();

router.use(authenticate, requireRole('admin'));

router.get('/', requirePermissionForAdmin('coupons', 'view'), (req, res, next) => {
  try {
    const { q, provider_id, active, page, limit } = req.query;
    ok(res, svc.listCoupons({ q, provider_id, active, page: page ? Number(page) : undefined, limit: limit ? Number(limit) : undefined }));
  } catch (e) { next(e); }
});

router.get('/:id', requirePermissionForAdmin('coupons', 'view'), (req, res, next) => {
  try { ok(res, svc.getCoupon(req.params.id)); } catch (e) { next(e); }
});

router.post('/', requirePermissionForAdmin('coupons', 'create'), (req, res, next) => {
  try { created(res, svc.createCoupon(req.body || {}, req.user)); } catch (e) { next(e); }
});

router.put('/:id', requirePermissionForAdmin('coupons', 'edit'), (req, res, next) => {
  try { ok(res, svc.updateCoupon(req.params.id, req.body || {}, req.user)); } catch (e) { next(e); }
});

router.post('/:id/toggle', requirePermissionForAdmin('coupons', 'edit'), (req, res, next) => {
  try { ok(res, svc.toggleCoupon(req.params.id, req.user)); } catch (e) { next(e); }
});

router.delete('/:id', requirePermissionForAdmin('coupons', 'delete'), (req, res, next) => {
  try { ok(res, svc.deleteCoupon(req.params.id, req.user)); } catch (e) { next(e); }
});

module.exports = router;
