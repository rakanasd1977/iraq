const { db, run, all, get } = require('../index');

module.exports = {
  name: "005_indexes_and_retention",
  up: ()=>{db.exec(`
        CREATE INDEX IF NOT EXISTS idx_products_category ON products(category_id);
        CREATE INDEX IF NOT EXISTS idx_products_provider ON products(provider_id);
        CREATE INDEX IF NOT EXISTS idx_activity_log_created ON activity_log(created_at);
        INSERT OR IGNORE INTO settings (key, value, label, updated_at)
          VALUES ('activity_log_retention_days', '90', '\u0627\u0644\u0627\u062D\u062A\u0641\u0627\u0638 \u0628\u0633\u062C\u0644\u0627\u062A \u0627\u0644\u0646\u0634\u0627\u0637 (\u0623\u064A\u0627\u0645)', datetime('now'));
      `)},
};
