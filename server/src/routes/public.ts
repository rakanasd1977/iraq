const express = require('express');
const { ok } = require('../utils/response');
const { authenticate } = require('../middleware/auth');
const { requireRole } = require('../middleware/rbac');
const { parseLocale } = require('../utils/locale');
const pub = require('../services/public');

const router = express.Router();

const paymentInfoHandler = (req, res, next) => {
  try { ok(res, pub.getPaymentInfo()); } catch (e: any) { next(e); }
};

const governoratesHandler = (req, res, next) => {
  try { ok(res, pub.getGovernorates(parseLocale(req))); } catch (e: any) { next(e); }
};

// تحديد المحافظة تلقائياً من إحداثيات الزبون (يُستخدم في الكشف التلقائي حسب التواجد)
const governorateByGeoHandler = (req, res, next) => {
  try { ok(res, pub.getGovernorateByGeo(req.query.lat, req.query.lng)); } catch (e: any) { next(e); }
};

const couponsHandler = (req, res, next) => {
  try { ok(res, pub.getCoupons()); } catch (e: any) { next(e); }
};

const configHandler = (req, res, next) => {
  try { ok(res, pub.getConfig()); } catch (e: any) { next(e); }
};

const servicesHandler = (req, res, next) => {
  try { ok(res, pub.getServices(req.query, parseLocale(req))); } catch (e: any) { next(e); }
};

const providersHandler = (req, res, next) => {
  try {
    const { rows, meta } = pub.listProviders(req.query, parseLocale(req));
    ok(res, rows, meta);
  } catch (e: any) { next(e); }
};

const providerDetailHandler = (req, res, next) => {
  try { ok(res, pub.getProviderDetail(req.params.id, parseLocale(req))); } catch (e: any) { next(e); }
};

const providerReviewsHandler = (req, res, next) => {
  try { ok(res, pub.getProviderReviews(req.params.id, req.query)); } catch (e: any) { next(e); }
};

const providerCategoriesHandler = (req, res, next) => {
  try { ok(res, pub.getProviderCategories(req.params.id, parseLocale(req))); } catch (e: any) { next(e); }
};

const providerProductsHandler = (req, res, next) => {
  try {
    const { rows, meta } = pub.getProviderProducts(req.params.id, req.query, parseLocale(req));
    ok(res, rows, meta);
  } catch (e: any) { next(e); }
};

const providerMenuHandler = (req, res, next) => {
  try { ok(res, pub.getProviderMenu(req.params.id, parseLocale(req))); } catch (e: any) { next(e); }
};

const providerRoomsHandler = (req, res, next) => {
  try { ok(res, pub.getProviderRooms(req.params.id, parseLocale(req))); } catch (e: any) { next(e); }
};

const providerFlightsHandler = (req, res, next) => {
  try { ok(res, pub.getProviderFlights(req.params.id, parseLocale(req))); } catch (e: any) { next(e); }
};

const providerPackagesHandler = (req, res, next) => {
  try { ok(res, pub.getProviderPackages(req.params.id, parseLocale(req))); } catch (e: any) { next(e); }
};

const itemReviewsHandler = (req, res, next) => {
  try { ok(res, pub.getItemReviews(req.params.kind, req.params.id, req.query)); } catch (e: any) { next(e); }
};

const dealsHandler = (req, res, next) => {
  try { ok(res, pub.getDeals(req.query, parseLocale(req))); } catch (e: any) { next(e); }
};

router.get('/payment-info', authenticate, requireRole('provider'), paymentInfoHandler);
router.get('/governorates', governoratesHandler);
router.get('/governorates/by-geo', governorateByGeoHandler);
router.get('/coupons', couponsHandler);
router.get('/config', configHandler);
router.get('/services', servicesHandler);
router.get('/providers', providersHandler);
router.get('/providers/:id', providerDetailHandler);
router.get('/providers/:id/reviews', providerReviewsHandler);
router.get('/providers/:id/categories', providerCategoriesHandler);
router.get('/providers/:id/products', providerProductsHandler);
router.get('/providers/:id/menu', providerMenuHandler);
router.get('/providers/:id/rooms', providerRoomsHandler);
router.get('/providers/:id/flights', providerFlightsHandler);
router.get('/providers/:id/packages', providerPackagesHandler);
router.get('/items/:kind/:id/reviews', itemReviewsHandler);
router.get('/deals', dealsHandler);

module.exports = router;
