import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { PageHeader } from '../components/PageHeader';
import { Toast } from '../components/Toast';
import { EmptyState } from '../components/EmptyState';
import { CenterSpinner } from '../components/Spinner';
import { ItemFavButton } from '../components/ItemFavButton';
import { useCart } from '../context/CartContext';
import { publicApi } from '../api';

export default function Packages() {
  const { id } = useParams();
  const { addItem } = useCart();
  const [pkgs, setPkgs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState('');

  useEffect(() => {
    publicApi
      .packages(id || '')
      .then((rows) => setPkgs(rows || []))
      .catch(() => setPkgs([]))
      .finally(() => setLoading(false));
  }, [id]);

  const pick = (p: any) => {
    addItem({
      provider_id: Number(id),
      provider_name: p.provider_name,
      kind: 'packages',
      item_id: p.id,
      title: p.name_ar,
      unit_price: Number(p.price),
      quantity: 1,
      unit: 'باقة',
      booking: { type: 'travel_offices', title: p.name_ar, travelers: 1 },
    });
    setToast('أُضيفت الباقة إلى الحجز');
  };

  return (
    <div>
      <PageHeader title="الباقات" />
      <div className="page page--no-nav">
        {loading ? (
          <CenterSpinner />
        ) : pkgs.length ? (
          pkgs.map((p) => (
            <div className="card" key={p.id} style={{ marginBottom: 12 }}>
              <div className="detail-img" style={{ height: 130, fontSize: 48 }}>
                {p.images && p.images[0] ? (
                  <img src={p.images[0]} alt={p.name_ar} loading="lazy" decoding="async" />
                ) : (
                  '🧳'
                )}
                <ItemFavButton itemType="packages" itemId={p.id} className="itemfav--img" />
              </div>
              <div className="product-card__body">
                <div style={{ fontWeight: 800, fontSize: 15 }}>{p.name_ar}</div>
                {p.destination && <div className="muted" style={{ marginTop: 2 }}>📍 {p.destination}</div>}
                <div className="muted">{p.duration_days} أيام</div>
                {p.description && <div className="muted" style={{ marginTop: 4 }}>{p.description}</div>}
                {p.includes && p.includes.length > 0 && (
                  <div className="muted" style={{ marginTop: 4 }}>✓ {p.includes.join(' · ')}</div>
                )}
                <div className="row row--between" style={{ marginTop: 10 }}>
                  <span className="price">{p.price.toLocaleString('en-US')} د.ع</span>
                  <button className="btn btn--primary btn--sm" onClick={() => pick(p)} type="button">حجز</button>
                </div>
              </div>
            </div>
          ))
        ) : (
          <EmptyState icon="🧳" title="لا توجد باقات" sub="لا تتوفر باقات حالياً" />
        )}
      </div>
      <Toast message={toast} onClose={() => setToast('')} />
    </div>
  );
}
