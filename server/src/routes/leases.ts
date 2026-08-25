const express = require('express');
const router = express.Router();
const { ok } = require('../utils/response');
const { authenticate } = require('../middleware/auth');
const { requireRole, requirePermissionForAdmin } = require('../middleware/rbac');
const leases = require('../services/leases');

router.use(authenticate, requireRole('admin'));

const listHandler = (req, res) => {
  const { rows, meta } = leases.listLeases(req.query);
  ok(res, rows, meta);
};

const createHandler = (req, res, next) => {
  try {
    const r = leases.createLease(req.user, req.body);
    ok(res, r.row, { created: r.created });
  } catch (e: any) { next(e); }
};

const updateHandler = (req, res, next) => {
  try {
    ok(res, leases.updateLease(req.user, req.params.id, req.body));
  } catch (e: any) { next(e); }
};

const cancelHandler = (req, res, next) => {
  try {
    ok(res, leases.cancelLease(req.user, req.params.id, req.body));
  } catch (e: any) { next(e); }
};

const agentLeasesHandler = (req, res, next) => {
  try {
    ok(res, leases.listAgentLeases(req.params.agentId, req.query));
  } catch (e: any) { next(e); }
};

const approveHandler = (req, res, next) => {
  try {
    ok(res, leases.approveLease(req.user, req.params.id));
  } catch (e: any) { next(e); }
};

const rejectHandler = (req, res, next) => {
  try {
    ok(res, leases.rejectLease(req.user, req.params.id, req.body));
  } catch (e: any) { next(e); }
};

router.get('/', requirePermissionForAdmin('leases', 'view'), listHandler);
router.post('/', requirePermissionForAdmin('leases', 'create'), createHandler);
router.put('/:id', requirePermissionForAdmin('leases', 'edit'), updateHandler);
router.post('/:id/cancel', requirePermissionForAdmin('leases', 'edit'), cancelHandler);
router.get('/agent/:agentId', requirePermissionForAdmin('leases', 'view'), agentLeasesHandler);
router.post('/:id/approve', requirePermissionForAdmin('leases', 'edit'), approveHandler);
router.post('/:id/reject', requirePermissionForAdmin('leases', 'edit'), rejectHandler);

module.exports = router;
