import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';

export function PageHeader({ title = '', onBack = null, right = null }: { title?: string; onBack?: (() => void) | null; right?: ReactNode }) {
  const navigate = useNavigate();
  return (
    <div style={{ position: 'sticky', top: 0, zIndex: 50, background: 'linear-gradient(120deg, var(--brand), var(--brand2))', boxShadow: '0 4px 18px rgba(255,107,26,0.3)' }}>
      <div className="row" style={{ padding: '10px 12px', gap: 8 }}>
        <button
          className="iconbtn iconbtn--light"
          onClick={onBack || (() => navigate(-1))}
          type="button"
          aria-label="رجوع"
          style={{ background: 'rgba(255,255,255,0.15)' }}
        >
          →
        </button>
        <span className="grow" style={{ color: '#fff', fontWeight: 700, fontSize: 16, textAlign: 'center' }}>{title}</span>
        <div style={{ width: 38 }}>{right}</div>
      </div>
    </div>
  );
}
