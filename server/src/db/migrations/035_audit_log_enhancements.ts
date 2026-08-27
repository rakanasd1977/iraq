const { db, run, all, get } = require('../index');

module.exports = {
  name: "035_audit_log_enhancements",
  up: ()=>{const acols=all("PRAGMA table_info(activity_log)").map(c=>c.name);if(!acols.includes("ip_address"))run("ALTER TABLE activity_log ADD COLUMN ip_address TEXT");if(!acols.includes("user_agent"))run("ALTER TABLE activity_log ADD COLUMN user_agent TEXT");run("CREATE INDEX IF NOT EXISTS idx_activity_log_user_id ON activity_log(user_id)");run("CREATE INDEX IF NOT EXISTS idx_activity_log_entity ON activity_log(entity_type, entity_id)");run("CREATE INDEX IF NOT EXISTS idx_activity_log_created ON activity_log(created_at)")},
};
