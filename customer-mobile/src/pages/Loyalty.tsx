import { useEffect, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { customerApi } from '../api';
import { formatPrice, timeAgo } from '../format';
import { PageHeader } from '../components/PageHeader';
import { Spinner } from '../components/Spinner';

const TIERS = [
  { key: 'platinum', name: 'بلاتيني', icon: '💎' },
  { key: 'gold', name: 'ذهبي', icon: '🥇' },
  { key: 'silver', name: 'فضي', icon: '🥈' },
  { key: 'bronze', name: 'برونزي', icon: '🥉' },
];

const TYPE_LABEL: Record<string, string> = {
  earn: 'نقاط ولاء',
  redeem: 'استبدال',
  referral: 'مكافأة إحالة',
};

export default function Loyalty() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState(false);

  const load = () => {
    if (!user) return;
    setError(false);
    setData(null);
    customerApi.loyalty().then(setData).catch(() => setError(true));
  };

  useEffect(load, [user]);

  if (!user) {
    return (
      <div>
        <PageHeader title="نقاط الولاء" />
        <div className="empty">
          <div className="empty__icon">🔐</div>
          <div className="empty__title">يجب تسجيل الدخول</div>
          <button className="btn btn--primary" onClick={() => navigate('/login?next=loyalty')} type="button">تسجيل الدخول</button>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div>
        <PageHeader title="نقاط الولاء" />
        <div className="empty">
          <div className="empty__icon">⚠️</div>
          <div className="empty__title">تعذر تحميل رصيد النقاط</div>
          <div className="empty__sub">تحقق من اتصالك بالإنترنت وحاول مجدداً</div>
          <button className="btn btn--primary" onClick={load} type="button">إعادة المحاولة</button>
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div>
        <PageHeader title="نقاط الولاء" />
        <div className="centerpad"><Spinner /></div>
      </div>
    );
  }

  const tier = data.tier;
  const nextTier = data.next_tier;
  const progress = nextTier && data.points_total < nextTier.min
    ? Math.min(100, Math.round(((data.points_total - tier.min) / (nextTier.min - tier.min)) * 100))
    : 100;

  return (
    <div>
      <PageHeader title="نقاط الولاء" />
      <div className="page page--no-nav">
        <div className="card" style={{ padding: 18, marginBottom: 14, background: 'linear-gradient(135deg,#1a1a2e,#16213e)', color: '#fff' }}>
          <div className="row row--between" style={{ marginBottom: 6 }}>
            <span style={{ fontSize: 13, opacity: 0.85 }}>رصيدك من النقاط</span>
            <span style={{ fontSize: 13, opacity: 0.85 }}>{tier.icon} {tier.name}</span>
          </div>
          <div style={{ fontSize: 30, fontWeight: 900 }}>{data.points_balance} <span style={{ fontSize: 16, fontWeight: 700 }}>⭐</span></div>
          <div className="muted" style={{ fontSize: 12, opacity: 0.7, marginTop: 2 }}>النقطة الواحدة = {formatPrice(data.point_value)} خصم</div>
          <div className="progress" style={{ height: 8, borderRadius: 8, background: 'rgba(255,255,255,0.2)', overflow: 'hidden', marginTop: 12 }}>
            <div style={{ height: '100%', width: `${progress}%`, background: 'linear-gradient(90deg,#f5a623,#ff6b00)', borderRadius: 8 }} />
          </div>
          <div style={{ fontSize: 11, marginTop: 6, opacity: 0.85 }}>
            {nextTier
              ? `باقي ${nextTier.min - data.points_total} نقطة للوصول إلى ${nextTier.icon} ${nextTier.name}`
              : '🏆 وصلت إلى أعلى مستوى في برنامج الولاء'}
          </div>
          <Link to="/checkout" style={{ display: 'inline-block', marginTop: 12, background: '#fff', color: '#16213e', fontWeight: 800, fontSize: 13, padding: '8px 14px', borderRadius: 10 }}>
            استبدالها عند الدفع
          </Link>
        </div>

        <div className="card" style={{ padding: 14, marginBottom: 14 }}>
          <div style={{ fontWeight: 800, marginBottom: 8 }}>المستويات</div>
          <div className="row" style={{ gap: 8 }}>
            {TIERS.map((t) => (
              <div
                key={t.key}
                className="card"
                style={{
                  flex: 1,
                  textAlign: 'center',
                  padding: '10px 4px',
                  border: data.tier.key === t.key ? '2px solid #f5a623' : 'none',
                }}
              >
                <div style={{ fontSize: 20 }}>{t.icon}</div>
                <div style={{ fontWeight: 700, fontSize: 12 }}>{t.name}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="card" style={{ padding: 0 }}>
          <div style={{ fontWeight: 800, padding: '12px 14px', borderBottom: '1px solid var(--border, #eef1f5)' }}>سجل النقاط</div>
          {data.history.length === 0 ? (
            <div className="muted" style={{ padding: 16, textAlign: 'center' }}>لا توجد حركات بعد — أكمل طلباً لتربح نقاطاً</div>
          ) : (
            data.history.map((h: any) => (
              <div key={h.id} className="order-item row row--between">
                <span className="grow">
                  <span className="row row--between">
                    <span style={{ fontWeight: 700, fontSize: 14 }}>{h.description || TYPE_LABEL[h.type] || h.type}</span>
                    <span className="muted" style={{ fontSize: 11 }}>{timeAgo(h.created_at)}</span>
                  </span>
                  {h.order_number && <span className="muted" style={{ fontSize: 11 }}>الطلب {h.order_number}</span>}
                </span>
                <span style={{ fontWeight: 800, color: h.type === 'redeem' ? '#ff3b30' : '#00a650' }}>
                  {h.type === 'redeem' ? '' : '+'}{h.points} ⭐
                </span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
