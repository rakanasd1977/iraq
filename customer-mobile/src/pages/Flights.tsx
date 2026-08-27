import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { PageHeader } from '../components/PageHeader';
import { Toast } from '../components/Toast';
import { EmptyState } from '../components/EmptyState';
import { CenterSpinner } from '../components/Spinner';
import { RatingStars } from '../components/RatingStars';
import { ItemFavButton } from '../components/ItemFavButton';
import { ItemReviews } from '../components/ItemReviews';
import { useCart } from '../context/CartContext';
import { publicApi } from '../api';
import { formatDate } from '../format';

export default function Flights() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { addItem } = useCart();
  const [flights, setFlights] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState('');
  const [travelDate, setTravelDate] = useState('');
  const [passengers, setPassengers] = useState(1);
  const [openRevId, setOpenRevId] = useState<any>(null);

  useEffect(() => {
    publicApi
      .flights(id || '')
      .then((rows) => setFlights(rows || []))
      .catch(() => setFlights([]))
      .finally(() => setLoading(false));
  }, [id]);

  const book = (f: any) => {
    if (!travelDate) {
      setToast('اختر تاريخ السفر أولاً');
      return;
    }
    addItem({
      provider_id: Number(id),
      provider_name: f.provider_name,
      kind: 'flights',
      item_id: f.id,
      title: `${f.origin_ar || f.origin} ← ${f.destination_ar || f.destination}`,
      unit_price: Number(f.price),
      quantity: passengers,
      unit: 'مقعد',
      booking: { type: 'flights', travel_date: travelDate, passengers },
    });
    setToast('أُضيفت الرحلة إلى الحجز');
  };

  return (
    <div>
      <PageHeader title="الرحلات" />
      <div className="page page--no-nav">
        <div className="card" style={{ padding: 12, marginBottom: 14 }}>
          <div className="row" style={{ gap: 10 }}>
            <div className="grow">
              <label className="muted">تاريخ السفر</label>
              <input className="input" type="date" value={travelDate} onChange={(e) => setTravelDate(e.target.value)} />
            </div>
            <div className="grow">
              <label className="muted">المسافرون</label>
              <select className="input" value={passengers} onChange={(e) => setPassengers(Number(e.target.value))}>
                {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => (
                  <option key={n} value={n}>{n}</option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {loading ? (
          <CenterSpinner />
        ) : flights.length ? (
          flights.map((f) => (
            <div className="card" key={f.id} style={{ marginBottom: 10, padding: 12, position: 'relative' }}>
              <ItemFavButton itemType="flights" itemId={f.id} className="itemfav--corner itemfav--nudge" />
              {f.images && f.images[0] && (
                <img
                  src={f.images[0]}
                  alt={`${f.origin_ar || f.origin} → ${f.destination_ar || f.destination}`}
                  loading="lazy"
                  decoding="async"
                  onClick={() => navigate(`/item/${id}/flights/${f.id}`)}
                  style={{ width: '100%', height: 110, objectFit: 'cover', borderRadius: 8, marginBottom: 10 }}
                />
              )}
              <div className="row row--between">
                <div>
                  <div style={{ fontWeight: 800, fontSize: 15 }} onClick={() => navigate(`/item/${id}/flights/${f.id}`)}>{f.origin_ar || f.origin} → {f.destination_ar || f.destination}</div>
                  <div className="muted" style={{ marginTop: 2 }}>
                    {f.airline} {f.flight_number ? `· رحلة ${f.flight_number}` : ''}
                  </div>
                  <RatingStars rating={f.rating} count={f.rating_count} />
                  {f.departure_at ? <div className="muted">🕐 {formatDate(f.departure_at)}</div> : null}
                </div>
                <div style={{ textAlign: 'left' }}>
                  <div className="price">{f.price.toLocaleString('en-US')} د.ع</div>
                  <div className="muted">/مسافر</div>
                </div>
              </div>
              <div className="row row--between" style={{ marginTop: 10 }}>
                <span className="muted">المقاعد المتاحة: {f.seats}</span>
                <button className="btn btn--primary btn--sm" onClick={() => book(f)} type="button">
                  حجز × {passengers}
                </button>
              </div>
              <button
                className={`btn btn--outline btn--sm${openRevId === f.id ? ' btn--active' : ''}`}
                style={{ marginTop: 6, width: '100%' }}
                onClick={() => setOpenRevId(openRevId === f.id ? null : f.id)}
                type="button"
              >
                ⭐ التقييمات {Number(f.rating_count) > 0 ? `(${f.rating_count})` : ''}
              </button>
              {openRevId === f.id && (
                <div style={{ marginTop: 10 }}>
                  <ItemReviews kind="flights" itemId={f.id} onToast={setToast} />
                </div>
              )}
            </div>
          ))
        ) : (
          <EmptyState icon="✈️" title="لا توجد رحلات" sub="لا تتوفر رحلات حالياً" />
        )}
      </div>
      <Toast message={toast} onClose={() => setToast('')} />
    </div>
  );
}
