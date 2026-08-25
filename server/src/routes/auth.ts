const express = require('express');
const crypto = require('crypto');
const { get, run, transaction } = require('../db');
const { ApiError, assertLength } = require('../utils/helpers');
const { issueToken, issue2FAChallenge, revokeSession, revokeAllSessions, revokeAllExceptSession, jwtTtlMs } = require('../utils/session');
const { hashPassword, verifyPassword, DUMMY_HASH } = require('../utils/password');
const { generateSecret, verifyCode, otpauthURI } = require('../utils/totp');
const { encryptTotp, decryptTotp } = require('../utils/crypto');
const { recordFailure, clearFailures, lockRemaining } = require('../utils/lockout');
const { ok, created } = require('../utils/response');
const { authenticate } = require('../middleware/auth');
const { requireAgentLease, requireRole } = require('../middleware/rbac');
const { rateLimit } = require('../utils/rateLimit');
const { logActivity } = require('../utils/log');
const { setCsrf, clearCookies, csrfProtect } = require('../utils/csrf');
const config = require('../config');
const { PRIVILEGED_ROLES } = require('../utils/roles');

const { enrichUser, attachAdminRoles } = require('../services/auth');

const router = express.Router();
const VERIFY_TTL_MS = 24 * 3600000;

// أدوار تُلزم بالمصادقة الثنائية إن فُعِّلت (حسابات الامتياز: مسؤول/وكيل/مزود)

// تفعيل الجلسة على المستعرض: كوكي HttpOnly للتوكن + كوكي CSRF + إعادة التوكن في الجسم
// لبقاء دعم تطبيقات الجوال (Bearer) حتى اكتمال الترحيل للكوكي.
function establishSession(res, user, token) {
  res.setHeader('Set-Cookie', `${config.cookie.name}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(jwtTtlMs() / 1000)}${config.cookie.secure ? '; Secure' : ''}`);
  const csrfToken = setCsrf(res, user, jwtTtlMs());
  return csrfToken;
}

// POST /api/auth/login
router.post('/login', rateLimit, async (req, res, next) => {
  try {
    const { email, password, role } = req.body || {};
    if (!email || !password) throw new ApiError(400, 'يرجى إدخال البريد وكلمة المرور');
    if (String(password).length > 72) throw new ApiError(400, 'كلمة المرور طويلة جداً');

    const identifier = String(email).trim().toLowerCase();
    const ip = require('../utils/rateLimit').clientIp(req);

    // قفل الحساب: محاولات فاشلة متكررة تمنع الدخول مؤقتاً
    const remaining = lockRemaining(identifier, ip);
    if (remaining !== null) {
      throw new ApiError(429, `محاولات فاشلة كثيرة، يرجى المحاولة بعد ${Math.ceil(remaining / 60)} دقيقة`);
    }

    const user = get('SELECT * FROM users WHERE email = ?', [identifier]);
    // مقارنة bcrypt تُنفَّذ دائماً (بتجزئة وهمية عند غياب الحساب) حتى لا يكشف زمن الاستجابة وجود البريد
    const passwordOk = await verifyPassword(password, user ? user.password_hash : DUMMY_HASH);
    if (!user || !passwordOk) {
      recordFailure(identifier, ip);
      throw new ApiError(401, 'البريد الإلكتروني أو كلمة المرور غير صحيحة');
    }
    if (role && user.role !== role) {
      recordFailure(identifier, ip);
      throw new ApiError(403, 'هذا الحساب غير مسموح له بالدخول من هذه اللوحة');
    }
    if (!user.is_active) {
      throw new ApiError(403, 'هذا الحساب موقوف، يرجى التواصل مع الإدارة');
    }
    if (user.role === 'customer' && !user.is_verified) {
      throw new ApiError(403, 'حسابك لم يُفعَّل بعد، يرجى تفعيل البريد عبر رابط التأكيد');
    }

    clearFailures(identifier, ip);

    // المصادقة الثنائية: عند التفعيل يُعطى توكن مؤقت (5 دقائق) بدل الجلسة الكاملة
    if (user.totp_enabled) {
      const twofaToken = issue2FAChallenge(user, req);
      logActivity(user, 'login_2fa_pending', 'user', user.id, { role: user.role });
      return ok(res, { requires_2fa: true, twofa_token: twofaToken, user: { id: user.id, role: user.role, totp_enabled: true } });
    }

    const token = issueToken(user, req);
    const csrfToken = establishSession(res, user, token);
    logActivity(user, 'login', 'user', user.id, { role: user.role });
    const out = enrichUser(user);
    if (user.role === 'admin') attachAdminRoles(out, user.id);
    return ok(res, { token, csrf_token: csrfToken, user: out });
  } catch (e: any) {
    next(e);
  }
});

// POST /api/auth/2fa/verify — إكمال الدخول بعد إدخال رمز المصادقة الثنائية
router.post('/2fa/verify', rateLimit, async (req, res, next) => {
  try {
    const { twofa_token, code } = req.body || {};
    if (!twofa_token || !code) throw new ApiError(400, 'رمز التحقق مطلوب');

    let payload;
    try {
      payload = require('../utils/jwt').verifyToken(String(twofa_token));
    } catch (e: any) {
      throw new ApiError(400, 'انتهت صلاحية خطوة التحقق، يرجى إعادة تسجيل الدخول');
    }
    if (!payload.twofa_pending || !PRIVILEGED_ROLES.includes(payload.role)) {
      throw new ApiError(400, 'رمز تحقق غير صالح');
    }

    const user = get('SELECT * FROM users WHERE id = ?', [payload.id]);
    if (!user || !user.totp_enabled || !user.totp_secret) throw new ApiError(400, 'المصادقة الثنائية غير مفعّلة لهذا الحساب');
    if (!user.is_active) throw new ApiError(403, 'هذا الحساب موقوف');

    if (!verifyCode(decryptTotp(user.totp_secret), code)) {
      throw new ApiError(401, 'رمز التحقق غير صحيح');
    }

    const token = issueToken(user, req);
    const csrfToken = establishSession(res, user, token);
    logActivity(user, 'login', 'user', user.id, { role: user.role, twofa: true });
    const out = enrichUser(user);
    if (user.role === 'admin') attachAdminRoles(out, user.id);
    return ok(res, { token, csrf_token: csrfToken, user: out });
  } catch (e: any) {
    next(e);
  }
});

// POST /api/auth/2fa/setup — تحضير المصادقة الثنائية (توليد سر + رابط otpauth)
router.post('/2fa/setup', authenticate, (req, res, next) => {
  try {
    if (!PRIVILEGED_ROLES.includes(req.user.role)) {
      throw new ApiError(403, 'المصادقة الثنائية متاحة لحسابات الامتياز فقط');
    }
    const user = get('SELECT * FROM users WHERE id = ?', [req.user.id]);
    const secret = generateSecret();
    const uri = otpauthURI(secret, user.email || user.name_ar);
    // يُحفظ السر فوراً (حالة pending) ولا يُفعَّل until يثبت المستخدم امتلاكه للرمز — مشفّر عند الراحة
    run('UPDATE users SET totp_secret = ?, updated_at = datetime(\'now\') WHERE id = ?', [encryptTotp(secret), user.id]);
    return ok(res, {
      secret,
      otpauth_uri: uri,
      qr_url: `https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(uri)}`,
      message: 'امسح الرمز QR بتطبيق المصادقة ثم فعّل الحساب بالرمز التالي',
    });
  } catch (e: any) {
    next(e);
  }
});

// POST /api/auth/2fa/enable — تفعيل المصادقة الثنائية بعد التحقق من رمز حي
router.post('/2fa/enable', authenticate, (req, res, next) => {
  try {
    const { code } = req.body || {};
    if (!code) throw new ApiError(400, 'رمز التحقق مطلوب');
    const user = get('SELECT * FROM users WHERE id = ?', [req.user.id]);
    if (!user.totp_secret) throw new ApiError(400, 'ابدأ خطوة الإعداد أولاً (setup)');
    if (!verifyCode(decryptTotp(user.totp_secret), code)) throw new ApiError(401, 'رمز التحقق غير صحيح');

    run('UPDATE users SET totp_enabled = 1, updated_at = datetime(\'now\') WHERE id = ?', [user.id]);
    logActivity(req.user, 'enable_2fa', 'user', user.id);
    return ok(res, { message: 'تم تفعيل المصادقة الثنائية' });
  } catch (e: any) {
    next(e);
  }
});

// POST /api/auth/2fa/disable — إيقاف المصادقة الثنائية (يتطلب رمزاً صحيحاً)
router.post('/2fa/disable', authenticate, (req, res, next) => {
  try {
    const { code } = req.body || {};
    const user = get('SELECT * FROM users WHERE id = ?', [req.user.id]);
    if (!user.totp_enabled) throw new ApiError(400, 'المصادقة الثنائية غير مفعّلة');
    if (!verifyCode(decryptTotp(user.totp_secret), code || '')) throw new ApiError(401, 'رمز التحقق غير صحيح');

    run('UPDATE users SET totp_enabled = 0, totp_secret = NULL, updated_at = datetime(\'now\') WHERE id = ?', [user.id]);
    logActivity(req.user, 'disable_2fa', 'user', user.id);
    return ok(res, { message: 'تم إيقاف المصادقة الثنائية' });
  } catch (e: any) {
    next(e);
  }
});

// POST /api/auth/2fa/reset — المسؤول فقط: إلغاء تفعيل 2FA لحساب آخر (استرداد وصول)
router.post('/2fa/reset', authenticate, async (req, res, next) => {
  try {
    if (req.user.role !== 'admin') throw new ApiError(403, 'متاح للمسؤول فقط');
    const user_id = Number(req.body && req.body.user_id);
    if (!Number.isInteger(user_id) || user_id <= 0) throw new ApiError(400, 'معرف الحساب غير صحيح');

    const target = get('SELECT id, role FROM users WHERE id = ?', [user_id]);
    if (!target) throw new ApiError(404, 'الحساب غير موجود');
    if (target.role === 'admin' && target.id !== req.user.id) {
      throw new ApiError(403, 'لا يمكن إلغاء المصادقة الثنائية لحساب مسؤول آخر');
    }

    run('UPDATE users SET totp_enabled = 0, totp_secret = NULL, updated_at = datetime(\'now\') WHERE id = ?', [user_id]);
    revokeAllSessions(user_id);
    logActivity(req.user, 'reset_2fa', 'user', user_id);
    return ok(res, { message: 'تم إلغاء المصادقة الثنائية وإبطال جلسات الحساب' });
  } catch (e: any) {
    next(e);
  }
});

// GET /api/auth/me
router.get('/me', authenticate, (req, res, next) => {
  try {
    const user = get('SELECT * FROM users WHERE id = ?', [req.user.id]);
    if (!user) throw new ApiError(404, 'الحساب غير موجود');
    const out = enrichUser(user);
    if (user.role === 'admin') attachAdminRoles(out, user.id);
    return ok(res, out);
  } catch (e: any) {
    next(e);
  }
});

// POST /api/auth/change-password
router.post('/change-password', authenticate, csrfProtect, async (req, res, next) => {
  try {
    const { current_password, new_password } = req.body || {};
    if (!current_password || !new_password) throw new ApiError(400, 'يرجى إدخال كلمة المرور الحالية والجديدة');
    assertLength(new_password, 72, 'كلمة المرور الجديدة', 6);

    const user = get('SELECT * FROM users WHERE id = ?', [req.user.id]);
    if (!(await verifyPassword(current_password, user.password_hash))) {
      throw new ApiError(400, 'كلمة المرور الحالية غير صحيحة');
    }
    run('UPDATE users SET password_hash = ?, updated_at = datetime(\'now\') WHERE id = ?', [await hashPassword(new_password), user.id]);
    // إبطال كل الجلسات الأخرى فوراً (يبقى هذا الجهاز مسجلاً) — أمان بعد تغيير كلمة المرور
    revokeAllExceptSession(user.id, req.tokenPayload && req.tokenPayload.jti);
    logActivity(req.user, 'change_password', 'user', user.id);
    return ok(res, { message: 'تم تغيير كلمة المرور بنجاح' });
  } catch (e: any) {
    next(e);
  }
});

// POST /api/auth/register-customer (تطبيق الزبون)
router.post('/register-customer', rateLimit, async (req, res, next) => {
  try {
    const { name_ar, email, phone, password, governorate_id, address, referral_code } = req.body || {};
    if (!name_ar || !email || !phone || !password) throw new ApiError(400, 'يرجى ملء الحقول المطلوبة');
    assertLength(name_ar, 100, 'الاسم');
    assertLength(phone, 20, 'رقم الهاتف');
    const cleanEmail = assertLength(String(email).trim().toLowerCase(), 120, 'البريد الإلكتروني');
    assertLength(password, 72, 'كلمة المرور', 6);

    const exists = get('SELECT id FROM users WHERE email = ? OR phone = ?', [cleanEmail, phone]);
    if (exists) throw new ApiError(409, 'البريد أو رقم الهاتف مستخدم مسبقاً');

    const govId = governorate_id ? Number(governorate_id) : null;
    if (govId && !get('SELECT id FROM governorates WHERE id = ?', [govId])) throw new ApiError(400, 'المحافظة غير موجودة');

    // كود إحالة صديق: ربط المدعو بالداعي عند التسجيل (اختياري).
    let referredBy = null;
    const refCode = String(referral_code || '').trim().toUpperCase();
    if (refCode) {
      const referrer = get('SELECT id FROM users WHERE role = ? AND referral_code = ?', ['customer', refCode]);
      if (!referrer) throw new ApiError(400, 'كود الإحالة غير صالح');
      referredBy = referrer.id;
    }

    const passwordHash = await hashPassword(password);
    let userId, verifyToken;
    transaction(() => {
      userId = run(
        'INSERT INTO users (role, name_ar, email, phone, password_hash, governorate_id, is_active, is_verified, referred_by) VALUES (?,?,?,?,?,?,1,0,?)',
        ['customer', name_ar, cleanEmail, phone, passwordHash, govId, referredBy]
      ).lastId;
      // كود إحالة فريد يُولَّد بعد معرفة id (RAF + ترميز المعرف).
      run('UPDATE users SET referral_code = ? WHERE id = ?', ['RAF' + (100000 + userId).toString(36).toUpperCase(), userId]);
      run('INSERT INTO customers (user_id, governorate_id, address) VALUES (?,?,?)', [userId, govId, address || null]);

      // رمز تفعيل يُرسل عبر البريد (في تطبيق الإنتاج)؛ هنا يُسجَّل في السجل لتسهيل التطوير/الاختبار
      verifyToken = crypto.randomBytes(32).toString('hex');
      const expiresAt = new Date(Date.now() + VERIFY_TTL_MS).toISOString().replace('T', ' ').slice(0, 19);
      run('INSERT INTO user_verifications (user_id, token, expires_at) VALUES (?,?,?)', [userId, verifyToken, expiresAt]);
    });

    const user = get('SELECT * FROM users WHERE id = ?', [userId]);
    logActivity(null, 'register_customer', 'user', userId, { verified: false });
    // رمز التفعيل يُعاد للعميل في بيئات التطوير/الاختبار فقط (وضع تجريبي) —
    // في الإنتاج يُرسل عبر البريد/الرسائل ولا يُكشف في الاستجابة إطلاقاً.
    const payload: any = {
      user: enrichUser(user),
      message: 'تم إنشاء الحساب، يرجى تفعيل البريد عبر رمز التأكيد قبل تسجيل الدخول',
    };
    if (config.env !== 'production') payload.verification_token = verifyToken;
    return created(res, payload);
  } catch (e: any) {
    next(e);
  }
});

// POST /api/auth/verify-email — تفعيل حساب الزبون برمز التأكيد
router.post('/verify-email', rateLimit, (req, res, next) => {
  try {
    const { token } = req.body || {};
    if (!token) throw new ApiError(400, 'رمز التأكيد مطلوب');

    const row = get('SELECT * FROM user_verifications WHERE token = ?', [String(token)]);
    if (!row) throw new ApiError(400, 'رمز التأكيد غير صالح أو مستخدم مسبقاً');
    if (new Date(row.expires_at) < new Date()) throw new ApiError(400, 'انتهت صلاحية رمز التأكيد');

    run('UPDATE users SET is_verified = 1, updated_at = datetime(\'now\') WHERE id = ?', [row.user_id]);
    run('DELETE FROM user_verifications WHERE user_id = ?', [row.user_id]);

    const user = get('SELECT * FROM users WHERE id = ?', [row.user_id]);
    if (!user || !user.is_active) throw new ApiError(403, 'هذا الحساب موقوف');
    const jwt = issueToken(user, req);
    establishSession(res, user, jwt);
    logActivity(user, 'verify_email', 'user', user.id);
    return ok(res, { token: jwt, user: enrichUser(user), message: 'تم تفعيل الحساب بنجاح' });
  } catch (e: any) {
    next(e);
  }
});

// POST /api/auth/logout — إبطال توكن الجلسة الحالية فوراً + مسح الكوكي
router.post('/logout', authenticate, (req, res, next) => {
  try {
    revokeSession(req.tokenPayload && req.tokenPayload.jti);
    clearCookies(res);
    logActivity(req.user, 'logout', 'user', req.user.id);
    return ok(res, { message: 'تم تسجيل الخروج' });
  } catch (e: any) {
    next(e);
  }
});

// POST /api/auth/logout-all — إبطال كل جلسات المستخدم (كل الأجهزة)
router.post('/logout-all', authenticate, (req, res, next) => {
  try {
    revokeAllSessions(req.user.id);
    clearCookies(res);
    logActivity(req.user, 'logout_all', 'user', req.user.id);
    return ok(res, { message: 'تم تسجيل الخروج من جميع الأجهزة' });
  } catch (e: any) {
    next(e);
  }
});

// POST /api/auth/reset-password (للمسؤول/الوكيل: إعادة تعيين كلمة مرور حساب آخر)
router.post('/reset-password', authenticate, requireRole('admin', 'agent'), requireAgentLease(), csrfProtect, async (req, res, next) => {
  try {
    const { user_id, new_password } = req.body || {};
    if (!user_id || !new_password) throw new ApiError(400, 'يرجى تحديد الحساب وكلمة المرور الجديدة');
    assertLength(new_password, 72, 'كلمة المرور', 6);

    const target = get('SELECT * FROM users WHERE id = ?', [Number(user_id)]);
    if (!target) throw new ApiError(404, 'الحساب غير موجود');
    // الزبائن لا يملكون هذا المسار أصلاً (requireRole)؛ وحساب المسؤول الأعلى لا يُعاد تعيينه إلا من قِبَل مسؤول أعلى
    if (target.role === 'admin') {
      if (req.user.role !== 'admin') throw new ApiError(403, 'لا يمكنك تغيير كلمة مرور المسؤول');
      const targetSuper = get(
        'SELECT 1 FROM admin_user_roles aur JOIN admin_roles ar ON ar.id = aur.role_id WHERE aur.user_id = ? AND ar.name = ?',
        [target.id, 'super_admin']
      );
      if (targetSuper) {
        const actorSuper = get(
          'SELECT 1 FROM admin_user_roles aur JOIN admin_roles ar ON ar.id = aur.role_id WHERE aur.user_id = ? AND ar.name = ?',
          [req.user.id, 'super_admin']
        );
        if (!actorSuper) throw new ApiError(403, 'لا يمكنك تغيير كلمة مرور المسؤول الأعلى');
      }
    }

    if (req.user.role === 'agent') {
      if (!['provider', 'customer'].includes(target.role)) {
        throw new ApiError(403, 'لا يمكنك تغيير كلمة مرور هذا النوع من الحسابات');
      }
      let targetGovId = null;
      if (target.role === 'provider') {
        const p = get('SELECT governorate_id FROM providers WHERE user_id = ?', [target.id]);
        targetGovId = p ? p.governorate_id : null;
      } else {
        targetGovId = target.governorate_id || null;
      }
      if (targetGovId !== req.user.governorate_id) {
        throw new ApiError(403, 'لا يمكنك إعادة تعيين كلمة مرور حساب خارج محافظتك');
      }
    }

    run('UPDATE users SET password_hash = ?, updated_at = datetime(\'now\') WHERE id = ?', [await hashPassword(new_password), target.id]);
    // إعادة التعيين تُبطل جلسات الحساب الحالية على كل الأجهزة (يجب تسجيل الدخول من جديد)
    revokeAllSessions(target.id);
    logActivity(req.user, 'reset_password', 'user', target.id, { role: target.role });
    return ok(res, { message: 'تم إعادة تعيين كلمة المرور بنجاح' });
  } catch (e: any) {
    next(e);
  }
});

module.exports = router;
