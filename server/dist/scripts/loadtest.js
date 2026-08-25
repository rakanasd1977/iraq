"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// @ts-nocheck
// اختبار تحميل خفيف: يطلق طلبات متزامنة لمسارين ممثلين ويحسب الإنتاجية وزمن الاستجابة.
// التشغيل: node scripts/loadtest.js [concurrency] [durationSeconds]
// المخرجات: إجمالي الطلبات، req/s، توزيع الزمن (p50/p90/p95)، وأخطاء الحالة.
const BASE = process.env.API_BASE || 'http://localhost:4001';
async function login() {
    const r = await fetch(`${BASE}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'agent.baghdad@rafidain.iq', password: 'Agent@123', role: 'agent' }),
    });
    const json = await r.json();
    if (!json.data || !json.data.token)
        throw new Error('تعذر تسجيل الدخول: ' + JSON.stringify(json));
    return json.data.token;
}
function now() { return process.hrtime.bigint(); }
async function main() {
    const concurrency = Number(process.argv[2] || 40);
    const durationMs = Number(process.argv[3] || 5) * 1000;
    const token = await login();
    const endpoints = [
        { method: 'GET', url: `${BASE}/api/orders?page=1&limit=25` },
        { method: 'GET', url: `${BASE}/api/agent/dashboard` },
        { method: 'GET', url: `${BASE}/api/agent/customers?page=1&limit=25` },
        {
            method: 'POST',
            url: `${BASE}/api/auth/register-customer`,
            body: () => JSON.stringify({
                name_ar: 'حمل',
                email: `load${Math.random().toString(36).slice(2)}@test.iq`,
                phone: '077' + Math.floor(Math.random() * 1e7).toString().padStart(7, '0'),
                password: 'Load@123',
                governorate_id: 1,
            }),
        },
    ];
    const latencies = [];
    let sent = 0;
    let errors = 0;
    let busy = 0;
    const statusCounts = {};
    const networkErrors = {};
    const deadline = Date.now() + durationMs;
    let running = 0;
    async function worker() {
        while (Date.now() < deadline) {
            const spec = endpoints[sent % endpoints.length];
            const url = spec.url;
            const t0 = now();
            try {
                const headers = { Authorization: `Bearer ${token}` };
                const opts = { method: spec.method, headers };
                if (spec.method === 'POST') {
                    headers['Content-Type'] = 'application/json';
                    opts.body = spec.body();
                }
                const res = await fetch(url, opts);
                statusCounts[res.status] = (statusCounts[res.status] || 0) + 1;
                if (res.status >= 400) {
                    errors += 1;
                    const text = await res.text();
                    if (/SQLITE_BUSY|SQLITE_LOCKED/.test(text))
                        busy += 1;
                }
            }
            catch (e) {
                errors += 1;
                const cause = e && e.cause && e.cause.code;
                networkErrors[cause || e.name || 'unknown'] = (networkErrors[cause || e.name || 'unknown'] || 0) + 1;
            }
            latencies.push(Number(now() - t0) / 1e6);
            sent += 1;
        }
    }
    const workers = Array.from({ length: concurrency }, () => worker());
    await Promise.all(workers);
    latencies.sort((a, b) => a - b);
    const pct = (p) => latencies[Math.min(latencies.length - 1, Math.floor((p / 100) * latencies.length))];
    const totalMs = durationMs;
    console.log(JSON.stringify({
        concurrency,
        duration_seconds: durationMs / 1000,
        requests: sent,
        req_per_sec: Math.round((sent / totalMs) * 1000),
        latency_ms: {
            p50: Math.round(pct(50)),
            p90: Math.round(pct(90)),
            p95: Math.round(pct(95)),
            max: Math.round(pct(100)),
        },
        errors,
        sqlite_busy: busy,
        status_counts: statusCounts,
        network_errors: networkErrors,
    }, null, 2));
}
main().catch((e) => {
    console.error(e.message);
    process.exit(1);
});
