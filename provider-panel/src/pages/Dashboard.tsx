import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useToast, fmt, fmtDate, StatCard, PageLoading, Badge, ORDER_STATUS } from '@rafidain/shared/ui';
import { CATALOGS } from '../catalog';

function renderTypeAlert(data: any, p: any, go: (to: string) => void) {
  const ta = data.type_alerts || {};
  switch (p.service_slug) {
    case 'stores': {
      const out = ta.out_of_stock || 0;
      const low = ta.low_stock || 0;
      if (!out && !low) return null;
      return (
        <div className="alert-warning mb-4">⚠️ <strong>{out}</strong> منتج نفد من المخزون و<strong>{low}</strong> على وشك النفاد (المتبقي ≤ 5).
          <button className="btn btn-outline btn-sm" style={{ marginInlineStart: 8 }} onClick={() => go('/catalog')}>إدارة المخزون</button>
        </div>
      );
    }
    case 'restaurants': {
      if (!ta.unavailable) return null;
      return (
        <div className="alert-warning mb-4">⚠️ لديك <strong>{ta.unavailable}</strong> صنف غير متوفر حالياً — لن يظهر لزبائنك في القائمة.
          <button className="btn btn-outline btn-sm" style={{ marginInlineStart: 8 }} onClick={() => go('/catalog')}>إدارة القائمة</button>
        </div>
      );
    }
    case 'hotels':
    case 'flights':
    case 'travel_offices': {
      if (!ta.upcoming) return null;
      const label = p.service_slug === 'hotels' ? 'وصول' : p.service_slug === 'flights' ? 'رحلة محجوزة' : 'حجز باقة';
      const icon = p.service_slug === 'hotels' ? '🛎️' : p.service_slug === 'flights' ? '✈️' : '🧳';
      return (
        <div className="alert-info mb-4">{icon} لديك <strong>{ta.upcoming}</strong> {label} خلال الأيام السبعة القادمة.
          <button className="btn btn-outline btn-sm" style={{ marginInlineStart: 8 }} onClick={() => go('/bookings')}>عرض الحجوزات</button>
        </div>
      );
    }
    default:
      return null;
  }
}

export default function Dashboard() {
  const [data, setData] = useState<any>(null);
  const toast = useToast();
  const navigate = useNavigate();
  const go = (to: string) => navigate(to);

  useEffect(() => {
    api.get('/provider/dashboard').then((r) => setData(r.data)).catch((e) => toast.error(e.message));
  }, []);

  if (!data) return <PageLoading />;

  const p = data.provider;
  const cat = (CATALOGS as Record<string, any>)[p.service_slug];
  const maxStatus = Math.max(1, ...data.orders_by_status.map((s: any) => s.count));
  const maxMonth = Math.max(1, ...data.monthly.map((m: any) => Number(m.revenue)));

  return (
    <div>
      <div className="page-head">
        <div>
          <h2>لوحة معلومات {p.name_ar}</h2>
          <p>{cat?.title} في محافظة {p.governorate_name_ar} — إحصائيات متجرك فقط</p>
        </div>
      </div>

      {!p.is_verified && (
        <div className="alert-info mb-4">ℹ️ حسابك غير موثق بعد — سيتولى وكيل محافظتك أو المسؤول توثيقه. يمكنك إدارة محتواك أثناء ذلك.</div>
      )}

      {renderTypeAlert(data, p, go)}

      <div className="card mb-4">
        <div className="card-header"><h3>⚡ إجراءات سريعة</h3></div>
        <div className="card-body">
          <div className="flex wrap" style={{ gap: 8 }}>
            <button className="btn btn-outline btn-sm" onClick={() => go('/catalog')}>+ إضافة {cat?.item || 'عنصر'}</button>
            <button className="btn btn-outline btn-sm" onClick={() => go('/offers')}>🏷️ العروض المميزة</button>
            <button className="btn btn-outline btn-sm" onClick={() => go('/promotions')}>📢 الترويج</button>
            {['hotels', 'flights', 'travel_offices'].includes(p.service_slug) && (
              <button className="btn btn-outline btn-sm" onClick={() => go('/bookings')}>📅 الحجوزات</button>
            )}
            <button className="btn btn-outline btn-sm" onClick={() => go('/wallet')}>👛 محفظتي</button>
          </div>
        </div>
      </div>

      <div className="grid grid-4 mb-4">
        <StatCard label={cat?.title || 'الفهرس'} value={fmt(data.catalog_count)} icon={cat?.icon || '📦'} tone="primary" />
        <StatCard label="إجمالي الطلبات" value={fmt(data.orders_count)} icon="🧾" tone="info" />
        <StatCard label="قيمة الطلبات (دينار)" value={fmt(data.orders_value)} icon="💵" tone="primary" />
        <StatCard label="صافي إيرادك (دينار)" value={fmt(data.revenue)} icon="💰" tone="success" />
      </div>

      <div className="card mb-4">
        <div className="card-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
          <h3>📢 أداء الترويجات</h3>
          <button className="btn btn-outline btn-sm" onClick={() => go('/promotions')}>إدارة الترويجات</button>
        </div>
        <div className="card-body">
          {data.promotions.active_count === 0 ? (
            <div className="muted">لا توجد ترويجات نشطة حالياً — روّج أحد عناصرك ليظهر إعلانك لزبائن محافظة {p.governorate_name_ar}.</div>
          ) : (
            <div className="grid grid-4">
              <div className="stat-mini"><span className="stat-mini__label">الترويجات النشطة</span><span className="stat-mini__value">{fmt(data.promotions.active_count)}</span></div>
              <div className="stat-mini"><span className="stat-mini__label">مرات الظهور</span><span className="stat-mini__value">{fmt(data.promotions.impressions)}</span></div>
              <div className="stat-mini"><span className="stat-mini__label">النقرات</span><span className="stat-mini__value">{fmt(data.promotions.clicks)}</span></div>
              <div className="stat-mini"><span className="stat-mini__label">معدل النقر (CTR)</span><span className="stat-mini__value">%{data.promotions.ctr}</span></div>
            </div>
          )}
        </div>
      </div>

      <div className="card mb-4">
        <div className="card-body">
          <div className="detail-grid">
            <div className="detail-item"><div className="k">اسم النشاط</div><div className="v">{p.name_ar}</div></div>
            <div className="detail-item"><div className="k">نوع الخدمة</div><div className="v"><span className="badge badge-blue">{cat?.icon} {cat?.title}</span></div></div>
            <div className="detail-item"><div className="k">المحافظة</div><div className="v"><span className="badge badge-teal">{p.governorate_name_ar}</span></div></div>
            <div className="detail-item"><div className="k">نسبة عمولة المنصة</div><div className="v">%{p.commission_rate}</div></div>
            <div className="detail-item"><div className="k">التوثيق</div><div className="v"><Badge status={p.is_verified ? 'verified' : 'not'} map={{ verified: { label: 'موثق ✓', cls: 'badge-green' }, not: { label: 'غير موثق', cls: 'badge-gray' } }} /></div></div>
            <div className="detail-item"><div className="k">التقييم</div><div className="v">{p.rating} / 5 <span className="muted">({p.rating_count} تقييم)</span></div></div>
          </div>
        </div>
      </div>

      <div className="grid grid-2 mb-4">
        <div className="card">
          <div className="card-header"><h3>الطلبات حسب الحالة</h3></div>
          <div className="card-body">
            {data.orders_by_status.length === 0 && <div className="muted">لا توجد طلبات بعد</div>}
            {data.orders_by_status.map((s: any) => (
              <div className="bar-row" key={s.status}>
                <span className="bar-label"><Badge status={s.status} map={ORDER_STATUS} /></span>
                <div className="bar-track"><div className="bar-fill" style={{ width: `${(s.count / maxStatus) * 100}%` }} /></div>
                <span className="bar-value">{fmt(s.count)}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="card">
          <div className="card-header"><h3>إيرادك الشهري (دينار)</h3></div>
          <div className="card-body">
            {data.monthly.length === 0 && <div className="muted">لا توجد بيانات بعد</div>}
            {data.monthly.map((m: any) => (
              <div className="bar-row" key={m.month}>
                <span className="bar-label muted">{m.month}</span>
                <div className="bar-track"><div className="bar-fill" style={{ width: `${(Number(m.revenue) / maxMonth) * 100}%`, background: 'var(--success)' }} /></div>
                <span className="bar-value">{fmt(m.revenue)}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-header"><h3>آخر الطلبات</h3></div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>الطلب</th><th>الزبون</th><th>المبلغ (دينار)</th><th>صافي إيرادك</th><th>الحالة</th><th>التاريخ</th></tr></thead>
            <tbody>
              {data.recent_orders.length === 0 && <tr><td colSpan={6}><div className="muted" style={{ padding: 16 }}>لا توجد طلبات بعد — عندما يطلب زبون من متجرك سيظهر هنا</div></td></tr>}
               {data.recent_orders.map((o: any) => (
                <tr key={o.id}>
                  <td><span className="mono">{o.order_number}</span></td>
                  <td>{o.customer_name || '-'}</td>
                  <td>{fmt(o.total_amount)}</td>
                  <td className="bold" style={{ color: 'var(--success)' }}>{fmt(o.provider_amount)}</td>
                  <td><Badge status={o.status} map={ORDER_STATUS} /></td>
                  <td className="muted">{fmtDate(o.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
