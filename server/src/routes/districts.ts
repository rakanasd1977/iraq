const express = require('express');
const { ok, created } = require('../utils/response');
const { authenticate } = require('../middleware/auth');
const { requireRole, requirePermissionForAdmin } = require('../middleware/rbac');
const districts = require('../services/districts');

const router = express.Router();
router.use(authenticate);

const list = (req, res, next) => {
  try { ok(res, districts.listDistricts(req.query)); } catch (e: any) { next(e); }
};
const getOne = (req, res, next) => {
  try { ok(res, districts.getDistrict(req.params.id)); } catch (e: any) { next(e); }
};
const create = (req, res, next) => {
  try { created(res, districts.createDistrict(req.body, req.user)); } catch (e: any) { next(e); }
};
const update = (req, res, next) => {
  try { ok(res, districts.updateDistrict(req.params.id, req.body, req.user)); } catch (e: any) { next(e); }
};
const remove = (req, res, next) => {
  try { ok(res, districts.deleteDistrict(req.params.id, req.user)); } catch (e: any) { next(e); }
};
const toggle = (req, res, next) => {
  try { ok(res, districts.toggleDistrict(req.params.id, req.user)); } catch (e: any) { next(e); }
};

router.get('/', requirePermissionForAdmin('districts', 'view'), list);
router.get('/:id', requirePermissionForAdmin('districts', 'view'), getOne);
router.post('/', requireRole('admin'), requirePermissionForAdmin('districts', 'create'), create);
router.put('/:id', requireRole('admin'), requirePermissionForAdmin('districts', 'edit'), update);
router.delete('/:id', requireRole('admin'), requirePermissionForAdmin('districts', 'delete'), remove);
router.post('/:id/toggle', requireRole('admin'), requirePermissionForAdmin('districts', 'edit'), toggle);

module.exports = router;
