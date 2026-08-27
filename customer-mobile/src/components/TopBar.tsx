import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useCart } from '../context/CartContext';
import { useTheme } from '../context/ThemeContext';
import { useGovernorate } from '../context/GovernorateContext';
import { useAuth } from '../context/AuthContext';
import { api } from '../api';
import { useAppName } from '@rafidain/shared/ui';
import { IconSearch, IconBell, IconCart, IconSun, IconMoon, IconPin, IconChevronDown } from '../icons';

export function TopBar({ title = '', search }: { title?: string; search?: { value: string; onChange: (v: string) => void; onSubmit?: () => void; placeholder?: string } }) {
  const navigate = useNavigate();
  const { totalCount } = useCart();
  const { theme, toggle } = useTheme();
  const { governorate, openPicker } = useGovernorate();
  const { user } = useAuth();
  const appName = useAppName();
  const [unread, setUnread] = useState(0);

  useEffect(() => {
    if (!user) return;
    const check = () => {
      api.get('/notifications/unread-count', { silent: true }).then((d) => setUnread(d?.unread || 0)).catch(() => {});
    };
    check();
    const t = setInterval(check, 30000);
    return () => clearInterval(t);
  }, [user]);

  const icons = (
    <>
      <button className="iconbtn iconbtn--light" onClick={() => navigate('/notifications')} type="button" aria-label="الإشعارات">
        <IconBell />
        {unread > 0 && <span className="badge">{unread}</span>}
      </button>
      <button className="iconbtn iconbtn--light" onClick={() => navigate('/cart')} type="button" aria-label="السلة">
        <IconCart />
        {totalCount > 0 && <span className="badge">{totalCount}</span>}
      </button>
      <button className="iconbtn iconbtn--light" onClick={toggle} type="button" aria-label={theme === 'dark' ? 'الوضع النهاري' : 'الوضع الليلي'}>
        {theme === 'dark' ? <IconSun /> : <IconMoon />}
      </button>
    </>
  );

  if (search) {
    return (
      <header className="topbar topbar--search">
        <div className="topbar__row">
          <button className="gov-pill gov-pill--mini" type="button" onClick={openPicker} aria-label="تغيير المحافظة">
            <IconPin />
            <span className="gov-pill__name">{governorate ? governorate.name_ar : ''}</span>
            <IconChevronDown />
          </button>
          <span className="topbar__brand">{appName}</span>
          <div className="topbar__icons">{icons}</div>
        </div>
        <div className="searchbox topbar__search">
          <span className="searchbox__icon"><IconSearch /></span>
          <input
            value={search.value}
            onChange={(e) => search.onChange(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && search.onSubmit?.()}
            placeholder={search.placeholder || 'ابحث عن مزود، خدمة أو منتج...'}
            aria-label="بحث"
          />
        </div>
      </header>
    );
  }

  return (
    <header className="topbar topbar--flat">
      {title ? <span className="topbar__title">{title}</span> : null}
      <button className="iconbtn iconbtn--light topbar__search-btn" onClick={() => navigate('/search')} type="button" aria-label="البحث">
        <IconSearch />
      </button>
      {icons}
    </header>
  );
}
