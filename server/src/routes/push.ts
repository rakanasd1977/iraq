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

// يمنع استهداف المضيفين الداخليين (SSRF) عند الاشتراك بإشعارات الويب
function isBlockedPushHost(hostname) {
  if (!hostname) return true;
  const h = String(hostname).toLowerCase();
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.internal') || h.endsWith('.local')) return true;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(h)) {
    const p = h.split('.').map(Number);
    if (p.some((n) => n > 255)) return true;
    const [a, b] = p;
    if (a === 10 || a === 127 || a === 0) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
  }
  if (h === '::1' || h.startsWith('fe80')) return true;
  return false;
}

// POST /api/push/subscribe — تسجيل جهاز/متصفح لاستقبال الإشعارات
router.post('/subscribe', (req, res, next) => {
  try {
    const endpoint = String((req.body && req.body.endpoint) || '');
    const keys = req.body && req.body.keys;
    let url;
    try { url = new URL(endpoint); } catch (e) { throw new ApiError(400, 'اشتراك إشعار غير صالح'); }
    if (url.protocol !== 'https:' || isBlockedPushHost(url.hostname)) {
      throw new ApiError(400, 'يشترط استخدام نقطة نهاية HTTPS عامة وصالحة للاشتراك');
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
