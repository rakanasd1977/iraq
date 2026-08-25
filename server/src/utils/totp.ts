// TOTP (RFC 6238) — تنفيذ خفيف بدون مكتبات خارجية (HMAC-SHA1 + 6 أرقام).
// يُستخدم للمصادقة الثنائية (Google Authenticator / أي تطبيق يدعم TOTP).
const crypto = require('crypto');

const STEP_SECONDS = 30;
const DIGITS = 6;
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

// مفتاح سري عشوائي بتشفير Base32 (بلا حشوة) — طول 20 بايت = 160 بت
function generateSecret(bytes = 20) {
  const buf = crypto.randomBytes(bytes);
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

function base32Decode(secret) {
  const clean = String(secret).toUpperCase().replace(/[\s=]/g, '');
  let bits = 0;
  let value = 0;
  const bytes = [];
  for (const ch of clean) {
    const idx = ALPHABET.indexOf(ch);
    if (idx < 0) throw new Error('مفتاح TOTP غير صالح');
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

function hotp(secret, counter) {
  const key = base32Decode(secret);
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const hmac = crypto.createHmac('sha1', key).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const bin = ((hmac[offset] & 0x7f) << 24)
    | ((hmac[offset + 1] & 0xff) << 16)
    | ((hmac[offset + 2] & 0xff) << 8)
    | (hmac[offset + 3] & 0xff);
  return bin % 10 ** DIGITS;
}

function currentCode(secret, at = Date.now()) {
  const counter = Math.floor(at / 1000 / STEP_SECONDS);
  return String(hotp(secret, counter)).padStart(DIGITS, '0');
}

// تحقق مع نافذة سماح (درجتين قبل/بعد) لاستيعاب تباعد الساعات أو إدخال رمز حدودي
// يُستخدم مقارنة ثابتة بالزمن (timingSafeEqual) لتفادي تسريب التوقيت.
function verifyCode(secret, code, at = Date.now()) {
  const c = String(code || '').replace(/\s/g, '');
  if (!/^\d{6}$/.test(c)) return false;
  const counter = Math.floor(at / 1000 / STEP_SECONDS);
  const expect = Buffer.from(c);
  for (let i = -1; i <= 1; i++) {
    const generated = String(hotp(secret, counter + i)).padStart(DIGITS, '0');
    if (generated.length === expect.length && crypto.timingSafeEqual(Buffer.from(generated), expect)) return true;
  }
  return false;
}

function otpauthURI(secret, account, issuer = 'سوق الرافدين') {
  const label = encodeURIComponent(issuer) + ':' + encodeURIComponent(account);
  const params = new URLSearchParams({
    secret,
    issuer,
    algorithm: 'SHA1',
    digits: String(DIGITS),
    period: String(STEP_SECONDS),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}

module.exports = { generateSecret, currentCode, verifyCode, otpauthURI };
