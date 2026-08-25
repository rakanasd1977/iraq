const { all } = require('../db');

// عدّاد المبيعات: إجمالي الكميات المباعة لكل بند (kind:item_id) من الطلبات المكتملة.
// بيانات البنود مخزّنة في items_json على شكل صفيف [{kind, item_id, quantity, ...}].
function buildSoldMap() {
  const rows = all(
    `SELECT json_extract(it.value, '$.kind') AS kind,
            json_extract(it.value, '$.item_id') AS item_id,
            SUM(CAST(json_extract(it.value, '$.quantity') AS INTEGER)) AS sold
     FROM orders o, json_each(COALESCE(o.items_json, '[]')) AS it
     WHERE o.status = 'completed'
       AND o.items_json IS NOT NULL AND o.items_json <> ''
     GROUP BY kind, item_id`
  );
  const map = new Map();
  for (const r of rows) {
    if (r.kind && r.item_id !== null && r.item_id !== undefined) {
      map.set(`${r.kind}:${Number(r.item_id)}`, Number(r.sold) || 0);
    }
  }
  return map;
}

module.exports = { buildSoldMap };
