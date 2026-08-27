import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useToast, fmt, fmtDate, StatCard, PageLoading, Badge, ORDER_STATUS, LEASE_STATUS } from '@rafidain/shared/ui';
import type { DashboardData, LeaseData } from '../types';

export default function Dashboard() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [lease, setLease] = useState<LeaseData | null>(null);
  const toast = useToast();
  const navigate = useNavigate();

  const exportCsv = async () => {
    try {
      const res = await fetch('/api/agent/dashboard/export', { credentials: 'include' });
      if (!res.ok) {
        const d = await res.json().catch(() => null);
        throw new Error(d?.message || 'تعذر تصدير الداشبورد');
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `dashboard-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast.success('تم تصدير لوحة المعلومات بنجاح');
    } catch (e: any) { toast.error(e.message); }
  };

  useEffect(() => {
    Promise.all([
      api.get('/agent/dashboard'),
      api.get('/agent/lease'),
    ])
      .then(([d, l]) => { setData(d.data); setLease(l.data); })
      .catch((e) => toast.error(e.message));
  }, []);

  if (!data) return <PageLoading />;

  const maxStatus = Math.max(1, ...data.orders_by_status.map((s) => s.count));
  const expired = lease?.is_expired;
  const maxMonthlyOrders = Math.max(1, ...data.monthly.map((m) => m.orders_count));
  const maxMonthlyComm = Math.max(1, ...data.monthly.map((m) => m.agent_commission || m.commission));
  const svcTotal = data.orders_by_service.reduce((s, x) => s + x.orders_count, 0) || 1;
  const svcColors = ['#0f766e', '#2563eb', '#d97706', '#16a34a', '#7c3aed', '#dc2626', '#0891b2', '#65a30d'];

  return (
    <div>
      <div className="page-head">
        <div>
          <h2>لوحة معلومات محافظة {data.governorate_name_ar}</h2>
          <p>إحصائيات محافظتك فقط — أنت تدير كل مزودي الخدمة في محافظتك دون غيرها</p>
        </div>
        <button className="btn btn-outline" onClick={exportCsv}>⬇ تصدير CSV</button>
      </div>

      {expired && (
        <div className="alert-error mb-4">
          ⚠️ إجارة وكالتك لمحافظة {data.governorate_name_ar} منتهية. يرجى تجديدها سنوياً من صفحة إجارة الوكالة لمتابعة عملك.
        </div>
      )}

      {data.attention.length > 0 && (
        <div className="card mb-4">
          <div className="card-header"><h3>⚠️ مهام تحتاج انتباهك</h3></div>
          <div className="card-body">
            <div className="attention-list">
              {data.attention.map((a) => (
                <button key={a.key} className="attention-item" onClick={() => navigate(a.url)} type="button">
                  <span className="attention-item__icon">{a.icon}</span>
                  <span className="grow">{a.label}</span>
                  <span className={`attention-item__tone attention-item__tone--${a.tone}`} />
                  <span style={{ fontSize: 13 }}>←</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-3 mb-4">
        <StatCard label="مزودو الخدمة في المحافظة" value={fmt(data.providers_count)} icon="🏪" tone="primary" />
        <StatCard label="مزودون نشطون" value={fmt(data.active_providers_count)} icon="✅" tone="success" />
        <StatCard label="إجمالي الطلبات" value={fmt(data.orders_count)} icon="🧾" tone="info" />
      </div>

      <div className="grid grid-3 mb-4">
        <StatCard label="قيمة الطلبات (دينار)" value={fmt(data.orders_value)} icon="💵" tone="primary" />
        <StatCard label="أرباحك من العمولات (دينار)" value={fmt(data.agent_revenue)} icon="💰" tone="accent" />
        <StatCard label="إيراد المنصة من المحافظة" value={fmt(data.platform_revenue)} icon="🏛️" tone="info" />
      </div>

      <div className="grid grid-2 mb-4">
        <div className="card">
          <div className="card-header"><h3>الطلبات حسب الحالة</h3></div>
          <div className="card-body">
            {data.orders_by_status.length === 0 && <div className="muted">لا توجد طلبات بعد</div>}
            {data.orders_by_status.map((s) => (
              <div className="bar-row" key={s.status}>
                <span className="bar-label"><Badge status={s.status} map={ORDER_STATUS} /></span>
                <div className="bar-track"><div className="bar-fill" style={{ width: `${(s.count / maxStatus) * 100}%` }} /></div>
                <span className="bar-value">{fmt(s.count)}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="card">
          <div className="card-header"><h3>🏪 مزودو الخدمة حسب الخدمة</h3></div>
          <div className="card-body">
            {data.providers_by_service.map((s) => (
              <div className="flex-between" key={s.id} style={{ padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
                <div className="flex">
                  <span style={{ fontSize: 18 }}>{s.icon}</span>
                  <span className="bold">{s.name_ar}</span>
                </div>
                <span className="badge badge-teal">{fmt(s.providers_count)} مزود</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="card mb-4">
        <div className="card-header"><h3>🛒 الطلبات حسب الخدمة (نشاط محافظتك)</h3></div>
        <div className="card-body">
          {data.orders_by_service.length === 0 ? <div className="muted">لا توجد طلبات</div> : (
            <>
              <div className="donut-bar">
                {data.orders_by_service.map((s, i) => s.orders_count > 0 && (
                  <div key={s.id} className="donut-bar__seg" style={{ width: `${(s.orders_count / svcTotal) * 100}%`, background: svcColors[i % svcColors.length] }} title={`${s.name_ar}: ${fmt(s.orders_count)}`} />
                ))}
              </div>
              <div className="donut-legend">
                {data.orders_by_service.map((s, i) => (
                  <div className="donut-legend__row" key={s.id}>
                    <span className="donut-legend__swatch" style={{ background: svcColors[i % svcColors.length] }} />
                    <span>{s.icon} {s.name_ar}</span>
                    <span className="grow" style={{ flex: 1, textAlign: 'left' }}>
                      <span className="bold">{fmt(s.orders_count)} طلب</span>
                      <span className="muted"> • {fmt(s.orders_value)} د.ع</span>
                      <span className="muted"> ({Math.round((s.orders_count / svcTotal) * 100)}%)</span>
                    </span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      <div className="card mb-4">
        <div className="card-header"><h3>📈 نشاط آخر 12 شهراً (عدد الطلبات مقابل عمولتك)</h3></div>
        <div className="card-body">
          {data.monthly.length === 0 ? <div className="muted">لا توجد بيانات</div> : (
            <>
              <div className="month-legend">
                <span><i style={{ background: 'var(--primary)' }} /> عدد الطلبات</span>
                <span><i style={{ background: 'var(--accent)' }} /> عمولتك (دينار)</span>
              </div>
              {data.monthly.map((m) => (
                <div className="month-row" key={m.month}>
                  <span className="bar-label mono" style={{ width: 70 }}>{m.month}</span>
                  <div className="month-bars">
                    <div className="bar-track bar-track--orders"><div className="bar-fill" style={{ width: `${(m.orders_count / maxMonthlyOrders) * 100}%` }} /></div>
                    <div className="bar-track bar-track--commission"><div className="bar-fill" style={{ width: `${((m.commission || 0) / maxMonthlyComm) * 100}%` }} /></div>
                  </div>
                  <span className="bar-value" style={{ width: 150 }}>{fmt(m.orders_count)} طلب</span>
                  <span className="bar-value" style={{ width: 130 }}>{fmt(m.commission || 0)} د.ع</span>
                </div>
              ))}
            </>
          )}
          <div className="flex-between mt-4">
            <span className="muted" style={{ fontSize: 12 }}>متوسط عمولة الطلب في المحافظة: {fmt(data.orders_count ? Math.round(data.agent_revenue / data.orders_count) : 0)} دينار</span>
          </div>
        </div>
      </div>

      <div className="grid grid-2">
        <div className="card">
          <div className="card-header"><h3>👥 أعلى الزبائن إنفاقاً في محافظتك</h3></div>
          <div className="table-wrap">
            <table>
              <thead><tr><th>الزبون</th><th>الطلبات</th><th>إجمالي المشتريات (دينار)</th></tr></thead>
              <tbody>
                {data.top_customers.length === 0 && <tr><td colSpan={3}><div className="muted" style={{ padding: 16 }}>لا توجد بيانات</div></td></tr>}
                {data.top_customers.map((c, i) => (
                  <tr key={`${c.name}-${c.phone || ''}-${i}`}>
                    <td className="bold">{c.name}</td>
                    <td>{fmt(c.orders_count)}</td>
                    <td>{fmt(c.total_value)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="card">
          <div className="card-header"><h3>آخر الطلبات في محافظتك</h3></div>
          <div className="table-wrap">
            <table>
              <thead><tr><th>الطلب</th><th>المزود</th><th>الزبون</th><th>المبلغ</th><th>الحالة</th></tr></thead>
              <tbody>
                {data.recent_orders.length === 0 && <tr><td colSpan={5}><div className="muted" style={{ padding: 16 }}>لا توجد طلبات</div></td></tr>}
                {data.recent_orders.map((o) => (
                  <tr key={o.id}>
                    <td><span className="mono">{o.order_number}</span></td>
                    <td>{o.provider_name}</td>
                    <td>{o.customer_name || '-'}</td>
                    <td>{fmt(o.total_amount)}</td>
                    <td><Badge status={o.status} map={ORDER_STATUS} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div className="grid grid-2" style={{ marginTop: 16 }}>
        <div className="card">
          <div className="card-header"><h3>حالة وكالتك</h3></div>
          <div className="card-body">
            <div className="detail-grid">
              <div className="detail-item"><div className="k">المحافظة</div><div className="v">{lease?.governorate_name_ar}</div></div>
              <div className="detail-item"><div className="k">حالة الإجارة</div><div className="v"><Badge status={lease?.lease_status || ''} map={LEASE_STATUS} /></div></div>
              <div className="detail-item"><div className="k">تنتهي في</div><div className="v">{fmtDate(lease?.lease_expires_at)}</div></div>
              <div className="detail-item"><div className="k">رسوم التجديد السنوية</div><div className="v">{fmt(lease?.lease_fee)} دينار</div></div>
              <div className="detail-item"><div className="k">نسبة عمولتي</div><div className="v">%{lease?.commission_rate}</div></div>
            </div>
            <div className="alert-info mt-4" style={{ marginBottom: 0 }}>🔑 يجب تجديد إجارة الوكالة سنوياً بمبلغ يحدده المسؤول حسب المحافظة.</div>
          </div>
        </div>
      </div>
    </div>
  );
}
