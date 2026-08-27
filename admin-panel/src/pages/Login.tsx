import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth';
import { useToast, Field } from '@rafidain/shared/ui';

export default function Login() {
  const { login, verify2fa } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [twofaToken, setTwofaToken] = useState<any>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const submit = async (e: any) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await login(email, password);
      if (res && res.requires_2fa) {
        setTwofaToken(res.twofa_token);
        return;
      }
      toast.success('مرحباً بك في لوحة الإدارة');
      navigate('/');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const submitCode = async (e: any) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await verify2fa(twofaToken, code);
      toast.success('تم التحقق — مرحباً بك في لوحة الإدارة');
      navigate('/');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-logo">🛒</div>
        <h1>سوق الرافدين</h1>
        <div className="login-sub">لوحة إدارة المسؤول — دخول حصري لمسؤول المنصة فقط</div>

        {error && <div className="alert-error">{error}</div>}

        {twofaToken ? (
          <form onSubmit={submitCode}>
            <Field label="رمز التحقق بخطوتين" required hint="أدخل الرقم المكوّن من 6 أرقام من تطبيق المصادقة (مثل Google Authenticator)">
              <input
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                placeholder="••••••"
                required
              />
            </Field>
            <button className="btn btn-primary" style={{ width: '100%', marginTop: 8 }} disabled={loading}>
              {loading ? 'جاري التحقق...' : 'تأكيد التحقق'}
            </button>
          </form>
        ) : (
          <form onSubmit={submit}>
            <Field label="البريد الإلكتروني" required>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="admin@rafidain.iq"
                autoComplete="username"
                required
              />
            </Field>
            <Field label="كلمة المرور" required>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                autoComplete="current-password"
                required
              />
            </Field>
            <button className="btn btn-primary" style={{ width: '100%', marginTop: 8 }} disabled={loading}>
              {loading ? 'جاري الدخول...' : 'دخول المسؤول'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
