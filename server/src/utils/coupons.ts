const { get, all } = require('../db');
const { ApiError, round2 } = require('./helpers');

// التحقق من صلاحية الكوبون وحساب الخصم ضد إجمالي فرعي محدد.
// يعيد { coupon, discount } أو يرمي ApiError برسالة واضحة.
function validateCoupon(code, { providerId, amount, customerId }) {
  const raw = String(code || '').trim().toUpperCase().replace(/\s+/g, '-');
  if (!raw) throw new ApiError(400, 'أدخل رمز الكوبون');

  const coupon = get('SELECT * FROM coupons WHERE code = ?', [raw]);
  if (!coupon || !coupon.is_active) throw new ApiError(400, 'رمز الكوبون غير صالح');
  // كوبونات الخصم حصرية للمزوّدين: الكوبونات العامة (بلا مزوّد) مرفوضة تماماً
  if (!coupon.provider_id) throw new ApiError(400, 'رمز الكوبون غير صالح');

  const subtotal = round2(Number(amount) || 0);
  if (subtotal <= 0) throw new ApiError(400, 'إجمالي الطلب غير صالح لتطبيق الكوبون');

  if (coupon.provider_id && Number(coupon.provider_id) !== Number(providerId)) {
    throw new ApiError(400, 'هذا الكوبون غير صالح لهذا المتجر');
  }
  if (subtotal < Number(coupon.min_amount)) {
    throw new ApiError(400, `الحد الأدنى للطلب لتطبيق الكوبون هو ${round2(coupon.min_amount)} دينار`);
  }

  const now = Date.now();
  const startsAt = coupon.starts_at ? new Date(coupon.starts_at).getTime() : 0;
  const endsAt = coupon.ends_at ? new Date(coupon.ends_at).getTime() : Infinity;
  // تاريخ تالف (NaN) لا يجب أن يمر الفحصين (NaN > now و NaN < now كلاهما خاطئ) — يُرفض لئلا يصبح الكوبون خالداً
  if (Number.isNaN(startsAt)) {
    throw new ApiError(400, 'تاريخ بداية الكوبون غير صالح');
  }
  if (Number.isNaN(endsAt)) {
    throw new ApiError(400, 'تاريخ نهاية الكوبون غير صالح');
  }
  if (startsAt > now) {
    throw new ApiError(400, 'لم يحن موعد تفعيل الكوبون بعد');
  }
  if (endsAt < now) {
    throw new ApiError(400, 'انتهت صلاحية الكوبون');
  }

  const usedTotal = get('SELECT COUNT(*) AS c FROM coupon_usages WHERE coupon_id = ?', [coupon.id]).c;
  if (Number(coupon.max_uses) > 0 && usedTotal >= Number(coupon.max_uses)) {
    throw new ApiError(400, 'لقد استُهلك هذا الكوبون بالكامل');
  }
  if (customerId) {
    const usedByCustomer = get(
      'SELECT COUNT(*) AS c FROM coupon_usages WHERE coupon_id = ? AND customer_id = ?',
      [coupon.id, customerId]
    ).c;
    if (Number(coupon.per_customer_limit) > 0 && usedByCustomer >= Number(coupon.per_customer_limit)) {
      throw new ApiError(400, 'لقد استخدمت هذا الكوبون من قبل — الحد المسموح هو ' + coupon.per_customer_limit);
    }
  }

  let discount;
  if (coupon.discount_type === 'fixed') {
    discount = round2(Math.min(Number(coupon.discount_value), subtotal));
  } else {
    discount = round2(subtotal * Number(coupon.discount_value) / 100);
  }
  if (discount <= 0) throw new ApiError(400, 'قيمة الخصم صفر، لا يمكن تطبيق الكوبون');

  return { coupon, discount };
}

module.exports = { validateCoupon };
