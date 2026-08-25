const { get, all, run, transaction } = require('../db');
const { ApiError, toId, round2, paginate, assertLength, settingValue } = require('../utils/helpers');
const { logActivity } = require('../utils/log');
const { deleteUploadValue, deleteRemovedImages, saveBase64ToUpload } = require('../utils/uploads');
const { notifyRole } = require('../utils/push');

const LOW_STOCK_THRESHOLD = 5;

const CATALOG_TABLES = {
  stores: 'products',
  restaurants: 'menu_items',
  hotels: 'hotel_rooms',
  flights: 'flights',
  travel_offices: 'travel_packages',
};

const ORDER_KIND = { products: 'products', menu_items: 'menu', hotel_rooms: 'rooms', flights: 'flights', travel_packages: 'packages' };

// ===================== صافي إيراد كل عنصر في كتالوج المزود =====================
function getCatalogNet(provider) {
  const table = CATALOG_TABLES[provider.service_slug];
  if (!table) throw new ApiError(404, 'لا يوجد كتالوج لهذه الخدمة');
  const orders = all(
    `SELECT id, total_amount, provider_amount, items_json FROM orders
     WHERE provider_id = ? AND status != 'cancelled'`,
    [provider.id]
  );
  const kind = ORDER_KIND[table];
  const net = {};
  for (const o of orders) {
    let items = [];
    try { items = JSON.parse(o.items_json || '[]'); } catch (e) { items = []; }
    const total = Number(o.total_amount) || 0;
    const prov = Number(o.provider_amount) || 0;
    if (total <= 0) continue;
    for (const it of items) {
      if (!it || !Number(it.item_id) || !Number(it.total) || it.kind !== kind) continue;
      const key = String(it.item_id);
      net[key] = round2((net[key] || 0) + (prov * Number(it.total)) / total);
    }
  }
  return net;
}

// ===================== لوحة معلومات المزود =====================
function getDashboard(provider) {
  const p = provider;
  const pid = p.id;
  const table = CATALOG_TABLES[p.service_slug];
  const catalogCount = table ? get(`SELECT COUNT(*) AS c FROM ${table} WHERE provider_id = ?`, [pid]).c : 0;

  const orders = get(
    `SELECT COUNT(*) AS c,
            COALESCE(SUM(total_amount),0) AS value,
            COALESCE(SUM(provider_amount),0) AS revenue,
            COALESCE(SUM(commission_amount),0) AS commission
     FROM orders WHERE provider_id = ? AND status != 'cancelled'`,
    [pid]
  );

  const byStatus = all('SELECT status, COUNT(*) AS count FROM orders WHERE provider_id = ? GROUP BY status', [pid]);
  const monthly = all(
    `SELECT strftime('%Y-%m', created_at) AS month, COUNT(*) AS orders_count,
            COALESCE(SUM(provider_amount),0) AS revenue
     FROM orders WHERE provider_id = ? AND status != 'cancelled'
     GROUP BY month ORDER BY month DESC LIMIT 6`,
    [pid]
  );

  const recent = all(
    `SELECT o.id, o.order_number, o.status, o.total_amount, o.provider_amount, o.commission_amount, o.created_at, o.customer_name
     FROM orders o WHERE o.provider_id = ? ORDER BY o.id DESC LIMIT 10`,
    [pid]
  );

  const promoActive = get(`SELECT COUNT(*) AS c FROM promotions WHERE provider_id = ? AND status = 'active' AND (ends_at IS NULL OR ends_at > datetime('now'))`, [pid]).c;
  const promoStats = get(
    `SELECT COALESCE(SUM(impressions),0) AS impressions, COALESCE(SUM(clicks),0) AS clicks
     FROM promotions WHERE provider_id = ? AND status = 'active'`,
    [pid]
  );
  const promoImpressions = promoStats ? Number(promoStats.impressions) : 0;
  const promoClicks = promoStats ? Number(promoStats.clicks) : 0;

  const type_alerts = {};
  const nowIso = new Date().toISOString();
  const in7d = new Date(Date.now() + 7 * 86400000).toISOString();
  switch (p.service_slug) {
    case 'stores':
      type_alerts.out_of_stock = get(`SELECT COUNT(*) AS c FROM products WHERE provider_id = ? AND is_active = 1 AND stock <= 0`, [pid]).c;
      type_alerts.low_stock = get(`SELECT COUNT(*) AS c FROM products WHERE provider_id = ? AND is_active = 1 AND stock > 0 AND stock <= ?`, [pid, LOW_STOCK_THRESHOLD]).c;
      break;
    case 'restaurants':
      type_alerts.unavailable = get(`SELECT COUNT(*) AS c FROM menu_items WHERE provider_id = ? AND is_active = 1 AND is_available = 0`, [pid]).c;
      break;
    case 'hotels':
    case 'flights':
    case 'travel_offices':
      type_alerts.upcoming = get(
        `SELECT COUNT(*) AS c FROM bookings b JOIN orders o ON o.id = b.order_id
         WHERE b.provider_id = ? AND o.status IN ('confirmed','in_progress')
           AND b.booking_date IS NOT NULL
           AND date(b.booking_date) >= date(?) AND date(b.booking_date) <= date(?)`,
        [pid, nowIso, in7d]
      ).c;
      break;
    default:
      break;
  }

  return {
    provider: {
      id: p.id, name_ar: p.name_ar, name_en: p.name_en, logo: p.logo, cover: p.cover,
      service_slug: p.service_slug, service_name_ar: p.service_name_ar, service_icon: p.service_icon,
      governorate_name_ar: p.governorate_name_ar, governorate_code: p.governorate_code,
      commission_rate: p.commission_rate, is_verified: p.is_verified, is_active: p.is_active,
      rating: p.rating, rating_count: p.rating_count,
    },
    catalog_count: catalogCount,
    orders_count: orders.c,
    orders_value: round2(orders.value),
    revenue: round2(orders.revenue),
    commission: round2(orders.commission),
    orders_by_status: byStatus,
    monthly,
    recent_orders: recent,
    promotions: {
      active_count: promoActive,
      impressions: promoImpressions,
      clicks: promoClicks,
      ctr: promoImpressions > 0 ? round2((promoClicks / promoImpressions) * 100) : 0,
    },
    type_alerts,
  };
}

// ===================== الملف الشخصي =====================
function getProfile(provider) {
  const user = get('SELECT id, name_ar, name_en, email, phone, avatar, totp_enabled FROM users WHERE id = ?', [provider.user_id]);
  return {
    provider: {
      id: provider.id, name_ar: provider.name_ar, name_en: provider.name_en, logo: provider.logo,
      cover: provider.cover, description: provider.description, address: provider.address,
      phone: provider.phone, website: provider.website, service_name_ar: provider.service_name_ar,
      governorate_name_ar: provider.governorate_name_ar, commission_rate: provider.commission_rate,
      is_verified: provider.is_verified, rating: provider.rating, rating_count: provider.rating_count,
    },
    user,
  };
}

function updateProfile(provider, actor, body) {
  const p = provider;
  const userRow = get('SELECT * FROM users WHERE id = ?', [p.user_id]);
  const {
    name_ar, name_en, email, phone, description, address, website, logo, cover, avatar,
  } = body || {};

  if (name_ar !== undefined && name_ar !== '') assertLength(name_ar, 100, 'الاسم');
  if (name_en !== undefined && name_en !== '') assertLength(name_en, 100, 'الاسم اللاتيني');
  if (avatar !== undefined && avatar !== '') assertLength(avatar, 500, 'الصورة الرمزية');
  if (description !== undefined && description !== '') assertLength(description, 3000, 'الوصف');
  if (address !== undefined && address !== '') assertLength(address, 500, 'العنوان');
  if (website !== undefined && website !== '') assertLength(website, 500, 'الموقع');
  if (website !== undefined && website !== null && website !== '' && !/^https?:\/\//i.test(String(website))) {
    throw new ApiError(400, 'رابط الموقع يجب أن يبدأ بـ http:// أو https://');
  }

  if (email) {
    const dup = get('SELECT id FROM users WHERE email = ? AND id != ?', [String(email).toLowerCase(), userRow.id]);
    if (dup) throw new ApiError(409, 'البريد مستخدم مسبقاً');
  }
  if (phone !== undefined && phone) {
    const dup = get('SELECT id FROM users WHERE phone = ? AND id != ?', [phone, userRow.id]);
    if (dup) throw new ApiError(409, 'رقم الهاتف مستخدم مسبقاً');
  }

  const newLogo = logo !== undefined ? logo : p.logo;
  const newCover = cover !== undefined ? cover : p.cover;
  const newAvatar = avatar !== undefined ? avatar : userRow.avatar;

  transaction(() => {
    run(
      `UPDATE users SET name_ar = ?, name_en = ?, email = ?, phone = ?, avatar = ?, updated_at = datetime('now') WHERE id = ?`,
      [
        name_ar !== undefined ? name_ar : userRow.name_ar,
        name_en !== undefined ? name_en : userRow.name_en,
        email !== undefined ? String(email).toLowerCase() : userRow.email,
        phone !== undefined ? phone : userRow.phone,
        newAvatar,
        userRow.id,
      ]
    );

    run(
      `UPDATE providers SET name_ar = ?, name_en = ?, description = ?, address = ?, phone = ?,
        website = ?, logo = ?, cover = ?, updated_at = datetime('now') WHERE id = ?`,
      [
        name_ar !== undefined ? name_ar : p.name_ar,
        name_en !== undefined ? name_en : p.name_en,
        description !== undefined ? description : p.description,
        address !== undefined ? address : p.address,
        phone !== undefined ? phone : p.phone,
        website !== undefined ? website : p.website,
        newLogo,
        newCover,
        p.id,
      ]
    );
  });

  deleteRemovedImages([p.logo, p.cover, userRow.avatar].join(','), [newLogo, newCover, newAvatar].join(','));

  logActivity(actor, 'update', 'provider', p.id, { profile: true });
  return get('SELECT * FROM providers WHERE id = ?', [p.id]);
}

// ===================== الحجوزات =====================
function listBookings(provider, query) {
  const pid = provider.id;
  const pg = paginate({ query }, 50);
  const total = get('SELECT COUNT(*) AS c FROM orders WHERE provider_id = ?', [pid]).c;
  const rows = all(
    `SELECT o.*, b.id AS booking_id, b.booking_type, b.booking_date, b.check_in, b.check_out,
            b.guests, b.details_json AS booking_details
     FROM orders o LEFT JOIN bookings b ON b.order_id = o.id
     WHERE o.provider_id = ?
     ORDER BY o.id DESC
     LIMIT ? OFFSET ?`,
    [pid, pg.limit, pg.offset]
  );
  return { rows, meta: { total, page: pg.page, limit: pg.limit, pages: Math.max(1, Math.ceil(total / pg.limit)) } };
}

// ===================== ملخص الطلبات الجديدة =====================
function getOrdersSummary(provider) {
  const pending = get("SELECT COUNT(*) AS c FROM orders WHERE provider_id = ? AND status = 'pending'", [provider.id]).c;
  return { pending };
}

// ===================== توفر غرف الفندق حسب التاريخ =====================
function getRoomsAvailability(provider, query) {
  if (provider.service_slug !== 'hotels') throw new ApiError(403, 'متاح للفنادق فقط');
  const pid = provider.id;
  const from = query && query.from ? String(query.from) : null;
  const to = query && query.to ? String(query.to) : null;
  const rooms = all('SELECT id, name_ar, room_type, price_per_night, max_guests FROM hotel_rooms WHERE provider_id = ? AND is_active = 1 ORDER BY id ASC', [pid]);
  const ranges = all(
    `SELECT b.check_in, b.check_out, o.order_number, o.status, o.items_json
     FROM bookings b JOIN orders o ON o.id = b.order_id
     WHERE b.provider_id = ? AND o.status IN ('confirmed','in_progress')
       AND b.check_in IS NOT NULL AND b.check_out IS NOT NULL`,
    [pid]
  );
  const rows = rooms.map((room) => {
    const booked = ranges.filter((b) => {
      try { return String(b.items_json).includes(`"item_id":${room.id},`); } catch (e) { return false; }
    });
    const is_available = from && to
      ? !booked.some((b) => String(b.check_in) < to && String(b.check_out) > from)
      : null;
    return {
      ...room,
      booked_ranges: booked.map(({ check_in, check_out, order_number, status }) => ({ check_in, check_out, order_number, status })),
      is_available,
    };
  });
  return rows;
}

// ===================== تقييمات ومراجعات المزود =====================
function listRatings(provider, query) {
  const pid = provider.id;
  const summary = get(
    `SELECT COUNT(*) AS count, COALESCE(SUM(rating),0) AS total,
            COALESCE(AVG(rating),0) AS avg
     FROM provider_ratings WHERE provider_id = ?`,
    [pid]
  );
  const pg = paginate({ query }, 20);
  const rows = all(
    `SELECT pr.*, u.name_ar AS customer_name, u.avatar AS customer_avatar,
            o.order_number, o.created_at AS order_date
     FROM provider_ratings pr
     LEFT JOIN users u ON u.id = pr.customer_id
     LEFT JOIN orders o ON o.id = pr.order_id
     WHERE pr.provider_id = ?
     ORDER BY pr.id DESC
     LIMIT ? OFFSET ?`,
    [pid, pg.limit, pg.offset]
  );
  return {
    rows,
    meta: {
      total: summary.count,
      rating: summary.count > 0 ? Math.round((Number(summary.total) / Number(summary.count)) * 10) / 10 : 0,
      rating_count: summary.count,
      page: pg.page,
      limit: pg.limit,
      pages: Math.max(1, Math.ceil(summary.count / pg.limit)),
    },
  };
}

function replyRating(provider, actor, id, body) {
  const rid = toId(id);
  const row = get('SELECT * FROM provider_ratings WHERE id = ? AND provider_id = ?', [rid, provider.id]);
  if (!row) throw new ApiError(404, 'التقييم غير موجود');
  const reply = String((body || {}).reply || '').trim();
  if (reply.length > 1000) throw new ApiError(400, 'الرد طويل جداً (الحد 1000 حرف)');
  run("UPDATE provider_ratings SET reply = NULLIF(?, ''), replied_at = CASE WHEN ? = '' THEN NULL ELSE datetime('now') END, updated_at = datetime('now') WHERE id = ?", [reply, reply, rid]);
  logActivity(actor, 'reply_rating', 'provider_rating', rid, { provider_id: provider.id });
  return get('SELECT * FROM provider_ratings WHERE id = ?', [rid]);
}

// ===================== مستندات توثيق المزود =====================
const MAX_DOC_SIZE = 2 * 1024 * 1024;

function validateDocImage(value, label) {
  if (!value) return null;
  const s = String(value);
  if (s.startsWith('data:')) {
    const { url } = saveBase64ToUpload(s);
    return url;
  }
  if (s.startsWith('https://') || s.startsWith('http://localhost') || s.startsWith('/uploads/')) {
    return s;
  }
  throw new ApiError(400, `${label} يجب أن تكون صورة (data:image/...) أو رابطاً أو ملفاً مرفوعاً`);
}

function getVerification(provider) {
  const p = provider;
  return {
    verification_status: p.verification_status || 'none',
    verification_note: p.verification_note || null,
    national_id_image: p.national_id_image || null,
    residency_doc_image: p.residency_doc_image || null,
    submitted_at: p.submitted_at || null,
    reviewed_at: p.reviewed_at || null,
    is_verified: !!p.is_verified,
  };
}

function submitVerification(provider, actor, body) {
  const p = provider;
  const { national_id_image, residency_doc_image } = body || {};
  if (!national_id_image && !residency_doc_image) {
    throw new ApiError(400, 'ارفع صورة البطاقة الوطنية أو تأييد السكن على الأقل');
  }
  const national = validateDocImage(national_id_image, 'البطاقة الوطنية');
  const residency = validateDocImage(residency_doc_image, 'تأييد السكن');
  const newNational = national ?? p.national_id_image;
  const newResidency = residency ?? p.residency_doc_image;
  run(
    `UPDATE providers SET national_id_image = ?, residency_doc_image = ?, verification_status = 'pending',
      verification_note = NULL, submitted_at = datetime('now'), reviewed_at = NULL, updated_at = datetime('now')
     WHERE id = ?`,
    [newNational, newResidency, p.id]
  );
  deleteRemovedImages([p.national_id_image, p.residency_doc_image].join(','), [newNational, newResidency].join(','));
  logActivity(actor, 'submit_verification', 'provider', p.id, {});
  return get('SELECT id, verification_status, verification_note, submitted_at FROM providers WHERE id = ?', [p.id]);
}

// ===================== كوبونات الخصم =====================
function normalizeCouponCode(raw) {
  const code = String(raw || '').trim().toUpperCase().replace(/\s+/g, '-');
  if (!code) throw new ApiError(400, 'رمز الكوبون مطلوب');
  if (code.length > 40) throw new ApiError(400, 'رمز الكوبون يتجاوز الحد المسموح (40 حرفاً)');
  return code;
}

const COUPON_SELECT = `
  SELECT c.*,
         (SELECT COUNT(*) FROM coupon_usages u WHERE u.coupon_id = c.id) AS used_count
  FROM coupons c
`;

function assertCouponValue(type, value) {
  const discountType = type === 'fixed' ? 'fixed' : 'percent';
  const discountValue = Number(value);
  if (!Number.isFinite(discountValue) || discountValue <= 0) {
    throw new ApiError(400, 'قيمة الخصم يجب أن تكون رقماً موجباً');
  }
  if (discountType === 'percent') {
    const maxPct = settingValue('provider_coupon_max_percent', 50);
    if (discountValue > maxPct) throw new ApiError(400, `نسبة الخصم لا يمكن أن تتجاوز ${maxPct}% لمزود الخدمة`);
  } else {
    const maxFixed = settingValue('provider_coupon_max_fixed', 100000);
    if (discountValue > maxFixed) throw new ApiError(400, `الخصم الثابت لا يمكن أن يتجاوز ${round2(maxFixed)} دينار لمزود الخدمة`);
  }
  return { discountType, discountValue };
}

function normalizeCouponDate(value, label) {
  if (value === undefined || value === null || value === '') return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) throw new ApiError(400, `${label} بتنسيق غير صالح (استخدم YYYY-MM-DD أو ISO)`);
  return d.toISOString();
}

function listCoupons(provider, query) {
  const pg = paginate({ query });
  const total = get('SELECT COUNT(*) AS c FROM coupons WHERE provider_id = ?', [provider.id]).c;
  const rows = all(
    COUPON_SELECT + ' WHERE c.provider_id = ? ORDER BY c.id DESC LIMIT ? OFFSET ?',
    [provider.id, pg.limit, pg.offset]
  );
  return { rows, meta: { total, page: pg.page, limit: pg.limit, pages: Math.max(1, Math.ceil(total / pg.limit)) } };
}

function createCoupon(provider, user, body) {
  const code = normalizeCouponCode(body.code);
  const { discountType, discountValue } = assertCouponValue(body.discount_type, body.discount_value);
  if (body.title !== undefined && body.title !== '') assertLength(body.title, 100, 'الاسم');
  const dup = get('SELECT id FROM coupons WHERE code = ?', [code]);
  if (dup) throw new ApiError(409, 'رمز الكوبون مستخدم مسبقاً');
  const perCustomerLimit = body.per_customer_limit === undefined || body.per_customer_limit === null || body.per_customer_limit === ''
    ? 1 : Math.max(0, Number(body.per_customer_limit) || 0);
  const startsAt = normalizeCouponDate(body.starts_at, 'تاريخ بداية الكوبون');
  const endsAt = normalizeCouponDate(body.ends_at, 'تاريخ نهاية الكوبون');
  if (startsAt && endsAt && new Date(endsAt) <= new Date(startsAt)) {
    throw new ApiError(400, 'تاريخ نهاية الكوبون يجب أن يكون بعد تاريخ بدايته');
  }
  const id = run(
    `INSERT INTO coupons (code, title, discount_type, discount_value, min_amount, provider_id, starts_at, ends_at, max_uses, per_customer_limit, is_active)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    [
      code,
      body.title || null,
      discountType,
      round2(discountValue),
      round2(Math.max(0, Number(body.min_amount) || 0)),
      provider.id,
      startsAt,
      endsAt,
      Math.max(0, Number(body.max_uses) || 0),
      perCustomerLimit,
      body.is_active === undefined ? 1 : (Number(body.is_active) ? 1 : 0),
    ]
  ).lastId;

  logActivity(user, 'create', 'coupon', id, { code });
  notifyRole('admin', {
    type: 'coupon_created',
    title: 'كوبون جديد تم إنشاؤه 🎫',
    body: `المزود «${provider.name_ar}» أنشأ كوبون «${code}».`,
    url: '/coupons',
    icon: '🎫',
  });

  return get(COUPON_SELECT + ' WHERE c.id = ?', [id]);
}

function updateCoupon(provider, actor, id, body) {
  const cid = toId(id);
  const c = get('SELECT * FROM coupons WHERE id = ?', [cid]);
  if (!c || Number(c.provider_id) !== provider.id) throw new ApiError(404, 'الكوبون غير موجود');
  const b = body || {};

  const code = b.code !== undefined ? normalizeCouponCode(b.code) : c.code;
  if (code !== c.code) {
    const dup = get('SELECT id FROM coupons WHERE code = ? AND id != ?', [code, cid]);
    if (dup) throw new ApiError(409, 'رمز الكوبون مستخدم مسبقاً');
  }
  let discountType = c.discount_type;
  let discountValue = Number(c.discount_value);
  if (b.discount_type !== undefined || b.discount_value !== undefined) {
    ({ discountType, discountValue } = assertCouponValue(
      b.discount_type !== undefined ? b.discount_type : c.discount_type,
      b.discount_value !== undefined ? b.discount_value : c.discount_value
    ));
  }
  if (b.title !== undefined && b.title !== '') assertLength(b.title, 100, 'الاسم');
  const startsAt = b.starts_at !== undefined
    ? normalizeCouponDate(b.starts_at, 'تاريخ بداية الكوبون')
    : (c.starts_at ? new Date(c.starts_at).toISOString() : null);
  const endsAt = b.ends_at !== undefined
    ? normalizeCouponDate(b.ends_at, 'تاريخ نهاية الكوبون')
    : (c.ends_at ? new Date(c.ends_at).toISOString() : null);
  if (startsAt && endsAt && new Date(endsAt) <= new Date(startsAt)) {
    throw new ApiError(400, 'تاريخ نهاية الكوبون يجب أن يكون بعد تاريخ بدايته');
  }

  run(
    `UPDATE coupons SET code = ?, title = ?, discount_type = ?, discount_value = ?, min_amount = ?,
      starts_at = ?, ends_at = ?, max_uses = ?, per_customer_limit = ?, is_active = ?, updated_at = datetime('now')
     WHERE id = ?`,
    [
      code,
      b.title !== undefined ? b.title : c.title,
      discountType,
      round2(discountValue),
      round2(Math.max(0, b.min_amount !== undefined ? Number(b.min_amount) : c.min_amount)),
      startsAt,
      endsAt,
      b.max_uses !== undefined ? Math.max(0, Number(b.max_uses) || 0) : c.max_uses,
      b.per_customer_limit !== undefined ? Math.max(0, Number(b.per_customer_limit) || 0) : c.per_customer_limit,
      b.is_active !== undefined ? (Number(b.is_active) ? 1 : 0) : c.is_active,
      cid,
    ]
  );
  logActivity(actor, 'update', 'coupon', cid, { code });
  return get(COUPON_SELECT + ' WHERE c.id = ?', [cid]);
}

function toggleCoupon(provider, actor, id) {
  const cid = toId(id);
  const c = get('SELECT * FROM coupons WHERE id = ?', [cid]);
  if (!c || Number(c.provider_id) !== provider.id) throw new ApiError(404, 'الكوبون غير موجود');
  run('UPDATE coupons SET is_active = ?, updated_at = datetime(\'now\') WHERE id = ?', [c.is_active ? 0 : 1, cid]);
  logActivity(actor, c.is_active ? 'deactivate' : 'activate', 'coupon', cid, { code: c.code });
  return get(COUPON_SELECT + ' WHERE c.id = ?', [cid]);
}

function deleteCoupon(provider, actor, id) {
  const cid = toId(id);
  const c = get('SELECT * FROM coupons WHERE id = ?', [cid]);
  if (!c || Number(c.provider_id) !== provider.id) throw new ApiError(404, 'الكوبون غير موجود');
  const used = get('SELECT COUNT(*) AS c FROM coupon_usages WHERE coupon_id = ?', [cid]).c;
  if (used > 0) throw new ApiError(400, 'الكوبون مستخدم في طلبات ولا يمكن حذفه — يمكنك إيقافه بدلاً من ذلك');
  run('DELETE FROM coupons WHERE id = ?', [cid]);
  logActivity(actor, 'delete', 'coupon', cid, { code: c.code });
  return { message: 'تم حذف الكوبون بنجاح' };
}

module.exports = {
  LOW_STOCK_THRESHOLD, CATALOG_TABLES, ORDER_KIND,
  getCatalogNet, getDashboard, getProfile, updateProfile,
  listBookings, getOrdersSummary, getRoomsAvailability, listRatings, replyRating,
  getVerification, submitVerification, MAX_DOC_SIZE,
  normalizeCouponCode, COUPON_SELECT, assertCouponValue, normalizeCouponDate,
  listCoupons, createCoupon, updateCoupon, toggleCoupon, deleteCoupon,
};
