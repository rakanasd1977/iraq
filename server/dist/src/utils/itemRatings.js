"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const { get, all, run } = require('../db');
// خريطة أنواع البنود: اسم الجدول + عمود المزوّد/الاسم (يُستخدم للتحقق من وجود البند)
const ITEM_TABLES = {
    products: { table: 'products' },
    menu: { table: 'menu_items' },
    packages: { table: 'travel_packages' },
    rooms: { table: 'hotel_rooms' },
    flights: { table: 'flights' },
};
function itemKindOf(kind) {
    return ITEM_TABLES[kind] ? String(kind) : null;
}
// يحقق من وجود البند ويعيد صفه (مع provider_id للتحقق)
function findItem(kind, itemId) {
    const def = ITEM_TABLES[kind];
    if (!def)
        return null;
    return get(`SELECT * FROM ${def.table} WHERE id = ?`, [Number(itemId)]);
}
// يعيد حساب معدل البند من سجل التقييمات ويحدّث جدول المجاميع
function recomputeItemRating(itemType, itemId, providerId) {
    const rows = all('SELECT rating FROM item_ratings WHERE item_type = ? AND item_id = ?', [itemType, itemId]);
    const count = rows.length;
    let rating = 0;
    if (count) {
        const sum = rows.reduce((s, x) => s + x.rating, 0);
        rating = Math.round((sum / count) * 10) / 10;
    }
    run(`INSERT INTO item_rating_sums (item_type, item_id, rating, rating_count) VALUES (?,?,?,?)
     ON CONFLICT(item_type, item_id) DO UPDATE SET rating = excluded.rating, rating_count = excluded.rating_count`, [itemType, itemId, rating, count]);
    return { rating, rating_count: count };
}
// هل اشترى الزبون هذا البند في طلب مكتمل؟ يعيد order_id أو null
function hasPurchasedItem(userId, kind, itemId) {
    const orders = all('SELECT id, items_json FROM orders WHERE customer_id = ? AND status = ? ORDER BY id DESC LIMIT 50', [userId, 'completed']);
    for (const o of orders) {
        let items = [];
        try {
            items = JSON.parse(o.items_json || '[]');
        }
        catch (e) {
            items = [];
        }
        if (items.some((it) => it && it.kind === kind && Number(it.item_id) === Number(itemId)))
            return o.id;
    }
    return null;
}
module.exports = { ITEM_TABLES, itemKindOf, findItem, recomputeItemRating, hasPurchasedItem };
