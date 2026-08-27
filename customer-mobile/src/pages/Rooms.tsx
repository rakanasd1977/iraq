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

function nightsBetween(a: string, b: string) {
  const ms = new Date(b).getTime() - new Date(a).getTime();
  return Math.max(1, Math.round(ms / 86400000));
}

export default function Rooms() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { addItem } = useCart();
  const [rooms, setRooms] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState('');
  const [checkIn, setCheckIn] = useState('');
  const [checkOut, setCheckOut] = useState('');
  const [guests, setGuests] = useState(2);
  const [openRevId, setOpenRevId] = useState<any>(null);

  useEffect(() => {
    publicApi
      .rooms(id || '')
      .then((rows) => setRooms(rows || []))
      .catch(() => setRooms([]))
      .finally(() => setLoading(false));
  }, [id]);

  const nights = checkIn && checkOut ? nightsBetween(checkIn, checkOut) : 1;

  const book = (room: any) => {
    if (!checkIn || !checkOut) {
      setToast('اختر تاريخي الوصول والمغادرة أولاً');
      return;
    }
    if (new Date(checkOut) <= new Date(checkIn)) {
      setToast('تاريخ المغادرة يجب أن يلي تاريخ الوصول');
      return;
    }
    addItem({
      provider_id: Number(id),
      provider_name: room.provider_name,
      kind: 'rooms',
      item_id: room.id,
      title: room.name_ar,
      unit_price: Number(room.price_per_night),
      quantity: nights,
      unit: 'ليلة',
      booking: { type: 'hotels', check_in: checkIn, check_out: checkOut, guests, nights },
    });
    setToast(`أُضيفت ${room.name_ar} — ${nights} ليلة`);
  };

  return (
    <div>
      <PageHeader title="الغرف" />
      <div className="page page--no-nav">
        <div className="card" style={{ padding: 12, marginBottom: 14 }}>
          <div className="row" style={{ gap: 10, marginBottom: 10 }}>
            <div className="grow">
              <label className="muted">الوصول</label>
              <input className="input" type="date" value={checkIn} onChange={(e) => setCheckIn(e.target.value)} />
            </div>
            <div className="grow">
              <label className="muted">المغادرة</label>
              <input className="input" type="date" value={checkOut} onChange={(e) => setCheckOut(e.target.value)} />
            </div>
          </div>
          <div className="row" style={{ gap: 10 }}>
            <div className="grow">
              <label className="muted">النزلاء</label>
              <select className="input" value={guests} onChange={(e) => setGuests(Number(e.target.value))}>
                {[1, 2, 3, 4, 5, 6].map((n) => (
                  <option key={n} value={n}>{n}</option>
                ))}
              </select>
            </div>
            <div className="grow">
              <label className="muted">عدد الليالي</label>
              <div className="input" style={{ fontWeight: 800, color: 'var(--brand)' }}>{nights}</div>
            </div>
          </div>
        </div>

        {loading ? (
          <CenterSpinner />
        ) : rooms.length ? (
          <div className="grid-2">
            {rooms.map((r) => (
              <div className="card" key={r.id}>
                <div className="product-card__img" style={{ fontSize: 44 }} onClick={() => navigate(`/item/${id}/rooms/${r.id}`)}>
                  {r.images && r.images[0] ? (
                    <img src={r.images[0]} alt={r.name_ar} loading="lazy" decoding="async" />
                  ) : (
                    '🛏️'
                  )}
                  <ItemFavButton itemType="rooms" itemId={r.id} className="itemfav--img" />
                </div>
                <div className="product-card__body">
                  <div className="product-card__title" onClick={() => navigate(`/item/${id}/rooms/${r.id}`)}>{r.name_ar}</div>
                  <RatingStars rating={r.rating} count={r.rating_count} />
                  <div className="muted" style={{ marginTop: 2 }}>{r.room_type} · {r.max_guests} نزلاء كحد أقصى</div>
                  <div className="row" style={{ gap: 6, marginTop: 8 }}>
                    <span className="price">{r.price_per_night.toLocaleString('en-US')} د.ع</span>
                    <span className="muted">/ليلة</span>
                  </div>
                  <button className="btn btn--primary btn--sm" style={{ marginTop: 8, width: '100%' }} onClick={() => book(r)} type="button">
                    حجز ({nights} ليلة)
                  </button>
                  <button
                    className={`btn btn--outline btn--sm${openRevId === r.id ? ' btn--active' : ''}`}
                    style={{ marginTop: 6, width: '100%' }}
                    onClick={() => setOpenRevId(openRevId === r.id ? null : r.id)}
                    type="button"
                  >
                    ⭐ التقييمات {Number(r.rating_count) > 0 ? `(${r.rating_count})` : ''}
                  </button>
                  {openRevId === r.id && (
                    <div style={{ marginTop: 10 }}>
                      <ItemReviews kind="rooms" itemId={r.id} onToast={setToast} />
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState icon="🛏️" title="لا توجد غرف" sub="لا تتوفر غرف حالياً" />
        )}
      </div>
      <Toast message={toast} onClose={() => setToast('')} />
    </div>
  );
}
