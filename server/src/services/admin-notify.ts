const { all } = require('../db');
const { ApiError } = require('../utils/helpers');
const { notifyUser } = require('../utils/push');

async function sendNotification({ title, body, target = 'all', role, governorate_id, url = '', icon = '📢' }, actor) {
  if (!title || !String(title).trim()) throw new ApiError(400, 'عنوان الإشعار مطلوب');
  if (!body || !String(body).trim()) throw new ApiError(400, 'نص الإشعار مطلوب');

  let userRows = [];
  if (target === 'governorate') {
    if (!governorate_id) throw new ApiError(400, 'اختر محافظة لإرسال الإشعار');
    userRows = all('SELECT id FROM users WHERE governorate_id = ? AND is_active = 1', [Number(governorate_id)]);
  } else if (target === 'role') {
    if (!role) throw new ApiError(400, 'اختر الدور لإرسال الإشعار');
    userRows = all('SELECT id FROM users WHERE role = ? AND is_active = 1', [role]);
  } else {
    userRows = all("SELECT id FROM users WHERE role IN ('customer','provider','agent') AND is_active = 1");
  }

  const payload = { type: 'announcement', title: String(title).trim(), body: String(body).trim(), url: url || '', icon: icon || '📢' };
  let pushSent = 0;
  for (const u of userRows) {
    try {
      const r = await notifyUser(u.id, payload);
      pushSent += (r && r.sent) || 0;
    } catch (e) { /* تجاهل فشل إشعار مستخدم واحد */ }
  }
  return { recipients: userRows.length, push_sent: pushSent };
}

module.exports = { sendNotification };
