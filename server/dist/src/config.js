"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
require('dotenv').config();
const path = require('path');
const env = process.env.NODE_ENV || 'development';
const DEFAULT_DEV_SECRET = 'rafidain-market-dev-secret';
const jwtSecret = process.env.JWT_SECRET || DEFAULT_DEV_SECRET;
if (env === 'production' && jwtSecret === DEFAULT_DEV_SECRET) {
    throw new Error('يجب تعيين JWT_SECRET في بيئة الإنتاج قبل الإقلاع');
}
const config = {
    port: Number(process.env.PORT || 4001),
    jwtSecret,
    jwtExpiresIn: process.env.JWT_EXPIRES_IN || '1d',
    dbPath: process.env.DB_PATH
        ? path.resolve(process.env.DB_PATH)
        : path.join(__dirname, '../data/app.db'),
    appName: process.env.APP_NAME || 'سوق الرافدين',
    env,
    trustProxy: process.env.TRUST_PROXY === '1' || Number(process.env.TRUST_PROXY) === 1,
    corsOrigins: (process.env.CORS_ORIGINS || 'http://localhost:5173,http://localhost:5174,http://localhost:5175,http://localhost:5176,http://localhost:8081,http://localhost:8082,http://localhost:8083,http://localhost:8084')
        .split(',').map((s) => s.trim()).filter(Boolean),
    // قفل الحساب عند فشل الدخول المتكرر
    lockout: {
        maxFailures: Number(process.env.LOCKOUT_MAX_FAILURES || 5),
        windowMinutes: Number(process.env.LOCKOUT_WINDOW_MIN || 15),
        durationMinutes: Number(process.env.LOCKOUT_DURATION_MIN || 15),
    },
    // جلسات HttpOnly: اسم الكوكي ومدتها (تزامن مع JWT_EXPIRES_IN)
    cookie: {
        name: process.env.SESSION_COOKIE_NAME || 'rafidain_session',
        csrfName: process.env.CSRF_COOKIE_NAME || 'rafidain_csrf',
        secure: process.env.COOKIE_SECURE === '1' || env === 'production',
    },
};
module.exports = config;
