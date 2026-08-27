const { db, run, all, get } = require('../index');

module.exports = {
  name: '043_promotion_placement',
  up: () => {
    db.exec(`
      ALTER TABLE promotions ADD COLUMN placement TEXT NOT NULL DEFAULT 'home_top'
        CHECK (placement IN ('home_top','most_ordered'));
      UPDATE promotions SET placement = 'home_top' WHERE placement IS NULL;
      CREATE INDEX IF NOT EXISTS idx_promotions_placement ON promotions(placement, status, ends_at);
    `);
  },
};
