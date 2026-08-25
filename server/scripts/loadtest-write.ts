// @ts-nocheck
// اختبار تحميل كتابات كثيفة: إنشاء طلبات + تغيير حالات + شحن محافظ + قراءات ممتزجة.
// التشغيل: node scripts/loadtest-write.js [concurrency] [durationSeconds] [writeRatio(0-1)]
// المخرجات: إجمالي الطلبات، req/s، توزيع الزمن، أخطاء، SQLITE_BUSY، وتصنيف كل مسار.
const BASE = process.env.API_BASE || 'http://localhost:4002';

async function login(email, password) {
  const r = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const json = await r.json();
  if (!json.data || !json.data.token) throw new Error('تعذر تسجيل الدخول: ' + JSON.stringify(json));
  return json.data.token;
}

function now() { return process.hrtime.bigint(); }

async function main() {
  const concurrency = Number(process.argv[2] || 200);
  const durationMs = Number(process.argv[3] || 30) * 1000;
  const writeRatio = Number(process.argv[4] !== undefined ? process.argv[4] : 0.8);

  const [agentToken, providerToken, adminToken] = await Promise.all([
    login('agent.baghdad@rafidain.iq', 'Agent@123'),
    login('provider.demo@rafidain.iq', 'Provider@123'),
    login('admin@rafidain.iq', 'Admin@123'),
  ]);

  const ctx = await Promise.all([
    fetch(`${BASE}/api/agent/providers?limit=1`, { headers: { Authorization: `Bearer ${agentToken}` } }).then((r) => r.json()),
    fetch(`${BASE}/api/provider/dashboard`, { headers: { Authorization: `Bearer ${providerToken}` } }).then((r) => r.json()),
  ]);
  const providerId = (ctx[0].data && ctx[0].data[0] && ctx[0].data[0].id) || 1;
  const providerOrders = (ctx[1].data && ctx[1].data.recent_orders) || [];

  const stats = {};
  const latencies = [];
  let sent = 0;
  let errors = 0;
  let busy = 0;
  const statusCounts = {};
  const networkErrors = {};
  const deadline = Date.now() + durationMs;
  const rnd = (n) => Math.floor(Math.random() * n);

  const jsonBody = (method, url, token, body) => ({ method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: body !== undefined ? JSON.stringify(body) : undefined });

  function record(name, ms, status) {
    stats[name] = stats[name] || { count: 0, errors: 0, lat: [] };
    stats[name].count += 1;
    stats[name].lat.push(ms);
    if (status !== 200 && status !== 201) stats[name].errors += 1;
  }

  async function hit(fn) {
    const t0 = now();
    try {
      const res = await fn();
      const ms = Number(now() - t0) / 1e6;
      statusCounts[res.status] = (statusCounts[res.status] || 0) + 1;
      if (res.status !== 200 && res.status !== 201) {
        errors += 1;
        const text = await res.text();
        if (/SQLITE_BUSY|SQLITE_LOCKED/.test(text)) busy += 1;
      }
      latencies.push(ms);
      return ms;
    } catch (e) {
      errors += 1;
      const cause = e && e.cause && e.cause.code;
      networkErrors[cause || e.name || 'unknown'] = (networkErrors[cause || e.name || 'unknown'] || 0) + 1;
      return null;
    }
  }

  async function writeOrder() {
    const ms = await hit(() =>
      fetch(`${BASE}/api/orders`, jsonBody('POST', `${BASE}/api/orders`, agentToken, {
        provider_id: providerId,
        customer_name: 'عميل تحميل',
        customer_phone: '0790' + String(10000000 + rnd(9999999)),
        items: [{ title: 'بند تحميل', unit_price: 5000 + rnd(10) * 1000, quantity: 1 + rnd(3) }],
      }))
    );
    if (ms !== null) record('orders.create', ms, stats.orders?.last || 201);
  }

  async function cancelOrder() {
    const ms = await hit(() =>
      fetch(`${BASE}/api/orders?page=1&limit=50`, { headers: { Authorization: `Bearer ${providerToken}` } })
        .then(async (list) => {
          const o = (await list.json()).data?.find((x) => x.status === 'pending');
          if (!o) return { status: 200, text: async () => '' };
          return fetch(`${BASE}/api/orders/${o.id}/status`, jsonBody('PUT', `${BASE}/api/orders/${o.id}/status`, adminToken, { status: 'cancelled', reason: 'اختبار تحميل' }));
        })
    );
    if (ms !== null) record('orders.cancel', ms, stats.orders?.last || 200);
  }

  async function confirmOrder() {
    const ms = await hit(() =>
      fetch(`${BASE}/api/orders?page=1&limit=50`, { headers: { Authorization: `Bearer ${providerToken}` } })
        .then(async (list) => {
          const o = (await list.json()).data?.find((x) => x.status === 'pending');
          if (!o) return { status: 200, text: async () => '' };
          return fetch(`${BASE}/api/orders/${o.id}/status`, jsonBody('PUT', `${BASE}/api/orders/${o.id}/status`, providerToken, { status: 'confirmed' }));
        })
    );
    if (ms !== null) record('orders.confirm', ms, stats.orders?.last || 200);
  }

  async function rechargeWallet() {
    const ms = await hit(() =>
      fetch(`${BASE}/api/wallets/${providerId}/recharge`, jsonBody('POST', `${BASE}/api/wallets/${providerId}/recharge`, adminToken, {
        amount: 1000 + rnd(100) * 100,
        note: 'شحن اختبار تحميل',
      }))
    );
    if (ms !== null) record('wallets.recharge', ms, stats.orders?.last || 200);
  }

  async function markNotif() {
    const ms = await hit(() =>
      fetch(`${BASE}/api/notifications?limit=5`, { headers: { Authorization: `Bearer ${agentToken}` } })
        .then(async (list) => {
          const n = (await list.json()).data?.[0];
          if (!n) return { status: 200, text: async () => '' };
          return fetch(`${BASE}/api/notifications/${n.id}/read`, jsonBody('POST', `${BASE}/api/notifications/${n.id}/read`, agentToken));
        })
    );
    if (ms !== null) record('notifications.read', ms, stats.orders?.last || 200);
  }

  const reads = [
    ['orders.list', () => fetch(`${BASE}/api/orders?page=1&limit=25`, { headers: { Authorization: `Bearer ${adminToken}` } })],
    ['agent.dashboard', () => fetch(`${BASE}/api/agent/dashboard`, { headers: { Authorization: `Bearer ${agentToken}` } })],
    ['provider.dashboard', () => fetch(`${BASE}/api/provider/dashboard`, { headers: { Authorization: `Bearer ${providerToken}` } })],
    ['financial.report', () => fetch(`${BASE}/api/financial-report?group_by=month`, { headers: { Authorization: `Bearer ${adminToken}` } })],
  ];

  const writes = [writeOrder, confirmOrder, cancelOrder, rechargeWallet, markNotif];

  async function worker() {
    while (Date.now() < deadline) {
      const isWrite = Math.random() < writeRatio;
      if (isWrite) {
        await writes[rnd(writes.length)]();
      } else {
        const [name, fn] = reads[rnd(reads.length)];
        const ms = await hit(fn);
        if (ms !== null) record(name, ms, 200);
      }
      sent += 1;
    }
  }

  const workers = Array.from({ length: concurrency }, () => worker());
  await Promise.all(workers);

  latencies.sort((a, b) => a - b);
  const pct = (p) => latencies[Math.min(latencies.length - 1, Math.floor((p / 100) * latencies.length))];
  const perRoute = {};
  for (const [k, v] of Object.entries(stats)) {
    const lat = v.lat.sort((a, b) => a - b);
    const p = (pct_) => lat[Math.min(lat.length - 1, Math.floor((pct_ / 100) * lat.length))];
    perRoute[k] = { count: v.count, errors: v.errors, p50: Math.round(p(50)), p90: Math.round(p(90)), p95: Math.round(p(95)), max: Math.round(p(100)) };
  }

  console.log(JSON.stringify({
    concurrency,
    duration_seconds: durationMs / 1000,
    write_ratio: writeRatio,
    requests: sent,
    req_per_sec: Math.round((sent / durationMs) * 1000),
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
    per_route: perRoute,
  }, null, 2));
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
