import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { useAuth } from '../auth';
import { useToast, Field, PageLoading, TwoFactorManager, VERIFY_STATUS } from '@rafidain/shared/ui';
import { api } from '../api';
import { CATALOGS } from '../catalog';
import ImageUpload from '../components/ImageUpload';

export default function Profile() {
  const { user, reload } = useAuth();
  const toast = useToast();
  const [data, setData] = useState<any>(null);
  const [form, setForm] = useState<any>({});
  const [saving, setSaving] = useState(false);

  const [ver, setVer] = useState<any>(null);
  const [nationalId, setNationalId] = useState('');
  const [residency, setResidency] = useState('');
  const [docSaving, setDocSaving] = useState(false);

  const [current_password, setCurrent] = useState('');
  const [new_password, setNew] = useState('');
  const [confirm, setConfirm] = useState('');
  const [pwSaving, setPwSaving] = useState(false);

  useEffect(() => {
    api.get('/provider/profile').then((r) => {
      setData(r.data);
      const p = r.data.provider;
      const u = r.data.user || {};
      setForm({
        name_ar: p.name_ar || '',
        name_en: p.name_en || '',
        description: p.description || '',
        address: p.address || '',
        phone: p.phone || '',
        website: p.website || '',
        logo: p.logo || '',
        cover: p.cover || '',
        avatar: u.avatar || '',
      });
    }).catch((e) => toast.error(e.message));
    api.get('/provider/verification').then((r) => {
      setVer(r.data);
      setNationalId(r.data.national_id_image || '');
      setResidency(r.data.residency_doc_image || '');
    }).catch(() => {});
  }, []);

  if (!data) return <PageLoading />;

  const { provider: p, user: u } = data;
  const cat = (CATALOGS as Record<string, any>)[user.service_type];

  const save = async () => {
    setSaving(true);
    try {
      await api.put('/provider/profile', form);
      toast.success('تم حفظ بياناتك بنجاح');
      reload();
    } catch (e: any) { toast.error(e.message); } finally { setSaving(false); }
  };

  const changePw = async (e: FormEvent) => {
    e.preventDefault();
    if (new_password !== confirm) { toast.error('كلمتا المرور غير متطابقتين'); return; }
    setPwSaving(true);
    try {
      await api.post('/auth/change-password', { current_password, new_password });
      toast.success('تم تغيير كلمة المرور بنجاح');
      setCurrent(''); setNew(''); setConfirm('');
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setPwSaving(false);
    }
  };

  const set = (k: string, v: any) => setForm((f: any) => ({ ...f, [k]: v }));

  const submitDocs = async () => {
    if (!nationalId && !residency) { toast.error('ارفع صورة البطاقة الوطنية أو تأييد السكن على الأقل'); return; }
    setDocSaving(true);
    try {
      const r = await api.put('/provider/verification', { national_id_image: nationalId, residency_doc_image: residency });
      setVer({ ...ver, ...r.data });
      toast.success('تم إرسال مستندات التوثيق — أصبحت قيد المراجعة');
      reload();
    } catch (e: any) { toast.error(e.message); } finally { setDocSaving(false); }
  };

  const vs = ver ? ((VERIFY_STATUS as Record<string, any>)[ver.verification_status] || VERIFY_STATUS.none) : null;
  const canReview = ver && ver.verification_status === 'pending';
  const hasDocs = !!(nationalId || residency);

  return (
    <div>
      <div className="page-head">
        <div>
          <h2>ملفي الشخصي</h2>
          <p>بيانات نشاطك التي يراها الزبائن، وبيانات حسابك</p>
        </div>
      </div>

      <div className="card mb-4">
        <div className="card-body">
          <div className="detail-grid">
            <div className="detail-item"><div className="k">اسم النشاط</div><div className="v">{p.name_ar}</div></div>
            <div className="detail-item"><div className="k">نوع الخدمة</div><div className="v"><span className="badge badge-blue">{cat?.icon} {cat?.title}</span></div></div>
            <div className="detail-item"><div className="k">المحافظة</div><div className="v"><span className="badge badge-teal">{p.governorate_name_ar}</span></div></div>
            <div className="detail-item"><div className="k">نسبة عمولة المنصة</div><div className="v">%{p.commission_rate}</div></div>
            <div className="detail-item"><div className="k">التوثيق</div><div className="v">{vs ? <span className={`badge ${vs.cls}`}>{vs.label}</span> : (p.is_verified ? <span className="badge badge-green">موثق ✓</span> : <span className="badge badge-gray">غير موثق</span>)}</div></div>
            <div className="detail-item"><div className="k">التقييم</div><div className="v">{p.rating} / 5 ({p.rating_count} تقييم)</div></div>
            <div className="detail-item"><div className="k">البريد الإلكتروني</div><div className="v" dir="ltr">{u.email}</div></div>
          </div>
        </div>
      </div>

      <div className="grid grid-2 mb-4">
        <div className="card">
          <div className="card-header"><h3>بيانات النشاط (تظهر للزبائن)</h3></div>
          <div className="card-body">
            <Field label="اسم النشاط" required><input value={form.name_ar} onChange={(e) => set('name_ar', e.target.value)} /></Field>
            <Field label="الاسم بالإنجليزية"><input value={form.name_en} onChange={(e) => set('name_en', e.target.value)} dir="ltr" /></Field>
            <Field label="الوصف"><textarea rows={3} value={form.description} onChange={(e) => set('description', e.target.value)} /></Field>
            <Field label="العنوان"><input value={form.address} onChange={(e) => set('address', e.target.value)} /></Field>
            <Field label="رقم الهاتف"><input value={form.phone} onChange={(e) => set('phone', e.target.value)} dir="ltr" /></Field>
            <Field label="الموقع الإلكتروني"><input value={form.website} onChange={(e) => set('website', e.target.value)} dir="ltr" /></Field>
            <Field label="الشعار"><ImageUpload value={form.logo} onChange={(v) => set('logo', v)} hint="صورة شعار النشاط" /></Field>
            <Field label="صورة الغلاف"><ImageUpload value={form.cover} onChange={(v) => set('cover', v)} hint="صورة الغلاف الظاهرة في صفحة النشاط" /></Field>
            <Field label="الصورة الرمزية"><ImageUpload value={form.avatar} onChange={(v) => set('avatar', v)} hint="صورة حسابك الشخصية" /></Field>
            <button className="btn btn-primary" onClick={save} disabled={saving}>{saving ? 'جاري الحفظ...' : 'حفظ البيانات'}</button>
          </div>
        </div>

        <div className="card">
          <div className="card-header"><h3>تغيير كلمة المرور</h3></div>
          <div className="card-body">
            <form onSubmit={changePw}>
              <Field label="كلمة المرور الحالية" required><input type="password" value={current_password} onChange={(e) => setCurrent(e.target.value)} required /></Field>
              <Field label="كلمة المرور الجديدة" required><input type="password" value={new_password} onChange={(e) => setNew(e.target.value)} required /></Field>
              <Field label="تأكيد كلمة المرور الجديدة" required><input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required /></Field>
              <button className="btn btn-primary" disabled={pwSaving}>{pwSaving ? 'جاري الحفظ...' : 'تغيير كلمة المرور'}</button>
            </form>
          </div>
        </div>
      </div>

      <div className="card mb-4">
        <div className="card-header">
          <div className="flex items-center justify-between">
            <h3>المصادقة الثنائية (2FA)</h3>
          </div>
        </div>
        <div className="card-body">
          <TwoFactorManager api={api} enabled={!!u.totp_enabled} onChanged={reload} />
        </div>
      </div>

      <div className="card mb-4">
        <div className="card-header">
          <div className="flex items-center justify-between">
            <h3>توثيق الحساب (البطاقة الوطنية وتأييد السكن)</h3>
            {vs && <span className={`badge ${vs.cls}`}>{vs.label}</span>}
          </div>
        </div>
        <div className="card-body">
          {ver?.verification_status === 'rejected' && ver.verification_note && (
            <div className="alert-error mb-3">رفض التوثيق: {ver.verification_note}</div>
          )}
          <p className="muted mb-3">ارفع صورة البطاقة الوطنية وصورة تأييد السكن. يقرّها وكيل محافظتك ثم يُوثَّق حسابك. المستندات تُحفظ بسرية ولا تظهر للزبائن.</p>
          <div className="grid grid-2 mb-3">
            <div>
              <label className="muted mb-1" style={{ fontSize: 13, display: 'block' }}>البطاقة الوطنية</label>
              <ImageUpload value={nationalId} onChange={setNationalId} hint="صورة البطاقة الوطنية (وجه وظهر)" />
            </div>
            <div>
              <label className="muted mb-1" style={{ fontSize: 13, display: 'block' }}>تأييد السكن</label>
              <ImageUpload value={residency} onChange={setResidency} hint="صورة تأييد السكن" />
            </div>
          </div>
          <div className="flex gap-sm items-center">
            <button className="btn btn-primary" onClick={submitDocs} disabled={docSaving || !hasDocs}>{docSaving ? 'جاري الإرسال...' : canReview ? 'تحديث المستندات' : 'إرسال للمراجعة'}</button>
            {canReview && <span className="muted" style={{ fontSize: 13 }}>مستنداتك قيد المراجعة — إرسال تحديث يعيدها للمراجعة.</span>}
          </div>
        </div>
      </div>
    </div>
  );
}
