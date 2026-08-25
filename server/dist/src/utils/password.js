"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
// تجزئة وهمية ثابتة: تُنفَّذ عليها مقارنة bcrypt عند محاولة دخول بحساب غير موجود،
// فيصبح زمن الاستجابة متساوياً تقريباً مع الحسابات الموجودة (لا تسريب timing لوجود البريد).
const DUMMY_HASH = '$2a$10$5JHS6G1dmnJgA35GsjmH4OgOzSPAyqauhfNTgcaw3.BAt59TDTXVK';
// دوال غير متزامنة (Promises) — bcryptjs تُرجع Promise عند عدم تمرير callback،
// فلا تُجمّد حلقة الأحداث أثناء التجزئة (خاصة تسجيل الدخول وتغيير كلمة المرور).
function hashPassword(plain) {
    return bcrypt.hash(String(plain), 10);
}
function verifyPassword(plain, hash) {
    return bcrypt.compare(String(plain), String(hash));
}
function randomPassword(length = 10) {
    const chars = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789!@#$%';
    const len = chars.length;
    const limit = 256 - (256 % len);
    let out = '';
    while (out.length < length) {
        const bytes = crypto.randomBytes(length);
        for (const b of bytes) {
            if (out.length >= length)
                break;
            if (b < limit)
                out += chars[b % len];
        }
    }
    return out;
}
module.exports = { hashPassword, verifyPassword, randomPassword, DUMMY_HASH };
