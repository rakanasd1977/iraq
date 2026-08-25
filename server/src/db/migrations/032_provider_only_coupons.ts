const { db, run, all, get } = require('../index');

module.exports = {
  name: "032_provider_only_coupons",
  up: ()=>{run("UPDATE coupons SET is_active = 0, updated_at = datetime('now') WHERE provider_id IS NULL")},
};
