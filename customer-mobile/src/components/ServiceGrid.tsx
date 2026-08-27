import { useNavigate } from 'react-router-dom';
import { serviceVisual } from '../icons';
import { useTheme } from '../context/ThemeContext';
import type { ApiRecord } from '../types';

export function ServiceGrid({ services }: { services: ApiRecord[] }) {
  const navigate = useNavigate();
  const { theme } = useTheme();
  return (
    <div className="grid-services">
      {services.map((s) => {
        const v = serviceVisual(s.slug);
        return (
          <button key={s.id} className="svc" type="button" onClick={() => navigate(`/search?service=${s.slug}`)}>
            <span className="svc__icon" style={{ background: theme === 'dark' ? v.dark : v.color }}>{v.icon}</span>
            <span className="svc__name">{s.name_ar}</span>
            {Number(s.providers_count) > 0 && <span className="svc__count">{s.providers_count}</span>}
          </button>
        );
      })}
    </div>
  );
}
