const express = require('express');
const router = express.Router();
const { ok } = require('../utils/response');
const { authenticate } = require('../middleware/auth');
const { requireRole, requirePermissionForAdmin } = require('../middleware/rbac');
const backups = require('../services/backups');

router.use(authenticate);

router.get('/', requireRole('admin'), requirePermissionForAdmin('backups', 'view'), (req, res, next) => {
  try {
    ok(res, backups.listBackups());
  } catch (e: any) { next(e); }
});

router.post('/', requireRole('admin'), requirePermissionForAdmin('backups', 'create'), (req, res, next) => {
  try {
    ok(res, backups.createBackup());
  } catch (e: any) { next(e); }
});

router.get('/:name', requireRole('admin'), requirePermissionForAdmin('backups', 'view'), (req, res, next) => {
  try {
    const { path, name } = backups.downloadBackup(req.params.name);
    res.download(path, name);
  } catch (e: any) { next(e); }
});

router.post('/:name/restore', requireRole('admin'), requirePermissionForAdmin('backups', 'restore'), (req, res, next) => {
  try {
    ok(res, backups.restoreBackup(req.params.name));
  } catch (e: any) { next(e); }
});

router.post('/:name/upload', requireRole('admin'), requirePermissionForAdmin('backups', 'create'), (req, res, next) => {
  backups.uploadToCloud(req.params.name).then((r) => ok(res, r)).catch((e) => next(e));
});

router.delete('/:name', requireRole('admin'), requirePermissionForAdmin('backups', 'delete'), (req, res, next) => {
  try {
    ok(res, backups.deleteBackup(req.params.name));
  } catch (e: any) { next(e); }
});

module.exports = router;
