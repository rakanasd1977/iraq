import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { customerApi } from '../api';
import { formatCompact, formatDate } from '../format';
import { pushSupported } from '@rafidain/shared/push';
import { getLocale, setLocale } from '@rafidain/shared';
import { enablePush, disablePush } from '../push';

function MenuRow({ icon, label, onClick, value, danger = false }: { icon: any; label: string; onClick: () => void; value?: string; danger?: boolean }) {
  return (
    <button className={`menu-item${danger ? ' menu-item--danger' : ''}`} onClick={onClick} type="button">
      <span className="menu-item__icon">{icon}</span>
      <span className="grow">{label}</span>
      {value !== undefined && <span className="menu-item__value">{value}</span>}
      <span className="menu-item__chevron">‹</span>
    </button>
  );
}

function MenuGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="menu-group">
      <div className="menu-group__head">{title}</div>
      <div className="card">{children}</div>
    </div>
  );
}

export default function Profile() {
  const { user, logout } = useAuth();
  const { theme, toggle } = useTheme();
  const navigate = useNavigate();
  const [dash, setDash] = useState<any>(null);
  const [loyalty, setLoyalty] = useState<any>(null);
  const [referral, setReferral] = useState<any>(null);
  const [canPush] = useState(pushSupported);
  const [pushOn, setPushOn] = useState(false);
  const [locale, setLocaleState] = useState(getLocale());
  const chooseLocale = (l: 'ar' | 'en') => { setLocale(l); setLocaleState(l); };

  useEffect(() => {
    if (!user) return;
    customerApi.dashboard().then(setDash).catch(() => {});
    customerApi.loyalty().then(setLoyalty).catch(() => {});
    customerApi.referral().then(setReferral).catch(() => {});
    if (canPush) {
      navigator.serviceWorker?.getRegistration?.('/sw.js')
        .then(async (reg) => {
          const sub = await reg?.pushManager?.getSubscription();
          setPushOn(Boolean(sub));
        })
        .catch(() => setPushOn(false));
    }
  }, [user, canPush]);

  const togglePush = async () => {
    if (pushOn) {
      await disablePush();
      setPushOn(false);
    } else {
      const ok = await enablePush();
      setPushOn(ok);
    }
  };

  const tier = loyalty?.tier;
  const nextTier = loyalty?.next_tier;
  const tierProgress = loyalty && nextTier && loyalty.points_total < nextTier.min
    ? Math.min(100, Math.round(((loyalty.points_total - tier.min) / (nextTier.min - tier.min)) * 100))
    : 100;

  if (!user) {
    return (
      <div className="page">
        <div className="empty">
          <div className="empty__icon">👤</div>
          <div className="empty__title">مرحباً بك</div>
          <div className="empty__sub">سجّل دخولك للمتابعة وتتبع طلباتك</div>
          <button className="btn btn--primary" onClick={() => navigate('/login')} type="button">تسجيل الدخول</button>
          <Link to="/register" style={{ display: 'block', marginTop: 10, color: 'var(--brand)', fontWeight: 700, fontSize: 14 }}>
            إنشاء حساب جديد
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100vh' }}>
      <header className="profile-hero">
        <div className="profile-hero__top">
          <div className="profile-hero__avatar">{user.avatar || (user.name_ar || '؟').charAt(0)}</div>
          <div className="grow">
            <div className="profile-hero__name">{user.name_ar}</div>
            <div className="profile-hero__sub">{user.email}</div>
            {user.phone && <div className="profile-hero__sub">📞 {user.phone}</div>}
          </div>
          <button className="profile-hero__edit" onClick={() => navigate('/profile/edit')} type="button" aria-label="تعديل الملف">✏️</button>
        </div>
        <div className="row" style={{ gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
          {tier && <span className="profile-hero__tier">{tier.icon} عضو {tier.name}</span>}
          {user.created_at && <span className="profile-hero__tier">🗓️ عضو منذ {formatDate(user.created_at)}</span>}
        </div>
      </header>

      <div className="profile-body">
        {dash && (
          <div className="stat-grid">
            <div className="card" style={{ background: 'var(--soft-red)', border: 'none' }}>
              <div className="stat-num">{formatCompact(dash.orders_value)}</div>
              <div className="stat-lbl">د.ع إجمالي المشتريات</div>
            </div>
            {[
              { k: 'pending_count', l: 'قيد المراجعة' },
              { k: 'active_count', l: 'نشطة' },
              { k: 'completed_count', l: 'مكتملة' },
            ].map((it) => (
              <div className="card" key={it.k}>
                <div className="stat-num">{dash[it.k] || 0}</div>
                <div className="stat-lbl">{it.l}</div>
              </div>
            ))}
          </div>
        )}

        <div className="reward-grid">
          {loyalty && (
            <button className="card reward-card--loyalty" onClick={() => navigate('/loyalty')} type="button" style={{ textAlign: 'right' }}>
              <div className="row row--between">
                <span className="reward-card__icon">{tier?.icon}</span>
                <span style={{ fontSize: 11, opacity: 0.8 }}>{tier?.name}</span>
              </div>
              <div className="reward-card__num">{loyalty.points_balance} ⭐</div>
              <div className="reward-card__lbl">
                {nextTier ? `باقي ${nextTier.min - loyalty.points_total} نقطة للمستوى التالي` : 'أعلى مستوى 🏆'}
              </div>
            </button>
          )}
          {referral && (
            <button className="card reward-card--referral" onClick={() => navigate('/referral')} type="button" style={{ textAlign: 'right' }}>
              <div className="row row--between">
                <span className="reward-card__icon">🎁</span>
                <span style={{ fontSize: 11, opacity: 0.8 }}>{referral.invited_count} دعوة</span>
              </div>
              <div className="reward-card__num">+{formatCompact(referral.bonus_referrer)}</div>
              <div className="reward-card__lbl">لكل صديق يُكمل أول طلب</div>
            </button>
          )}
        </div>

        <MenuGroup title="🛍️ نشاطي">
          <MenuRow icon="📦" label="طلباتي" onClick={() => navigate('/orders')} />
          <MenuRow icon="❤️" label="المفضلة" onClick={() => navigate('/favorites')} />
          <MenuRow icon="🔔" label="الإشعارات" onClick={() => navigate('/notifications')} />
        </MenuGroup>

        <MenuGroup title="🎁 مكافآتي">
          <MenuRow icon="⭐" label="نقاط الولاء" value={loyalty ? `${loyalty.points_balance} نقطة` : undefined} onClick={() => navigate('/loyalty')} />
          <MenuRow icon="🎁" label="ادعُ الأصدقاء" onClick={() => navigate('/referral')} />
          <MenuRow icon="🎟️" label="الكوبونات" onClick={() => navigate('/coupons')} />
        </MenuGroup>

        <MenuGroup title="⚙️ الإعدادات">
          <MenuRow icon="✏️" label="تعديل الملف الشخصي" onClick={() => navigate('/profile/edit')} />
          <MenuRow icon="📍" label="دفتر العناوين" onClick={() => navigate('/addresses')} />
          {canPush && (
            <div className="menu-item">
              <span className="menu-item__icon">{pushOn ? '🔔' : '🔕'}</span>
              <span className="grow">الإشعارات الفورية</span>
              <button className={`switch${pushOn ? ' switch--on' : ''}`} onClick={togglePush} type="button" aria-label="تبديل الإشعارات الفورية" />
            </div>
          )}
          <div className="menu-item">
            <span className="menu-item__icon">{theme === 'dark' ? '🌙' : '☀️'}</span>
            <span className="grow">الوضع {theme === 'dark' ? 'النهاري' : 'الليلي'}</span>
            <button className={`switch${theme === 'dark' ? ' switch--on' : ''}`} onClick={toggle} type="button" aria-label="تبديل المظهر" />
          </div>
        </MenuGroup>

        <MenuGroup title="🌐 اللغة">
          <button className="menu-item" onClick={() => chooseLocale('ar')} type="button">
            <span className="menu-item__icon">🇮🇶</span>
            <span className="grow">العربية</span>
            {locale === 'ar' && <span className="menu-item__value">✓</span>}
          </button>
          <button className="menu-item" onClick={() => chooseLocale('en')} type="button">
            <span className="menu-item__icon">🌐</span>
            <span className="grow">English</span>
            {locale === 'en' && <span className="menu-item__value">✓</span>}
          </button>
        </MenuGroup>

        <button className="menu-item menu-item--danger" style={{ borderRadius: 12, background: 'var(--danger-bg)', border: 'none' }} onClick={() => { logout(); navigate('/'); }} type="button">
          <span className="menu-item__icon">🚪</span>
          <span className="grow">تسجيل الخروج</span>
          <span className="menu-item__chevron">‹</span>
        </button>
      </div>
    </div>
  );
}
