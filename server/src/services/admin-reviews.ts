const { get, all, run } = require('../db');
const { ApiError, toId, paginate } = require('../utils/helpers');
const { logActivity } = require('../utils/log');
const { recomputeItemRating } = require('../utils/itemRatings');

const ITEM_TITLE = {
  products: 'SELECT name_ar AS t FROM products WHERE id = ?',
  menu: 'SELECT name_ar AS t FROM menu_items WHERE id = ?',
  packages: 'SELECT name_ar AS t FROM travel_packages WHERE id = ?',
  rooms: 'SELECT name_ar AS t FROM hotel_rooms WHERE id = ?',
  flights: 'SELECT flight_number AS t FROM flights WHERE id = ?',
};

function itemTitle(type, id) {
  const q = ITEM_TITLE[type];
  if (!q) return null;
  const r = get(q, [Number(id)]);
  return r ? r.t : null;
}

function listReviews({ scope = 'item', q, provider_id, rating, page, limit = 50 }) {
  const table = scope === 'provider' ? 'provider_ratings' : 'item_ratings';
  let sql = `SELECT r.*, u.name_ar AS customer_name, p.name_ar AS provider_name FROM ${table} r
    JOIN users u ON u.id = r.customer_id
    JOIN providers p ON p.id = r.provider_id WHERE 1=1`;
  const params = [];
  if (provider_id) { sql += ' AND r.provider_id = ?'; params.push(Number(provider_id)); }
  if (rating) { sql += ' AND r.rating = ?'; params.push(Number(rating)); }
  if (q) { sql += ' AND (r.comment LIKE ? OR u.name_ar LIKE ?)'; params.push('%' + q + '%', '%' + q + '%'); }
  const pg = paginate({ query: { page, limit } }, 50);
  const total = get(`SELECT COUNT(*) AS c FROM (${sql})`, params).c;
  const rows = all(sql + ' ORDER BY r.id DESC LIMIT ? OFFSET ?', [...params, pg.limit, pg.offset]);
  const decorated = rows.map((r) => ({
    ...r,
    item_title: scope === 'item' ? itemTitle(r.item_type, r.item_id) : null,
  }));
  return { rows: decorated, total, page: pg.page, limit: pg.limit, pages: Math.max(1, Math.ceil(total / pg.limit)) };
}

function deleteReview(scope, id, actor) {
  const table = scope === 'provider' ? 'provider_ratings' : 'item_ratings';
  const row = get(`SELECT * FROM ${table} WHERE id = ?`, [toId(id)]);
  if (!row) throw new ApiError(404, 'التقييم غير موجود');
  run(`DELETE FROM ${table} WHERE id = ?`, [toId(id)]);
  if (scope !== 'provider') {
    recomputeItemRating(row.item_type, row.item_id, row.provider_id);
  }
  logActivity(actor, 'delete', scope === 'provider' ? 'provider_review' : 'item_review', id);
  return { message: 'تم حذف التقييم بنجاح' };
}

module.exports = { listReviews, deleteReview };
