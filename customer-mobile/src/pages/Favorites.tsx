import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useFavorites } from '../context/FavoritesContext';
import { customerApi } from '../api';
import { EmptyState } from '../components/EmptyState';
import { PageHeader } from '../components/PageHeader';
import { Spinner } from '../components/Spinner';
import { ProviderCard } from '../components/ProviderCard';
import { RatingStars } from '../components/RatingStars';
import { formatPrice } from '../format';
import type { ApiRecord } from '../types';

const ITEM_ICONS: Record<string, string> = {
  products: '🛍️',
  menu: '🍽️',
  rooms: '🛏️',
  flights: '✈️',
  packages: '🧳',
};

const ITEM_LINKS: Record<string, (p: number | string, id: number | string) => string> = {
  products: (p, id) => `/item/${p}/products/${id}`,
  menu: (p, id) => `/item/${p}/menu/${id}`,
  packages: (p, id) => `/item/${p}/packages/${id}`,
  rooms: (p, id) => `/item/${p}/rooms/${id}`,
  flights: (p, id) => `/item/${p}/flights/${id}`,
};

function FavItemCard({ item }: { item: ApiRecord }) {
  const navigate = useNavigate();
  const to = (ITEM_LINKS[item.kind] || ITEM_LINKS.products)(item.provider_id, item.id);
  return (
    <div className="card card--clickable" style={{ display: 'flex', gap: 12, padding: 10, marginBottom: 10 }} onClick={() => navigate(to)}>
      <div style={{ width: 64, height: 64, borderRadius: 10, overflow: 'hidden', flexShrink: 0, background: 'var(--soft-red)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 26 }}>
        {item.image ? (
          <img src={item.image} alt={item.title} loading="lazy" decoding="async" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        ) : (
          ITEM_ICONS[item.kind] || '🛍️'
        )}
      </div>
      <div className="grow">
        <div style={{ fontWeight: 700, fontSize: 14 }}>{item.title}</div>
        {item.provider_name && (
          <div className="row" style={{ gap: 6 }}>
            <div className="muted" style={{ fontSize: 12 }}>{item.provider_name}</div>
            {item.provider_verified && <span className="deal-card__verified">✓ مزوّد موثّق</span>}
          </div>
        )}
        <RatingStars rating={item.rating} count={item.rating_count} />
        <div className="row" style={{ gap: 6, marginTop: 4 }}>
          <span className="price">{formatPrice(item.price)}</span>
          <span className="muted">/ {item.unit}</span>
          {item.old_price ? <span className="price__old">{formatPrice(item.old_price)}</span> : null}
        </div>
        {item.sold > 0 && <div className="deal-card__sold">🔥 {item.kind === 'products' ? 'باع' : 'طلب'} {Number(item.sold).toLocaleString('en-US')}</div>}
      </div>
    </div>
  );
}

export default function Favorites() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { ids } = useFavorites();
  const [items, setItems] = useState<any>(null);
  const [favItems, setFavItems] = useState<any>(null);

  const load = () => {
    if (!user) return;
    customerApi.favorites().then(setItems).catch(() => setItems([]));
    customerApi.favoritesItems().then(setFavItems).catch(() => setFavItems([]));
  };

  useEffect(() => {
    load();
  }, [user, ids]);

  if (!user) {
    return (
      <div className="page">
        <div className="empty">
          <div className="empty__icon">❤️</div>
          <div className="empty__title">سجّل دخولك أولاً</div>
          <div className="empty__sub">احفظ متاجرك ومنتجاتك المفضلة وعد إليها بلمسة واحدة</div>
          <button className="btn btn--primary" onClick={() => navigate('/login')} type="button">تسجيل الدخول</button>
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      <PageHeader title="المفضلة" />

      <div className="section-title">🛍️ المنتجات المفضلة</div>
      {!favItems ? (
        <div className="centerpad"><Spinner /></div>
      ) : favItems.length === 0 ? (
        <EmptyState icon="🤍" title="لا منتجات مفضلة بعد" sub="اضغط على القلب في صورة أي منتج أو غرفة أو رحلة لحفظه هنا" />
      ) : (
        <div>
          {favItems.map((it: any) => (
            <FavItemCard key={`${it.kind}:${it.id}`} item={it} />
          ))}
          <div className="muted" style={{ textAlign: 'center', fontSize: 12, padding: '4px 0 12px' }}>
            {favItems.length} منتج محفوظ
          </div>
        </div>
      )}

      <div className="section-title">🏪 المتاجر المفضلة</div>
      {!items ? (
        <div className="centerpad"><Spinner /></div>
      ) : items.length === 0 ? (
        <EmptyState icon="🏪" title="لا متاجر مفضلة بعد" sub="اضغط على القلب في بطاقة أي متجر لحفظه هنا" />
      ) : (
        <div>
          {items.map((p: any) => (
            <div key={p.id} style={{ marginBottom: 10 }}>
              <ProviderCard provider={p} />
            </div>
          ))}
          <div className="muted" style={{ textAlign: 'center', fontSize: 12, padding: '4px 0 12px' }}>
            {items.length} متجر محفوظ
          </div>
        </div>
      )}
    </div>
  );
}
