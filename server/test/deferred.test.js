// اختبارات الإصلاحات المؤجلة: دقة المبالغ، عدّاد حد الطلبات المشترك، عدّادات SSE
const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

process.env.NODE_ENV = 'test';
process.env.DB_PATH = path.join(os.tmpdir(), `rafidain-deferred-${process.pid}-${crypto.randomUUID()}.db`);
process.env.JWT_SECRET = 'deferred-test-secret';
delete process.env.TRUST_PROXY;

const { assertAmount, assertQuantity } = require('../src/utils/helpers');
const { rateLimitCheck } = require('../src/db');
const sse = require('../src/utils/sse');

test('assertAmount يثبّت الدقة عند منزلتين عشريتين ويرفض الأكثر/الخارج عن الحد', () => {
  assert.equal(assertAmount(0), 0);
  assert.equal(assertAmount(10.5), 10.5);
  assert.equal(assertAmount(10.55), 10.55);
  assert.equal(assertAmount(0.1), 0.1, 'أرقام قريبة من منزلتين لا تُرفض بسبب خطأ التقريب');
  assert.throws(() => assertAmount(-5), 'السالب مرفوض');
  assert.throws(() => assertAmount(10.555), '3 منازل عشرية مرفوضة');
  assert.throws(() => assertAmount(2e12), 'تجاوز السقف الأعلى مرفوض');
});

test('assertQuantity تبقى عدداً صحيحاً موجباً', () => {
  assert.equal(assertQuantity(3), 3);
  assert.throws(() => assertQuantity(2.5), 'الكسور مرفوضة');
  assert.throws(() => assertQuantity(0), 'الصفر مرفوض');
  assert.throws(() => assertQuantity(200000), 'تجاوز السقف مرفوض');
});

test('rateLimitCheck يفرض السقف ويعيد القبول بعد انتهاء النافذة', () => {
  const key = 'rltest_' + Date.now() + '_' + Math.random();
  assert.equal(rateLimitCheck(key, 3, 60000).allowed, true);
  assert.equal(rateLimitCheck(key, 3, 60000).allowed, true);
  assert.equal(rateLimitCheck(key, 3, 60000).allowed, true);
  assert.equal(rateLimitCheck(key, 3, 60000).allowed, false, 'الرابع خلال النافذة مرفوض');
  // نافذة سالبة تُعامل كمنتهية فيُعاد ضبط العدّاد فيُقبَل الطلب
  const key2 = 'rltest_exp_' + Date.now() + '_' + Math.random();
  assert.equal(rateLimitCheck(key2, 3, -1).allowed, true);
  assert.equal(rateLimitCheck(key2, 3, -1).allowed, true, 'نافذة منتهية تُعيد القبول');
});

test('sse.totalClients/userCount تعيد الأعداد الصحيحة', () => {
  assert.equal(sse.totalClients(), 0);
  assert.equal(sse.userCount(123456789), 0);
});
