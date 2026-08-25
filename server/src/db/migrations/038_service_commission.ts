const { db, run, all, get } = require('../index');

module.exports = {
  name: '038_service_commission',
  up: () => {
    db.exec(`ALTER TABLE services ADD COLUMN commission_rate REAL;`);
  },
};
