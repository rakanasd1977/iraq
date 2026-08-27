const { get } = require('../db');

// هل يملك المستخدم دور super_admin (صلاحيات كاملة)؟
function isSuperAdmin(userId) {
  return !!(get(
    `SELECT 1 FROM admin_user_roles aur
     JOIN admin_roles ar ON ar.id = aur.role_id
     WHERE aur.user_id = ? AND ar.name = 'super_admin'`,
    [userId]
  ));
}

module.exports = { isSuperAdmin };
