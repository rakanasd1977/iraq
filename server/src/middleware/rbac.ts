const { ApiError } = require('../utils/helpers');
const { get, all } = require('../db');

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
    const active = req.user.lease_status === 'active'
      && req.user.lease_expires_at
      && new Date(req.user.lease_expires_at) > new Date();
    if (!active) return next(new ApiError(403, 'إجارة الوكالة منتهية أو غير مفعلة، يرجى تجديدها قبل تنفيذ هذه العملية'));
    next();
  };
}

// التحقق من صلاحية دقيقة: requirePermission('orders', 'edit')
function requirePermission(resource, action) {
  return (req, res, next) => {
    if (!req.user) return next(new ApiError(401, 'غير مصرح بالدخول'));

    // super_admin له كل الصلاحيات
    if (req.user.role === 'admin') {
      // تحقق من أن المستخدم لديه دور super_admin
      const superAdmin = get(
        `SELECT 1 FROM admin_user_roles aur
         JOIN admin_roles ar ON ar.id = aur.role_id
         WHERE aur.user_id = ? AND ar.name = 'super_admin'`,
        [req.user.id]
      );
      if (superAdmin) return next();
    }

    // تحميل صلاحيات المستخدم (مع تخزين مؤقت بسيط في الطلب)
    if (!req._rbacPerms) req._rbacPerms = loadUserPermissions(req.user.id);
    const perms = req._rbacPerms;

    if (!perms[resource] || !perms[resource].has(action)) {
      return next(new ApiError(403, `صلاحية غير كافية: ${resource}.${action}`));
    }
    next();
  };
}

// middleware اختياري: يحمّل الصلاحيات في req.permissions للاستخدام في الكنترولر
function loadPermissions(req, res, next) {
  if (req.user) req.permissions = loadUserPermissions(req.user.id);
  next();
}

// يُطبّق الصلاحية الدقيقة على المسؤولين فقط؛ يمرّر بقية الأدوار (مزود/وكيل/زبون) دون فحص،
// لأن صلاحيات RBAC تخص لوحة المسؤول ولا يجب أن تكسر وصول بقية الأدوار لنفس المسارات المشتركة.
function requirePermissionForAdmin(resource, action) {
  return (req, res, next) => {
    if (!req.user) return next(new ApiError(401, 'غير مصرح بالدخول'));
    if (req.user.role !== 'admin') return next();

    // super_admin له كل الصلاحيات
    const superAdmin = get(
      `SELECT 1 FROM admin_user_roles aur
       JOIN admin_roles ar ON ar.id = aur.role_id
       WHERE aur.user_id = ? AND ar.name = 'super_admin'`,
      [req.user.id]
    );
    if (superAdmin) return next();

    if (!req._rbacPerms) req._rbacPerms = loadUserPermissions(req.user.id);
    const perms = req._rbacPerms;
    if (!perms[resource] || !perms[resource].has(action)) {
      return next(new ApiError(403, `صلاحية غير كافية: ${resource}.${action}`));
    }
    next();
  };
}

module.exports = { requireRole, requireAdminOrAgent, requireAgentLease, requirePermission, requirePermissionForAdmin, loadPermissions };
