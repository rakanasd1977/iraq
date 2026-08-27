import { useState } from 'react';
import { useAuth } from '../auth';
import { useToast, Field, TwoFactorManager } from '@rafidain/shared/ui';
import { api } from '../api';

export default function Profile() {
  const { user, reload } = useAuth();
  const toast = useToast();
  const [current_password, setCurrent] = useState('');
  const [new_password, setNew] = useState('');
  const [confirm, setConfirm] = useState('');
  const [saving, setSaving] = useState(false);

  const changePw = async (e: any) => {
    e.preventDefault();
    if (new_password !== confirm) { toast.error('كلمتا المرور غير متطابقتين'); return; }
    setSaving(true);
    try {
      await api.post('/auth/change-password', { current_password, new_password });
      toast.success('تم تغيير كلمة المرور بنجاح');
      setCurrent(''); setNew(''); setConfirm('');
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <div className="page-head">
        <div>
          <h2>ملفي الشخصي</h2>
          <p>بيانات حساب المسؤول</p>
        </div>
      </div>

      <div className="grid grid-2">
        <div className="card">
          <div className="card-header"><h3>بيانات الحساب</h3></div>
          <div className="card-body">
            <div className="detail-grid">
              <div className="detail-item"><div className="k">الاسم</div><div className="v">{user?.name_ar}</div></div>
              <div className="detail-item"><div className="k">البريد الإلكتروني</div><div className="v" dir="ltr">{user?.email}</div></div>
              <div className="detail-item"><div className="k">الدور</div><div className="v"><span className="badge badge-red">مسؤول المنصة</span></div></div>
              <div className="detail-item"><div className="k">الصلاحيات</div><div className="v">تحكم كامل بالمنصة</div></div>
            </div>
          </div>
        </div>

        <div className="card">
          <div className="card-header"><h3>تغيير كلمة المرور</h3></div>
          <div className="card-body">
            <form onSubmit={changePw}>
              <Field label="كلمة المرور الحالية" required>
                <input type="password" value={current_password} onChange={(e) => setCurrent(e.target.value)} required />
              </Field>
              <Field label="كلمة المرور الجديدة" required>
                <input type="password" value={new_password} onChange={(e) => setNew(e.target.value)} required />
              </Field>
              <Field label="تأكيد كلمة المرور الجديدة" required>
                <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
              </Field>
              <button className="btn btn-primary" disabled={saving}>{saving ? 'جاري الحفظ...' : 'تغيير كلمة المرور'}</button>
            </form>
          </div>
        </div>

        <div className="card">
          <div className="card-header"><h3>المصادقة الثنائية (2FA)</h3></div>
          <div className="card-body">
            <TwoFactorManager api={api} enabled={!!user?.totp_enabled} onChanged={() => reload()} />
          </div>
        </div>
      </div>
    </div>
  );
}
