import { useEffect, useState } from 'react';
import { api } from '../api';
import { useToast, fmt, PageLoading, EmptyState, Modal, Field, Confirm, Toggle, Pagination } from '@rafidain/shared/ui';
import { useStaticLists } from '@rafidain/shared';

const empty = { name_ar: '', name_en: '', email: '', phone: '', password: '', governorate_id: '', address: '' };

export default function Customers() {
  const [rows, setRows] = useState<any>(null);
  const [meta, setMeta] = useState<any>(null);
  const [page, setPage] = useState(1);
  const { governorates, loading: listsLoading } = useStaticLists(api);
  const [q, setQ] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [form, setForm] = useState(empty);
  const [toDelete, setToDelete] = useState<any>(null);
  const [saving, setSaving] = useState(false);
  const toast = useToast();

  const load = (pg = page) => {
    const p = new URLSearchParams();
    if (q) p.set('q', q);
    p.set('page', String(pg));
    p.set('limit', '20');
    api.get(`/customers?${p}`).then((r) => { setRows(r.data); setMeta(r.meta || null); }).catch((e) => toast.error(e.message));
  };
  useEffect(() => { load(); }, [page]);

  const search = () => { setPage(1); load(1); };

  const openCreate = () => { setEditing(null); setForm(empty); setModalOpen(true); };
  const openEdit = (c: any) => {
    setEditing(c);
    setForm({ name_ar: c.name_ar, name_en: c.name_en || '', email: c.email, phone: c.phone || '', password: '', governorate_id: c.governorate_id || '', address: c.address || '' });
    setModalOpen(true);
  };

  const save = async () => {
    setSaving(true);
    try {
      if (editing) {
        await api.put(`/customers/${editing.id}`, { ...form, password: undefined });
        toast.success('تم تحديث الزبون');
      } else {
        await api.post('/customers', form);
        toast.success('تمت إضافة الزبون');
      }
      setModalOpen(false);
      load();
    } catch (e: any) { toast.error(e.message); } finally { setSaving(false); }
  };

  const toggle = async (c: any) => {
    try {
      await api.put(`/customers/${c.id}`, { is_active: c.user_active ? 0 : 1 });
      toast.success(c.user_active ? 'تم إيقاف الزبون' : 'تم تفعيل الزبون');
      load();
    } catch (e: any) { toast.error(e.message); }
  };

  const doDelete = async () => {
    try {
      const res = await api.del(`/customers/${toDelete.id}`);
      toast.success(res.data.message);
      setToDelete(null);
      load();
    } catch (e: any) { toast.error(e.message); }
  };

  if (!rows) return <PageLoading />;

  return (
    <div>
      <div className="page-head">
        <div>
          <h2>الزبائن</h2>
          <p>حسابات الزبائن المسجلة في تطبيق الزبون</p>
        </div>
        <button className="btn btn-primary" onClick={openCreate}>+ إضافة زبون</button>
      </div>

      <div className="filters">
        <input placeholder="بحث بالاسم أو البريد أو الهاتف..." value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && search()} />
        <button className="btn btn-outline btn-sm" onClick={search}>بحث</button>
      </div>

      <div className="card">
        <div className="table-wrap">
          {rows.length === 0 ? <EmptyState text="لا يوجد زبائن" icon="👥" /> : (
            <table>
              <thead>
                <tr>
                  <th>الزبون</th><th>رقم الهاتف</th><th>المحافظة</th><th>الطلبات</th><th>قيمة الطلبات</th><th>نشط</th><th>إجراءات</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((c: any) => (
                  <tr key={c.id}>
                    <td>
                      <div className="bold">{c.name_ar}</div>
                      <div className="muted" style={{ fontSize: 12 }}>{c.email}</div>
                    </td>
                    <td className="mono">{c.phone}</td>
                    <td><span className="badge badge-teal">{c.governorate_name_ar || '-'}</span></td>
                    <td>{fmt(c.orders_count)}</td>
                    <td>{fmt(c.total_value)}</td>
                    <td><Toggle checked={!!c.user_active} onChange={() => toggle(c)} /></td>
                    <td>
                      <div className="flex">
                        <button className="btn btn-outline btn-sm" onClick={() => openEdit(c)}>تعديل</button>
                        <button className="btn btn-danger btn-sm" onClick={() => setToDelete(c)}>حذف</button>
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

      <Modal open={modalOpen} title={editing ? 'تعديل زبون' : 'إضافة زبون'} onClose={() => setModalOpen(false)}>
        <div className="form-grid">
          <Field label="الاسم (عربي)" required><input value={form.name_ar} onChange={(e) => setForm({ ...form, name_ar: e.target.value })} /></Field>
          <Field label="الاسم (إنجليزي)"><input value={form.name_en} onChange={(e) => setForm({ ...form, name_en: e.target.value })} /></Field>
          <Field label="البريد الإلكتروني" required><input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field>
          <Field label="رقم الهاتف" required><input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></Field>
          <Field label="المحافظة">
            <select value={form.governorate_id} disabled={listsLoading} onChange={(e) => setForm({ ...form, governorate_id: e.target.value })}>
              <option value="">{listsLoading ? 'جارٍ التحميل...' : 'بدون محافظة'}</option>
              {governorates.map((g) => <option key={g.id} value={g.id}>{g.name_ar}</option>)}
            </select>
          </Field>
          <Field label="العنوان"><input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} /></Field>
          {!editing && <Field label="كلمة المرور" required><input type="text" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} /></Field>}
        </div>
        <div className="form-actions">
          <button className="btn btn-outline" onClick={() => setModalOpen(false)}>إلغاء</button>
          <button className="btn btn-primary" onClick={save} disabled={saving}>{saving ? 'جاري الحفظ...' : 'حفظ'}</button>
        </div>
      </Modal>

      <Confirm open={!!toDelete} title="حذف زبون" message={`هل أنت متأكد من حذف ${toDelete?.name_ar}؟ إذا كان لديه طلبات سيتم إيقافه بدلاً من الحذف.`} danger onConfirm={doDelete} onCancel={() => setToDelete(null)} />
    </div>
  );
}
