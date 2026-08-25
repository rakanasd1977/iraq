const express = require('express');
const config = require('../config');
const sse = require('../utils/sse');
const { ok } = require('../utils/response');
const { authenticate } = require('../middleware/auth');
const notifications = require('../services/notifications');

const router = express.Router();
router.use(authenticate);

router.get('/stream', (req, res) => {
  // تقييد عدد اتصالات SSE المتزامنة (عالمياً وللرجل نفسه) لمنع استنزاف الذاكرة/الاتصالات
  if (sse.totalClients() >= config.sse.maxClients || sse.userCount(req.user.id) >= config.sse.maxPerUser) {
    return res.status(429).json({ success: false, message: 'تجاوز حد اتصالات الإشعارات المتزامنة، يرجى المحاولة لاحقاً' });
  }
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write(': connected\n\n');
  sse.subscribe(req.user.id, res);
});

const list = (req, res, next) => {
  try {
    const { data, meta } = notifications.listNotifications(req.user.id, req.query);
    return ok(res, data, meta);
  } catch (e: any) { next(e); }
};
const markRead = (req, res, next) => {
  try { ok(res, notifications.markRead(req.params.id, req.user.id)); } catch (e: any) { next(e); }
};
const markAll = (req, res, next) => {
  try { ok(res, notifications.markAllRead(req.user.id)); } catch (e: any) { next(e); }
};
const unread = (req, res, next) => {
  try { ok(res, notifications.unreadCount(req.user.id)); } catch (e: any) { next(e); }
};

router.get('/', list);
router.post('/:id/read', markRead);
router.post('/read-all', markAll);
router.get('/unread-count', unread);

module.exports = router;
