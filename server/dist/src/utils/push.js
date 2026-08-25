"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const fs = require('fs');
const path = require('path');
const webpush = require('web-push');
const { all, run } = require('../db');
const sse = require('./sse');
const VAPID_FILE = process.env.VAPID_KEYS_PATH
    ? path.resolve(process.env.VAPID_KEYS_PATH)
    : path.join(__dirname, '../../data/vapid.json');
let vapidKeys = loadOrCreateVapid();
function loadOrCreateVapid() {
    if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
        return { publicKey: process.env.VAPID_PUBLIC_KEY, privateKey: process.env.VAPID_PRIVATE_KEY };
    }
    try {
        if (fs.existsSync(VAPID_FILE)) {
            return JSON.parse(fs.readFileSync(VAPID_FILE, 'utf8'));
        }
        const generated = webpush.generateVAPIDKeys();
        fs.mkdirSync(path.dirname(VAPID_FILE), { recursive: true });
        fs.writeFileSync(VAPID_FILE, JSON.stringify(generated, null, 2));
        return generated;
    }
    catch (e) {
        console.error('[push] تعذر تحميل مفاتيح VAPID، سيُعطَّل الإشعار الفوري:', e.message);
        return null;
    }
}
if (vapidKeys) {
    webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'mailto:support@rafidain.iq', vapidKeys.publicKey, vapidKeys.privateKey);
}
const publicVapidKey = vapidKeys ? vapidKeys.publicKey : null;
// حفظ إشعار داخلي لمستخدم (سجل دائم يُعرض داخل التطبيق/اللوحة)
function createInAppNotification(userId, { type = 'order', title, body, url, icon }) {
    try {
        run('INSERT INTO notifications (user_id, type, title, body, url, icon) VALUES (?,?,?,?,?,?)', [userId, type, String(title || '').slice(0, 300), String(body || '').slice(0, 600), String(url || '').slice(0, 300), String(icon || '').slice(0, 300)]);
        sse.publish(userId, 'notification', { type });
    }
    catch (e) {
        console.error('[notify] تعذر حفظ الإشعار داخلياً:', e.message);
    }
}
// إشعار كامل: يحفظ داخلياً ثم يرسل Web Push لكل الأجهزة (فشل الإرسال لا يكسر الحفظ)
function notifyUser(userId, payload) {
    createInAppNotification(userId, payload);
    return sendPush(userId, payload);
}
// إشعار لكل حسابات دور معيّن (مثل المسؤولين عند طلب شحن جديد)
function notifyRole(role, payload) {
    const users = all('SELECT id FROM users WHERE role = ? AND is_active = 1', [role]);
    return Promise.all(users.map((u) => notifyUser(u.id, payload))).then((results) => results.reduce((acc, r) => ({ sent: acc.sent + r.sent, removed: acc.removed + r.removed }), { sent: 0, removed: 0 }));
}
// إشعار لكل متابعي مزوّد (عند نشر منتج/عرض جديد) — يخص الزبائن النشطين فقط
function notifyProviderFollowers(providerId, payload) {
    const rows = all(`SELECT f.customer_id FROM provider_follows f
     JOIN users u ON u.id = f.customer_id
     WHERE f.provider_id = ? AND u.is_active = 1`, [providerId]);
    return Promise.all(rows.map((r) => notifyUser(r.customer_id, payload))).then((results) => results.reduce((acc, r) => ({ sent: acc.sent + r.sent, removed: acc.removed + r.removed }), { sent: 0, removed: 0 }));
}
// إرسال إشعار لكل أجهزة مستخدم معيّن؛ يُحذف الاشتراك الميت تلقائياً
function sendPush(userId, { title, body, url, icon }) {
    if (!vapidKeys)
        return Promise.resolve({ sent: 0, removed: 0 });
    const subs = all('SELECT id, endpoint, keys_json FROM push_subscriptions WHERE user_id = ?', [userId]);
    const payload = JSON.stringify({ title: title || '', body: body || '', url: url || '', icon: icon || '' });
    return Promise.all(subs.map((s) => {
        let subscription;
        try {
            subscription = { endpoint: s.endpoint, keys: JSON.parse(s.keys_json) };
        }
        catch (e) {
            return Promise.resolve(null);
        }
        return webpush.sendNotification(subscription, payload)
            .then(() => null)
            .catch((err) => {
            const code = err && (err.statusCode || (err.response && err.response.statusCode));
            if (code === 404 || code === 410) {
                try {
                    require('../db').run('DELETE FROM push_subscriptions WHERE id = ?', [s.id]);
                }
                catch (e) { /* تجاهل */ }
                return { removed: 1 };
            }
            console.error(`[push] فشل إرسال إلى ${s.endpoint.slice(0, 60)}...`, err.message || err);
            return null;
        });
    })).then((results) => {
        const removed = results.filter((r) => r && r.removed).length;
        return { sent: results.length - removed, removed };
    });
}
module.exports = { publicVapidKey, sendPush, notifyUser, notifyRole, notifyProviderFollowers, createInAppNotification };
