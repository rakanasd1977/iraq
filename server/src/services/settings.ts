const { get, all, run } = require('../db');
const { ApiError } = require('../utils/helpers');
const { logActivity } = require('../utils/log');

function shape(rows) {
  const out = {};
  rows.forEach((r) => { out[r.key] = { value: r.value, label: r.label }; });
  return out;
}

function listSettings() {
  return shape(all('SELECT key, value, label FROM settings ORDER BY key ASC'));
}

function putSettings(body, actor) {
  const updated = [];
  for (const [key, val] of Object.entries(body || {})) {
    if (typeof val !== 'object' || val === null || !('value' in val)) {
      throw new ApiError(400, `بنية غير صالحة للمفتاح ${key}`);
    }
    if (VALIDATORS[key]) VALIDATORS[key](val.value);
    const exists = get('SELECT key FROM settings WHERE key = ?', [key]);
    if (exists) {
      run('UPDATE settings SET value = ?, updated_at = datetime(\'now\') WHERE key = ?', [String(val.value), key]);
    } else {
      run('INSERT INTO settings (key, value, label) VALUES (?,?,?)', [key, String(val.value), val.label || null]);
    }
    updated.push(key);
  }
  if (updated.length) logActivity(actor, 'update', 'settings', null, { keys: updated });
  return listSettings();
}

const VALIDATORS = {
  promo_price: (v) => { const n = Number(v); if (isNaN(n) || n < 0) throw new ApiError(400, 'سعر الترويج يجب أن يكون رقمًا موجبًا'); },
  promo_duration_days: (v) => { const n = Number(v); if (isNaN(n) || n < 1 || n > 365) throw new ApiError(400, 'مدة الترويج بين 1 و 365 يوم'); },
  promo_max_active: (v) => { const n = Number(v); if (isNaN(n) || n < 1 || n > 100) throw new ApiError(400, 'الحد الأقصى للترويجات بين 1 و 100'); },
  agent_default_commission: (v) => { const n = Number(v); if (isNaN(n) || n < 0 || n > 100) throw new ApiError(400, 'عمولة الوكيل بين 0% و 100%'); },
  platform_commission_default: (v) => { const n = Number(v); if (isNaN(n) || n < 0 || n > 100) throw new ApiError(400, 'عمولة المنصة بين 0% و 100%'); },
  provider_free_orders: (v) => { const n = Number(v); if (isNaN(n) || n < 0 || n > 1000) throw new ApiError(400, 'عدد الطلبات المجانية للمزود يجب أن يكون بين 0 و 1000'); },
  free_shipping_min: (v) => { const n = Number(v); if (isNaN(n) || n < 0) throw new ApiError(400, 'الحد الأدنى للشحن المجاني يجب أن يكون رقمًا موجبًا'); },
  loyalty_point_value: (v) => { const n = Number(v); if (isNaN(n) || n < 1) throw new ApiError(400, 'قيمة النقطة يجب أن تكون 1 أو أكثر'); },
  loyalty_min_redeem: (v) => { const n = Number(v); if (isNaN(n) || n < 1) throw new ApiError(400, 'الحد الأدنى للنقاط يجب أن يكون 1 أو أكثر'); },
  loyalty_earn_per_1000: (v) => { const n = Number(v); if (isNaN(n) || n < 0) throw new ApiError(400, 'نقاط الولاء لكل 1000 دينار يجب أن يكون رقمًا موجبًا'); },
  referral_bonus_referrer: (v) => { const n = Number(v); if (isNaN(n) || n < 0) throw new ApiError(400, 'مكافأة الداعي يجب أن تكون رقمًا موجبًا'); },
  referral_bonus_referee: (v) => { const n = Number(v); if (isNaN(n) || n < 0) throw new ApiError(400, 'مكافأة المدعو يجب أن تكون رقمًا موجبًا'); },
  referral_min_order: (v) => { const n = Number(v); if (isNaN(n) || n < 0) throw new ApiError(400, 'الحد الأدنى للطلب يجب أن يكون رقمًا موجبًا'); },
  provider_coupon_max_percent: (v) => { const n = Number(v); if (isNaN(n) || n < 0 || n > 100) throw new ApiError(400, 'نسبة كوبونات المزودين بين 0% و 100%'); },
  provider_coupon_max_fixed: (v) => { const n = Number(v); if (isNaN(n) || n < 0) throw new ApiError(400, 'الحد الأقصى للخصم الثابت يجب أن يكون رقمًا موجبًا'); },
  activity_log_retention_days: (v) => { const n = Number(v); if (isNaN(n) || n < 1 || n > 3650) throw new ApiError(400, 'أيام الاحتفاظ بين 1 و 3650'); },
  require_agent_lease: (v) => { if (v !== '0' && v !== '1' && v !== 'true' && v !== 'false') throw new ApiError(400, 'القيمة يجب أن تكون 0 أو 1'); },
};

function putSetting(key, value, label, actor) {
  if (value === undefined) throw new ApiError(400, 'القيمة مطلوبة');
  if (VALIDATORS[key]) VALIDATORS[key](value);

  const exists = get('SELECT key FROM settings WHERE key = ?', [key]);
  if (exists) {
    run('UPDATE settings SET value = ?, updated_at = datetime(\'now\') WHERE key = ?', [String(value), key]);
  } else {
    run('INSERT INTO settings (key, value, label) VALUES (?,?,?)', [key, String(value), label || null]);
  }
  logActivity(actor, 'update', 'settings', null, { keys: [key] });

  const row = get('SELECT key, value, label FROM settings WHERE key = ?', [key]);
  return { [row.key]: { value: row.value, label: row.label } };
}

function getSetting(key) {
  const row = get('SELECT key, value, label FROM settings WHERE key = ?', [key]);
  if (!row) throw new ApiError(404, 'الإعداد غير موجود');
  return { [row.key]: { value: row.value, label: row.label } };
}

module.exports = { listSettings, putSettings, putSetting, getSetting };
