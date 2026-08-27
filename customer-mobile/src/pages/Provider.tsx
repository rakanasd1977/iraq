import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { PageHeader } from '../components/PageHeader';
import { RatingStars } from '../components/RatingStars';
import { AdsRow } from '../components/AdsRow';
import { CenterSpinner } from '../components/Spinner';
import { ShareSheet } from '../components/ShareSheet';
import { Toast } from '../components/Toast';
import { publicApi } from '../api';
import { useGovernorate } from '../context/GovernorateContext';
import { useAuth } from '../context/AuthContext';
import { useFollow } from '../context/FollowContext';
import { serviceVisual } from '../icons';
import { timeAgo } from '../format';
import { trackRecent } from '../recentlyViewed';
import type { Governorate } from '../types';

export default function Provider() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { governorate, governorates, select } = useGovernorate();
  const { user } = useAuth();
  const { isFollowing, toggle } = useFollow();
  const [p, setP] = useState<any>(null);
  const [error, setError] = useState('');
  const [reviews, setReviews] = useState<any>(null);
  const [showShare, setShowShare] = useState(false);
  const [toast, setToast] = useState('');

  useEffect(() => {
    publicApi
      .provider(id || '')
      .then((p) => {
        setP(p);
        trackRecent({
          type: 'provider',
          id: p.id,
          title: p.name_ar,
          image: p.logo || null,
          sub: `${p.governorate_name_ar || ''} · ${p.service_name_ar || ''}`,
        });
      })
      .catch((e) => setError(e.message));
    publicApi
      .providerReviews(id || '')
      .then((r) => setReviews(r))
      .catch(() => setReviews({ reviews: [], breakdown: [] }));
  }, [id]);

  if (error) {
    return (
      <div>
        <PageHeader title="مزود الخدمة" />
        <div className="empty">
          <div className="empty__icon">😕</div>
          <div className="empty__title">{error}</div>
        </div>
      </div>
    );
  }
  if (!p) {
    return (
      <div>
        <PageHeader title="مزود الخدمة" />
        <CenterSpinner />
      </div>
    );
  }

  const v = serviceVisual(p.service_slug);
  // مزود من محافظة أخرى: لافتة تتيح الانتقال إلى محافظته مباشرة
  const isForeign = governorate && p.governorate_code && p.governorate_code !== governorate.code;
  const foreignGov = governorates.find((g) => g.code === p.governorate_code) || null;
  const goToGov = () => {
    if (foreignGov) {
      select(foreignGov);
    } else {
      const fakeGov: Governorate = { id: 0, code: p.governorate_code, name_ar: p.governorate_name_ar };
      select(fakeGov);
    }
  };
  const sections = (
    [
      p.service_slug === 'stores' && { to: 'catalog', icon: '🛍️', label: 'المنتجات', count: p.catalog_counts?.products },
      p.service_slug === 'restaurants' && { to: 'menu', icon: '🍽️', label: 'قائمة الطعام', count: p.catalog_counts?.menu_items },
      p.service_slug === 'hotels' && { to: 'rooms', icon: '🛏️', label: 'الغرف', count: p.catalog_counts?.rooms },
      p.service_slug === 'flights' && { to: 'flights', icon: '✈️', label: 'الرحلات', count: p.catalog_counts?.flights },
      p.service_slug === 'travel_offices' && { to: 'packages', icon: '🧳', label: 'الباقات', count: p.catalog_counts?.packages },
    ].filter(Boolean) as Array<{ to: string; icon: string; label: string; count?: number | string }>
  );

  return (
    <div>
      <PageHeader title={p.name_ar} />
      <div style={{ padding: 14 }}>
        {isForeign && (
          <div className="gov-banner">
            <span>📍 هذا المزود في محافظة {p.governorate_name_ar} وليس {governorate.name_ar}</span>
            <button type="button" className="gov-banner__btn" onClick={goToGov}>
              الانتقال إلى محافظته
            </button>
          </div>
        )}
        <div className="card" style={{ padding: 14 }}>
          <div className="row" style={{ gap: 12 }}>
            <div className="provider-card__logo" style={{ fontSize: 34, overflow: 'hidden' }}>
              {p.logo ? (
                <img src={p.logo} alt={p.name_ar} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              ) : (
                v.icon
              )}
            </div>
            <div className="grow">
              <div style={{ fontWeight: 800, fontSize: 17 }}>{p.name_ar}</div>
              <div className="muted" style={{ marginTop: 2 }}>
                {p.governorate_name_ar} · {p.service_name_ar}
              </div>
              <div style={{ marginTop: 6 }}>
                <RatingStars rating={p.rating} count={p.rating_count} />
              </div>
            </div>
            <a
              className="iconbtn share-icon"
              href={`https://wa.me/?text=${encodeURIComponent(`${p.name_ar}\n${window.location.href}`)}`}
              target="_blank"
              rel="noreferrer noopener"
              aria-label="مشاركة عبر واتساب"
            >
              💬
            </a>
            <button className="iconbtn share-icon" onClick={() => setShowShare(true)} type="button" aria-label="مشاركة">
              🔗
            </button>
          </div>
          <button
            type="button"
            className={`followbtn${isFollowing(p.id) ? ' followbtn--on' : ''}`}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              if (!user) {
                navigate('/login');
                return;
              }
              toggle(p.id).then((ok) => {
                if (ok) setToast(isFollowing(p.id) ? 'تم إلغاء المتابعة' : 'تمت المتابعة — ستصلك إشعارات كل جديد');
                else setToast('تعذر التحديث، حاول مجدداً');
              });
            }}
          >
            {isFollowing(p.id) ? '✓ تتابع هذا المزود' : '＋ متابعة هذا المزود'}
            {typeof p.followers_count === 'number' && p.followers_count > 0 && (
              <span className="followbtn__count">{p.followers_count} متابع</span>
            )}
          </button>
          {p.is_verified && (
            <div className="chip chip--active" style={{ marginTop: 10, display: 'inline-block' }}>✔ مزود موثوق</div>
          )}
          {p.description && <p className="detail-desc">{p.description}</p>}
          {p.address && <div className="muted" style={{ marginTop: 6 }}>📍 {p.address}</div>}
          {p.phone && <div className="muted" style={{ marginTop: 4 }}>📞 {p.phone}</div>}
        </div>

        <div className="section-title">📦 الكتالوج</div>
        {sections.map((s) => (
          <button
            key={s.to}
            className="card card--clickable"
            type="button"
            style={{ display: 'flex', alignItems: 'center', gap: 12, padding: 14, width: '100%', marginBottom: 10 }}
            onClick={() => navigate(`/provider/${id}/${s.to}`)}
          >
            <span style={{ fontSize: 26 }}>{s.icon}</span>
            <span className="grow" style={{ fontWeight: 700, fontSize: 15 }}>{s.label}</span>
            {s.count ? <span className="muted">{s.count}</span> : null}
            <span style={{ color: 'var(--brand)' }}>‹</span>
          </button>
        ))}

        <AdsRow title="📣 إعلانات مزودي محافظتك" />

        <div className="section-title">⭐ تقييمات الزبائن</div>
        {reviews && (
          <div className="card" style={{ padding: 14 }}>
            {reviews.reviews && reviews.reviews.length > 0 ? (
              <>
                {reviews.breakdown && reviews.breakdown.length > 0 && (
                  <div style={{ marginBottom: 10 }}>
                    {[5, 4, 3, 2, 1].map((n) => {
                      const b = reviews.breakdown.find((x: any) => x.rating === n);
                      return (
                        <div key={n} className="row" style={{ gap: 8, marginBottom: 4, fontSize: 12 }}>
                          <span style={{ width: 24, fontWeight: 700 }}>{n}★</span>
                          <span className="rating-bar"><span className="rating-bar__fill" style={{ width: `${b ? (b.count / reviews.reviews.length) * 100 : 0}%` }} /></span>
                          <span className="muted" style={{ width: 28, textAlign: 'left' }}>{b ? b.count : 0}</span>
                        </div>
                      );
                    })}
                  </div>
                )}
                {reviews.reviews.map((r: any) => (
                  <div key={r.id} className="review">
                    <div className="row" style={{ gap: 8 }}>
                      <span style={{ fontSize: 18 }}>{r.customer_avatar || '👤'}</span>
                      <span className="grow">
                        <div className="row row--between">
                          <span style={{ fontWeight: 700, fontSize: 14 }}>{r.customer_name}</span>
                          <span className="muted" style={{ fontSize: 11 }}>{timeAgo(r.created_at)}</span>
                        </div>
                        <RatingStars rating={r.rating} />
                      </span>
                    </div>
                    {r.comment && <p className="review__text">{r.comment}</p>}
                    {r.reply && (
                      <div className="review__reply">
                        <div style={{ fontWeight: 700, fontSize: 12, marginBottom: 2 }}>رد المزود</div>
                        {r.reply}
                      </div>
                    )}
                  </div>
                ))}
              </>
            ) : (
              <div className="muted" style={{ textAlign: 'center', padding: '10px 0' }}>
                لا توجد تقييمات بعد — كن أول من يقيّم بعد إتمام طلبك
              </div>
            )}
          </div>
        )}
      </div>
      <ShareSheet
        open={showShare}
        onClose={() => setShowShare(false)}
        title={p.name_ar}
        url={window.location.href}
        onCopied={() => setToast('نُسخ رابط الصفحة')}
      />
      <Toast message={toast} onClose={() => setToast('')} />
    </div>
  );
}
