"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const cluster = require('node:cluster');
const clients = new Map();
function subscribe(userId, res) {
    let set = clients.get(userId);
    if (!set) {
        set = new Set();
        clients.set(userId, set);
    }
    const entry = { res };
    set.add(entry);
    const heartbeat = setInterval(() => {
        try {
            res.write(': ping\n\n');
        }
        catch (e) {
            clearInterval(heartbeat);
        }
    }, 25000);
    entry.heartbeat = heartbeat;
    const unsubscribe = () => {
        clearInterval(heartbeat);
        set.delete(entry);
        if (set.size === 0)
            clients.delete(userId);
    };
    res.on('close', unsubscribe);
    return unsubscribe;
}
function publishLocal(userId, event, data) {
    const set = clients.get(userId);
    if (!set || set.size === 0)
        return 0;
    const payload = `event: ${event}\ndata: ${JSON.stringify(data || {})}\n\n`;
    let sent = 0;
    for (const entry of set) {
        try {
            entry.res.write(payload);
            sent += 1;
        }
        catch (e) {
            /* اتصال مغلق */
        }
    }
    return sent;
}
function publishAllLocal(event, data) {
    let sent = 0;
    for (const set of clients.values()) {
        const payload = `event: ${event}\ndata: ${JSON.stringify(data || {})}\n\n`;
        for (const entry of set) {
            try {
                entry.res.write(payload);
                sent += 1;
            }
            catch (e) {
                /* اتصال مغلق */
            }
        }
    }
    return sent;
}
function forwardToSiblings(userId, event, data) {
    if (!cluster.isWorker || !process.send)
        return;
    try {
        process.send({ type: 'sse-forward', userId, event, data });
    }
    catch (e) {
        /* قناة مغلقة */
    }
}
function publish(userId, event, data) {
    const sent = publishLocal(userId, event, data);
    forwardToSiblings(userId, event, data);
    return sent;
}
function publishAll(event, data) {
    const sent = publishAllLocal(event, data);
    forwardToSiblings(null, event, data);
    return sent;
}
module.exports = { subscribe, publish, publishAll, publishLocal, publishAllLocal };
