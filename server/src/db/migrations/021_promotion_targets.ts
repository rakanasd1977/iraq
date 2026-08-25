const { db, run, all, get } = require('../index');

module.exports = {
  name: "021_promotion_targets",
  up: ()=>{db.exec(`
        ALTER TABLE promotions ADD COLUMN target_type TEXT NOT NULL DEFAULT 'governorate' CHECK (target_type IN ('governorate','all'));
        ALTER TABLE promotions ADD COLUMN target_governorate_ids TEXT;
        ALTER TABLE promotions ADD COLUMN billing TEXT NOT NULL DEFAULT 'wallet' CHECK (billing IN ('wallet','free'));
        UPDATE promotions SET target_governorate_ids = CAST(governorate_id AS TEXT) WHERE target_governorate_ids IS NULL;
        CREATE INDEX IF NOT EXISTS idx_promotions_target ON promotions(target_type, status, ends_at);
      `)},
};
