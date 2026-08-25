const { db, run, all, get } = require('../index');

module.exports = {
  name: "008_lease_payments_updated_at",
  up: ()=>{db.exec("ALTER TABLE lease_payments ADD COLUMN updated_at TEXT;");db.exec("UPDATE lease_payments SET updated_at = created_at;")},
};
