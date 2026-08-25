const { db, run, all, get } = require('../index');

module.exports = {
  name: "028_sold_counters_demo",
  up: ()=>{seedSoldCountersDemo()},
};
