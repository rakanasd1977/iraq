// تعبئة صور حقيقية للكتالوج الموجود في قاعدة بيانات التطوير (يعمل مرة واحدة، يتجاهل الصفوف التي لها صور).
// الروابط مُتحقق منها (Unsplash/loremflickr) — تُطبَّق أيضاً تلقائياً على قاعدة جديدة عبر seed.js.
const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');

const DB = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'app.db');
const db = new DatabaseSync(DB);

const IMG = (id) => `https://images.unsplash.com/${id}?w=500&q=80`;
const LF = (kw) => `https://loremflickr.com/500/500/${kw}`;

const CATALOG = [
  {
    table: 'products',
    cols: ['name_en', 'name_ar'],
    images: {
      Smartphone: [IMG('photo-1511707171634-5f897ff02aa9')],
      'هاتف ذكي': [IMG('photo-1511707171634-5f897ff02aa9')],
      Laptop: [IMG('photo-1496181133206-80ce9b88a853')],
      'حاسوب محمول': [IMG('photo-1496181133206-80ce9b88a853')],
      'Wireless Earbuds': [IMG('photo-1505740420928-5e560c06d30e')],
      'سماعات لاسلكية': [IMG('photo-1505740420928-5e560c06d30e')],
      'Cotton Shirts': [LF('tshirt,clothing')],
      'قمصان قطنية': [LF('tshirt,clothing')],
      'Elegant Watch': [IMG('photo-1524592094714-0f0654e20314')],
      'ساعة يد أنيقة': [IMG('photo-1524592094714-0f0654e20314')],
    },
  },
  {
    table: 'menu_items',
    cols: ['name_en', 'name_ar'],
    images: {
      'Grilled Kebab': [LF('kebab,grill')],
      'كبة مشوية': [LF('kebab,grill')],
      Tikka: [LF('tikka,chicken')],
      'تكة': [LF('tikka,chicken')],
      Hummus: [LF('hummus,food')],
      'حمص بالطحينة': [LF('hummus,food')],
      'Iraqi Salad': [IMG('photo-1546069901-ba9599a7e63c')],
      'سلطة عراقية': [IMG('photo-1546069901-ba9599a7e63c')],
    },
  },
  {
    table: 'hotel_rooms',
    cols: ['name_en', 'name_ar', 'room_type'],
    images: {
      'Standard Room': [IMG('photo-1611892440504-42a792e24d32')],
      'غرفة قياسية': [IMG('photo-1611892440504-42a792e24d32')],
      standard: [IMG('photo-1611892440504-42a792e24d32')],
      'Deluxe Suite': [IMG('photo-1590490360182-c33d57733427')],
      'جناح ديلوكس': [IMG('photo-1590490360182-c33d57733427')],
      'جناح ملكي': [IMG('photo-1590490360182-c33d57733427')],
      deluxe: [IMG('photo-1590490360182-c33d57733427')],
      'Family Room': [IMG('photo-1611892440504-42a792e24d32')],
      'غرفة عائلية': [IMG('photo-1611892440504-42a792e24d32')],
      family: [IMG('photo-1611892440504-42a792e24d32')],
    },
  },
  {
    table: 'flights',
    cols: ['flight_number'],
    images: { '*': [IMG('photo-1436491865332-7a61a109cc05')] },
  },
  {
    table: 'travel_packages',
    cols: ['name_en', 'name_ar', 'destination'],
    images: {
      'Istanbul Trip': [IMG('photo-1524231757912-21f4fe3a7200')],
      'رحلة إسطنبول': [IMG('photo-1524231757912-21f4fe3a7200')],
      'إسطنبول': [IMG('photo-1524231757912-21f4fe3a7200')],
      Umrah: [IMG('photo-1591604129939-f1efa4d9f7fa')],
      'عمرة': [IMG('photo-1591604129939-f1efa4d9f7fa')],
      'مكة المكرمة': [IMG('photo-1591604129939-f1efa4d9f7fa')],
      'Sharm Trip': [LF('beach,sea')],
      'رحلة شرم الشيخ': [LF('beach,sea')],
      'شرم الشيخ': [LF('beach,sea')],
    },
  },
];

let updated = 0;
for (const { table, cols, images } of CATALOG) {
  const colExists = db.prepare('PRAGMA table_info(' + table + ')').all().some((c) => c.name === 'images_json');
  if (!colExists) {
    console.log(`[backfill] ${table}: لا يوجد عمود images_json — يُنشأ الآن`);
    db.exec('ALTER TABLE ' + table + ' ADD COLUMN images_json TEXT');
  }
  const rows = db.prepare('SELECT * FROM ' + table).all();
  for (const r of rows) {
    const has = r.images_json && String(r.images_json).trim() && String(r.images_json) !== '[]';
    if (has) continue;
    let url = null;
    for (const c of cols) {
      if (url) break;
      if (r[c] != null) url = images[String(r[c])] || null;
    }
    if (!url && images['*']) url = images['*'];
    if (!url) continue;
    db.prepare('UPDATE ' + table + ' SET images_json = ? WHERE id = ?').run(JSON.stringify(url), r.id);
    updated++;
    console.log(`[backfill] ${table} id=${r.id}: صورة`);
  }
}
console.log(`[backfill] تم تحديث ${updated} صفاً في ${DB}`);
db.close();
