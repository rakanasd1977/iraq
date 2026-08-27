const express = require('express');
const { get, all, run } = require('../db');
const { ApiError, toId, paginate, parseImages, parseIncludes, assertLength } = require('../utils/helpers');
const { ok, created } = require('../utils/response');
const { logActivity } = require('../utils/log');
const { deleteUploadValue, deleteRemovedImages } = require('../utils/uploads');
const { notifyProviderFollowers } = require('../utils/push');

// أسماء العناصر وروابطها العميقة (لإشعارات المتابعين عند نشر عنصر جديد)
const ENTITY_LABEL = {
  products: 'منتج',
  menu_items: 'صنف',
  hotel_rooms: 'غرفة',
  flights: 'رحلة',
  travel_packages: 'باقة',
};
const ITEM_LINK = {
  products: (p, i) => `/item/${p}/products/${i}`,
  menu_items: (p, i) => `/item/${p}/menu/${i}`,
  hotel_rooms: (p) => `/provider/${p}/rooms`,
  flights: (p) => `/provider/${p}/flights`,
  travel_packages: (p, i) => `/item/${p}/packages/${i}`,
};

const CATEGORY_COLS = [
  { name: 'name_ar', label: 'الاسم بالعربية', required: true, type: 'text' },
  { name: 'name_en', label: 'الاسم بالإنجليزية', type: 'text' },
  { name: 'icon', label: 'أيقونة', type: 'text' },
  { name: 'sort_order', label: 'الترتيب', type: 'int' },
  { name: 'is_active', label: 'مفعل', type: 'bool' },
];

const PRODUCT_COLS = [
  { name: 'name_ar', label: 'اسم المنتج', required: true, type: 'text' },
  { name: 'name_en', label: 'الاسم بالإنجليزية', type: 'text' },
  { name: 'category_id', label: 'القسم', type: 'int' },
  { name: 'description', label: 'الوصف', type: 'text' },
  { name: 'price', label: 'السعر (دينار)', required: true, type: 'real' },
  { name: 'old_price', label: 'السعر قبل الخصم', type: 'real' },
  { name: 'images_json', label: 'روابط الصور', type: 'json' },
  { name: 'stock', label: 'المخزون', type: 'int' },
  { name: 'is_active', label: 'متوفر', type: 'bool' },
  { name: 'is_featured', label: 'عرض مميز', type: 'bool' },
];

const MENU_ITEM_COLS = [
  { name: 'name_ar', label: 'اسم الصنف', required: true, type: 'text' },
  { name: 'name_en', label: 'الاسم بالإنجليزية', type: 'text' },
  { name: 'category_id', label: 'القسم', type: 'int' },
  { name: 'description', label: 'الوصف', type: 'text' },
  { name: 'price', label: 'السعر (دينار)', required: true, type: 'real' },
  { name: 'images_json', label: 'روابط الصور', type: 'json' },
  { name: 'is_active', label: 'مفعل', type: 'bool' },
  { name: 'is_featured', label: 'مميز', type: 'bool' },
  { name: 'is_available', label: 'متوفر الآن', type: 'bool' },
];

const ROOM_COLS = [
  { name: 'name_ar', label: 'اسم الغرفة', required: true, type: 'text' },
  { name: 'name_en', label: 'الاسم بالإنجليزية', type: 'text' },
  { name: 'room_type', label: 'نوع الغرفة', type: 'text' },
  { name: 'description', label: 'الوصف', type: 'text' },
  { name: 'price_per_night', label: 'السعر لليلة (دينار)', required: true, type: 'real' },
  { name: 'max_guests', label: 'الحد الأقصى للنزلاء', type: 'int' },
  { name: 'images_json', label: 'روابط الصور', type: 'json' },
  { name: 'is_featured', label: 'عرض مميز', type: 'bool' },
  { name: 'is_active', label: 'مفعل', type: 'bool' },
];

const FLIGHT_COLS = [
  { name: 'flight_number', label: 'رقم الرحلة', type: 'text' },
  { name: 'airline', label: 'شركة الطيران', type: 'text' },
  { name: 'origin', label: 'المغادرة (رمز)', type: 'text' },
  { name: 'origin_ar', label: 'مدينة المغادرة', type: 'text' },
  { name: 'destination', label: 'الوصول (رمز)', type: 'text' },
  { name: 'destination_ar', label: 'مدينة الوصول', type: 'text' },
  { name: 'departure_at', label: 'موعد الإقلاع', required: true, type: 'date' },
  { name: 'arrival_at', label: 'موعد الوصول', type: 'date' },
  { name: 'price', label: 'سعر التذكرة (دينار)', required: true, type: 'real' },
  { name: 'seats', label: 'المقاعد المتاحة', type: 'int' },
  { name: 'is_featured', label: 'عرض مميز', type: 'bool' },
  { name: 'is_active', label: 'مفعل', type: 'bool' },
];

const PACKAGE_COLS = [
  { name: 'name_ar', label: 'اسم الباقة', required: true, type: 'text' },
  { name: 'name_en', label: 'الاسم بالإنجليزية', type: 'text' },
  { name: 'destination', label: 'الوجهة', type: 'text' },
  { name: 'description', label: 'الوصف', type: 'text' },
  { name: 'duration_days', label: 'عدد الأيام', type: 'int' },
  { name: 'price', label: 'السعر (دينار)', required: true, type: 'real' },
  { name: 'includes_json', label: 'ماذا تشمل الباقة', type: 'json' },
  { name: 'images_json', label: 'روابط الصور', type: 'json' },
  { name: 'is_featured', label: 'عرض مميز', type: 'bool' },
  { name: 'is_active', label: 'مفعل', type: 'bool' },
];

// ============ مولّد فهرس (CRUD) عام لكل أقسام الكتالوج ============
function catalogModule({ service, table, entity, cols, listSelect = '', searchCols = [], filters = [], idPrefix = '' }) {
  const r = express.Router();
  const requiredCols = cols.filter((c) => c.required);

  r.use((req, res, next) => {
    if (req.provider.service_slug !== service) {
      return next(new ApiError(403, 'هذا القسم غير متاح لنوع خدمتك'));
    }
    next();
  });

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
    if (c.type === 'date') { const d = v ? new Date(v) : null; return d && !Number.isNaN(d.getTime()) ? d.toISOString() : null; }
    return String(v);
  }

  function applyFilters(req, baseSql, baseParams) {
    let sql = baseSql;
    const params = [...baseParams];
    for (const f of filters) {
      if (req.query[f.key] === undefined) continue;
      const built = f.build ? f.build(req.query[f.key], req) : null;
      if (typeof built === 'string') {
        sql += ' AND ' + built;
      } else if (built) {
        sql += ' AND ' + built.sql;
        params.push(...built.params);
      }
    }
    return { sql, params };
  }

  r.get('/', (req, res, next) => {
    try {
      const pid = req.provider.id;
      if (req.query.q) assertLength(String(req.query.q), 100, 'البحث');
      let sql = listSelect || `SELECT * FROM ${table} WHERE provider_id = ?`;
      const params = [pid];
      if (req.query.q && searchCols.length) {
        const ors = searchCols.map((c) => `${c} LIKE ?`).join(' OR ');
        sql += ' AND (' + ors + ')';
        searchCols.forEach(() => params.push(`%${req.query.q}%`));
      }
      const { sql: fsql, params: fparams } = applyFilters(req, sql, params);
      const pg = paginate(req, 50);
      const total = get(`SELECT COUNT(*) AS c FROM (${fsql})`, fparams).c;
      const rows = all(
        fsql + ' ORDER BY ' + idPrefix + 'id DESC LIMIT ? OFFSET ?',
        [...fparams, pg.limit, pg.offset]
      );
      ok(
        res,
        rows.map((row) => ({ ...row, images: parseImages(row.images_json), includes: parseIncludes(row.includes_json) })),
        { total, page: pg.page, limit: pg.limit, pages: Math.max(1, Math.ceil(total / pg.limit)) }
      );
    } catch (e) { next(e); }
  });

  r.get('/count', (req, res, next) => {
    try {
      const c = get(`SELECT COUNT(*) AS c FROM ${table} WHERE provider_id = ?`, [req.provider.id]).c;
      ok(res, { count: c });
    } catch (e) { next(e); }
  });

  r.post('/', (req, res, next) => {
    try {
      const body = req.body || {};
      for (const c of requiredCols) {
        if (body[c.name] === undefined || body[c.name] === null || body[c.name] === '') {
          throw new ApiError(400, `يرجى ملء الحقل المطلوب: ${c.label}`);
        }
      }
      const provided = cols.filter((c) => body[c.name] !== undefined && body[c.name] !== null && body[c.name] !== '');
      const colNames = ['provider_id', ...provided.map((c) => c.name)];
      const values = [req.provider.id, ...provided.map((c) => normalize(c, body[c.name]))];
      const id = run(
        `INSERT INTO ${table} (${colNames.join(',')}) VALUES (${colNames.map(() => '?').join(',')})`,
        values
      ).lastId;
      logActivity(req.user, 'create', entity, id, { provider_id: req.provider.id });
      const createdRow = get(`SELECT * FROM ${table} WHERE id = ?`, [id]);
      if (createdRow && Number(createdRow.is_active) === 1) {
        notifyProviderFollowers(req.provider.id, {
          type: 'offer',
          title: `جديد من ${req.provider.name_ar}`,
          body: `تم نشر ${ENTITY_LABEL[table]}: ${createdRow.name_ar || createdRow.flight_number || createdRow.name_en || id}`,
          url: (ITEM_LINK[table] || ITEM_LINK.products)(req.provider.id, id),
          icon: '🛍️',
        }).catch(() => {});
      }
      created(res, createdRow || get(`SELECT * FROM ${table} WHERE id = ?`, [id]));
    } catch (e) { next(e); }
  });

  r.get('/:id', (req, res, next) => {
    try {
      const id = toId(req.params.id);
      const row = get(`SELECT * FROM ${table} WHERE id = ? AND provider_id = ?`, [id, req.provider.id]);
      if (!row) throw new ApiError(404, `ال${entity} غير موجود`);
      ok(res, row);
    } catch (e) { next(e); }
  });

  r.put('/:id', (req, res, next) => {
    try {
      const id = toId(req.params.id);
      const row = get(`SELECT * FROM ${table} WHERE id = ? AND provider_id = ?`, [id, req.provider.id]);
      if (!row) throw new ApiError(404, `ال${entity} غير موجود`);
      const body = req.body || {};
      const sets = [];
      const params = [];
      for (const c of cols) {
        if (body[c.name] === undefined || body[c.name] === '') continue;
        sets.push(`${c.name} = ?`);
        params.push(normalize(c, body[c.name]));
      }
      sets.push("updated_at = datetime('now')");
      params.push(id, req.provider.id);
      run(`UPDATE ${table} SET ${sets.join(', ')} WHERE id = ? AND provider_id = ?`, params);
      const fresh = get(`SELECT * FROM ${table} WHERE id = ?`, [id]);
      deleteRemovedImages(row.images_json, fresh.images_json);
      logActivity(req.user, 'update', entity, id, { provider_id: req.provider.id });
      ok(res, fresh);
    } catch (e) { next(e); }
  });

  r.delete('/:id', (req, res, next) => {
    try {
      const id = toId(req.params.id);
      const row = get(`SELECT * FROM ${table} WHERE id = ? AND provider_id = ?`, [id, req.provider.id]);
      if (!row) throw new ApiError(404, `ال${entity} غير موجود`);
      run(`DELETE FROM ${table} WHERE id = ? AND provider_id = ?`, [id, req.provider.id]);
      deleteUploadValue(row.images_json);
      logActivity(req.user, 'delete', entity, id, { provider_id: req.provider.id });
      ok(res, { message: `تم حذف ال${entity} بنجاح` });
    } catch (e) { next(e); }
  });

  r.post('/:id/toggle', (req, res, next) => {
    try {
      const id = toId(req.params.id);
      const row = get(`SELECT * FROM ${table} WHERE id = ? AND provider_id = ?`, [id, req.provider.id]);
      if (!row) throw new ApiError(404, `ال${entity} غير موجود`);
      const nextState = row.is_active ? 0 : 1;
      run(`UPDATE ${table} SET is_active = ?, updated_at = datetime('now') WHERE id = ? AND provider_id = ?`, [nextState, id, req.provider.id]);
      logActivity(req.user, nextState ? 'activate' : 'deactivate', entity, id);
      ok(res, get(`SELECT * FROM ${table} WHERE id = ?`, [id]));
    } catch (e) { next(e); }
  });

  return r;
}

// يركّب كل أقسام الفهرس تحت مساراتها ضمن راوتر المزود
function mountCatalog(router) {
  router.use('/product-categories', catalogModule({
    service: 'stores',
    table: 'product_categories',
    entity: 'قسم',
    cols: CATEGORY_COLS,
  }));

  router.use('/products', catalogModule({
    service: 'stores',
    table: 'products',
    entity: 'منتج',
    cols: PRODUCT_COLS,
    listSelect: 'SELECT p.*, pc.name_ar AS category_name FROM products p LEFT JOIN product_categories pc ON pc.id = p.category_id WHERE p.provider_id = ?',
    searchCols: ['p.name_ar', 'p.name_en'],
    idPrefix: 'p.',
    filters: [
      { key: 'offers', build: () => '(p.is_featured = 1 OR (p.old_price IS NOT NULL AND p.old_price > p.price))' },
      { key: 'category_id', build: (v) => ({ sql: 'p.category_id = ?', params: [Number(v)] }) },
    ],
  }));

  router.use('/menu-categories', catalogModule({
    service: 'restaurants',
    table: 'menu_categories',
    entity: 'قسم',
    cols: CATEGORY_COLS,
  }));

  router.use('/menu-items', catalogModule({
    service: 'restaurants',
    table: 'menu_items',
    entity: 'صنف',
    cols: MENU_ITEM_COLS,
    listSelect: 'SELECT m.*, mc.name_ar AS category_name FROM menu_items m LEFT JOIN menu_categories mc ON mc.id = m.category_id WHERE m.provider_id = ?',
    searchCols: ['m.name_ar', 'm.name_en'],
    idPrefix: 'm.',
    filters: [
      { key: 'category_id', build: (v) => ({ sql: 'm.category_id = ?', params: [Number(v)] }) },
      { key: 'available', build: (v) => ({ sql: 'm.is_available = ?', params: [Number(v) ? 1 : 0] }) },
      { key: 'offers', build: () => 'm.is_featured = 1' },
    ],
  }));

  router.use('/rooms', catalogModule({
    service: 'hotels',
    table: 'hotel_rooms',
    entity: 'غرفة',
    cols: ROOM_COLS,
    searchCols: ['name_ar', 'name_en'],
    filters: [
      { key: 'offers', build: () => 'is_featured = 1' },
    ],
  }));

  router.use('/flights', catalogModule({
    service: 'flights',
    table: 'flights',
    entity: 'رحلة',
    cols: FLIGHT_COLS,
    searchCols: ['flight_number', 'origin', 'destination', 'origin_ar', 'destination_ar', 'airline'],
    filters: [
      { key: 'offers', build: () => 'is_featured = 1' },
    ],
  }));

  router.use('/packages', catalogModule({
    service: 'travel_offices',
    table: 'travel_packages',
    entity: 'باقة',
    cols: PACKAGE_COLS,
    searchCols: ['name_ar', 'name_en', 'destination'],
    filters: [
      { key: 'offers', build: () => 'is_featured = 1' },
    ],
  }));
}

module.exports = { catalogModule, mountCatalog, ENTITY_LABEL, ITEM_LINK, CATEGORY_COLS, PRODUCT_COLS, MENU_ITEM_COLS, ROOM_COLS, FLIGHT_COLS, PACKAGE_COLS };
