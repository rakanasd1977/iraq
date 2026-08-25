const { get, all, run } = require('../db');
const { ApiError, paginate } = require('../utils/helpers');

function listNotifications(userId, query) {
  const { page, limit } = paginate({ query }, 30);
  const total = get('SELECT COUNT(*) AS c FROM notifications WHERE user_id = ?', [userId]).c;
  const rows = all(
    'SELECT id, type, title, body, url, icon, is_read, created_at FROM notifications WHERE user_id = ? ORDER BY id DESC LIMIT ? OFFSET ?',
    [userId, limit, (page - 1) * limit]
  );
  const unread = get('SELECT COUNT(*) AS c FROM notifications WHERE user_id = ? AND is_read = 0', [userId]).c;
  return {
    data: rows,
    meta: { total, page, limit, pages: Math.max(1, Math.ceil(total / limit)), unread },
  };
}

function markRead(id, userId) {
  id = Number(id);
  if (!Number.isInteger(id)) throw new ApiError(400, 'معرّف غير صالح');
  const r = run('UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ?', [id, userId]);
  if (r.changes === 0) {
    const exists = get('SELECT id FROM notifications WHERE id = ?', [id]);
    if (exists) throw new ApiError(403, 'هذا الإشعار ليس لك');
    throw new ApiError(404, 'الإشعار غير موجود');
  }
  const unread = get('SELECT COUNT(*) AS c FROM notifications WHERE user_id = ? AND is_read = 0', [userId]).c;
  return { id, read: true, unread };
}

function markAllRead(userId) {
  run('UPDATE notifications SET is_read = 1 WHERE user_id = ? AND is_read = 0', [userId]);
  return { read_all: true, unread: 0 };
}

function unreadCount(userId) {
  return { unread: get('SELECT COUNT(*) AS c FROM notifications WHERE user_id = ? AND is_read = 0', [userId]).c };
}

module.exports = { listNotifications, markRead, markAllRead, unreadCount };
