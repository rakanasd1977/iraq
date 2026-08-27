const { db, run, all, get } = require('../index');

module.exports = {
  name: "029_free_shipping_setting",
  up: ()=>{const exists=get("SELECT key FROM settings WHERE key = ?",["free_shipping_min"]);if(!exists){run("INSERT INTO settings (key, value, label) VALUES (?,?,?)",["free_shipping_min","50000","\u0627\u0644\u062D\u062F \u0627\u0644\u0623\u062F\u0646\u0649 \u0644\u0644\u0634\u062D\u0646 \u0627\u0644\u0645\u062C\u0627\u0646\u064A (\u062F\u064A\u0646\u0627\u0631)"])}},
};
