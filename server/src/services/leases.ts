const { get, all, run } = require('../db');
const { ApiError, toId, paginate, assertAmount } = require('../utils/helpers');
const { ok } = require('../utils/response');
const { logActivity } = require('../utils/log');

const LEASE_SELECT = `
  SELECT lp.*, g.name_ar AS governorate_name_ar, g.code AS governorate_code,
         d.name_ar AS district_name_ar, d.code AS district_code,
         a.user_id AS agent_user_id,
         u.name_ar AS agent_name_ar, u.email AS agent_email,
         a.lease_status, a.lease_expires_at
  FROM lease_payments lp
  JOIN agents a ON a.id = lp.agent_id
  JOIN users u ON u.id = a.user_id
  JOIN governorates g ON g.id = lp.governorate_id
  LEFT JOIN districts d ON d.id = lp.district_id
`;

function parseDate(v, fallback) {
  if (v === undefined || v === null || v === '') return fallback ? new Date(fallback) : null;
  const d = new Date(v);
  if (isNaN(d.getTime())) throw new ApiError(400, 'تاريخ غير صالح (التنسيق YYYY-MM-DD أو ISO)');
  return d;
}

function validatePeriod(start, end) {
  if (!start || !end) throw new ApiError(400, 'يرجى تحديد بداية الفترة ونهايتها');
  if (end <= start) throw new ApiError(400, 'نهاية الفترة يجب أن تكون بعد بدايتها');
}

function latestPaidExpiry(agentId) {
  const row = get("SELECT MAX(period_end) AS latest FROM lease_payments WHERE agent_id = ? AND status = 'paid'", [agentId]);
  return row && row.latest ? row.latest : null;
}

function syncAgentLease(agentId) {
  const expiry = latestPaidExpiry(agentId);
  if (expiry) {
    const status = new Date(expiry) > new Date() ? 'active' : 'expired';
    run("UPDATE agents SET lease_expires_at = ?, lease_status = ?, updated_at = datetime('now') WHERE id = ?", [expiry, status, agentId]);
  } else {
    run("UPDATE agents SET lease_expires_at = NULL, lease_status = 'expired', updated_at = datetime('now') WHERE id = ?", [agentId]);
  }
}

function listLeases(query) {
  const { status } = query || {};
  const pg = paginate({ query });
  const params = [];
  let where = '';
  if (status) { where = ' WHERE lp.status = ?'; params.push(status); }
  const total = get(`SELECT COUNT(*) AS c FROM lease_payments lp ${where}`, params).c;
  const rows = all(LEASE_SELECT + where + ' ORDER BY lp.id DESC LIMIT ? OFFSET ?', [...params, pg.limit, pg.offset]);
  return { rows, meta: { total, page: pg.page, limit: pg.limit, pages: Math.max(1, Math.ceil(total / pg.limit)) } };
}

function createLease(actor, body) {
  const { agent_id, period_start, period_end, amount, status = 'paid', notes } = body || {};
  const aid = toId(agent_id);
  const agent = get('SELECT * FROM agents WHERE id = ?', [aid]);
  if (!agent) throw new ApiError(404, 'الوكيل غير موجود');

  const fee = assertAmount(Number(amount), 'مبلغ الإجارة');

  const start = parseDate(period_start, agent.lease_expires_at || new Date().toISOString());
  let end = parseDate(period_end, null);
  if (!end) {
    end = new Date(start);
    end.setFullYear(start.getFullYear() + 1);
  }
  validatePeriod(start, end);

  const payStatus = status === 'pending' ? 'pending' : 'paid';
  const payId = run(
    'INSERT INTO lease_payments (agent_id, governorate_id, district_id, amount, period_start, period_end, status, paid_at, notes) VALUES (?,?,?,?,?,?,?,?,?)',
    [aid, agent.governorate_id, agent.district_id || null, fee, start.toISOString(), end.toISOString(), payStatus, payStatus === 'paid' ? new Date().toISOString() : null, notes || 'دفعة يدوية من المسؤول']
  ).lastId;

  if (payStatus === 'paid') {
    syncAgentLease(aid);
  }

  logActivity(actor, 'create_lease', 'agent', aid, { payment_id: payId, amount: fee, period_start: start.toISOString(), period_end: end.toISOString(), status: payStatus });
  return { row: get(LEASE_SELECT + ' WHERE lp.id = ?', [payId]), created: true };
}

function updateLease(actor, id, body) {
  const lid = toId(id);
  const payment = get('SELECT * FROM lease_payments WHERE id = ?', [lid]);
  if (!payment) throw new ApiError(404, 'الدفعة غير موجودة');
  if (payment.status === 'refunded') throw new ApiError(400, 'لا يمكن تعديل دفعة ملغاة/مستردة');

  const { period_start, period_end, amount, notes } = body || {};

  const start = period_start !== undefined ? parseDate(period_start, null) : new Date(payment.period_start);
  const end = period_end !== undefined ? parseDate(period_end, null) : new Date(payment.period_end);
  validatePeriod(start, end);

  const fee = amount !== undefined ? assertAmount(Number(amount), 'مبلغ الإجارة') : payment.amount;

  run('UPDATE lease_payments SET period_start = ?, period_end = ?, amount = ?, notes = ?, updated_at = datetime(\'now\') WHERE id = ?',
    [start.toISOString(), end.toISOString(), fee, notes !== undefined ? notes : payment.notes, lid]);

  if (payment.status === 'paid') {
    syncAgentLease(payment.agent_id);
  }

  logActivity(actor, 'update_lease', 'agent', payment.agent_id, { payment_id: lid, amount: fee, period_start: start.toISOString(), period_end: end.toISOString() });
  return get(LEASE_SELECT + ' WHERE lp.id = ?', [lid]);
}

function cancelLease(actor, id, body) {
  const lid = toId(id);
  const payment = get('SELECT * FROM lease_payments WHERE id = ?', [lid]);
  if (!payment) throw new ApiError(404, 'الدفعة غير موجودة');

  if (payment.status === 'pending') {
    run("UPDATE lease_payments SET status = 'rejected', notes = ? WHERE id = ?", [body && body.reason ? body.reason : 'أُلغي من المسؤول', lid]);
    const pending = get("SELECT id FROM lease_payments WHERE agent_id = ? AND status = 'pending'", [payment.agent_id]);
    if (!pending) syncAgentLease(payment.agent_id);
    logActivity(actor, 'cancel_lease_payment', 'agent', payment.agent_id, { payment_id: lid, reason: body && body.reason });
    return get(LEASE_SELECT + ' WHERE lp.id = ?', [lid]);
  }

  if (payment.status === 'paid') {
    run("UPDATE lease_payments SET status = 'refunded', notes = ?, updated_at = datetime('now') WHERE id = ?",
      [body && body.reason ? body.reason : 'أُلغيت إجارة الوكالة من المسؤول', lid]);
    syncAgentLease(payment.agent_id);
    logActivity(actor, 'revoke_lease', 'agent', payment.agent_id, { payment_id: lid, reason: body && body.reason });
    return get(LEASE_SELECT + ' WHERE lp.id = ?', [lid]);
  }

  throw new ApiError(400, 'هذه الدفعة لم تعد قابلة للإلغاء');
}

function listAgentLeases(agentId, query) {
  const id = toId(agentId);
  const limit = Math.min(Number(query && query.limit) || 100, 500);
  return all(LEASE_SELECT + ' WHERE lp.agent_id = ? ORDER BY lp.id DESC LIMIT ?', [id, limit]);
}

function approveLease(actor, id) {
  const lid = toId(id);
  const payment = get('SELECT * FROM lease_payments WHERE id = ?', [lid]);
  if (!payment) throw new ApiError(404, 'الدفعة غير موجودة');
  if (payment.status !== 'pending') throw new ApiError(400, 'هذه الدفعة ليست بانتظار الموافقة');

  run('UPDATE lease_payments SET status = ?, paid_at = datetime(\'now\') WHERE id = ?', ['paid', lid]);
  syncAgentLease(payment.agent_id);

  const agent = get('SELECT * FROM agents WHERE id = ?', [payment.agent_id]);
  logActivity(actor, 'approve_lease', 'agent', payment.agent_id, {
    payment_id: lid, amount: payment.amount, period_end: payment.period_end, agent_name: agent ? agent.name_ar : null,
  });
  return get(LEASE_SELECT + ' WHERE lp.id = ?', [lid]);
}

function rejectLease(actor, id, body) {
  const lid = toId(id);
  const payment = get('SELECT * FROM lease_payments WHERE id = ?', [lid]);
  if (!payment) throw new ApiError(404, 'الدفعة غير موجودة');
  if (payment.status !== 'pending') throw new ApiError(400, 'هذه الدفعة ليست بانتظار الموافقة');

  run('UPDATE lease_payments SET status = ?, notes = ? WHERE id = ?', ['rejected', body && body.reason ? body.reason : null, lid]);

  const pending = get("SELECT id FROM lease_payments WHERE agent_id = ? AND status = 'pending'", [payment.agent_id]);
  if (!pending) syncAgentLease(payment.agent_id);

  logActivity(actor, 'reject_lease', 'agent', payment.agent_id, { payment_id: lid, reason: body && body.reason });
  return get(LEASE_SELECT + ' WHERE lp.id = ?', [lid]);
}

module.exports = {
  LEASE_SELECT, parseDate, validatePeriod, latestPaidExpiry, syncAgentLease,
  listLeases, createLease, updateLease, cancelLease, listAgentLeases, approveLease, rejectLease,
};
