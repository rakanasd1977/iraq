const jwt = require('jsonwebtoken');
const config = require('../config');

function signToken(user, jti, ttlMs, extra = {}) {
  const payload: any = { id: user.id, role: user.role, ...extra };
  if (jti) payload.jti = jti;
  // توقيت انتهاء محدد (مثل توكن المصادقة الثنائية المؤقت) يُعبَّر عنه بالثواني
  const expiresIn = ttlMs ? Math.floor(ttlMs / 1000) : config.jwtExpiresIn;
  return jwt.sign(payload, config.jwtSecret, { expiresIn });
}

// تثبيت الخوارزمية صراحةً (HS256) لمنع هجمات خلط الخوارزميات/التوثيق.
// jsonwebtoken v9 لا يقبل مفاتيح غير HS بالفعل عند تمرير سلسلة، لكن التثبيت
// ضمان دفاعي إضافي بلا اعتماد على السلوك الافتراضي.
function verifyToken(token) {
  return jwt.verify(token, config.jwtSecret, { algorithms: ['HS256'] });
}

module.exports = { signToken, verifyToken };
