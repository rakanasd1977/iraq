const { get, all, run } = require('../db');
const { ApiError, toId, paginate } = require('../utils/helpers');
const { logActivity } = require('../utils/log');

function normalize(body) {
  const out = {};
  if (body.code !== undefined) out.code = String(body.code).trim().toUpperCase();
  if (body.title !== undefined) out.title = body.title ? String(body.title).trim() : null;
  if (body.discount_type !== undefined) {
    if (!['percent', 'fixed'].includes(body.discount_type)) throw new ApiError(400, 'نوع الخصم غير صالح');
    out.discount_type = body.discount_type;
  }
  if (body.discount_value !== undefined) {
    const v = Number(body.discount_value);
    if (!(v > 0)) throw new ApiError(400, 'قيمة الخصم يجب أن تكون موجبة');
    if (body.discount_type === 'percent' && v > 100) throw new ApiError(400, 'نسبة الخصم حتى 100%');
    out.discount_value = v;
  }
  if (body.min_amount !== undefined) out.min_amount = Math.max(0, Number(body.min_amount) || 0);
  if (body.provider_id !== undefined) out.provider_id = body.provider_id ? Number(body.provider_id) : null;
  if (body.starts_at !== undefined) out.starts_at = body.starts_at || null;
  if (body.ends_at !== undefined) out.ends_at = body.ends_at || null;
  if (body.max_uses !== undefined) out.max_uses = Math.max(0, Math.round(Number(body.max_uses) || 0));
  if (body.per_customer_limit !== undefined) out.per_customer_limit = Math.max(1, Math.round(Number(body.per_customer_limit) || 1));
  if (body.is_active !== undefined) out.is_active = body.is_active ? 1 : 0;
  return out;
}

const EDITABLE = ['code', 'title', 'discount_type', 'discount_value', 'min_amount', 'provider_id', 'starts_at', 'ends_at', 'max_uses', 'per_customer_limit', 'is_active'];

function listCoupons({ q, provider_id, active, page, limit = 50 }) {
  let sql = `SELECT c.*, pr.name_ar AS provider_name,
    (SELECT COUNT(*) FROM coupon_usages u WHERE u.coupon_id = c.id) AS used_count
    FROM coupons c LEFT JOIN providers pr ON pr.id = c.provider_id WHERE 1=1`;
  const params = [];
  if (provider_id) { sql += ' AND c.provider_id = ?'; params.push(Number(provider_id)); }
  if (q) { sql += ' AND (c.code LIKE ? OR c.title LIKE ?)'; params.push('%' + q + '%', '%' + q + '%'); }
  if (active === '1' || active === 1) sql += ' AND c.is_active = 1';
  if (active === '0' || active === 0) sql += ' AND c.is_active = 0';
  const pg = paginate({ query: { page, limit } }, 50);
  const total = get(`SELECT COUNT(*) AS c FROM (${sql})`, params).c;
  const rows = all(sql + ' ORDER BY c.id DESC LIMIT ? OFFSET ?', [...params, pg.limit, pg.offset]);
  return { rows, total, page: pg.page, limit: pg.limit, pages: Math.max(1, Math.ceil(total / pg.limit)) };
}

function getCoupon(id) {
  const row = get('SELECT c.*, pr.name_ar AS provider_name FROM coupons c LEFT JOIN providers pr ON pr.id = c.provider_id WHERE c.id = ?', [toId(id)]);
  if (!row) throw new ApiError(404, 'الكوبون غير موجود');
  return row;
}

function createCoupon(body, actor) {
  const n = normalize(body);
  if (!n.code) throw new ApiError(400, 'الكود مطلوب');
  if (n.discount_type === undefined) n.discount_type = 'percent';
  if (n.discount_value === undefined) throw new ApiError(400, 'قيمة الخصم مطلوبة');
  const clash = get('SELECT id FROM coupons WHERE code = ?', [n.code]);
  if (clash) throw new ApiError(409, 'الكود موجود مسبقاً');
  const id = run(
    `INSERT INTO coupons (code, title, discount_type, discount_value, min_amount, provider_id, starts_at, ends_at, max_uses, per_customer_limit, is_active)
     VALUES (?,?,?,?,?,?,?,?,?,?,1)`,
    [n.code, n.title, n.discount_type, n.discount_value, n.min_amount || 0, n.provider_id ?? null, n.starts_at || null, n.ends_at || null, n.max_uses || 0, n.per_customer_limit || 1]
  ).lastId;
  logActivity(actor, 'create', 'coupons', id, { code: n.code });
  return getCoupon(id);
}

function updateCoupon(id, body, actor) {
  const row = get('SELECT * FROM coupons WHERE id = ?', [toId(id)]);
  if (!row) throw new ApiError(404, 'الكوبون غير موجود');
  const n = normalize(body);
  const sets = [];
  const params = [];
  for (const k of EDITABLE) {
    if (n[k] === undefined) continue;
    sets.push(`${k} = ?`);
    params.push(n[k]);
  }
  if (!sets.length) throw new ApiError(400, 'لا توجد حقول للتحديث');
  sets.push("updated_at = datetime('now')");
  params.push(toId(id));
  run(`UPDATE coupons SET ${sets.join(', ')} WHERE id = ?`, params);
  logActivity(actor, 'update', 'coupons', id);
  return getCoupon(id);
}

function toggleCoupon(id, actor) {
  const row = get('SELECT * FROM coupons WHERE id = ?', [toId(id)]);
  if (!row) throw new ApiError(404, 'الكوبون غير موجود');
  const next = row.is_active ? 0 : 1;
  run(`UPDATE coupons SET is_active = ?, updated_at = datetime('now') WHERE id = ?`, [next, toId(id)]);
  logActivity(actor, next ? 'activate' : 'deactivate', 'coupons', id);
  return getCoupon(id);
}

function deleteCoupon(id, actor) {
  const row = get('SELECT * FROM coupons WHERE id = ?', [toId(id)]);
  if (!row) throw new ApiError(404, 'الكوبون غير موجود');
  run('DELETE FROM coupons WHERE id = ?', [toId(id)]);
  logActivity(actor, 'delete', 'coupons', id);
  return { message: 'تم حذف الكوبون بنجاح' };
}

module.exports = { listCoupons, getCoupon, createCoupon, updateCoupon, toggleCoupon, deleteCoupon };
