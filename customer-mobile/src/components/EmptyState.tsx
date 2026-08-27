import type { ReactNode } from 'react';

export function EmptyState({ icon = '🗂️', title = 'لا توجد عناصر', sub = '', action = null }: { icon?: string; title?: string; sub?: string; action?: ReactNode }) {
  return (
    <div className="empty">
      <div className="empty__icon">{icon}</div>
      <div className="empty__title">{title}</div>
      {sub && <div className="empty__sub">{sub}</div>}
      {action}
    </div>
  );
}
