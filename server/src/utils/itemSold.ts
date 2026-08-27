const { all } = require('../db');

// عدّاد المبيعات: إجمالي الكميات المباعة لكل بند (kind:item_id) من الطلبات المكتملة.
// بيانات البنود مخزّنة في items_json على شكل صفيف [{kind, item_id, quantity, ...}].

// تخبيء قصير العمر: يُعاد بناء الخريطة مرّة واحدة كل فترة بدل حسابها في كل طلب،
// لأنها مكلفة نسبياً وتُستدعى من أكثر من مسار (العروض، الأكثر طلباً...).
const SOLD_CACHE_TTL = 15000;
let _cache = null;
let _cacheAt = 0;

function buildSoldMap() {
  const now = Date.now();
  if (_cache && now - _cacheAt < SOLD_CACHE_TTL) return _cache;
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
  _cache = map;
  _cacheAt = now;
  return map;
}

module.exports = { buildSoldMap };
