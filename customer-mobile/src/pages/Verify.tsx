import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { Toast } from '../components/Toast';
import { Spinner } from '../components/Spinner';

export default function Verify() {
  const { verifyEmail } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [token] = useState(params.get('token') || '');
  const next = params.get('next') || '';
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState('');

  const submit = async () => {
    if (!token) {
      setToast('رمز التفعيل مفقود');
      return;
    }
    setBusy(true);
    setToast('');
    try {
      await verifyEmail(token);
      navigate(next === 'checkout' ? '/checkout' : '/');
    } catch (err: any) {
      setToast(err.message || 'فشل التفعيل');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', padding: 20, display: 'flex', flexDirection: 'column' }}>
      <div style={{ textAlign: 'center', paddingTop: 24 }}>
        <div style={{ fontSize: 52 }}>📧</div>
        <div style={{ fontSize: 20, fontWeight: 800, marginTop: 12 }}>تفعيل البريد الإلكتروني</div>
        <p className="muted" style={{ marginTop: 8, lineHeight: 1.7 }}>
          أُرسل رمز التفعيل إلى بريدك. في الوضع التجريبي الحالي يُعرض الرمز مباشرةً:
        </p>
        <div
          style={{
            margin: '16px auto',
            padding: 14,
            background: 'var(--surface2)',
            border: '1px dashed var(--brand2)',
            borderRadius: 12,
            fontFamily: 'monospace',
            direction: 'ltr',
            fontSize: 13,
            wordBreak: 'break-all',
            maxWidth: 340,
          }}
        >
          {token || '—'}
        </div>
        <button className="btn btn--primary btn--lg" style={{ maxWidth: 340, margin: '0 auto' }} disabled={busy} onClick={submit} type="button">
          {busy ? <Spinner /> : 'تفعيل الحساب ودخول'}
        </button>
      </div>
      <Toast message={toast} onClose={() => setToast('')} />
    </div>
  );
}
