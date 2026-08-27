export function formatPrice(n: number | string): string {
  const v = Number(n) || 0;
  return v.toLocaleString('en-US') + ' د.ع';
}

export function formatCompact(n: number | string): string {
  const v = Number(n) || 0;
  if (v >= 1000000) return (v / 1000000).toFixed(1).replace('.', ',') + ' م';
  if (v >= 1000) return Math.round(v / 1000).toLocaleString('en-US') + ' ألف';
  return String(v);
}

export function discountPercent(oldPrice: number | string, price: number | string): number {
  const o = Number(oldPrice);
  const p = Number(price);
  if (!(o > 0) || !(o > p)) return 0;
  return Math.round(((o - p) / o) * 100);
}

export function formatDate(s: string): string {
  if (!s) return '';
  const d = new Date(s.replace(' ', 'T'));
  if (Number.isNaN(d.getTime())) return s;
  return d.toLocaleDateString('ar-IQ', { year: 'numeric', month: 'short', day: 'numeric' });
}

export function formatDateTime(s: string): string {
  if (!s) return '';
  const d = new Date(s.replace(' ', 'T'));
  if (Number.isNaN(d.getTime())) return s;
  return (
    d.toLocaleDateString('ar-IQ', { year: 'numeric', month: 'short', day: 'numeric' }) +
    ' ' +
    d.toLocaleTimeString('ar-IQ', { hour: '2-digit', minute: '2-digit' })
  );
}

export function timeAgo(s: string): string {
  if (!s) return '';
  const d = new Date(s.replace(' ', 'T'));
  if (Number.isNaN(d.getTime())) return '';
  const diff = Math.max(0, Date.now() - d.getTime());
  const min = Math.floor(diff / 60000);
  if (min < 1) return 'الآن';
  if (min < 60) return `منذ ${min} د`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `منذ ${hr} س`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `منذ ${day} يوم`;
  return formatDate(s);
}
