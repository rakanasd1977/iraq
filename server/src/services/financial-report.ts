const { get, all } = require('../db');
const { round2, toId, parseDateRange, ApiError } = require('../utils/helpers');

const GROUPS = {
  day: { key: "strftime('%Y-%m-%d', o.created_at)", label: null, order: 'ASC' },
  week: { key: "strftime('%Y-W%W', o.created_at)", label: null, order: 'ASC' },
  month: { key: "strftime('%Y-%m', o.created_at)", label: null, order: 'ASC' },
  governorate: { key: 'g.id', label: 'g.name_ar', order: 'DESC' },
  service: { key: 's.id', label: 's.name_ar', order: 'DESC' },
  agent: { key: 'COALESCE(a.id, 0)', label: "COALESCE(au.name_ar, 'بدون وكيل')", order: 'DESC' },
  provider: { key: 'p.id', label: 'p.name_ar', order: 'DESC' },
};

function reportParams(query) {
  const groupBy = String((query && query.group_by) || 'month').trim();
  if (!GROUPS[groupBy]) throw new ApiError(400, 'بُعد التجميع غير صالح');

  const { fromUtc, toUtc } = parseDateRange(query && query.from, query && query.to);
  const conditions = [];
  const params = [];
  if (fromUtc) { conditions.push("strftime('%s', o.created_at) >= strftime('%s', ?)"); params.push(fromUtc); }
  if (toUtc) { conditions.push("strftime('%s', o.created_at) <= strftime('%s', ?)"); params.push(toUtc); }
  if (query && query.governorate_id) { conditions.push('p.governorate_id = ?'); params.push(toId(query.governorate_id, 'المحافظة')); }
  if (query && query.service_id) { conditions.push('o.service_id = ?'); params.push(toId(query.service_id, 'الخدمة')); }
  if (query && query.agent_id) { conditions.push('a.id = ?'); params.push(toId(query.agent_id, 'الوكيل')); }
  if (query && query.status) { conditions.push('o.status = ?'); params.push(String(query.status).trim()); }
  return { groupBy, conditions, params, from: (query && query.from) || null, to: (query && query.to) || null };
}

function baseFrom() {
  return `FROM orders o
    JOIN providers p ON p.id = o.provider_id
    JOIN services s ON s.id = o.service_id
    LEFT JOIN governorates g ON g.id = p.governorate_id
    LEFT JOIN agents a ON a.id = (
      SELECT id FROM agents WHERE governorate_id = p.governorate_id
      ORDER BY (district_id IS NOT NULL), id LIMIT 1
    )
    LEFT JOIN users au ON au.id = a.user_id`;
}

const AGG = `
  COUNT(*) AS orders_count,
  COALESCE(SUM(CASE WHEN o.status != 'cancelled' THEN o.total_amount ELSE 0 END),0) AS orders_value,
  COALESCE(SUM(CASE WHEN o.status != 'cancelled' THEN o.platform_amount ELSE 0 END),0) AS platform_revenue,
  COALESCE(SUM(CASE WHEN o.status != 'cancelled' THEN o.agent_amount ELSE 0 END),0) AS agent_revenue,
  COALESCE(SUM(CASE WHEN o.status = 'cancelled' THEN 1 ELSE 0 END),0) AS cancelled_count`;

function groupRows(groupBy, where, params) {
  const g = GROUPS[groupBy];
  const keySelect = g.key + ' AS key';
  const labelSelect = (g.label || g.key) + ' AS label';
  return all(
    `SELECT ${keySelect}, ${labelSelect}, ${AGG}
     ${baseFrom()} ${where}
     GROUP BY ${g.key} ORDER BY orders_value ${g.order}, key ${g.order}`,
    params
  );
}

function getFinancialReport(query) {
  const { groupBy, conditions, params, from, to } = reportParams(query);
  const where = conditions.length ? ' WHERE ' + conditions.join(' AND ') : '';

  const summary = get(`SELECT ${AGG} ${baseFrom()} ${where}`, params);
  const rows = groupRows(groupBy, where, params);

  return {
    period: { from, to, group_by: groupBy },
    summary: {
      orders_count: summary.orders_count,
      orders_value: round2(summary.orders_value),
      platform_revenue: round2(summary.platform_revenue),
      agent_revenue: round2(summary.agent_revenue),
      cancelled_count: summary.cancelled_count,
      avg_order_value: round2(summary.orders_count ? summary.orders_value / summary.orders_count : 0),
    },
    rows: rows.map((r) => ({
      key: r.key,
      label: r.label,
      orders_count: r.orders_count,
      orders_value: round2(r.orders_value),
      platform_revenue: round2(r.platform_revenue),
      agent_revenue: round2(r.agent_revenue),
      cancelled_count: r.cancelled_count,
    })),
  };
}

function exportFinancialReportRows(query) {
  const { groupBy, conditions, params } = reportParams(query);
  const where = conditions.length ? ' WHERE ' + conditions.join(' AND ') : '';
  return groupRows(groupBy, where, params);
}

module.exports = { getFinancialReport, exportFinancialReportRows };
