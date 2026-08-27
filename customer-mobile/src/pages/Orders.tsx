import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Badge, ORDER_STATUS } from '@rafidain/shared/ui';
import { EmptyState } from '../components/EmptyState';
import { customerApi } from '../api';
import { formatPrice, formatDateTime } from '../format';

const STATUS_OPTIONS = Object.keys(ORDER_STATUS);
const STATUS_LABELS = Object.fromEntries(STATUS_OPTIONS.map((k) => [k, { text: ORDER_STATUS[k].label }]));
const TABS = [{ v: '', label: 'الكل' }, ...STATUS_OPTIONS.map((s) => ({ v: s, label: STATUS_LABELS[s].text }))];

export default function Orders() {
  const navigate = useNavigate();
  const [status, setStatus] = useState('');
  const [orders, setOrders] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const pageRef = useRef(1);

  const fetchPage = (pg: number, append: boolean) => {
    return customerApi
      .myOrders({ status, page: pg }, true)
      .then((res) => {
        const rows = (res && res.data) || [];
        const meta = res && res.meta;
        if (append) {
          setOrders((prev) => [...prev, ...rows]);
        } else {
          setOrders(rows);
        }
        pageRef.current = pg;
        setHasMore(Boolean(meta && meta.page * meta.limit < meta.total));
        return rows;
      });
  };

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setHasMore(false);
    fetchPage(1, false)
      .then(() => alive && undefined)
      .catch(() => alive && setOrders([]))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [status]);

  const loadMore = () => {
    if (loadingMore) return;
    setLoadingMore(true);
    fetchPage(pageRef.current + 1, true)
      .catch(() => {})
      .finally(() => setLoadingMore(false));
  };

  return (
    <div className="page">
      <div className="section-title" style={{ marginTop: 6 }}>📦 طلباتي</div>
      <div className="chips">
        {TABS.map((t) => (
          <button key={t.v} className={`chip${status === t.v ? ' chip--active' : ''}`} onClick={() => setStatus(t.v)} type="button">
            {t.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div aria-busy="true">
          {Array.from({ length: 4 }).map((_, i) => (
            <div className="card" key={i} style={{ padding: 14, marginBottom: 10 }}>
              <div className="skel skel--title" style={{ width: '40%' }} />
              <div className="skel skel--text" style={{ marginTop: 8 }} />
              <div className="skel skel--text" style={{ marginTop: 6, width: '70%' }} />
            </div>
          ))}
        </div>
      ) : orders.length ? (
        <>
          {orders.map((o) => (
            <div className="card card--clickable" key={o.id} style={{ marginBottom: 10 }} onClick={() => navigate(`/orders/${o.id}`)}>
              <div style={{ padding: 12 }}>
                <div className="row row--between">
                  <span style={{ fontWeight: 800 }}>{o.order_number}</span>
                  <Badge status={o.status} map={ORDER_STATUS} />
                </div>
                <div className="muted" style={{ marginTop: 4 }}>{o.provider_name}</div>
                <div className="row row--between" style={{ marginTop: 6 }}>
                  <span className="price">{formatPrice(o.total_amount)}</span>
                  <span className="muted">{formatDateTime(o.created_at)}</span>
                </div>
              </div>
            </div>
          ))}
          {hasMore && (
            <button className="btn btn--outline btn--block" onClick={loadMore} disabled={loadingMore} type="button" style={{ marginTop: 6 }}>
              {loadingMore ? 'جارٍ التحميل...' : 'عرض المزيد'}
            </button>
          )}
        </>
      ) : (
        <EmptyState
          icon="📦"
          title="لا توجد طلبات"
          sub="عند تأكيد الطلبات ستظهر هنا"
          action={<button className="btn btn--primary" onClick={() => navigate('/search')} type="button">تصفح الخدمات</button>}
        />
      )}
    </div>
  );
}
