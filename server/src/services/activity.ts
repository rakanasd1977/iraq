const { get, all } = require('../db');
const { paginate, parseDateRange } = require('../utils/helpers');

const SELECT_FIELDS = `a.*, u.name_ar AS actor_name, u.email AS actor_email`;

function buildConditions(query) {
  const { action, entity_type, entity_id, actor_id } = query || {};
  const { fromUtc, toUtc } = parseDateRange(query && query.from, query && query.to);
  const params = [];
  const conditions = [];
  if (action) { conditions.push('a.action = ?'); params.push(action); }
  if (entity_type) { conditions.push('a.entity_type = ?'); params.push(entity_type); }
  if (entity_id) { conditions.push('a.entity_id = ?'); params.push(Number(entity_id)); }
  if (actor_id) { conditions.push('a.user_id = ?'); params.push(Number(actor_id)); }
  if (fromUtc) { conditions.push("strftime('%s', a.created_at) >= strftime('%s', ?)"); params.push(fromUtc); }
  if (toUtc) { conditions.push("strftime('%s', a.created_at) <= strftime('%s', ?)"); params.push(toUtc); }
  const where = conditions.length ? ' WHERE ' + conditions.join(' AND ') : '';
  return { where, params };
}

function listActivity(query) {
  const { where, params } = buildConditions(query);
  const pg = paginate({ query }, 100);
  const total = get(`SELECT COUNT(*) AS c FROM activity_log a ${where}`, params).c;
  const rows = all(
    `SELECT ${SELECT_FIELDS}
     FROM activity_log a
     LEFT JOIN users u ON u.id = a.user_id
     ${where} ORDER BY a.id DESC LIMIT ? OFFSET ?`,
    [...params, pg.limit, pg.offset]
  );
  return { rows, total, page: pg.page, limit: pg.limit, pages: Math.max(1, Math.ceil(total / pg.limit)) };
}

function exportActivityRows(query) {
  const { where, params } = buildConditions(query);
  return all(
    `SELECT ${SELECT_FIELDS}
     FROM activity_log a
     LEFT JOIN users u ON u.id = a.user_id
     ${where} ORDER BY a.id DESC`,
    params
  );
}

module.exports = { listActivity, exportActivityRows };
