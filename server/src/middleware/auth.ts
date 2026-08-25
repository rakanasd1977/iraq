const { verifyToken } = require('../utils/jwt');
const { get, run } = require('../db');
const { ApiError } = require('../utils/helpers');
const { isLiveSession } = require('../utils/session');
const { fingerprintsMatch, deviceFingerprint } = require('../utils/fingerprint');
const { readCookie } = require('../utils/csrf');
const config = require('../config');

// استخراج التوكن: من رأس Authorization (Bearer) أولاً، ومن كوكي HttpOnly كبديل
// أثناء ترحيل الكوكي. التوكن الموجود في الكوكي فقط عندما لا يُرسل رأس.
function extractToken(req) {
  const header = req.headers.authorization || '';
  if (header.startsWith('Bearer ')) return header.slice(7);
  const cookieToken = readCookie(req, config.cookie.name);
  if (cookieToken) return cookieToken;
  return null;
}

const { PRIVILEGED_ROLES } = require('../utils/roles');

function authenticate(req, res, next) {
  const token = extractToken(req);
  if (!token) return next(new ApiError(401, 'غير مصرح بالدخول، يرجى تسجيل الدخول'));

  let payload;
  try {
    payload = verifyToken(token);
  } catch (e: any) {
    return next(new ApiError(401, 'انتهت صلاحية الجلسة، يرجى تسجيل الدخول مجدداً'));
  }

  // توكن جديد يحمل jti: يتطلب جلسة حية غير مُبطلة (تسجيل الخروج يقتل التوكن فوراً).
  // توكن إصدار أقدم (بلا jti) يُقبل حتى انتهاء صلاحيته من أجل انتقال تدريجي سلس.
  if (payload.jti && !isLiveSession(payload.jti)) {
    return next(new ApiError(401, 'انتهت صلاحية الجلسة، يرجى تسجيل الدخول مجدداً'));
  }

  // توكن مؤقت للمصادقة الثنائية ليس جلسة كاملة
  if (payload.twofa_pending) {
    return next(new ApiError(403, 'يرجى إكمال التحقق بخطوتين أولاً'));
  }

  req.tokenPayload = payload;

  const user = get('SELECT * FROM users WHERE id = ?', [payload.id]);
  if (!user) return next(new ApiError(401, 'الحساب غير موجود'));
  if (!user.is_active) return next(new ApiError(403, 'هذا الحساب موقوف، يرجى التواصل مع الإدارة'));

  // ربط جلسات حسابات الامتياز ببصمة الجهاز: أي طلب من بصمة مختلفة يُقتل فوراً.
  // (لا يُفرض على الزبائن حتى لا يُسجَّلون خارجاً عند تغيّر عنوان IP لشبكة الجوال.)
  if (payload.jti && PRIVILEGED_ROLES.includes(user.role) && !String(payload.jti).startsWith('2fa-')) {
    const sess = get('SELECT fingerprint FROM sessions WHERE id = ?', [payload.jti]);
    if (sess && sess.fingerprint && !fingerprintsMatch(sess.fingerprint, deviceFingerprint(req))) {
      // توكن مسروق/منقول لجهاز آخر: نقتل الجلسة فوراً
      run('DELETE FROM sessions WHERE id = ?', [payload.jti]);
      return next(new ApiError(401, 'تغيّر الجهاز المتصل، يرجى تسجيل الدخول مجدداً'));
    }
  }

  req.user = { id: user.id, role: user.role, email: user.email, name_ar: user.name_ar };

  if (user.role === 'agent') {
    const agent = get('SELECT * FROM agents WHERE user_id = ?', [user.id]);
    if (agent) {
      req.user.agent_id = agent.id;
      req.user.governorate_id = agent.governorate_id;
      req.user.district_id = agent.district_id;
      req.user.agent_commission_rate = agent.commission_rate;
      req.user.lease_status = agent.lease_status;
      req.user.lease_expires_at = agent.lease_expires_at;
    }
  } else if (user.role === 'provider') {
    const provider = get('SELECT * FROM providers WHERE user_id = ?', [user.id]);
    if (provider) {
      req.user.provider_id = provider.id;
      req.user.service_id = provider.service_id;
      req.user.governorate_id = provider.governorate_id;
    }
  }

  next();
}

module.exports = { authenticate };
