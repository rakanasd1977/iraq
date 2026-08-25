const { db, run, all, get } = require('../index');

module.exports = {
  name: "014_catalog_featured",
  up: ()=>{db.exec("ALTER TABLE hotel_rooms ADD COLUMN is_featured INTEGER NOT NULL DEFAULT 0;");db.exec("ALTER TABLE flights ADD COLUMN is_featured INTEGER NOT NULL DEFAULT 0;");db.exec("ALTER TABLE travel_packages ADD COLUMN is_featured INTEGER NOT NULL DEFAULT 0;")},
};
