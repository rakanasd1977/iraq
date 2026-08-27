const { db, run, all, get } = require('../index');

module.exports = {
  name: "015_rating_replies",
  up: ()=>{db.exec("ALTER TABLE provider_ratings ADD COLUMN reply TEXT;");db.exec("ALTER TABLE provider_ratings ADD COLUMN replied_at TEXT;")},
};
