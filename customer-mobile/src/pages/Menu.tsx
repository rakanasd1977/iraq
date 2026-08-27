import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { PageHeader } from '../components/PageHeader';
import { EmptyState } from '../components/EmptyState';
import { CenterSpinner } from '../components/Spinner';
import { RatingStars } from '../components/RatingStars';
import { ItemFavButton } from '../components/ItemFavButton';
import { publicApi } from '../api';

function MenuRow({ item, providerId }: { item: any; providerId?: string }) {
  return (
    <div className="card card--clickable" style={{ marginBottom: 10, padding: 12 }}>
      <div className="row" style={{ gap: 12 }}>
        <div style={{ position: 'relative', flexShrink: 0 }}>
          <div className="provider-card__logo" style={{ fontSize: 24, overflow: 'hidden' }}>
            {item.images && item.images[0] ? (
              <img src={item.images[0]} alt={item.name_ar} loading="lazy" decoding="async" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            ) : (
              '🍽️'
            )}
          </div>
          <ItemFavButton itemType="menu" itemId={item.id} className="itemfav--corner" />
        </div>
        <div className="grow">
          <div style={{ fontWeight: 700, fontSize: 14 }}>{item.name_ar}</div>
          {item.description && <div className="muted" style={{ marginTop: 2 }}>{item.description}</div>}
          <RatingStars rating={item.rating} count={item.rating_count} />
          <div className="row" style={{ gap: 8, marginTop: 6 }}>
            <span className="price">{item.price} د.ع</span>
            {item.is_featured ? <span className="chip chip--active" style={{ padding: '2px 8px', fontSize: 11 }}>مميز</span> : null}
          </div>
        </div>
      </div>
      <a href={`#/item/${providerId}/menu/${item.id}`} style={{ display: 'block', marginTop: 8 }}>
        <button className="btn btn--primary btn--sm" type="button">اختيار +</button>
      </a>
    </div>
  );
}

export default function Menu() {
  const { id } = useParams();
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    publicApi
      .menu(id || '')
      .then((rows) => setItems(rows || []))
      .catch(() => setItems([]))
      .finally(() => setLoading(false));
  }, [id]);

  const grouped: any = items.reduce((acc, it) => {
    const key = it.category_name || 'عام';
    (acc[key] = acc[key] || []).push(it);
    return acc;
  }, {});

  return (
    <div>
      <PageHeader title="قائمة الطعام" />
      <div className="page page--no-nav">
        {loading ? (
          <CenterSpinner />
        ) : items.length ? (
          Object.entries(grouped).map(([name, list]: [string, any]) => (
            <div key={name}>
              <div className="section-title">📄 {name}</div>
                {list.map((it: any) => (
                <MenuRow key={it.id} item={it} providerId={id} />
              ))}
            </div>
          ))
        ) : (
          <EmptyState icon="🍽️" title="القائمة فارغة" sub="لا توجد أصناف متاحة حالياً" />
        )}
      </div>
    </div>
  );
}
