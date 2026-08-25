const express = require('express');
const { ok, created } = require('../utils/response');
const { authenticate } = require('../middleware/auth');
const { requireRole } = require('../middleware/rbac');
const {
  getDashboard,
  getProfile,
  updateProfile,
  getProviderRating,
  rateProvider,
  getItemRating,
  rateItem,
  listFavorites,
  listFavoriteIds,
  addFavorite,
  removeFavorite,
  listFavoriteItemIds,
  listFavoriteItems,
  addFavoriteItem,
  removeFavoriteItem,
  listFollowing,
  follow,
  unfollow,
  listAddresses,
  addAddress,
  updateAddress,
  setDefaultAddress,
  deleteAddress,
  previewCoupon,
  getLoyalty,
  getReferral,
} = require('../services/customer');

const router = express.Router();
router.use(authenticate, requireRole('customer'));

router.get('/dashboard', (req, res, next) => {
  try { return ok(res, getDashboard(req.user.id)); } catch (e: any) { next(e); }
});

router.get('/profile', (req, res, next) => {
  try { return ok(res, getProfile(req.user.id)); } catch (e: any) { next(e); }
});

router.put('/profile', (req, res, next) => {
  try { return ok(res, updateProfile(req.user, req.body)); } catch (e: any) { next(e); }
});

router.get('/rate/:providerId', (req, res, next) => {
  try { return ok(res, getProviderRating(req.user.id, Number(req.params.providerId))); } catch (e: any) { next(e); }
});

router.post('/rate/:providerId', (req, res, next) => {
  try { return ok(res, rateProvider(req.user.id, Number(req.params.providerId), req.body)); } catch (e: any) { next(e); }
});

router.get('/rate-item/:kind/:itemId', (req, res, next) => {
  try { return ok(res, getItemRating(req.user.id, req.params.kind, req.params.itemId)); } catch (e: any) { next(e); }
});

router.post('/rate-item/:kind/:itemId', (req, res, next) => {
  try { return ok(res, rateItem(req.user.id, req.params.kind, req.params.itemId, req.body)); } catch (e: any) { next(e); }
});

router.get('/favorites', (req, res, next) => {
  try { return ok(res, listFavorites(req.user.id)); } catch (e: any) { next(e); }
});

router.get('/favorites/ids', (req, res, next) => {
  try { return ok(res, listFavoriteIds(req.user.id)); } catch (e: any) { next(e); }
});

router.post('/favorites', (req, res, next) => {
  try { return ok(res, addFavorite(req.user.id, (req.body || {}).provider_id)); } catch (e: any) { next(e); }
});

router.delete('/favorites/:providerId', (req, res, next) => {
  try { return ok(res, removeFavorite(req.user.id, req.params.providerId)); } catch (e: any) { next(e); }
});

router.get('/favorites/items-ids', (req, res, next) => {
  try { return ok(res, listFavoriteItemIds(req.user.id)); } catch (e: any) { next(e); }
});

router.get('/favorites/items', (req, res, next) => {
  try { return ok(res, listFavoriteItems(req.user.id)); } catch (e: any) { next(e); }
});

router.post('/favorites/items', (req, res, next) => {
  try { return ok(res, addFavoriteItem(req.user.id, req.body)); } catch (e: any) { next(e); }
});

router.delete('/favorites/items/:itemType/:itemId', (req, res, next) => {
  try { return ok(res, removeFavoriteItem(req.user.id, req.params.itemType, req.params.itemId)); } catch (e: any) { next(e); }
});

router.get('/following', (req, res, next) => {
  try { return ok(res, listFollowing(req.user.id)); } catch (e: any) { next(e); }
});

router.post('/follow', (req, res, next) => {
  try { return ok(res, follow(req.user.id, (req.body || {}).provider_id)); } catch (e: any) { next(e); }
});

router.delete('/follow/:providerId', (req, res, next) => {
  try { return ok(res, unfollow(req.user.id, req.params.providerId)); } catch (e: any) { next(e); }
});

router.get('/addresses', (req, res, next) => {
  try { return ok(res, listAddresses(req.user.id)); } catch (e: any) { next(e); }
});

router.post('/addresses', (req, res, next) => {
  try { return created(res, addAddress(req.user.id, req.body)); } catch (e: any) { next(e); }
});

router.put('/addresses/:id', (req, res, next) => {
  try { return ok(res, updateAddress(req.user.id, req.params.id, req.body)); } catch (e: any) { next(e); }
});

router.post('/addresses/:id/default', (req, res, next) => {
  try { return ok(res, setDefaultAddress(req.user.id, req.params.id)); } catch (e: any) { next(e); }
});

router.delete('/addresses/:id', (req, res, next) => {
  try { return ok(res, deleteAddress(req.user.id, req.params.id)); } catch (e: any) { next(e); }
});

router.get('/coupons/preview', (req, res, next) => {
  try { return ok(res, previewCoupon(req.user.id, req.query)); } catch (e: any) { next(e); }
});

router.get('/loyalty', (req, res, next) => {
  try { return ok(res, getLoyalty(req.user.id)); } catch (e: any) { next(e); }
});

router.get('/referral', (req, res, next) => {
  try { return ok(res, getReferral(req.user.id)); } catch (e: any) { next(e); }
});

module.exports = router;
