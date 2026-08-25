// بصمة الجهاز/المتصفح: ربط الجلسة بالجهاز الذي أنشأها بحيث لا يمكن نقل التوكن
// إلى جهاز آخر واستخدامه. تُحسب من وكيل المتصفح (تطبيع خفيف) + شبكة IP (تحت الشبكة /24 أو /64)
// لا تُستخدم IP كاملاً لتجنب تسجيل خروج مستخدمي الجوال عند تغيير IP ديناميكي (NAT/شبكات خلوية).
// أي تغيير كبير في البصمة يُبطل الجلسة فوراً (إعادة دخول).
const crypto = require('crypto');
const { clientIp } = require('./rateLimit');

// تطبيع وكيل المتصفح: يُؤخذ أصل المتصفح/نظام التشغيل/الجهاز الرئيسي لا رقم الإصدار
// التفصيلي حتى لا تُبطل الجلسة عند تحديث بسيط للمتصفح.
function normalizeUA(ua) {
  const s = String(ua || '').slice(0, 300);
  const match = s.match(/(Chrome|Firefox|Safari|Edg\/|OPR\/|Version\/|Android|iPhone|iPad|Windows|Macintosh|Linux)[^()]*/);
  return match ? match[0].trim() : s.split('(')[0].trim().slice(0, 80) || 'unknown';
}

// استخراج شبكة IP (/24 لـ IPv4، /64 لـ IPv6) لتجنب تسجيل الخروج عند تغيير IP ديناميكي
function ipNetwork(ip) {
  if (!ip) return 'unknown';
  // IPv4
  if (ip.includes('.')) {
    const parts = ip.split('.');
    if (parts.length === 4) return parts.slice(0, 3).join('.') + '.0/24';
  }
  // IPv6
  if (ip.includes(':')) {
    const parts = ip.split(':');
    // تبسيط: أول 4 مجموعات (64 بت)
    if (parts.length >= 4) return parts.slice(0, 4).join(':') + '::/64';
  }
  return ip;
}

function deviceFingerprint(req) {
  const raw = `${normalizeUA(req.headers['user-agent'])}|${ipNetwork(clientIp(req))}`;
  return crypto.createHash('sha256').update(raw).digest('hex');
}

// مقارنة آمنة بالزمن الثابت بين البصمة المخزنة والحالية
function fingerprintsMatch(a, b) {
  if (!a || !b) return false;
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

module.exports = { deviceFingerprint, fingerprintsMatch };
