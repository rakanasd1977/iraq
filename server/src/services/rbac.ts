const { get, all, run, transaction } = require('../db');
const { ApiError, toId, assertLength } = require('../utils/helpers');
const { hashPassword } = require('../utils/password');

const RESOURCES = [
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
  { key: 'users', label: 'المستخدمون', actions: ['view', 'create', 'edit', 'delete'] },
  { key: 'roles', label: 'الأدوار والصلاحيات', actions: ['view', 'create', 'edit', 'delete'] },
  { key: 'governorates', label: 'المحافظات', actions: ['view', 'create', 'edit', 'delete', 'export'] },
  { key: 'services', label: 'الخدمات', actions: ['view', 'create', 'edit', 'delete', 'export'] },
  { key: 'commissions', label: 'العمولات', actions: ['view', 'edit', 'export'] },
  { key: 'wallets', label: 'محافظ المزودين', actions: ['view', 'create', 'edit', 'export'] },
  { key: 'recharges', label: 'طلبات الشحن', actions: ['view', 'edit', 'export'] },
  { key: 'dashboard', label: 'لوحة المعلومات', actions: ['view', 'export'] },
  { key: 'bulk', label: 'الاستيراد والتصدير الجماعي', actions: ['view', 'create', 'export'] },
  { key: 'backups', label: 'النسخ الاحتياطية', actions: ['view', 'create', 'restore', 'delete', 'export'] },
  { key: 'security', label: 'الأمان', actions: ['view', 'edit'] },
];

function listRoles() {
  const roles = all(`
    SELECT ar.*, COUNT(aur.user_id) AS users_count
    FROM admin_roles ar
    LEFT JOIN admin_user_roles aur ON aur.role_id = ar.id
    GROUP BY ar.id ORDER BY ar.is_system DESC, ar.name
  `);
  for (const role of roles) {
    role.permissions = all(
      'SELECT resource, action FROM admin_role_permissions WHERE role_id = ?',
      [role.id]
    );
  }
  return roles;
}

function getRole(id) {
  const rid = toId(id);
  const role = get('SELECT * FROM admin_roles WHERE id = ?', [rid]);
  if (!role) throw new ApiError(404, 'الدور غير موجود');
  role.permissions = all(
    'SELECT resource, action FROM admin_role_permissions WHERE role_id = ?',
    [rid]
  );
  return role;
}

function createRole(body) {
  if (!body || !body.name || !body.name_ar) throw new ApiError(400, 'الاسم والاسم بالعربي مطلوبان');
  if (!/^[a-z_]+$/.test(body.name)) throw new ApiError(400, 'الاسم يجب أن يكون أحرف إنجليزية صغيرة وشرطات سفلية فقط');
  const existing = get('SELECT 1 FROM admin_roles WHERE name = ?', [body.name]);
  if (existing) throw new ApiError(409, 'اسم الدور مستخدم بالفعل');
  const result = run(
    'INSERT INTO admin_roles (name, name_ar, description, is_system) VALUES (?,?,?,0)',
    [body.name, body.name_ar, body.description || null]
  );
  return { id: result.lastId, name: body.name, name_ar: body.name_ar, description: body.description, is_system: 0 };
}

function updateRole(id, body) {
  const rid = toId(id);
  const role = get('SELECT * FROM admin_roles WHERE id = ?', [rid]);
  if (!role) throw new ApiError(404, 'الدور غير موجود');
  if (role.is_system) throw new ApiError(403, 'لا يمكن تعديل أدوار النظام');
  if (body.name_ar === undefined && body.description === undefined) throw new ApiError(400, 'لا توجد بيانات للتحديث');
  run(
    'UPDATE admin_roles SET name_ar = COALESCE(?, name_ar), description = COALESCE(?, description), updated_at = datetime(\'now\') WHERE id = ?',
    [body.name_ar, body.description, rid]
  );
  return { id: rid, name_ar: body.name_ar || role.name_ar, description: body.description || role.description };
}

function deleteRole(id) {
  const rid = toId(id);
  const role = get('SELECT * FROM admin_roles WHERE id = ?', [rid]);
  if (!role) throw new ApiError(404, 'الدور غير موجود');
  if (role.is_system) throw new ApiError(403, 'لا يمكن حذف أدوار النظام');
  run('DELETE FROM admin_roles WHERE id = ?', [rid]);
  return { deleted: true };
}

function setRolePermissions(id, body) {
  const rid = toId(id);
  const role = get('SELECT * FROM admin_roles WHERE id = ?', [rid]);
  if (!role) throw new ApiError(404, 'الدور غير موجود');
  if (role.is_system && role.name === 'super_admin') throw new ApiError(403, 'لا يمكن تعديل صلاحيات super_admin');
  const permissions = body && body.permissions;
  if (!Array.isArray(permissions)) throw new ApiError(400, 'الصلاحية يجب أن تكون مصفوفة');
  run('DELETE FROM admin_role_permissions WHERE role_id = ?', [rid]);
  for (const p of permissions) {
    if (p.resource && p.action) {
      run('INSERT OR IGNORE INTO admin_role_permissions (role_id, resource, action) VALUES (?,?,?)', [rid, p.resource, p.action]);
    }
  }
  return { updated: true };
}

function listUsers() {
  const users = all(`
    SELECT u.id, u.name_ar, u.email, u.role, u.is_active,
           GROUP_CONCAT(ar.name) AS roles
    FROM users u
    LEFT JOIN admin_user_roles aur ON aur.user_id = u.id
    LEFT JOIN admin_roles ar ON ar.id = aur.role_id
    WHERE u.role = 'admin'
    GROUP BY u.id ORDER BY u.id DESC
  `);
  for (const u of users) {
    u.assigned_roles = all(`
      SELECT ar.id, ar.name, ar.name_ar, ar.description
      FROM admin_user_roles aur
      JOIN admin_roles ar ON ar.id = aur.role_id
      WHERE aur.user_id = ?
    `, [u.id]);
  }
  return users;
}

async function createUser(body) {
  if (!body || !body.name_ar || !body.email || !body.password) throw new ApiError(400, 'الاسم والبريد وكلمة المرور مطلوبة');
  const cleanEmail = assertLength(String(body.email).trim().toLowerCase(), 120, 'البريد الإلكتروني');
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(cleanEmail)) throw new ApiError(400, 'صيغة البريد الإلكتروني غير صالحة');
  assertLength(body.password, 72, 'كلمة المرور', 6);
  if (get('SELECT 1 FROM users WHERE email = ?', [cleanEmail])) throw new ApiError(409, 'البريد مستخدم مسبقاً');

  const passwordHash = await hashPassword(body.password);
  let userId;
  transaction(() => {
    userId = run(
      "INSERT INTO users (role, name_ar, email, password_hash, is_active, is_verified) VALUES ('admin',?,?,?,?,1)",
      [body.name_ar, cleanEmail, passwordHash, body.is_active ? 1 : 0]
    ).lastId;
    run('UPDATE users SET referral_code = ? WHERE id = ?', ['RAF' + (100000 + userId).toString(36).toUpperCase(), userId]);
  });
  return get('SELECT id, name_ar, email, role, is_active FROM users WHERE id = ?', [userId]);
}

function patchUser(id, body) {
  const uid = toId(id);
  const user = get("SELECT * FROM users WHERE id = ? AND role = 'admin'", [uid]);
  if (!user) throw new ApiError(404, 'المستخدم ليس مسؤولاً');
  const sets = [];
  const params = [];
  if (body.name_ar !== undefined) { sets.push('name_ar = ?'); params.push(body.name_ar); }
  if (body.is_active !== undefined) { sets.push('is_active = ?'); params.push(body.is_active ? 1 : 0); }
  if (!sets.length) throw new ApiError(400, 'لا توجد بيانات للتحديث');
  params.push(uid);
  run(`UPDATE users SET ${sets.join(', ')}, updated_at = datetime('now') WHERE id = ?`, params);
  return { updated: true };
}

function deleteUser(actor, id) {
  const uid = toId(id);
  if (uid === actor.id) throw new ApiError(400, 'لا يمكن حذف حسابك الخاص');
  const user = get("SELECT * FROM users WHERE id = ? AND role = 'admin'", [uid]);
  if (!user) throw new ApiError(404, 'المستخدم ليس مسؤولاً');
  transaction(() => {
    run('DELETE FROM admin_user_roles WHERE user_id = ?', [uid]);
    run('DELETE FROM users WHERE id = ?', [uid]);
  });
  return { deleted: true };
}

function isSuperAdmin(userId) {
  return !!get(
    'SELECT 1 FROM admin_user_roles aur JOIN admin_roles ar ON ar.id = aur.role_id WHERE aur.user_id = ? AND ar.name = ?',
    [toId(userId), 'super_admin']
  );
}

function addUserRole(userId, roleId, actor) {
  const uid = toId(userId);
  const rid = toId(roleId);
  const user = get('SELECT * FROM users WHERE id = ? AND role = ?', [uid, 'admin']);
  if (!user) throw new ApiError(404, 'المستخدم ليس مسؤولاً');
  const role = get('SELECT * FROM admin_roles WHERE id = ?', [rid]);
  if (!role) throw new ApiError(404, 'الدور غير موجود');
  if (role.name === 'super_admin' && !isSuperAdmin(actor.id)) {
    throw new ApiError(403, 'لا يمكن منح دور المسؤول الأعلى إلا لمسؤول أعلى');
  }
  run('INSERT OR IGNORE INTO admin_user_roles (user_id, role_id, assigned_by) VALUES (?,?,?)', [uid, rid, actor.id]);
  return { user_id: uid, role_id: rid };
}

function removeUserRole(userId, roleId, actor) {
  const uid = toId(userId);
  const rid = toId(roleId);
  const role = get('SELECT * FROM admin_roles WHERE id = ?', [rid]);
  if (!role) throw new ApiError(404, 'الدور غير موجود');
  if (role.name === 'super_admin') {
    if (!isSuperAdmin(actor ? actor.id : uid)) throw new ApiError(403, 'لا يمكن إزالة دور المسؤول الأعلى إلا لمسؤول أعلى');
    const remaining = get(
      'SELECT COUNT(*) AS c FROM admin_user_roles WHERE role_id = ?',
      [rid]
    );
    if (remaining.c <= 1) throw new ApiError(400, 'لا يمكن إزالة آخر مسؤول أعلى في النظام');
  }
  run('DELETE FROM admin_user_roles WHERE user_id = ? AND role_id = ?', [uid, rid]);
  return { deleted: true };
}

function listResources() {
  return RESOURCES;
}

module.exports = {
  RESOURCES, listRoles, getRole, createRole, updateRole, deleteRole, setRolePermissions,
  listUsers, createUser, patchUser, deleteUser, addUserRole, removeUserRole, listResources,
};
