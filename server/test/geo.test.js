const test = require('node:test');
const assert = require('node:assert/strict');
const { haversineKm, nearestGovernorate } = require('../src/utils/geo');

test('haversineKm تصفر لنفس النقطة', () => {
  assert.equal(haversineKm(33.3152, 44.3661, 33.3152, 44.3661), 0);
});

test('haversineKm موجبة لنقطتين مختلفتين (بغداد-البصرة ~450كم)', () => {
  const d = haversineKm(33.3152, 44.3661, 30.5085, 47.7804);
  assert.ok(d > 400 && d < 500, `المسافة بين بغداد والبصرة ~450كم، جاءت ${d}`);
});

test('nearestGovernorate تُرجع الأقرب (بغداد)', () => {
  const list = [
    { id: 1, code: 'BAG', lat: 33.3152, lng: 44.3661 },
    { id: 2, code: 'BAS', lat: 30.5085, lng: 47.7804 },
  ];
  const r = nearestGovernorate(33.34, 44.4, list);
  assert.equal(r.code, 'BAG');
  assert.equal(typeof r.distance_km, 'number');
});

test('nearestGovernorate تتجاهل الحقول الفارغة', () => {
  const list = [
    { id: 1, code: 'BAG', lat: null, lng: null },
    { id: 2, code: 'BAS', lat: 30.5085, lng: 47.7804 },
  ];
  const r = nearestGovernorate(30.5, 47.7, list);
  assert.equal(r.code, 'BAS');
});

test('nearestGovernorate تُرجع null لقائمة فارغة أو بلا إحداثيات', () => {
  assert.equal(nearestGovernorate(33, 44, []), null);
  assert.equal(nearestGovernorate(33, 44, [{ id: 1, code: 'X', lat: null, lng: null }]), null);
});
