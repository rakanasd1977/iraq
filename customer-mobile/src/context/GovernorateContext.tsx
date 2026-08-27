import { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { publicApi, customerApi } from '../api';
import { useAuth } from './AuthContext';
import { load, save, remove } from '../store';
import { CenterSpinner } from '../components/Spinner';
import type { Governorate, GovernorateContextValue } from '../types';

const GOV_KEY = 'gov';
const GovernorateContext = createContext<GovernorateContextValue | null>(null);

interface GovListProps {
  governorates: Governorate[];
  current?: Governorate | null;
  onSelect: (g: Governorate) => void;
  loading: boolean;
}

interface GovGateProps {
  governorates: Governorate[];
  onSelect: (g: Governorate) => void;
  loading: boolean;
}

interface GovSheetProps {
  governorates: Governorate[];
  current: Governorate | null;
  onSelect: (g: Governorate) => void;
  onClose: () => void;
}

// قائمة محافظات مشتركة: تُستخدم في البوابة الإلزامية وورقة التبديل
function GovList({ governorates, current = null, onSelect, loading }: GovListProps) {
  return (
    <div className="gov-list">
      {loading ? (
        <div style={{ padding: 24 }}><CenterSpinner /></div>
      ) : governorates.length === 0 ? (
        <div className="empty">
          <div className="empty__icon">🏙️</div>
          <div className="empty__title">تعذر تحميل المحافظات</div>
          <div className="empty__sub">تحقق من اتصالك وحاول مجدداً</div>
          <button className="btn btn--primary" type="button" onClick={() => window.location.reload()}>إعادة المحاولة</button>
        </div>
      ) : (
        governorates.map((g) => (
          <button
            key={g.id}
            type="button"
            className={`gov-item${current && current.code === g.code ? ' gov-item--active' : ''}`}
            onClick={() => onSelect(g)}
          >
            <span className="gov-item__name">{g.name_ar}</span>
            {g.providers_count != null && g.providers_count > 0 && <span className="gov-item__count">{g.providers_count} مزود</span>}
            {current && current.code === g.code && <span className="gov-item__check">✓</span>}
          </button>
        ))
      )}
    </div>
  );
}

// البوابة الاحتياطية: تظهر فقط عند تعذّر تحديد المحافظة تلقائياً (بلا موقع ولا حساب ولا اختيار سابق)
function GovGate({ governorates, onSelect, loading }: GovGateProps) {
  return (
    <div className="gov-gate">
      <div className="gov-gate__brand">📍</div>
      <div className="gov-gate__title">اختر محافظتك</div>
      <div className="gov-gate__sub">تظهر لك خدمات ومزودو محافظتك فقط، ويمكنك التبديل في أي وقت</div>
      <GovList governorates={governorates} onSelect={onSelect} loading={loading} />
    </div>
  );
}

// ورقة التبديل السفلية: فتحها من أي شاشة يبدّل المحافظة ويتحدث كل شيء فوراً
function GovSheet({ governorates, current, onSelect, onClose }: GovSheetProps) {
  return (
    <div className="sheet-overlay" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet__handle" />
        <div className="sheet__title">المحافظة الحالية</div>
        <div className="muted" style={{ textAlign: 'center', fontSize: 12, marginBottom: 6 }}>
          عند التبديل تظهر خدمات المحافظة الجديدة تلقائياً
        </div>
        <GovList governorates={governorates} current={current} onSelect={onSelect} loading={false} />
      </div>
    </div>
  );
}

// جلب إحداثيات الزبون من المتصفح (مع مهلة وحيدة لعدم تعطيل الواجهة)
function getCoords(): Promise<{ lat: number; lng: number } | null> {
  return new Promise((resolve) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) return resolve(null);
    let settled = false;
    const timer = setTimeout(() => done(null), 8000);
    function done(v: { lat: number; lng: number } | null) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(v);
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => done({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => done(null),
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 600000 }
    );
  });
}

export function GovernorateProvider({ children }: { children: React.ReactNode }) {
  const [governorates, setGovernorates] = useState<Governorate[]>([]);
  const [gov, setGov] = useState<Governorate | null>(null);
  const [loading, setLoading] = useState(true);
  const [resolving, setResolving] = useState(true);
  const [pickerOpen, setPickerOpen] = useState(false);
  const { user, ready: authReady } = useAuth();
  const resolvedRef = useRef(false);

  useEffect(() => {
    let alive = true;
    publicApi
      .governorates()
      .then((rows) => alive && setGovernorates(rows || []))
      .catch(() => {})
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, []);

  // كشف تلقائي للمحافظة حسب تواجد الزبون: الموقع (GPS) أولاً، ثم حسابه المسجّل، ثم اختياره المخزّن
  useEffect(() => {
    if (loading || !authReady || resolvedRef.current) return;
    if (!governorates.length) {
      resolvedRef.current = true;
      setResolving(false);
      return;
    }
    resolvedRef.current = true;
    setResolving(true);
    (async () => {
      let chosen: Governorate | null = null;
      try {
        const coords = await getCoords();
        if (coords) {
          const g = await publicApi.governorateByGeo(coords.lat, coords.lng).catch(() => null);
          if (g && (g as any).code && governorates.some((x) => x.code === (g as any).code)) {
            chosen = governorates.find((x) => x.code === (g as any).code) || null;
          }
        }
        if (!chosen && user) {
          try {
            const prof = await customerApi.profile();
            const gid = prof?.user?.governorate_id ?? prof?.governorate_id;
            if (gid) chosen = governorates.find((x) => x.id === gid) || null;
          } catch {
            /* غير مسجل أو تعذّر جلب الملف */
          }
        }
        if (!chosen) {
          const stored = load<Governorate | null>(GOV_KEY, null);
          if (stored && governorates.some((x) => x.code === stored.code)) chosen = stored;
        }
      } catch {
        chosen = null;
      } finally {
        if (chosen) {
          setGov(chosen);
          save(GOV_KEY, chosen);
        }
        setResolving(false);
      }
    })();
  }, [loading, governorates, authReady, user]);

  // إن اختُزنت محافظة لم تعد نشطة/موجودة نعيد الاختيار الإجباري
  useEffect(() => {
    if (!loading && gov && governorates.length && !governorates.some((g) => g.code === gov.code)) {
      remove(GOV_KEY);
      setGov(null);
    }
  }, [loading, gov, governorates]);

  const select = useCallback((g: Governorate) => {
    setGov(g);
    save(GOV_KEY, g);
    setPickerOpen(false);
  }, []);

  const openPicker = useCallback(() => setPickerOpen(true), []);
  const closePicker = useCallback(() => setPickerOpen(false), []);

  const value: GovernorateContextValue = { governorates, governorate: gov, select, openPicker, closePicker };

  return (
    <GovernorateContext.Provider value={value}>
      {loading || resolving ? (
        <div className="page" aria-busy="true">
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--muted)' }}>
            <CenterSpinner />
            <div style={{ marginTop: 12, fontSize: 13 }}>جاري تحديد موقعك لعرض خدمات محافظتك…</div>
          </div>
        </div>
      ) : !gov ? (
        <GovGate governorates={governorates} onSelect={select} loading={loading} />
      ) : (
        <>
          {children}
          {pickerOpen && (
            <GovSheet governorates={governorates} current={gov} onSelect={select} onClose={closePicker} />
          )}
        </>
      )}
    </GovernorateContext.Provider>
  );
}

export function useGovernorate(): GovernorateContextValue {
  const ctx = useContext(GovernorateContext);
  if (!ctx) throw new Error('useGovernorate must be used within GovernorateProvider');
  return ctx;
}
