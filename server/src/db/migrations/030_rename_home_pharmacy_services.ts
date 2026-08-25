const { db, run, all, get } = require('../index');

module.exports = {
  name: "030_rename_home_pharmacy_services",
  up: ()=>{run("UPDATE services SET name_ar = '\u0645\u0648\u0627\u062F \u0645\u0646\u0632\u0644\u064A\u0629', name_en = 'Home Materials', icon = '\u{1F9FA}', description = '\u0645\u0648\u0627\u062F \u0648\u0623\u062F\u0648\u0627\u062A \u0645\u0646\u0632\u0644\u064A\u0629' WHERE slug = 'home_services'");run("UPDATE services SET name_ar = '\u0645\u0648\u0627\u062F \u0627\u0646\u0634\u0627\u0626\u064A\u0629', name_en = 'Construction Materials', icon = '\u{1F9F1}', description = '\u0645\u0648\u0627\u062F \u0628\u0646\u0627\u0621 \u0648\u0625\u0646\u0634\u0627\u0621\u0627\u062A' WHERE slug = 'pharmacies'")},
};
