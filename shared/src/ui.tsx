import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  useRef,
  memo,
  type ReactNode,
  type FormEvent,
  type ChangeEvent,
} from 'react';

const APP_NAME_DEFAULT = 'سوق الرافدين';
let appNameCache: string | null = null;

export function useAppName(): string {
  const [name, setName] = useState<string>(appNameCache || APP_NAME_DEFAULT);
  useEffect(() => {
    let active = true;
    fetch('/api/public/config', { headers: { Accept: 'application/json' }, credentials: 'include' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: any) => {
        const n = (d && d.data && d.data.app_name) || APP_NAME_DEFAULT;
        appNameCache = n;
        if (active) setName(n);
      })
      .catch(() => {});
    return () => { active = false; };
  }, []);
  return name;
}

export function getAppNameSync(): string {
  return appNameCache || APP_NAME_DEFAULT;
}

interface ToastItem {
  id: number;
  type: string;
  message: string;
}

interface ToastApi {
  success: (m: string) => void;
  error: (m: string) => void;
  info: (m: string) => void;
}

const noopToast: ToastApi = { success: () => {}, error: () => {}, info: () => {} };

const ToastContext = createContext<ToastApi>(noopToast);

let globalToastApi: ToastApi | null = null;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const push = useCallback((type: string, message: string) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, type, message }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3500);
  }, []);

  const success = (m: string) => push('success', m);
  const error = (m: string) => push('error', m);
  const info = (m: string) => push('info', m);
  globalToastApi = { success, error, info };

  return (
    <ToastContext.Provider value={{ success, error, info }}>
      {children}
      <div className="toast-wrap" role="region" aria-live="polite" aria-label="الإشعارات">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.type}`} role={t.type === 'error' ? 'alert' : 'status'}>{t.message}</div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  return useContext(ToastContext);
}

export const toast: ToastApi = {
  success: (m: string) => globalToastApi && globalToastApi.success(m),
  error: (m: string) => globalToastApi && globalToastApi.error(m),
  info: (m: string) => globalToastApi && globalToastApi.info(m),
};

export function useNotificationStream({ onEvent, enabled = true }: { onEvent?: () => void; enabled?: boolean }) {
  const ref = useRef<EventSource | null>(null);
  useEffect(() => {
    if (!enabled || typeof EventSource === 'undefined') return undefined;
    const es = new EventSource('/api/notifications/stream');
    const handler = () => onEvent && onEvent();
    es.addEventListener('notification', handler);
    ref.current = es;
    return () => {
      es.close();
      ref.current = null;
    };
  }, [enabled]);
  return ref;
}

export function fmt(n: number | string | null | undefined): string {
  if (n === null || n === undefined || isNaN(Number(n))) return '0';
  return Number(n).toLocaleString('en-US');
}

export function fmtDate(s: string | null | undefined): string {
  if (!s) return '-';
  const d = new Date(s);
  if (isNaN(d.getTime())) return s;
  return d.toLocaleString('ar-IQ', { dateStyle: 'medium', timeStyle: 'short' });
}

interface StatusDef {
  label: string;
  cls: string;
}

export const ORDER_STATUS: Record<string, StatusDef> = {
  pending: { label: 'قيد الانتظار', cls: 'badge-amber' },
  confirmed: { label: 'مؤكد', cls: 'badge-blue' },
  in_progress: { label: 'قيد التنفيذ', cls: 'badge-teal' },
  completed: { label: 'مكتمل', cls: 'badge-green' },
  cancelled: { label: 'ملغي', cls: 'badge-red' },
};

export const LEASE_STATUS: Record<string, StatusDef> = {
  active: { label: 'نشطة', cls: 'badge-green' },
  expired: { label: 'منتهية', cls: 'badge-red' },
  pending: { label: 'قيد الموافقة', cls: 'badge-amber' },
};

export const RECHARGE_STATUS: Record<string, StatusDef> = {
  pending: { label: 'قيد المراجعة', cls: 'badge-amber' },
  approved: { label: 'مقبول — أُضيف الرصيد', cls: 'badge-green' },
  rejected: { label: 'مرفوض', cls: 'badge-red' },
};

export const WITHDRAWAL_STATUS: Record<string, StatusDef> = {
  pending: { label: 'قيد الانتظار', cls: 'badge-amber' },
  approved: { label: 'معتمد', cls: 'badge-green' },
  rejected: { label: 'مرفوض', cls: 'badge-red' },
};

export const VERIFY_STATUS: Record<string, StatusDef> = {
  none: { label: 'غير موثق', cls: 'badge-gray' },
  pending: { label: 'قيد المراجعة', cls: 'badge-amber' },
  approved: { label: 'موثق ✓', cls: 'badge-green' },
  rejected: { label: 'مرفوض', cls: 'badge-red' },
};

export const Badge = memo(function Badge({ status, map }: { status: string; map?: Record<string, StatusDef> }) {
  const def = map ? map[status] : null;
  const cls = def ? def.cls : 'badge-gray';
  const label = def ? def.label : status;
  return <span className={`badge ${cls}`}>{label}</span>;
});

export const Spinner = memo(function Spinner() {
  return <div className="spinner" />;
});

export const PageLoading = memo(function PageLoading() {
  return (
    <div className="page-loading">
      <Spinner />
    </div>
  );
});

export const EmptyState = memo(function EmptyState({ text = 'لا توجد بيانات', icon = '📭' }: { text?: string; icon?: string }) {
  return (
    <div className="empty-state">
      <div className="big">{icon}</div>
      <div>{text}</div>
    </div>
  );
});

export const Confirm = memo(function Confirm({
  open,
  title = 'تأكيد العملية',
  message,
  confirmText = 'نعم، تأكيد',
  onConfirm,
  onCancel,
  danger = false,
}: {
  open: boolean;
  title?: string;
  message?: string;
  confirmText?: string;
  onConfirm?: () => void;
  onCancel?: () => void;
  danger?: boolean;
}) {
  if (!open) return null;
  return (
    <div className="modal-overlay" onClick={onCancel} role="presentation">
      <div className="modal" style={{ maxWidth: 420 }} onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="confirm-title" aria-describedby="confirm-message">
        <div className="modal-header">
          <h3 id="confirm-title">{title}</h3>
          <button className="modal-close" onClick={onCancel} aria-label="إغلاق">×</button>
        </div>
        <div className="modal-body">
          <p id="confirm-message" style={{ lineHeight: 1.8 }}>{message}</p>
        </div>
        <div className="modal-footer">
          <button className="btn btn-outline" onClick={onCancel}>إلغاء</button>
          <button className={`btn ${danger ? 'btn-danger' : 'btn-primary'}`} onClick={onConfirm}>{confirmText}</button>
        </div>
      </div>
    </div>
  );
});

export const Modal = memo(function Modal({
  open,
  title,
  onClose,
  children,
  size = undefined,
}: {
  open: boolean;
  title?: string;
  onClose?: () => void;
  children?: ReactNode;
  size?: 'lg' | 'sm';
}) {
  if (!open) return null;
  return (
    <div className="modal-overlay" onClick={onClose} role="presentation">
      <div className={`modal ${size === 'lg' ? 'lg' : ''}`} onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="modal-title">
        <div className="modal-header">
          <h3 id="modal-title">{title}</h3>
          <button className="modal-close" onClick={onClose} aria-label="إغلاق">×</button>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
});

export const Field = memo(function Field({
  label,
  required = false,
  hint = '',
  full = false,
  children,
  htmlFor,
}: {
  label: ReactNode;
  required?: boolean;
  hint?: string;
  full?: boolean;
  children?: ReactNode;
  htmlFor?: string;
}) {
  return (
    <div className={`field ${full ? 'full' : ''}`}>
      <label htmlFor={htmlFor}>{label}{required && <span className="req"> *</span>}</label>
      {children}
      {hint && <span className="field-hint">{hint}</span>}
    </div>
  );
});

export const Toggle = memo(function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label?: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      style={{
        width: 42, height: 22, borderRadius: 20, border: 'none', cursor: 'pointer',
        background: checked ? 'var(--success)' : '#cbd5e1',
        position: 'relative', transition: 'background 0.15s',
      }}
    >
      <span
        style={{
          position: 'absolute', top: 2, width: 18, height: 18, borderRadius: '50%',
          background: '#fff', transition: 'all 0.15s',
          right: checked ? 22 : 2,
        }}
      />
    </button>
  );
});

type StatTone = 'primary' | 'accent' | 'success' | 'danger' | 'info' | 'warn';

export const StatCard = memo(function StatCard({ label, value, icon = undefined, tone = 'primary' }: { label: string; value: ReactNode; icon?: ReactNode; tone?: StatTone }) {
  const tones: Record<StatTone, { bg: string; color: string }> = {
    primary: { bg: 'var(--primary-light)', color: 'var(--primary-dark)' },
    accent: { bg: 'var(--accent-light)', color: '#92400e' },
    success: { bg: 'var(--success-light)', color: 'var(--success)' },
    danger: { bg: 'var(--danger-light)', color: 'var(--danger)' },
    info: { bg: 'var(--info-light)', color: 'var(--info)' },
    warn: { bg: '#fef3c7', color: '#92400e' },
  };
  const t = tones[tone] || tones.primary;
  return (
    <div className="card stat-card flex-between">
      <div>
        <div className="stat-label">{label}</div>
        <div className="stat-value">{value}</div>
      </div>
      <div className="stat-icon" style={{ background: t.bg, color: t.color, width: 52, height: 52, borderRadius: 12, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        {icon}
      </div>
    </div>
  );
});

export const Pagination = memo(function Pagination({ meta, page, onChange }: { meta?: { total?: number; pages?: number } | null; page: number; onChange: (p: number) => void }) {
  const total = meta?.total ?? 0;
  const pages = Math.max(1, meta?.pages || 1);
  if (!total) return null;
  const shown: number[] = [];
  const start = Math.max(1, Math.min(page, pages - 4));
  const end = Math.min(pages, start + 4);
  for (let i = start; i <= end; i += 1) shown.push(i);
  return (
    <nav className="pagination" aria-label="تصفح الصفحات">
      <button type="button" className="page-btn" disabled={page <= 1} onClick={() => onChange(page - 1)} aria-label="السابق">‹</button>
      {start > 1 && <span className="page-dots" aria-hidden="true">…</span>}
      {shown.map((n) => (
        <button key={n} type="button" className={`page-btn${n === page ? ' active' : ''}`} onClick={() => onChange(n)} aria-current={n === page ? 'page' : undefined}>{n}</button>
      ))}
      {end < pages && <span className="page-dots" aria-hidden="true">…</span>}
      <button type="button" className="page-btn" disabled={page >= pages} onClick={() => onChange(page + 1)} aria-label="التالي">›</button>
      {pages > 1 && <span className="page-info" aria-live="polite">صفحة {page} من {pages}</span>}
    </nav>
  );
});

export interface TwoFactorManagerProps {
  api: { post: (path: string, body?: unknown, extra?: any) => Promise<any> };
  enabled: boolean;
  onChanged?: (v: boolean) => void;
}

export function TwoFactorManager({ api, enabled, onChanged }: TwoFactorManagerProps) {
  const toastApi = useToast();
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState(enabled ? 'enabled' : 'off');
  const [secret, setSecret] = useState('');
  const [qr, setQr] = useState('');
  const [otpauth, setOtpauth] = useState('');
  const [code, setCode] = useState('');

  useEffect(() => {
    setStep(enabled ? 'enabled' : 'off');
  }, [enabled]);

  const startSetup = async () => {
    setBusy(true);
    try {
      const res = await api.post('/auth/2fa/setup');
      const d = res.data || res;
      setSecret(d.secret);
      setQr(d.qr_url);
      setOtpauth(d.otpauth_uri);
      setCode('');
      setStep('setup');
    } catch (e) {
      toastApi.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const enable = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api.post('/auth/2fa/enable', { code });
      toastApi.success('تم تفعيل المصادقة الثنائية');
      if (onChanged) onChanged(true);
      setStep('enabled');
    } catch (err) {
      toastApi.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const disable = async (e: FormEvent) => {
    e.preventDefault();
    if (!code) { toastApi.error('أدخل رمز التحقق الحالي أولاً'); return; }
    setBusy(true);
    try {
      await api.post('/auth/2fa/disable', { code });
      toastApi.success('تم إيقاف المصادقة الثنائية');
      if (onChanged) onChanged(false);
      setStep('off');
    } catch (err) {
      toastApi.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const input = (v: string) => (
    <input
      type="text"
      inputMode="numeric"
      autoComplete="one-time-code"
      value={v}
      onChange={(e: ChangeEvent<HTMLInputElement>) => v === code ? setCode(e.target.value.replace(/\D/g, '').slice(0, 6)) : null}
      placeholder="••••••"
      style={{ maxWidth: 160 }}
      dir="ltr"
    />
  );

  if (step === 'setup') {
    return (
      <div>
        <p className="muted mb-3">امسح رمز QR بتطبيق المصادقة (مثل Google Authenticator / Microsoft Authenticator)، ثم أدخل الرقم المكوّن من 6 أرقام لتأكيد التفعيل.</p>
        {qr && <div className="mb-3" style={{ textAlign: 'center' }}><img src={qr} alt="QR" width={180} height={180} style={{ borderRadius: 8, border: '1px solid var(--border)' }} /></div>}
        <div className="mb-3">
          <div className="k" style={{ fontSize: 12 }}>المفتاح السري (أدخله يدوياً إن تعذّر المسح):</div>
          <code dir="ltr" style={{ fontSize: 13 }}>{secret}</code>
          <button
            type="button"
            className="btn btn-ghost"
            style={{ marginInlineStart: 8 }}
            onClick={() => { if (navigator.clipboard) navigator.clipboard.writeText(secret); toastApi.info('تم نسخ المفتاح'); }}
          >نسخ</button>
        </div>
        <form onSubmit={enable} className="flex gap-sm items-center">
          <Field label="رمز التحقق" required>{input(code)}</Field>
          <button className="btn btn-primary" disabled={busy}>{busy ? 'جاري التفعيل...' : 'تفعيل الحماية'}</button>
        </form>
        <button type="button" className="btn btn-ghost mt-2" onClick={() => setStep('off')} disabled={busy}>إلغاء</button>
      </div>
    );
  }

  if (step === 'enabled') {
    return (
      <div>
        <div className="flex items-center gap-sm mb-3">
          <span className="badge badge-green">✓ مفعّلة</span>
          <span className="muted" style={{ fontSize: 13 }}>يُطلب رمز من تطبيق المصادقة عند كل دخول.</span>
        </div>
        <form onSubmit={disable} className="flex gap-sm items-center">
          <Field label="رمز التحقق الحالي" required>{input(code)}</Field>
          <button className="btn btn-danger" disabled={busy}>{busy ? 'جاري الإيقاف...' : 'إيقاف المصادقة الثنائية'}</button>
        </form>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center gap-sm mb-3">
        <span className="badge badge-gray">غير مفعّلة</span>
        <span className="muted" style={{ fontSize: 13 }}>يُنصح بتفعيلها لحسابات الامتياز.</span>
      </div>
      <button className="btn btn-primary" onClick={startSetup} disabled={busy}>{busy ? 'جاري الإعداد...' : 'تفعيل المصادقة الثنائية'}</button>
    </div>
  );
}

type SparklineData = { label: string; orders: number; revenue: number }[];

export function Sparkline({ data, metric, width = 160, height = 40, color = 'var(--primary)' }: { data: SparklineData; metric: 'orders' | 'revenue'; width?: number; height?: number; color?: string }) {
  if (!data?.length) return <div style={{ width, height, opacity: 0 }} />;
  const values = data.map((d) => d[metric]);
  const max = Math.max(...values, 1);
  const min = Math.min(...values);
  const points = values.map((v, i) => {
    const x = (i / (values.length - 1)) * width;
    const y = height - ((v - min) / (max - min || 1)) * height;
    return `${x},${y}`;
  }).join(' ');
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} style={{ overflow: 'visible' }}>
      <defs>
        <linearGradient id="spark-gradient" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.3" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <polyline fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" points={points} />
      <polyline fill="url(#spark-gradient)" stroke="none" points={`0,${height} ${points} ${width},${height}`} />
      <circle cx={points.split(' ').slice(-1)[0].split(',')[0]} cy={points.split(' ').slice(-1)[0].split(',')[1]} r="3" fill={color} />
    </svg>
  );
}

export interface KPICardWithTrendProps {
  label: string;
  value: string | number;
  icon?: React.ReactNode;
  tone?: 'primary' | 'accent' | 'success' | 'danger' | 'info' | 'warn';
  deltaPct?: number;
  deltaLabel?: string;
  sparklineData?: SparklineData;
  sparklineMetric?: 'orders' | 'revenue';
}

export function KPICardWithTrend({ label, value, icon, tone = 'primary', deltaPct = 0, deltaLabel, sparklineData, sparklineMetric = 'orders' }: KPICardWithTrendProps) {
  const tones: Record<string, { bg: string; color: string }> = {
    primary: { bg: 'var(--primary-light)', color: 'var(--primary-dark)' },
    accent: { bg: 'var(--accent-light)', color: '#92400e' },
    success: { bg: 'var(--success-light)', color: 'var(--success)' },
    danger: { bg: 'var(--danger-light)', color: 'var(--danger)' },
    info: { bg: 'var(--info-light)', color: 'var(--info)' },
    warn: { bg: '#fef3c7', color: '#92400e' },
  };
  const t = tones[tone] || tones.primary;
  const isPositive = deltaPct > 0;
  const isNegative = deltaPct < 0;
  return (
    <div className="card stat-card flex-between">
      <div style={{ flex: 1 }}>
        <div className="stat-label">{label}</div>
        <div className="stat-value">{value}</div>
        {deltaPct !== undefined && (
          <div className="flex items-center gap-xs mt-1" style={{ fontSize: 13 }}>
            <span className={`badge ${isPositive ? 'badge-green' : isNegative ? 'badge-red' : 'badge-gray'}`}>
              {isPositive ? '↑' : isNegative ? '↓' : '→'} {Math.abs(deltaPct).toFixed(1)}%
            </span>
            {deltaLabel && <span className="muted">{deltaLabel}</span>}
          </div>
        )}
      </div>
      <div className="flex flex-col items-end" style={{ gap: 8 }}>
        <div className="stat-icon" style={{ background: t.bg, color: t.color, width: 52, height: 52, borderRadius: 12, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          {icon}
        </div>
        {sparklineData && (
          <div style={{ width: 140, height: 36, opacity: 0.8 }}>
            <Sparkline data={sparklineData} metric={sparklineMetric} width={140} height={36} color={t.color} />
          </div>
        )}
      </div>
    </div>
  );
}
