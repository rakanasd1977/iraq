const { db, run, all, get } = require('../index');

// إحداثيات مركز كل محافظة (تقديرية لأقرب مطابقة من الموقع الفعلي للزبون)
const COORDS = {
  BAG: [33.3152, 44.3661], // بغداد
  BAS: [30.5085, 47.7804], // البصرة
  NIN: [36.345, 43.145],   // نينوى / الموصل
  ERB: [36.19, 44.0092],   // أربيل
  SUL: [35.5556, 45.435],  // السليمانية
  DUH: [36.86, 42.99],     // دهوك
  KIR: [35.4667, 44.2833], // كركوك
  NAJ: [31.998, 44.305],   // النجف
  KAR: [32.616, 44.024],   // كربلاء
  ANB: [33.42, 43.3],      // الأنبار / الرمادي
  SAL: [34.603, 43.68],    // صلاح الدين / تكريت
  DIY: [33.74, 44.63],     // ديالى / بعقوبة
  WAS: [32.51, 45.82],     // واسط / الكوت
  DHI: [31.05, 46.26],     // ذي قار / الناصرية
  MAY: [31.85, 47.15],     // ميسان / العمارة
  MUT: [31.33, 45.28],     // المثنى / السماوة
  QAD: [31.99, 44.93],     // القادسية / الديوانية
  BAB: [32.47, 44.42],     // بابل / الحلة
};

module.exports = {
  name: '039_governorate_coords',
  up: () => {
    db.exec(`ALTER TABLE governorates ADD COLUMN lat REAL; ALTER TABLE governorates ADD COLUMN lng REAL;`);
    for (const [code, [lat, lng]] of Object.entries(COORDS)) {
      run('UPDATE governorates SET lat = ?, lng = ? WHERE code = ?', [lat, lng, code]);
    }
  },
};
