const express = require('express');
const router = express.Router();
const { ok } = require('../utils/response');
const { authenticate } = require('../middleware/auth');
const { requireRole, requirePermissionForAdmin } = require('../middleware/rbac');
const recharges = require('../services/recharges');

router.use(authenticate);

const listHandler = (req, res, next) => {
  try {
    const { rows, meta } = recharges.listRecharges(req.query);
    ok(res, rows, meta);
  } catch (e: any) { next(e); }
};

const providerHandler = (req, res, next) => {
  try {
    ok(res, recharges.listProviderRecharges(req.user));
  } catch (e: any) { next(e); }
};

const getHandler = (req, res, next) => {
  try {
    ok(res, recharges.getRecharge(req.user, req.params.id));
  } catch (e: any) { next(e); }
};

const createHandler = (req, res, next) => {
  try {
    ok(res, recharges.createRecharge(req.user, req.body));
  } catch (e: any) { next(e); }
};

const approveHandler = (req, res, next) => {
  try {
    ok(res, recharges.approveRecharge(req.user, req.params.id));
  } catch (e: any) { next(e); }
};

const rejectHandler = (req, res, next) => {
  try {
    ok(res, recharges.rejectRecharge(req.user, req.params.id, req.body));
  } catch (e: any) { next(e); }
};

router.get('/', requireRole('admin'), requirePermissionForAdmin('recharges', 'view'), listHandler);
router.get('/provider', providerHandler);
router.get('/:id', requirePermissionForAdmin('recharges', 'view'), getHandler);
router.post('/', requirePermissionForAdmin('recharges', 'create'), createHandler);
router.post('/:id/approve', requireRole('admin'), requirePermissionForAdmin('recharges', 'edit'), approveHandler);
router.post('/:id/reject', requireRole('admin'), requirePermissionForAdmin('recharges', 'edit'), rejectHandler);

module.exports = router;
