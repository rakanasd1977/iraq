import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useState, useEffect, useRef } from 'react';
import { useAuth } from './auth';
import { useToast, fmtDate, useNotificationStream, useAppName } from '@rafidain/shared/ui';
import { api } from './api';
import type { NotificationItem } from './types';

type NavItem =
  | { section: string }
  | { to: string; label: string; icon: string; end?: boolean };

function NotificationBell({ onNavigate }: { onNavigate: (to: string) => void }) {
  const [count, setCount] = useState(0);
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [show, setShow] = useState(false);
  const timer = useRef<number | null>(null);

  const refresh = () => {
    api.get('/notifications?limit=10', { silent: true })
      .then((r) => {
        setItems(r.data || []);
        setCount(Number(r.meta?.unread) || 0);
      })
      .catch(() => {});
  };

  useEffect(() => {
    refresh();
    timer.current = window.setInterval(refresh, 30000);
    return () => window.clearInterval(timer.current ?? undefined);
  }, []);

  useNotificationStream({ onEvent: refresh });

  const openItem = (n: NotificationItem) => {
    if (!n.is_read) api.post(`/notifications/${n.id}/read`, {}, { silent: true }).catch(() => {});
    setShow(false);
    onNavigate(n.url || '/');
  };

  const readAll = () => {
    api.post('/notifications/read-all', {}, { silent: true }).then(refresh).catch(() => {});
  };

  return (
    <div className="bell-wrap">
      <button className={`bell ${show ? 'bell-open' : ''}`} onClick={() => setShow((s) => !s)} aria-label="الإشعارات">
        🔔
        {count > 0 && <span className="bell-badge">{count > 99 ? '99+' : count}</span>}
      </button>
      {show && (
        <div className="bell-panel">
          <div className="bell-head">
            <span className="bold">الإشعارات</span>
            {count > 0 && <button className="btn btn-ghost btn-sm" onClick={readAll}>تعيين الكل مقروءاً</button>}
          </div>
          {items.length === 0 ? (
            <div className="bell-empty">لا توجد إشعارات</div>
          ) : (
            <div className="bell-list">
              {items.map((n) => (
                <button key={n.id} className={`bell-row${n.is_read ? '' : ' bell-row--unread'}`} onClick={() => openItem(n)}>
                  <span className="bell-row__icon">{n.icon || '🔔'}</span>
                  <span className="bell-row__body">
                    <span className="bell-row__title">{n.title}</span>
                    <span className="bell-row__text">{n.body}</span>
                    <span className="bell-row__time">{fmtDate(n.created_at)}</span>
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const NAV: NavItem[] = [
  { section: 'الرئيسية' },
  { to: '/', label: 'لوحة المعلومات', icon: '📊', end: true },
  { section: 'إدارة المحافظة' },
  { to: '/providers', label: 'مزودو الخدمة', icon: '🏪' },
  { to: '/orders', label: 'طلبات المحافظة', icon: '🧾' },
  { to: '/customers', label: 'زبائن المحافظة', icon: '👥' },
  { to: '/activity', label: 'سجل النشاط', icon: '📝' },
  { section: 'الحساب والعمولات' },
  { to: '/wallet', label: 'محفظتي', icon: '💰' },
  { to: '/commissions', label: 'عمولاتي', icon: '📈' },
  { to: '/lease', label: 'إجارة الوكالة', icon: '📜' },
  { to: '/profile', label: 'ملفي الشخصي', icon: '👤' },
];

export default function Layout() {
  const { user, logout } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const appName = useAppName();

  useEffect(() => { document.title = appName; }, [appName]);

  const handleLogout = () => {
    logout();
    toast.success('تم تسجيل الخروج');
    navigate('/login');
  };

  const initial = (user?.name_ar || 'و').trim().charAt(0);
  const leaseExpired = user?.lease_status === 'expired';
  const govName = user?.governorate_name_ar || '-';
  const distName = user?.district_name_ar;
  const scopeTitle = distName ? `قضاء ${distName}` : `محافظة ${govName}`;

  return (
    <div className="app">
      <aside className={`sidebar ${open ? 'open' : ''}`}>
          <div className="brand">
            <div className="logo">🤝</div>
            <div>
              <div className="title">{appName}</div>
              <div className="sub">لوحة وكيل {distName ? 'القضاء' : 'المحافظة'}</div>
            </div>
          </div>
        <nav>
          {NAV.map((item, i) =>
            'section' in item ? (
              <div className="section-label" key={i}>{item.section}</div>
            ) : (
              <NavLink key={i} to={item.to} end={item.end} onClick={() => setOpen(false)}>
                <span className="icon">{item.icon}</span>
                {item.label}
              </NavLink>
            )
          )}
        </nav>
        {leaseExpired && (
          <div className="sidebar-footer" style={{ background: 'var(--danger)', color: '#fff', borderRadius: 8 }}>
            ⚠️ إجارتك منتهية — جددها من صفحة إجارة الوكالة
          </div>
        )}
        <div className="sidebar-footer">
          {distName ? (
            <>قضاؤك: <strong>{distName}</strong> <span className="muted">(محافظة {govName})</span></>
          ) : (
            <>محافظتك: <strong>{govName}</strong></>
          )}
        </div>
      </aside>

      <div className="main">
        <header className="topbar">
          <div className="page-title">لوحة وكيل {scopeTitle}</div>
          <div className="topbar-actions">
            <NotificationBell onNavigate={(to) => navigate(to)} />
            <div className="user-chip">
              <div className="avatar">{initial}</div>
              <div>
                <div style={{ fontWeight: 700, fontSize: 13 }}>{user?.name_ar}</div>
                <div className="muted" style={{ fontSize: 11 }}>وكيل {scopeTitle}</div>
              </div>
            </div>
            <button className="btn btn-outline btn-sm" onClick={handleLogout}>تسجيل الخروج</button>
          </div>
        </header>
        <main className="content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
