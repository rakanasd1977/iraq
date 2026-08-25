const express = require('express');
const { ApiError } = require('../utils/helpers');
const { ok, created } = require('../utils/response');
const { authenticate } = require('../middleware/auth');
const { requireRole } = require('../middleware/rbac');
const { get } = require('../db');
const { mountCatalog } = require('./catalog');
const provider = require('../services/provider');

const router = express.Router();
router.use(authenticate, requireRole('provider'));

// يرفق بيانات حساب المزود الحالي بكل الطلبات
router.use((req, res, next) => {
  try {
    const p = get(
      `SELECT p.*, s.slug AS service_slug, s.name_ar AS service_name_ar, s.icon AS service_icon,
              g.name_ar AS governorate_name_ar, g.code AS governorate_code
       FROM providers p
       JOIN services s ON s.id = p.service_id
       JOIN governorates g ON g.id = p.governorate_id
       WHERE p.id = ?`,
      [req.user.provider_id]
    );
    if (!p) throw new ApiError(403, 'حساب مزود الخدمة غير مكتمل');
    if (!p.is_active) throw new ApiError(403, 'حساب مزود الخدمة موقوف، تواصل مع المسؤول');
    req.provider = p;
    next();
  } catch (e: any) { next(e); }
});

// أقسام الفهرس (منتجات/أصناف/غرف/رحلات/باقات) — منفصلة في routes/catalog
mountCatalog(router);

const catalogNetHandler = (req, res, next) => {
  try { ok(res, provider.getCatalogNet(req.provider)); } catch (e: any) { next(e); }
};

const dashboardHandler = (req, res, next) => {
  try { ok(res, provider.getDashboard(req.provider)); } catch (e: any) { next(e); }
};

const profileGetHandler = (req, res, next) => {
  try { ok(res, provider.getProfile(req.provider)); } catch (e: any) { next(e); }
};

const profilePutHandler = (req, res, next) => {
  try { ok(res, provider.updateProfile(req.provider, req.user, req.body)); } catch (e: any) { next(e); }
};

const bookingsHandler = (req, res, next) => {
  try {
    const { rows, meta } = provider.listBookings(req.provider, req.query);
    ok(res, rows, meta);
  } catch (e: any) { next(e); }
};

const ordersSummaryHandler = (req, res, next) => {
  try { ok(res, provider.getOrdersSummary(req.provider)); } catch (e: any) { next(e); }
};

const roomsAvailabilityHandler = (req, res, next) => {
  try { ok(res, provider.getRoomsAvailability(req.provider, req.query)); } catch (e: any) { next(e); }
};

const ratingsHandler = (req, res, next) => {
  try {
    const { rows, meta } = provider.listRatings(req.provider, req.query);
    ok(res, rows, meta);
  } catch (e: any) { next(e); }
};

const ratingReplyHandler = (req, res, next) => {
  try { ok(res, provider.replyRating(req.provider, req.user, req.params.id, req.body)); } catch (e: any) { next(e); }
};

const verificationGetHandler = (req, res, next) => {
  try { ok(res, provider.getVerification(req.provider)); } catch (e: any) { next(e); }
};

const verificationPutHandler = (req, res, next) => {
  try { ok(res, provider.submitVerification(req.provider, req.user, req.body)); } catch (e: any) { next(e); }
};

const couponsHandler = (req, res, next) => {
  try {
    const { rows, meta } = provider.listCoupons(req.provider, req.query);
    ok(res, rows, meta);
  } catch (e: any) { next(e); }
};

const couponsPostHandler = (req, res, next) => {
  try { created(res, provider.createCoupon(req.provider, req.user, req.body)); } catch (e: any) { next(e); }
};

const couponPutHandler = (req, res, next) => {
  try { ok(res, provider.updateCoupon(req.provider, req.user, req.params.id, req.body)); } catch (e: any) { next(e); }
};

const couponToggleHandler = (req, res, next) => {
  try { ok(res, provider.toggleCoupon(req.provider, req.user, req.params.id)); } catch (e: any) { next(e); }
};

const couponDeleteHandler = (req, res, next) => {
  try { ok(res, provider.deleteCoupon(req.provider, req.user, req.params.id)); } catch (e: any) { next(e); }
};

router.get('/catalog-net', catalogNetHandler);
router.get('/dashboard', dashboardHandler);
router.get('/profile', profileGetHandler);
router.put('/profile', profilePutHandler);
router.get('/bookings', bookingsHandler);
router.get('/orders-summary', ordersSummaryHandler);
router.get('/rooms/availability', roomsAvailabilityHandler);
router.get('/ratings', ratingsHandler);
router.put('/ratings/:id/reply', ratingReplyHandler);
router.get('/verification', verificationGetHandler);
router.put('/verification', verificationPutHandler);
router.get('/coupons', couponsHandler);
router.post('/coupons', couponsPostHandler);
router.put('/coupons/:id', couponPutHandler);
router.post('/coupons/:id/toggle', couponToggleHandler);
router.delete('/coupons/:id', couponDeleteHandler);

module.exports = router;
