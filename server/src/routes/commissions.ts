const express = require('express');
const router = express.Router();
const { ok } = require('../utils/response');
const { authenticate } = require('../middleware/auth');
const { requireRole, requirePermissionForAdmin } = require('../middleware/rbac');
const commissions = require('../services/commissions');

router.use(authenticate, requireRole('admin'));

const getHandler = (req, res) => {
  ok(res, commissions.getCommissions());
};

const putHandler = (req, res, next) => {
  try {
    ok(res, commissions.updateCommissions(req.user, req.body));
  } catch (e: any) { next(e); }
};

router.get('/', requirePermissionForAdmin('commissions', 'view'), getHandler);
router.put('/', requirePermissionForAdmin('commissions', 'edit'), putHandler);

module.exports = router;
