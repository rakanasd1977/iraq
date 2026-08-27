const { db, run, all, get } = require('../index');

module.exports = {
  name: "034_admin_rbac",
  up: ()=>{db.exec(`
        CREATE TABLE IF NOT EXISTS admin_roles (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL UNIQUE,
          name_ar TEXT NOT NULL,
          description TEXT,
          is_system INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
      `);db.exec(`
        CREATE TABLE IF NOT EXISTS admin_role_permissions (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          role_id INTEGER NOT NULL REFERENCES admin_roles(id) ON DELETE CASCADE,
          resource TEXT NOT NULL,
          action TEXT NOT NULL,
          UNIQUE(role_id, resource, action)
        );
      `);db.exec(`
        CREATE TABLE IF NOT EXISTS admin_user_roles (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          role_id INTEGER NOT NULL REFERENCES admin_roles(id) ON DELETE CASCADE,
          assigned_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
          assigned_at TEXT NOT NULL DEFAULT (datetime('now')),
          UNIQUE(user_id, role_id)
        );
      `);const superAdmin=run(`INSERT OR IGNORE INTO admin_roles (name, name_ar, description, is_system) VALUES (?,?,?,1)`,["super_admin","\u0645\u0633\u0624\u0648\u0644 \u0623\u0639\u0644\u0649","\u0635\u0644\u0627\u062D\u064A\u0629 \u0643\u0627\u0645\u0644\u0629 \u0639\u0644\u0649 \u062C\u0645\u064A\u0639 \u0627\u0644\u0645\u0648\u0627\u0631\u062F"]);const adminRole=run(`INSERT OR IGNORE INTO admin_roles (name, name_ar, description, is_system) VALUES (?,?,?,1)`,["admin","\u0645\u0633\u0624\u0648\u0644","\u0625\u062F\u0627\u0631\u0629 \u0627\u0644\u0639\u0645\u0644\u064A\u0627\u062A \u0627\u0644\u0623\u0633\u0627\u0633\u064A\u0629"]);const managerRole=run(`INSERT OR IGNORE INTO admin_roles (name, name_ar, description, is_system) VALUES (?,?,?,1)`,["manager","\u0645\u062F\u064A\u0631 \u0639\u0645\u0644\u064A\u0627\u062A","\u0639\u0631\u0636 \u0648\u062A\u0639\u062F\u064A\u0644 \u0627\u0644\u0637\u0644\u0628\u0627\u062A \u0648\u0627\u0644\u0645\u0632\u0648\u062F\u064A\u0646"]);const viewerRole=run(`INSERT OR IGNORE INTO admin_roles (name, name_ar, description, is_system) VALUES (?,?,?,1)`,["viewer","\u0645\u0634\u0627\u0647\u062F","\u0639\u0631\u0636 \u0641\u0642\u0637 \u0628\u062F\u0648\u0646 \u062A\u0639\u062F\u064A\u0644"]);const resources=["agents","providers","orders","coupons","promotions","customers","settings","financial_reports","withdrawals","leases","activity_log","users","roles","governorates","services","commissions","wallets","recharges","dashboard","bulk"];const actions=["view","create","edit","delete","export"];if(superAdmin.lastId){for(const resource of resources){for(const action of actions){run(`INSERT OR IGNORE INTO admin_role_permissions (role_id, resource, action) VALUES (?,?,?)`,[superAdmin.lastId,resource,action])}}}if(adminRole.lastId){const adminResources=["agents","providers","orders","coupons","promotions","customers","settings","financial_reports","withdrawals","leases","activity_log","governorates","services","commissions","wallets","recharges","dashboard","bulk"];for(const resource of adminResources){for(const action of actions){run(`INSERT OR IGNORE INTO admin_role_permissions (role_id, resource, action) VALUES (?,?,?)`,[adminRole.lastId,resource,action])}}}if(managerRole.lastId){const managerResources=["agents","providers","orders","coupons","promotions","customers","financial_reports","withdrawals","leases","governorates","services","commissions","wallets","recharges","dashboard","bulk"];for(const resource of managerResources){for(const action of["view","edit","export"]){run(`INSERT OR IGNORE INTO admin_role_permissions (role_id, resource, action) VALUES (?,?,?)`,[managerRole.lastId,resource,action])}}}if(viewerRole.lastId){const viewerResources=["agents","providers","orders","coupons","promotions","customers","financial_reports","withdrawals","leases","activity_log","governorates","services","commissions","wallets","recharges","dashboard","bulk"];for(const resource of viewerResources){run(`INSERT OR IGNORE INTO admin_role_permissions (role_id, resource, action) VALUES (?,?,?)`,[viewerRole.lastId,resource,"view"])}}},
};
