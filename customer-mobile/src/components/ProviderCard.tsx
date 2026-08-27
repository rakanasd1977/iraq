import { useNavigate } from 'react-router-dom';
import type { MouseEvent } from 'react';
import { useAuth } from '../context/AuthContext';
import { useFavorites } from '../context/FavoritesContext';
import { RatingStars } from './RatingStars';

const COUNT_LABELS: Record<string, string> = {
  products: 'منتجات',
  menu_items: 'أصناف',
  rooms: 'غرف',
  flights: 'رحلات',
  packages: 'باقات',
};

export function ProviderCard({ provider = {}, compact = false }: { provider?: any; compact?: boolean }) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { isFavorite, toggle } = useFavorites();
  const counts: any = provider.catalog_counts || {};
  const countParts = Object.entries(counts)
    .filter(([, n]) => Number(n) > 0)
    .slice(0, 3)
    .map(([k, n]) => `${n} ${COUNT_LABELS[k] || k}`);

  const fav = isFavorite(provider.id);

  const onHeart = (e: MouseEvent) => {
    e.stopPropagation();
    if (!user) {
      navigate('/login');
      return;
    }
    toggle(provider.id);
  };

  if (compact) {
    return (
      <div className="card card--clickable provider-card provider-card--compact" onClick={() => navigate(`/provider/${provider.id}`)}>
        <div className="provider-card__logo" style={{ position: 'relative' }}>
          {provider.logo || (provider.service_icon ? provider.service_icon : '🏪')}
          <button
            className={`provider-card__fav${fav ? ' provider-card__fav--on' : ''}`}
            onClick={onHeart}
            type="button"
            aria-label={fav ? 'إزالة من المفضلة' : 'إضافة للمفضلة'}
          >
            {fav ? '❤️' : '🤍'}
          </button>
        </div>
        <div className="grow" style={{ width: '100%' }}>
          <div className="provider-card__name">{provider.name_ar}</div>
          <div className="provider-card__sub">{provider.service_name_ar}</div>
          <div className="provider-card__sub">{provider.governorate_name_ar}</div>
          <div className="row" style={{ justifyContent: 'center', marginTop: 6 }}>
            <RatingStars rating={provider.rating} count={provider.rating_count} />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="card card--clickable provider-card" onClick={() => navigate(`/provider/${provider.id}`)}>
      <div className="provider-card__logo" style={{ position: 'relative' }}>
        {provider.logo || (provider.service_icon ? provider.service_icon : '🏪')}
        <button
          className={`provider-card__fav${fav ? ' provider-card__fav--on' : ''}`}
          onClick={onHeart}
          type="button"
          aria-label={fav ? 'إزالة من المفضلة' : 'إضافة للمفضلة'}
        >
          {fav ? '❤️' : '🤍'}
        </button>
      </div>
      <div className="grow">
        <div className="provider-card__name">{provider.name_ar}</div>
        <div className="provider-card__sub">
          {provider.governorate_name_ar} · {provider.service_name_ar}
        </div>
        <div className="row row--between" style={{ marginTop: 6 }}>
          <RatingStars rating={provider.rating} count={provider.rating_count} />
          {provider.is_verified ? <span className="muted">✔ مزود موثوق</span> : null}
        </div>
        {countParts.length ? <div className="provider-card__sub">{countParts.join(' · ')}</div> : null}
      </div>
    </div>
  );
}
