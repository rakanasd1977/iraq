"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express = require('express');
const { get, all } = require('../db');
const { round2 } = require('../utils/helpers');
const { ok } = require('../utils/response');
const { authenticate } = require('../middleware/auth');
const { requireRole } = require('../middleware/rbac');
const router = express.Router();
router.use(authenticate);
// مفاتيح الشهور بصيغة YYYY-MM بتوقيت UTC ليطابق تجميع strftime('%Y-%m', created_at) (created_at مخزنة UTC)
function monthlySeries() {
    const months = [];
    const now = new Date();
    for (let i = 5; i >= 0; i--) {
        const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
        months.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`);
    }
    return months;
}
// GET /api/dashboard (المسؤول)
router.get('/', requireRole('admin'), (req, res, next) => {
    try {
        const customers = get('SELECT COUNT(*) AS c FROM users WHERE role = ?', ['customer']).c;
        const agentsCount = get('SELECT COUNT(*) AS c FROM agents').c;
        const activeAgents = get('SELECT COUNT(*) AS c FROM agents WHERE lease_status = ? AND lease_expires_at > datetime(\'now\')', ['active']).c;
        const providersCount = get('SELECT COUNT(*) AS c FROM providers').c;
        const activeProviders = get('SELECT COUNT(*) AS c FROM providers WHERE is_active = 1').c;
        const verifiedProviders = get('SELECT COUNT(*) AS c FROM providers WHERE is_verified = 1').c;
        const governoratesCount = get('SELECT COUNT(*) AS c FROM governorates').c;
        const revenue = get(`SELECT COUNT(*) AS orders_count, COALESCE(SUM(o.total_amount),0) AS orders_value,
              COALESCE(SUM(o.platform_amount),0) AS platform_revenue,
              COALESCE(SUM(o.agent_amount),0) AS agent_revenue
       FROM orders o WHERE o.status != 'cancelled'`);
        const byStatus = all('SELECT status, COUNT(*) AS count FROM orders GROUP BY status');
        const byService = all(`SELECT s.id, s.slug, s.name_ar, s.icon, COUNT(DISTINCT p.id) AS providers_count,
              (SELECT COUNT(*) FROM orders o WHERE o.service_id = s.id) AS orders_count
       FROM services s
       LEFT JOIN providers p ON p.service_id = s.id
       GROUP BY s.id ORDER BY s.sort_order ASC`);
        const byGovernorate = all(`SELECT g.id, g.name_ar, g.code, COUNT(DISTINCT p.id) AS providers_count, COUNT(o.id) AS orders_count,
              (SELECT u.name_ar FROM agents a JOIN users u ON u.id = a.user_id WHERE a.governorate_id = g.id) AS agent_name
       FROM governorates g
       LEFT JOIN providers p ON p.governorate_id = g.id
       LEFT JOIN orders o ON o.governorate_id = g.id
       GROUP BY g.id ORDER BY g.sort_order ASC`);
        const pendingLeases = get("SELECT COUNT(*) AS c FROM lease_payments WHERE status = 'pending'").c;
        const months = monthlySeries();
        const monthlyRows = all(`SELECT strftime('%Y-%m', created_at) AS month, COUNT(*) AS orders_count,
              COALESCE(SUM(platform_amount),0) AS platform_revenue, COALESCE(SUM(agent_amount),0) AS agent_revenue
       FROM orders WHERE status != 'cancelled' GROUP BY month`);
        const monthlyMap = {};
        monthlyRows.forEach((r) => { monthlyMap[r.month] = r; });
        const monthly = months.map((m) => monthlyMap[m] || { month: m, orders_count: 0, platform_revenue: 0, agent_revenue: 0 });
        return ok(res, {
            counts: {
                customers,
                agents: agentsCount,
                active_agents: activeAgents,
                providers: providersCount,
                active_providers: activeProviders,
                verified_providers: verifiedProviders,
                governorates: governoratesCount,
                pending_lease_requests: pendingLeases,
            },
            revenue: {
                orders_count: revenue.orders_count,
                orders_value: round2(revenue.orders_value),
                platform_revenue: round2(revenue.platform_revenue),
                agent_revenue: round2(revenue.agent_revenue),
            },
            orders_by_status: byStatus,
            providers_by_service: byService,
            providers_by_governorate: byGovernorate,
            monthly,
        });
    }
    catch (e) {
        next(e);
    }
});
// GET /api/dashboard/agent (الوكيل - محافظته فقط)
router.get('/agent', requireRole('agent'), (req, res, next) => {
    try {
        const agent = get('SELECT * FROM agents WHERE id = ?', [req.user.agent_id]);
        if (!agent)
            return ok(res, {});
        const gov = get('SELECT * FROM governorates WHERE id = ?', [agent.governorate_id]);
        const orders = get(`SELECT COUNT(*) AS c, COALESCE(SUM(o.total_amount),0) AS value,
              COALESCE(SUM(o.agent_amount),0) AS agent_revenue,
              COALESCE(SUM(o.platform_amount),0) AS platform_revenue
       FROM orders o JOIN providers p ON p.id = o.provider_id
       WHERE p.governorate_id = ? AND o.status != 'cancelled'`, [gov.id]);
        const providersCount = get('SELECT COUNT(*) AS c FROM providers WHERE governorate_id = ?', [gov.id]).c;
        const activeProviders = get('SELECT COUNT(*) AS c FROM providers WHERE governorate_id = ? AND is_active = 1', [gov.id]).c;
        const byStatus = all(`SELECT o.status, COUNT(*) AS count FROM orders o
       JOIN providers p ON p.id = o.provider_id WHERE p.governorate_id = ? GROUP BY o.status`, [gov.id]);
        return ok(res, {
            governorate_name_ar: gov.name_ar,
            lease_status: agent.lease_status,
            lease_expires_at: agent.lease_expires_at,
            counts: { providers: providersCount, active_providers: activeProviders },
            revenue: {
                orders_count: orders.c,
                orders_value: round2(orders.value),
                agent_revenue: round2(orders.agent_revenue),
                platform_revenue: round2(orders.platform_revenue),
            },
            orders_by_status: byStatus,
        });
    }
    catch (e) {
        next(e);
    }
});
// GET /api/dashboard/executive — KPIs تنفيذية مع مقارنة الفترة الحالية بالسابقة
router.get('/executive', requireRole('admin'), (req, res, next) => {
    try {
        const period = String(req.query.period || 'month').trim(); // day | week | month
        const validPeriods = ['day', 'week', 'month'];
        if (!validPeriods.includes(period))
            throw new (require('../utils/helpers').ApiError)(400, 'فترة غير صالحة');
        // دالة لحساب بداية الفترة الحالية والسابقة
        function periodBounds(p, offset = 0) {
            const now = new Date();
            let start, end;
            if (p === 'day') {
                start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + offset));
                end = new Date(start.getTime() + 86400000);
            }
            else if (p === 'week') {
                const day = now.getUTCDay();
                const diff = now.getUTCDate() - day + (offset * 7);
                start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), diff));
                end = new Date(start.getTime() + 7 * 86400000);
            }
            else { // month
                start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset, 1));
                end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset + 1, 1));
            }
            return { start: start.toISOString().replace('T', ' ').slice(0, 19), end: end.toISOString().replace('T', ' ').slice(0, 19) };
        }
        const cur = periodBounds(period, 0);
        const prev = periodBounds(period, -1);
        function kpiQuery(table, dateCol, whereExtra = '', paramsExtra = []) {
            const where = `${dateCol} >= ? AND ${dateCol} < ? ${whereExtra ? 'AND ' + whereExtra : ''}`;
            const curParams = [cur.start, cur.end, ...paramsExtra];
            const prevParams = [prev.start, prev.end, ...paramsExtra];
            const curRow = get(`SELECT COUNT(*) AS c, COALESCE(SUM(total_amount),0) AS v FROM ${table} WHERE ${where}`, curParams);
            const prevRow = get(`SELECT COUNT(*) AS c, COALESCE(SUM(total_amount),0) AS v FROM ${table} WHERE ${where}`, prevParams);
            return { cur: curRow, prev: prevRow };
        }
        // طلبات (غير ملغاة)
        const ordersKpi = kpiQuery('orders', 'created_at', "status != 'cancelled'");
        // زبائن جدد
        const customersKpi = kpiQuery('users', 'created_at', "role = 'customer'", []);
        // إيرادات المنصة
        const revenueKpi = kpiQuery('orders', 'created_at', "status != 'cancelled'");
        // معدل التحويل = طلبات / زبائن نشطين في الفترة
        const activeCustomersCur = get(`SELECT COUNT(DISTINCT o.user_id) AS c FROM orders o WHERE o.created_at >= ? AND o.created_at < ? AND o.status != 'cancelled'`, [cur.start, cur.end]).c;
        const activeCustomersPrev = get(`SELECT COUNT(DISTINCT o.user_id) AS c FROM orders o WHERE o.created_at >= ? AND o.created_at < ? AND o.status != 'cancelled'`, [prev.start, prev.end]).c;
        function delta(curVal, prevVal) {
            if (prevVal === 0)
                return curVal > 0 ? 100 : 0;
            return round2(((curVal - prevVal) / prevVal) * 100);
        }
        const round2 = require('../utils/helpers').round2;
        const kpis = {
            orders: {
                label: 'الطلبات',
                current: ordersKpi.cur.c,
                previous: ordersKpi.prev.c,
                deltaPct: delta(ordersKpi.cur.c, ordersKpi.prev.c),
                value: round2(ordersKpi.cur.v),
            },
            customers: {
                label: 'الزبائن الجدد',
                current: customersKpi.cur.c,
                previous: customersKpi.prev.c,
                deltaPct: delta(customersKpi.cur.c, customersKpi.prev.c),
            },
            revenue: {
                label: 'إيرادات المنصة (دينار)',
                current: round2(revenueKpi.cur.v),
                previous: round2(revenueKpi.prev.v),
                deltaPct: delta(round2(revenueKpi.cur.v), round2(revenueKpi.prev.v)),
            },
            conversion: {
                label: 'معدل التحويل (%)',
                current: activeCustomersCur > 0 ? round2((ordersKpi.cur.c / activeCustomersCur) * 100) : 0,
                previous: activeCustomersPrev > 0 ? round2((ordersKpi.prev.c / activeCustomersPrev) * 100) : 0,
                deltaPct: 0, // نتركها للحساب في الواجهة
            },
        };
        kpis.conversion.deltaPct = delta(kpis.conversion.current, kpis.conversion.previous);
        // سلسلة زمنية للسباركلاين (آخر 12 فترة)
        const seriesMonths = [];
        const now = new Date();
        for (let i = 11; i >= 0; i--) {
            let start, end, label;
            if (period === 'day') {
                const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - i));
                start = d.toISOString().replace('T', ' ').slice(0, 19);
                end = new Date(d.getTime() + 86400000).toISOString().replace('T', ' ').slice(0, 19);
                label = `${d.getUTCDate().toString().padStart(2, '0')}/${(d.getUTCMonth() + 1).toString().padStart(2, '0')}`;
            }
            else if (period === 'week') {
                const day = now.getUTCDay();
                const diff = now.getUTCDate() - day - i * 7;
                const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), diff));
                start = d.toISOString().replace('T', ' ').slice(0, 19);
                end = new Date(d.getTime() + 7 * 86400000).toISOString().replace('T', ' ').slice(0, 19);
                label = `W${Math.ceil(d.getUTCDate() / 7)}`;
            }
            else {
                const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
                start = d.toISOString().replace('T', ' ').slice(0, 19);
                end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i + 1, 1)).toISOString().replace('T', ' ').slice(0, 19);
                label = `${d.getUTCFullYear()}-${(d.getUTCMonth() + 1).toString().padStart(2, '0')}`;
            }
            const row = get(`SELECT COUNT(*) AS c, COALESCE(SUM(total_amount),0) AS v FROM orders WHERE created_at >= ? AND created_at < ? AND status != 'cancelled'`, [start, end]);
            seriesMonths.push({ label, orders: row.c, revenue: round2(row.v) });
        }
        return ok(res, {
            period,
            currentRange: { start: cur.start, end: cur.end },
            previousRange: { start: prev.start, end: prev.end },
            kpis,
            sparkline: seriesMonths,
        });
    }
    catch (e) {
        next(e);
    }
});
module.exports = router;
