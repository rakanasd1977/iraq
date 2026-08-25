const express = require('express');
const { ok } = require('../utils/response');
const { authenticate } = require('../middleware/auth');
const { requireRole, requirePermissionForAdmin } = require('../middleware/rbac');
const aw = require('../services/agent-withdrawals');

const router = express.Router();
router.use(authenticate, requireRole('admin'));

const list = (req, res, next) => {
  try {
    const { rows, total, page, limit, pages } = aw.listWithdrawals(req.query);
    return ok(res, rows, { total, page, limit, pages });
  } catch (e: any) { next(e); }
};
const decide = (req, res, next) => {
  try { ok(res, aw.decideWithdrawal(req.params.id, req.body, req.user)); } catch (e: any) { next(e); }
};

router.get('/', requirePermissionForAdmin('withdrawals', 'view'), list);
router.post('/:id/decision', requirePermissionForAdmin('withdrawals', 'edit'), decide);

module.exports = router;
