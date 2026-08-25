const { get, run } = require('../index');

module.exports = {
  name: '041_rbac_districts',
  up: () => {
    const actions = ['view', 'create', 'edit', 'delete', 'export'];
    const grants = {
      super_admin: actions,
      admin: actions,
      manager: ['view', 'edit', 'export'],
      viewer: ['view'],
    };
    for (const [roleName, perms] of Object.entries(grants)) {
      const role = get('SELECT id FROM admin_roles WHERE name = ?', [roleName]);
      if (!role) continue;
      for (const action of perms) {
        run('INSERT OR IGNORE INTO admin_role_permissions (role_id, resource, action) VALUES (?,?,?)', [role.id, 'districts', action]);
      }
    }
  },
};
