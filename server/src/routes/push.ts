const express = require('express');
const { run, get } = require('../db');
const { ApiError } = require('../utils/helpers');
const { ok } = require('../utils/response');
const { authenticate } = require('../middleware/auth');
const { publicVapidKey } = require('../utils/push');

const router = express.Router();
router.use(authenticate);

// GET /api/push/vapid-key — المفتاح العمومي لتشفير إشعارات المتصفح
router.get('/vapid-key', (req, res) => {
  if (!publicVapidKey) throw new ApiError(503, 'الإشعارات الفورية غير مفعّلة حالياً');
  return ok(res, { public_key: publicVapidKey });
});

// POST /api/push/subscribe — تسجيل جهاز/متصفح لاستقبال الإشعارات
router.post('/subscribe', (req, res, next) => {
  try {
    const endpoint = String((req.body && req.body.endpoint) || '');
    const keys = req.body && req.body.keys;
    if (!endpoint.startsWith('https://') && !endpoint.startsWith('http://localhost')) {
      throw new ApiError(400, 'اشتراك إشعار غير صالح');
    }
    if (!keys || !keys.p256dh || !keys.auth) throw new ApiError(400, 'مفاتيح الإشعار غير مكتملة');

    // endpoint فريد — إن كان مسجلاً لمستخدم آخر فلا يحق لنا انتزاعه (منع خطف اشتراك الغير)
    const existing = get('SELECT user_id FROM push_subscriptions WHERE endpoint = ?', [endpoint]);
    if (existing && existing.user_id !== req.user.id) {
      throw new ApiError(403, 'نقطة الاشتراك مسجلة لحساب آخر');
    }

    run(
      `INSERT INTO push_subscriptions (user_id, endpoint, keys_json, user_agent)
       VALUES (?,?,?,?)
       ON CONFLICT(endpoint) DO UPDATE SET
         keys_json = excluded.keys_json,
         user_agent = excluded.user_agent,
         last_seen_at = datetime('now')`,
      [req.user.id, endpoint, JSON.stringify({ p256dh: keys.p256dh, auth: keys.auth }), (req.headers['user-agent'] || '').slice(0, 300)]
    );
    return ok(res, { subscribed: true });
  } catch (e: any) { next(e); }
});

// POST /api/push/unsubscribe — إلغاء تسجيل جهاز
router.post('/unsubscribe', (req, res, next) => {
  try {
    const endpoint = String((req.body && req.body.endpoint) || '');
    if (!endpoint) throw new ApiError(400, 'نقطة الاشتراك مطلوبة');
    // لا يحذف المستخدم إلا اشتراكه هو (منع إلغاء اشتراك الغير عند معرفة endpoint)
    run('DELETE FROM push_subscriptions WHERE endpoint = ? AND user_id = ?', [endpoint, req.user.id]);
    return ok(res, { unsubscribed: true });
  } catch (e: any) { next(e); }
});

module.exports = router;
