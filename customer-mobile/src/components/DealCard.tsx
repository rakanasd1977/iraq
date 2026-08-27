import { memo } from 'react';
import { useNavigate } from 'react-router-dom';
import { formatPrice } from '../format';
import { ItemFavButton } from './ItemFavButton';

const ICONS: Record<string, string> = {
  products: '🛍️',
  menu: '🍽️',
  rooms: '🏨',
  flights: '✈️',
  packages: '🧳',
};

const LINKS: Record<string, (p: number | string, id?: number | string) => string> = {
  products: (p, id) => `/item/${p}/products/${id}`,
  menu: (p, id) => `/item/${p}/menu/${id}`,
  packages: (p, id) => `/item/${p}/packages/${id}`,
  rooms: (p) => `/provider/${p}/rooms`,
  flights: (p) => `/provider/${p}/flights`,
};

export const DealCard = memo(function DealCard({ deal = {}, stock = 0 }: any) {
  const navigate = useNavigate();
  const to = (LINKS[deal.kind] || LINKS.products)(deal.provider_id, deal.item_id);
  const soldLabel = deal.kind === 'products' ? 'باع' : 'طلب';
  return (
    <button className="deal-card" type="button" onClick={() => navigate(to)}>
      <div className="deal-card__img">
        {deal.image ? (
          <img src={deal.image} alt={deal.title} loading="lazy" decoding="async" />
        ) : (
          <span className="deal-card__ph">{ICONS[deal.kind] || '🛍️'}</span>
        )}
        {deal.discount_percent > 0 && <span className="deal-card__off">-{deal.discount_percent}%</span>}
        <ItemFavButton itemType={deal.kind} itemId={deal.item_id} className="itemfav--img" />
      </div>
      <div className="deal-card__body">
        <div className="deal-card__title">{deal.title}</div>
        <div className="deal-card__pricerow">
          <span className="price deal-card__price">{formatPrice(deal.price)}<span className="price__suffix">/{deal.unit}</span></span>
          {deal.old_price ? <span className="price__old">{formatPrice(deal.old_price)}</span> : null}
        </div>
        {deal.sold > 0 && <div className="deal-card__sold">🔥 {soldLabel} {Number(deal.sold).toLocaleString('en-US')}</div>}
        <div className="deal-card__provrow">
          {deal.provider_verified && <span className="deal-card__verified">✓ مزوّد موثّق</span>}
          <span className="deal-card__prov">{deal.provider_name}</span>
        </div>
        {typeof stock === 'number' && (
          <div className="deal-card__stock">
            <span className="deal-card__stock-txt">باقي {stock}%</span>
            <span className="deal-card__stock-bar">
              <span className="deal-card__stock-fill" style={{ width: `${100 - stock}%` }} />
            </span>
          </div>
        )}
      </div>
    </button>
  );
});
