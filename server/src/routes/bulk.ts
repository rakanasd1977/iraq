const express = require('express');
const multer = require('multer');
const { ApiError, csvEscape } = require('../utils/helpers');
const { ok } = require('../utils/response');
const { authenticate } = require('../middleware/auth');
const { requireRole, requirePermissionForAdmin } = require('../middleware/rbac');
const { logActivity } = require('../utils/log');
const bulk = require('../services/bulk');

const router = express.Router();
router.use(authenticate, requireRole('admin'));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'text/csv' || file.originalname.endsWith('.csv')) {
      cb(null, true);
    } else {
      cb(new ApiError(400, 'يجب أن يكون الملف بصيغة CSV'));
    }
  },
});

const templateHandler = (req, res, next) => {
  try {
    const tmpl = bulk.getTemplate(req.params.entity);
    const csv = [tmpl.headers.join(','), ...tmpl.sample.map((r) => tmpl.headers.map((h) => r[h] || '').map((v) => csvEscape(v)).join(','))].join('\n');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${req.params.entity}-template.csv"`);
    res.send('\uFEFF' + csv);
  } catch (e: any) { next(e); }
};

const previewHandler = async (req, res, next) => {
  try {
    if (!req.file) throw new ApiError(400, 'لم يتم رفع ملف');
    const results = await bulk.parseCSV(req.file.buffer);
    const validation = bulk.validateRows(req.params.entity, results.rows);
    return ok(res, {
      total: results.rows.length,
      valid: validation.valid.length,
      invalid: validation.invalid.length,
      preview: validation.valid.slice(0, 50),
      errors: validation.invalid.slice(0, 100),
    });
  } catch (e: any) { next(e); }
};

const importHandler = async (req, res, next) => {
  try {
    if (!req.file) throw new ApiError(400, 'لم يتم رفع ملف');
    const skipErrors = req.body && req.body.skipErrors === 'true';
    const results = await bulk.parseCSV(req.file.buffer);
    const validation = bulk.validateRows(req.params.entity, results.rows);

    if (validation.invalid.length > 0 && !skipErrors) {
      return res.status(400).json({
        error: 'يوجد أخطاء في البيانات. استخدم skipErrors=true لتخطي الصفوف الخاطئة.',
        invalidCount: validation.invalid.length,
        errors: validation.invalid.slice(0, 50),
      });
    }

    const imported = bulk.importRows(req.params.entity, validation.valid, req.user.id);
    logActivity(req.user, 'bulk_import', req.params.entity, null, { entity: req.params.entity, count: imported.count, skipped: validation.invalid.length });
    return ok(res, imported);
  } catch (e: any) { next(e); }
};

const exportHandler = (req, res, next) => {
  try {
    const { rows, headers } = bulk.exportEntity(req.params.entity, req.query);
    const csv = [headers.join(','), ...rows.map((r) => headers.map((h) => csvEscape(r[h] || '')).join(','))].join('\n');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${req.params.entity}-export-${new Date().toISOString().slice(0, 10)}.csv"`);
    res.send('\uFEFF' + csv);
  } catch (e: any) { next(e); }
};

router.get('/template/:entity', requirePermissionForAdmin('bulk', 'view'), templateHandler);
router.post('/preview/:entity', upload.single('file'), requirePermissionForAdmin('bulk', 'view'), previewHandler);
router.post('/import/:entity', upload.single('file'), requirePermissionForAdmin('bulk', 'create'), importHandler);
router.get('/export/:entity', requirePermissionForAdmin('bulk', 'export'), exportHandler);

module.exports = router;
