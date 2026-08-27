import { useEffect, useState } from 'react';
import { api } from '../api';
import { useToast, fmt, StatCard, PageLoading, EmptyState } from '@rafidain/shared/ui';

const GROUPS = [
  { value: 'month', label: 'شهري' },
  { value: 'day', label: 'يومي' },
  { value: 'week', label: 'أسبوعي' },
  { value: 'governorate', label: 'حسب المحافظة' },
  { value: 'service', label: 'حسب الخدمة' },
  { value: 'agent', label: 'حسب الوكيل' },
  { value: 'provider', label: 'حسب المزود' },
];

export default function FinancialReport() {
  const [data, setData] = useState<any>(null);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [groupBy, setGroupBy] = useState('month');
  const toast = useToast();

  const load = (f = from, t = to, g = groupBy) => {
    const p = new URLSearchParams({ group_by: g });
    if (f) p.set('from', f);
    if (t) p.set('to', t);
    api.get(`/financial-report?${p}`)
      .then((r) => setData(r.data))
      .catch((e) => toast.error(e.message));
  };

  useEffect(() => { load(); }, []);

  const exportCsv = async () => {
    try {
      const p = new URLSearchParams({ group_by: groupBy });
      if (from) p.set('from', from);
      if (to) p.set('to', to);
      const res = await fetch(`/api/financial-report/export?${p}`, { credentials: 'include' });
      if (!res.ok) {
        const d = await res.json().catch(() => null);
        throw new Error(d?.message || 'تعذر تصدير التقرير');
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `financial-report-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast.success('تم تصدير التقرير المالي بنجاح');
    } catch (e: any) { toast.error(e.message); }
  };

  if (!data) return <PageLoading />;

  const s = data.summary;

  return (
    <div>
      <div className="page-head">
        <div>
          <h2>التقرير المالي</h2>
          <p>إيرادات المنصة وأرباح الوكلاء وقيمة الطلبات حسب الفترة والتصنيف</p>
        </div>
        <button className="btn btn-outline" onClick={exportCsv}>⬇ تصدير CSV</button>
      </div>

      <div className="filters">
        <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} title="من تاريخ" />
        <input type="date" value={to} onChange={(e) => setTo(e.target.value)} title="إلى تاريخ" />
        <select value={groupBy} onChange={(e) => setGroupBy(e.target.value)}>
          {GROUPS.map((g) => <option key={g.value} value={g.value}>{g.label}</option>)}
        </select>
        <button className="btn btn-primary" onClick={() => load()}>تطبيق</button>
        {(from || to || groupBy !== 'month') && (
          <button className="btn btn-ghost btn-sm" onClick={() => { setFrom(''); setTo(''); setGroupBy('month'); load('', '', 'month'); }}>إعادة تعيين ↺</button>
        )}
      </div>

      <div className="grid grid-3 mb-4">
        <StatCard label="عدد الطلبات" value={fmt(s.orders_count)} icon="🧾" tone="info" />
        <StatCard label="قيمة الطلبات (دينار)" value={fmt(s.orders_value)} icon="💵" tone="primary" />
        <StatCard label="متوسط قيمة الطلب" value={fmt(s.avg_order_value)} icon="📊" tone="info" />
      </div>
      <div className="grid grid-3 mb-4">
        <StatCard label="إيرادات المنصة (دينار)" value={fmt(s.platform_revenue)} icon="💰" tone="success" />
        <StatCard label="أرباح الوكلاء (دينار)" value={fmt(s.agent_revenue)} icon="🤝" tone="accent" />
        <StatCard label="طلبات ملغاة" value={fmt(s.cancelled_count)} icon="🚫" tone="warn" />
      </div>

      <div className="card">
        <div className="card-header">
          <h3>التفصيل — {GROUPS.find((g) => g.value === data.period.group_by)?.label}</h3>
          <span className="badge badge-gray">الفترة: {from || 'البداية'} ← {to || 'الآن'}</span>
        </div>
        <div className="table-wrap">
          {data.rows.length === 0 ? <EmptyState text="لا توجد بيانات ضمن هذه الفترة" icon="📭" /> : (
            <table>
              <thead>
                <tr>
                  <th>التصنيف</th>
                  <th>الطلبات</th>
                  <th>قيمة الطلبات (دينار)</th>
                  <th>إيراد المنصة (دينار)</th>
                  <th>أرباح الوكلاء (دينار)</th>
                  <th>ملغاة</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((r: any) => (
                  <tr key={r.key}>
                    <td className="bold">{r.label}</td>
                    <td>{fmt(r.orders_count)}</td>
                    <td>{fmt(r.orders_value)}</td>
                    <td>{fmt(r.platform_revenue)}</td>
                    <td>{fmt(r.agent_revenue)}</td>
                    <td>{fmt(r.cancelled_count)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
