const { all } = require('../db');

// مجموعة الملفات الحسّاسة (وثائق هوية/إثباتات شحن الرصيد). تُحسب عند الحاجة وتُخبَّأ
// لفترة قصيرة لتفادي استعلام قاعدة البيانات على كل صورة، مع إمكانية إبطالها فور الرفع.
let _set = null;
let _at = 0;

function rebuild() {
  const rows = all(
    `SELECT national_id_image AS r FROM providers WHERE national_id_image IS NOT NULL
     UNION SELECT residency_doc_image FROM providers WHERE residency_doc_image IS NOT NULL
     UNION SELECT proof_image FROM recharge_requests WHERE proof_image IS NOT NULL`
  );
  _set = new Set((rows || []).map((x) => x.r).filter(Boolean));
  _at = Date.now();
  return _set;
}

function getSensitiveRefs() {
  if (_set && Date.now() - _at < 5 * 60 * 1000) return _set;
  return rebuild();
}

function invalidateSensitiveRefs() {
  _set = null;
  _at = 0;
}

module.exports = { getSensitiveRefs, invalidateSensitiveRefs };
