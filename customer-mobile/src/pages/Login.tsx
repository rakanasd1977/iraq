import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { Toast } from '../components/Toast';
import { Spinner } from '../components/Spinner';
import { useAppName } from '@rafidain/shared/ui';

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const next = params.get('next') || '';
  const appName = useAppName();

  useEffect(() => { document.title = appName; }, [appName]);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [toast, setToast] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: any) => {
    e.preventDefault();
    setBusy(true);
    setToast('');
    try {
      await login(email, password);
      navigate(next ? next : '/');
    } catch (err: any) {
      setToast(err.message || 'تعذر الدخول');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', background: 'linear-gradient(120deg, var(--brand), var(--brand2))' }}>
      <div style={{ padding: '28px 20px 70px', color: '#fff' }}>
        <div style={{ fontSize: 28, fontWeight: 800 }}>{appName}</div>
        <div style={{ fontSize: 13, opacity: 0.92, marginTop: 4 }}>تسجيل الدخول لحساب الزبون</div>
      </div>
      <div style={{ padding: '0 20px', marginTop: -30 }}>
        <form className="card" style={{ padding: 20 }} onSubmit={submit}>
          <div className="field">
            <label>البريد الإلكتروني</label>
            <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
          </div>
          <div className="field">
            <label>كلمة المرور</label>
            <input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" />
          </div>
          <button className="btn btn--primary btn--lg" disabled={busy} type="submit">
            {busy ? <Spinner /> : 'دخول'}
          </button>
          <div style={{ textAlign: 'center', marginTop: 14, fontSize: 13 }}>
            <span className="muted">ليس لديك حساب؟ </span>
            <Link to={`/register${next ? `?next=${next}` : ''}`} style={{ color: 'var(--brand)', fontWeight: 700 }}>أنشئ حساباً</Link>
          </div>
        </form>
      </div>
      <Toast message={toast} onClose={() => setToast('')} />
    </div>
  );
}
