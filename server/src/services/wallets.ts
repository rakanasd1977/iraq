const { get, all, run, transaction } = require('../db');
const { ApiError, toId, round2, paginate, assertAmount, settingValue } = require('../utils/helpers');
const { ok } = require('../utils/response');
const { logActivity } = require('../utils/log');
const { ensureWallet } = require('../utils/wallet');

function getProviderWallet(actor) {
  if (actor.role !== 'provider') throw new ApiError(403, 'خاص بحسابات المزودين');
  const pid = actor.provider_id;
  const w = ensureWallet(pid);
  const txs = all('SELECT * FROM wallet_transactions WHERE provider_id = ? ORDER BY id DESC LIMIT 100', [pid]);
  const freeLimit = Number(settingValue('provider_free_orders', 5)) || 0;
  const acceptedCount = Number(get(
    "SELECT COUNT(*) c FROM orders WHERE provider_id = ? AND status IN ('confirmed','in_progress','completed')",
    [pid]
  ).c) || 0;
  const free_orders_remaining = freeLimit > 0 ? Math.max(0, freeLimit - acceptedCount) : 0;
  return {
    provider_id: pid,
    balance: round2(w.balance),
    transactions: txs,
    free_orders_limit: freeLimit,
    accepted_count: acceptedCount,
    free_orders_remaining,
  };
}

function listWallets(query) {
  const { q } = query || {};
  const where = [];
  const params = [];
  if (q) {
    where.push('(p.name_ar LIKE ? OR u.email LIKE ? OR g.name_ar LIKE ?)');
    const like = `%${String(q)}%`;
    params.push(like, like, like);
  }
  const wSql = where.length ? ' WHERE ' + where.join(' AND ') : '';
  const pg = paginate({ query });
  const total = get(`SELECT COUNT(*) AS c FROM providers p JOIN users u ON u.id = p.user_id LEFT JOIN governorates g ON g.id = p.governorate_id ${wSql}`, params).c;
  const rows = all(`
    SELECT p.id AS provider_id, p.name_ar AS provider_name, p.commission_rate,
           p.governorate_id, g.name_ar AS governorate_name_ar, s.name_ar AS service_name_ar,
           COALESCE(w.balance, 0) AS balance,
           (SELECT COUNT(*) FROM wallet_transactions wt WHERE wt.provider_id = p.id) AS tx_count
    FROM providers p
    JOIN users u ON u.id = p.user_id
    LEFT JOIN governorates g ON g.id = p.governorate_id
    LEFT JOIN services s ON s.id = p.service_id
    LEFT JOIN provider_wallets w ON w.provider_id = p.id
    ${wSql}
    ORDER BY p.id ASC
    LIMIT ? OFFSET ?
  `, [...params, pg.limit, pg.offset]);
  return { rows, meta: { total, page: pg.page, limit: pg.limit, pages: Math.max(1, Math.ceil(total / pg.limit)) } };
}

function getAgentLedger(actor) {
  if (actor.role !== 'agent') throw new ApiError(403, 'خاص بحسابات الوكلاء');
  const gid = actor.governorate_id;
  const providers = all(`
    SELECT p.id AS provider_id, p.name_ar AS provider_name,
           COALESCE(w.balance, 0) AS balance
    FROM providers p
    LEFT JOIN provider_wallets w ON w.provider_id = p.id
    WHERE p.governorate_id = ?
    ORDER BY p.id
  `, [gid]);
  const txs = all(`
    SELECT wt.*, p.name_ar AS provider_name
    FROM wallet_transactions wt
    JOIN providers p ON p.id = wt.provider_id
    WHERE p.governorate_id = ? AND (wt.type = 'commission' OR wt.type = 'refund')
    ORDER BY wt.id DESC LIMIT 200
  `, [gid]);
  return { providers, transactions: txs };
}

function getWalletDetail(actor, id) {
  const pid = toId(id);
  const p = get('SELECT * FROM providers WHERE id = ?', [pid]);
  if (!p) throw new ApiError(404, 'المزود غير موجود');
  const w = ensureWallet(pid);
  const txs = all('SELECT * FROM wallet_transactions WHERE provider_id = ? ORDER BY id DESC LIMIT 200', [pid]);
  return { provider_id: pid, balance: round2(w.balance), transactions: txs };
}

function rechargeWallet(actor, id, body) {
  const pid = toId(id);
  const p = get('SELECT * FROM providers WHERE id = ?', [pid]);
  if (!p) throw new ApiError(404, 'المزود غير موجود');
  const amount = assertAmount(Number(body && body.amount), 'مبلغ الشحن');
  if (amount <= 0) throw new ApiError(400, 'أدخل مبلغ شحن صحيحاً أكبر من صفر');
  const note = body && body.note ? String(body.note).trim() : 'شحن رصيد';

  const balanceAfter = transaction(() => {
    const w = ensureWallet(pid);
    const nextBalance = round2(Number(w.balance) + amount);
    run("UPDATE provider_wallets SET balance = ?, updated_at = datetime('now') WHERE provider_id = ?", [nextBalance, pid]);
    run(
      'INSERT INTO wallet_transactions (provider_id, type, amount, agent_amount, platform_amount, balance_after, note, created_by) VALUES (?,?,?,?,?,?,?,?)',
      [pid, 'recharge', round2(amount), 0, 0, nextBalance, note, actor.name_ar || actor.email]
    );
    return nextBalance;
  });

  logActivity(actor, 'wallet_recharge', 'provider', pid, { amount: round2(amount), balance: balanceAfter });
  return { provider_id: pid, balance: balanceAfter, amount: round2(amount) };
}

module.exports = { getProviderWallet, listWallets, getAgentLedger, getWalletDetail, rechargeWallet };
