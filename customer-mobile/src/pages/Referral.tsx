import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { customerApi } from '../api';
import { formatPrice } from '../format';
import { PageHeader } from '../components/PageHeader';
import { Spinner } from '../components/Spinner';
import { Toast } from '../components/Toast';

export default function Referral() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState(false);
  const [toast, setToast] = useState('');

  const load = () => {
    if (!user) return;
    setError(false);
    setData(null);
    customerApi.referral().then(setData).catch(() => setError(true));
  };

  useEffect(load, [user]);

  if (!user) {
    return (
      <div>
        <PageHeader title="ادعُ الأصدقاء" />
        <div className="empty">
          <div className="empty__icon">🔐</div>
          <div className="empty__title">يجب تسجيل الدخول</div>
          <button className="btn btn--primary" onClick={() => navigate('/login?next=referral')} type="button">تسجيل الدخول</button>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div>
        <PageHeader title="ادعُ الأصدقاء" />
        <div className="empty">
          <div className="empty__icon">⚠️</div>
          <div className="empty__title">تعذر تحميل كود الدعوة</div>
          <div className="empty__sub">تحقق من اتصالك بالإنترنت وحاول مجدداً</div>
          <button className="btn btn--primary" onClick={load} type="button">إعادة المحاولة</button>
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div>
        <PageHeader title="ادعُ الأصدقاء" />
        <div className="centerpad"><Spinner /></div>
      </div>
    );
  }

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(data.link);
      setToast('تم نسخ رابط الدعوة');
    } catch (e: any) {
      setToast(data.link);
    }
  };

  const share = async () => {
    const text = `انضم إليّ على الرافدين عبر الرابط: ${data.link}`;
    if (navigator.share) {
      try {
        await navigator.share({ title: 'دعوة إلى الرافدين', text });
        return;
      } catch (e: any) { /* أُلغيت المشاركة */ }
    }
    try {
      await navigator.clipboard.writeText(text);
      setToast('تم نسخ نص الدعوة');
    } catch (e: any) { /* تجاهل */ }
  };

  return (
    <div>
      <PageHeader title="ادعُ الأصدقاء واربح" />
      <div className="page page--no-nav">
        <div className="card" style={{ padding: 18, marginBottom: 14, background: 'linear-gradient(135deg,#7b2ff7,#f107a3)', color: '#fff', textAlign: 'center' }}>
          <div style={{ fontSize: 40 }}>🎁</div>
          <div style={{ fontWeight: 900, fontSize: 19, marginTop: 6 }}>اربح {formatPrice(data.bonus_referrer)} لكل صديق</div>
          <div className="muted" style={{ fontSize: 13, opacity: 0.9, marginTop: 4 }}>
            يدعو صديقك بكودك، ويُكمل أول طلب بقيمة {formatPrice(data.min_order)} فأكثر — وتربح كلاكما نقاطاً فورية.
          </div>
        </div>

        <div className="card" style={{ padding: 14, marginBottom: 14 }}>
          <div className="muted" style={{ fontSize: 12, marginBottom: 6 }}>كود الدعوة الخاص بك</div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
            <span style={{ fontWeight: 900, fontSize: 22, letterSpacing: 2, direction: 'ltr', color: 'var(--brand)' }}>{data.code}</span>
            <button className="btn btn--outline btn--sm" onClick={copy} type="button">📋 نسخ</button>
          </div>
          <div className="muted" style={{ fontSize: 12, marginTop: 6, direction: 'ltr', textAlign: 'center', wordBreak: 'break-all' }}>{data.link}</div>
          <button className="btn btn--primary btn--lg" style={{ marginTop: 12 }} onClick={share} type="button">💌 مشاركة الدعوة</button>
        </div>

        <div className="card" style={{ padding: 14, marginBottom: 14 }}>
          <div className="row row--between">
            <span style={{ fontWeight: 800 }}>الأصدقاء المدعوون</span>
            <span style={{ fontWeight: 800, color: 'var(--brand)' }}>{data.invited_count}</span>
          </div>
          <div className="row row--between" style={{ marginTop: 8 }}>
            <span className="muted">مكافأتك عن كل صديق</span>
            <span style={{ fontWeight: 700, color: '#00a650' }}>+{formatPrice(data.bonus_referrer)} ⭐</span>
          </div>
          <div className="row row--between" style={{ marginTop: 6 }}>
            <span className="muted">مكافأة الصديق عند أول طلب</span>
            <span style={{ fontWeight: 700, color: '#00a650' }}>+{formatPrice(data.bonus_referee)} ⭐</span>
          </div>
        </div>

        <div className="card" style={{ padding: 14 }}>
          <div style={{ fontWeight: 800, marginBottom: 6 }}>كيف تعمل؟</div>
          <div className="muted" style={{ fontSize: 13, lineHeight: 1.9 }}>
            1. شارك كودك أو رابطك مع صديق.<br />
            2. يسجّل الصديق حسابه بالكود (يمكن ملؤه تلقائياً عند التسجيل).<br />
            3. عند إكمال صديقك أول طلب بقيمة {formatPrice(data.min_order)} فأكثر تُضاف مكافأتك ومكافأته فوراً إلى رصيد النقاط.<br />
            4. استبدل النقاط بخصم عند إتمام أي طلب لاحق.
          </div>
        </div>
      </div>
      <Toast message={toast} onClose={() => setToast('')} />
    </div>
  );
}
