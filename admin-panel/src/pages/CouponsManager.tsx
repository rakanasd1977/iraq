import { useEffect, useState } from 'react';
import { api } from '../api';
import { useToast, fmt, fmtDate, PageLoading, EmptyState, Modal, Field, Confirm, Toggle, Pagination } from '@rafidain/shared/ui';

const empty = {
  code: '', title: '', discount_type: 'percent', discount_value: '', min_amount: '',
  provider_id: '', starts_at: '', ends_at: '', max_uses: '', per_customer_limit: '1', is_active: 1,
};

export default function CouponsManager() {
  const [rows, setRows] = useState<any>(null);
  const [meta, setMeta] = useState<any>(null);
  const [page, setPage] = useState(1);
  const [q, setQ] = useState('');
  const [providerId, setProviderId] = useState('');
  const [active, setActive] = useState('');
  const [providers, setProviders] = useState<any[]>([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [form, setForm] = useState<any>(empty);
  const [saving, setSaving] = useState(false);
  const [toDelete, setToDelete] = useState<any>(null);
  const toast = useToast();

  useEffect(() => {
    api.get('/providers?limit=300').then((r) => setProviders((r.data && r.data.rows) || [])).catch(() => {});
  }, []);

  const load = (pg = page) => {
    const p = new URLSearchParams();
    if (q) p.set('q', q);
    if (providerId) p.set('provider_id', providerId);
    if (active) p.set('active', active);
    p.set('page', String(pg));
    p.set('limit', '20');
    api.get(`/coupons?${p}`).then((r) => { setRows(r.data.rows); setMeta(r.data.meta || null); }).catch((e) => toast.error(e.message));
  };
  useEffect(() => { setPage(1); load(1); }, [providerId, active]);
  useEffect(() => { load(); }, [page]);

  const search = () => { setPage(1); load(1); };

  const openCreate = () => { setEditing(null); setForm(empty); setModalOpen(true); };
  const openEdit = (c: any) => {
    setEditing(c);
    setForm({
      code: c.code, title: c.title || '', discount_type: c.discount_type, discount_value: c.discount_value,
      min_amount: c.min_amount || '', provider_id: c.provider_id ? String(c.provider_id) : '',
      starts_at: (c.starts_at || '').slice(0, 10), ends_at: (c.ends_at || '').slice(0, 10),
      max_uses: c.max_uses || '', per_customer_limit: c.per_customer_limit || '1', is_active: c.is_active,
    });
    setModalOpen(true);
  };

  const save = async () => {
    setSaving(true);
    try {
      const payload: any = {
        code: form.code, title: form.title, discount_type: form.discount_type,
        discount_value: form.discount_value === '' ? undefined : Number(form.discount_value),
        min_amount: form.min_amount === '' ? 0 : Number(form.min_amount),
        provider_id: form.provider_id ? Number(form.provider_id) : null,
        starts_at: form.starts_at || null, ends_at: form.ends_at || null,
        max_uses: form.max_uses === '' ? 0 : Number(form.max_uses),
        per_customer_limit: form.per_customer_limit ? Number(form.per_customer_limit) : 1,
        is_active: form.is_active ? 1 : 0,
      };
      if (editing) {
        await api.put(`/coupons/${editing.id}`, payload);
        toast.success('تم تحديث الكوبون');
      } else {
        await api.post('/coupons', payload);
        toast.success('تم إنشاء الكوبون');
      }
      setModalOpen(false);
      load();
    } catch (e: any) { toast.error(e.message); } finally { setSaving(false); }
  };

  const toggle = async (c: any) => {
    try { await api.post(`/coupons/${c.id}/toggle`); toast.success(c.is_active ? 'تم إيقاف الكوبون' : 'تم تفعيل الكوبون'); load(); }
    catch (e: any) { toast.error(e.message); }
  };

  const doDelete = async () => {
    try { const res = await api.del(`/coupons/${toDelete.id}`); toast.success(res.data.message); setToDelete(null); load(); }
    catch (e: any) { toast.error(e.message); }
  };

  return (
    <div>
      <div className="page-head">
        <div>
          <h2>الكوبونات المركزية</h2>
          <p>أنشئ وصرّح الكوبونات العامة أو الخاصة بمزود، وتحكّم بصلاحيتها</p>
        </div>
        <button className="btn btn-primary" onClick={openCreate}>+ كوبون جديد</button>
      </div>

      <div className="filters">
        <input placeholder="بحث بالكود أو العنوان..." value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && search()} />
        <select value={providerId} onChange={(e) => setProviderId(e.target.value)}>
          <option value="">كل المزودين (وشامل)</option>
          {providers.map((p) => <option key={p.id} value={p.id}>{p.name_ar}</option>)}
        </select>
        <select value={active} onChange={(e) => setActive(e.target.value)}>
          <option value="">كل الحالات</option>
          <option value="1">مفعّل</option>
          <option value="0">متوقف</option>
        </select>
        <button className="btn btn-outline btn-sm" onClick={search}>بحث</button>
      </div>

      {!rows ? <PageLoading /> : (
        <div className="card">
          <div className="table-wrap">
            {rows.length === 0 ? <EmptyState text="لا توجد كوبونات" icon="🎟️" /> : (
              <table>
                <thead>
                  <tr><th>الكود</th><th>العنوان</th><th>النوع</th><th>القيمة</th><th>الحد الأدنى</th><th>المزود</th><th>الاستخدام</th><th>مفعل</th><th>إجراءات</th></tr>
                </thead>
                <tbody>
                  {rows.map((c: any) => (
                    <tr key={c.id}>
                      <td className="mono bold">{c.code}</td>
                      <td>{c.title || '-'}</td>
                      <td>{c.discount_type === 'percent' ? 'نسبة %' : 'مبلغ ثابت'}</td>
                      <td className="mono">{c.discount_type === 'percent' ? c.discount_value + '%' : fmt(c.discount_value)}</td>
                      <td className="mono">{c.min_amount ? fmt(c.min_amount) : '-'}</td>
                      <td>{c.provider_name || 'شامل'}</td>
                      <td>{c.used_count}{c.max_uses ? ' / ' + c.max_uses : ''}</td>
                      <td><Toggle checked={!!Number(c.is_active)} onChange={() => toggle(c)} /></td>
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
      )}

      <Pagination meta={meta} page={page} onChange={setPage} />

      <Modal open={modalOpen} title={editing ? 'تعديل كوبون' : 'كوبون جديد'} onClose={() => setModalOpen(false)}>
        <div className="form-grid">
          <Field label="الكود" required><input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })} /></Field>
          <Field label="العنوان"><input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></Field>
          <Field label="نوع الخصم" required>
            <select value={form.discount_type} onChange={(e) => setForm({ ...form, discount_type: e.target.value })}>
              <option value="percent">نسبة مئوية (%)</option>
              <option value="fixed">مبلغ ثابت (دينار)</option>
            </select>
          </Field>
          <Field label="قيمة الخصم" required><input type="number" value={form.discount_value} onChange={(e) => setForm({ ...form, discount_value: e.target.value })} /></Field>
          <Field label="الحد الأدنى للطلب"><input type="number" value={form.min_amount} onChange={(e) => setForm({ ...form, min_amount: e.target.value })} /></Field>
          <Field label="المزود (شامل إن تُرك فارغاً)">
            <select value={form.provider_id} onChange={(e) => setForm({ ...form, provider_id: e.target.value })}>
              <option value="">شامل (كل المزودين)</option>
              {providers.map((p) => <option key={p.id} value={p.id}>{p.name_ar}</option>)}
            </select>
          </Field>
          <Field label="تاريخ البداية"><input type="date" value={form.starts_at} onChange={(e) => setForm({ ...form, starts_at: e.target.value })} /></Field>
          <Field label="تاريخ الانتهاء"><input type="date" value={form.ends_at} onChange={(e) => setForm({ ...form, ends_at: e.target.value })} /></Field>
          <Field label="الحد الأقصى للاستخدامات (0=غير محدود)"><input type="number" value={form.max_uses} onChange={(e) => setForm({ ...form, max_uses: e.target.value })} /></Field>
          <Field label="الحد لكل زبون"><input type="number" value={form.per_customer_limit} onChange={(e) => setForm({ ...form, per_customer_limit: e.target.value })} /></Field>
          <Field label="مفعّل"><Toggle checked={!!form.is_active} onChange={(v: boolean) => setForm({ ...form, is_active: v ? 1 : 0 })} /></Field>
        </div>
        <div className="form-actions">
          <button className="btn btn-outline" onClick={() => setModalOpen(false)}>إلغاء</button>
          <button className="btn btn-primary" onClick={save} disabled={saving}>{saving ? 'جاري الحفظ...' : 'حفظ'}</button>
        </div>
      </Modal>

      <Confirm open={!!toDelete} title="حذف كوبون" message={`هل أنت متأكد من حذف الكوبون ${toDelete?.code}؟`} danger onConfirm={doDelete} onCancel={() => setToDelete(null)} />
    </div>
  );
}
