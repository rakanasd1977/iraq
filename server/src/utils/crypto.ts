const crypto = require('crypto');

// تشفير أسرار TOTP عند الراحة (envelope encryption).
// في الإنتاج يجب ضبط TOTP_ENC_KEY وإلا يرفض الخادم الإقلاع (فشل مغلق).
// في التطوير/الاختبار نستخدم مفتاحاً ثابتاً للتطبيق (مقبول للتطوير فقط).
const env = process.env.NODE_ENV || 'development';
let totpKeyRaw;
if (!process.env.TOTP_ENC_KEY) {
  if (env === 'production') {
    throw new Error('يجب تعيين TOTP_ENC_KEY في بيئة الإنتاج قبل الإقلاع');
  }
  totpKeyRaw = 'rafidain-market-static-totp-key-v1';
  console.warn('[crypto] TOTP_ENC_KEY غير مضبوط — يُستخدم مفتاح ثابت للتطوير. اضبط TOTP_ENC_KEY في الإنتاج.');
} else {
  totpKeyRaw = process.env.TOTP_ENC_KEY;
}
const KEY = Buffer.from(totpKeyRaw.padEnd(32, '0').slice(0, 32));
const PREFIX = 'enc:';

function encryptTotp(plain) {
  if (plain == null) return null;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', KEY, iv);
  const enc = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return PREFIX + iv.toString('base64') + ':' + tag.toString('base64') + ':' + enc.toString('base64');
}

function decryptTotp(stored) {
  if (stored == null) return null;
  if (typeof stored !== 'string' || !stored.startsWith(PREFIX)) return stored; // سرّ قديم بنص واضح
  try {
    const [, ivB64, tagB64, encB64] = stored.split(':');
    const decipher = crypto.createDecipheriv('aes-256-gcm', KEY, Buffer.from(ivB64, 'base64'));
    decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
    const dec = Buffer.concat([decipher.update(Buffer.from(encB64, 'base64')), decipher.final()]);
    return dec.toString('utf8');
  } catch (e) {
    return null;
  }
}

module.exports = { encryptTotp, decryptTotp };
