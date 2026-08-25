const { get, all, run } = require('../db');
const { ApiError } = require('../utils/helpers');
const { logActivity } = require('../utils/log');

const KEYS = ['platform_commission_default', 'agent_default_commission', 'currency'];

function validRate(value) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 && n <= 100;
}

function readCommissions() {
  const rows = all('SELECT key, value FROM settings WHERE key IN (' + KEYS.map(() => '?').join(',') + ')', KEYS);
  const out = {};
  rows.forEach((r) => { out[r.key] = r.value; });
  return out;
}

function updateCommissions(actor, body) {
  const { platform_commission_default, agent_default_commission, currency } = body || {};
  const updates = [];
  const params = [];
  if (platform_commission_default !== undefined) {
    if (!validRate(platform_commission_default)) {
      throw new ApiError(400, 'نسبة العمولة يجب أن تكون رقماً بين 0 و 100');
    }
    updates.push('platform_commission_default');
    params.push(String(platform_commission_default));
  }
  if (agent_default_commission !== undefined) {
    if (!validRate(agent_default_commission)) {
      throw new ApiError(400, 'نسبة عمولة الوكيل يجب أن تكون رقماً بين 0 و 100');
    }
    updates.push('agent_default_commission');
    params.push(String(agent_default_commission));
  }
  if (currency !== undefined) {
    updates.push('currency');
    params.push(String(currency));
  }

  for (let i = 0; i < updates.length; i++) {
    const exists = get('SELECT key FROM settings WHERE key = ?', [updates[i]]);
    if (exists) {
      run('UPDATE settings SET value = ?, updated_at = datetime(\'now\') WHERE key = ?', [params[i], updates[i]]);
    } else {
      run('INSERT INTO settings (key, value) VALUES (?,?)', [updates[i], params[i]]);
    }
  }

  logActivity(actor, 'update', 'commissions', null, updates.reduce((o, k, i) => ({ ...o, [k]: params[i] }), {}));
  return readCommissions();
}

module.exports = { KEYS, validRate, getCommissions: readCommissions, updateCommissions };
