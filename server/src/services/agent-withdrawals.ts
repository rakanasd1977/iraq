const { get, all, run } = require('../db');
const { ApiError, toId, paginate } = require('../utils/helpers');
const { logActivity } = require('../utils/log');
const { notifyUser } = require('../utils/push');

const SELECT =
  'SELECT w.*, u.name_ar AS agent_name_ar, u.email AS agent_email, g.name_ar AS governorate_name_ar, du.name_ar AS decided_by_name ' +
  'FROM agent_withdrawals w ' +
  'JOIN agents a ON a.id = w.agent_id ' +
  'JOIN users u ON u.id = a.user_id ' +
  'JOIN governorates g ON g.id = a.governorate_id ' +
  'LEFT JOIN users du ON du.id = w.decided_by';

function listWithdrawals(query) {
  const conditions = [];
  const params = [];
  if (query && query.status) { conditions.push('w.status = ?'); params.push(String(query.status)); }
  const where = conditions.length ? ' WHERE ' + conditions.join(' AND ') : '';

  const pg = paginate({ query }, 50);
  const total = get(`SELECT COUNT(*) AS c FROM agent_withdrawals w ${where}`, params).c;
  const rows = all(SELECT + where + ' ORDER BY w.id DESC LIMIT ? OFFSET ?', [...params, pg.limit, pg.offset]);

  return { rows, total, page: pg.page, limit: pg.limit, pages: Math.max(1, Math.ceil(total / pg.limit)) };
}

function decideWithdrawal(id, body, actor) {
  id = toId(id);
  const w = get('SELECT w.*, a.user_id AS agent_user_id, a.governorate_id FROM agent_withdrawals w JOIN agents a ON a.id = w.agent_id WHERE w.id = ?', [id]);
  if (!w) throw new ApiError(404, 'طلب السحب غير موجود');
  if (w.status !== 'pending') throw new ApiError(400, 'تم البت بهذا الطلب مسبقاً');

  const decision = body && body.decision;
  if (decision !== 'approved' && decision !== 'rejected') throw new ApiError(400, 'قرار غير صالح (approved/rejected)');

  const notes = String((body && body.notes) || '').slice(0, 300);
  run(
    "UPDATE agent_withdrawals SET status = ?, notes = COALESCE(?, notes), decided_by = ?, decided_at = datetime('now') WHERE id = ?",
    [decision, notes || null, actor.id, id]
  );

  logActivity(actor, `agent_withdrawal_${decision}`, 'agent', w.agent_id, { withdrawal_id: id, amount: w.amount, notes: notes || undefined });

  const agentUser = get('SELECT * FROM users WHERE id = ?', [w.agent_user_id]);
  if (agentUser) {
    notifyUser(agentUser.id, {
      type: 'wallet',
      title: decision === 'approved' ? 'تمت الموافقة على سحبك' : 'تم رفض طلب السحب',
      body: `طلب سحب بقيمة ${w.amount} دينار` + (decision === 'rejected' && notes ? ` — السبب: ${notes}` : ''),
      url: '#/wallet',
      icon: '💰',
    });
  }

  return get('SELECT * FROM agent_withdrawals WHERE id = ?', [id]);
}

module.exports = { listWithdrawals, decideWithdrawal };
