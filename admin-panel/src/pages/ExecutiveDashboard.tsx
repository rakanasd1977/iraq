import { useEffect, useState } from 'react';
import { api } from '../api';
import { useToast, fmt, PageLoading, KPICardWithTrend, StatCard, ORDER_STATUS, Badge } from '@rafidain/shared/ui';

interface Kpi {
  label: string;
  current: number;
  previous: number;
  deltaPct: number;
  value?: number;
}

interface ExecutiveData {
  period: string;
  currentRange: { start: string; end: string };
  previousRange: { start: string; end: string };
  kpis: {
    orders: Kpi;
    customers: Kpi;
    revenue: Kpi;
    conversion: Kpi;
  };
  sparkline: { label: string; orders: number; revenue: number }[];
  averages: { aov: number; aovPrevious: number };
  statusBreakdown: { status: string; count: number; revenue: number }[];
  topProvinces: { id: number; name: string; orders: number; revenue: number }[];
  topProviders: { id: number; name: string; orders: number; revenue: number }[];
  attention: { pendingProviders: number; pendingAgentWithdrawals: number };
}

const PERIODS = [
  { value: 'day', label: 'يومي' },
  { value: 'week', label: 'أسبوعي' },
  { value: 'month', label: 'شهري' },
] as const;

const STATUS_COLOR: Record<string, string> = {
  pending: '#f59e0b',
  confirmed: '#3b82f6',
  completed: '#16a34a',
  cancelled: '#ef4444',
};

function rankMax(items: { orders: number }[]) {
  return Math.max(1, ...items.map((i) => i.orders));
}

function RankBar({ label, value, sub, max, tone }: { label: string; value: number; sub?: string; max: number; tone?: string }) {
  const pct = max > 0 ? Math.max(3, (value / max) * 100) : 0;
  return (
    <div className="bar-row">
      <div className="bar-label" title={label} style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{label}</div>
      <div className="bar-track">
        <div className="bar-fill" style={{ width: pct + '%', background: tone || 'var(--primary)' }} />
      </div>
      <div className="bar-value">{fmt(value)}{sub ? ` · ${sub}` : ''}</div>
    </div>
  );
}

export default function ExecutiveDashboard() {
  const [data, setData] = useState<ExecutiveData | null>(null);
  const [period, setPeriod] = useState<'day' | 'week' | 'month'>('month');
  const [loading, setLoading] = useState(true);
  const toast = useToast();

  const load = () => {
    setLoading(true);
    api.get(`/dashboard/executive?period=${period}`)
      .then((res) => { setData(res.data); setLoading(false); })
      .catch((e) => { toast.error(e.message); setLoading(false); });
  };

  useEffect(() => { load(); }, [period]);

  if (loading || !data) return <PageLoading />;

  const { kpis, sparkline, currentRange, previousRange, averages, statusBreakdown, topProvinces, topProviders, attention } = data;

  const totalOrders = kpis.orders.current;
  const cancelled = statusBreakdown.find((s) => s.status === 'cancelled')?.count || 0;
  const cancelRate = totalOrders > 0 ? Math.round((cancelled / totalOrders) * 1000) / 10 : 0;
  const maxOrders = Math.max(...sparkline.map((s) => s.orders), 1);
  const maxRevenue = Math.max(...sparkline.map((s) => s.revenue), 1);
  const provincesMax = rankMax(topProvinces);
  const providersMax = rankMax(topProviders);

  return (
    <div>
      <div className="page-head flex-between">
        <div>
          <h2>لوحة القيادة التنفيذية</h2>
          <p>مؤشرات الأداء الرئيسية مع مقارنة فورية بالفترة السابقة لاتخاذ قرارات سريعة</p>
        </div>
        <div className="filters" style={{ gap: 8 }}>
          <select value={period} onChange={(e) => setPeriod(e.target.value as any)} style={{ maxWidth: 160 }}>
            {PERIODS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
          </select>
          <button type="button" className="btn btn-outline" onClick={load} title="تحديث">↻</button>
        </div>
      </div>

      <div className="alert-info" style={{ marginBottom: 16, fontSize: 13 }}>
        الفترة الحالية: <strong>{currentRange.start.slice(0, 10)} → {currentRange.end.slice(0, 10)}</strong> | السابقة: <strong>{previousRange.start.slice(0, 10)} → {previousRange.end.slice(0, 10)}</strong> | <span className="muted">↑ تحسن · ↓ تراجع · → ثابت</span>
      </div>

      <div className="grid grid-4 mb-4">
        <KPICardWithTrend label={kpis.orders.label} value={fmt(kpis.orders.current)} icon="🧾" tone="primary" deltaPct={kpis.orders.deltaPct} deltaLabel="vs السابقة" sparklineData={sparkline} sparklineMetric="orders" />
        <KPICardWithTrend label={kpis.customers.label} value={fmt(kpis.customers.current)} icon="👥" tone="info" deltaPct={kpis.customers.deltaPct} deltaLabel="vs السابقة" sparklineData={sparkline} sparklineMetric="orders" />
        <KPICardWithTrend label={kpis.revenue.label} value={fmt(kpis.revenue.current)} icon="💰" tone="success" deltaPct={kpis.revenue.deltaPct} deltaLabel="vs السابقة" sparklineData={sparkline} sparklineMetric="revenue" />
        <KPICardWithTrend label={kpis.conversion.label} value={`${kpis.conversion.current}%`} icon="✅" tone="accent" deltaPct={kpis.conversion.deltaPct} deltaLabel="نقاط مئوية" sparklineData={sparkline} sparklineMetric="orders" />
      </div>

      <div className="grid grid-2 mb-4">
        <StatCard label="متوسط قيمة الطلب (AOV)" value={`${fmt(averages.aov)} د.ع`} icon="📊" tone="primary" />
        <StatCard label="نسبة الإلغاء" value={`${cancelRate}%`} icon="⚠️" tone={cancelRate > 15 ? 'danger' : 'warn'} />
      </div>

      <div className="grid grid-2 mb-4">
        <div className="card">
          <div className="card-header"><h3>اتجاه الطلبات (آخر 12 فترة)</h3></div>
          <div className="card-body" style={{ height: 260 }}>
            <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', height: '100%', gap: 8 }}>
              {sparkline.map((d, i) => {
                const barHeight = Math.max(4, (d.orders / maxOrders) * 200);
                return (
                  <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, minWidth: 0 }}>
                    <div style={{ flex: 1, width: '100%', background: 'linear-gradient(to top, var(--primary) 0%, transparent 100%)', borderRadius: '4px 4px 0 0', minHeight: 0, height: barHeight + 'px' }} title={d.label + ': ' + fmt(d.orders) + ' طلب'} />
                    <span className="muted mono" style={{ fontSize: 10, whiteSpace: 'nowrap' }}>{d.label}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        <div className="card">
          <div className="card-header"><h3>اتجاه الإيرادات (آخر 12 فترة)</h3></div>
          <div className="card-body" style={{ height: 260 }}>
            <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', height: '100%', gap: 8 }}>
              {sparkline.map((d, i) => {
                const barHeight = Math.max(4, (d.revenue / maxRevenue) * 200);
                return (
                  <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, minWidth: 0 }}>
                    <div style={{ flex: 1, width: '100%', background: 'linear-gradient(to top, var(--success) 0%, transparent 100%)', borderRadius: '4px 4px 0 0', minHeight: 0, height: barHeight + 'px' }} title={d.label + ': ' + fmt(d.revenue) + ' د.ع'} />
                    <span className="muted mono" style={{ fontSize: 10, whiteSpace: 'nowrap' }}>{d.label}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-2 mb-4">
        <div className="card">
          <div className="card-header"><h3>توزيع حالات الطلبات</h3></div>
          <div className="card-body">
            {statusBreakdown.map((s) => (
              <div className="bar-row" key={s.status}>
                <div className="bar-label"><Badge status={s.status} map={ORDER_STATUS} /></div>
                <div className="bar-track">
                  <div className="bar-fill" style={{ width: `${Math.max(3, (s.count / Math.max(1, ...statusBreakdown.map((x) => x.count))) * 100)}%`, background: STATUS_COLOR[s.status] || 'var(--primary)' }} />
                </div>
                <div className="bar-value">{fmt(s.count)}</div>
              </div>
            ))}
            <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>
              الإيرادات حسب الحالة: {statusBreakdown.map((s) => `${ORDER_STATUS[s.status]?.label || s.status} ${fmt(s.revenue)}`).join(' · ')}
            </div>
          </div>
        </div>

        <div className="card">
          <div className="card-header"><h3>يتطلب انتباهك</h3></div>
          <div className="card-body">
            {attention.pendingProviders === 0 && attention.pendingAgentWithdrawals === 0 ? (
              <div className="alert-success" style={{ fontSize: 13 }}>لا توجد عناصر معلقة تحتاج إجراءً عاجلاً.</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {attention.pendingProviders > 0 && (
                  <div className="alert-warning flex-between" style={{ fontSize: 13, margin: 0 }}>
                    <span>مزودو خدمة بانتظار التوثيق</span>
                    <span className="badge badge-amber">{fmt(attention.pendingProviders)}</span>
                  </div>
                )}
                {attention.pendingAgentWithdrawals > 0 && (
                  <div className="alert-warning flex-between" style={{ fontSize: 13, margin: 0 }}>
                    <span>طلبات سحب وكلاء بانتظار الموافقة</span>
                    <span className="badge badge-amber">{fmt(attention.pendingAgentWithdrawals)}</span>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="grid grid-2 mb-4">
        <div className="card">
          <div className="card-header"><h3>أعلى المحافظات بالطلبات</h3></div>
          <div className="card-body">
            {topProvinces.length === 0 ? <div className="muted">لا توجد بيانات.</div> : topProvinces.map((p) => (
              <RankBar key={p.id} label={p.name} value={p.orders} sub={`${fmt(p.revenue)} د.ع`} max={provincesMax} />
            ))}
          </div>
        </div>

        <div className="card">
          <div className="card-header"><h3>أعلى مزودي الخدمة بالطلبات</h3></div>
          <div className="card-body">
            {topProviders.length === 0 ? <div className="muted">لا توجد بيانات.</div> : topProviders.map((p) => (
              <RankBar key={p.id} label={p.name} value={p.orders} sub={`${fmt(p.revenue)} د.ع`} max={providersMax} />
            ))}
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-header"><h3>تفصيل المؤشرات</h3></div>
        <div className="card-body">
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ textAlign: 'right', borderBottom: '2px solid var(--border)' }}>
                <th style={{ padding: '8px' }}>المؤشر</th>
                <th style={{ padding: '8px' }}>الحالي</th>
                <th style={{ padding: '8px' }}>السابق</th>
                <th style={{ padding: '8px' }}>التغير</th>
                <th style={{ padding: '8px' }}>الحالة</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(kpis).map(([key, kpi]) => (
                <tr key={key} style={{ borderBottom: '1px solid var(--border)' }}>
                  <td style={{ padding: '10px 8px', fontWeight: 600 }}>{kpi.label}</td>
                  <td style={{ padding: '10px 8px', fontFamily: 'monospace' }}>{key === 'conversion' ? `${kpi.current}%` : fmt(kpi.current)}</td>
                  <td style={{ padding: '10px 8px', fontFamily: 'monospace' }}>{key === 'conversion' ? `${kpi.previous}%` : fmt(kpi.previous)}</td>
                  <td style={{ padding: '10px 8px', fontFamily: 'monospace' }}>
                    <span className={`badge ${kpi.deltaPct > 0 ? 'badge-green' : kpi.deltaPct < 0 ? 'badge-red' : 'badge-gray'}`}>
                      {kpi.deltaPct > 0 ? '↑' : kpi.deltaPct < 0 ? '↓' : '→'} {Math.abs(kpi.deltaPct).toFixed(1)}%
                    </span>
                  </td>
                  <td style={{ padding: '10px 8px' }}>
                    {kpi.deltaPct > 0 ? <span className="badge badge-green">↑ تحسن</span> : kpi.deltaPct < 0 ? <span className="badge badge-red">↓ تراجع</span> : <span className="badge badge-gray">→ ثابت</span>}
                  </td>
                </tr>
              ))}
              <tr style={{ borderBottom: '1px solid var(--border)' }}>
                <td style={{ padding: '10px 8px', fontWeight: 600 }}>متوسط قيمة الطلب (AOV)</td>
                <td style={{ padding: '10px 8px', fontFamily: 'monospace' }}>{fmt(averages.aov)} د.ع</td>
                <td style={{ padding: '10px 8px', fontFamily: 'monospace' }}>{fmt(averages.aovPrevious)} د.ع</td>
                <td style={{ padding: '10px 8px', fontFamily: 'monospace' }} colSpan={3}>
                  <span className="muted">متوسط قيمة الطلب الواحد خلال الفترة</span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
