const { db, run, all, get } = require('../index');

module.exports = {
  name: "037_rbac_resource_catalog",
  up: ()=>{const catalog=[{key:"governorates",actions:["view","create","edit","delete","export"]},{key:"services",actions:["view","create","edit","delete","export"]},{key:"commissions",actions:["view","edit","export"]},{key:"wallets",actions:["view","create","edit","export"]},{key:"recharges",actions:["view","edit","export"]},{key:"dashboard",actions:["view","export"]},{key:"bulk",actions:["view","create","export"]}];const rolePerms={super_admin:catalog.flatMap(r=>r.actions.map(a=>[r.key,a])),admin:catalog.flatMap(r=>r.actions.map(a=>[r.key,a])),manager:catalog.flatMap(r=>["view","edit","export"].filter(a=>r.actions.includes(a)).map(a=>[r.key,a])),viewer:catalog.flatMap(r=>r.actions.includes("view")?[[r.key,"view"]]:[])};for(const[roleName,perms]of Object.entries(rolePerms)){const role=get("SELECT id FROM admin_roles WHERE name = ?",[roleName]);if(!role)continue;for(const[resource,action]of perms){run("INSERT OR IGNORE INTO admin_role_permissions (role_id, resource, action) VALUES (?,?,?)",[role.id,resource,action])}}},
};
