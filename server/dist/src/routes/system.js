"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const path = require('node:path');
const fs = require('node:fs');
const { get, all } = require('../db');
const { authenticate } = require('../middleware/auth');
const { requireRole } = require('../middleware/rbac');
const config = require('../config');
function findLatestBackup() {
    try {
        const dir = path.join(path.dirname(config.dbPath), 'backups');
        if (!fs.existsSync(dir))
            return null;
        const files = fs.readdirSync(dir)
            .filter((f) => f.startsWith('app-') && (f.endsWith('.db') || f.endsWith('.zip')))
            .map((f) => {
            const full = path.join(dir, f);
            let time = null;
            const m = f.match(/app-(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2})/);
            if (m)
                time = new Date(m[1].replace(/T/, ' ').replace(/-/g, ':')).getTime();
            if (!time || Number.isNaN(time))
                time = fs.statSync(full).mtimeMs;
            return { name: f, time, size: fs.statSync(full).size };
        })
            .sort((a, b) => b.time - a.time);
        return files.length ? files[0] : null;
    }
    catch {
        return null;
    }
}
const router = require('express').Router();
router.get('/status', authenticate, requireRole('admin'), (req, res, next) => {
    try {
        let dbOk = true;
        let dbError = null;
        try {
            get('SELECT 1');
        }
        catch (e) {
            dbOk = false;
            dbError = e.message;
        }
        let counts = {};
        try {
            const tables = ['users', 'providers', 'agents', 'customers', 'orders', 'promotions', 'notifications'];
            for (const t of tables) {
                try {
                    counts[t] = get(`SELECT COUNT(*) AS c FROM ${t}`).c;
                }
                catch {
                    counts[t] = null;
                }
            }
        }
        catch { /* تجاهل */ }
        const latest = findLatestBackup();
        const mem = process.memoryUsage();
        res.json({
            status: dbOk ? 'ok' : 'degraded',
            db: { ok: dbOk, error: dbError, path: config.dbPath },
            uptimeSeconds: Math.floor(process.uptime()),
            nodeVersion: process.version,
            env: config.env,
            counts,
            backup: latest
                ? { file: latest.name, at: new Date(latest.time).toISOString(), sizeBytes: latest.size }
                : null,
            memory: {
                rssMb: Math.round(mem.rss / 1024 / 1024),
                heapUsedMb: Math.round(mem.heapUsed / 1024 / 1024),
                heapTotalMb: Math.round(mem.heapTotal / 1024 / 1024),
            },
            time: new Date().toISOString(),
        });
    }
    catch (e) {
        next(e);
    }
});
module.exports = router;
