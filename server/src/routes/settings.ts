const express = require('express');
const { ok } = require('../utils/response');
const { authenticate } = require('../middleware/auth');
const { requireRole, requirePermissionForAdmin } = require('../middleware/rbac');
const settings = require('../services/settings');

const router = express.Router();
router.use(authenticate, requireRole('admin'));

const list = (req, res, next) => {
  try { ok(res, settings.listSettings()); } catch (e: any) { next(e); }
};
const bulkUpdate = (req, res, next) => {
  try { ok(res, settings.putSettings(req.body, req.user)); } catch (e: any) { next(e); }
};
const updateOne = (req, res, next) => {
  try { ok(res, settings.putSetting(req.params.key, req.body && req.body.value, req.body && req.body.label, req.user)); } catch (e: any) { next(e); }
};
const getOne = (req, res, next) => {
  try { ok(res, settings.getSetting(req.params.key)); } catch (e: any) { next(e); }
};

router.get('/', requirePermissionForAdmin('settings', 'view'), list);
router.put('/', requirePermissionForAdmin('settings', 'edit'), bulkUpdate);
router.put('/:key', requirePermissionForAdmin('settings', 'edit'), updateOne);
router.get('/:key', requirePermissionForAdmin('settings', 'view'), getOne);

module.exports = router;
