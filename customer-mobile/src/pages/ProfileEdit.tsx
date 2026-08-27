import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { PageHeader } from '../components/PageHeader';
import { Toast } from '../components/Toast';
import { Spinner } from '../components/Spinner';
import { useAuth } from '../context/AuthContext';
import { customerApi, publicApi, authApi } from '../api';

export default function ProfileEdit() {
  const { refreshUser } = useAuth();
  const navigate = useNavigate();
  const [governorates, setGovernorates] = useState<any[]>([]);
  const [form, setForm] = useState({ name_ar: '', phone: '', governorate_id: '', address: '' });
  const [toast, setToast] = useState('');
  const [busy, setBusy] = useState(false);
  const [pwOpen, setPwOpen] = useState(false);
  const [pw, setPw] = useState({ current_password: '', new_password: '' });
  const [pwBusy, setPwBusy] = useState(false);

  useEffect(() => {
    Promise.all([customerApi.profile(), publicApi.governorates()])
      .then(([p, govs]) => {
        setGovernorates(govs || []);
        setForm({
          name_ar: p.user.name_ar || '',
          phone: p.user.phone || '',
          governorate_id: p.user.governorate_id ? String(p.user.governorate_id) : '',
          address: (p.customer && p.customer.address) || '',
        });
      })
      .catch(() => {});
  }, []);

  const submit = async (e: any) => {
    e.preventDefault();
    setBusy(true);
    setToast('');
    try {
      await customerApi.updateProfile({
        name_ar: form.name_ar,
        phone: form.phone || undefined,
        governorate_id: form.governorate_id ? Number(form.governorate_id) : null,
        address: form.address || undefined,
      });
      await refreshUser();
      navigate('/profile');
    } catch (err: any) {
      setToast(err.message);
    } finally {
      setBusy(false);
    }
  };

  const changePw = async (e: any) => {
    e.preventDefault();
    setPwBusy(true);
    setToast('');
    try {
      await authApi.changePassword(pw.current_password, pw.new_password);
      setPwOpen(false);
      setPw({ current_password: '', new_password: '' });
      setToast('تم تغيير كلمة المرور بنجاح');
    } catch (err: any) {
      setToast(err.message);
    } finally {
      setPwBusy(false);
    }
  };

  return (
    <div>
      <PageHeader title="تعديل الملف" />
      <div className="page page--no-nav">
        <form className="card" style={{ padding: 16 }} onSubmit={submit}>
          <div className="field">
            <label>الاسم</label>
            <input className="input" value={form.name_ar} onChange={(e) => setForm((f) => ({ ...f, name_ar: e.target.value }))} />
          </div>
          <div className="field">
            <label>رقم الهاتف</label>
            <input className="input" dir="ltr" value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} />
          </div>
          <div className="field">
            <label>المحافظة</label>
            <select className="input" value={form.governorate_id} onChange={(e) => setForm((f) => ({ ...f, governorate_id: e.target.value }))}>
              <option value="">— بدون —</option>
              {governorates.map((g) => (
                <option key={g.id} value={g.id}>{g.name_ar}</option>
              ))}
            </select>
          </div>
          <div className="field" style={{ marginBottom: 0 }}>
            <label>العنوان</label>
            <textarea className="input" value={form.address} onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))} />
          </div>
          <button className="btn btn--primary btn--lg" style={{ marginTop: 16 }} disabled={busy} type="submit">
            {busy ? <Spinner /> : 'حفظ التعديلات'}
          </button>
        </form>

        <form className="card" style={{ padding: 16, marginTop: 12 }} onSubmit={changePw}>
          <button type="button" className="btn btn--ghost btn--sm" onClick={() => setPwOpen((v) => !v)}>
            {pwOpen ? 'إخفاء' : 'تغيير كلمة المرور'}
          </button>
          {pwOpen && (
            <div>
              <div className="field">
                <label>كلمة المرور الحالية</label>
                <input className="input" dir="ltr" type="password" value={pw.current_password} onChange={(e) => setPw((p) => ({ ...p, current_password: e.target.value }))} />
              </div>
              <div className="field" style={{ marginBottom: 0 }}>
                <label>كلمة المرور الجديدة</label>
                <input className="input" dir="ltr" type="password" value={pw.new_password} onChange={(e) => setPw((p) => ({ ...p, new_password: e.target.value }))} />
              </div>
              <button className="btn btn--primary btn--lg" style={{ marginTop: 16 }} disabled={pwBusy} type="submit">
                {pwBusy ? <Spinner /> : 'تغيير'}
              </button>
            </div>
          )}
        </form>
      </div>
      <Toast message={toast} onClose={() => setToast('')} />
    </div>
  );
}
