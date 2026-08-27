const express = require('express');
const { authenticate } = require('../middleware/auth');
const { requireRole, requirePermissionForAdmin } = require('../middleware/rbac');
const { ok } = require('../utils/response');
const svc = require('../services/admin-notify');

const router = express.Router();

router.use(authenticate, requireRole('admin'));

router.post('/send', requirePermissionForAdmin('notifications', 'create'), async (req, res, next) => {
  try {
    ok(res, await svc.sendNotification(req.body || {}, req.user));
  } catch (e) { next(e); }
});

module.exports = router;
