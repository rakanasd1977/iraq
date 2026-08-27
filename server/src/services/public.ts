const { get, all } = require('../db');
const { ApiError, toId, paginate, parseImages, parseIncludes } = require('../utils/helpers');
const { itemKindOf, findItem } = require('../utils/itemRatings');
const { buildSoldMap } = require('../utils/itemSold');
const { localized } = require('../utils/locale');
const { nearestGovernorate } = require('../utils/geo');

function publicProvider(p, locale = 'ar') {
  return {
    id: p.id,
    name: localized(p.name_ar, p.name_en, locale),
    name_ar: p.name_ar,
    name_en: p.name_en,
    logo: p.logo,
    cover: p.cover,
    description: p.description,
    address: p.address,
    phone: p.phone,
    website: p.website,
    rating: p.rating,
    rating_count: p.rating_count,
    is_verified: p.is_verified,
    service_slug: p.service_slug,
    service_name: localized(p.service_name_ar, p.service_name_en, locale),
    service_name_ar: p.service_name_ar,
    service_icon: p.service_icon,
    governorate_name: localized(p.governorate_name_ar, p.governorate_name_en, locale),
    governorate_name_ar: p.governorate_name_ar,
    governorate_code: p.governorate_code,
    followers_count: Number(p.followers_count || 0),
    orders_count: Number(p.orders_count || 0),
  };
}

const PROVIDER_SELECT = `
  SELECT p.id, p.name_ar, p.name_en, p.logo, p.cover, p.description, p.address,
         p.phone, p.website, p.rating, p.rating_count, p.is_verified,
         s.slug AS service_slug, s.name_ar AS service_name_ar, s.name_en AS service_name_en, s.icon AS service_icon,
         g.name_ar AS governorate_name_ar, g.name_en AS governorate_name_en, g.code AS governorate_code,
         (SELECT COUNT(*) FROM provider_follows pf WHERE pf.provider_id = p.id) AS followers_count,
         (SELECT COUNT(*) FROM orders o WHERE o.provider_id = p.id AND o.status != 'cancelled') AS orders_count
  FROM providers p
  JOIN services s ON s.id = p.service_id
  JOIN governorates g ON g.id = p.governorate_id
  WHERE p.is_active = 1
`;

function getPaymentInfo() {
  const value = (key) => { const r = get('SELECT value FROM settings WHERE key = ?', [key]); return r ? r.value : ''; };
  const lines = (key) => value(key).split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  return {
    instructions: value('recharge_instructions'),
    methods: {
      zain_cash: { id: 'zain_cash', label: 'زين كاش', hint: 'Zain Cash', numbers: lines('zain_cash_number') },
      asia_pay: { id: 'asia_pay', label: 'آسيا باي', hint: 'Asia Pay', numbers: lines('asia_pay_number') },
      first_iraqi_bank: {
        id: 'first_iraqi_bank', label: 'مصرف العراق الأول', hint: 'First Iraqi Bank',
        account_name: value('first_iraqi_bank_name'), ibans: lines('first_iraqi_bank_iban'),
      },
      al_ahli_bank: {
        id: 'al_ahli_bank', label: 'المصرف الأهلي', hint: 'Al-Ahli Bank',
        account_name: value('al_ahli_bank_name'), ibans: lines('al_ahli_bank_iban'),
      },
    },
  };
}

function getGovernorates(locale = 'ar') {
  return all(
    `SELECT g.id, g.name_ar, g.name_en, g.code, g.sort_order, g.lat, g.lng,
            (SELECT COUNT(*) FROM providers p WHERE p.governorate_id = g.id AND p.is_active = 1) AS providers_count
     FROM governorates g WHERE g.is_active = 1 ORDER BY g.sort_order ASC, g.name_ar ASC`
  ).map((g) => ({ ...g, name: localized(g.name_ar, g.name_en, locale) }));
}

// تحديد أقرب محافظة لموقع الزبون بناءً على إحداثياته (تستخدم في الكشف التلقائي)
function getGovernorateByGeo(latRaw, lngRaw) {
  const lat = Number(latRaw);
  const lng = Number(lngRaw);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) throw new ApiError(400, 'الإحداثيات غير صالحة');
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) throw new ApiError(400, 'الإحداثيات خارج النطاق المسموح');
  const rows = all(
    `SELECT id, code, name_ar, name_en, lat, lng
     FROM governorates WHERE is_active = 1 AND lat IS NOT NULL AND lng IS NOT NULL`
  );
  return nearestGovernorate(lat, lng, rows);
}

function getCoupons() {
  return all(
    `SELECT c.id, c.code, c.title, c.discount_type, c.discount_value, c.min_amount, c.provider_id,
            pr.name_ar AS provider_name
     FROM coupons c
     LEFT JOIN providers pr ON pr.id = c.provider_id
     WHERE c.is_active = 1
       AND c.provider_id IS NOT NULL
       AND (c.starts_at IS NULL OR c.starts_at <= datetime('now'))
       AND (c.ends_at IS NULL OR c.ends_at >= datetime('now'))
     ORDER BY c.discount_value DESC, c.id DESC`
  ).map((c) => ({
    id: c.id, code: c.code, title: c.title,
    discount_type: c.discount_type, discount_value: Number(c.discount_value),
    min_amount: Number(c.min_amount), provider_id: c.provider_id, provider_name: c.provider_name,
  }));
}

function getConfig() {
  const row = get('SELECT value FROM settings WHERE key = ?', ['free_shipping_min']);
  const n = Number(row && row.value);
  const nameRow = get('SELECT value FROM settings WHERE key = ?', ['app_name']);
  return {
    app_name: (nameRow && nameRow.value) || 'سوق الرافدين',
    free_shipping_min: Number.isFinite(n) && n > 0 ? n : 50000,
    currency: 'IQD',
  };
}

function getServices(query, locale = 'ar') {
  const { governorate_code } = query || {};
  let govId = null;
  if (governorate_code) {
    const gov = get('SELECT id FROM governorates WHERE code = ? AND is_active = 1', [String(governorate_code).toUpperCase()]);
    if (gov) govId = gov.id;
  }
  return all(
    `SELECT s.id, s.slug, s.name_ar, s.name_en, s.description, s.icon, s.sort_order,
            COUNT(p.id) AS providers_count
     FROM services s
     LEFT JOIN providers p ON p.service_id = s.id AND p.is_active = 1 ${govId ? 'AND p.governorate_id = ?' : ''}
     WHERE s.is_active = 1
     GROUP BY s.id ORDER BY s.sort_order ASC`,
    govId ? [govId] : []
  ).map((s) => ({ ...s, name: localized(s.name_ar, s.name_en, locale), providers_count: Number(s.providers_count) || 0 }));
}

function listProviders(query, locale = 'ar') {
  const { governorate_code, service_slug, q, verified, sort, min_rating } = query || {};
  const conditions = [];
  const params = [];
  if (governorate_code) { conditions.push('g.code = ?'); params.push(String(governorate_code).toUpperCase()); }
  if (service_slug) { conditions.push('s.slug = ?'); params.push(service_slug); }
  if (q) { conditions.push('(p.name_ar LIKE ? OR p.name_en LIKE ? OR p.description LIKE ?)'); params.push(`%${q}%`, `%${q}%`, `%${q}%`); }
  if (verified !== undefined) { conditions.push('p.is_verified = ?'); params.push(Number(verified) ? 1 : 0); }
  const minRating = Number(min_rating);
  if (!Number.isNaN(minRating) && minRating > 0) { conditions.push('p.rating >= ?'); params.push(minRating); }
  const where = conditions.length ? ' AND ' + conditions.join(' AND ') : '';
  const pg = paginate({ query }, 50);
  const total = get(`SELECT COUNT(*) AS c FROM providers p JOIN services s ON s.id = p.service_id LEFT JOIN governorates g ON g.id = p.governorate_id WHERE p.is_active = 1 ${where}`, params).c;
  const orderBy =
    sort === 'recent' ? 'p.id DESC' :
    sort === 'name' ? 'p.name_ar ASC' :
    sort === 'sold' ? 'orders_count DESC, p.rating DESC, p.id DESC' :
    sort === 'rating' ? 'p.rating DESC, p.is_verified DESC, p.id DESC' :
    'p.is_verified DESC, p.rating DESC, p.id DESC';
  const rows = all(
    PROVIDER_SELECT + where + ' ORDER BY ' + orderBy + ' LIMIT ? OFFSET ?',
    [...params, pg.limit, pg.offset]
  );

  const countsMap = {};
  if (rows.length) {
    const placeholders = rows.map(() => '?').join(',');
    const ids = rows.map((r) => r.id);
    const union = [
      `SELECT provider_id, 'products' AS kind, COUNT(*) AS c FROM products WHERE provider_id IN (${placeholders}) AND is_active = 1 GROUP BY provider_id`,
      `SELECT provider_id, 'menu_items' AS kind, COUNT(*) AS c FROM menu_items WHERE provider_id IN (${placeholders}) AND is_active = 1 GROUP BY provider_id`,
      `SELECT provider_id, 'hotel_rooms' AS kind, COUNT(*) AS c FROM hotel_rooms WHERE provider_id IN (${placeholders}) AND is_active = 1 GROUP BY provider_id`,
      `SELECT provider_id, 'flights' AS kind, COUNT(*) AS c FROM flights WHERE provider_id IN (${placeholders}) AND is_active = 1 GROUP BY provider_id`,
      `SELECT provider_id, 'travel_packages' AS kind, COUNT(*) AS c FROM travel_packages WHERE provider_id IN (${placeholders}) AND is_active = 1 GROUP BY provider_id`,
    ].join(' UNION ALL ');
    const params = [...ids, ...ids, ...ids, ...ids, ...ids];
    const kindToKey = { products: 'products', menu_items: 'menu_items', hotel_rooms: 'rooms', flights: 'flights', travel_packages: 'packages' };
    for (const row of all(union, params)) {
      countsMap[`${row.provider_id}:${kindToKey[row.kind]}`] = row.c;
    }
  }

  return {
    rows: rows.map((r) => ({
      ...publicProvider(r, locale),
      catalog_counts: {
        products: countsMap[`${r.id}:products`] || 0,
        menu_items: countsMap[`${r.id}:menu_items`] || 0,
        rooms: countsMap[`${r.id}:hotel_rooms`] || 0,
        flights: countsMap[`${r.id}:flights`] || 0,
        packages: countsMap[`${r.id}:travel_packages`] || 0,
      },
    })),
    meta: { total, page: pg.page, limit: pg.limit, pages: Math.max(1, Math.ceil(total / pg.limit)) },
  };
}

function getProviderDetail(id, locale = 'ar') {
  const pid = toId(id);
  const p = get(PROVIDER_SELECT + ' AND p.id = ?', [pid]);
  if (!p) throw new ApiError(404, 'مزود الخدمة غير موجود');

  const slug = p.service_slug;
  const counts = {
    products: slug === 'stores' ? get('SELECT COUNT(*) AS c FROM products WHERE provider_id = ? AND is_active = 1', [pid]).c : 0,
    menu_items: slug === 'restaurants' ? get('SELECT COUNT(*) AS c FROM menu_items WHERE provider_id = ? AND is_active = 1', [pid]).c : 0,
    rooms: slug === 'hotels' ? get('SELECT COUNT(*) AS c FROM hotel_rooms WHERE provider_id = ? AND is_active = 1', [pid]).c : 0,
    flights: slug === 'flights' ? get('SELECT COUNT(*) AS c FROM flights WHERE provider_id = ? AND is_active = 1', [pid]).c : 0,
    packages: slug === 'travel_offices' ? get('SELECT COUNT(*) AS c FROM travel_packages WHERE provider_id = ? AND is_active = 1', [pid]).c : 0,
  };
  const followers_count = get('SELECT COUNT(*) AS c FROM provider_follows WHERE provider_id = ?', [pid]).c;

  return { ...publicProvider(p, locale), catalog_counts: counts, followers_count };
}

function getProviderReviews(id, query) {
  const pid = toId(id);
  const p = get('SELECT id FROM providers WHERE id = ?', [pid]);
  if (!p) throw new ApiError(404, 'مزود الخدمة غير موجود');

  const limit = Math.min(Number(query && query.limit) || 20, 50);
  const rows = all(
    `SELECT r.id, r.rating, r.comment, r.created_at, r.reply, r.replied_at,
            u.name_ar AS customer_name, u.avatar AS customer_avatar
     FROM provider_ratings r
     JOIN users u ON u.id = r.customer_id
     WHERE r.provider_id = ?
     ORDER BY r.created_at DESC, r.id DESC
     LIMIT ?`,
    [pid, limit]
  );
  const breakdown = all(
    'SELECT rating, COUNT(*) AS count FROM provider_ratings WHERE provider_id = ? GROUP BY rating',
    [pid]
  );
  return { reviews: rows, breakdown };
}

function getProviderCategories(id, locale = 'ar') {
  const pid = toId(id);
  return all(
    `SELECT c.id, c.name_ar, c.name_en, c.icon, c.sort_order,
            (SELECT COUNT(*) FROM products p WHERE p.category_id = c.id AND p.is_active = 1) AS items_count
     FROM product_categories c WHERE c.provider_id = ? AND c.is_active = 1 ORDER BY c.sort_order ASC, c.id ASC`,
     [pid]
  ).map((c) => ({ ...c, name: localized(c.name_ar, c.name_en, locale) }));
}

function getProviderProducts(id, query, locale = 'ar') {
  const pid = toId(id);
  const { category_id, offers, min_price, max_price, sort } = query || {};
  let sql = `SELECT p.id, p.provider_id, p.category_id, p.name_ar, p.name_en, p.description,
             p.price, p.old_price, p.images_json, p.stock, p.is_active, p.is_featured,
             COALESCE(irs.rating, 0) AS rating, COALESCE(irs.rating_count, 0) AS rating_count,
             pc.name_ar AS category_name, pr.name_ar AS provider_name,
             pr.is_verified AS provider_verified FROM products p
             LEFT JOIN product_categories pc ON pc.id = p.category_id
             LEFT JOIN providers pr ON pr.id = p.provider_id
             LEFT JOIN item_rating_sums irs ON irs.item_type = 'products' AND irs.item_id = p.id
             WHERE p.provider_id = ? AND p.is_active = 1`;
  const params = [pid];
  if (category_id) { sql += ' AND p.category_id = ?'; params.push(Number(category_id)); }
  if (offers !== undefined) { sql += ' AND (p.is_featured = 1 OR (p.old_price IS NOT NULL AND p.old_price > p.price))'; }
  const lo = Number(min_price), hi = Number(max_price);
  if (!Number.isNaN(lo) && lo > 0) { sql += ' AND p.price >= ?'; params.push(lo); }
  if (!Number.isNaN(hi) && hi > 0) { sql += ' AND p.price <= ?'; params.push(hi); }
  const pg = paginate({ query }, 50);
  let totalSql = 'SELECT COUNT(*) AS c FROM products p WHERE provider_id = ? AND is_active = 1';
  if (category_id) totalSql += ' AND category_id = ?';
  if (offers !== undefined) totalSql += ' AND (is_featured = 1 OR (old_price IS NOT NULL AND old_price > price))';
  if (!Number.isNaN(lo) && lo > 0) totalSql += ' AND price >= ?';
  if (!Number.isNaN(hi) && hi > 0) totalSql += ' AND price <= ?';
  const total = get(totalSql, params).c;
  const soldMap = buildSoldMap();
  const decorate = (r) => ({
    ...r,
    name: localized(r.name_ar, r.name_en, locale),
    images: parseImages(r.images_json),
    provider_verified: Boolean(r.provider_verified),
    sold: soldMap.get(`products:${r.id}`) || 0,
    discount_percent: r.old_price && r.old_price > r.price ? Math.round(((r.old_price - r.price) / r.old_price) * 100) : 0,
  });

  if (sort === 'sold') {
    // الترتيب حسب المباعات يجب أن يسبق التقسيم إلى صفحات (لأن المباعات تُحسب في JS)
    const allRows = all(sql, params).map(decorate);
    allRows.sort((a, b) => b.sold - a.sold || b.id - a.id);
    const paged = allRows.slice(pg.offset, pg.offset + pg.limit);
    return { rows: paged, meta: { total, page: pg.page, limit: pg.limit, pages: Math.max(1, Math.ceil(total / pg.limit)) } };
  }

  const orderBy =
    sort === 'price_asc' ? 'p.price ASC, p.id DESC' :
    sort === 'price_desc' ? 'p.price DESC, p.id DESC' :
    sort === 'rating' ? 'COALESCE(irs.rating,0) DESC, p.id DESC' :
    'p.is_featured DESC, p.id DESC';
  const rows = all(sql + ' ORDER BY ' + orderBy + ' LIMIT ? OFFSET ?', [...params, pg.limit, pg.offset]).map(decorate);
  return { rows, meta: { total, page: pg.page, limit: pg.limit, pages: Math.max(1, Math.ceil(total / pg.limit)) } };
}

function getProviderMenu(id, locale = 'ar') {
  const pid = toId(id);
  return all(
    `SELECT m.id, m.provider_id, m.category_id, m.name_ar, m.name_en, m.description,
            m.price, m.images_json, m.is_active, m.is_featured, m.is_available,
            COALESCE(irs.rating, 0) AS rating, COALESCE(irs.rating_count, 0) AS rating_count,
            mc.name_ar AS category_name, pr.name_ar AS provider_name FROM menu_items m
     LEFT JOIN menu_categories mc ON mc.id = m.category_id
     LEFT JOIN providers pr ON pr.id = m.provider_id
     LEFT JOIN item_rating_sums irs ON irs.item_type = 'menu' AND irs.item_id = m.id
     WHERE m.provider_id = ? AND m.is_active = 1 AND m.is_available = 1
     ORDER BY m.is_featured DESC, m.id DESC`,
    [pid]
  ).map((r) => ({ ...r, name: localized(r.name_ar, r.name_en, locale), images: parseImages(r.images_json) }));
}

function getProviderRooms(id, locale = 'ar') {
  const pid = toId(id);
  return all(
    `SELECT hr.id, hr.provider_id, hr.name_ar, hr.name_en, hr.description, hr.price_per_night, hr.room_type, hr.max_guests, hr.images_json, hr.is_active, hr.is_featured,
            COALESCE(irs.rating, 0) AS rating, COALESCE(irs.rating_count, 0) AS rating_count,
            pr.name_ar AS provider_name
     FROM hotel_rooms hr
     LEFT JOIN providers pr ON pr.id = hr.provider_id
     LEFT JOIN item_rating_sums irs ON irs.item_type = 'rooms' AND irs.item_id = hr.id
     WHERE hr.provider_id = ? AND hr.is_active = 1 ORDER BY hr.price_per_night ASC`,
    [pid]
  ).map((r) => ({ ...r, name: localized(r.name_ar, r.name_en, locale), images: parseImages(r.images_json) }));
}

function getProviderFlights(id, locale = 'ar') {
  const pid = toId(id);
  return all(
    `SELECT f.id, f.provider_id, f.flight_number, f.origin, f.origin_ar, f.destination, f.destination_ar,
            f.departure_at, f.arrival_at, f.price, f.seats, f.airline, f.images_json, f.is_active, f.is_featured,
            COALESCE(irs.rating, 0) AS rating, COALESCE(irs.rating_count, 0) AS rating_count,
            pr.name_ar AS provider_name
     FROM flights f
     LEFT JOIN providers pr ON pr.id = f.provider_id
     LEFT JOIN item_rating_sums irs ON irs.item_type = 'flights' AND irs.item_id = f.id
     WHERE f.provider_id = ? AND f.is_active = 1
     ORDER BY CASE WHEN f.departure_at IS NULL OR f.departure_at = '' THEN 1 ELSE 0 END, f.departure_at ASC`,
    [pid]
  ).map((r) => ({ ...r, name: localized(r.name_ar, r.name_en, locale), images: parseImages(r.images_json) }));
}

function getProviderPackages(id, locale = 'ar') {
  const pid = toId(id);
  return all(
    `SELECT p.id, p.provider_id, p.name_ar, p.name_en, p.description, p.destination, p.duration_days, p.price, p.includes_json, p.images_json, p.is_active, p.is_featured,
            COALESCE(irs.rating, 0) AS rating, COALESCE(irs.rating_count, 0) AS rating_count,
            pr.name_ar AS provider_name
     FROM travel_packages p
     LEFT JOIN providers pr ON pr.id = p.provider_id
     LEFT JOIN item_rating_sums irs ON irs.item_type = 'packages' AND irs.item_id = p.id
     WHERE p.provider_id = ? AND p.is_active = 1 ORDER BY p.id DESC`,
    [pid]
  ).map((r) => ({ ...r, name: localized(r.name_ar, r.name_en, locale), images: parseImages(r.images_json), includes: parseIncludes(r.includes_json) }));
}

function getItemReviews(kind, id, query) {
  const k = itemKindOf(kind);
  if (!k) throw new ApiError(400, 'نوع البند غير معروف');
  const itemId = toId(id);
  const item = findItem(k, itemId);
  if (!item) throw new ApiError(404, 'البند غير موجود');

  const limit = Math.min(Number(query && query.limit) || 20, 50);
  const rows = all(
    `SELECT r.id, r.rating, r.comment, r.created_at,
            u.name_ar AS customer_name, u.avatar AS customer_avatar
     FROM item_ratings r
     JOIN users u ON u.id = r.customer_id
     WHERE r.item_type = ? AND r.item_id = ?
     ORDER BY r.created_at DESC, r.id DESC
     LIMIT ?`,
    [k, itemId, limit]
  );
  const sum = get('SELECT rating, rating_count FROM item_rating_sums WHERE item_type = ? AND item_id = ?', [k, itemId]);
  const breakdown = all('SELECT rating, COUNT(*) AS count FROM item_ratings WHERE item_type = ? AND item_id = ? GROUP BY rating', [k, itemId]);
  return {
    item_type: k, item_id: itemId,
    rating: sum ? sum.rating : 0,
    rating_count: sum ? sum.rating_count : 0,
    reviews: rows, breakdown,
  };
}

function getDeals(query, locale = 'ar') {
  const { governorate_code } = query || {};
  let govId = null;
  if (governorate_code) {
    const gov = get('SELECT id FROM governorates WHERE code = ? AND is_active = 1', [String(governorate_code).toUpperCase()]);
    if (gov) govId = gov.id;
  }
  const govWhere = govId ? ' AND pr.governorate_id = ?' : '';
  const govParam = govId ? [govId] : [];

  const limit = Math.min(Number(query && query.limit) || 12, 50);
  const soldMap = buildSoldMap();

  const products = all(
    `SELECT p.id AS item_id, p.provider_id, p.name_ar, p.name_en, p.price, p.old_price, p.images_json,
            pr.name_ar AS provider_name, pr.is_verified AS provider_verified
     FROM products p
     JOIN providers pr ON pr.id = p.provider_id
     WHERE p.is_active = 1 AND pr.is_active = 1
       AND p.old_price IS NOT NULL AND p.old_price > p.price
       ${govWhere}
     ORDER BY ((p.old_price - p.price) * 100.0 / p.old_price) DESC
     LIMIT ?`,
    [...govParam, limit]
  );

  const featured = [
    { kind: 'menu', table: 'menu_items', priceCol: 'price', unit: 'صنف', titleCol: 'name_ar', imageCol: 'images_json' },
    { kind: 'rooms', table: 'hotel_rooms', priceCol: 'price_per_night', unit: 'ليلة', titleCol: 'name_ar', imageCol: 'images_json' },
    { kind: 'flights', table: 'flights', priceCol: 'price', unit: 'تذكرة', titleCol: 'flight_number', imageCol: null },
    { kind: 'packages', table: 'travel_packages', priceCol: 'price', unit: 'باقة', titleCol: 'name_ar', imageCol: 'images_json' },
  ];
  const perKind = Math.max(3, Math.ceil(limit / featured.length));

  const deals = products.map((r) => ({
    kind: 'products',
    item_id: r.item_id, provider_id: r.provider_id, provider_name: r.provider_name,
    provider_verified: Boolean(r.provider_verified),
    sold: soldMap.get(`products:${r.item_id}`) || 0,
    title: localized(r.name_ar, r.name_en, locale), price: r.price, old_price: r.old_price,
    image: parseImages(r.images_json)[0] || null,
    discount_percent: Math.round(((Number(r.old_price) - Number(r.price)) / Number(r.old_price)) * 100),
    unit: 'قطعة',
  }));

  for (const f of featured) {
    const rows = all(
      `SELECT t.id AS item_id, t.provider_id, t.${f.titleCol} AS title, t.${f.priceCol} AS price,
              ${f.imageCol ? `t.${f.imageCol} AS images_json` : 'NULL AS images_json'},
              pr.name_ar AS provider_name, pr.is_verified AS provider_verified
       FROM ${f.table} t
       JOIN providers pr ON pr.id = t.provider_id
       WHERE t.is_active = 1 AND pr.is_active = 1 AND t.is_featured = 1
         ${govWhere}
       ORDER BY t.id DESC
       LIMIT ?`,
      [...govParam, perKind]
    );
    rows.forEach((r) => {
      deals.push({
        kind: f.kind, item_id: r.item_id, provider_id: r.provider_id,
        provider_name: r.provider_name, provider_verified: Boolean(r.provider_verified),
        sold: soldMap.get(`${f.kind}:${r.item_id}`) || 0,
        title: f.kind === 'flights' ? (r.title ? `رحلة ${r.title}` : 'رحلة طيران') : r.title,
        price: r.price, old_price: null,
        image: r.images_json ? parseImages(r.images_json)[0] || null : null,
        discount_percent: 0, unit: f.unit,
      });
    });
  }

  return deals;
}

function getTopSelling(query, locale = 'ar') {
  const { governorate_code, limit } = query || {};
  let govId = null;
  if (governorate_code) {
    const gov = get('SELECT id FROM governorates WHERE code = ? AND is_active = 1', [String(governorate_code).toUpperCase()]);
    if (gov) govId = gov.id;
  }
  const lim = Math.min(Number(query && query.limit) || 12, 50);
  const soldMap = buildSoldMap();
  const entries = Array.from(soldMap.entries())
    .map(([key, sold]) => {
      const idx = key.indexOf(':');
      return { kind: key.slice(0, idx), item_id: Number(key.slice(idx + 1)), sold };
    })
    .filter((e) => e.sold > 0)
    .sort((a, b) => b.sold - a.sold)
    .slice(0, lim * 4);

  const DEF = {
    products: { table: 'products', titleCol: 'name_ar', priceCol: 'price', imageCol: 'images_json', oldPrice: true, unit: 'قطعة' },
    menu: { table: 'menu_items', titleCol: 'name_ar', priceCol: 'price', imageCol: 'images_json', oldPrice: false, unit: 'صنف' },
    rooms: { table: 'hotel_rooms', titleCol: 'name_ar', priceCol: 'price_per_night', imageCol: 'images_json', oldPrice: false, unit: 'ليلة' },
    flights: { table: 'flights', titleCol: 'flight_number', priceCol: 'price', imageCol: null, oldPrice: false, unit: 'تذكرة' },
    packages: { table: 'travel_packages', titleCol: 'name_ar', priceCol: 'price', imageCol: 'images_json', oldPrice: false, unit: 'باقة' },
  };

  // تجميع حسب النوع لجلب التفاصيل باستعلام واحد لكل نوع (تفادي استعلام لكل بند)
  const byKind = {};
  for (const e of entries) {
    (byKind[e.kind] ||= []).push(e);
  }

  const out = [];
  for (const kind of Object.keys(byKind)) {
    if (out.length >= lim) break;
    const d = DEF[kind];
    if (!d) continue;
    const items = byKind[kind];
    const ids = items.map((e) => e.item_id);
    const placeholders = ids.map(() => '?').join(',');
    const govFilter = govId ? ' AND pr.governorate_id = ?' : '';
    const rows = all(
      `SELECT t.id AS item_id, t.${d.titleCol} AS title, t.${d.priceCol} AS price,
              ${d.oldPrice ? 't.old_price AS old_price' : 'NULL AS old_price'},
              ${d.imageCol ? `t.${d.imageCol} AS images_json` : 'NULL AS images_json'},
              pr.id AS provider_id, pr.name_ar AS provider_name, pr.is_verified AS provider_verified,
              pr.governorate_id, s.slug AS service_slug
       FROM ${d.table} t
       JOIN providers pr ON pr.id = t.provider_id
       JOIN services s ON s.id = pr.service_id
       WHERE t.id IN (${placeholders}) AND t.is_active = 1 AND pr.is_active = 1${govFilter}
       ORDER BY t.id DESC`,
      [...ids, ...(govId ? [govId] : [])]
    );
    const soldByItem = new Map(items.map((e) => [e.item_id, e.sold]));
    for (const row of rows) {
      if (out.length >= lim) break;
      out.push({
        id: row.item_id,
        kind,
        item_id: row.item_id,
        title: kind === 'flights' ? (row.title ? `رحلة ${row.title}` : 'رحلة طيران') : row.title,
        price: Number(row.price),
        old_price: row.old_price != null ? Number(row.old_price) : null,
        image: row.images_json ? parseImages(row.images_json)[0] || null : null,
        sold: soldByItem.get(row.item_id) || 0,
        provider_id: row.provider_id,
        provider_name: row.provider_name,
        provider_verified: Boolean(row.provider_verified),
        service_slug: row.service_slug,
        unit: d.unit,
      });
    }
  }
  return out;
}

// تخطيط أقسام الصفحة الرئيسية — يتحكّم به المسؤول عبر إعداد `home_sections`
const HOME_SECTIONS = [
  { key: 'hero_ads', label: 'إعلانات أعلى الصفحة', enabled: true, order: 1 },
  { key: 'service_grid', label: 'شبكة الخدمات', enabled: true, order: 2 },
  { key: 'flash_deals', label: 'عروض اليوم', enabled: true, order: 3 },
  { key: 'coupons', label: 'كوبونات للتحصيل', enabled: true, order: 4 },
  { key: 'featured_providers', label: 'مزودون مميزون', enabled: true, order: 5 },
  { key: 'most_ordered', label: 'الأكثر طلباً', enabled: true, order: 6 },
  { key: 'recently_viewed', label: 'شوهد مؤخراً', enabled: true, order: 7 },
  { key: 'picks', label: 'مختارات مميزة', enabled: true, order: 8 },
];

function getHomeLayout() {
  let stored = null;
  try {
    const row = get("SELECT value FROM settings WHERE key = 'home_sections'");
    if (row && row.value) stored = JSON.parse(row.value);
  } catch (e) { stored = null; }
  const base = HOME_SECTIONS.map((s) => ({ ...s }));
  if (Array.isArray(stored)) {
    for (const s of stored) {
      const t = base.find((b) => b.key === s.key);
      if (t) {
        t.enabled = s.enabled !== false;
        if (typeof s.order === 'number') t.order = s.order;
      }
    }
  }
  return base.sort((a, b) => a.order - b.order);
}

module.exports = {
  publicProvider, PROVIDER_SELECT,
  getPaymentInfo, getGovernorates, getCoupons, getConfig, getServices, listProviders,
  getProviderDetail, getProviderReviews, getProviderCategories, getProviderProducts,
  getProviderMenu, getProviderRooms, getProviderFlights, getProviderPackages,
  getItemReviews, getDeals, getTopSelling, getGovernorateByGeo, getHomeLayout,
};
