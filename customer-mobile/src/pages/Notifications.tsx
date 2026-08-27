import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { api } from '../api';
import { EmptyState } from '../components/EmptyState';
import { PageHeader } from '../components/PageHeader';
import { Spinner } from '../components/Spinner';
import { timeAgo } from '../format';

const TYPE_ICON: Record<string, string> = {
  order: '📦',
  recharge: '💸',
  offer: '🛍️',
  promo: '🎉',
  system: '🔔',
};

export default function Notifications() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [items, setItems] = useState<any>(null);
  const [unread, setUnread] = useState(0);

  const load = () => {
    if (!user) return;
    api.get('/notifications?limit=50').then((data) => setItems(data || [])).catch(() => setItems([]));
    api.get('/notifications/unread-count', { silent: true }).then((d) => setUnread(d?.unread || 0)).catch(() => {});
  };

  useEffect(() => {
    load();
  }, [user]);

  const markRead = (id: number | string, url?: string) => {
    api.post(`/notifications/${id}/read`, {}, { silent: true }).then(() => {
      setItems((prev: any) => (prev || []).map((n: any) => (n.id === id ? { ...n, is_read: 1 } : n)));
      setUnread((u) => Math.max(0, u - 1));
    }).catch(() => {});
    if (url) navigate(url.startsWith('/') ? url : `/${url}`);
  };

  const readAll = () => {
    api.post('/notifications/read-all', {}, { silent: true }).then(() => {
      setItems((prev: any) => (prev || []).map((n: any) => ({ ...n, is_read: 1 })));
      setUnread(0);
    }).catch(() => {});
  };

  return (
    <div className="page">
      <PageHeader
        title="الإشعارات"
        right={unread > 0 ? <button className="btn btn--ghost btn--sm" onClick={readAll} type="button">تحديد الكل كمقروء</button> : null}
      />

      {!items ? (
        <div className="centerpad"><Spinner /></div>
      ) : items.length === 0 ? (
        <EmptyState icon="🔔" title="لا إشعارات" sub="ستظهر هنا تحديثات طلباتك وعروض المزودين الذين تتابعهم وإشعارات المحفظة" />
      ) : (
        <div className="card" style={{ padding: 0 }}>
          {items.map((n: any, idx: number) => (
            <button
              key={n.id}
              className={`notif-item row${n.is_read ? '' : ' notif-item--unread'}`}
              onClick={() => markRead(n.id, n.url)}
              type="button"
              style={{ width: '100%', textAlign: 'right', borderBottom: idx < items.length - 1 ? '1px solid var(--border, #eef1f5)' : 'none' }}
            >
              <span className="notif-item__icon">{TYPE_ICON[n.type] || '🔔'}</span>
              <span className="grow">
                <span className="row row--between">
                  <span style={{ fontWeight: 700, fontSize: 14 }}>{n.title}</span>
                  <span className="muted" style={{ fontSize: 11 }}>{timeAgo(n.created_at)}</span>
                </span>
                <span className="muted" style={{ fontSize: 13, display: 'block', marginTop: 2 }}>{n.body}</span>
              </span>
              {!n.is_read && <span className="notif-dot" aria-hidden="true" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
