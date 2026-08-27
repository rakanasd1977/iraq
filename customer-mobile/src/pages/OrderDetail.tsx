import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { PageHeader } from '../components/PageHeader';
import { Badge, ORDER_STATUS } from '@rafidain/shared/ui';
import { Toast } from '../components/Toast';
import { CenterSpinner } from '../components/Spinner';
import { useCart } from '../context/CartContext';
import { customerApi } from '../api';
import { formatPrice, formatDateTime } from '../format';

const UNIT: Record<string, string> = { products: 'قطعة', menu: 'صنف', packages: 'باقة', rooms: 'ليلة', flights: 'تذكرة' };
const FLOW = [
  { key: 'pending', label: 'قيد المراجعة' },
  { key: 'confirmed', label: 'تأكيد المزوّد' },
  { key: 'in_progress', label: 'قيد التنفيذ' },
  { key: 'completed', label: 'مكتمل' },
];

function OrderTimeline({ status, createdAt, history }: { status: string; createdAt: string; history?: any[] }) {
  const idx = FLOW.findIndex((s) => s.key === status);
  const at = (key: string) => {
    if (key === 'pending') return createdAt;
    const hit = (history || []).find((h: any) => h.status === key);
    return hit ? hit.at : null;
  };
  return (
    <div className="timeline">
      {FLOW.map((step, i) => {
        const done = idx > i;
        const current = idx === i;
        const reached = idx >= i || (history || []).some((h: any) => h.status === step.key);
        const date = at(step.key);
        const actor = (history || []).find((h: any) => h.status === step.key);
        return (
          <div className="timeline__row" key={step.key}>
            <div className="timeline__rail">
              <span className={`timeline__dot${done ? ' timeline__dot--done' : ''}${current ? ' timeline__dot--current' : ''}`} />
              {i < FLOW.length - 1 && <span className={`timeline__line${done ? ' timeline__line--done' : ''}`} />}
            </div>
            <div className="timeline__body">
              <div className={`timeline__label${done ? ' timeline__label--done' : ''}${current ? ' timeline__label--current' : ''}`}>
                {step.label}
                {current && <span className="muted" style={{ marginRight: 6 }}>· الحالة الحالية</span>}
              </div>
              {date && (
                <div className="timeline__date">
                  {formatDateTime(date)}
                  {actor?.note ? ` — ${actor.note}` : ''}
                  {actor?.by_name ? ` (${actor.by_name})` : ''}
                </div>
              )}
              {!date && i === 0 && <div className="timeline__date">{formatDateTime(createdAt)}</div>}
              {!reached && !date && <div className="timeline__date" />}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default function OrderDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { addItem } = useCart();
  const [order, setOrder] = useState<any>(null);
  const [rateInfo, setRateInfo] = useState<any>(null);
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState('');
  const [toast, setToast] = useState('');

  useEffect(() => {
    customerApi
      .order(id || '')
      .then((o) => {
        setOrder(o);
        if (o.status === 'completed') {
          return customerApi.rateInfo(o.provider_id).then((r) => {
            setRateInfo(r);
            if (r.my_rating) setRating(r.my_rating);
          });
        }
        return null;
      })
      .catch(() => setOrder(null));
  }, [id]);

  if (!order) {
    return (
      <div>
        <PageHeader title="تفاصيل الطلب" />
        <CenterSpinner />
      </div>
    );
  }

  const items = (() => {
    try {
      return JSON.parse(order.items_json || '[]');
    } catch (e: any) {
      return [];
    }
  })();

  const submitRating = async () => {
    if (rating < 1) {
      setToast('اختر تقييماً من 1 إلى 5');
      return;
    }
    try {
      await customerApi.rate(order.provider_id, rating, comment || undefined);
      setToast('شكراً لتقييمك');
    } catch (e: any) {
      setToast(e.message);
    }
  };

  const reorder = () => {
    const addable = items.filter((it: any) => it && it.item_id !== undefined && ['products', 'menu', 'packages'].includes(it.kind));
    if (!addable.length) {
      setToast('لا يمكن إعادة طلب الحجوزات تلقائياً — عد إلى المزوّد');
      return;
    }
    for (const it of addable) {
      addItem({
        provider_id: order.provider_id,
        provider_name: order.provider_name,
        kind: it.kind,
        item_id: it.item_id,
        title: it.title,
        unit_price: Number(it.unit_price) || 0,
        quantity: Number(it.quantity) || 1,
        unit: UNIT[it.kind] || 'وحدة',
      });
    }
    setToast(`أُضيفت ${addable.length} عناصر إلى السلة`);
    navigate('/cart');
  };

  return (
    <div>
      <PageHeader title={order.order_number} />
      <div className="page page--no-nav">
        <div className="card" style={{ padding: 14 }}>
          <div className="row row--between">
            <span className="detail-title">{order.provider_name}</span>
            <Badge status={order.status} map={ORDER_STATUS} />
          </div>
          <div className="muted" style={{ marginTop: 4 }}>{order.service_name_ar}</div>
          {order.customer_name && <div className="muted" style={{ marginTop: 2 }}>الزبون: {order.customer_name} {order.customer_phone}</div>}
          {order.discount_amount > 0 && (
            <div className="summary-row" style={{ marginTop: 6 }}>
              <span>الخصم ({order.coupon_code})</span>
              <span style={{ color: '#00a650', fontWeight: 700 }}>-{formatPrice(order.discount_amount)}</span>
            </div>
          )}
          {order.points_discount_amount > 0 && (
            <div className="summary-row">
              <span>خصم النقاط ({order.redeemed_points} ⭐)</span>
              <span style={{ color: '#00a650', fontWeight: 700 }}>-{formatPrice(order.points_discount_amount)}</span>
            </div>
          )}
          <div className="summary-row--total summary-row" style={{ marginTop: 8 }}>
            <span>الإجمالي</span>
            <span>{formatPrice(order.total_amount)}</span>
          </div>
          <div className="muted" style={{ marginTop: 2 }}>بتاريخ {formatDateTime(order.created_at)}</div>
          {order.status !== 'cancelled' && (
            <button className="btn btn--outline btn--sm" style={{ marginTop: 12 }} onClick={reorder} type="button">
              🔄 أعد الطلب
            </button>
          )}
        </div>

        <div className="section-title">🔄 حالة الطلب</div>
        <div className="card" style={{ padding: 14 }}>
          {order.status === 'cancelled' ? (
            <div style={{ padding: 10, borderRadius: 12, background: 'var(--danger-bg)', color: 'var(--danger-text)', fontWeight: 700 }}>
              ❌ أُلغي الطلب{order.reject_reason ? `: ${order.reject_reason}` : ''}
            </div>
          ) : (
            <OrderTimeline status={order.status} createdAt={order.created_at} history={order.history} />
          )}
        </div>

        {order.status === 'confirmed' && (
          <div style={{ marginTop: 10, padding: 12, borderRadius: 12, background: 'var(--success-bg)', color: 'var(--success-text)', fontWeight: 700 }}>
            ✅ قبل مزود الخدمة طلبك — يجري الآن تجهيزه
          </div>
        )}

        <div className="section-title">🧾 البنود</div>
        <div className="card" style={{ padding: '4px 14px' }}>
          {items.map((it: any, i: number) => (
            <div key={i} className="summary-row">
              <span className="grow">{it.title} × {it.quantity}</span>
              <span>{formatPrice(it.total)}</span>
            </div>
          ))}
        </div>

        {order.booking && (
          <>
            <div className="section-title">📅 تفاصيل الحجز</div>
            <div className="card" style={{ padding: 14 }}>
              {order.booking.type && <div className="muted">النوع: {order.booking.type}</div>}
              {order.booking.title && <div className="muted">العنصر: {order.booking.title}</div>}
              {order.booking.check_in && <div className="muted">الوصول: {order.booking.check_in}</div>}
              {order.booking.check_out && <div className="muted">المغادرة: {order.booking.check_out}</div>}
              {order.booking.guests && <div className="muted">النزلاء: {order.booking.guests}</div>}
              {order.booking.travel_date && <div className="muted">تاريخ السفر: {order.booking.travel_date}</div>}
              {order.booking.passengers && <div className="muted">المسافرون: {order.booking.passengers}</div>}
            </div>
          </>
        )}

        {order.status === 'completed' && rateInfo && (
          <>
            <div className="section-title">⭐ تقييم المزود</div>
            <div className="card" style={{ padding: 14 }}>
              <div className="row" style={{ gap: 6, marginBottom: 10 }}>
                {[1, 2, 3, 4, 5].map((n) => (
                  <button key={n} style={{ fontSize: 30, color: n <= rating ? '#ffb400' : 'var(--border2)' }} onClick={() => setRating(n)} type="button">
                    ★
                  </button>
                ))}
              </div>
              <textarea className="input" placeholder="أضف تعليقاً (اختياري)" value={comment} onChange={(e) => setComment(e.target.value)} />
              <button className="btn btn--primary" style={{ marginTop: 10 }} onClick={submitRating} type="button">إرسال التقييم</button>
            </div>
          </>
        )}
      </div>
      <Toast message={toast} onClose={() => setToast('')} />
    </div>
  );
}
