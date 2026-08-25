const express = require('express');
const { ok } = require('../utils/response');
const { authenticate } = require('../middleware/auth');
const { requireRole, requirePermissionForAdmin } = require('../middleware/rbac');
const dashboard = require('../services/dashboard');

const router = express.Router();
router.use(authenticate);

const adminHandler = (req, res, next) => {
  try { ok(res, dashboard.getAdminDashboard()); } catch (e: any) { next(e); }
};

const agentHandler = (req, res, next) => {
  try { ok(res, dashboard.getAgentDashboard(req.user)); } catch (e: any) { next(e); }
};

const executiveHandler = (req, res, next) => {
  try { ok(res, dashboard.getExecutiveDashboard(req.query)); } catch (e: any) { next(e); }
};

router.get('/', requireRole('admin'), requirePermissionForAdmin('dashboard', 'view'), adminHandler);
router.get('/agent', requireRole('agent'), agentHandler);
router.get('/executive', requireRole('admin'), requirePermissionForAdmin('dashboard', 'view'), executiveHandler);

module.exports = router;
