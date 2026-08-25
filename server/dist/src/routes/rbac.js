"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express = require('express');
const { get, all, run } = require('../db');
const { ApiError, toId } = require('../utils/helpers');
const { ok, created } = require('../utils/response');
const { authenticate } = require('../middleware/auth');
const { requireRole, requirePermission } = require('../middleware/rbac');
const router = express.Router();
router.use(authenticate, requireRole('admin'));
// ============ الأدوار (Roles) ============
// GET /api/rbac/roles — قائمة جميع الأدوار
router.get('/roles', requirePermission('roles', 'view'), (req, res, next) => {
    try {
        const roles = all(`
      SELECT ar.*, COUNT(aur.user_id) AS users_count
      FROM admin_roles ar
      LEFT JOIN admin_user_roles aur ON aur.role_id = ar.id
      GROUP BY ar.id ORDER BY ar.is_system DESC, ar.name
    `);
        // جلب الصلاحيات لكل دور
        for (const role of roles) {
            role.permissions = all('SELECT resource, action FROM admin_role_permissions WHERE role_id = ?', [role.id]);
        }
        return ok(res, roles);
    }
    catch (e) {
        next(e);
    }
});
// GET /api/rbac/roles/:id — تفاصيل دور مع صلاحياته
router.get('/roles/:id', requirePermission('roles', 'view'), (req, res, next) => {
    try {
        const id = toId(req.params.id);
        const role = get('SELECT * FROM admin_roles WHERE id = ?', [id]);
        if (!role)
            throw new ApiError(404, 'الدور غير موجود');
        role.permissions = all('SELECT resource, action FROM admin_role_permissions WHERE role_id = ?', [id]);
        return ok(res, role);
    }
    catch (e) {
        next(e);
    }
});
// POST /api/rbac/roles — إنشاء دور جديد
router.post('/roles', requirePermission('roles', 'create'), (req, res, next) => {
    try {
        const { name, name_ar, description } = req.body || {};
        if (!name || !name_ar)
            throw new ApiError(400, 'الاسم والاسم بالعربي مطلوبان');
        if (!/^[a-z_]+$/.test(name))
            throw new ApiError(400, 'الاسم يجب أن يكون أحرف إنجليزية صغيرة وشرطات سفلية فقط');
        const existing = get('SELECT 1 FROM admin_roles WHERE name = ?', [name]);
        if (existing)
            throw new ApiError(409, 'اسم الدور مستخدم بالفعل');
        const result = run('INSERT INTO admin_roles (name, name_ar, description, is_system) VALUES (?,?,?,0)', [name, name_ar, description || null]);
        return created(res, { id: result.lastId, name, name_ar, description, is_system: 0 });
    }
    catch (e) {
        next(e);
    }
});
// PUT /api/rbac/roles/:id — تحديث دور
router.put('/roles/:id', requirePermission('roles', 'edit'), (req, res, next) => {
    try {
        const id = toId(req.params.id);
        const role = get('SELECT * FROM admin_roles WHERE id = ?', [id]);
        if (!role)
            throw new ApiError(404, 'الدور غير موجود');
        if (role.is_system)
            throw new ApiError(403, 'لا يمكن تعديل أدوار النظام');
        const { name_ar, description } = req.body || {};
        if (name_ar === undefined && description === undefined)
            throw new ApiError(400, 'لا توجد بيانات للتحديث');
        run('UPDATE admin_roles SET name_ar = COALESCE(?, name_ar), description = COALESCE(?, description), updated_at = datetime(\'now\') WHERE id = ?', [name_ar, description, id]);
        return ok(res, { id, name_ar: name_ar || role.name_ar, description: description || role.description });
    }
    catch (e) {
        next(e);
    }
});
// DELETE /api/rbac/roles/:id — حذف دور
router.delete('/roles/:id', requirePermission('roles', 'delete'), (req, res, next) => {
    try {
        const id = toId(req.params.id);
        const role = get('SELECT * FROM admin_roles WHERE id = ?', [id]);
        if (!role)
            throw new ApiError(404, 'الدور غير موجود');
        if (role.is_system)
            throw new ApiError(403, 'لا يمكن حذف أدوار النظام');
        run('DELETE FROM admin_roles WHERE id = ?', [id]);
        return ok(res, { deleted: true });
    }
    catch (e) {
        next(e);
    }
});
// ============ صلاحيات الدور (Role Permissions) ============
// PUT /api/rbac/roles/:id/permissions — تحديث صلاحيات الدور (استبدال كامل)
router.put('/roles/:id/permissions', requirePermission('roles', 'edit'), (req, res, next) => {
    try {
        const id = toId(req.params.id);
        const role = get('SELECT * FROM admin_roles WHERE id = ?', [id]);
        if (!role)
            throw new ApiError(404, 'الدور غير موجود');
        if (role.is_system && role.name === 'super_admin')
            throw new ApiError(403, 'لا يمكن تعديل صلاحيات super_admin');
        const { permissions } = req.body || {}; // [{resource, action}, ...]
        if (!Array.isArray(permissions))
            throw new ApiError(400, 'الصلاحية يجب أن تكون مصفوفة');
        // حذف القديم وإدراج الجديد
        run('DELETE FROM admin_role_permissions WHERE role_id = ?', [id]);
        for (const p of permissions) {
            if (p.resource && p.action) {
                run('INSERT OR IGNORE INTO admin_role_permissions (role_id, resource, action) VALUES (?,?,?)', [id, p.resource, p.action]);
            }
        }
        return ok(res, { updated: true });
    }
    catch (e) {
        next(e);
    }
});
// ============ تعيين الأدوار للمستخدمين ============
// GET /api/rbac/users — قائمة المستخدمين بأدوارهم
router.get('/users', requirePermission('users', 'view'), (req, res, next) => {
    try {
        const users = all(`
      SELECT u.id, u.name_ar, u.email, u.role, u.is_active,
             GROUP_CONCAT(ar.name) AS roles
      FROM users u
      LEFT JOIN admin_user_roles aur ON aur.user_id = u.id
      LEFT JOIN admin_roles ar ON ar.id = aur.role_id
      WHERE u.role = 'admin'
      GROUP BY u.id ORDER BY u.id DESC
    `);
        // لكل مستخدم، جلب أدواره المفصلة
        for (const u of users) {
            u.assigned_roles = all(`
        SELECT ar.id, ar.name, ar.name_ar, ar.description
        FROM admin_user_roles aur
        JOIN admin_roles ar ON ar.id = aur.role_id
        WHERE aur.user_id = ?
      `, [u.id]);
        }
        return ok(res, users);
    }
    catch (e) {
        next(e);
    }
});
// POST /api/rbac/users/:userId/roles — إضافة دور لمستخدم
router.post('/users/:userId/roles', requirePermission('users', 'edit'), (req, res, next) => {
    try {
        const userId = toId(req.params.userId);
        const { role_id } = req.body || {};
        const roleId = toId(role_id);
        const user = get('SELECT * FROM users WHERE id = ? AND role = ?', [userId, 'admin']);
        if (!user)
            throw new ApiError(404, 'المستخدم ليس مسؤولاً');
        const role = get('SELECT * FROM admin_roles WHERE id = ?', [roleId]);
        if (!role)
            throw new ApiError(404, 'الدور غير موجود');
        run('INSERT OR IGNORE INTO admin_user_roles (user_id, role_id, assigned_by) VALUES (?,?,?)', [userId, roleId, req.user.id]);
        return created(res, { user_id: userId, role_id: roleId });
    }
    catch (e) {
        next(e);
    }
});
// DELETE /api/rbac/users/:userId/roles/:roleId — إزالة دور من مستخدم
router.delete('/users/:userId/roles/:roleId', requirePermission('users', 'edit'), (req, res, next) => {
    try {
        const userId = toId(req.params.userId);
        const roleId = toId(req.params.roleId);
        run('DELETE FROM admin_user_roles WHERE user_id = ? AND role_id = ?', [userId, roleId]);
        return ok(res, { deleted: true });
    }
    catch (e) {
        next(e);
    }
});
// ============ الموارد والصلاحية المتاحة ============
// GET /api/rbac/resources — قائمة الموارد والصلاحية المتاحة
router.get('/resources', requirePermission('roles', 'view'), (req, res, next) => {
    try {
        const resources = [
            { key: 'agents', label: 'الوكلاء', actions: ['view', 'create', 'edit', 'delete', 'export'] },
            { key: 'providers', label: 'المزودون', actions: ['view', 'create', 'edit', 'delete', 'export'] },
            { key: 'orders', label: 'الطلبات', actions: ['view', 'create', 'edit', 'delete', 'export'] },
            { key: 'coupons', label: 'الكوبونات', actions: ['view', 'create', 'edit', 'delete', 'export'] },
            { key: 'promotions', label: 'الإعلانات', actions: ['view', 'create', 'edit', 'delete', 'export'] },
            { key: 'customers', label: 'الزبائن', actions: ['view', 'create', 'edit', 'delete', 'export'] },
            { key: 'settings', label: 'الإعدادات', actions: ['view', 'create', 'edit', 'delete', 'export'] },
            { key: 'financial_reports', label: 'التقارير المالية', actions: ['view', 'export'] },
            { key: 'withdrawals', label: 'السحوبات', actions: ['view', 'edit', 'export'] },
            { key: 'leases', label: 'الإجارات', actions: ['view', 'create', 'edit', 'delete', 'export'] },
            { key: 'activity_log', label: 'سجل النشاط', actions: ['view', 'export'] },
            { key: 'system', label: 'النظام', actions: ['view', 'edit'] },
            { key: 'users', label: 'المستخدمون', actions: ['view', 'create', 'edit', 'delete'] },
            { key: 'roles', label: 'الأدوار والصلاحيات', actions: ['view', 'create', 'edit', 'delete'] },
        ];
        return ok(res, resources);
    }
    catch (e) {
        next(e);
    }
});
module.exports = router;
