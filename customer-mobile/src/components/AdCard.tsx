import { useNavigate } from 'react-router-dom';
import { publicApi } from '../api';
import { formatPrice } from '../format';
import type { ApiRecord } from '../types';

const PROVIDER_LINKS: Record<string, (pid: number | string) => string> = {
  products: (pid) => `/provider/${pid}/catalog`,
  menu: (pid) => `/provider/${pid}/menu`,
  rooms: (pid) => `/provider/${pid}/rooms`,
  flights: (pid) => `/provider/${pid}/flights`,
  packages: (pid) => `/provider/${pid}/packages`,
};

export function AdCard({ ad, variant }: { ad: ApiRecord; variant?: string }) {
  const navigate = useNavigate();
  const kind = ad.item_link || 'products';
  const providerRoute = (PROVIDER_LINKS[kind] || PROVIDER_LINKS.products)(ad.provider_id);
  const productRoute = `/item/${ad.provider_id}/${kind}/${ad.item_id}`;

  const track = () => publicApi.promotionClick(ad.id, { silent: true }).catch(() => {});

  const openProduct = (e: React.MouseEvent) => {
    e.stopPropagation();
    track();
    navigate(productRoute);
  };

  const openProvider = () => {
    track();
    navigate(providerRoute);
  };

  if (variant === 'hero') {
    return (
      <div
        className="ad-card ad-card--hero"
        role="button"
        tabIndex={0}
        onClick={openProvider}
        onKeyDown={(e) => { if (e.key === 'Enter') openProvider(); }}
      >
        {ad.item_image ? (
          <img src={ad.item_image} alt={ad.item_title} loading="lazy" decoding="async" className="ad-card__img" />
        ) : (
          <div className="ad-card__img ad-card__img--placeholder">{ad.service_icon || '📢'}</div>
        )}
        <div className="ad-card__overlay">
          <div className="ad-card__title">{ad.item_title}</div>
          <button className="ad-card__cta" type="button" onClick={openProduct}>اطلب الآن ←</button>
        </div>
      </div>
    );
  }

  return (
    <div
      className="ad-card"
      role="button"
      tabIndex={0}
      onClick={openProvider}
      onKeyDown={(e) => { if (e.key === 'Enter') openProvider(); }}
    >
      {ad.item_image ? (
        <img src={ad.item_image} alt={ad.item_title} loading="lazy" decoding="async" className="ad-card__img" />
      ) : (
        <div className="ad-card__img ad-card__img--placeholder">{ad.service_icon || '📢'}</div>
      )}
      <div className="ad-card__body">
        <div className="ad-card__badge">إعلان 📣</div>
        <div className="ad-card__title">{ad.item_title}</div>
        <div className="ad-card__sub">{ad.provider_name} · {ad.service_name_ar}</div>
        <div className="ad-card__footer">
          <button className="ad-card__cta" type="button" onClick={openProduct}>اطلب الآن ←</button>
          <div className="ad-card__price">{formatPrice(ad.item_price)}</div>
        </div>
      </div>
    </div>
  );
}
