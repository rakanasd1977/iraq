import { useNavigate } from 'react-router-dom';
import { formatPrice } from '../format';
import type { ApiRecord } from '../types';

const KIND_ICONS: Record<string, string> = { products: '🛍️', menu: '🍽️', rooms: '🏨', flights: '✈️', packages: '🧳' };

export function RecentCard({ entry }: { entry: ApiRecord }) {
  const navigate = useNavigate();
  const to =
    entry.type === 'provider'
      ? `/provider/${entry.id}`
      : `/item/${entry.provider_id}/${entry.kind}/${entry.id}`;

  return (
    <button className="deal-card" type="button" onClick={() => navigate(to)}>
      <div className="deal-card__img">
        {entry.image ? (
          <img src={entry.image} alt={entry.title} loading="lazy" decoding="async" />
        ) : (
          <span className="deal-card__ph">{entry.type === 'provider' ? '🏪' : KIND_ICONS[entry.kind] || '🛍️'}</span>
        )}
      </div>
      <div className="deal-card__body">
        <div className="deal-card__title">{entry.title}</div>
        {entry.price != null ? (
          <div className="price deal-card__price">{formatPrice(entry.price)}</div>
        ) : (
          <div className="deal-card__prov">{entry.sub}</div>
        )}
      </div>
    </button>
  );
}
