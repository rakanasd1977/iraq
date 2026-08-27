const { db, run, all, get } = require('../index');

module.exports = {
  name: "045_rbac_reviews_notifications",
  up: () => {
    const grants = {
      reviews: ['view', 'delete'],
      notifications: ['view', 'create'],
    };
    const rolePerms = {
      super_admin: ['view', 'delete', 'create'],
      admin: ['view', 'delete', 'create'],
      manager: ['view', 'delete', 'create'],
      viewer: ['view'],
    };
    for (const [resource, actions] of Object.entries(grants)) {
      for (const [roleName, perms] of Object.entries(rolePerms)) {
        const role = get("SELECT id FROM admin_roles WHERE name = ?", [roleName]);
        if (!role) continue;
        for (const action of perms.filter((p) => actions.includes(p))) {
          run("INSERT OR IGNORE INTO admin_role_permissions (role_id, resource, action) VALUES (?,?,?)", [role.id, resource, action]);
        }
      }
    }
  },
  down: () => {
    run("DELETE FROM admin_role_permissions WHERE resource IN ('reviews','notifications')");
  },
};
