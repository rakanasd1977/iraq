const { get, all, run, transaction } = require('../db');
const { ApiError, toId, round2, paginate, settingValue, csvEscape } = require('../utils/helpers');
const { logActivity } = require('../utils/log');
const { notifyProviderFollowers } = require('../utils/push');
const { ensureWallet } = require('../utils/wallet');

const PROMO_PRICE_KEY = 'promo_price';
const PROMO_DURATION_KEY = 'promo_duration_days';
const PROMO_MAX_KEY = 'promo_max_active';

// أنواع كتالوج المزودين القابلة للترويج
const ITEM_TYPES = {
  products: { service: 'stores', table: 'products', titleCol: 'name_ar', priceCol: 'price', imageCol: 'images_json', kind: 'products' },
  menu_items: { service: 'restaurants', table: 'menu_items', titleCol: 'name_ar', priceCol: 'price', imageCol: 'images_json', kind: 'menu' },
  hotel_rooms: { service: 'hotels', table: 'hotel_rooms', titleCol: 'name_ar', priceCol: 'price_per_night', imageCol: 'images_json', kind: 'rooms' },
  flights: { service: 'flights', table: 'flights', titleCol: 'flight_number', priceCol: 'price', imageCol: null, kind: 'flights' },
  travel_packages: { service: 'travel_offices', table: 'travel_packages', titleCol: 'name_ar', priceCol: 'price', imageCol: 'images_json', kind: 'packages' },
};

// مواضع ظهور الإعلان داخل تطبيق الزبون
const PLACEMENTS = new Set(['home_top', 'most_ordered']);
function validPlacement(v) {
  return PLACEMENTS.has(v) ? v : 'home_top';
}
const PLACEMENT_LABELS = { home_top: 'أعلى الصفحة', most_ordered: 'الأكثر طلباً' };

function firstImage(raw) {
  if (!raw) return null;
  let list = raw;
  try { list = JSON.parse(raw); } catch (e: any) { /* نص مفصول بفواصل */ }
  if (Array.isArray(list)) list = list.join(',');
  return String(list).split(',').map((s) => s.trim()).filter(Boolean)[0] || null;
}

function utcFormat(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`;
}

function utcNowPlus(days) {
  return utcFormat(new Date(Date.now() + days * 86400000));
}

// التمديد يُضاف لنهاية المدة الحالية (أو من الآن إذا كانت منتهية) — يضمن دائماً مدة أكبر
function extendEndsAt(currentEndsAt, days) {
  const cur = currentEndsAt ? new Date(String(currentEndsAt).replace(' ', 'T') + 'Z') : null;
  const base = cur && cur > new Date() ? cur : new Date();
  return utcFormat(new Date(base.getTime() + days * 86400000));
}

const activeClause = ` status = 'active' AND (ends_at IS NULL OR ends_at > datetime('now')) `;

function loadItem(def, providerId, itemId) {
  const row = get(`SELECT * FROM ${def.table} WHERE id = ? AND provider_id = ?`, [itemId, providerId]);
  if (!row) throw new ApiError(404, 'العنصر غير موجود أو لا يملكه هذا المزود');
  if (Number(row.is_active) !== 1) throw new ApiError(400, 'لا يمكن الترويج لعنصر غير مفعل');
  return row;
}

function promotionCost(durationDays) {
  const price = settingValue(PROMO_PRICE_KEY, 5000);
  const base = Math.max(1, settingValue(PROMO_DURATION_KEY, 7));
  return round2((price / base) * durationDays);
}

function governorateCache() {
  return new Map(all('SELECT id, name_ar FROM governorates').map((g) => [Number(g.id), g.name_ar]));
}

// إعلان يستهدف كل المحافظات: محافظته التمثيلية هي أقل معرف (للتوافق مع governorate_id NOT NULL)
function representativeGovernorate() {
  return Math.min(...all('SELECT id FROM governorates').map((g) => Number(g.id)));
}

function resolveTargets(body) {
  const target = body && body.target === 'all' ? 'all' : 'governorate';
  let ids = [];
  if (target === 'governorate') {
    const raw = Array.isArray(body && body.governorate_ids) ? body.governorate_ids : [];
    ids = [...new Set(raw.map(Number).filter((n) => Number.isFinite(n) && n > 0))];
    if (ids.length === 0) throw new ApiError(400, 'اختر محافظة واحدة أو أكثر للإعلان');
    const valid = new Set(all('SELECT id FROM governorates').map((g) => Number(g.id)));
    const bad = ids.filter((n) => !valid.has(n));
    if (bad.length) throw new ApiError(400, 'محافظة غير موجودة: ' + bad.join('، '));
  }
  return { targetType: target, governorateIds: ids };
}

function targetCount(targetType, governorateIds) {
  return targetType === 'all' ? all('SELECT COUNT(*) AS c FROM governorates').map((r) => Number(r.c))[0] : governorateIds.length;
}

// إدراج صف الإعلان (يعمل مع أي محاسبة)
function insertPromotionRow({ provider, def, item, durationDays, cost, targetType, governorateIds, billing, endsAt, placement }) {
  const representativeGovId = targetType === 'all' ? representativeGovernorate() : governorateIds[0];
  const idsCsv = targetType === 'all' ? null : [...governorateIds].sort((a, b) => a - b).join(',');
  return run(
    `INSERT INTO promotions (provider_id, service_id, item_type, item_id, item_title, item_price, item_image, item_link,
                             governorate_id, target_type, target_governorate_ids, billing, cost, status, ends_at, placement)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,'active',?,?)`,
    [provider.id, provider.service_id, def.table, item.id, item[def.titleCol], round2(item[def.priceCol]),
     firstImage(item[def.imageCol]), def.kind, representativeGovId, targetType, idsCsv, billing, cost, endsAt, placement || 'home_top']
  ).lastId;
}

// إنشاء إعلان: تُخصم التكلفة من محفظة المزود (wallet) أو إعلان مجاني من المنصة (free)
// التكلفة = سعر الفترة × عدد المحافظات المستهدفة
function createPromotion({ provider, def, item, durationDays, note = '', user, targetType = 'governorate', governorateIds = [], billing = 'wallet', placement = 'home_top' }) {
  const count = targetCount(targetType, governorateIds);
  const unitCost = billing === 'wallet' ? promotionCost(durationDays) : 0;
  const cost = round2(unitCost * count);
  const endsAt = utcNowPlus(durationDays);

  let promoId;
  if (billing === 'wallet') {
    const w = ensureWallet(provider.id);
    if (Number(w.balance) < cost) {
      throw new ApiError(400, `رصيد المحفظة غير كافٍ لدفع تكلفة الترويج (${cost} دينار). اشحن رصيدك أولاً`);
    }
    promoId = transaction(() => {
      const balanceAfter = round2(Number(w.balance) - cost);
      run("UPDATE provider_wallets SET balance = ?, updated_at = datetime('now') WHERE provider_id = ?", [balanceAfter, provider.id]);
      run(
        'INSERT INTO wallet_transactions (provider_id, type, amount, agent_amount, platform_amount, balance_after, note, created_by) VALUES (?,?,?,?,?,?,?,?)',
        [provider.id, 'promotion', -cost, 0, cost, balanceAfter, `ترويج: ${item[def.titleCol]}`, note]
      );
      return insertPromotionRow({ provider, def, item, durationDays, cost, targetType, governorateIds, billing, endsAt, placement });
    });
  } else {
    promoId = insertPromotionRow({ provider, def, item, durationDays, cost, targetType, governorateIds, billing, endsAt, placement });
  }

  logActivity(user, 'promotion_create', 'promotion', promoId, { item_id: item.id, cost, days: durationDays, target_type: targetType, billing });
  return get('SELECT * FROM promotions WHERE id = ?', [promoId]);
}

function targetLabel(row, cache) {
  if (row.target_type === 'all') return 'كل المحافظات';
  const ids = String(row.target_governorate_ids || row.governorate_id).split(',').map((n) => Number(n)).filter(Boolean);
  if (ids.length <= 1) return row.governorate_name_ar;
  return ids.map((id) => cache.get(id) || id).join('، ');
}

function decoratePromotion(row) {
  if (!row) return null;
  const p = get('SELECT name_ar FROM providers WHERE id = ?', [row.provider_id]);
  const g = get('SELECT name_ar, code FROM governorates WHERE id = ?', [row.governorate_id]);
  const s = get('SELECT slug, name_ar, icon FROM services WHERE id = ?', [row.service_id]);
  const impressions = Number(row.impressions) || 0;
  const clicks = Number(row.clicks) || 0;
  const targetType = row.target_type || 'governorate';
  return {
    ...row,
    provider_name: p && p.name_ar,
    governorate_name_ar: targetType === 'all' ? 'كل المحافظات' : (g && g.name_ar),
    governorate_code: g && g.code,
    service_slug: s && s.slug,
    service_name_ar: s && s.name_ar,
    service_icon: s && s.icon,
    ctr: impressions > 0 ? round2((clicks / impressions) * 100) : 0,
    remaining_days: row.ends_at ? Math.max(0, Math.ceil((new Date(String(row.ends_at).replace(' ', 'T') + 'Z').getTime() - Date.now()) / 86400000)) : null,
    target_type: targetType,
    target_count: targetType === 'all' ? all('SELECT COUNT(*) AS c FROM governorates').map((r) => Number(r.c))[0] : (row.target_governorate_ids ? String(row.target_governorate_ids).split(',').length : 1),
    billing: row.billing || 'wallet',
  };
}

const PROMO_SETTINGS = () => ({
  price: settingValue(PROMO_PRICE_KEY, 5000),
  duration_days: Math.max(1, settingValue(PROMO_DURATION_KEY, 7)),
  max_active: Math.max(1, settingValue(PROMO_MAX_KEY, 3)),
});

function buildPromotionFilters(query) {
  const { status, governorate_id, service_id, q, placement } = query || {};
  const where = [];
  const params = [];
  if (status === 'active' || status === 'ended') {
    where.push('pr.status = ?');
    params.push(status);
  }
  if (placement === 'home_top' || placement === 'most_ordered') {
    where.push('pr.placement = ?');
    params.push(placement);
  }
  if (governorate_id) {
    where.push(`(pr.governorate_id = ? OR pr.target_type = 'all'
      OR (pr.target_type = 'governorate' AND (',' || COALESCE(pr.target_governorate_ids, CAST(pr.governorate_id AS TEXT)) || ',') LIKE '%,' || ? || ',%'))`);
    params.push(Number(governorate_id), String(Number(governorate_id)));
  }
  if (service_id) {
    where.push('pr.service_id = ?');
    params.push(Number(service_id));
  }
  const qq = q ? String(q).trim() : '';
  if (qq) {
    where.push('p.name_ar LIKE ?');
    params.push(`%${qq}%`);
  }
  return { whereSql: where.length ? ` WHERE ${where.join(' AND ')}` : '', params };
}

// ============ المزود: إدارة ترويجاته ============
function listProviderPromotions(providerId, query) {
  const pg = paginate({ query }, 20);
  const total = get('SELECT COUNT(*) AS c FROM promotions WHERE provider_id = ?', [providerId]).c;
  const rows = all('SELECT * FROM promotions WHERE provider_id = ? ORDER BY id DESC LIMIT ? OFFSET ?', [providerId, pg.limit, pg.offset]);
  const p = get(
    `SELECT p.governorate_id, g.name_ar AS governorate_name_ar, w.balance
     FROM providers p JOIN governorates g ON g.id = p.governorate_id
     LEFT JOIN provider_wallets w ON w.provider_id = p.id
     WHERE p.id = ?`,
    [providerId]
  );
  const activeCount = get('SELECT COUNT(*) AS c FROM promotions WHERE provider_id = ? AND ' + activeClause, [providerId]).c;
  const totals = get('SELECT COALESCE(SUM(impressions),0) AS impressions, COALESCE(SUM(clicks),0) AS clicks FROM promotions WHERE provider_id = ?', [providerId]);
  const tImp = Number(totals.impressions) || 0;
  const meta = {
    total,
    page: pg.page,
    limit: pg.limit,
    pages: Math.max(1, Math.ceil(total / pg.limit)),
    settings: PROMO_SETTINGS(),
    wallet_balance: round2(p ? p.balance : 0),
    active_count: activeCount,
    impressions: tImp,
    clicks: Number(totals.clicks) || 0,
    ctr: tImp > 0 ? round2((Number(totals.clicks) / tImp) * 100) : 0,
    governorate_name_ar: p ? p.governorate_name_ar : null,
  };
  return { rows: rows.map(decoratePromotion), meta };
}

function createProviderPromotion(user, body) {
  const { item_type, item_id, duration_days } = body || {};
  const def = ITEM_TYPES[item_type];
  if (!def) throw new ApiError(400, 'نوع العنصر غير صحيح');

  const provider = get('SELECT p.*, s.slug AS service_slug FROM providers p JOIN services s ON s.id = p.service_id WHERE p.id = ?', [user.provider_id]);
  if (def.service !== provider.service_slug) throw new ApiError(403, 'نوع العنصر لا يخص نوع خدمتك');
  const duration = Math.max(1, Math.min(90, Number(duration_days) || settingValue(PROMO_DURATION_KEY, 7)));
  const maxActive = Math.max(1, settingValue(PROMO_MAX_KEY, 3));
  const activeCount = get('SELECT COUNT(*) AS c FROM promotions WHERE provider_id = ? AND ' + activeClause, [provider.id]).c;
  if (activeCount >= maxActive) {
    throw new ApiError(400, `وصلت إلى الحد الأقصى من الترويجات النشطة (${maxActive}). أنهِ أحدها أو انتظر انتهاءه`);
  }

  const item = loadItem(def, provider.id, toId(item_id));
  const promo = createPromotion({
    provider, def, item, durationDays: duration,
    note: `ترويج ${provider.name_ar}`, user,
    targetType: 'governorate', governorateIds: [provider.governorate_id], billing: 'wallet',
  });
  // إشعار متابعي المزود بعرض ترويجي جديد
  const promoLink =
    def.kind === 'products' || def.kind === 'menu' || def.kind === 'packages'
      ? `/item/${provider.id}/${def.kind}/${item.id}`
      : `/provider/${provider.id}/${def.kind}`;
  notifyProviderFollowers(provider.id, {
    type: 'offer',
    title: `عرض جديد من ${provider.name_ar}`,
    body: `خصم وترويج: ${promo.item_title} بسعر ${promo.item_price} د.ع`,
    url: promoLink,
    icon: '🔥',
  }).catch(() => {});
  return decoratePromotion(promo);
}

function extendProviderPromotion(user, id) {
  const row = get('SELECT * FROM promotions WHERE id = ? AND provider_id = ?', [id, user.provider_id]);
  if (!row) throw new ApiError(404, 'الترويج غير موجود');
  if (row.status !== 'active') throw new ApiError(400, 'يمكن تمديد الترويج النشط فقط');

  const def = ITEM_TYPES[row.item_type];
  if (!def) throw new ApiError(400, 'نوع العنصر غير مدعوم');
  const provider = get('SELECT * FROM providers WHERE id = ?', [user.provider_id]);
  const days = Math.max(1, settingValue(PROMO_DURATION_KEY, 7));
  const isFree = (row.billing || 'wallet') === 'free';
  let cost = 0;

  if (!isFree) {
    cost = promotionCost(days);
    const w = ensureWallet(provider.id);
    if (Number(w.balance) < cost) throw new ApiError(400, `رصيد المحفظة غير كافٍ للتمديد (${cost} دينار)`);

    transaction(() => {
      const balanceAfter = round2(Number(w.balance) - cost);
      run("UPDATE provider_wallets SET balance = ?, updated_at = datetime('now') WHERE provider_id = ?", [balanceAfter, provider.id]);
      run(
        'INSERT INTO wallet_transactions (provider_id, type, amount, agent_amount, platform_amount, balance_after, note, created_by) VALUES (?,?,?,?,?,?,?,?)',
        [provider.id, 'promotion', -cost, 0, cost, balanceAfter, `تمديد ترويج: ${row.item_title}`, user.name_ar || user.email]
      );
      run("UPDATE promotions SET ends_at = ?, updated_at = datetime('now') WHERE id = ?", [extendEndsAt(row.ends_at, days), id]);
    });
  } else {
    run("UPDATE promotions SET ends_at = ?, updated_at = datetime('now') WHERE id = ?", [extendEndsAt(row.ends_at, days), id]);
  }

  logActivity(user, 'promotion_extend', 'promotion', id, { cost, days });
  return decoratePromotion(get('SELECT * FROM promotions WHERE id = ?', [id]));
}

function endPromotion(user, id) {
  const scope = user.role === 'admin' ? '1=1' : 'provider_id = ?';
  const params = user.role === 'admin' ? [id] : [id, user.provider_id];
  const row = get(`SELECT * FROM promotions WHERE id = ? AND ${scope}`, params);
  if (!row) throw new ApiError(404, 'الترويج غير موجود');
  run("UPDATE promotions SET status = 'ended', updated_at = datetime('now') WHERE id = ?", [id]);
  logActivity(user, 'promotion_end', 'promotion', id, {});
  return { id, status: 'ended' };
}

// ============ المسؤول ============
function listAdminItems(providerId, itemType) {
  const def = ITEM_TYPES[itemType];
  if (!def) throw new ApiError(400, 'نوع العنصر غير صحيح');
  const provider = get('SELECT id FROM providers WHERE id = ?', [providerId]);
  if (!provider) throw new ApiError(404, 'مزود الخدمة غير موجود');
  const rows = all(
    `SELECT id, ${def.titleCol} AS title, ${def.priceCol} AS price, ${def.imageCol ? `${def.imageCol} AS images_json` : 'NULL AS images_json'}
     FROM ${def.table} WHERE provider_id = ? AND is_active = 1 ORDER BY id ASC`,
    [providerId]
  );
  return rows.map((r) => ({ id: r.id, title: r.title, price: round2(r.price), image: firstImage(r.images_json) }));
}

function createAdminPromotion(user, body) {
  const { provider_id, item_type, item_id, duration_days, billing, placement } = body || {};
  const def = ITEM_TYPES[item_type];
  if (!def) throw new ApiError(400, 'نوع العنصر غير صحيح');
  const provider = get('SELECT p.*, s.slug AS service_slug FROM providers p JOIN services s ON s.id = p.service_id WHERE p.id = ?', [toId(provider_id)]);
  if (!provider) throw new ApiError(404, 'مزود الخدمة غير موجود');
  if (Number(provider.is_active) !== 1) throw new ApiError(400, 'لا يمكن إنشاء إعلان لمزود موقوف');

  const duration = Math.max(1, Math.min(90, Number(duration_days) || settingValue(PROMO_DURATION_KEY, 7)));
  const { targetType, governorateIds } = resolveTargets(body);
  const b = billing === 'free' ? 'free' : 'wallet';
  const item = loadItem(def, provider.id, toId(item_id));
  const promo = createPromotion({
    provider, def, item, durationDays: duration,
    note: `إعلان من الإدارة: ${provider.name_ar}`, user,
    targetType, governorateIds, billing: b, placement: validPlacement(placement),
  });
  return decoratePromotion(promo);
}

function listAllPromotions(query) {
  const pg = paginate({ query }, 20);
  const { whereSql, params } = buildPromotionFilters(query);
  const total = get(`SELECT COUNT(*) AS c FROM promotions pr JOIN providers p ON p.id = pr.provider_id${whereSql}`, params).c;
  const rows = all(
    `SELECT pr.*, p.name_ar AS provider_name, g.name_ar AS governorate_name_ar, g.code AS governorate_code,
            s.slug AS service_slug, s.name_ar AS service_name_ar, s.icon AS service_icon
     FROM promotions pr
     JOIN providers p ON p.id = pr.provider_id
     JOIN governorates g ON g.id = pr.governorate_id
     JOIN services s ON s.id = pr.service_id
     ${whereSql}
     ORDER BY pr.id DESC LIMIT ? OFFSET ?`,
    [...params, pg.limit, pg.offset]
  );
  const stats = {
    total_active: get("SELECT COUNT(*) AS c FROM promotions WHERE status = 'active'").c,
    total_ended: get("SELECT COUNT(*) AS c FROM promotions WHERE status = 'ended'").c,
    active_revenue: round2(get("SELECT COALESCE(SUM(cost),0) AS v FROM promotions WHERE status = 'active'").v),
    total_revenue: round2(get('SELECT COALESCE(SUM(cost),0) AS v FROM promotions').v),
    total_impressions: get('SELECT COALESCE(SUM(impressions),0) AS v FROM promotions').v,
    total_clicks: get('SELECT COALESCE(SUM(clicks),0) AS v FROM promotions').v,
  };
  const imp = Number(stats.total_impressions) || 0;
  stats.total_ctr = imp > 0 ? round2((Number(stats.total_clicks) / imp) * 100) : 0;
  const cache = governorateCache();
  rows.forEach((r) => {
    const ri = Number(r.impressions) || 0;
    r.ctr = ri > 0 ? round2((Number(r.clicks) / ri) * 100) : 0;
    r.target_label = targetLabel(r, cache);
    r.target_count = r.target_type === 'all'
      ? all('SELECT COUNT(*) AS c FROM governorates').map((x) => Number(x.c))[0]
      : (r.target_governorate_ids ? String(r.target_governorate_ids).split(',').length : 1);
    if (r.target_type === 'all') r.governorate_name_ar = 'كل المحافظات';
  });
  const meta = {
    total,
    page: pg.page,
    limit: pg.limit,
    pages: Math.max(1, Math.ceil(total / pg.limit)),
    ...stats,
    settings: PROMO_SETTINGS(),
  };
  return { rows, meta };
}

function queryAllPromotionRows(query, limit, offset) {
  const { whereSql, params } = buildPromotionFilters(query);
  return all(
    `SELECT pr.*, p.name_ar AS provider_name, g.name_ar AS governorate_name_ar,
            s.name_ar AS service_name_ar
     FROM promotions pr
     JOIN providers p ON p.id = pr.provider_id
     JOIN governorates g ON g.id = pr.governorate_id
     JOIN services s ON s.id = pr.service_id
     ${whereSql}
     ORDER BY pr.id DESC LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );
}

// ============ عام (public) ============
function listPublicPromotions(query) {
  const { governorate_code, governorate_id, placement } = query || {};
  const limit = Math.min(30, Math.max(1, Number(query && query.limit) || 10));
  let sql = `SELECT pr.*, p.name_ar AS provider_name, g.code AS governorate_code,
                     s.slug AS service_slug, s.name_ar AS service_name_ar, s.icon AS service_icon
              FROM promotions pr
              JOIN providers p ON p.id = pr.provider_id
              LEFT JOIN governorates g ON g.id = pr.governorate_id
              JOIN services s ON s.id = pr.service_id
              WHERE pr.status = 'active' AND (pr.ends_at IS NULL OR pr.ends_at > datetime('now'))`;
  const params = [];
  sql += ' AND pr.placement = ?';
  params.push(validPlacement(placement));
  let govId = null;
  if (governorate_code) {
    const g = get('SELECT id FROM governorates WHERE code = ?', [String(governorate_code).toUpperCase()]);
    govId = g && g.id;
  } else if (governorate_id) {
    govId = Number(governorate_id) || null;
  }
  if (govId) {
    sql += ` AND (pr.target_type = 'all'
      OR (pr.target_type = 'governorate' AND (',' || COALESCE(pr.target_governorate_ids, CAST(pr.governorate_id AS TEXT)) || ',') LIKE '%,' || ? || ',%'))`;
    params.push(String(govId));
  }
  sql += ' ORDER BY pr.id DESC LIMIT ?';
  params.push(limit);
  const rows = all(sql, params);
  for (const r of rows) run('UPDATE promotions SET impressions = impressions + 1 WHERE id = ?', [r.id]);
  return rows;
}

function clickPromotion(id) {
  const promo = get('SELECT id FROM promotions WHERE id = ? AND ' + activeClause, [id]);
  if (!promo) throw new ApiError(404, 'الترويج غير موجود أو غير نشط');
  run('UPDATE promotions SET clicks = clicks + 1, updated_at = datetime(\'now\') WHERE id = ?', [id]);
  return { id };
}

module.exports = {
  ITEM_TYPES,
  firstImage,
  activeClause,
  decoratePromotion,
  governorateCache,
  targetLabel,
  buildPromotionFilters,
  listProviderPromotions,
  createProviderPromotion,
  extendProviderPromotion,
  endPromotion,
  listAdminItems,
  createAdminPromotion,
  listAllPromotions,
  queryAllPromotionRows,
  listPublicPromotions,
  clickPromotion,
  csvEscape,
};
