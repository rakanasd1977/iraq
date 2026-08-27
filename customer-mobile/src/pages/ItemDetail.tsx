import { useEffect, useState, type MouseEvent } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { PageHeader } from '../components/PageHeader';
import { Toast } from '../components/Toast';
import { CenterSpinner } from '../components/Spinner';
import { ShareSheet } from '../components/ShareSheet';
import { RatingStars } from '../components/RatingStars';
import { RatingSummary } from '../components/RatingSummary';
import { ItemFavButton } from '../components/ItemFavButton';
import { QtyPicker } from '../components/QtyPicker';
import { Gallery } from '../components/Gallery';
import { ItemReviews } from '../components/ItemReviews';
import { useCart } from '../context/CartContext';
import { useAuth } from '../context/AuthContext';
import { useFavorites } from '../context/FavoritesContext';
import { publicApi } from '../api';
import { formatPrice, discountPercent } from '../format';
import { trackRecent } from '../recentlyViewed';
import type { ItemKind } from '../types';

interface KindMeta {
  fetcher: string;
  icon: string;
  unit: string;
  label: string;
  service: string;
}

const KIND_META: Record<string, KindMeta> = {
  products: { fetcher: 'products', icon: '🛍️', unit: 'قطعة', label: 'منتج', service: 'المتجر' },
  menu: { fetcher: 'menu', icon: '🍽️', unit: 'صنف', label: 'صنف', service: 'المطعم' },
  packages: { fetcher: 'packages', icon: '🧳', unit: 'باقة', label: 'باقة', service: 'مكتب السفر' },
  rooms: { fetcher: 'rooms', icon: '🛏️', unit: 'ليلة', label: 'غرفة', service: 'الفندق' },
  flights: { fetcher: 'flights', icon: '✈️', unit: 'مقعد', label: 'رحلة', service: 'شركة الطيران' },
};

function itemTitle(item: any): string {
  if (!item) return 'بند';
  return item.name_ar || `${item.origin_ar || item.origin || ''} ← ${item.destination_ar || item.destination || ''}` || 'بند';
}

function nightsBetween(a: string, b: string): number {
  const ms = new Date(b).getTime() - new Date(a).getTime();
  return Math.max(1, Math.round(ms / 86400000));
}

export default function ItemDetail() {
  const { providerId, kind, itemId } = useParams();
  const navigate = useNavigate();
  const { addItem } = useCart();
  const { user } = useAuth();
  const { isItemFavorite, toggleItem } = useFavorites();
  if (!providerId || !itemId || !kind) return null;
  const meta = KIND_META[kind];
  if (!meta) return null;
  const [item, setItem] = useState<any>(null);
  const [provider, setProvider] = useState<any>(null);
  const [reviews, setReviews] = useState<any>(null);
  const [qty, setQty] = useState(1);
  const [checkIn, setCheckIn] = useState('');
  const [checkOut, setCheckOut] = useState('');
  const [guests, setGuests] = useState(2);
  const [travelDate, setTravelDate] = useState('');
  const [passengers, setPassengers] = useState(1);
  const [showShare, setShowShare] = useState(false);
  const [toast, setToast] = useState('');

  useEffect(() => {
    if (!meta) return;
    let alive = true;
    const fetchers: Record<string, (id: number | string) => Promise<any>> = {
      products: publicApi.products,
      menu: publicApi.menu,
      packages: publicApi.packages,
      rooms: publicApi.rooms,
      flights: publicApi.flights,
    };
    fetchers[meta.fetcher](providerId || '')
      .then((rows) => {
        const found = (rows || []).find((r: any) => String(r.id) === String(itemId)) || null;
        if (!alive) return;
        setItem(found);
        if (found) {
          trackRecent({
            type: 'item',
            id: found.id,
            provider_id: Number(providerId),
            kind,
            title: itemTitle(found),
            image: (found.images && found.images[0]) || null,
            price: Number(kind === 'rooms' ? found.price_per_night : found.price),
          });
        }
      })
      .catch(() => alive && setItem(null));
    publicApi
      .provider(providerId || '')
      .then((p) => alive && setProvider(p))
      .catch(() => {});
    publicApi
      .itemReviews(kind, itemId || '')
      .then((res) => alive && setReviews(res))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [providerId, kind, itemId]);

  if (!meta) return null;

  if (!item) {
    return (
      <div>
        <PageHeader title="التفاصيل" />
        <CenterSpinner />
      </div>
    );
  }

  const images = item.images && item.images.length ? item.images : [];
  const discount = discountPercent(item.old_price, item.price);
  const unitPrice = kind === 'rooms' ? Number(item.price_per_night != null ? item.price_per_night : item.price) : Number(item.price);
  const title = itemTitle(item);
  const nights = kind === 'rooms' && checkIn && checkOut ? nightsBetween(checkIn, checkOut) : 1;
  const quantity = kind === 'rooms' ? nights : kind === 'flights' ? passengers : qty;

  const add = () => {
    if (kind === 'rooms') {
      if (!checkIn || !checkOut) {
        setToast('اختر تاريخي الوصول والمغادرة أولاً');
        return;
      }
      if (new Date(checkOut) <= new Date(checkIn)) {
        setToast('تاريخ المغادرة يجب أن يلي تاريخ الوصول');
        return;
      }
    }
    if (kind === 'flights' && !travelDate) {
      setToast('اختر تاريخ السفر أولاً');
      return;
    }
    addItem({
      provider_id: Number(providerId),
      provider_name: item.provider_name || (provider && provider.name_ar),
      kind: kind as ItemKind,
      item_id: item.id,
      title,
      unit_price: unitPrice,
      quantity,
      unit: meta.unit,
      booking:
        kind === 'rooms'
          ? { type: 'hotels', check_in: checkIn, check_out: checkOut, guests, nights }
          : kind === 'flights'
          ? { type: 'flights', travel_date: travelDate, passengers }
          : undefined,
    });
    setToast('أُضيف إلى السلة');
  };

  const onHeart = (e: MouseEvent) => {
    e.stopPropagation();
    if (!user) {
      navigate('/login');
      return;
    }
    toggleItem(kind, item.id);
  };
  const fav = isItemFavorite(kind, item.id);

  const facts = [];
  if (item.category_name) facts.push(['القسم', item.category_name]);
  if (kind === 'products') {
    if (item.stock != null) facts.push(['المتوفر', item.stock > 0 ? `${item.stock} ${meta.unit}` : 'نفد المخزون']);
  }
  if (kind === 'menu' && item.is_featured) facts.push(['تمييز', 'صنف مميز']);
  if (kind === 'packages') {
    if (item.destination) facts.push(['الوجهة', item.destination]);
    if (item.duration_days) facts.push(['المدة', `${item.duration_days} أيام`]);
  }
  if (kind === 'rooms') {
    if (item.room_type) facts.push(['نوع الغرفة', item.room_type]);
    if (item.max_guests) facts.push(['السعة', `${item.max_guests} نزلاء`]);
    if (item.is_featured) facts.push(['تمييز', 'غرفة مميزة']);
  }
  if (kind === 'flights') {
    if (item.airline) facts.push(['شركة الطيران', item.airline]);
    if (item.flight_number) facts.push(['رقم الرحلة', item.flight_number]);
    if (item.seats != null) facts.push(['المقاعد المتاحة', item.seats]);
    if (item.departure_at) facts.push(['الإقلاع', item.departure_at]);
    if (item.arrival_at) facts.push(['الوصول', item.arrival_at]);
  }

  const showRating = Number((reviews && reviews.rating_count) || item.rating_count || 0) > 0;

  return (
    <div className="item-page">
      <PageHeader title={meta.label} />

      <div className="detail-media">
        <Gallery images={images} icon={meta.icon} title={title} />
        {discount > 0 && <span className="product-card__off gallery__off">-{discount}%</span>}
        <ItemFavButton itemType={kind} itemId={item.id} className="itemfav--img itemfav--large gallery__fav" />
      </div>

      <div className="detail-body">
        <button className="btn btn--outline btn--sm share-btn" onClick={() => setShowShare(true)} type="button">
          مشاركة 🔗
        </button>

        <div className="detail-title" style={{ marginTop: 10 }}>{title}</div>

        {showRating && (
          <div className="row" style={{ gap: 8, marginTop: 6 }}>
            <RatingStars rating={item.rating} count={item.rating_count} />
          </div>
        )}

        <div className="row" style={{ gap: 8, marginTop: 6 }}>
          <span className="price detail-price">{formatPrice(unitPrice)}<span className="price__suffix">/{meta.unit}</span></span>
          {discount > 0 && (
            <span className="price__old">{formatPrice(item.old_price)}</span>
          )}
          {discount > 0 && (
            <span className="chip chip--active" style={{ padding: '2px 8px', fontSize: 11 }}>خصم {discount}%</span>
          )}
        </div>

        {/* ===== ملخص التقييمات بأسلوب علي إكسبريس ===== */}
        {showRating && (
          <div className="card rsummary-card">
            <RatingSummary
              rating={(reviews && reviews.rating) || item.rating}
              count={(reviews && reviews.rating_count) || item.rating_count}
              breakdown={(reviews && reviews.breakdown) || []}
            />
          </div>
        )}

        {item.description && <p className="detail-desc">{item.description}</p>}

        {facts.length > 0 && (
          <div className="detail-facts">
            {facts.map(([k, v]) => (
              <div className="summary-row" key={k}>
                <span className="muted">{k}</span>
                <span style={{ fontWeight: 700, fontSize: 13 }}>{v}</span>
              </div>
            ))}
          </div>
        )}

        {kind === 'packages' && item.includes && item.includes.length > 0 && (
          <div style={{ marginTop: 12 }}>
            <div className="section-title" style={{ margin: '0 0 8px' }}>المشتملات</div>
            {item.includes.map((inc: any, i: number) => (
              <div key={i} className="muted" style={{ padding: '3px 0' }}>✓ {inc}</div>
            ))}
          </div>
        )}

        {/* ===== سمعة البائع: بطاقة المزوّد ===== */}
        {provider && (
          <div className="card card--clickable provider-rep" onClick={() => navigate(`/provider/${provider.id}`)}>
            <div className="provider-rep__logo">
              {provider.logo && /^https?:/i.test(provider.logo) ? (
                <img src={provider.logo} alt="" decoding="async" />
              ) : (
                provider.logo || provider.service_icon || '🏪'
              )}
            </div>
            <div className="grow" style={{ minWidth: 0 }}>
              <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                <span className="provider-rep__name">{provider.name_ar}</span>
                {provider.is_verified ? <span className="deal-card__verified">✓ مزوّد موثّق</span> : null}
              </div>
              <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>
                {provider.service_name_ar}{provider.governorate_name_ar ? ` · ${provider.governorate_name_ar}` : ''}
              </div>
              <div className="row" style={{ gap: 12, marginTop: 6 }}>
                <RatingStars rating={provider.rating} count={provider.rating_count} />
                <span className="provider-rep__follows">
                  👥 {Number(provider.followers_count || 0).toLocaleString('en-US')} متابع
                </span>
              </div>
            </div>
            <span className="provider-rep__arrow">‹</span>
          </div>
        )}

        <div className="divider" />
        {kind === 'rooms' && (
          <>
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
          </>
        )}
        {kind === 'flights' && (
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
        )}
        {kind !== 'rooms' && kind !== 'flights' && (
          <div className="qtyrow">
            <span className="muted">الكمية</span>
            <QtyPicker
              value={qty}
              onChange={setQty}
              max={kind === 'products' && item.stock > 0 ? item.stock : undefined}
            />
          </div>
        )}
        <div style={{ height: 84 }} />
      </div>

      {/* ===== التقييمات ===== */}
      <div className="detail-body" style={{ paddingTop: 0 }}>
        <div className="section-title">⭐ تقييمات البند</div>
        <ItemReviews kind={kind} itemId={item.id} onToast={setToast} />
      </div>

      <div className="buybar">
        <div>
          <div className="muted">الإجمالي</div>
          <div className="price" style={{ fontSize: 18 }}>{formatPrice(unitPrice * quantity)}</div>
        </div>
        <button
          className={`buybar__fav${fav ? ' buybar__fav--on' : ''}`}
          onClick={onHeart}
          type="button"
          aria-label={fav ? 'إزالة من المفضلة' : 'إضافة للمفضلة'}
        >
          {fav ? '❤️' : '🤍'}
        </button>
        <button className="btn btn--primary buybar__btn" onClick={add} type="button">
          🛒 أضف إلى السلة
        </button>
      </div>

      <ShareSheet
        open={showShare}
        onClose={() => setShowShare(false)}
        title={title}
        url={window.location.href}
        onCopied={() => setToast('نُسخ رابط الصفحة')}
      />
      <Toast message={toast} onClose={() => setToast('')} />
    </div>
  );
}
