const express = require('express');
const { authenticate } = require('../middleware/auth');
const { requireRole, requirePermissionForAdmin } = require('../middleware/rbac');
const { ok } = require('../utils/response');
const svc = require('../services/admin-reviews');

const router = express.Router();

router.use(authenticate, requireRole('admin'));

router.get('/', requirePermissionForAdmin('reviews', 'view'), (req, res, next) => {
  try {
    const { scope = 'item', q, provider_id, rating, page, limit } = req.query;
    ok(res, svc.listReviews({
      scope, q, provider_id, rating: rating ? Number(rating) : undefined,
      page: page ? Number(page) : undefined, limit: limit ? Number(limit) : undefined,
    }));
  } catch (e) { next(e); }
});

router.delete('/:scope/:id', requirePermissionForAdmin('reviews', 'delete'), (req, res, next) => {
  try {
    const scope = req.params.scope === 'provider' ? 'provider' : 'item';
    ok(res, svc.deleteReview(scope, req.params.id, req.user));
  } catch (e) { next(e); }
});

module.exports = router;
