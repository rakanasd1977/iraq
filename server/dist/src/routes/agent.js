"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express = require('express');
const { get, all, run, transaction } = require('../db');
const { ApiError, nextLeasePeriod, round2, csvEscape, paginate, parseDateRange } = require('../utils/helpers');
const { ok, created } = require('../utils/response');
const { authenticate } = require('../middleware/auth');
const { requireRole, requireAgentLease } = require('../middleware/rbac');
const { logActivity } = require('../utils/log');
const { notifyUser, notifyRole } = require('../utils/push');
const router = express.Router();
router.use(authenticate, requireRole('agent'));
function requireAgent(req) {
    if (!req.user.agent_id)
        throw new ApiError(403, 'حساب الوكيل غير مكتمل');
    return req.user;
}
// مفتاح شهر بصيغة YYYY-MM متوافق مع strftime('%Y-%m', created_at) حيث created_at مخزنة UTC
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
// GET /api/agent/lease - بيانات إجارة الوكالة الحالية
router.get('/lease', (req, res, next) => {
    try {
        const user = requireAgent(req);
        const agent = get('SELECT * FROM agents WHERE id = ?', [user.agent_id]);
        const gov = get('SELECT * FROM governorates WHERE id = ?', [agent.governorate_id]);
        const now = new Date();
        const isExpired = !agent.lease_expires_at || new Date(agent.lease_expires_at) <= now;
        const derivedStatus = agent.lease_status === 'pending' && !isExpired ? 'active' : agent.lease_status;
        const payments = all('SELECT * FROM lease_payments WHERE agent_id = ? ORDER BY id DESC LIMIT 10', [agent.id]);
        return ok(res, {
            agent_id: agent.id,
            governorate_id: gov.id,
            governorate_name_ar: gov.name_ar,
            governorate_code: gov.code,
            lease_fee: gov.lease_fee,
            commission_rate: agent.commission_rate,
            lease_status: isExpired ? 'expired' : derivedStatus,
            lease_expires_at: agent.lease_expires_at,
            next_due_date: agent.lease_expires_at,
            is_expired: isExpired,
            payments,
        });
    }
    catch (e) {
        next(e);
    }
});
// POST /api/agent/lease/renew - تقديم طلب تجديد إجارة الوكالة السنوية
router.post('/lease/renew', (req, res, next) => {
    try {
        const user = requireAgent(req);
        const agent = get('SELECT * FROM agents WHERE id = ?', [user.agent_id]);
        const gov = get('SELECT * FROM governorates WHERE id = ?', [agent.governorate_id]);
        const existingPending = get("SELECT id FROM lease_payments WHERE agent_id = ? AND status = 'pending'", [agent.id]);
        if (existingPending)
            throw new ApiError(400, 'يوجد طلب تجديد قيد الانتظار، بانتظار موافقة المسؤول');
        const { start, end } = nextLeasePeriod(agent.lease_expires_at);
        const amount = gov.lease_fee;
        let payId;
        transaction(() => {
            payId = run('INSERT INTO lease_payments (agent_id, governorate_id, amount, period_start, period_end, status, notes) VALUES (?,?,?,?,?,?,?)', [agent.id, gov.id, amount, start.toISOString(), end.toISOString(), 'pending', 'طلب تجديد من الوكيل']).lastId;
            run('UPDATE agents SET lease_status = ?, updated_at = datetime(\'now\') WHERE id = ?', ['pending', agent.id]);
        });
        logActivity(req.user, 'request_lease_renewal', 'agent', agent.id, {
            payment_id: payId, amount, period_start: start.toISOString(), period_end: end.toISOString(),
        });
        return created(res, {
            lease_payment_id: payId,
            amount,
            period_start: start.toISOString(),
            period_end: end.toISOString(),
            status: 'pending',
            message: `تم إرسال طلب تجديد إجارة وكالة محافظة ${gov.name_ar} بمبلغ ${amount} دينار، بانتظار موافقة المسؤول`,
        });
    }
    catch (e) {
        next(e);
    }
});
// GET /api/agent/commissions - أرباح عمولات الوكيل من طلبات محافظته
router.get('/commissions', (req, res, next) => {
    try {
        const user = requireAgent(req);
        const agent = get('SELECT * FROM agents WHERE id = ?', [user.agent_id]);
        const summary = get(`SELECT COUNT(*) AS orders_count,
              COALESCE(SUM(o.total_amount),0) AS orders_value,
              COALESCE(SUM(o.agent_amount),0) AS total_commission
       FROM orders o
       JOIN providers p ON p.id = o.provider_id
       WHERE p.governorate_id = ? AND o.status != 'cancelled'`, [agent.governorate_id]);
        const monthly = all(`SELECT strftime('%Y-%m', o.created_at) AS month,
              COUNT(*) AS orders_count,
              COALESCE(SUM(o.agent_amount),0) AS commission
       FROM orders o
       JOIN providers p ON p.id = o.provider_id
       WHERE p.governorate_id = ? AND o.status != 'cancelled'
       GROUP BY month ORDER BY month DESC LIMIT 6`, [agent.governorate_id]);
        const topProviders = all(`SELECT p.id, p.name_ar, COUNT(o.id) AS orders_count, COALESCE(SUM(o.agent_amount),0) AS commission
       FROM orders o
       JOIN providers p ON p.id = o.provider_id
       WHERE p.governorate_id = ? AND o.status != 'cancelled'
       GROUP BY p.id ORDER BY commission DESC LIMIT 5`, [agent.governorate_id]);
        return ok(res, {
            commission_rate: agent.commission_rate,
            summary: {
                orders_count: summary.orders_count,
                orders_value: round2(summary.orders_value),
                total_commission: round2(summary.total_commission),
            },
            monthly,
            top_providers: topProviders,
        });
    }
    catch (e) {
        next(e);
    }
});
// GET /api/agent/dashboard - إحصائيات لوحة الوكيل (محافظته فقط)
router.get('/dashboard', (req, res, next) => {
    try {
        const user = requireAgent(req);
        const agent = get('SELECT * FROM agents WHERE id = ?', [user.agent_id]);
        const gov = get('SELECT * FROM governorates WHERE id = ?', [agent.governorate_id]);
        const providers = get('SELECT COUNT(*) AS c FROM providers WHERE governorate_id = ?', [gov.id]).c;
        const activeProviders = get('SELECT COUNT(*) AS c FROM providers WHERE governorate_id = ? AND is_active = 1', [gov.id]).c;
        const orders = get(`SELECT COUNT(*) AS c, COALESCE(SUM(o.total_amount),0) AS value, COALESCE(SUM(o.platform_amount),0) AS platform_revenue,
              COALESCE(SUM(o.agent_amount),0) AS agent_revenue
       FROM orders o JOIN providers p ON p.id = o.provider_id WHERE p.governorate_id = ? AND o.status != 'cancelled'`, [gov.id]);
        const byStatus = all(`SELECT o.status, COUNT(*) AS count FROM orders o
       JOIN providers p ON p.id = o.provider_id
       WHERE p.governorate_id = ? GROUP BY o.status`, [gov.id]);
        const byService = all(`SELECT s.id, s.slug, s.name_ar, s.icon, COUNT(p.id) AS providers_count
       FROM services s
       LEFT JOIN providers p ON p.service_id = s.id AND p.governorate_id = ?
       GROUP BY s.id ORDER BY s.sort_order ASC`, [gov.id]);
        const recentOrders = all(`SELECT o.order_number, o.status, o.total_amount, o.created_at, p.name_ar AS provider_name, o.customer_name
       FROM orders o JOIN providers p ON p.id = o.provider_id
       WHERE p.governorate_id = ?
       ORDER BY o.id DESC LIMIT 10`, [gov.id]);
        // سلسلة شهرية (آخر 12 شهراً) للطلبات والقيمة والعمولات — تُملأ الشهور الفارغة بصفر
        const monthlyRows = all(`SELECT strftime('%Y-%m', o.created_at) AS month,
              COUNT(*) AS orders_count,
              COALESCE(SUM(o.total_amount),0) AS orders_value,
              COALESCE(SUM(o.agent_amount),0) AS commission
       FROM orders o JOIN providers p ON p.id = o.provider_id
       WHERE p.governorate_id = ? AND o.status != 'cancelled'
         AND o.created_at >= datetime('now', '-11 months', 'start of month')
       GROUP BY month ORDER BY month ASC`, [gov.id]);
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
        // أعلى الزبائن (مسجلين أو مباشرين) في المحافظة
        const topCustomers = all(`SELECT COALESCE(cu.name_ar, o.customer_name, 'زبون مباشر') AS name,
              o.customer_phone AS phone,
              COUNT(o.id) AS orders_count,
              COALESCE(SUM(CASE WHEN o.status != 'cancelled' THEN o.total_amount ELSE 0 END),0) AS total_value
       FROM orders o
       LEFT JOIN users cu ON cu.id = o.customer_id
       JOIN providers p ON p.id = o.provider_id
       WHERE p.governorate_id = ?
       GROUP BY o.customer_id, o.customer_name, o.customer_phone
       ORDER BY total_value DESC LIMIT 5`, [gov.id]);
        // مهام تحتاج انتباه الوكيل
        const stalePending = get(`SELECT COUNT(*) AS c FROM orders o JOIN providers p ON p.id = o.provider_id
       WHERE p.governorate_id = ? AND o.status = 'pending' AND datetime(o.created_at) <= datetime('now', '-48 hours')`, [gov.id]).c;
        const inactiveProviders = get('SELECT COUNT(*) AS c FROM providers WHERE governorate_id = ? AND is_active = 0', [gov.id]).c;
        const idleProviders = get(`SELECT COUNT(*) AS c FROM providers p WHERE p.governorate_id = ?
       AND NOT EXISTS (SELECT 1 FROM orders o WHERE o.provider_id = p.id AND o.status != 'cancelled'
                       AND o.created_at >= datetime('now', '-30 days'))`, [gov.id]).c;
        const pendingVerifications = get("SELECT COUNT(*) AS c FROM providers WHERE governorate_id = ? AND verification_status = 'pending'", [gov.id]).c;
        const pendingWithdrawals = get("SELECT COUNT(*) AS c FROM agent_withdrawals WHERE agent_id = ? AND status = 'pending'", [agent.id]).c;
        const daysToLeaseEnd = agent.lease_expires_at ? Math.ceil((new Date(agent.lease_expires_at).getTime() - Date.now()) / 86400000) : null;
        const isLeaseExpired = !agent.lease_expires_at || new Date(agent.lease_expires_at) <= new Date();
        // زبائن مسجلون توقفوا عن الطلب في المحافظة منذ أكثر من 30 يوماً
        const lapsedCustomers = get(`SELECT COUNT(*) AS c FROM (
         SELECT o.customer_id FROM orders o JOIN providers p ON p.id = o.provider_id
         WHERE p.governorate_id = ? AND o.customer_id IS NOT NULL
         GROUP BY o.customer_id HAVING MAX(o.created_at) < datetime('now', '-30 days')
       ) t`, [gov.id]).c;
        const attention = [];
        if (stalePending > 0)
            attention.push({ key: 'stale_pending', icon: '⏰', tone: 'warn', label: `${stalePending} طلباً قيد الانتظار منذ أكثر من يومين`, url: '/orders?status=pending' });
        if (inactiveProviders > 0)
            attention.push({ key: 'inactive_providers', icon: '⛔', tone: 'warn', label: `${inactiveProviders} مزوداً متوقفاً عن العمل`, url: '/providers' });
        if (idleProviders > 0)
            attention.push({ key: 'idle_providers', icon: '💤', tone: 'info', label: `${idleProviders} مزوداً بلا طلبات خلال آخر 30 يوماً`, url: '/providers' });
        if (pendingVerifications > 0)
            attention.push({ key: 'pending_verifications', icon: '📄', tone: 'info', label: `${pendingVerifications} مزوداً بانتظار مراجعة التوثيق`, url: '/providers' });
        if (pendingWithdrawals > 0)
            attention.push({ key: 'pending_withdrawals', icon: '💰', tone: 'info', label: `${pendingWithdrawals} طلب سحب بانتظار موافقة المسؤول`, url: '/wallet' });
        if (lapsedCustomers > 0)
            attention.push({ key: 'lapsed_customers', icon: '🔄', tone: 'info', label: `${lapsedCustomers} زبوناً مسجلاً توقفوا عن الطلب منذ أكثر من 30 يوماً`, url: '/customers?lapsed=1' });
        if (!isLeaseExpired && daysToLeaseEnd !== null && daysToLeaseEnd <= 30)
            attention.push({ key: 'lease_expiring', icon: '📜', tone: 'warn', label: `إجارة وكالتك تنتهي خلال ${daysToLeaseEnd} يوماً`, url: '/lease' });
        if (isLeaseExpired)
            attention.push({ key: 'lease_expired', icon: '🚨', tone: 'danger', label: 'إجارة وكالتك منتهية — جددها الآن', url: '/lease' });
        // توزيع الطلبات حسب الخدمة (لمخطط دائري)
        const ordersByService = all(`SELECT s.id, s.slug, s.name_ar, s.icon, COUNT(o.id) AS orders_count,
              COALESCE(SUM(o.total_amount),0) AS orders_value
       FROM services s
       LEFT JOIN (SELECT o.* FROM orders o JOIN providers p ON p.id = o.provider_id WHERE p.governorate_id = ?) o ON o.service_id = s.id
       GROUP BY s.id ORDER BY s.sort_order ASC`, [gov.id]).map((r) => ({ ...r, orders_value: round2(r.orders_value) }));
        return ok(res, {
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
        });
    }
    catch (e) {
        next(e);
    }
});
// GET /api/agent/dashboard/export - تصدير مؤشرات لوحة الوكيل CSV (ملخص + حالات + خدمات + شهري + الزبائن)
router.get('/dashboard/export', (req, res, next) => {
    try {
        const user = requireAgent(req);
        const agent = get('SELECT * FROM agents WHERE id = ?', [user.agent_id]);
        const gov = get('SELECT * FROM governorates WHERE id = ?', [agent.governorate_id]);
        const orders = get(`SELECT COUNT(*) AS c, COALESCE(SUM(o.total_amount),0) AS value, COALESCE(SUM(o.platform_amount),0) AS platform_revenue,
              COALESCE(SUM(o.agent_amount),0) AS agent_revenue
       FROM orders o JOIN providers p ON p.id = o.provider_id WHERE p.governorate_id = ? AND o.status != 'cancelled'`, [gov.id]);
        const byStatus = all(`SELECT o.status, COUNT(*) AS count FROM orders o
       JOIN providers p ON p.id = o.provider_id
       WHERE p.governorate_id = ? GROUP BY o.status`, [gov.id]);
        const byService = all(`SELECT s.id, s.slug, s.name_ar, s.icon, COUNT(p.id) AS providers_count
       FROM services s
       LEFT JOIN providers p ON p.service_id = s.id AND p.governorate_id = ?
       GROUP BY s.id ORDER BY s.sort_order ASC`, [gov.id]);
        const monthly = all(`SELECT strftime('%Y-%m', o.created_at) AS month,
              COUNT(*) AS orders_count,
              COALESCE(SUM(o.total_amount),0) AS orders_value,
              COALESCE(SUM(o.agent_amount),0) AS commission
       FROM orders o JOIN providers p ON p.id = o.provider_id
       WHERE p.governorate_id = ? AND o.status != 'cancelled'
         AND o.created_at >= datetime('now', '-11 months', 'start of month')
       GROUP BY month ORDER BY month ASC`, [gov.id]);
        const topCustomers = all(`SELECT COALESCE(cu.name_ar, o.customer_name, 'زبون مباشر') AS name,
              o.customer_phone AS phone,
              COUNT(o.id) AS orders_count,
              COALESCE(SUM(CASE WHEN o.status != 'cancelled' THEN o.total_amount ELSE 0 END),0) AS total_value
       FROM orders o
       LEFT JOIN users cu ON cu.id = o.customer_id
       JOIN providers p ON p.id = o.provider_id
       WHERE p.governorate_id = ?
       GROUP BY o.customer_id, o.customer_name, o.customer_phone
       ORDER BY total_value DESC LIMIT 5`, [gov.id]);
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="agent-dashboard-${Date.now()}.csv"`);
        const L = [];
        const pushRow = (cols) => L.push(cols.map(csvEscape).join(','));
        L.push(`لوحة الوكيل — محافظة ${gov.name_ar},تصدير ${new Date().toISOString().slice(0, 10)}`);
        pushRow(['إجمالي الطلبات', orders.c]);
        pushRow(['قيمة الطلبات (دينار)', round2(orders.value)]);
        pushRow(['أرباحي من العمولات (دينار)', round2(orders.agent_revenue)]);
        pushRow(['إيراد المنصة (دينار)', round2(orders.platform_revenue)]);
        L.push('');
        pushRow(['الطلبات حسب الحالة', 'العدد']);
        for (const s of byStatus)
            pushRow([s.status, s.count]);
        L.push('');
        pushRow(['الخدمة', 'عدد المزودين']);
        for (const s of byService)
            pushRow([s.name_ar, s.providers_count]);
        L.push('');
        pushRow(['الشهر', 'عدد الطلبات', 'القيمة (دينار)', 'عمولتي (دينار)']);
        for (const m of monthly)
            pushRow([m.month, m.orders_count, round2(m.orders_value), round2(m.commission)]);
        L.push('');
        pushRow(['الزبون', 'الهاتف', 'الطلبات', 'إجمالي المشتريات (دينار)']);
        for (const c of topCustomers)
            pushRow([c.name, c.phone || '', c.orders_count, round2(c.total_value)]);
        return res.send('\uFEFF' + L.join('\r\n') + '\r\n');
    }
    catch (e) {
        next(e);
    }
});
// GET /api/agent/customers - زبائن محافظة الوكيل (مسجلون + طلبات مباشرة) مع إجمالي مشترياتهم
router.get('/customers', (req, res, next) => {
    try {
        const user = requireAgent(req);
        const agent = get('SELECT * FROM agents WHERE id = ?', [user.agent_id]);
        const q = String(req.query.q || '').trim();
        const union = `(
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
        const baseParams = [agent.governorate_id, agent.governorate_id];
        const whereParts = [];
        const searchParams = [];
        if (q) {
            whereParts.push('name LIKE ? OR phone LIKE ? OR (email IS NOT NULL AND email LIKE ?)');
            searchParams.push(`%${q}%`, `%${q}%`, `%${q}%`);
        }
        if (String(req.query.lapsed || '') === '1') {
            whereParts.push("last_order_at IS NOT NULL AND last_order_at < datetime('now', '-30 days')");
        }
        const where = whereParts.length ? 'WHERE ' + whereParts.join(' AND ') : '';
        const pg = paginate(req, 20);
        const total = get(`SELECT COUNT(*) AS c FROM ${union} ${where}`, [...baseParams, ...searchParams]).c;
        const rows = all(`SELECT * FROM ${union} ${where} ORDER BY total_value DESC, orders_count DESC, last_order_at DESC LIMIT ? OFFSET ?`, [...baseParams, ...searchParams, pg.limit, pg.offset]);
        return ok(res, rows.map((r) => ({
            ...r,
            total_value: round2(r.total_value),
            phone: r.phone || '',
            email: r.email || '',
        })), {
            total,
            page: pg.page,
            limit: pg.limit,
            pages: Math.max(1, Math.ceil(total / pg.limit)),
        });
    }
    catch (e) {
        next(e);
    }
});
// GET /api/agent/customers/export - تصدير زبائن المحافظة CSV
router.get('/customers/export', (req, res, next) => {
    try {
        const user = requireAgent(req);
        const agent = get('SELECT * FROM agents WHERE id = ?', [user.agent_id]);
        const q = String(req.query.q || '').trim();
        const union = `(
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
        const where = q ? 'WHERE name LIKE ? OR phone LIKE ? OR (email IS NOT NULL AND email LIKE ?)' : '';
        const searchParams = q ? [`%${q}%`, `%${q}%`, `%${q}%`] : [];
        const rows = all(`SELECT * FROM ${union} ${where} ORDER BY total_value DESC, orders_count DESC`, [agent.governorate_id, agent.governorate_id, ...searchParams]);
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="customers-${Date.now()}.csv"`);
        res.write('\uFEFF' + ['الاسم', 'الهاتف', 'البريد', 'عدد الطلبات', 'إجمالي المشتريات (دينار)', 'طلبات معلقة', 'آخر طلب', 'مسجل من تاريخ'].map(csvEscape).join(',') + '\r\n');
        for (const r of rows) {
            res.write([r.name, r.phone, r.email || '', r.orders_count, round2(r.total_value), r.pending_count, r.last_order_at || '', r.registered_at || ''].map(csvEscape).join(',') + '\r\n');
        }
        return res.end();
    }
    catch (e) {
        next(e);
    }
});
// رصيد الوكيل: أرباح الطلبات المكتملة في محافظته ناقص السحوبات المعتمدة/القيدية
function agentWallet(agent) {
    const earned = Number(get(`SELECT COALESCE(SUM(o.agent_amount),0) AS v FROM orders o
     JOIN providers p ON p.id = o.provider_id
     WHERE p.governorate_id = ? AND o.status = 'completed'`, [agent.governorate_id]).v) || 0;
    const pendingEarn = Number(get(`SELECT COALESCE(SUM(o.agent_amount),0) AS v FROM orders o
     JOIN providers p ON p.id = o.provider_id
     WHERE p.governorate_id = ? AND o.status != 'cancelled' AND o.status != 'completed'`, [agent.governorate_id]).v) || 0;
    const approved = Number(get(`SELECT COALESCE(SUM(amount),0) AS v FROM agent_withdrawals WHERE agent_id = ? AND status = 'approved'`, [agent.id]).v) || 0;
    const pending = Number(get(`SELECT COALESCE(SUM(amount),0) AS v FROM agent_withdrawals WHERE agent_id = ? AND status = 'pending'`, [agent.id]).v) || 0;
    return {
        total_earned: round2(earned),
        pending_orders_commission: round2(pendingEarn),
        approved_withdrawals: round2(approved),
        pending_withdrawals: round2(pending),
        available: round2(earned - approved - pending),
    };
}
// GET /api/agent/wallet - محفظة عمولات الوكيل (محافظته فقط)
router.get('/wallet', (req, res, next) => {
    try {
        const user = requireAgent(req);
        const agent = get('SELECT * FROM agents WHERE id = ?', [user.agent_id]);
        const income = all(`SELECT o.id, o.order_number, o.agent_amount, o.created_at, p.name_ar AS provider_name
       FROM orders o JOIN providers p ON p.id = o.provider_id
       WHERE p.governorate_id = ? AND o.status = 'completed'
       ORDER BY o.id DESC LIMIT 10`, [agent.governorate_id]);
        const withdrawals = all('SELECT * FROM agent_withdrawals WHERE agent_id = ? ORDER BY id DESC LIMIT 10', [agent.id]);
        return ok(res, {
            commission_rate: agent.commission_rate,
            balance: agentWallet(agent),
            income,
            withdrawals,
        });
    }
    catch (e) {
        next(e);
    }
});
// POST /api/agent/wallet/withdraw - طلب سحب من الرصيد المتاح
router.post('/wallet/withdraw', requireAgentLease(), (req, res, next) => {
    try {
        const user = requireAgent(req);
        const agent = get('SELECT * FROM agents WHERE id = ?', [user.agent_id]);
        const amount = Number(req.body && req.body.amount);
        if (!Number.isFinite(amount) || amount <= 0)
            throw new ApiError(400, 'مبلغ السحب غير صالح');
        if (!Number.isInteger(amount) || amount < 1000)
            throw new ApiError(400, 'أقل مبلغ للسحب 1000 دينار');
        const { available } = agentWallet(agent);
        if (amount > available)
            throw new ApiError(400, `الرصيد المتاح ${round2(available)} دينار لا يكفي لطلب السحب`);
        const notes = String((req.body && req.body.notes) || '').slice(0, 300);
        const wid = run('INSERT INTO agent_withdrawals (agent_id, amount, notes) VALUES (?,?,?)', [agent.id, amount, notes || null]).lastId;
        logActivity(req.user, 'agent_withdrawal_request', 'agent', agent.id, { withdrawal_id: wid, amount });
        // إشعار للمسؤولين
        notifyRole('admin', {
            type: 'withdrawal_request',
            title: 'طلب سحب جديد 💸',
            body: `الوكيل «${agent.name_ar || agent.user_id}» طلب سحب ${amount} دينار.`,
            url: '/agent-withdrawals',
            icon: '💸',
        });
        return created(res, get('SELECT * FROM agent_withdrawals WHERE id = ?', [wid]));
    }
    catch (e) {
        next(e);
    }
});
// GET /api/agent/commissions/export - سجل عمولات الوكيل كـ CSV (دفتر الأرباح لكل طلب)
router.get('/commissions/export', (req, res, next) => {
    try {
        const user = requireAgent(req);
        const agent = get('SELECT * FROM agents WHERE id = ?', [user.agent_id]);
        const status = String(req.query.status || '').trim();
        const conditions = ['p.governorate_id = ?', "o.status != 'cancelled'"];
        const params = [agent.governorate_id];
        if (status) {
            conditions.push('o.status = ?');
            params.push(status);
        }
        const where = conditions.join(' AND ');
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="commissions-${Date.now()}.csv"`);
        res.write('\uFEFF' + ['رقم الطلب', 'التاريخ', 'المزود', 'الخدمة', 'الزبون', 'المبلغ (دينار)', 'نسبة العمولة', 'عمولتي (دينار)', 'عمولة المنصة (دينار)', 'الحالة'].map(csvEscape).join(',') + '\r\n');
        const BATCH = 500;
        const MAX = 10000;
        let emitted = 0;
        while (emitted < MAX) {
            const rows = all(`SELECT o.order_number, o.created_at, o.total_amount, o.commission_amount, o.agent_amount, o.platform_amount, o.status,
                p.name_ar AS provider_name, p.commission_rate, s.name_ar AS service_name, o.customer_name
         FROM orders o JOIN providers p ON p.id = o.provider_id JOIN services s ON s.id = o.service_id
         WHERE ${where} ORDER BY o.id DESC LIMIT ? OFFSET ?`, [...params, BATCH, emitted]);
            if (rows.length === 0)
                break;
            for (const o of rows) {
                res.write([o.order_number, o.created_at, o.provider_name, o.service_name, o.customer_name || '',
                    round2(o.total_amount), `${o.commission_rate}%`, round2(o.agent_amount), round2(o.platform_amount), o.status].map(csvEscape).join(',') + '\r\n');
                emitted++;
            }
        }
        return res.end();
    }
    catch (e) {
        next(e);
    }
});
// GET /api/agent/wallet/export?type=income|withdrawals - تصدير أرباح المحفظة أو سجلات السحب CSV
router.get('/wallet/export', (req, res, next) => {
    try {
        const user = requireAgent(req);
        const agent = get('SELECT * FROM agents WHERE id = ?', [user.agent_id]);
        const type = req.query.type === 'withdrawals' ? 'withdrawals' : 'income';
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="wallet-${type}-${Date.now()}.csv"`);
        if (type === 'income') {
            res.write('\uFEFF' + ['رقم الطلب', 'المزود', 'عمولتي (دينار)', 'التاريخ'].map(csvEscape).join(',') + '\r\n');
            const rows = all(`SELECT o.order_number, o.agent_amount, o.created_at, p.name_ar AS provider_name
         FROM orders o JOIN providers p ON p.id = o.provider_id
         WHERE p.governorate_id = ? AND o.status = 'completed' ORDER BY o.id DESC`, [agent.governorate_id]);
            for (const o of rows) {
                res.write([o.order_number, o.provider_name, round2(o.agent_amount), o.created_at].map(csvEscape).join(',') + '\r\n');
            }
        }
        else {
            res.write('\uFEFF' + ['رقم السحب', 'المبلغ (دينار)', 'الحالة', 'الملاحظات', 'التاريخ', 'تاريخ القرار'].map(csvEscape).join(',') + '\r\n');
            const rows = all('SELECT * FROM agent_withdrawals WHERE agent_id = ? ORDER BY id DESC', [agent.id]);
            for (const w of rows) {
                res.write([w.id, round2(w.amount), w.status, w.notes || '', w.created_at, w.decided_at || ''].map(csvEscape).join(',') + '\r\n');
            }
        }
        return res.end();
    }
    catch (e) {
        next(e);
    }
});
function requireActiveLease(req) {
    const user = requireAgent(req);
    const agent = get('SELECT * FROM agents WHERE id = ?', [user.agent_id]);
    const active = agent.lease_status === 'active' && agent.lease_expires_at && new Date(agent.lease_expires_at) > new Date();
    if (!active)
        throw new ApiError(403, 'إجارة الوكالة منتهية أو قيد الموافقة — لا يمكن تنفيذ هذا الإجراء');
    return agent;
}
// POST /api/agent/providers/broadcast - إشعار فوري لجميع مزودي المحافظة النشطين
router.post('/providers/broadcast', async (req, res, next) => {
    try {
        const agent = requireActiveLease(req);
        const message = String((req.body && req.body.message) || '').trim();
        if (!message)
            throw new ApiError(400, 'اكتب نص الرسالة أولاً');
        if (message.length > 600)
            throw new ApiError(400, 'الرسالة طويلة جداً (الحد الأقصى 600 حرف)');
        const providers = all('SELECT id, user_id, name_ar FROM providers WHERE governorate_id = ? AND is_active = 1', [agent.governorate_id]);
        if (providers.length === 0)
            throw new ApiError(400, 'لا يوجد مزودون نشطون في محافظتك لإرسال الإشعار إليهم');
        const results = await Promise.all(providers.map((p) => notifyUser(p.user_id, {
            type: 'announcement',
            title: '📢 إعلان من الوكيل',
            body: message,
            url: '/dashboard',
            icon: '📢',
        })));
        logActivity(req.user, 'provider_broadcast', 'agent', agent.id, { providers: providers.length, message });
        return ok(res, {
            providers: providers.length,
            delivered: results.reduce((s, r) => s + (r.sent || 0), 0),
            message: `أُرسل الإعلان إلى ${providers.length} مزود`,
        });
    }
    catch (e) {
        next(e);
    }
});
// POST /api/agent/orders/remind-pending - تذكير مزودي الطلبات المعلقة القديمة (+48 ساعة)
router.post('/orders/remind-pending', async (req, res, next) => {
    try {
        const agent = requireActiveLease(req);
        const rows = all(`SELECT p.user_id, p.name_ar, COUNT(o.id) AS cnt
       FROM orders o JOIN providers p ON p.id = o.provider_id
       WHERE p.governorate_id = ? AND o.status = 'pending' AND datetime(o.created_at) <= datetime('now', '-48 hours')
       GROUP BY p.user_id, p.name_ar`, [agent.governorate_id]);
        if (rows.length === 0)
            throw new ApiError(400, 'لا توجد طلبات معلقة قديمة لتذكير مزوديها');
        await Promise.all(rows.map((r) => notifyUser(r.user_id, {
            type: 'order',
            title: '⏰ طلبات بانتظار قبولك',
            body: `لديك ${r.cnt} طلبات معلقة منذ أكثر من يومين — يرجى مراجعتها`,
            url: '/orders?status=pending',
            icon: '⏰',
        })));
        logActivity(req.user, 'remind_pending_orders', 'agent', agent.id, { providers: rows.length, pending: rows.reduce((s, r) => s + r.cnt, 0) });
        return ok(res, {
            providers_notified: rows.length,
            pending_orders: rows.reduce((s, r) => s + r.cnt, 0),
            message: `تم تذكير ${rows.length} مزود بشأن ${rows.reduce((s, r) => s + r.cnt, 0)} طلباً معلقاً`,
        });
    }
    catch (e) {
        next(e);
    }
});
// GET /api/agent/activity - سجل نشاط محافظة الوكيل (أفعاله + تغييرات طلبات/مزودي محافظته)
router.get('/activity', (req, res, next) => {
    try {
        const user = requireAgent(req);
        const agent = get('SELECT * FROM agents WHERE id = ?', [user.agent_id]);
        const { action } = req.query;
        const { fromUtc, toUtc } = parseDateRange(req.query.from, req.query.to);
        const pg = paginate(req, 50);
        let base = `activity_log a
      LEFT JOIN users u ON u.id = a.user_id
      WHERE (a.user_id = ? OR
             (a.entity_type = 'order' AND EXISTS (SELECT 1 FROM orders o WHERE o.id = a.entity_id AND o.governorate_id = ?)) OR
             (a.entity_type = 'provider' AND EXISTS (SELECT 1 FROM providers p WHERE p.id = a.entity_id AND p.governorate_id = ?)))`;
        const params = [user.id, agent.governorate_id, agent.governorate_id];
        if (action) {
            base += ' AND a.action = ?';
            params.push(action);
        }
        if (fromUtc) {
            base += " AND strftime('%s', a.created_at) >= strftime('%s', ?)";
            params.push(fromUtc);
        }
        if (toUtc) {
            base += " AND strftime('%s', a.created_at) <= strftime('%s', ?)";
            params.push(toUtc);
        }
        const total = get(`SELECT COUNT(*) AS c FROM ${base}`, params).c;
        const rows = all(`SELECT a.*, u.name_ar AS actor_name FROM ${base} ORDER BY a.id DESC LIMIT ? OFFSET ?`, [...params, pg.limit, pg.offset]).map((r) => {
            let details = null;
            try {
                details = r.details ? JSON.parse(r.details) : null;
            }
            catch (e) { /* تجاهل */ }
            return { ...r, details };
        });
        return ok(res, rows, { total, page: pg.page, limit: pg.limit, pages: Math.max(1, Math.ceil(total / pg.limit)) });
    }
    catch (e) {
        next(e);
    }
});
module.exports = router;
