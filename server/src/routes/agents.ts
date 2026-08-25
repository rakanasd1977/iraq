const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const { requireRole, requirePermissionForAdmin } = require('../middleware/rbac');
const { ok, created } = require('../utils/response');
const agents = require('../services/agents');

router.use(authenticate, requireRole('admin'));

const listHandler = (req, res) => {
  const { rows, meta } = agents.listAgents(req.query);
  ok(res, rows, meta || {});
};

const getHandler = (req, res) => {
  ok(res, agents.getAgent(req.params.id));
};

const createHandler = async (req, res, next) => {
  try {
    created(res, await agents.createAgent(req.user, req.body));
  } catch (e: any) { next(e); }
};

const updateHandler = (req, res, next) => {
  try {
    ok(res, agents.updateAgent(req.user, req.params.id, req.body));
  } catch (e: any) { next(e); }
};

const deleteHandler = (req, res, next) => {
  try {
    ok(res, agents.deleteAgent(req.user, req.params.id));
  } catch (e: any) { next(e); }
};

const renewHandler = (req, res, next) => {
  try {
    ok(res, agents.renewLease(req.user, req.params.id, req.body));
  } catch (e: any) { next(e); }
};

const leasePaymentsHandler = (req, res, next) => {
  try {
    ok(res, agents.getLeasePayments(req.params.id));
  } catch (e: any) { next(e); }
};

router.get('/', requirePermissionForAdmin('agents', 'view'), listHandler);
router.get('/:id', requirePermissionForAdmin('agents', 'view'), getHandler);
router.post('/', requirePermissionForAdmin('agents', 'create'), createHandler);
router.put('/:id', requirePermissionForAdmin('agents', 'edit'), updateHandler);
router.delete('/:id', requirePermissionForAdmin('agents', 'delete'), deleteHandler);
router.post('/:id/renew-lease', requirePermissionForAdmin('agents', 'edit'), renewHandler);
router.get('/:id/lease-payments', requirePermissionForAdmin('agents', 'view'), leasePaymentsHandler);

module.exports = router;
