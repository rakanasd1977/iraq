import { useEffect, useState } from 'react';
import { api } from '../api';
import { useToast, fmt, PageLoading, EmptyState, Modal, Field, Confirm, Toggle } from '@rafidain/shared/ui';

const empty = { slug: '', name_ar: '', name_en: '', description: '', icon: '', sort_order: 0, commission_rate: '' };

export default function Services() {
  const [rows, setRows] = useState<any>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [form, setForm] = useState<any>(empty);
  const [toDelete, setToDelete] = useState<any>(null);
  const [saving, setSaving] = useState(false);
  const toast = useToast();

  const load = () => api.get('/services').then((r) => setRows(r.data)).catch((e) => toast.error(e.message));
  useEffect(() => { load(); }, []);

  const openCreate = () => { setEditing(null); setForm(empty); setModalOpen(true); };
  const openEdit = (s: any) => { setEditing(s); setForm({ slug: s.slug, name_ar: s.name_ar, name_en: s.name_en, description: s.description || '', icon: s.icon || '', sort_order: s.sort_order, commission_rate: s.commission_rate ?? '' }); setModalOpen(true); };

  const save = async () => {
    setSaving(true);
    try {
      if (editing) {
        await api.put(`/services/${editing.id}`, form);
        toast.success('تم تحديث الخدمة');
      } else {
        await api.post('/services', form);
        toast.success('تمت إضافة الخدمة');
      }
      setModalOpen(false);
      load();
    } catch (e: any) { toast.error(e.message); } finally { setSaving(false); }
  };

  const toggle = async (s: any) => {
    try {
      await api.post(`/services/${s.id}/toggle`);
      toast.success(s.is_active ? 'تم إيقاف الخدمة' : 'تم تفعيل الخدمة');
      load();
    } catch (e: any) { toast.error(e.message); }
  };

  const doDelete = async () => {
    try {
      await api.del(`/services/${toDelete.id}`);
      toast.success('تم حذف الخدمة');
      setToDelete(null);
      load();
    } catch (e: any) { toast.error(e.message); }
  };

  if (!rows) return <PageLoading />;

  return (
    <div>
      <div className="page-head">
        <div>
          <h2>الخدمات</h2>
          <p>الخدمات الخمس التي تعمل بها المنصة عبر مزودي الخدمة — التحكم بتشغيل وإيقاف كل خدمة</p>
        </div>
        <button className="btn btn-primary" onClick={openCreate}>+ إضافة خدمة</button>
      </div>

      <div className="card">
        <div className="table-wrap">
          {rows.length === 0 ? <EmptyState text="لا توجد خدمات" /> : (
            <table>
              <thead>
                <tr><th>الخدمة</th><th>الرمز</th><th>الوصف</th><th>عدد المزودين</th><th>نسبة العمولة</th><th>الحالة</th><th>إجراءات</th></tr>
              </thead>
              <tbody>
                {rows.map((s: any) => (
                  <tr key={s.id}>
                    <td>
                      <div className="flex">
                        <span style={{ fontSize: 22 }}>{s.icon}</span>
                        <div>
                          <div className="bold">{s.name_ar}</div>
                          <div className="muted" style={{ fontSize: 12 }}>{s.name_en}</div>
                        </div>
                      </div>
                    </td>
                    <td><span className="mono">{s.slug}</span></td>
                    <td className="muted">{s.description}</td>
                    <td><span className="badge badge-teal">{fmt(s.providers_count)}</span></td>
                    <td>{s.commission_rate != null ? <span className="badge badge-amber">{s.commission_rate}%</span> : <span className="muted">افتراضي</span>}</td>
                    <td><Toggle checked={!!s.is_active} onChange={() => toggle(s)} /></td>
                    <td>
                      <div className="flex">
                        <button className="btn btn-outline btn-sm" onClick={() => openEdit(s)}>تعديل</button>
                        <button className="btn btn-danger btn-sm" onClick={() => setToDelete(s)}>حذف</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <Modal open={modalOpen} title={editing ? 'تعديل خدمة' : 'إضافة خدمة'} onClose={() => setModalOpen(false)}>
        <div className="form-grid">
          <Field label="الاسم (عربي)" required><input value={form.name_ar} onChange={(e) => setForm({ ...form, name_ar: e.target.value })} /></Field>
          <Field label="الاسم (إنجليزي)" required><input value={form.name_en} onChange={(e) => setForm({ ...form, name_en: e.target.value })} /></Field>
          <Field label="الرمز (slug)" required><input value={form.slug} onChange={(e) => setForm({ ...form, slug: e.target.value })} placeholder="مثال: stores" /></Field>
          <Field label="الأيقونة"><input value={form.icon} onChange={(e) => setForm({ ...form, icon: e.target.value })} placeholder="مثال: 🏪" /></Field>
          <Field label="الوصف"><input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field>
          <Field label="ترتيب العرض"><input type="number" value={form.sort_order} onChange={(e) => setForm({ ...form, sort_order: e.target.value })} /></Field>
          <Field label="نسبة عمولة الخدمة (%)" hint="اتركها فارغة لاستخدام الافتراضي العام للمنصة"><input type="number" step="0.5" min="0" max="100" value={form.commission_rate} onChange={(e) => setForm({ ...form, commission_rate: e.target.value })} placeholder="5" /></Field>
        </div>
        <div className="form-actions">
          <button className="btn btn-outline" onClick={() => setModalOpen(false)}>إلغاء</button>
          <button className="btn btn-primary" onClick={save} disabled={saving}>{saving ? 'جاري الحفظ...' : 'حفظ'}</button>
        </div>
      </Modal>

      <Confirm open={!!toDelete} title="حذف خدمة" message={`هل أنت متأكد من حذف خدمة ${toDelete?.name_ar}؟`} danger onConfirm={doDelete} onCancel={() => setToDelete(null)} />
    </div>
  );
}
