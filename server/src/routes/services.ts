const express = require('express');
const { ok, created } = require('../utils/response');
const { authenticate } = require('../middleware/auth');
const { requireRole, requirePermissionForAdmin } = require('../middleware/rbac');
const svc = require('../services/services');

const router = express.Router();
router.use(authenticate);

const list = (req, res, next) => {
  try { ok(res, svc.listServices()); } catch (e: any) { next(e); }
};
const create = (req, res, next) => {
  try { created(res, svc.createService(req.body, req.user)); } catch (e: any) { next(e); }
};
const update = (req, res, next) => {
  try { ok(res, svc.updateService(req.params.id, req.body, req.user)); } catch (e: any) { next(e); }
};
const toggle = (req, res, next) => {
  try { ok(res, svc.toggleService(req.params.id, req.user)); } catch (e: any) { next(e); }
};
const remove = (req, res, next) => {
  try { ok(res, svc.deleteService(req.params.id, req.user)); } catch (e: any) { next(e); }
};

router.get('/', requirePermissionForAdmin('services', 'view'), list);
router.post('/', requireRole('admin'), requirePermissionForAdmin('services', 'create'), create);
router.put('/:id', requireRole('admin'), requirePermissionForAdmin('services', 'edit'), update);
router.post('/:id/toggle', requireRole('admin'), requirePermissionForAdmin('services', 'edit'), toggle);
router.delete('/:id', requireRole('admin'), requirePermissionForAdmin('services', 'delete'), remove);

module.exports = router;
