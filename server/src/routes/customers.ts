const express = require('express');
const { ok, created } = require('../utils/response');
const { authenticate } = require('../middleware/auth');
const { requireRole, requirePermissionForAdmin } = require('../middleware/rbac');
const customers = require('../services/customers');

const router = express.Router();
router.use(authenticate, requireRole('admin'));

const list = (req, res, next) => {
  try {
    const { rows, meta } = customers.listCustomers(req.query);
    return meta ? ok(res, rows, meta) : ok(res, rows);
  } catch (e: any) { next(e); }
};
const getOne = (req, res, next) => {
  try { ok(res, customers.getCustomer(req.params.id)); } catch (e: any) { next(e); }
};
const create = async (req, res, next) => {
  try { created(res, await customers.createCustomer(req.body, req.user)); } catch (e: any) { next(e); }
};
const update = (req, res, next) => {
  try { ok(res, customers.updateCustomer(req.params.id, req.body, req.user)); } catch (e: any) { next(e); }
};
const remove = (req, res, next) => {
  try { ok(res, customers.deleteCustomer(req.params.id, req.user)); } catch (e: any) { next(e); }
};

router.get('/', requirePermissionForAdmin('customers', 'view'), list);
router.get('/:id', requirePermissionForAdmin('customers', 'view'), getOne);
router.post('/', requirePermissionForAdmin('customers', 'create'), create);
router.put('/:id', requirePermissionForAdmin('customers', 'edit'), update);
router.delete('/:id', requirePermissionForAdmin('customers', 'delete'), remove);

module.exports = router;
