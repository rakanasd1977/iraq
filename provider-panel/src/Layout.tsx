import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useState, useEffect, useRef } from 'react';
import { useAuth } from './auth';
import { useToast, fmtDate, useNotificationStream, useAppName } from '@rafidain/shared/ui';
import { api } from './api';
import { CATALOGS } from './catalog';

interface NotificationBellProps {
  onNavigate: (to: string) => void;
}

function NotificationBell({ onNavigate }: NotificationBellProps) {
  const [count, setCount] = useState(0);
  const [pending, setPending] = useState(0);
  const [items, setItems] = useState<any[]>([]);
  const [show, setShow] = useState(false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const refresh = () => {
    api.get('/notifications?limit=10', { silent: true })
      .then((r) => {
        setItems(r.data || []);
        setCount(Number(r.meta?.unread) || 0);
      })
      .catch(() => {});
    api.get('/provider/orders-summary', { silent: true })
      .then((r) => setPending(Number(r.data?.pending) || 0))
      .catch(() => {});
  };

  useEffect(() => {
    refresh();
    timer.current = setInterval(refresh, 30000);
    return () => clearInterval(timer.current ?? undefined);
  }, []);

  useNotificationStream({ onEvent: refresh });

  const total = count + pending;

  const openItem = (n: { id: number | string; is_read?: boolean; url?: string }) => {
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
        {total > 0 && <span className="bell-badge">{total > 99 ? '99+' : total}</span>}
      </button>
      {show && (
        <div className="bell-panel">
          {pending > 0 && (
            <div className="bell-item">
              <div className="bold">🧾 لديك {pending} طلب{pending > 1 ? 'ات' : ''} جديد بانتظار الموافقة</div>
              <button className="btn btn-primary btn-sm" onClick={() => { setShow(false); onNavigate('/orders?status=pending'); }}>عرض الطلبات</button>
            </div>
          )}
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

function buildNav(serviceType: string) {
  const cat = (CATALOGS as Record<string, any>)[serviceType];
  const items: any[] = [
    { section: 'الرئيسية' },
    { to: '/', label: 'لوحة المعلومات', icon: '📊', end: true },
    { section: 'الفهرس والمنتجات' },
  ];
  if (cat) items.push({ to: '/catalog', label: cat.title, icon: cat.icon });
  if (['stores', 'restaurants'].includes(serviceType)) {
    items.push({ to: '/categories', label: serviceType === 'stores' ? 'أقسام المنتجات' : 'أقسام القائمة', icon: '🗂️' });
  }
  items.push({ to: '/offers', label: 'العروض والتخفيضات', icon: '🏷️' });
  items.push({ section: 'الترويج' });
  items.push({ to: '/promotions', label: 'الترويج والإعلانات', icon: '📢' });
  items.push({ to: '/coupons', label: 'كوبونات الخصم', icon: '🎟️' });
  items.push({ section: 'الطلبات' });
  items.push({ to: '/orders', label: 'الطلبات', icon: '🧾' });
  if (['hotels', 'flights', 'travel_offices'].includes(serviceType)) {
    items.push({ to: '/bookings', label: 'الحجوزات', icon: '📅' });
  }
  items.push({ section: 'الحساب' });
  items.push({ to: '/wallet', label: 'محفظتي', icon: '👛' });
  items.push({ to: '/ratings', label: 'التقييمات والمراجعات', icon: '⭐' });
  items.push({ to: '/profile', label: 'ملفي الشخصي', icon: '👤' });
  return items;
}

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
  const serviceType = user?.service_type;
  const cat = (CATALOGS as Record<string, any>)[serviceType];
  const serviceName = cat?.title || user?.service_type || 'مزود خدمة';
  const NAV = buildNav(serviceType);

  return (
    <div className="app">
      <aside className={`sidebar ${open ? 'open' : ''}`}>
        <div className="brand">
          <div className="logo">🏪</div>
          <div>
            <div className="title">{appName}</div>
            <div className="sub">لوحة مزود الخدمة</div>
          </div>
        </div>
        <nav>
          {NAV.map((item, i) =>
            item.section ? (
              <div className="section-label" key={i}>{item.section}</div>
            ) : (
              <NavLink key={i} to={item.to} end={item.end} onClick={() => setOpen(false)}>
                <span className="icon">{item.icon}</span>
                {item.label}
              </NavLink>
            )
          )}
        </nav>
        <div className="sidebar-footer">
          {cat?.icon} <strong>{user?.provider_name || user?.name_ar}</strong>
          <div className="muted" style={{ fontSize: 11, color: 'inherit', opacity: 0.8 }}>{serviceName}</div>
        </div>
      </aside>

      <div className="main">
        <header className="topbar">
          <div className="page-title">{cat?.icon} {serviceName} — {user?.provider_name || ''}</div>
          <div className="topbar-actions">
            <NotificationBell onNavigate={(to: string) => navigate(to)} />
            <div className="user-chip">
              <div className="avatar">{initial}</div>
              <div>
                <div style={{ fontWeight: 700, fontSize: 13 }}>{user?.name_ar}</div>
                <div className="muted" style={{ fontSize: 11 }}>{serviceName}</div>
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
