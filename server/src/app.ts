const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const routes = require('./routes');
const config = require('./config');
const { ApiError } = require('./utils/helpers');
const { uploadFilePath, IMAGE_SPECS } = require('./utils/uploads');
const { getSensitiveRefs } = require('./utils/sensitiveRefs');
const { createRateLimiter } = require('./utils/rateLimit');
const { notFound, errorHandler } = require('./middleware/error');
const { securityHeaders, sanitizeBody } = require('./middleware/security');
const { csrfProtect } = require('./utils/csrf');

const app = express();

app.disable('x-powered-by');

if (config.trustProxy) app.set('trust proxy', 1);

app.use(securityHeaders);

app.use(cors({
  origin(origin, callback) {
    if (!origin || config.corsOrigins.includes(origin)) return callback(null, true);
    return callback(new ApiError(403, 'المنشأ غير مصرح به'));
  },
  credentials: true,
}));
app.use((req, res, next) => { res.vary('Origin'); next(); });
app.use(express.json({ limit: '6mb' }));
app.use(sanitizeBody);

// حد عام لطلبات الكتابة لكل IP (المصادقة لها حد أضيق داخل مساراتها)
const writeLimiter = createRateLimiter({
  windowMs: 60000,
  max: Number(process.env.WRITE_RATE_LIMIT_MAX) || 300,
});
app.use('/api', (req, res, next) => {
  if (req.method !== 'GET' && req.method !== 'HEAD' && req.method !== 'OPTIONS') return writeLimiter(req, res, next);
  return next();
});

app.get('/', (req, res) => {
  res.json({ name: 'Rafidain Market API', status: 'running' });
});

// ===== الملفات المرفوعة (صور) =====
// تُقدَّم صور عامة فقط بعد فحص نوع الملف (magic bytes) وصيغة الملف نفسه:
// أي صيغة أخرى (SVG/HTML/...) تُرفض، وملفات مستندات التوثيق لا تُقدَّم عامة هنا
// بل عبر المسار المصادق /api/providers/:id/documents/:field (مسؤول/وكيل فقط).
const EXT_TO_MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif' };

function imageBytesMatch(buf, mime) {
  const spec = IMAGE_SPECS[mime];
  if (!spec || buf.length < spec.sig.length || !spec.sig.every((b, i) => buf[i] === b)) return false;
  if (mime === 'image/webp' && (buf.length < 12 || buf.toString('latin1', 8, 12) !== 'WEBP')) return false;
  return true;
}

// مستندات الهوية وإثباتات شحن الرصيد لا تُقدَّم عامة بمعرفة الرابط — بل عبر مسارات مصادقة.
// انظر دالة getSensitiveRefs في utils/sensitiveRefs.ts (مع إبطال الكاش فور الرفع).

app.use('/uploads', (req, res, next) => {
  const abs = uploadFilePath('/uploads/' + String(req.path || '').replace(/^\/+/, ''));
  if (!abs) return next();
  const ext = path.extname(abs).toLowerCase().slice(1);
  const mime = EXT_TO_MIME[ext];
  if (!mime) return next();

  let head;
  try {
    head = fs.readFileSync(abs, { flag: 'r' }).subarray(0, 12);
  } catch (e: any) {
    return res.status(404).json({ message: 'الملف غير موجود' });
  }
  if (head.length < 3 || !imageBytesMatch(head, mime)) {
    return res.status(404).json({ message: 'الملف غير موجود' });
  }

  // مستندات الهوية وإثباتات شحن الرصيد لا تُقدَّم عامة بمعرفة الرابط — بل عبر مسارات مصادقة
  const ref = '/uploads/' + path.basename(abs);
  if (getSensitiveRefs().has(ref)) return res.status(404).json({ message: 'الملف غير موجود' });

  res.setHeader('Content-Type', mime);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'public, max-age=604800');
  if (req.method === 'HEAD') return res.end();
  const stream = fs.createReadStream(abs);
  stream.on('error', () => res.status(404).end());
  return stream.pipe(res);
});

app.use('/api', csrfProtect);
app.use('/api', routes);

app.use(notFound);
app.use(errorHandler);

module.exports = app;
