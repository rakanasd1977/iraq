const { get, all, run, transaction } = require('../db');
const { ApiError, nextLeasePeriod, round2, paginate, parseDateRange, isAgentLeaseActive } = require('../utils/helpers');
const { logActivity } = require('../utils/log');
const { notifyUser, notifyRole } = require('../utils/push');

function resolveAgent(user) {
  if (!user.agent_id) throw new ApiError(403, 'حساب الوكيل غير مكتمل');
  const agent = get('SELECT * FROM agents WHERE id = ?', [user.agent_id]);
  return agent;
}

function resolveActiveAgent(user) {
  const agent = resolveAgent(user);
  if (!isAgentLeaseActive(agent)) throw new ApiError(403, 'إجارة الوكالة منتهية أو قيد الموافقة — لا يمكن تنفيذ هذا الإجراء');
  return agent;
}

function monthKeyUtc(d) {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}
function lastMonthsUtc(n) {
  const arr = [];
  const now = new Date();
  for (let i = n - 1; i >= 0; i--) {
    arr.push(monthKeyUtc(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1))));
  }
  return arr;
}

// رصيد الوكيل: أرباح الطلبات المكتملة في محافظته ناقص السحوبات المعتمدة/القيدية
function agentWallet(agent) {
  const earned = Number(get(
    `SELECT COALESCE(SUM(o.agent_amount),0) AS v FROM orders o
     JOIN providers p ON p.id = o.provider_id
     WHERE p.governorate_id = ? AND o.status = 'completed'`,
    [agent.governorate_id]
  ).v) || 0;
  const pendingEarn = Number(get(
    `SELECT COALESCE(SUM(o.agent_amount),0) AS v FROM orders o
     JOIN providers p ON p.id = o.provider_id
     WHERE p.governorate_id = ? AND o.status != 'cancelled' AND o.status != 'completed'`,
    [agent.governorate_id]
  ).v) || 0;
  const approved = Number(get(
    `SELECT COALESCE(SUM(amount),0) AS v FROM agent_withdrawals WHERE agent_id = ? AND status = 'approved'`,
    [agent.id]
  ).v) || 0;
  const pending = Number(get(
    `SELECT COALESCE(SUM(amount),0) AS v FROM agent_withdrawals WHERE agent_id = ? AND status = 'pending'`,
    [agent.id]
  ).v) || 0;
  return {
    total_earned: round2(earned),
    pending_orders_commission: round2(pendingEarn),
    approved_withdrawals: round2(approved),
    pending_withdrawals: round2(pending),
    available: round2(earned - approved - pending),
  };
}

function buildCustomersUnion(agent) {
  return `(
    SELECT cu.id AS id, cu.name_ar AS name, cu.phone AS phone, cu.email AS email, cu.created_at AS registered_at,
           COUNT(o.id) AS orders_count,
           COALESCE(SUM(CASE WHEN o.status != 'cancelled' THEN o.total_amount ELSE 0 END),0) AS total_value,
           MAX(o.created_at) AS last_order_at,
           SUM(CASE WHEN o.status = 'pending' THEN 1 ELSE 0 END) AS pending_count
    FROM users cu
    JOIN orders o ON o.customer_id = cu.id
    JOIN providers p ON p.id = o.provider_id
    WHERE p.governorate_id = ?
    GROUP BY cu.id
    UNION ALL
    SELECT NULL AS id, COALESCE(NULLIF(MAX(o.customer_name),''), 'زبون مباشر') AS name,
           o.customer_phone AS phone, NULL AS email, NULL AS registered_at,
           COUNT(o.id) AS orders_count,
           COALESCE(SUM(CASE WHEN o.status != 'cancelled' THEN o.total_amount ELSE 0 END),0) AS total_value,
           MAX(o.created_at) AS last_order_at,
           SUM(CASE WHEN o.status = 'pending' THEN 1 ELSE 0 END) AS pending_count
    FROM orders o JOIN providers p ON p.id = o.provider_id
    WHERE p.governorate_id = ? AND o.customer_id IS NULL
      AND (TRIM(COALESCE(o.customer_name,'')) != '' OR o.customer_phone IS NOT NULL)
    GROUP BY o.customer_name, o.customer_phone
  )`;
}

// ============ الإجارة ============
function getLease(user) {
  const agent = resolveAgent(user);
  const gov = get('SELECT * FROM governorates WHERE id = ?', [agent.governorate_id]);
  const district = agent.district_id ? get('SELECT * FROM districts WHERE id = ?', [agent.district_id]) : null;

  const now = new Date();
  const isExpired = !agent.lease_expires_at || new Date(agent.lease_expires_at) <= now;
  const derivedStatus = agent.lease_status === 'pending' && !isExpired ? 'active' : agent.lease_status;

  const payments = all(
    'SELECT * FROM lease_payments WHERE agent_id = ? ORDER BY id DESC LIMIT 10',
    [agent.id]
  );

  return {
    agent_id: agent.id,
    governorate_id: gov.id,
    governorate_name_ar: gov.name_ar,
    governorate_code: gov.code,
    district_id: agent.district_id || null,
    district_name_ar: district ? district.name_ar : null,
    lease_fee: district ? district.lease_fee : gov.lease_fee,
    commission_rate: agent.commission_rate,
    lease_status: isExpired ? 'expired' : derivedStatus,
    lease_expires_at: agent.lease_expires_at,
    next_due_date: agent.lease_expires_at,
    is_expired: isExpired,
    payments,
  };
}

function renewLease(user) {
  const agent = resolveAgent(user);
  const gov = get('SELECT * FROM governorates WHERE id = ?', [agent.governorate_id]);
  const district = agent.district_id ? get('SELECT * FROM districts WHERE id = ?', [agent.district_id]) : null;

  const existingPending = get("SELECT id FROM lease_payments WHERE agent_id = ? AND status = 'pending'", [agent.id]);
  if (existingPending) throw new ApiError(400, 'يوجد طلب تجديد قيد الانتظار، بانتظار موافقة المسؤول');

  const { start, end } = nextLeasePeriod(agent.lease_expires_at);
  const amount = district ? district.lease_fee : gov.lease_fee;

  let payId;
  transaction(() => {
    payId = run(
      'INSERT INTO lease_payments (agent_id, governorate_id, district_id, amount, period_start, period_end, status, notes) VALUES (?,?,?,?,?,?,?,?)',
      [agent.id, gov.id, agent.district_id || null, amount, start.toISOString(), end.toISOString(), 'pending', 'طلب تجديد من الوكيل']
    ).lastId;

    run('UPDATE agents SET lease_status = ?, updated_at = datetime(\'now\') WHERE id = ?', ['pending', agent.id]);
  });
  logActivity(user, 'request_lease_renewal', 'agent', agent.id, {
    payment_id: payId, amount, period_start: start.toISOString(), period_end: end.toISOString(),
  });

  return {
    lease_payment_id: payId,
    amount,
    period_start: start.toISOString(),
    period_end: end.toISOString(),
    status: 'pending',
    message: `تم إرسال طلب تجديد إجارة وكالة محافظة ${gov.name_ar} بمبلغ ${amount} دينار، بانتظار موافقة المسؤول`,
  };
}

// ============ العمولات ============
function getCommissions(user) {
  const agent = resolveAgent(user);

  const summary = get(
    `SELECT COUNT(*) AS orders_count,
            COALESCE(SUM(o.total_amount),0) AS orders_value,
            COALESCE(SUM(o.agent_amount),0) AS total_commission
     FROM orders o
     JOIN providers p ON p.id = o.provider_id
     WHERE p.governorate_id = ? AND o.status != 'cancelled'`,
    [agent.governorate_id]
  );

  const monthly = all(
    `SELECT strftime('%Y-%m', o.created_at) AS month,
            COUNT(*) AS orders_count,
            COALESCE(SUM(o.agent_amount),0) AS commission
     FROM orders o
     JOIN providers p ON p.id = o.provider_id
     WHERE p.governorate_id = ? AND o.status != 'cancelled'
     GROUP BY month ORDER BY month DESC LIMIT 6`,
    [agent.governorate_id]
  );

  const topProviders = all(
    `SELECT p.id, p.name_ar, COUNT(o.id) AS orders_count, COALESCE(SUM(o.agent_amount),0) AS commission
     FROM orders o
     JOIN providers p ON p.id = o.provider_id
     WHERE p.governorate_id = ? AND o.status != 'cancelled'
     GROUP BY p.id ORDER BY commission DESC LIMIT 5`,
    [agent.governorate_id]
  );

  return {
    commission_rate: agent.commission_rate,
    summary: {
      orders_count: summary.orders_count,
      orders_value: round2(summary.orders_value),
      total_commission: round2(summary.total_commission),
    },
    monthly,
    top_providers: topProviders,
  };
}

// ============ لوحة المعلومات ============
function getDashboard(user) {
  const agent = resolveAgent(user);
  const gov = get('SELECT * FROM governorates WHERE id = ?', [agent.governorate_id]);

  const providers = get('SELECT COUNT(*) AS c FROM providers WHERE governorate_id = ?', [gov.id]).c;
  const activeProviders = get('SELECT COUNT(*) AS c FROM providers WHERE governorate_id = ? AND is_active = 1', [gov.id]).c;

  const orders = get(
    `SELECT COUNT(*) AS c, COALESCE(SUM(o.total_amount),0) AS value, COALESCE(SUM(o.platform_amount),0) AS platform_revenue,
            COALESCE(SUM(o.agent_amount),0) AS agent_revenue
     FROM orders o JOIN providers p ON p.id = o.provider_id WHERE p.governorate_id = ? AND o.status != 'cancelled'`,
    [gov.id]
  );

  const byStatus = all(
    `SELECT o.status, COUNT(*) AS count FROM orders o
     JOIN providers p ON p.id = o.provider_id
     WHERE p.governorate_id = ? GROUP BY o.status`,
    [gov.id]
  );

  const byService = all(
    `SELECT s.id, s.slug, s.name_ar, s.icon, COUNT(p.id) AS providers_count
     FROM services s
     LEFT JOIN providers p ON p.service_id = s.id AND p.governorate_id = ?
     GROUP BY s.id ORDER BY s.sort_order ASC`,
    [gov.id]
  );

  const recentOrders = all(
    `SELECT o.order_number, o.status, o.total_amount, o.created_at, p.name_ar AS provider_name, o.customer_name
     FROM orders o JOIN providers p ON p.id = o.provider_id
     WHERE p.governorate_id = ?
     ORDER BY o.id DESC LIMIT 10`,
    [gov.id]
  );

  const monthlyRows = all(
    `SELECT strftime('%Y-%m', o.created_at) AS month,
            COUNT(*) AS orders_count,
            COALESCE(SUM(o.total_amount),0) AS orders_value,
            COALESCE(SUM(o.agent_amount),0) AS commission
     FROM orders o JOIN providers p ON p.id = o.provider_id
     WHERE p.governorate_id = ? AND o.status != 'cancelled'
       AND o.created_at >= datetime('now', '-11 months', 'start of month')
     GROUP BY month ORDER BY month ASC`,
    [gov.id]
  );
  const monthlyMap = new Map(monthlyRows.map((m) => [m.month, m]));
  const monthly = lastMonthsUtc(12).map((m) => {
    const r = monthlyMap.get(m);
    return {
      month: m,
      orders_count: r ? r.orders_count : 0,
      orders_value: r ? round2(r.orders_value) : 0,
      commission: r ? round2(r.commission) : 0,
    };
  });

  const topCustomers = all(
    `SELECT COALESCE(cu.name_ar, o.customer_name, 'زبون مباشر') AS name,
            o.customer_phone AS phone,
            COUNT(o.id) AS orders_count,
            COALESCE(SUM(CASE WHEN o.status != 'cancelled' THEN o.total_amount ELSE 0 END),0) AS total_value
     FROM orders o
     LEFT JOIN users cu ON cu.id = o.customer_id
     JOIN providers p ON p.id = o.provider_id
     WHERE p.governorate_id = ?
     GROUP BY o.customer_id, o.customer_name, o.customer_phone
     ORDER BY total_value DESC LIMIT 5`,
    [gov.id]
  );

  const stalePending = get(
    `SELECT COUNT(*) AS c FROM orders o JOIN providers p ON p.id = o.provider_id
     WHERE p.governorate_id = ? AND o.status = 'pending' AND datetime(o.created_at) <= datetime('now', '-48 hours')`,
    [gov.id]
  ).c;
  const inactiveProviders = get('SELECT COUNT(*) AS c FROM providers WHERE governorate_id = ? AND is_active = 0', [gov.id]).c;
  const idleProviders = get(
    `SELECT COUNT(*) AS c FROM providers p WHERE p.governorate_id = ?
     AND NOT EXISTS (SELECT 1 FROM orders o WHERE o.provider_id = p.id AND o.status != 'cancelled'
                    AND o.created_at >= datetime('now', '-30 days'))`,
    [gov.id]
  ).c;
  const pendingVerifications = get("SELECT COUNT(*) AS c FROM providers WHERE governorate_id = ? AND verification_status = 'pending'", [gov.id]).c;
  const pendingWithdrawals = get("SELECT COUNT(*) AS c FROM agent_withdrawals WHERE agent_id = ? AND status = 'pending'", [agent.id]).c;
  const daysToLeaseEnd = agent.lease_expires_at ? Math.ceil((new Date(agent.lease_expires_at).getTime() - Date.now()) / 86400000) : null;
  const isLeaseExpired = !agent.lease_expires_at || new Date(agent.lease_expires_at) <= new Date();

  const lapsedCustomers = get(
    `SELECT COUNT(*) AS c FROM (
       SELECT o.customer_id FROM orders o JOIN providers p ON p.id = o.provider_id
       WHERE p.governorate_id = ? AND o.customer_id IS NOT NULL
       GROUP BY o.customer_id HAVING MAX(o.created_at) < datetime('now', '-30 days')
     ) t`,
    [gov.id]
  ).c;

  const attention = [];
  if (stalePending > 0) attention.push({ key: 'stale_pending', icon: '⏰', tone: 'warn', label: `${stalePending} طلباً قيد الانتظار منذ أكثر من يومين`, url: '/orders?status=pending' });
  if (inactiveProviders > 0) attention.push({ key: 'inactive_providers', icon: '⛔', tone: 'warn', label: `${inactiveProviders} مزوداً متوقفاً عن العمل`, url: '/providers' });
  if (idleProviders > 0) attention.push({ key: 'idle_providers', icon: '💤', tone: 'info', label: `${idleProviders} مزوداً بلا طلبات خلال آخر 30 يوماً`, url: '/providers' });
  if (pendingVerifications > 0) attention.push({ key: 'pending_verifications', icon: '📄', tone: 'info', label: `${pendingVerifications} مزوداً بانتظار مراجعة التوثيق`, url: '/providers' });
  if (pendingWithdrawals > 0) attention.push({ key: 'pending_withdrawals', icon: '💰', tone: 'info', label: `${pendingWithdrawals} طلب سحب بانتظار موافقة المسؤول`, url: '/wallet' });
  if (lapsedCustomers > 0) attention.push({ key: 'lapsed_customers', icon: '🔄', tone: 'info', label: `${lapsedCustomers} زبوناً مسجلاً توقفوا عن الطلب منذ أكثر من 30 يوماً`, url: '/customers?lapsed=1' });
  if (!isLeaseExpired && daysToLeaseEnd !== null && daysToLeaseEnd <= 30) attention.push({ key: 'lease_expiring', icon: '📜', tone: 'warn', label: `إجارة وكالتك تنتهي خلال ${daysToLeaseEnd} يوماً`, url: '/lease' });
  if (isLeaseExpired) attention.push({ key: 'lease_expired', icon: '🚨', tone: 'danger', label: 'إجارة وكالتك منتهية — جددها الآن', url: '/lease' });

  const ordersByService = all(
    `SELECT s.id, s.slug, s.name_ar, s.icon, COUNT(o.id) AS orders_count,
            COALESCE(SUM(o.total_amount),0) AS orders_value
     FROM services s
     LEFT JOIN (SELECT o.* FROM orders o JOIN providers p ON p.id = o.provider_id WHERE p.governorate_id = ?) o ON o.service_id = s.id
     GROUP BY s.id ORDER BY s.sort_order ASC`,
    [gov.id]
  ).map((r) => ({ ...r, orders_value: round2(r.orders_value) }));

  return {
    governorate_name_ar: gov.name_ar,
    lease_status: agent.lease_status,
    lease_expires_at: agent.lease_expires_at,
    providers_count: providers,
    active_providers_count: activeProviders,
    orders_count: orders.c,
    orders_value: round2(orders.value),
    platform_revenue: round2(orders.platform_revenue),
    agent_revenue: round2(orders.agent_revenue),
    orders_by_status: byStatus,
    providers_by_service: byService,
    orders_by_service: ordersByService,
    recent_orders: recentOrders,
    monthly,
    top_customers: topCustomers,
    lapsed_customers: lapsedCustomers,
    attention,
  };
}

function getDashboardExportData(user) {
  const agent = resolveAgent(user);
  const gov = get('SELECT * FROM governorates WHERE id = ?', [agent.governorate_id]);

  const orders = get(
    `SELECT COUNT(*) AS c, COALESCE(SUM(o.total_amount),0) AS value, COALESCE(SUM(o.platform_amount),0) AS platform_revenue,
            COALESCE(SUM(o.agent_amount),0) AS agent_revenue
     FROM orders o JOIN providers p ON p.id = o.provider_id WHERE p.governorate_id = ? AND o.status != 'cancelled'`,
    [gov.id]
  );
  const byStatus = all(
    `SELECT o.status, COUNT(*) AS count FROM orders o
     JOIN providers p ON p.id = o.provider_id
     WHERE p.governorate_id = ? GROUP BY o.status`,
    [gov.id]
  );
  const byService = all(
    `SELECT s.id, s.slug, s.name_ar, s.icon, COUNT(p.id) AS providers_count
     FROM services s
     LEFT JOIN providers p ON p.service_id = s.id AND p.governorate_id = ?
     GROUP BY s.id ORDER BY s.sort_order ASC`,
    [gov.id]
  );
  const monthly = all(
    `SELECT strftime('%Y-%m', o.created_at) AS month,
            COUNT(*) AS orders_count,
            COALESCE(SUM(o.total_amount),0) AS orders_value,
            COALESCE(SUM(o.agent_amount),0) AS commission
     FROM orders o JOIN providers p ON p.id = o.provider_id
     WHERE p.governorate_id = ? AND o.status != 'cancelled'
       AND o.created_at >= datetime('now', '-11 months', 'start of month')
     GROUP BY month ORDER BY month ASC`,
    [gov.id]
  );
  const topCustomers = all(
    `SELECT COALESCE(cu.name_ar, o.customer_name, 'زبون مباشر') AS name,
            o.customer_phone AS phone,
            COUNT(o.id) AS orders_count,
            COALESCE(SUM(CASE WHEN o.status != 'cancelled' THEN o.total_amount ELSE 0 END),0) AS total_value
     FROM orders o
     LEFT JOIN users cu ON cu.id = o.customer_id
     JOIN providers p ON p.id = o.provider_id
     WHERE p.governorate_id = ?
     GROUP BY o.customer_id, o.customer_name, o.customer_phone
     ORDER BY total_value DESC LIMIT 5`,
    [gov.id]
  );
  return { gov, orders, byStatus, byService, monthly, topCustomers };
}

// ============ الزبائن ============
function listCustomers(user, query) {
  const agent = resolveAgent(user);
  const q = String((query && query.q) || '').trim();

  const union = buildCustomersUnion(agent);
  const baseParams = [agent.governorate_id, agent.governorate_id];
  const whereParts = [];
  const searchParams = [];
  if (q) { whereParts.push('name LIKE ? OR phone LIKE ? OR (email IS NOT NULL AND email LIKE ?)'); searchParams.push(`%${q}%`, `%${q}%`, `%${q}%`); }
  if (String((query && query.lapsed) || '') === '1') {
    whereParts.push("last_order_at IS NOT NULL AND last_order_at < datetime('now', '-30 days')");
  }
  const where = whereParts.length ? 'WHERE ' + whereParts.join(' AND ') : '';

  const pg = paginate({ query }, 20);
  const total = get(`SELECT COUNT(*) AS c FROM ${union} ${where}`, [...baseParams, ...searchParams]).c;
  const rows = all(
    `SELECT * FROM ${union} ${where} ORDER BY total_value DESC, orders_count DESC, last_order_at DESC LIMIT ? OFFSET ?`,
    [...baseParams, ...searchParams, pg.limit, pg.offset]
  );

  return {
    rows: rows.map((r) => ({
      ...r,
      total_value: round2(r.total_value),
      phone: r.phone || '',
      email: r.email || '',
    })),
    meta: { total, page: pg.page, limit: pg.limit, pages: Math.max(1, Math.ceil(total / pg.limit)) },
  };
}

function getCustomersExportRows(user, query) {
  const agent = resolveAgent(user);
  const q = String((query && query.q) || '').trim();
  const union = buildCustomersUnion(agent);
  const where = q ? 'WHERE name LIKE ? OR phone LIKE ? OR (email IS NOT NULL AND email LIKE ?)' : '';
  const searchParams = q ? [`%${q}%`, `%${q}%`, `%${q}%`] : [];
  return all(`SELECT * FROM ${union} ${where} ORDER BY total_value DESC, orders_count DESC`, [agent.governorate_id, agent.governorate_id, ...searchParams]);
}

// ============ المحفظة ============
function getWallet(user) {
  const agent = resolveAgent(user);

  const income = all(
    `SELECT o.id, o.order_number, o.agent_amount, o.created_at, p.name_ar AS provider_name
     FROM orders o JOIN providers p ON p.id = o.provider_id
     WHERE p.governorate_id = ? AND o.status = 'completed'
     ORDER BY o.id DESC LIMIT 10`,
    [agent.governorate_id]
  );
  const withdrawals = all(
    'SELECT * FROM agent_withdrawals WHERE agent_id = ? ORDER BY id DESC LIMIT 10',
    [agent.id]
  );

  return {
    commission_rate: agent.commission_rate,
    balance: agentWallet(agent),
    income,
    withdrawals,
  };
}

function requestWithdrawal(user, body) {
  const agent = resolveAgent(user);

  const amount = Number(body && body.amount);
  if (!Number.isFinite(amount) || amount <= 0) throw new ApiError(400, 'مبلغ السحب غير صالح');
  if (!Number.isInteger(amount) || amount < 1000) throw new ApiError(400, 'أقل مبلغ للسحب 1000 دينار');

  const { available } = agentWallet(agent);
  if (amount > available) throw new ApiError(400, `الرصيد المتاح ${round2(available)} دينار لا يكفي لطلب السحب`);

  const notes = String((body && body.notes) || '').slice(0, 300);
  const wid = run(
    'INSERT INTO agent_withdrawals (agent_id, amount, notes) VALUES (?,?,?)',
    [agent.id, amount, notes || null]
  ).lastId;

  logActivity(user, 'agent_withdrawal_request', 'agent', agent.id, { withdrawal_id: wid, amount });

  notifyRole('admin', {
    type: 'withdrawal_request',
    title: 'طلب سحب جديد 💸',
    body: `الوكيل «${agent.name_ar || agent.user_id}» طلب سحب ${amount} دينار.`,
    url: '/agent-withdrawals',
    icon: '💸',
  });

  return get('SELECT * FROM agent_withdrawals WHERE id = ?', [wid]);
}

function getCommissionExportRows(user, query) {
  const agent = resolveAgent(user);
  const status = String((query && query.status) || '').trim();

  const conditions = ['p.governorate_id = ?', "o.status != 'cancelled'"];
  const params = [agent.governorate_id];
  if (status) { conditions.push('o.status = ?'); params.push(status); }
  const where = conditions.join(' AND ');

  return all(
    `SELECT o.order_number, o.created_at, o.total_amount, o.commission_amount, o.agent_amount, o.platform_amount, o.status,
            p.name_ar AS provider_name, p.commission_rate, s.name_ar AS service_name, o.customer_name
     FROM orders o JOIN providers p ON p.id = o.provider_id JOIN services s ON s.id = o.service_id
     WHERE ${where} ORDER BY o.id DESC LIMIT 10000`,
    params
  );
}

function getWalletExportData(user, type) {
  const agent = resolveAgent(user);
  const isWithdrawals = type === 'withdrawals';
  if (isWithdrawals) {
    return { type: 'withdrawals', rows: all('SELECT * FROM agent_withdrawals WHERE agent_id = ? ORDER BY id DESC', [agent.id]) };
  }
  return {
    type: 'income',
    rows: all(
      `SELECT o.order_number, o.agent_amount, o.created_at, p.name_ar AS provider_name
       FROM orders o JOIN providers p ON p.id = o.provider_id
       WHERE p.governorate_id = ? AND o.status = 'completed' ORDER BY o.id DESC`,
      [agent.governorate_id]
    ),
  };
}

// ============ إشعارات الوكيل ============
async function broadcastToProviders(user, body) {
  const agent = resolveActiveAgent(user);
  const message = String((body && body.message) || '').trim();
  if (!message) throw new ApiError(400, 'اكتب نص الرسالة أولاً');
  if (message.length > 600) throw new ApiError(400, 'الرسالة طويلة جداً (الحد الأقصى 600 حرف)');

  const providers = all('SELECT id, user_id, name_ar FROM providers WHERE governorate_id = ? AND is_active = 1', [agent.governorate_id]);
  if (providers.length === 0) throw new ApiError(400, 'لا يوجد مزودون نشطون في محافظتك لإرسال الإشعار إليهم');

  const results = await Promise.all(providers.map((p) => notifyUser(p.user_id, {
    type: 'announcement',
    title: '📢 إعلان من الوكيل',
    body: message,
    url: '/dashboard',
    icon: '📢',
  })));

  logActivity(user, 'provider_broadcast', 'agent', agent.id, { providers: providers.length, message });
  return {
    providers: providers.length,
    delivered: results.reduce((s, r) => s + (r.sent || 0), 0),
    message: `أُرسل الإعلان إلى ${providers.length} مزود`,
  };
}

async function remindPendingOrders(user) {
  const agent = resolveActiveAgent(user);
  const rows = all(
    `SELECT p.user_id, p.name_ar, COUNT(o.id) AS cnt
     FROM orders o JOIN providers p ON p.id = o.provider_id
     WHERE p.governorate_id = ? AND o.status = 'pending' AND datetime(o.created_at) <= datetime('now', '-48 hours')
     GROUP BY p.user_id, p.name_ar`,
    [agent.governorate_id]
  );
  if (rows.length === 0) throw new ApiError(400, 'لا توجد طلبات معلقة قديمة لتذكير مزوديها');

  await Promise.all(rows.map((r) => notifyUser(r.user_id, {
    type: 'order',
    title: '⏰ طلبات بانتظار قبولك',
    body: `لديك ${r.cnt} طلبات معلقة منذ أكثر من يومين — يرجى مراجعتها`,
    url: '/orders?status=pending',
    icon: '⏰',
  })));

  logActivity(user, 'remind_pending_orders', 'agent', agent.id, { providers: rows.length, pending: rows.reduce((s, r) => s + r.cnt, 0) });
  return {
    providers_notified: rows.length,
    pending_orders: rows.reduce((s, r) => s + r.cnt, 0),
    message: `تم تذكير ${rows.length} مزود بشأن ${rows.reduce((s, r) => s + r.cnt, 0)} طلباً معلقاً`,
  };
}

// ============ النشاط ============
function getActivity(user, query) {
  const agent = resolveAgent(user);
  const { action } = query || {};
  const { fromUtc, toUtc } = parseDateRange((query && query.from), (query && query.to));
  const pg = paginate({ query }, 50);

  let base = `activity_log a
    LEFT JOIN users u ON u.id = a.user_id
    WHERE (a.user_id = ? OR
           (a.entity_type = 'order' AND EXISTS (SELECT 1 FROM orders o WHERE o.id = a.entity_id AND o.governorate_id = ?)) OR
           (a.entity_type = 'provider' AND EXISTS (SELECT 1 FROM providers p WHERE p.id = a.entity_id AND p.governorate_id = ?)))`;
  const params = [user.id, agent.governorate_id, agent.governorate_id];
  if (action) { base += ' AND a.action = ?'; params.push(action); }
  if (fromUtc) { base += " AND strftime('%s', a.created_at) >= strftime('%s', ?)"; params.push(fromUtc); }
  if (toUtc) { base += " AND strftime('%s', a.created_at) <= strftime('%s', ?)"; params.push(toUtc); }

  const total = get(`SELECT COUNT(*) AS c FROM ${base}`, params).c;
  const rows = all(
    `SELECT a.*, u.name_ar AS actor_name FROM ${base} ORDER BY a.id DESC LIMIT ? OFFSET ?`,
    [...params, pg.limit, pg.offset]
  ).map((r) => {
    let details = null;
    try { details = r.details ? JSON.parse(r.details) : null; } catch (e: any) { /* تجاهل */ }
    return { ...r, details };
  });

  return { rows, meta: { total, page: pg.page, limit: pg.limit, pages: Math.max(1, Math.ceil(total / pg.limit)) } };
}

module.exports = {
  getLease,
  renewLease,
  getCommissions,
  getDashboard,
  getDashboardExportData,
  listCustomers,
  getCustomersExportRows,
  getWallet,
  requestWithdrawal,
  getCommissionExportRows,
  getWalletExportData,
  broadcastToProviders,
  remindPendingOrders,
  getActivity,
};
