const { db, run, all, get } = require('../index');

module.exports = {
  name: "023_catalog_images",
  up: ()=>{db.exec(`
        ALTER TABLE flights ADD COLUMN images_json TEXT;
        CREATE INDEX IF NOT EXISTS idx_catalog_images ON products(is_active, is_featured);
      `)},
};
