import { useState } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { Toast } from '../components/Toast';
import { Spinner } from '../components/Spinner';

export default function Register() {
  const { register } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const next = params.get('next') || '';
  const refCode = (params.get('ref') || '').trim();
  const [form, setForm] = useState({ name_ar: '', email: '', phone: '', password: '', referral_code: refCode });
  const [toast, setToast] = useState('');
  const [busy, setBusy] = useState(false);

  const set = (k: string) => (e: any) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e: any) => {
    e.preventDefault();
    setBusy(true);
    setToast('');
    try {
      const res: any = await register(form);
      navigate(`/verify?token=${encodeURIComponent(res.verification_token)}${next ? `&next=${next}` : ''}`);
    } catch (err: any) {
      setToast(err.message || 'تعذر إنشاء الحساب');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)' }}>
      <div style={{ background: 'linear-gradient(120deg, var(--brand), var(--brand2))', padding: '24px 20px 48px', color: '#fff' }}>
        <div style={{ fontSize: 22, fontWeight: 800 }}>إنشاء حساب زبون</div>
      </div>
      <div style={{ padding: '0 20px', marginTop: -24 }}>
        <form className="card" style={{ padding: 20 }} onSubmit={submit}>
          <div className="field">
            <label>الاسم الكامل</label>
            <input className="input" value={form.name_ar} onChange={set('name_ar')} />
          </div>
          <div className="field">
            <label>البريد الإلكتروني</label>
            <input className="input" type="email" value={form.email} onChange={set('email')} />
          </div>
          <div className="field">
            <label>رقم الهاتف</label>
            <input className="input" dir="ltr" value={form.phone} onChange={set('phone')} />
          </div>
          <div className="field">
            <label>كلمة المرور (6 أحرف على الأقل)</label>
            <input className="input" type="password" value={form.password} onChange={set('password')} />
          </div>
          <div className="field">
            <label>كود الإحالة (اختياري)</label>
            <input className="input" dir="ltr" value={form.referral_code} onChange={set('referral_code')} placeholder="RAF..." />
            {refCode && <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>🎁 تم تعبئة كود دعوة تلقائياً — ستربحان نقاطاً عند أول طلب</div>}
          </div>
          <button className="btn btn--primary btn--lg" disabled={busy} type="submit">
            {busy ? <Spinner /> : 'إنشاء الحساب'}
          </button>
          <div style={{ textAlign: 'center', marginTop: 14, fontSize: 13 }}>
            <span className="muted">لديك حساب؟ </span>
            <Link to="/login" style={{ color: 'var(--brand)', fontWeight: 700 }}>دخول</Link>
          </div>
        </form>
      </div>
      <Toast message={toast} onClose={() => setToast('')} />
    </div>
  );
}
