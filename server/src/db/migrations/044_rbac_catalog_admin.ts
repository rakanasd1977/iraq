const { db, run, all, get } = require('../index');

module.exports = {
  name: "044_rbac_catalog_admin",
  up: () => {
    const actions = ['view', 'create', 'edit', 'delete', 'export'];
    const rolePerms = {
      super_admin: actions,
      admin: actions,
      manager: ['view', 'edit', 'export'],
      viewer: ['view'],
    };
    for (const [roleName, perms] of Object.entries(rolePerms)) {
      const role = get("SELECT id FROM admin_roles WHERE name = ?", [roleName]);
      if (!role) continue;
      for (const action of perms) {
        run("INSERT OR IGNORE INTO admin_role_permissions (role_id, resource, action) VALUES (?,?,?)", [role.id, 'catalog', action]);
      }
    }
  },
  down: () => {
    run("DELETE FROM admin_role_permissions WHERE resource = 'catalog'");
  },
};
