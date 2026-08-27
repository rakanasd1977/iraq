import { useNavigate } from 'react-router-dom';
import { useCart } from '../context/CartContext';
import { useAuth } from '../context/AuthContext';
import { Stepper } from '../components/Stepper';
import { EmptyState } from '../components/EmptyState';
import { ShippingProgress } from '../components/ShippingProgress';
import { formatPrice } from '../format';

const KIND_ICONS: Record<string, string> = { products: '🛍️', menu: '🍽️', rooms: '🛏️', flights: '✈️', packages: '🧳' };

export default function Cart() {
  const { items, setQuantity, removeItem, byProvider, totalCount, totalAmount } = useCart();
  const { user } = useAuth();
  const navigate = useNavigate();
  const groups = byProvider();

  if (!items.length) {
    return (
      <div className="page">
        <EmptyState
          icon="🛒"
          title="سلتك فارغة"
          sub="تصفح المزودين وأضف ما يعجبك"
          action={<button className="btn btn--primary" onClick={() => navigate('/search')} type="button">تصفح الآن</button>}
        />
      </div>
    );
  }

  return (
    <div className="page">
      <div className="row row--between" style={{ marginBottom: 10 }}>
        <div className="section-title" style={{ margin: 0 }}>🛒 السلة ({totalCount})</div>
      </div>

      {groups.map((g) => (
        <div className="card" key={g.provider_id} style={{ marginBottom: 12 }}>
          <div style={{ padding: '10px 12px', borderBottom: '1px solid #f5f5f5', fontWeight: 700 }}>{g.provider_name}</div>
          {g.items.map((it) => (
            <div key={`${it.kind}:${it.item_id}`} className="order-item">
              <div className="row" style={{ gap: 10 }}>
                <span style={{ fontSize: 22 }}>{KIND_ICONS[it.kind] || '📦'}</span>
                <div className="grow">
                  <div className="order-item__title">{it.title}</div>
                  <div className="order-item__meta">
                    {formatPrice(it.unit_price)}/{it.unit || 'وحدة'}
                    {it.booking && it.booking.check_in ? ` · ${it.booking.check_in} ← ${it.booking.check_out}` : ''}
                  </div>
                </div>
                <div style={{ textAlign: 'left' }}>
                  <div style={{ fontWeight: 800, color: 'var(--brand)' }}>{formatPrice(it.unit_price * it.quantity)}</div>
                  <button className="muted" style={{ marginTop: 4 }} onClick={() => removeItem(g.provider_id, it.kind, it.item_id)} type="button">
                    حذف
                  </button>
                </div>
              </div>
              <div className="row row--between" style={{ marginTop: 8 }}>
                <Stepper quantity={it.quantity} onChange={(n) => setQuantity(g.provider_id, it.kind, it.item_id, n)} />
                <span className="muted">سيُنشأ طلب منفصل لكل مزوّد</span>
              </div>
            </div>
          ))}
        </div>
      ))}

      <div className="card" style={{ padding: 14, position: 'sticky', bottom: 70 }}>
        <ShippingProgress subtotal={totalAmount} />
        <div className="row row--between" style={{ marginTop: 10 }}>
          <span className="muted">الإجمالي</span>
          <span className="price" style={{ fontSize: 20 }}>{formatPrice(totalAmount)}</span>
        </div>
        <button
          className="btn btn--primary btn--lg"
          style={{ marginTop: 10 }}
          onClick={() => navigate(user ? '/checkout' : '/login?next=checkout')}
          type="button"
        >
          إتمام الطلب
        </button>
      </div>
    </div>
  );
}
