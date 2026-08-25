const { get, all } = require('../db');

// يُلحق بكائن المستخدم بيانات مرتبطة بدوره (وكيل/مزوّد/زبون) دون كشف الحقول الحساسة.
function enrichUser(user) {
  const out = { ...user };
  delete out.password_hash;
  delete out.totp_secret;

  if (user.role === 'agent') {
    const agent = get('SELECT * FROM agents WHERE user_id = ?', [user.id]);
    if (agent) {
      out.agent_id = agent.id;
      out.governorate_id = agent.governorate_id;
      out.district_id = agent.district_id;
      out.agent_commission_rate = agent.commission_rate;
      out.lease_status = agent.lease_status;
      out.lease_expires_at = agent.lease_expires_at;
      const gov = get('SELECT name_ar, lease_fee, code FROM governorates WHERE id = ?', [agent.governorate_id]);
      if (gov) {
        out.governorate_name_ar = gov.name_ar;
        out.lease_fee = gov.lease_fee;
        out.governorate_code = gov.code;
      }
      if (agent.district_id) {
        const dist = get('SELECT name_ar, lease_fee, code FROM districts WHERE id = ?', [agent.district_id]);
        if (dist) {
          out.district_name_ar = dist.name_ar;
          out.district_code = dist.code;
          out.lease_fee = dist.lease_fee;
        }
      }
    }
  } else if (user.role === 'provider') {
    const p = get('SELECT * FROM providers WHERE user_id = ?', [user.id]);
    if (p) {
      out.provider_id = p.id;
      out.service_id = p.service_id;
      out.governorate_id = p.governorate_id;
      out.provider_name = p.name_ar;
      out.commission_rate = p.commission_rate;
      out.is_verified = p.is_verified;
    }
  } else if (user.role === 'customer') {
    const c = get('SELECT * FROM customers WHERE user_id = ?', [user.id]);
    if (c) out.customer_id = c.id;
  }

  return out;
}

// يلحق بالمسؤول أدواره وصلاحياته الصريحة (تُستخدم في تسجيل الدخول و /auth/me)
function attachAdminRoles(out, userId) {
  if (!userId) return out;
  const roleRows = all(
    `SELECT ar.name FROM admin_user_roles aur JOIN admin_roles ar ON ar.id = aur.role_id WHERE aur.user_id = ?`,
    [userId]
  );
  out.roles = roleRows.map((r) => r.name);
  const permRows = all(
    `SELECT DISTINCT resource, action FROM admin_user_roles aur JOIN admin_role_permissions arp ON arp.role_id = aur.role_id WHERE aur.user_id = ?`,
    [userId]
  );
  out.permissions = permRows.map((p) => `${p.resource}:${p.action}`);
  return out;
}

module.exports = { enrichUser, attachAdminRoles };
