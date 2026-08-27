import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useToast, fmt, fmtDate, PageLoading, EmptyState, Badge, ORDER_STATUS } from '@rafidain/shared/ui';
import type { ProviderOverview } from '../types';

const TXN_TYPES = {
  commission: { label: 'عمولة', cls: 'badge-red' },
  refund: { label: 'استرداد', cls: 'badge-amber' },
  recharge: { label: 'شحن محفظة', cls: 'badge-green' },
  promotion: { label: 'ترقية', cls: 'badge-blue' },
  withdrawal: { label: 'سحب', cls: 'badge-gray' },
};

function Stars({ value, count }: { value: number; count: number }) {
  const v = Number(value) || 0;
  const full = Math.round(v);
  return (
    <span>
      <span className="rating-stars">{'★'.repeat(full)}{'☆'.repeat(Math.max(0, 5 - full))}</span>{' '}
      {v > 0 ? <span className="bold">{v.toFixed(1)}</span> : <span className="muted">بدون تقييم</span>}
      {count > 0 && <span className="rating-num"> ({fmt(count)} تقييم)</span>}
    </span>
  );
}

const SVC_COLORS = ['#0f766e', '#2563eb', '#d97706', '#16a34a', '#7c3aed', '#dc2626', '#0891b2', '#65a30d'];

export default function ProviderDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const [data, setData] = useState<ProviderOverview | null>(null);

  useEffect(() => {
    api.get(`/providers/${id}/overview`)
      .then((r) => setData(r.data))
      .catch((e) => { toast.error(e.message); navigate('/providers'); });
  }, [id]);

  if (!data) return <PageLoading />;
  const p = data.provider;
  const catalog = data.catalog || {};
  const maxOrders = Math.max(1, ...data.monthly.map((m) => m.orders_count));
  const maxStatus = Math.max(1, ...data.orders_by_status.map((s) => s.count));

  return (
    <div>
      <div className="subhead">
        <button className="back" onClick={() => navigate('/providers')}>→ العودة للمزودين</button>
      </div>

      <div className="card mb-4">
        <div className="card-body" style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
          <div className="avatar-lg">{p.service_icon || '🏪'}</div>
          <div style={{ flex: 1, minWidth: 220 }}>
            <h2 style={{ margin: 0, fontSize: 20 }}>{p.name_ar}</h2>
            <div className="muted" style={{ fontSize: 13 }}>{p.email} • {p.phone || ''}</div>
            <div className="flex wrap mt-1" style={{ gap: 8 }}>
              <Badge status={p.verification_status || 'none'} map={{ approved: { label: 'موثق ✓', cls: 'badge-green' }, pending: { label: 'قيد المراجعة', cls: 'badge-amber' }, rejected: { label: 'توثيق مرفوض', cls: 'badge-red' }, none: { label: 'غير موثق', cls: 'badge-gray' } }} />
              <span className="badge badge-blue">{p.service_icon} {p.service_name_ar}</span>
              <span className={`badge ${p.is_active ? 'badge-green' : 'badge-red'}`}>{p.is_active ? 'نشط' : 'متوقف'}</span>
            </div>
            <div className="mt-1"><Stars value={data.rating || 0} count={data.rating_count || 0} /></div>
          </div>
          <div style={{ textAlign: 'left' }}>
            <div className="kpi__label">رصيد محفظة المزود</div>
            <div className="kpi__value">{fmt(data.wallet?.balance || 0)} <span className="muted" style={{ fontSize: 12 }}>دينار</span></div>
            <div className="kpi__label mt-1">عمولة المنصة</div>
            <div className="kpi__value">%{p.commission_rate}</div>
          </div>
        </div>
      </div>

      <div className="kpi-row mb-4">
        <div className="kpi"><div className="kpi__label">إجمالي الطلبات</div><div className="kpi__value">{fmt(p.orders_count)}</div></div>
        <div className="kpi"><div className="kpi__label">قيمة الطلبات (دينار)</div><div className="kpi__value">{fmt(p.total_value)}</div></div>
        <div className="kpi"><div className="kpi__label">المدينة</div><div className="kpi__value" style={{ fontSize: 14 }}>{p.governorate_name_ar}</div></div>
        <div className="kpi"><div className="kpi__label">تاريخ الانضمام</div><div className="kpi__value" style={{ fontSize: 14 }}>{fmtDate(p.created_at)}</div></div>
      </div>

      <div className="grid grid-2 mb-4">
        <div className="card">
          <div className="card-header"><h3>الطلبات حسب الحالة</h3></div>
          <div className="card-body">
            {data.orders_by_status.length === 0 && <div className="muted">لا توجد طلبات</div>}
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
          <div className="card-header"><h3>📦 ما ينشره المزود</h3></div>
          <div className="card-body">
            {Object.keys(catalog).length === 0 ? <div className="muted">لا يوجد كتالوج</div> : (
              Object.keys(catalog).map((k) => (
                <div className="flex-between" key={k} style={{ padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
                  <span className="bold">{k}</span>
                  <span className="badge badge-teal">{fmt(catalog[k])}</span>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      <div className="card mb-4">
        <div className="card-header"><h3>📈 نشاط المزود (آخر 6 أشهر)</h3></div>
        <div className="card-body">
          {data.monthly.length === 0 ? <div className="muted">لا توجد بيانات</div> : (
            data.monthly.map((m) => (
              <div className="bar-row" key={m.month}>
                <span className="bar-label mono">{m.month}</span>
                <div className="bar-track"><div className="bar-fill" style={{ width: `${(m.orders_count / maxOrders) * 100}%` }} /></div>
                <span className="bar-value">{fmt(m.orders_count)} طلب</span>
                <span className="muted" style={{ fontSize: 12, width: 130, textAlign: 'left' }}>{fmt(m.total_value)} د.ع • عمولة {fmt(m.commission)}</span>
              </div>
            ))
          )}
        </div>
      </div>

      <div className="grid grid-2 mb-4">
        <div className="card">
          <div className="card-header"><h3>آخر طلبات المزود</h3></div>
          <div className="table-wrap">
            <table>
              <thead><tr><th>الطلب</th><th>الزبون</th><th>المبلغ</th><th>الحالة</th><th>التاريخ</th></tr></thead>
              <tbody>
                {data.recent_orders.length === 0 && <tr><td colSpan={5}><div className="muted" style={{ padding: 16 }}>لا توجد طلبات</div></td></tr>}
                {data.recent_orders.map((o, i) => (
                  <tr key={`${o.order_number}-${i}`}>
                    <td><span className="mono">{o.order_number}</span></td>
                    <td>{o.customer_name || o.customer || '-'}</td>
                    <td>{fmt(o.total_amount)}</td>
                    <td><Badge status={o.status} map={ORDER_STATUS} /></td>
                    <td className="muted">{fmtDate(o.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="card">
          <div className="card-header"><h3>آخر حركات المحفظة</h3></div>
          <div className="table-wrap">
            <table>
              <thead><tr><th>النوع</th><th>المبلغ</th><th>الرصيد بعدها</th><th>السبب</th></tr></thead>
              <tbody>
                {data.transactions.length === 0 && <tr><td colSpan={4}><div className="muted" style={{ padding: 16 }}>لا توجد حركات</div></td></tr>}
                {data.transactions.map((t) => (
                  <tr key={t.id}>
                    <td><Badge status={t.type} map={TXN_TYPES} /></td>
                    <td className={`bold ${t.amount < 0 ? 'rating-low' : ''}`}>{fmt(t.amount)}</td>
                    <td>{fmt(t.balance_after)}</td>
                    <td className="muted" style={{ fontSize: 12 }}>{t.note || (t.order_number ? `طلب ${t.order_number}` : '-')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div className="card mb-4">
        <div className="card-header"><h3>⭐ تقييمات العملاء ({fmt(data.rating_count)})</h3></div>
        <div className="card-body">
          {data.reviews.length === 0 ? <EmptyState text="لا توجد تقييمات بعد" icon="⭐" /> : (
            data.reviews.map((r, i) => (
              <div className="review-row" key={i}>
                <div className="review-row__head">
                  <span className="rating-stars">{'★'.repeat(r.rating)}{'☆'.repeat(Math.max(0, 5 - r.rating))}</span>
                  <span className="bold">{r.customer_name || 'زبون'}</span>
                  <span className="muted">• {fmtDate(r.created_at)}</span>
                </div>
                {r.comment && <div className="review-row__text">{r.comment}</div>}
                {r.reply && <div className="review-row__reply">رد المزود: {r.reply}</div>}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
