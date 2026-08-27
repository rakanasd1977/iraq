const { ApiError, isAgentLeaseActive } = require('../utils/helpers');
const { all } = require('../db');
const { isSuperAdmin } = require('../utils/rbac');

// تخزين صلاحيات المستخدم في الذاكرة المؤقتة لكل طلب
function loadUserPermissions(userId) {
  const rows = all(
    `SELECT DISTINCT arp.resource, arp.action
     FROM admin_user_roles aur
     JOIN admin_role_permissions arp ON arp.role_id = aur.role_id
     WHERE aur.user_id = ?`,
    [userId]
  );
  const perms = {};
  for (const r of rows) {
    if (!perms[r.resource]) perms[r.resource] = new Set();
    perms[r.resource].add(r.action);
  }
  return perms;
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return next(new ApiError(401, 'غير مصرح بالدخول'));
    if (!roles.includes(req.user.role)) return next(new ApiError(403, 'لا تملك صلاحية تنفيذ هذه العملية'));
    next();
  };
}

function requireAdminOrAgent() {
  return (req, res, next) => {
    if (!req.user) return next(new ApiError(401, 'غير مصرح بالدخول'));
    if (!['admin', 'agent'].includes(req.user.role)) return next(new ApiError(403, 'لا تملك صلاحية تنفيذ هذه العملية'));
    if (req.user.role === 'agent' && !req.user.agent_id) return next(new ApiError(403, 'حساب الوكيل غير مكتمل'));
    next();
  };
}

// يمنع الوكيل منتهي/معلق الإجارة من تنفيذ عمليات كتابة (يسمح للقراءة والمسؤولين والزبائن)
function requireAgentLease() {
  return (req, res, next) => {
    if (req.user.role !== 'agent') return next();
    if (!isAgentLeaseActive(req.user)) return next(new ApiError(403, 'إجارة الوكالة منتهية أو غير مفعلة، يرجى تجديدها قبل تنفيذ هذه العملية'));
    next();
  };
}

// التحقق من صلاحية دقيقة: requirePermission('orders', 'edit')
function requirePermission(resource, action) {
  return (req, res, next) => {
    if (!req.user) return next(new ApiError(401, 'غير مصرح بالدخول'));

    // super_admin له كل الصلاحيات
    if (req.user.role === 'admin' && isSuperAdmin(req.user.id)) return next();

    // تحميل صلاحيات المستخدم (مع تخزين مؤقت بسيط في الطلب)
    if (!req._rbacPerms) req._rbacPerms = loadUserPermissions(req.user.id);
    const perms = req._rbacPerms;

    if (!perms[resource] || !perms[resource].has(action)) {
      return next(new ApiError(403, `صلاحية غير كافية: ${resource}.${action}`));
    }
    next();
  };
}

// يُطبّق الصلاحية الدقيقة على المسؤولين فقط؛ يمرّر بقية الأدوار (مزود/وكيل/زبون) دون فحص،
// لأن صلاحيات RBAC تخص لوحة المسؤول ولا يجب أن تكسر وصول بقية الأدوار لنفس المسارات المشتركة.
function requirePermissionForAdmin(resource, action) {
  return (req, res, next) => {
    if (!req.user) return next(new ApiError(401, 'غير مصرح بالدخول'));
    if (req.user.role !== 'admin') return next();

    // super_admin له كل الصلاحيات
    if (isSuperAdmin(req.user.id)) return next();

    if (!req._rbacPerms) req._rbacPerms = loadUserPermissions(req.user.id);
    const perms = req._rbacPerms;
    if (!perms[resource] || !perms[resource].has(action)) {
      return next(new ApiError(403, `صلاحية غير كافية: ${resource}.${action}`));
    }
    next();
  };
}

module.exports = { requireRole, requireAdminOrAgent, requireAgentLease, requirePermission, requirePermissionForAdmin };
