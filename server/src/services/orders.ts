const { get, all, run, transaction } = require('../db');
const { ApiError, toId, round2, paginate, csvEscape, isUniqueViolation, localDayUtcBoundary, assertAmount, assertQuantity } = require('../utils/helpers');
const { logActivity } = require('../utils/log');
const { notifyUser } = require('../utils/push');
const { validateCoupon } = require('../utils/coupons');
const { awardPoints, planRedeem, applyRedeem, grantReferralRewards } = require('../utils/loyalty');
const { settingValue } = require('../utils/helpers');
const { resolveRate } = require('./services');

const ALLOWED_TRANSITIONS = {
  pending: ['confirmed', 'cancelled'],
  confirmed: ['in_progress', 'cancelled'],
  in_progress: ['completed', 'cancelled'],
  completed: [],
  cancelled: [],
};

const ORDER_SELECT = `
  SELECT o.*, p.name_ar AS provider_name, p.logo AS provider_logo,
         s.name_ar AS service_name_ar, s.slug AS service_slug,
         g.name_ar AS governorate_name_ar,
         cu.name_ar AS customer_name_ref
  FROM orders o
  JOIN providers p ON p.id = o.provider_id
  JOIN services s ON s.id = o.service_id
  LEFT JOIN governorates g ON g.id = o.governorate_id
  LEFT JOIN users cu ON cu.id = o.customer_id
`;

function orderScope(actor) {
  if (actor.role === 'agent') {
    return { sql: 'o.governorate_id = ?', params: [actor.governorate_id] };
  }
  if (actor.role === 'provider') {
    return { sql: 'o.provider_id = ?', params: [actor.provider_id] };
  }
  if (actor.role === 'customer') {
    return { sql: 'o.customer_id = ?', params: [actor.id] };
  }
  return { sql: '1=1', params: [] };
}

function inOwnershipScope(actor, o) {
  if (actor.role === 'agent') return o.governorate_id === actor.governorate_id;
  if (actor.role === 'provider') return o.provider_id === actor.provider_id;
  if (actor.role === 'customer') return o.customer_id === actor.id;
  return true;
}

function idempotencyKey(actor, key) {
  return actor ? `${actor.id}:${String(key)}` : String(key);
}

function decorateOrder(o, bookingsMap = null) {
  const out = { ...o };
  try { out.items = JSON.parse(o.items_json || '[]'); } catch (e: any) { out.items = []; }
  try { out.history = JSON.parse(o.status_history_json || '[]'); } catch (e: any) { out.history = []; }
  const b = bookingsMap ? bookingsMap.get(o.id) : get('SELECT * FROM bookings WHERE order_id = ?', [o.id]);
  if (b) {
    out.booking = { id: b.id, type: b.booking_type, booking_date: b.booking_date, check_in: b.check_in, check_out: b.check_out, guests: b.guests, status: b.status };
    try { Object.assign(out.booking, JSON.parse(b.details_json || '{}')); } catch (e: any) { /* ignore */ }
  }
  return out;
}

function decorateOrders(rows) {
  const ids = rows.map((o) => o.id);
  const map = new Map();
  if (ids.length) {
    const bs = all(`SELECT * FROM bookings WHERE order_id IN (${ids.map(() => '?').join(',')})`, ids);
    for (const b of bs) map.set(b.order_id, b);
  }
  return rows.map((o) => decorateOrder(o, map));
}

function finiteRate(value) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

function computeCommissions(provider, governorateId, total, serviceCommissionRate) {
  const totalAmount = round2(total);
  const feeRate = finiteRate(resolveRate(serviceCommissionRate, provider.commission_rate));
  const commission = round2(totalAmount * feeRate / 100);

  const agent = get('SELECT * FROM agents WHERE governorate_id = ?', [governorateId]);
  let agentAmount = 0;
  if (agent && agent.lease_expires_at && new Date(agent.lease_expires_at) > new Date()) {
    agentAmount = round2(totalAmount * Math.min(finiteRate(agent.commission_rate), 100) / 100);
    agentAmount = Math.min(agentAmount, commission);
  }
  const platformAmount = round2(commission - agentAmount);
  const providerAmount = round2(totalAmount - commission);
  return { totalAmount, commission, agentAmount, platformAmount, providerAmount, agentId: agent ? agent.id : null };
}

function generateOrderNumber() {
  const now = new Date();
  const y = now.getFullYear();
  const rand = Math.floor(100000 + Math.random() * 900000);
  return `ORD-${y}-${rand}`;
}

const INSERT_ORDER_SQL = `INSERT INTO orders (order_number, customer_id, provider_id, service_id, governorate_id, status,
    customer_name, customer_phone, customer_address, notes, items_json, total_amount,
    subtotal_amount, discount_amount, coupon_id, coupon_code, points_discount_amount, redeemed_points,
    commission_amount, platform_amount, agent_amount, provider_amount, status_history_json)
   VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`;

function insertOrder(params) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const orderNumber = generateOrderNumber();
    try {
      const orderId = run(INSERT_ORDER_SQL, [orderNumber, ...params]).lastId;
      return { orderId, orderNumber };
    } catch (e: any) {
      if (isUniqueViolation(e)) continue;
      throw e;
    }
  }
  throw new ApiError(500, 'تعذر إنشاء رقم طلب فريد، يرجى المحاولة مجدداً');
}

const CATALOG_KINDS = {
  products: { table: 'products', priceCol: 'price', stockCol: 'stock', label: 'منتج' },
  menu: { table: 'menu_items', priceCol: 'price', stockCol: null, label: 'صنف' },
  rooms: { table: 'hotel_rooms', priceCol: 'price_per_night', stockCol: null, label: 'غرفة' },
  flights: { table: 'flights', priceCol: 'price', stockCol: 'seats', label: 'رحلة' },
  packages: { table: 'travel_packages', priceCol: 'price', stockCol: null, label: 'باقة' },
};

function resolveOrderItems(providerId, rawItems) {
  const items = [];
  const usage = {};
  for (const raw of rawItems) {
    const kind = String((raw && raw.kind) || '');
    const itemId = Number(raw && raw.item_id);
    const quantity = Number(raw && raw.quantity);
    const def = CATALOG_KINDS[kind];
    if (!def) throw new ApiError(400, `نوع بند غير معروف: ${kind || '(فارغ)'}`);
    if (!Number.isInteger(itemId) || itemId <= 0) throw new ApiError(400, 'معرف البند غير صحيح');
    if (!Number.isInteger(quantity) || quantity <= 0) throw new ApiError(400, 'الكمية يجب أن تكون رقماً صحيحاً موجباً');

    const row = get(`SELECT * FROM ${def.table} WHERE id = ? AND provider_id = ?`, [itemId, providerId]);
    if (!row) throw new ApiError(400, 'أحد البنود المحددة غير موجود ضمن هذا المزود');
    if (!row.is_active) throw new ApiError(400, 'أحد البنود المحددة غير متاح حالياً');
    if (def.table === 'menu_items' && Number(row.is_available) === 0) {
      throw new ApiError(400, 'أحد أصناف القائمة غير متوفر الآن');
    }

    if (def.stockCol) {
      const available = Number(row[def.stockCol]) || 0;
      const key = `${kind}:${itemId}`;
      usage[key] = (usage[key] || 0) + quantity;
      if (usage[key] > available) {
        throw new ApiError(400, `الكمية المطلوبة غير متوفرة لهذا البند (المتاح: ${available})`);
      }
    }

    const unitPrice = round2(Number(row[def.priceCol]) || 0);
    const total = round2(unitPrice * quantity);
    items.push({
      kind,
      item_id: itemId,
      title: row.name_ar || (def.table === 'flights' ? row.flight_number : null) || `بند (${def.label})`,
      quantity,
      unit_price: unitPrice,
      total,
    });
  }
  return { items, usage };
}

function sanitizeFreeFormItems(rawItems) {
  if (!Array.isArray(rawItems) || rawItems.length === 0) {
    throw new ApiError(400, 'يرجى إرسال بنود الطلب (بند واحد على الأقل)');
  }
  return rawItems.map((it) => {
    const quantity = assertQuantity(Number(it && it.quantity), 'الكمية');
    const unitPrice = assertAmount(Number(it && it.unit_price), 'سعر البند');
    return { title: (it && it.title) || 'بند الطلب', quantity, unit_price: round2(unitPrice), total: round2(quantity * unitPrice) };
  });
}

function restoreInventory(order) {
  let items = [];
  try { items = JSON.parse(order.items_json || '[]'); } catch (e: any) { items = []; }
  const usage = {};
  for (const it of items) {
    if (!it || it.item_id === undefined) continue;
    const qty = Number(it.quantity) || 0;
    if (qty <= 0) continue;
    const key = `${String(it.kind)}:${Number(it.item_id)}`;
    usage[key] = (usage[key] || 0) + qty;
  }
  for (const [key, qty] of Object.entries(usage)) {
    const [kind, idStr] = key.split(':');
    const id = Number(idStr);
    if (kind === 'products') run('UPDATE products SET stock = stock + ?, updated_at = datetime(\'now\') WHERE id = ?', [qty, id]);
    else if (kind === 'flights') run('UPDATE flights SET seats = seats + ?, updated_at = datetime(\'now\') WHERE id = ?', [qty, id]);
  }
}

function parseDateOrThrow(value, label) {
  if (value === undefined || value === null || value === '') return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) throw new ApiError(400, `${label} بتنسيق غير صالح`);
  return d;
}

// منع البيع المزدوج للغرف: لا يُسمح بفترة تتداخل مع حجز غير ملغي لنفس الغرفة لدى نفس المزوّد
function assertRoomAvailability(providerId, items, checkIn, checkOut, excludeOrderId) {
  const rooms = items.filter((it) => it && it.kind === 'rooms' && it.item_id);
  if (!rooms.length) return;
  if (!checkIn || !checkOut) {
    throw new ApiError(400, 'حجز الفنادق يتطلب تاريخي الوصول والمغادرة (check_in / check_out)');
  }
  const inDate = parseDateOrThrow(checkIn, 'تاريخ الوصول');
  const outDate = parseDateOrThrow(checkOut, 'تاريخ المغادرة');
  if (!inDate || !outDate) {
    throw new ApiError(400, 'حجز الفنادق يتطلب تاريخي الوصول والمغادرة (check_in / check_out)');
  }
  if (outDate <= inDate) {
    throw new ApiError(400, 'تاريخ المغادرة يجب أن يكون بعد تاريخ الوصول');
  }
  for (const room of rooms) {
    const clash = get(
      `SELECT o.order_number FROM bookings b
       JOIN orders o ON o.id = b.order_id
       WHERE b.provider_id = ? AND b.status != 'cancelled'
         AND b.check_in IS NOT NULL AND b.check_out IS NOT NULL
         AND b.check_in < ? AND b.check_out > ?
         AND (instr(o.items_json, ?) > 0 OR instr(o.items_json, ?) > 0)
         AND o.id != ? LIMIT 1`,
      [providerId, String(checkOut), String(checkIn), `"item_id":${Number(room.item_id)},`, `"item_id":${Number(room.item_id)}}`, excludeOrderId]
    );
    if (clash) {
      throw new ApiError(409, `الغرفة محجوزة خلال هذه الفترة (طلب ${clash.order_number}) — اختر تواريخ أخرى أو غرفة مختلفة`);
    }
  }
}

function buildOrderFilters(actor, query) {
  const { status, q, service_id, governorate_id, from, to, provider_id } = query || {};
  const conditions = [];
  const params = [];
  const sc = orderScope(actor);
  conditions.push(sc.sql);
  params.push(...sc.params);

  if (status) { conditions.push('o.status = ?'); params.push(status); }
  if (service_id) { conditions.push('o.service_id = ?'); params.push(Number(service_id)); }
  if (governorate_id && actor.role === 'admin') { conditions.push('o.governorate_id = ?'); params.push(Number(governorate_id)); }
  if (provider_id && (actor.role === 'agent' || actor.role === 'admin')) { conditions.push('o.provider_id = ?'); params.push(Number(provider_id)); }
  if (q) {
    conditions.push('(o.order_number LIKE ? OR o.customer_name LIKE ? OR o.customer_phone LIKE ? OR p.name_ar LIKE ?)');
    params.push(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`);
  }
  if (from) {
    const t = localDayUtcBoundary(from, false);
    if (!t) throw new ApiError(400, 'تاريخ بداية غير صالح (التنسيق YYYY-MM-DD)');
    conditions.push("strftime('%s', o.created_at) >= strftime('%s', ?)");
    params.push(t);
  }
  if (to) {
    const t = localDayUtcBoundary(to, true);
    if (!t) throw new ApiError(400, 'تاريخ نهاية غير صالح (التنسيق YYYY-MM-DD)');
    conditions.push("strftime('%s', o.created_at) <= strftime('%s', ?)");
    params.push(t);
  }
  return { where: ' WHERE ' + conditions.join(' AND '), params };
}

function listOrders(actor, query) {
  const { where, params } = buildOrderFilters(actor, query);
  const pg = paginate({ query }, 50);
  if (pg.enabled) {
    const total = get(`SELECT COUNT(*) AS c FROM orders o JOIN providers p ON p.id = o.provider_id ${where}`, params).c;
    const rows = all(ORDER_SELECT + where + ' ORDER BY o.id DESC LIMIT ? OFFSET ?', [...params, pg.limit, pg.offset]);
    return {
      rows: decorateOrders(rows),
      meta: { total, page: pg.page, limit: pg.limit, pages: Math.max(1, Math.ceil(total / pg.limit)) },
    };
  }
  const rows = all(ORDER_SELECT + where + ' ORDER BY o.id DESC', params);
  return { rows: decorateOrders(rows), meta: null };
}

function getOrderStats(actor) {
  const sc = orderScope(actor);
  const rows = all(
    `SELECT o.status, COUNT(*) AS count, COALESCE(SUM(o.total_amount),0) AS value
     FROM orders o WHERE ${sc.sql} GROUP BY o.status`,
    sc.params
  );
  const total = rows.reduce((s, r) => s + r.count, 0);
  return { total, by_status: rows };
}

function getOrderExportTotal(actor, query) {
  const { where, params } = buildOrderFilters(actor, query);
  return get(`SELECT COUNT(*) AS c FROM orders o ${where}`, params).c;
}

function getOrderExportRows(actor, query, limit, offset) {
  const { where, params } = buildOrderFilters(actor, query);
  return all(ORDER_SELECT + where + ' ORDER BY o.id DESC LIMIT ? OFFSET ?', [...params, limit, offset]);
}

function getOrderById(actor, rawId) {
  const id = toId(rawId);
  const order = get(ORDER_SELECT + ' WHERE o.id = ?', [id]);
  if (!order) throw new ApiError(404, 'الطلب غير موجود');
  if (actor.role === 'agent' && order.governorate_id !== actor.governorate_id) throw new ApiError(403, 'لا تملك صلاحية الاطلاع على هذا الطلب');
  if (actor.role === 'provider' && order.provider_id !== actor.provider_id) throw new ApiError(403, 'لا تملك صلاحية الاطلاع على هذا الطلب');
  if (actor.role === 'customer' && order.customer_id !== actor.id) throw new ApiError(403, 'لا تملك صلاحية الاطلاع على هذا الطلب');
  return decorateOrder(order);
}

function createOrder(actor, body, headers) {
  let idemKey = null;
  let nsIdemKey = null;
  try {
    const { provider_id, customer_id, customer_name, customer_phone, customer_address, notes, booking } = body || {};
    if (!provider_id) throw new ApiError(400, 'يرجى تحديد مزود الخدمة');

    idemKey = headers && (headers['idempotency-key'] || headers['Idempotency-Key']) || (body && body.idempotency_key) || null;
    nsIdemKey = idemKey ? idempotencyKey(actor, idemKey) : null;
    if (idemKey) {
      if (String(idemKey).length > 64) throw new ApiError(400, 'مفتاح Idempotency طويل جداً (64 حرفاً كحد أقصى)');
      const prior = get('SELECT order_id FROM idempotency_keys WHERE key = ?', [nsIdemKey]);
      if (prior) {
        const existingOrder = get(ORDER_SELECT + ' WHERE o.id = ?', [prior.order_id]);
        if (existingOrder && inOwnershipScope(actor, existingOrder)) return { reused: true, result: decorateOrder(existingOrder) };
        if (existingOrder) throw new ApiError(403, 'لا تملك صلاحية الاطلاع على هذا الطلب');
      }
    }

    const provider = get('SELECT * FROM providers WHERE id = ?', [Number(provider_id)]);
    if (!provider) throw new ApiError(404, 'مزود الخدمة غير موجود');
    if (!provider.is_active) throw new ApiError(403, 'مزود الخدمة غير نشط حالياً');
    if (actor.role === 'agent' && provider.governorate_id !== actor.governorate_id) {
      throw new ApiError(403, 'لا يمكن إنشاء طلب لمزود خارج محافظتك — عمولتك تحسب لوكيل محافظة المزود');
    }
    if (actor.role === 'provider' && provider.id !== actor.provider_id) {
      throw new ApiError(403, 'لا يمكنك إنشاء طلب إلا لصالح نشاطك أنت');
    }

    const svc = get('SELECT * FROM services WHERE id = ?', [provider.service_id]);
    const bodyServiceId = body && body.service_id;
    if (bodyServiceId !== undefined && bodyServiceId !== null && bodyServiceId !== '' && Number(bodyServiceId) !== provider.service_id) {
      throw new ApiError(400, 'نوع الخدمة لا يطابق مزود الخدمة المحدد');
    }
    const svcId = provider.service ? provider.service_id : provider.service_id;

    let customer = null;
    if (actor.role === 'customer') {
      customer = get('SELECT * FROM users WHERE id = ?', [actor.id]);
    } else if (customer_id) {
      customer = get('SELECT * FROM users WHERE id = ?', [Number(customer_id)]);
      if (!customer || customer.role !== 'customer') throw new ApiError(400, 'الزبون المحدد غير موجود');
    }

    const rawItems = body && body.items;
    const isCatalogForm = Array.isArray(rawItems) && rawItems.length > 0 && rawItems.every((it) => it && it.item_id !== undefined);
    if (actor.role === 'customer' && !isCatalogForm) {
      throw new ApiError(400, 'يجب أن تكون بنود الطلب من كتالوج مزود الخدمة');
    }

    let normalizedItems = [];
    let usage = {};
    if (isCatalogForm) {
      const resolved = resolveOrderItems(provider.id, rawItems);
      normalizedItems = resolved.items;
      usage = resolved.usage;
    } else {
      normalizedItems = sanitizeFreeFormItems(rawItems);
    }

    const total = round2(normalizedItems.reduce((s, it) => s + it.total, 0));
    const cusName = customer_name || (customer ? customer.name_ar : null);
    const cusPhone = customer_phone || (customer ? customer.phone : null);

    let subtotalAmount = total;
    let discountAmount = 0;
    let coupon = null;
    let couponDiscount = null;
    const couponCode = (body && body.coupon_code) || null;
    if (couponCode && actor.role === 'customer') {
      ({ coupon, discount: couponDiscount } = validateCoupon(couponCode, {
        providerId: provider.id,
        amount: total,
        customerId: customer.id,
      }));
      discountAmount = couponDiscount;
      subtotalAmount = total;
    }
    const payable = round2(subtotalAmount - discountAmount);

    let pointsDiscountAmount = 0;
    let redeemedPoints = 0;
    let pendingRedeem = null;
    const redeemRequested = Number((body && body.redeem_points) || 0);
    if (redeemRequested > 0 && actor.role === 'customer') {
      pendingRedeem = planRedeem(customer.id, redeemRequested, payable);
      pointsDiscountAmount = round2(pendingRedeem.discount);
      redeemedPoints = pendingRedeem.points;
    }
    const finalPayable = round2(payable - pointsDiscountAmount);

    const { totalAmount, commission, agentAmount, platformAmount, providerAmount, agentId } = computeCommissions(provider, provider.governorate_id, finalPayable, svc.commission_rate);

    if (svc.slug === 'hotels' && normalizedItems.some((it) => it && it.kind === 'rooms')) {
      if (!booking || !booking.check_in || !booking.check_out) {
        throw new ApiError(400, 'حجز الفنادق يتطلب تاريخي الوصول والمغادرة (check_in / check_out)');
      }
      const inDate = parseDateOrThrow(booking.check_in, 'تاريخ الوصول');
      const outDate = parseDateOrThrow(booking.check_out, 'تاريخ المغادرة');
      if (!inDate || !outDate) {
        throw new ApiError(400, 'حجز الفنادق يتطلب تاريخي الوصول والمغادرة (check_in / check_out)');
      }
      if (outDate <= inDate) {
        throw new ApiError(400, 'تاريخ المغادرة يجب أن يكون بعد تاريخ الوصول');
      }
      const guests = Number(booking.guests) || 1;
      for (const it of normalizedItems) {
        if (it && it.kind === 'rooms') {
          const room = get('SELECT max_guests FROM hotel_rooms WHERE id = ?', [Number(it.item_id)]);
          if (room && room.max_guests && guests > Number(room.max_guests)) {
            throw new ApiError(400, `عدد النزلاء يتجاوز الحد الأقصى للغرفة (${room.max_guests})`);
          }
        }
      }
    }

    const { orderId, orderNumber } = transaction(() => {
      const history = JSON.stringify([{ status: 'pending', at: new Date().toISOString(), by: actor.role }]);
      const inserted = insertOrder([
        customer ? customer.id : null,
        provider.id,
        svcId,
        provider.governorate_id,
        'pending',
        cusName || null,
        cusPhone || null,
        customer_address || null,
        notes || null,
        JSON.stringify(normalizedItems),
        totalAmount,
        subtotalAmount,
        discountAmount,
        coupon ? coupon.id : null,
        coupon ? coupon.code : null,
        pointsDiscountAmount,
        redeemedPoints,
        commission,
        platformAmount,
        agentAmount,
        providerAmount,
        history,
      ]);

      for (const [key, qty] of Object.entries(usage)) {
        const [kind, idStr] = key.split(':');
        const id = Number(idStr);
        if (kind === 'products') {
          run('UPDATE products SET stock = stock - ?, updated_at = datetime(\'now\') WHERE id = ?', [qty, id]);
        } else if (kind === 'flights') {
          run('UPDATE flights SET seats = seats - ?, updated_at = datetime(\'now\') WHERE id = ?', [qty, id]);
        }
      }

      if (booking && ['hotels', 'flights', 'travel_offices'].includes(svc.slug)) {
        const b = booking || {};
        if (svc.slug === 'hotels') {
          assertRoomAvailability(provider.id, normalizedItems, b.check_in, b.check_out, inserted.orderId);
        }
        const details = {
          ...(b.details || {}),
          title: b.title || null,
          travel_date: b.travel_date || null,
          passengers: b.passengers || null,
          travelers: b.travelers || null,
          nights: b.nights || null,
        };
        run(
          `INSERT INTO bookings (order_id, provider_id, booking_type, details_json, booking_date, check_in, check_out, guests, status)
           VALUES (?,?,?,?,?,?,?,?,?)`,
          [
            inserted.orderId,
            provider.id,
            b.type || svc.slug,
            JSON.stringify(details),
            b.booking_date || b.travel_date || b.check_in || null,
            b.check_in || null,
            b.check_out || null,
            Number(b.guests) || 1,
            'pending',
          ]
        );
      }

      if (idemKey) {
        run('INSERT INTO idempotency_keys (key, order_id) VALUES (?,?)', [nsIdemKey, inserted.orderId]);
      }

      if (coupon && couponDiscount) {
        run(
          'INSERT OR IGNORE INTO coupon_usages (coupon_id, customer_id, order_id, discount_amount) VALUES (?,?,?,?)',
          [coupon.id, customer.id, inserted.orderId, discountAmount]
        );
      }

      if (pendingRedeem && pendingRedeem.points > 0) {
        applyRedeem(customer.id, pendingRedeem.points, pendingRedeem.discount, inserted.orderId);
      }

      return inserted;
    });

    logActivity(actor, 'create', 'order', orderId, { order_number: orderNumber, total: totalAmount });
    notifyUser(provider.user_id, {
      type: 'order',
      title: '🧾 طلب جديد',
      body: `طلب ${orderNumber} بقيمة ${round2(totalAmount)} دينار — ${cusName || 'عميل المنصة'}`,
      url: '/orders',
    });
    if (agentId) {
      const agentRow = get('SELECT user_id FROM agents WHERE id = ?', [agentId]);
      if (agentRow) {
        notifyUser(agentRow.user_id, {
          type: 'order',
          title: '🧾 طلب جديد في محافظتك',
          body: `طلب ${orderNumber} بقيمة ${round2(totalAmount)} دينار — ${provider.name_ar}`,
          url: '/orders',
        });
      }
    }
    return {
      reused: false,
      result: {
        id: orderId,
        order_number: orderNumber,
        provider_id: provider.id,
        service_id: svcId,
        items: normalizedItems,
        total_amount: totalAmount,
        subtotal_amount: subtotalAmount,
        discount_amount: discountAmount,
        points_discount_amount: pointsDiscountAmount,
        redeemed_points: redeemedPoints,
        coupon_id: coupon ? coupon.id : null,
        coupon_code: coupon ? coupon.code : null,
        commission_amount: commission,
        agent_amount: agentAmount,
        platform_amount: platformAmount,
        provider_amount: providerAmount,
        agent_id: agentId,
        status: 'pending',
        message: 'تم إنشاء الطلب بنجاح، سيقوم مزود الخدمة بالتواصل معكم لإتمام التوصيل (التوصيل مسؤولية المزود)',
      },
    };
  } catch (e: any) {
    if (idemKey && isUniqueViolation(e)) {
      const winner = get('SELECT order_id FROM idempotency_keys WHERE key = ?', [nsIdemKey]);
      if (winner) {
        const existingOrder = get(ORDER_SELECT + ' WHERE o.id = ?', [winner.order_id]);
        if (existingOrder && inOwnershipScope(actor, existingOrder)) return { reused: true, result: decorateOrder(existingOrder) };
      }
    }
    throw e;
  }
}

function updateOrderStatus(actor, rawId, body) {
  const id = toId(rawId);
  const { status, reason } = body || {};
  if (!status) throw new ApiError(400, 'يرجى تحديد الحالة الجديدة');

  const order = get('SELECT * FROM orders WHERE id = ?', [id]);
  if (!order) throw new ApiError(404, 'الطلب غير موجود');

  if (actor.role === 'agent' && order.governorate_id !== actor.governorate_id) throw new ApiError(403, 'لا تملك صلاحية تعديل هذا الطلب');
  if (actor.role === 'provider' && order.provider_id !== actor.provider_id) throw new ApiError(403, 'لا تملك صلاحية تعديل هذا الطلب');
  if (actor.role === 'customer') {
    if (order.customer_id !== actor.id) throw new ApiError(403, 'لا تملك صلاحية تعديل هذا الطلب');
    if (status !== 'cancelled') throw new ApiError(403, 'يمكن للزبون إلغاء الطلب فقط');
    if (!['pending', 'confirmed'].includes(order.status)) {
      throw new ApiError(400, 'لا يمكن إلغاء الطلب بعد بدء تنفيذه');
    }
  }

  if (!ALLOWED_TRANSITIONS[order.status] || !ALLOWED_TRANSITIONS[order.status].includes(status)) {
    throw new ApiError(400, `لا يمكن الانتقال من حالة ${order.status} إلى ${status}`);
  }

  if (status === 'confirmed' && !['provider', 'admin'].includes(actor.role)) {
    throw new ApiError(403, 'قبول الطلب (وخصم العمولة من محفظة المزود) يختص بمزود الخدمة أو المسؤول');
  }

  const rejectReason = status === 'cancelled' && reason ? String(reason).trim() : (status === 'cancelled' ? order.reject_reason : null);

  transaction(() => {
    const history = JSON.parse(order.status_history_json || '[]');
    history.push({ status, at: new Date().toISOString(), by: actor.role, by_name: actor.name_ar, note: rejectReason || undefined });

    const sets = ['status = ?', 'status_history_json = ?', "updated_at = datetime('now')"];
    const params = [status, JSON.stringify(history)];
    if (status === 'confirmed') { sets.push('accepted_at = ?'); params.push(new Date().toISOString()); }
    if (status === 'cancelled') { sets.push('reject_reason = ?'); params.push(rejectReason); }

    let commission = 0;
    let balanceAfter = 0;
    if (status === 'confirmed') {
      commission = round2(Number(order.commission_amount) || 0);
      if (commission > 0) {
        let w = get('SELECT * FROM provider_wallets WHERE provider_id = ?', [order.provider_id]);
        if (!w) {
          run('INSERT OR IGNORE INTO provider_wallets (provider_id, balance) VALUES (?,0)', [order.provider_id]);
          w = get('SELECT * FROM provider_wallets WHERE provider_id = ?', [order.provider_id]);
        }
        if (Number(w.balance) < commission) {
          throw new ApiError(400, `رصيد محفظة المزود غير كافٍ لتغطية عمولة المنصة والوكيل (${commission} دينار) — يجب شحن المحفظة قبل قبول الطلب`);
        }
        balanceAfter = round2(Number(w.balance) - commission);
        const walletUpdated = run(
          "UPDATE provider_wallets SET balance = ?, updated_at = datetime('now') WHERE provider_id = ? AND balance >= ?",
          [balanceAfter, order.provider_id, commission]
        );
        if (walletUpdated.changes === 0) {
          throw new ApiError(400, `رصيد محفظة المزود غير كافٍ لتغطية عمولة المنصة والوكيل (${commission} دينار) — يجب شحن المحفظة قبل قبول الطلب`);
        }
        run(
          'INSERT INTO wallet_transactions (provider_id, type, amount, agent_amount, platform_amount, balance_after, order_id, order_number, note, created_by) VALUES (?,?,?,?,?,?,?,?,?,?)',
          [order.provider_id, 'commission', -commission, Number(order.agent_amount) || 0, Number(order.platform_amount) || 0, balanceAfter, order.id, order.order_number,
            `استقطاع عمولة الطلب ${order.order_number}: حصة الوكيل ${round2(order.agent_amount)} + حصة المنصة ${round2(order.platform_amount)}`,
            actor.name_ar || actor.role]
        );
      }
    }

    const updated = run(
      `UPDATE orders SET ${sets.join(', ')} WHERE id = ? AND status = ?`,
      [...params, id, order.status]
    );
    if (updated.changes === 0) {
      throw new ApiError(409, 'حالة الطلب تغيّرت مؤخراً من جهة أخرى، يرجى إعادة المحاولة');
    }

    if (status === 'cancelled' && (order.accepted_at || order.status !== 'pending')) {
      const ded = get("SELECT * FROM wallet_transactions WHERE order_id = ? AND type = 'commission'", [order.id]);
      if (ded) {
        const refund = Math.abs(Number(ded.amount));
        let w = get('SELECT * FROM provider_wallets WHERE provider_id = ?', [order.provider_id]);
        const balanceAfterR = round2(Number(w ? w.balance : 0) + refund);
        if (w) run("UPDATE provider_wallets SET balance = ?, updated_at = datetime('now') WHERE provider_id = ?", [balanceAfterR, order.provider_id]);
        run(
          'INSERT INTO wallet_transactions (provider_id, type, amount, agent_amount, platform_amount, balance_after, order_id, order_number, note, created_by) VALUES (?,?,?,?,?,?,?,?,?,?)',
          [order.provider_id, 'refund', refund, Number(ded.agent_amount) || 0, Number(ded.platform_amount) || 0, balanceAfterR, order.id, order.order_number,
            `رد عمولة الطلب الملغي ${order.order_number}`,
            actor.name_ar || actor.role]
        );
      }
    }

    if (status === 'cancelled') {
      restoreInventory(order);
    }

    if (status === 'completed' && order.customer_id) {
      const earnPer1000 = settingValue('loyalty_earn_per_1000', 10);
      const earn = Math.floor(Number(order.total_amount) / 1000) * earnPer1000;
      if (earn > 0) {
        awardPoints(order.customer_id, earn, 'earn', 'نقاط ولاء عن الطلب', order.id);
      }
      grantReferralRewards(order);
    }
  });

  logActivity(actor, 'order_status', 'order', id, { order_number: order.order_number, from: order.status, to: status, reason: rejectReason || undefined });

  const statusText = { confirmed: 'تم قبول طلبك', in_progress: 'طلبك قيد التنفيذ', completed: 'اكتمل طلبك', cancelled: 'تم إلغاء الطلب' }[status] || `تغيّرت حالة الطلب إلى ${status}`;
  if (order.customer_id) {
    notifyUser(order.customer_id, {
      type: 'order',
      title: '🔔 تحديث الطلب',
      body: `${statusText} ${order.order_number}`,
      url: `/orders/${id}`,
    });
  }
  if (actor.role !== 'provider' && (status === 'cancelled' || status === 'confirmed' || status === 'in_progress')) {
    const provUser = get('SELECT user_id FROM providers WHERE id = ?', [order.provider_id]);
    if (provUser) {
      notifyUser(provUser.user_id, {
        type: 'order',
        title: status === 'cancelled' ? '❌ إلغاء طلب' : '🔄 تغيّر حالة طلب',
        body: `${order.order_number} — ${statusText}`,
        url: '/orders',
      });
    }
  }

  return decorateOrder(get(ORDER_SELECT + ' WHERE o.id = ?', [id]));
}

module.exports = {
  ORDER_SELECT,
  orderScope,
  inOwnershipScope,
  idempotencyKey,
  decorateOrder,
  decorateOrders,
  buildOrderFilters,
  listOrders,
  getOrderStats,
  getOrderExportTotal,
  getOrderExportRows,
  getOrderById,
  createOrder,
  updateOrderStatus,
};
