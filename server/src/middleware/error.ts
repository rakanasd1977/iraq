const { ApiError } = require('../utils/helpers');
const { fail } = require('../utils/response');

function notFound(req, res) {
  return fail(res, 404, 'المسار غير موجود');
}

function errorHandler(err, req, res, next) {
  if (err instanceof ApiError) {
    return fail(res, err.status, err.message, err.details);
  }
  if (err && err.type === 'entity.parse.failed') {
    return fail(res, 400, 'صيغة JSON غير صالحة في الطلب');
  }
  if (err && err.type === 'entity.too.large') {
    return fail(res, 413, 'حجم الطلب يتجاوز الحد المسموح');
  }
  if (err && err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
    return fail(res, 409, 'توجد قيمة مكررة (البريد أو الهاتف أو الرمز مستخدم مسبقاً)');
  }
  if (err && err.code && String(err.code).startsWith('SQLITE_CONSTRAINT')) {
    return fail(res, 409, 'تعارض في البيانات المطلوبة');
  }
  if (err && /SQLITE_BUSY|SQLITE_LOCKED/.test(String(err.code)) || err && /SQLITE_BUSY|SQLITE_LOCKED/.test(String(err.message))) {
    return fail(res, 503, 'قاعدة البيانات مشغولة حالياً، أعد المحاولة خلال لحظات');
  }
  console.error('[error]', err);
  return fail(res, 500, 'خطأ داخلي في الخادم');
}

module.exports = { notFound, errorHandler };
