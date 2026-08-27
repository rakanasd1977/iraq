const express = require('express');
const { ok, created } = require('../utils/response');
const { authenticate } = require('../middleware/auth');
const { requireRole, requirePermissionForAdmin } = require('../middleware/rbac');
const gov = require('../services/governorates');

const router = express.Router();
router.use(authenticate);

const list = (req, res, next) => {
  try { ok(res, gov.listGovernorates(req.query.active)); } catch (e: any) { next(e); }
};
const getOne = (req, res, next) => {
  try { ok(res, gov.getGovernorate(req.params.id)); } catch (e: any) { next(e); }
};
const create = (req, res, next) => {
  try { created(res, gov.createGovernorate(req.body, req.user)); } catch (e: any) { next(e); }
};
const update = (req, res, next) => {
  try { ok(res, gov.updateGovernorate(req.params.id, req.body, req.user)); } catch (e: any) { next(e); }
};
const remove = (req, res, next) => {
  try { ok(res, gov.deleteGovernorate(req.params.id, req.user)); } catch (e: any) { next(e); }
};
const toggle = (req, res, next) => {
  try { ok(res, gov.toggleGovernorate(req.params.id, req.user)); } catch (e: any) { next(e); }
};

router.get('/', requirePermissionForAdmin('governorates', 'view'), list);
router.get('/:id', requirePermissionForAdmin('governorates', 'view'), getOne);
router.post('/', requireRole('admin'), requirePermissionForAdmin('governorates', 'create'), create);
router.put('/:id', requireRole('admin'), requirePermissionForAdmin('governorates', 'edit'), update);
router.delete('/:id', requireRole('admin'), requirePermissionForAdmin('governorates', 'delete'), remove);
router.post('/:id/toggle', requireRole('admin'), requirePermissionForAdmin('governorates', 'edit'), toggle);

module.exports = router;
