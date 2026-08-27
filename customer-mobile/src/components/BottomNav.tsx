import { useNavigate, useLocation } from 'react-router-dom';
import { useCart } from '../context/CartContext';
import { NAV_HEIGHT } from '../theme';
import { IconHome, IconSearch, IconCart, IconBox, IconUser } from '../icons';

const TABS = [
  { to: '/', icon: <IconHome />, label: 'الرئيسية' },
  { to: '/search', icon: <IconSearch />, label: 'البحث' },
  { to: '/cart', icon: <IconCart />, label: 'السلة' },
  { to: '/orders', icon: <IconBox />, label: 'الطلبات' },
  { to: '/profile', icon: <IconUser />, label: 'حسابي' },
];

export function BottomNav() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { totalCount } = useCart();

  const active = (to: string) => (pathname === to || (to !== '/' && pathname.startsWith(to))) || (to === '/' && pathname === '/');

  return (
    <nav className="bottomnav" style={{ height: NAV_HEIGHT }}>
      {TABS.map((t) => {
        const isActive = active(t.to);
        return (
          <button
            key={t.to}
            className={`bottomnav__item${isActive ? ' bottomnav__item--active' : ''}`}
            onClick={() => navigate(t.to)}
            type="button"
          >
            <span className="bottomnav__icon">
              {t.icon}
              {t.to === '/cart' && totalCount > 0 && <span className="badge" style={{ left: 'auto', right: -8, top: -4 }}>{totalCount}</span>}
            </span>
            <span>{t.label}</span>
          </button>
        );
      })}
    </nav>
  );
}
