const express = require('express');
const router = express.Router();
const { ok } = require('../utils/response');
const { authenticate } = require('../middleware/auth');
const { requireRole, requirePermissionForAdmin } = require('../middleware/rbac');
const wallets = require('../services/wallets');

router.use(authenticate);

const providerHandler = (req, res, next) => {
  try {
    ok(res, wallets.getProviderWallet(req.user));
  } catch (e: any) { next(e); }
};

const listHandler = (req, res, next) => {
  try {
    const { rows, meta } = wallets.listWallets(req.query);
    ok(res, rows, meta);
  } catch (e: any) { next(e); }
};

const agentLedgerHandler = (req, res, next) => {
  try {
    ok(res, wallets.getAgentLedger(req.user));
  } catch (e: any) { next(e); }
};

const detailHandler = (req, res, next) => {
  try {
    ok(res, wallets.getWalletDetail(req.user, req.params.id));
  } catch (e: any) { next(e); }
};

const rechargeHandler = (req, res, next) => {
  try {
    ok(res, wallets.rechargeWallet(req.user, req.params.id, req.body));
  } catch (e: any) { next(e); }
};

router.get('/provider', providerHandler);
router.get('/', requireRole('admin'), requirePermissionForAdmin('wallets', 'view'), listHandler);
router.get('/agent/ledger', agentLedgerHandler);
router.get('/:id', requireRole('admin'), requirePermissionForAdmin('wallets', 'view'), detailHandler);
router.post('/:id/recharge', requireRole('admin'), requirePermissionForAdmin('wallets', 'edit'), rechargeHandler);

module.exports = router;
