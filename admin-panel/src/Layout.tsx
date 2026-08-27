import { NavLink, Outlet, useNavigate, useLocation } from 'react-router-dom';
import { useState, useEffect, useRef } from 'react';
import { useAuth, useAuthPermissions } from './auth';
import { useToast, fmt, fmtDate, useNotificationStream, useAppName } from '@rafidain/shared/ui';
import { api } from './api';

function NotificationBell({ onNavigate }: { onNavigate: any }) {
  const [count, setCount] = useState(0);
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
  };

  useEffect(() => {
    refresh();
    timer.current = setInterval(refresh, 30000);
    return () => clearInterval(timer.current ?? undefined);
  }, []);

  useNotificationStream({ onEvent: refresh });

  const openItem = (n: any) => {
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

const NAV = [
  { section: 'الرئيسية' },
  { to: '/', label: 'لوحة المعلومات', icon: '📊', end: true, perm: ['dashboard', 'view'] },
  { to: '/executive', label: 'لوحة تنفيذية', icon: '🎯', perm: ['dashboard', 'view'] },
  { section: 'الإدارة العامة' },
  { to: '/governorates', label: 'المحافظات', icon: '🏙️', perm: ['governorates', 'view'] },
  { to: '/districts', label: 'أقضية المحافظات', icon: '🗺️', perm: ['districts', 'view'] },
  { to: '/agents', label: 'وكلاء المحافظات', icon: '🤝', perm: ['agents', 'view'] },
  { to: '/providers', label: 'مزودو الخدمة', icon: '🏪', perm: ['providers', 'view'] },
  { to: '/services', label: 'الخدمات', icon: '🧩', perm: ['services', 'view'] },
  { section: 'محتوى المتجر' },
  { to: '/catalog', label: 'كتالوج المتجر', icon: '🛍️', perm: ['catalog', 'view'] },
  { to: '/coupons', label: 'الكوبونات المركزية', icon: '🎟️', perm: ['coupons', 'view'] },
  { to: '/reviews', label: 'إدارة التقييمات', icon: '⭐', perm: ['reviews', 'view'] },
  { to: '/notifications', label: 'إرسال إشعار', icon: '📣', perm: ['notifications', 'view'] },
  { to: '/home-layout', label: 'تخطيط الصفحة الرئيسية', icon: '🧱', perm: ['settings', 'view'] },
  { section: 'الصلاحيات' },
  { to: '/roles', label: 'الأدوار والصلاحيات', icon: '🔐', perm: ['roles', 'view'] },
  { to: '/admin-users', label: 'صلاحيات المسؤولين', icon: '👥', perm: ['users', 'view'] },
  { section: 'البيانات' },
  { to: '/bulk', label: 'الاستيراد/التصدير الجماعي', icon: '📦', perm: ['bulk', 'view'] },
  { section: 'العمليات' },
  { to: '/orders', label: 'الطلبات', icon: '🧾', perm: ['orders', 'view'] },
  { to: '/customers', label: 'الزبائن', icon: '👥', perm: ['customers', 'view'] },
  { to: '/commissions', label: 'العمولات', icon: '💰', perm: ['commissions', 'view'] },
  { to: '/financial-report', label: 'التقرير المالي', icon: '📈', perm: ['financial_reports', 'view'] },
  { to: '/promotions', label: 'الإعلانات', icon: '📢', perm: ['promotions', 'view'] },
  { to: '/wallets', label: 'محافظ المزودين', icon: '👛', perm: ['wallets', 'view'] },
  { to: '/agent-withdrawals', label: 'سحوبات الوكلاء', icon: '💸', perm: ['withdrawals', 'view'] },
  { to: '/leases', label: 'إجارات الوكالات', icon: '📜', perm: ['leases', 'view'] },
  { section: 'النظام' },
  { to: '/activity', label: 'سجل النشاط', icon: '📋', perm: ['activity_log', 'view'] },
  { to: '/settings', label: 'الإعدادات', icon: '⚙️', perm: ['settings', 'view'] },
  { to: '/profile', label: 'ملفي الشخصي', icon: '👤' },
];

function navMatch(item: any, pathname: string) {
  if (!item.to) return false;
  if (item.end) return pathname === item.to;
  return pathname === item.to || pathname.startsWith(item.to + '/');
}

const POLL_MS = 20000;

function playBeep() {
  try {
    const Ctx = window.AudioContext || (window as any).webkitAudioContext;
    const ctx = new Ctx();
    const tone = (freq: any, at: any, dur: any) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.connect(g);
      g.connect(ctx.destination);
      o.type = 'sine';
      o.frequency.value = freq;
      g.gain.setValueAtTime(0.0001, ctx.currentTime + at);
      g.gain.exponentialRampToValueAtTime(0.25, ctx.currentTime + at + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + at + dur);
      o.start(ctx.currentTime + at);
      o.stop(ctx.currentTime + at + dur + 0.05);
    };
    tone(880, 0, 0.22);
    tone(1175, 0.26, 0.3);
    setTimeout(() => { try { ctx.close(); } catch (e: any) { /* تجاهل */ } }, 1300);
  } catch (e: any) { /* لا صوت مدعوم */ }
}

export default function Layout() {
  const { user, logout } = useAuth();
  const { can } = useAuthPermissions();
  const toast = useToast();
  const navigate = useNavigate();
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const [pendingRecharges, setPendingRecharges] = useState(0);
  const prevCount = useRef(null);
  const appName = useAppName();
  const appNameRef = useRef(appName);
  appNameRef.current = appName;

  useEffect(() => { document.title = appName; }, [appName]);

  const canView = (item: any) => !item.perm || can(item.perm[0], item.perm[1]);
  const navItems = NAV.map((item, i) => {
    if (item.section) {
      let hasVisible = false;
      for (let j = i + 1; j < NAV.length; j++) {
        if (NAV[j].section) break;
        if (canView(NAV[j])) { hasVisible = true; break; }
      }
      return { ...item, _visible: hasVisible };
    }
    return { ...item, _visible: canView(item) };
  }).filter((x) => x._visible);

  const current = NAV.find((item) => item.to && navMatch(item, location.pathname));
  const denied = current && current.perm && !can(current.perm[0], current.perm[1]);

  useEffect(() => {
      const check = () => {
        api.get('/recharges?status=pending', { silent: true })
          .then((r) => {
          const count = (r.data || []).length;
          setPendingRecharges(count);
          document.title = count > 0 ? `(${count}) طلبات شحن — ${appNameRef.current}` : appNameRef.current;
          if (prevCount.current !== null && count > prevCount.current) {
            playBeep();
            const newest = r.data[0];
            const txt = `🔔 ${newest.reference} — ${newest.provider_name}: ${fmt(newest.amount)} دينار`;
            toast.success(`طلب شحن جديد! ${txt}`);
            if ('Notification' in window && Notification.permission === 'granted') {
              try {
                new Notification('طلب شحن جديد — ' + appNameRef.current, { body: txt, icon: '🛒' });
              } catch (e: any) { /* تجاهل */ }
            }
          }
          prevCount.current = count;
        })
        .catch(() => {});
    };
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission().catch(() => {});
    }
    check();
    const timer = setInterval(check, POLL_MS);
    return () => clearInterval(timer);
  }, [toast]);

  const handleLogout = () => {
    logout();
    toast.success('تم تسجيل الخروج');
    navigate('/login');
  };

  const initial = (user?.name_ar || 'م').trim().charAt(0);

  return (
    <div className="app">
      <aside className={`sidebar ${open ? 'open' : ''}`}>
        <div className="brand">
          <div className="logo">🛒</div>
          <div>
            <div className="title">{appName}</div>
            <div className="sub">لوحة إدارة المسؤول</div>
          </div>
        </div>
        <nav>
          {navItems.map((item, i) =>
            item.section ? (
              <div className="section-label" key={i}>{item.section}</div>
            ) : (
              <NavLink key={i} to={item.to as string} end={item.end} onClick={() => setOpen(false)}>
                <span className="icon">{item.icon}</span>
                {item.label}
                {item.to === '/wallets' && pendingRecharges > 0 && <span className="nav-badge">{pendingRecharges}</span>}
              </NavLink>
            )
          )}
        </nav>
        <div className="sidebar-footer">المنصة مجرد وسيط بين الزبون ومزود الخدمة</div>
      </aside>

      <div className="main">
        <header className="topbar">
          <div className="page-title">لوحة إدارة المسؤول</div>
          <div className="topbar-actions">
            <NotificationBell onNavigate={(to: any) => navigate(to)} />
            <div className="user-chip">
              <div className="avatar">{initial}</div>
              <div>
                <div style={{ fontWeight: 700, fontSize: 13 }}>{user?.name_ar}</div>
                <div className="muted" style={{ fontSize: 11 }}>مسؤول المنصة</div>
              </div>
            </div>
            <button className="btn btn-outline btn-sm" onClick={handleLogout}>تسجيل الخروج</button>
          </div>
        </header>
        <main className="content">
          {denied ? (
            <div className="card"><div className="card-body" style={{ textAlign: 'center', padding: 40 }}>
              <div style={{ fontSize: 40 }}>🚫</div>
              <h3>غير مصرح لك بالوصول</h3>
              <p className="muted">لا تملك الصلاحية الكافية لعرض هذا القسم. راجع دورك أو اطلب من مسؤول أعلى منحك الصلاحية.</p>
            </div></div>
          ) : (
            <Outlet />
          )}
        </main>
      </div>
    </div>
  );
}
