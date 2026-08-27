const express = require('express');
const { authenticate } = require('../middleware/auth');
const { requireRole, requirePermissionForAdmin } = require('../middleware/rbac');
const { ok, created } = require('../utils/response');
const svc = require('../services/admin-catalog');

const router = express.Router();

router.use(authenticate, requireRole('admin'));

router.get('/kinds', requirePermissionForAdmin('catalog', 'view'), (req, res) => {
  ok(res, svc.ALL_KINDS.map((k) => ({ key: k, label: svc.kindDef(k).label })));
});

router.get('/', requirePermissionForAdmin('catalog', 'view'), (req, res, next) => {
  try {
    const { kind = 'products', provider_id, q, active, page, limit } = req.query;
    ok(res, svc.listCatalog({ kind, provider_id, q, active, page: page ? Number(page) : undefined, limit: limit ? Number(limit) : undefined }));
  } catch (e) { next(e); }
});

router.get('/:kind/:id', requirePermissionForAdmin('catalog', 'view'), (req, res, next) => {
  try {
    ok(res, svc.getCatalogItem(req.params.kind, req.params.id));
  } catch (e) { next(e); }
});

router.put('/:kind/:id', requirePermissionForAdmin('catalog', 'edit'), (req, res, next) => {
  try {
    ok(res, svc.updateCatalogItem(req.params.kind, req.params.id, req.body || {}, req.user));
  } catch (e) { next(e); }
});

router.post('/:kind/:id/toggle', requirePermissionForAdmin('catalog', 'edit'), (req, res, next) => {
  try {
    ok(res, svc.toggleCatalogItem(req.params.kind, req.params.id, req.user));
  } catch (e) { next(e); }
});

router.delete('/:kind/:id', requirePermissionForAdmin('catalog', 'delete'), (req, res, next) => {
  try {
    ok(res, svc.deleteCatalogItem(req.params.kind, req.params.id, req.user));
  } catch (e) { next(e); }
});

module.exports = router;
