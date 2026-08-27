import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useToast, fmt, PageLoading, EmptyState, Modal, Field, Confirm, Toggle, Badge, Pagination, VERIFY_STATUS } from '@rafidain/shared/ui';
import type { ProviderRow } from '../types';

const SORT_OPTIONS = [
  { value: '', label: 'الافتراضي' },
  { value: 'rating', label: '⭐ الأعلى تقييماً' },
  { value: 'orders', label: 'الأكثر طلباً' },
  { value: 'value', label: 'الأعلى قيمة طلبات' },
  { value: 'name', label: 'بالاسم' },
];

function RatingCell({ p }: { p: ProviderRow }) {
  if (!p.rating_count) return <span className="muted">—</span>;
  const low = p.rating_count > 0 && Number(p.rating) < 3;
  return (
    <span>
      <span className="rating-stars">{'★'.repeat(Math.round(Number(p.rating) || 0))}{'☆'.repeat(5 - Math.round(Number(p.rating) || 0))}</span>
      <div>
        <span className={low ? 'rating-low' : 'bold'}>{Number(p.rating).toFixed(1)}</span>
        <span className="rating-num"> ({fmt(p.rating_count)})</span>
        {low && <span className="badge badge-red" style={{ marginInlineStart: 4 }}>تقييم منخفض</span>}
      </div>
    </span>
  );
}

// مستندات الهوية لا تُقدَّم من /uploads عاماً؛ تُحمَّل هنا عبر مسار مصادق وتُعرض كصورة
function DocPreview({ providerId, field }: { providerId: number | string; field: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;
    fetch(`/api/providers/${providerId}/documents/${field}`, { credentials: 'include' })
      .then((r) => (r.ok ? r.blob() : Promise.reject(new Error('load failed'))))
      .then((blob) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      })
      .catch(() => { if (!cancelled) setError(true); });
    return () => { cancelled = true; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [providerId, field]);
  if (error) return <div className="muted">تعذر تحميل المستند</div>;
  if (!url) return <div className="muted">جاري التحميل...</div>;
  return <a href={url} target="_blank" rel="noreferrer"><img src={url} alt="مستند توثيق" className="doc-preview" /></a>;
}

const empty = {
  name_ar: '', name_en: '', email: '', phone: '', password: '',
  service_id: '', commission_rate: 5, address: '', description: '', website: '', is_verified: 1,
};

export default function Providers() {
  const [rows, setRows] = useState<ProviderRow[] | null>(null);
  const [meta, setMeta] = useState<any>(null);
  const [page, setPage] = useState(1);
  const [services, setServices] = useState<any[]>([]);
  const [filters, setFilters] = useState({ service_slug: '', q: '', sort: '' });
  const [modalOpen, setModalOpen] = useState(false);
  const [broadcastOpen, setBroadcastOpen] = useState(false);
  const [broadcastMsg, setBroadcastMsg] = useState('');
  const [sendingB, setSendingB] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [form, setForm] = useState<any>(empty);
  const [toDelete, setToDelete] = useState<any>(null);
  const [resetPw, setResetPw] = useState<any>(null);
  const [newPw, setNewPw] = useState('');
  const [genPw, setGenPw] = useState('');
  const [saving, setSaving] = useState(false);
  const [review, setReview] = useState<any>(null);
  const [reviewNote, setReviewNote] = useState('');
  const [reviewing, setReviewing] = useState(false);
  const toast = useToast();
  const navigate = useNavigate();

  const buildQuery = (pg = page) => {
    const p = new URLSearchParams();
    if (filters.service_slug) p.set('service_slug', filters.service_slug);
    if (filters.q) p.set('q', filters.q);
    if (filters.sort) p.set('sort', filters.sort);
    p.set('page', String(pg));
    p.set('limit', '20');
    return p.toString();
  };

  const load = (pg = page) => {
    const qs = buildQuery(pg);
    api.get(`/providers${qs ? '?' + qs : ''}`).then((r) => { setRows(r.data); setMeta(r.meta || null); }).catch((e) => toast.error(e.message));
  };

  const search = () => { setPage(1); load(1); };

  useEffect(() => { load(); }, [page]);

  useEffect(() => {
    api.get('/services').then((r) => setServices(r.data)).catch(() => {});
    load();
  }, []);

  const openCreate = () => { setEditing(null); setForm(empty); setModalOpen(true); };
  const openEdit = (p: ProviderRow) => {
    setEditing(p);
    setForm({
      name_ar: p.name_ar, name_en: p.name_en || '', email: p.email, phone: p.user_phone || '',
      password: '', service_id: p.service_id, commission_rate: p.commission_rate,
      address: p.address || '', description: p.description || '', website: p.website || '', is_verified: p.is_verified,
    });
    setModalOpen(true);
  };

  const save = async () => {
    setSaving(true);
    try {
      if (editing) {
        await api.put(`/providers/${editing.id}`, { ...form, password: undefined });
        toast.success('تم تحديث مزود الخدمة');
      } else {
        const res = await api.post('/providers', form);
        if (res.data.generated_password) { setGenPw(res.data.generated_password); return; }
        toast.success('تمت إضافة مزود الخدمة إلى محافظتك');
      }
      setModalOpen(false);
      load();
    } catch (e: any) { toast.error(e.message); } finally { setSaving(false); }
  };

  const toggle = async (p: ProviderRow) => {
    try {
      await api.post(`/providers/${p.id}/toggle`);
      toast.success(p.is_active ? 'تم إيقاف المزود' : 'تم تفعيل المزود');
      load();
    } catch (e: any) { toast.error(e.message); }
  };

  const openReview = (p: ProviderRow) => {
    setReview(p);
    setReviewNote(p.verification_note || '');
  };

  const decideReview = async (status: string) => {
    setReviewing(true);
    try {
      await api.post(`/providers/${review.id}/verify`, { status, note: reviewNote });
      toast.success(status === 'approved' ? 'تم توثيق المزود' : status === 'rejected' ? 'تم رفض التوثيق' : 'تم تحديث حالة التوثيق');
      setReview(null);
      load();
    } catch (e: any) { toast.error(e.message); } finally { setReviewing(false); }
  };

  const doDelete = async () => {
    try {
      const res = await api.del(`/providers/${toDelete.id}`);
      toast.success(res.data.message);
      setToDelete(null);
      load();
    } catch (e: any) { toast.error(e.message); }
  };

  const doReset = async () => {
    if (!newPw || newPw.length < 6) { toast.error('كلمة المرور يجب أن تكون 6 أحرف على الأقل'); return; }
    try {
      await api.post('/auth/reset-password', { user_id: resetPw.user_id, new_password: newPw });
      toast.success('تم إعادة تعيين كلمة المرور');
      setResetPw(null); setNewPw('');
    } catch (e: any) { toast.error(e.message); }
  };

  const sendBroadcast = async () => {
    if (!broadcastMsg.trim()) { toast.error('اكتب نص الرسالة أولاً'); return; }
    setSendingB(true);
    try {
      const res = await api.post('/agent/providers/broadcast', { message: broadcastMsg.trim() });
      toast.success(res.data.message);
      setBroadcastOpen(false);
      setBroadcastMsg('');
    } catch (e: any) { toast.error(e.message); } finally { setSendingB(false); }
  };

  if (!rows) return <PageLoading />;

  return (
    <div>
      <div className="page-head">
        <div>
          <h2>مزودو الخدمة في محافظتي</h2>
          <p>تتحكم بجميع مزودي الخدمة في محافظتك فقط — إضافة، تشغيل، إيقاف، توثيق، تعديل، حذف</p>
        </div>
        <div className="flex wrap">
          <button className="btn btn-outline" onClick={() => setBroadcastOpen(true)}>📢 إشعار جماعي للمزودين</button>
          <button className="btn btn-primary" onClick={openCreate}>+ إضافة مزود خدمة</button>
        </div>
      </div>

      <div className="filters">
        <input placeholder="بحث بالاسم أو البريد..." value={filters.q} onChange={(e) => setFilters({ ...filters, q: e.target.value })} onKeyDown={(e) => e.key === 'Enter' && search()} />
        <select value={filters.service_slug} onChange={(e) => setFilters({ ...filters, service_slug: e.target.value })}>
          <option value="">كل الخدمات</option>
          {services.map((s) => <option key={s.id} value={s.slug}>{s.icon} {s.name_ar}</option>)}
        </select>
        <select value={filters.sort} onChange={(e) => setFilters({ ...filters, sort: e.target.value })}>
          {SORT_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <button className="btn btn-outline btn-sm" onClick={search}>بحث</button>
      </div>

      <div className="card">
        <div className="table-wrap">
          {rows.length === 0 ? <EmptyState text="لا يوجد مزودو خدمة في محافظتك بعد" icon="🏪" /> : (
            <table>
              <thead>
                <tr>
                  <th>المزود</th><th>الخدمة</th><th>التقييم</th><th>العمولة %</th><th>الطلبات</th><th>التوثيق</th><th>نشط</th><th>إجراءات</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((p) => (
                  <tr key={p.id}>
                    <td>
                      <div className="bold">{p.name_ar}</div>
                      <div className="muted" style={{ fontSize: 12 }}>{p.email}</div>
                    </td>
                    <td><span className="badge badge-blue">{p.service_name_ar}</span></td>
                    <td><RatingCell p={p} /></td>
                    <td>%{p.commission_rate}</td>
                    <td>{fmt(p.orders_count)}</td>
                    <td>
                      <Badge status={p.verification_status || (p.is_verified ? 'approved' : 'none')} map={VERIFY_STATUS} />
                      {(p.verification_status === 'pending' || (p.national_id_image || p.residency_doc_image)) && (
                        <button className="btn btn-outline btn-sm mt-1" onClick={() => openReview(p)}>مراجعة</button>
                      )}
                    </td>
                    <td><Toggle checked={!!p.is_active} onChange={() => toggle(p)} /></td>
                    <td>
                      <div className="flex wrap">
                        <button className="btn btn-outline btn-sm" onClick={() => navigate(`/providers/${p.id}`)}>عرض</button>
                        <button className="btn btn-outline btn-sm" onClick={() => openEdit(p)}>تعديل</button>
                        <button className="btn btn-outline btn-sm" onClick={() => setResetPw(p)}>كلمة المرور</button>
                        <button className="btn btn-danger btn-sm" onClick={() => setToDelete(p)}>حذف</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <Pagination meta={meta} page={page} onChange={setPage} />

      <Modal open={modalOpen} title={editing ? 'تعديل مزود خدمة' : 'إضافة مزود خدمة'} onClose={() => setModalOpen(false)} size="lg">
        <div className="alert-info">المزود يُضاف تلقائياً إلى محافظتك: <strong>{rows?.[0]?.governorate_name_ar || 'محافظتك'}</strong></div>
        <div className="form-grid">
          <Field label="الاسم (عربي)" required><input value={form.name_ar} onChange={(e) => setForm({ ...form, name_ar: e.target.value })} /></Field>
          <Field label="الاسم (إنجليزي)"><input value={form.name_en} onChange={(e) => setForm({ ...form, name_en: e.target.value })} /></Field>
          <Field label="البريد الإلكتروني" required><input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field>
          <Field label="رقم الهاتف"><input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></Field>
          <Field label="نوع الخدمة" required>
            <select value={form.service_id} onChange={(e) => setForm({ ...form, service_id: e.target.value })}>
              <option value="">اختر الخدمة...</option>
              {services.map((s) => <option key={s.id} value={s.id}>{s.icon} {s.name_ar}</option>)}
            </select>
          </Field>
          <Field label="نسبة عمولة المنصة (%)"><input type="number" step="0.5" value={form.commission_rate} onChange={(e) => setForm({ ...form, commission_rate: e.target.value })} /></Field>
          {!editing && <Field label="كلمة المرور" required><input type="text" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} placeholder="اتركها فارغة لتوليد تلقائي" /></Field>}
          <Field label="الموقع / العنوان"><input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} /></Field>
          <Field label="الموقع الإلكتروني"><input value={form.website} onChange={(e) => setForm({ ...form, website: e.target.value })} /></Field>
          <Field label="الوصف"><textarea rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field>
        </div>
        {genPw && <div className="alert-success mt-3">تمت الإضافة. كلمة المرور المؤقتة: <strong className="mono">{genPw}</strong></div>}
        <div className="form-actions">
          <button className="btn btn-outline" onClick={() => setModalOpen(false)}>إلغاء</button>
          <button className="btn btn-primary" onClick={save} disabled={saving}>{saving ? 'جاري الحفظ...' : 'حفظ'}</button>
        </div>
      </Modal>

      <Modal open={!!review} title={`مراجعة توثيق - ${review?.name_ar || ''}`} onClose={() => setReview(null)} size="lg">
        {review && (
          <>
            <div className="alert-info mb-3">
              الحالة الحالية: <Badge status={review.verification_status || (review.is_verified ? 'approved' : 'none')} map={VERIFY_STATUS} />
              {review.submitted_at && <span className="muted"> — قُدم في {fmt(review.submitted_at)}</span>}
            </div>
            <div className="form-grid">
              <Field label="البطاقة الوطنية">
                {review.national_id_image ? (
                  <DocPreview providerId={review.id} field="national_id" />
                ) : <div className="muted">لم تُرفع</div>}
              </Field>
              <Field label="تأييد السكن">
                {review.residency_doc_image ? (
                  <DocPreview providerId={review.id} field="residency" />
                ) : <div className="muted">لم يُرفع</div>}
              </Field>
            </div>
            <Field label="ملاحظة المراجعة (تظهر للمزود)"><textarea rows={2} value={reviewNote} onChange={(e) => setReviewNote(e.target.value)} placeholder="مثال: الصورة غير واضحة، أعد رفعها" /></Field>
            <div className="flex gap-sm mt-3">
              <button className="btn btn-success" disabled={reviewing} onClick={() => decideReview('approved')}>✓ قبول التوثيق</button>
              <button className="btn btn-danger" disabled={reviewing} onClick={() => decideReview('rejected')}>✕ رفض</button>
              <button className="btn btn-outline" disabled={reviewing} onClick={() => decideReview('none')}>إلغاء التوثيق</button>
              <button className="btn btn-outline" onClick={() => setReview(null)}>إغلاق</button>
            </div>
          </>
        )}
      </Modal>

      <Modal open={!!resetPw} title={`إعادة تعيين كلمة المرور - ${resetPw?.name_ar || ''}`} onClose={() => setResetPw(null)}>
        <Field label="كلمة المرور الجديدة" required><input type="text" value={newPw} onChange={(e) => setNewPw(e.target.value)} placeholder="6 أحرف على الأقل" /></Field>
        <div className="form-actions">
          <button className="btn btn-outline" onClick={() => setResetPw(null)}>إلغاء</button>
          <button className="btn btn-primary" onClick={doReset}>إعادة التعيين</button>
        </div>
      </Modal>

      <Confirm open={!!toDelete} title="حذف مزود خدمة" message={`هل أنت متأكد من حذف ${toDelete?.name_ar} من محافظتك؟ إذا كان لديه طلبات سيتم إيقافه بدلاً من الحذف.`} danger onConfirm={doDelete} onCancel={() => setToDelete(null)} />

      <Modal open={broadcastOpen} title="📢 إرسال إشعار جماعي لمزودي محافظتك" onClose={() => setBroadcastOpen(false)}>
        <div className="alert-info mb-3">سيُرسل الإشعار فوراً إلى جميع المزودين النشطين في محافظتك (يصل إلى تطبيق المزود ومركز الإشعارات).</div>
        <Field label="نص الرسالة" required hint={`الحد الأقصى 600 حرف — متبقي ${600 - broadcastMsg.length}`}>
          <textarea rows={4} value={broadcastMsg} onChange={(e) => setBroadcastMsg(e.target.value.slice(0, 600))} placeholder="مثال: اجتماع دوري لمزودي المحافظة يوم الخميس القادم..." />
        </Field>
        <div className="form-actions">
          <button className="btn btn-outline" onClick={() => setBroadcastOpen(false)}>إلغاء</button>
          <button className="btn btn-primary" onClick={sendBroadcast} disabled={sendingB}>{sendingB ? 'جاري الإرسال...' : 'إرسال الإشعار'}</button>
        </div>
      </Modal>
    </div>
  );
}
