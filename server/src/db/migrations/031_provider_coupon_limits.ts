const { db, run, all, get } = require('../index');
globalThis.__name = globalThis.__name || ((fn, name) => fn);

module.exports = {
  name: "031_provider_coupon_limits",
  up: ()=>{const seed=__name((key,value,label)=>{const exists=get("SELECT key FROM settings WHERE key = ?",[key]);if(!exists)run("INSERT INTO settings (key, value, label) VALUES (?,?,?)",[key,value,label])},"seed");seed("provider_coupon_max_percent","50","\u0627\u0644\u062D\u062F \u0627\u0644\u0623\u0642\u0635\u0649 \u0644\u0646\u0633\u0628\u0629 \u062E\u0635\u0645 \u0643\u0648\u0628\u0648\u0646\u0627\u062A \u0627\u0644\u0645\u0632\u0648\u062F\u064A\u0646 (%)");seed("provider_coupon_max_fixed","100000","\u0627\u0644\u062D\u062F \u0627\u0644\u0623\u0642\u0635\u0649 \u0644\u062E\u0635\u0645 \u0627\u0644\u0643\u0648\u0628\u0648\u0646 \u0627\u0644\u062B\u0627\u0628\u062A \u0644\u0644\u0645\u0632\u0648\u062F\u064A\u0646 (\u062F\u064A\u0646\u0627\u0631)")},
};
