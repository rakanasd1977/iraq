const { get, all, run } = require('../db');
const { ApiError, toId, paginate, parseImages, parseIncludes } = require('../utils/helpers');
const { logActivity } = require('../utils/log');
const { deleteRemovedImages } = require('../utils/uploads');
const CAT = require('../routes/catalog');

// تعريف أنواع عناصر الكتالوج التي يمكن للمدير إدارتها عبر كل المزودين
function kindDef(kind) {
  const map = {
    products: {
      table: 'products', label: 'منتج', titleCol: 'name_ar', cols: CAT.PRODUCT_COLS,
      extraSelect: ', pc.name_ar AS category_name',
      extraJoin: 'LEFT JOIN product_categories pc ON pc.id = products.category_id',
    },
    menu_items: {
      table: 'menu_items', label: 'صنف', titleCol: 'name_ar', cols: CAT.MENU_ITEM_COLS,
      extraSelect: ', mc.name_ar AS category_name',
      extraJoin: 'LEFT JOIN menu_categories mc ON mc.id = menu_items.category_id',
    },
    hotel_rooms: {
      table: 'hotel_rooms', label: 'غرفة', titleCol: 'name_ar', cols: CAT.ROOM_COLS,
      extraSelect: '', extraJoin: '',
    },
    flights: {
      table: 'flights', label: 'رحلة', titleCol: 'flight_number', cols: CAT.FLIGHT_COLS,
      extraSelect: '', extraJoin: '',
    },
    travel_packages: {
      table: 'travel_packages', label: 'باقة', titleCol: 'name_ar', cols: CAT.PACKAGE_COLS,
      extraSelect: '', extraJoin: '',
    },
  };
  const d = map[kind];
  if (!d) throw new ApiError(400, 'نوع عنصر كتالوج غير معروف');
  return d;
}

function normalize(c, v) {
  if (v === undefined || v === null || v === '') return null;
  if (c.type === 'bool') {
    if (typeof v === 'boolean') return v ? 1 : 0;
    const s = String(v).toLowerCase();
    return s === '1' || s === 'true' ? 1 : 0;
  }
  if (c.type === 'json') return JSON.stringify(Array.isArray(v) ? v : []);
  if (c.type === 'int') {
    const n = Math.round(Number(v) || 0);
    if (n < 0) throw new ApiError(400, `${c.label} يجب أن يكون رقماً غير سالب`);
    return n;
  }
  if (c.type === 'real') {
    const n = Number(v) || 0;
    if (n < 0) throw new ApiError(400, `${c.label} يجب أن يكون رقماً غير سالب`);
    return n;
  }
  if (c.type === 'date') {
    const dt = v ? new Date(v) : null;
    return dt && !Number.isNaN(dt.getTime()) ? dt.toISOString() : null;
  }
  return String(v);
}

const ALL_KINDS = ['products', 'menu_items', 'hotel_rooms', 'flights', 'travel_packages'];

function listCatalog({ kind = 'products', provider_id, q, active, page, limit = 50 }) {
  const d = kindDef(kind);
  let sql = `SELECT ${d.table}.*, pr.name_ar AS provider_name ${d.extraSelect} FROM ${d.table} ${d.extraJoin} JOIN providers pr ON pr.id = ${d.table}.provider_id WHERE 1=1`;
  const params = [];
  if (provider_id) { sql += ' AND pr.id = ?'; params.push(Number(provider_id)); }
  if (q) { sql += ` AND ${d.table}.${d.titleCol} LIKE ?`; params.push('%' + String(q) + '%'); }
  if (active === '1' || active === 1) sql += ` AND ${d.table}.is_active = 1`;
  if (active === '0' || active === 0) sql += ` AND ${d.table}.is_active = 0`;
  const pg = paginate({ query: { page, limit } }, 50);
  const total = get(`SELECT COUNT(*) AS c FROM (${sql})`, params).c;
  const rows = all(
    sql + ` ORDER BY ${d.table}.id DESC LIMIT ? OFFSET ?`,
    [...params, pg.limit, pg.offset]
  );
  return {
    rows: rows.map((r) => ({ ...r, images: parseImages(r.images_json), includes: parseIncludes(r.includes_json) })),
    total, page: pg.page, limit: pg.limit, pages: Math.max(1, Math.ceil(total / pg.limit)),
  };
}

function getCatalogItem(kind, id) {
  const d = kindDef(kind);
  const row = get(
    `SELECT ${d.table}.*, pr.name_ar AS provider_name ${d.extraSelect} FROM ${d.table} ${d.extraJoin} JOIN providers pr ON pr.id = ${d.table}.provider_id WHERE ${d.table}.id = ?`,
    [toId(id)]
  );
  if (!row) throw new ApiError(404, `ال${d.label} غير موجود`);
  return { ...row, images: parseImages(row.images_json), includes: parseIncludes(row.includes_json) };
}

function updateCatalogItem(kind, id, body, actor) {
  const d = kindDef(kind);
  const row = get(`SELECT * FROM ${d.table} WHERE id = ?`, [toId(id)]);
  if (!row) throw new ApiError(404, `ال${d.label} غير موجود`);
  const sets = [];
  const params = [];
  for (const c of d.cols) {
    if (body[c.name] === undefined || body[c.name] === '') continue;
    sets.push(`${c.name} = ?`);
    params.push(normalize(c, body[c.name]));
  }
  if (!sets.length) throw new ApiError(400, 'لا توجد حقول للتحديث');
  sets.push("updated_at = datetime('now')");
  params.push(toId(id));
  run(`UPDATE ${d.table} SET ${sets.join(', ')} WHERE id = ?`, params);
  const fresh = get(`SELECT * FROM ${d.table} WHERE id = ?`, [toId(id)]);
  deleteRemovedImages(row.images_json, fresh.images_json);
  logActivity(actor, 'update', 'catalog', id, { kind });
  return { ...fresh, images: parseImages(fresh.images_json), includes: parseIncludes(fresh.includes_json) };
}

function toggleCatalogItem(kind, id, actor) {
  const d = kindDef(kind);
  const row = get(`SELECT * FROM ${d.table} WHERE id = ?`, [toId(id)]);
  if (!row) throw new ApiError(404, `ال${d.label} غير موجود`);
  const next = row.is_active ? 0 : 1;
  run(`UPDATE ${d.table} SET is_active = ?, updated_at = datetime('now') WHERE id = ?`, [next, toId(id)]);
  logActivity(actor, next ? 'activate' : 'deactivate', 'catalog', id, { kind });
  return { ...get(`SELECT * FROM ${d.table} WHERE id = ?`, [toId(id)]), images: parseImages(row.images_json) };
}

function deleteCatalogItem(kind, id, actor) {
  const d = kindDef(kind);
  const row = get(`SELECT * FROM ${d.table} WHERE id = ?`, [toId(id)]);
  if (!row) throw new ApiError(404, `ال${d.label} غير موجود`);
  run(`DELETE FROM ${d.table} WHERE id = ?`, [toId(id)]);
  logActivity(actor, 'delete', 'catalog', id, { kind });
  return { message: `تم حذف ال${d.label} بنجاح` };
}

module.exports = {
  ALL_KINDS, kindDef, listCatalog, getCatalogItem, updateCatalogItem, toggleCatalogItem, deleteCatalogItem,
};
