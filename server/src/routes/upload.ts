const express = require('express');
const { authenticate } = require('../middleware/auth');
const { ok } = require('../utils/response');
const { saveBase64ToUpload } = require('../utils/uploads');
const { invalidateSensitiveRefs } = require('../utils/sensitiveRefs');

const router = express.Router();
router.use(authenticate);

// رفع صورة — تُحفظ في data/uploads ويُقدَّم الرابط من /uploads/<file>
// الفحص: data-URI بصيغة image/*، حجم ≤ 2MB، وmagic bytes تطابق الصيغة المعلنة
router.post('/', (req, res, next) => {
  try {
    const { url, filename } = saveBase64ToUpload((req.body && req.body.data) || '');
    // إبطال كاش الملفات الحسّاسة فور الرفع لمنع نافذة تقديم عام مؤقتة
    invalidateSensitiveRefs();
    return ok(res, { url, filename });
  } catch (e: any) {
    next(e);
  }
});

module.exports = router;
