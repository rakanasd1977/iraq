const express = require('express');
const { get } = require('../db');
const auth = require('./auth');
const governorates = require('./governorates');
const districts = require('./districts');
const services = require('./services');
const agents = require('./agents');
const providers = require('./providers');
const customers = require('./customers');
const orders = require('./orders');
const commissions = require('./commissions');
const leases = require('./leases');
const agentSelf = require('./agent');
const agentWithdrawals = require('./agent-withdrawals');
const providerSelf = require('./provider');
const customerSelf = require('./customer');
const publicApi = require('./public');
const dashboard = require('./dashboard');
const settings = require('./settings');
const activity = require('./activity');
const wallets = require('./wallets');
const recharges = require('./recharges');
const push = require('./push');
const promotions = require('./promotions');
const notifications = require('./notifications');
const upload = require('./upload');
const financialReport = require('./financial-report');
const rbac = require('./rbac');
const bulk = require('./bulk');
const backups = require('./backups');
const docs = require('./docs');

const router = express.Router();

router.get('/health', (req, res) => {
  let db = 'ok';
  try {
    get('SELECT 1');
  } catch (e: any) {
    db = 'error';
  }
  res.status(db === 'ok' ? 200 : 503).json({ status: db === 'ok' ? 'ok' : 'degraded', db, time: new Date().toISOString() });
});

router.use('/auth', auth);
router.use('/governorates', governorates);
router.use('/districts', districts);
router.use('/services', services);
router.use('/agents', agents);
router.use('/providers', providers);
router.use('/customers', customers);
router.use('/orders', orders);
router.use('/commissions', commissions);
router.use('/leases', leases);
router.use('/agent', agentSelf);
router.use('/agent-withdrawals', agentWithdrawals);
router.use('/provider', providerSelf);
router.use('/customer', customerSelf);
router.use('/public', publicApi);
router.use('/dashboard', dashboard);
router.use('/settings', settings);
router.use('/activity', activity);
router.use('/wallets', wallets);
router.use('/recharges', recharges);
router.use('/push', push);
router.use('/promotions', promotions.router);
router.use('/public/promotions', promotions.publicRouter);
router.use('/notifications', notifications);
router.use('/upload', upload);
router.use('/financial-report', financialReport);
router.use('/rbac', rbac);
router.use('/bulk', bulk);
router.use('/backups', backups);
router.use('/docs', docs.registerDocs(express.Router()));

module.exports = router;
