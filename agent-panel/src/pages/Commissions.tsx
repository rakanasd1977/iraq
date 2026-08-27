import { useEffect, useState } from 'react';
import { api } from '../api';
import { useToast, fmt, PageLoading, StatCard, EmptyState } from '@rafidain/shared/ui';
import type { CommissionsData } from '../types';

export default function Commissions() {
  const [data, setData] = useState<CommissionsData | null>(null);
  const toast = useToast();

  useEffect(() => {
    api.get('/agent/commissions').then((r) => setData(r.data)).catch((e) => toast.error(e.message));
  }, []);

  const exportCsv = async () => {
    try {
      const res = await fetch('/api/agent/commissions/export', { credentials: 'include' });
      if (!res.ok) {
        const d = await res.json().catch(() => null);
        throw new Error(d?.message || 'تعذر تصدير العمولات');
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `commissions-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast.success('تم تصدير سجل العمولات بنجاح');
    } catch (e: any) { toast.error(e.message); }
  };

  if (!data) return <PageLoading />;

  const s = data.summary;
  const maxMonthly = Math.max(1, ...data.monthly.map((m) => m.commission));

  return (
    <div>
      <div className="page-head">
        <div>
          <h2>عمولاتي</h2>
          <p>أرباحك من العمولات على طلبات مزودي الخدمة في محافظتك — نسبتك الحالية: %{data.commission_rate}</p>
        </div>
        <button className="btn btn-outline" onClick={exportCsv}>⬇ تصدير CSV</button>
      </div>

      <div className="grid grid-3 mb-4">
        <StatCard label="عدد الطلبات (غير الملغاة)" value={fmt(s.orders_count)} icon="🧾" tone="info" />
        <StatCard label="قيمة الطلبات (دينار)" value={fmt(s.orders_value)} icon="💵" tone="primary" />
        <StatCard label="إجمالي عمولاتي (دينار)" value={fmt(s.total_commission)} icon="💰" tone="accent" />
      </div>

      <div className="grid grid-2">
        <div className="card">
          <div className="card-header"><h3>عمولاتي الشهرية (آخر 6 أشهر)</h3></div>
          <div className="card-body">
            {data.monthly.length === 0 ? <EmptyState text="لا توجد عمولات بعد" icon="💰" /> : (
              data.monthly.map((m) => (
                <div className="bar-row" key={m.month}>
                  <span className="bar-label mono">{m.month}</span>
                  <div className="bar-track"><div className="bar-fill" style={{ width: `${(m.commission / maxMonthly) * 100}%` }} /></div>
                  <span className="bar-value">{fmt(m.commission)}</span>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="card">
          <div className="card-header"><h3>أعلى المزودين مساهمة في عمولاتك</h3></div>
          <div className="table-wrap">
            <table>
              <thead><tr><th>المزود</th><th>الطلبات</th><th>عمولتي (دينار)</th></tr></thead>
              <tbody>
                {data.top_providers.length === 0 && <tr><td colSpan={3}><div className="muted" style={{ padding: 16 }}>لا توجد بيانات</div></td></tr>}
                {data.top_providers.map((p) => (
                  <tr key={p.id}>
                    <td className="bold">{p.name_ar}</td>
                    <td>{fmt(p.orders_count)}</td>
                    <td>{fmt(p.commission)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
