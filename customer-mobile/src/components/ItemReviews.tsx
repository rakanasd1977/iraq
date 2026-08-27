import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { customerApi, publicApi } from '../api';
import { formatDateTime } from '../format';

export function ItemReviews({ kind, itemId, onToast }: { kind: string; itemId: number | string; onToast?: (msg: string) => void }) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [data, setData] = useState<any>(null);
  const [myRating, setMyRating] = useState(0);
  const [myComment, setMyComment] = useState('');
  const [busy, setBusy] = useState(false);

  const empty = { reviews: [], breakdown: [], rating: 0, rating_count: 0 };

  useEffect(() => {
    let alive = true;
    publicApi
      .itemReviews(kind, itemId)
      .then((res) => alive && setData(res || empty))
      .catch(() => alive && setData(empty));
    if (user) {
      customerApi
        .itemRateInfo(kind, itemId)
        .then((r) => {
          if (!alive) return;
          if (r.my_rating) setMyRating(r.my_rating);
          if (r.my_comment) setMyComment(r.my_comment);
        })
        .catch(() => {});
    }
    return () => {
      alive = false;
    };
  }, [kind, itemId, user]);

  const refresh = async () => {
    const res = await publicApi.itemReviews(kind, itemId);
    setData(res || empty);
    if (user) {
      const ri = await customerApi.itemRateInfo(kind, itemId);
      if (ri.my_rating) setMyRating(ri.my_rating);
    }
  };

  const submit = async () => {
    if (myRating < 1) {
      if (onToast) onToast('اختر تقييماً من 1 إلى 5');
      return;
    }
    setBusy(true);
    try {
      await customerApi.rateItem(kind, itemId, myRating, myComment.trim() || undefined);
      if (onToast) onToast('شكراً لتقييمك');
      await refresh();
    } catch (e: any) {
      if (onToast) onToast(e.message);
    } finally {
      setBusy(false);
    }
  };

  const reviews: any[] = (data && data.reviews) || [];

  return (
    <div>
      {user ? (
        <div className="card" style={{ padding: 14, marginBottom: 12 }}>
          <div className="muted" style={{ marginBottom: 6 }}>{myRating ? 'تعديل تقييمك' : 'قيّم هذا البند'}</div>
          <div className="row" style={{ gap: 6 }}>
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                style={{ fontSize: 26, color: n <= myRating ? '#ffb400' : 'var(--border2)', padding: 0, background: 'none', border: 'none', cursor: 'pointer' }}
                onClick={() => setMyRating(n)}
                type="button"
                aria-label={`${n} نجوم`}
              >
                ★
              </button>
            ))}
          </div>
          <textarea
            className="input"
            style={{ marginTop: 8 }}
            rows={2}
            placeholder="أضف تعليقاً (اختياري)"
            value={myComment}
            onChange={(e) => setMyComment(e.target.value)}
          />
          <button className="btn btn--primary btn--sm" style={{ marginTop: 10, width: '100%' }} disabled={busy} onClick={submit} type="button">
            {busy ? 'جارٍ الإرسال…' : 'إرسال التقييم'}
          </button>
        </div>
      ) : (
        <div className="card" style={{ padding: 14, marginBottom: 12 }}>
          <button className="btn btn--outline btn--sm" style={{ width: '100%' }} onClick={() => navigate('/login?next=' + encodeURIComponent(window.location.hash.slice(1)))} type="button">
            سجّل الدخول لتقييم البند
          </button>
        </div>
      )}

      {reviews.length ? (
        reviews.map((r) => (
          <div className="card" style={{ padding: 12, marginBottom: 10 }} key={r.id}>
            <div className="row row--between">
              <div className="row" style={{ gap: 6 }}>
                <span style={{ width: 26, height: 26, borderRadius: '50%', background: 'var(--surface2)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 13 }}>
                  {r.customer_avatar || '👤'}
                </span>
                <span style={{ fontWeight: 700, fontSize: 13 }}>{r.customer_name}</span>
              </div>
              <span className="stars" style={{ fontSize: 12 }}>{'★'.repeat(r.rating)}</span>
            </div>
            {r.comment && <p className="muted" style={{ marginTop: 6 }}>{r.comment}</p>}
            <div className="muted" style={{ marginTop: 4, fontSize: 11 }}>{formatDateTime(r.created_at)}</div>
          </div>
        ))
      ) : (
        <div className="muted" style={{ padding: '10px 0' }}>لا توجد تقييمات بعد — كن أول من يقيّم</div>
      )}
    </div>
  );
}
