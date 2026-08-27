import { useEffect, useState } from 'react';
import { api } from '../api';
import { useToast, fmt, fmtDate, PageLoading, EmptyState, Badge, Pagination } from '@rafidain/shared/ui';
import type { Customer } from '../types';

const REGISTERED = {
  yes: { label: 'مسجل', cls: 'badge-teal' },
  no: { label: 'طلب مباشر', cls: 'badge-gray' },
};

export default function Customers() {
  const [rows, setRows] = useState<Customer[] | null>(null);
  const [meta, setMeta] = useState<any>(null);
  const [page, setPage] = useState(1);
  const [q, setQ] = useState('');
  const [lapsed, setLapsed] = useState(false);
  const toast = useToast();

  const load = (pg = page, query = q, lp = lapsed) => {
    const p = new URLSearchParams();
    if (query) p.set('q', query);
    if (lp) p.set('lapsed', '1');
    p.set('page', String(pg));
    p.set('limit', '20');
    api.get(`/agent/customers?${p.toString()}`).then((r) => { setRows(r.data); setMeta(r.meta || null); }).catch((e) => toast.error(e.message));
  };

  useEffect(() => { load(); }, [page]);

  const search = () => { setPage(1); load(1, q, lapsed); };

  const toggleLapsed = () => {
    const next = !lapsed;
    setLapsed(next);
    setPage(1);
    load(1, q, next);
  };

  const exportCsv = async () => {
    try {
      const ps = new URLSearchParams();
      if (q) ps.set('q', q);
      if (lapsed) ps.set('lapsed', '1');
      const qs = ps.toString();
      const res = await fetch(`/api/agent/customers/export${qs ? '?' + qs : ''}`, { credentials: 'include' });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.message || 'تعذر تصدير الزبائن');
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `customers-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast.success('تم تصدير الزبائن بنجاح');
    } catch (e: any) { toast.error(e.message); }
  };

  if (!rows) return <PageLoading />;

  return (
    <div>
      <div className="page-head">
        <div>
          <h2>زبائن محافظتي</h2>
          <p>جميع عملاء مزودي الخدمة في محافظتك — المسجلون منهم ومن لديهم طلبات مباشرة عبر المكتب الخلفي</p>
        </div>
        <div className="flex">
          <button className="btn btn-outline" onClick={exportCsv}>⬇ تصدير CSV</button>
        </div>
      </div>

      <div className="filters">
        <input placeholder="بحث بالاسم أو الهاتف أو البريد..." value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && search()} />
        <button className="btn btn-outline btn-sm" onClick={search}>بحث</button>
      </div>

      <div className="chip-row mb-3">
        <button type="button" className={`chip${lapsed ? ' chip--active' : ''}`} onClick={toggleLapsed}>
          🔄 زبائن عائدون (آخر طلب قبل 30 يوماً فأكثر)
        </button>
      </div>

      <div className="card">
        <div className="table-wrap">
          {rows.length === 0 ? <EmptyState text="لا يوجد زبائن في محافظتك بعد" icon="👥" /> : (
            <table>
              <thead>
                <tr>
                  <th>الزبون</th><th>الهاتف</th><th>النوع</th><th>الطلبات</th>
                  <th>إجمالي المشتريات (دينار)</th><th>معلقة</th><th>آخر طلب</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((c) => (
                  <tr key={`${c.id || 'w'}-${c.name}-${c.phone}`}>
                    <td>
                      <div className="bold">{c.name}</div>
                      <div className="muted" style={{ fontSize: 12 }}>{c.email || ''}</div>
                    </td>
                    <td dir="ltr">{c.phone || '-'}</td>
                    <td><Badge status={c.id ? 'yes' : 'no'} map={REGISTERED} /></td>
                    <td>{fmt(c.orders_count)}</td>
                    <td className="bold">{fmt(c.total_value)}</td>
                    <td>{fmt(c.pending_count)}</td>
                    <td className="muted">{c.last_order_at ? fmtDate(c.last_order_at) : '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <Pagination meta={meta} page={page} onChange={setPage} />
    </div>
  );
}
