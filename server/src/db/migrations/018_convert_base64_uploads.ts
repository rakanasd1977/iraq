const { db, run, all, get } = require('../index');
globalThis.__name = globalThis.__name || ((fn, name) => fn);

module.exports = {
  name: "018_convert_base64_uploads",
  up: ()=>{const{convertBase64Value}=require("../../utils/uploads");const convert=__name(v=>{try{return convertBase64Value(v)}catch(e){console.warn(`[migrate 018] \u062A\u062E\u0637\u064A \u0635\u0648\u0631\u0629 \u062A\u0627\u0644\u0641\u0629 (\u062A\u064F\u062A\u0631\u0643 \u0643\u0645\u0627 \u0647\u064A): ${e.message}`);return v}},"convert");const singleCols=[["providers","logo"],["providers","cover"],["providers","national_id_image"],["providers","residency_doc_image"],["recharge_requests","proof_image"],["users","avatar"],["promotions","item_image"]];for(const[table,col]of singleCols){for(const row of all(`SELECT id, ${col} AS v FROM ${table} WHERE ${col} LIKE 'data:image/%'`)){const next=convert(row.v);if(next!==row.v)run(`UPDATE ${table} SET ${col} = ? WHERE id = ?`,[next,row.id])}}for(const table of["products","menu_items","hotel_rooms","travel_packages"]){for(const row of all(`SELECT id, images_json AS v FROM ${table} WHERE images_json LIKE '%data:image/%'`)){const next=convert(row.v);if(next!==row.v)run(`UPDATE ${table} SET images_json = ? WHERE id = ?`,[next,row.id])}}},
};
