import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useToast, fmt, PageLoading, EmptyState, Modal, Field, Confirm, Toggle, Badge, LEASE_STATUS } from '@rafidain/shared/ui';

const empty = { name_ar: '', name_en: '', code: '', lease_fee: 0, sort_order: 0 };

export default function Governorates() {
  const [rows, setRows] = useState<any>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [form, setForm] = useState<any>(empty);
  const [toDelete, setToDelete] = useState<any>(null);
  const [saving, setSaving] = useState(false);
  const toast = useToast();
  const navigate = useNavigate();

  const load = () => api.get('/governorates').then((r) => setRows(r.data)).catch((e) => toast.error(e.message));
  useEffect(() => { load(); }, []);

  const openCreate = () => { setEditing(null); setForm(empty); setModalOpen(true); };
  const openEdit = (g: any) => { setEditing(g); setForm({ name_ar: g.name_ar, name_en: g.name_en, code: g.code, lease_fee: g.lease_fee, sort_order: g.sort_order }); setModalOpen(true); };

  const save = async () => {
    setSaving(true);
    try {
      if (editing) {
        await api.put(`/governorates/${editing.id}`, form);
        toast.success('تم تحديث المحافظة بنجاح');
      } else {
        await api.post('/governorates', form);
        toast.success('تمت إضافة المحافظة بنجاح');
      }
      setModalOpen(false);
      load();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (g: any) => {
    try {
      await api.post(`/governorates/${g.id}/toggle`);
      toast.success(g.is_active ? 'تم إيقاف المحافظة' : 'تم تفعيل المحافظة');
      load();
    } catch (e: any) { toast.error(e.message); }
  };

  const doDelete = async () => {
    try {
      await api.del(`/governorates/${toDelete.id}`);
      toast.success('تم حذف المحافظة');
      setToDelete(null);
      load();
    } catch (e: any) { toast.error(e.message); }
  };

  if (!rows) return <PageLoading />;

  return (
    <div>
      <div className="page-head">
        <div>
          <h2>المحافظات</h2>
          <p>إدارة المحافظات الثمانية عشرة وتحديد رسوم إجارة الوكالة السنوية لكل محافظة</p>
        </div>
        <button className="btn btn-primary" onClick={openCreate}>+ إضافة محافظة</button>
      </div>

      <div className="card">
        <div className="table-wrap">
          {rows.length === 0 ? <EmptyState text="لا توجد محافظات" /> : (
            <table>
              <thead>
                <tr>
                  <th>#</th><th>المحافظة</th><th>الرمز</th><th>رسوم الإجارة السنوية (دينار)</th>
                  <th>الحالة</th><th>الوكيل المعيّن</th><th>مزودو الخدمة</th><th>إجراءات</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((g: any, i: any) => (
                  <tr key={g.id}>
                    <td className="muted">{i + 1}</td>
                    <td><span className="bold">{g.name_ar}</span> <span className="muted">({g.name_en})</span></td>
                    <td><span className="mono">{g.code}</span></td>
                    <td>{fmt(g.lease_fee)}</td>
                    <td><Toggle checked={!!g.is_active} onChange={() => toggleActive(g)} /></td>
                    <td>
                      {g.agent ? (
                        <div className="flex" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                          <div>
                            <button
                              className="link-btn"
                              onClick={() => navigate('/agents')}
                              title="إدارة الوكلاء"
                            >{g.agent.agent_name}</button>
                            <div className="muted" style={{ fontSize: 12 }}>{g.agent.agent_email}</div>
                          </div>
                          <Badge status={g.agent.lease_status} map={LEASE_STATUS} />
                          {!g.agent.agent_active && <Badge status="deactivated" map={{ deactivated: { label: 'موقوف', cls: 'badge-red' } }} />}
                        </div>
                      ) : (
                        <span className="muted">لا يوجد وكيل</span>
                      )}
                      <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
                        <button className="link-btn" onClick={() => navigate('/agents')}>إدارة الوكلاء ←</button>
                      </div>
                    </td>
                    <td>{fmt(g.providers_count ?? 0)}</td>
                    <td>
                      <div className="flex">
                        <button className="btn btn-outline btn-sm" onClick={() => openEdit(g)}>تعديل</button>
                        <button className="btn btn-danger btn-sm" onClick={() => setToDelete(g)}>حذف</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <Modal open={modalOpen} title={editing ? 'تعديل محافظة' : 'إضافة محافظة'} onClose={() => setModalOpen(false)}>
        <div className="form-grid">
          <Field label="اسم المحافظة (عربي)" required><input value={form.name_ar} onChange={(e) => setForm({ ...form, name_ar: e.target.value })} /></Field>
          <Field label="اسم المحافظة (إنجليزي)" required><input value={form.name_en} onChange={(e) => setForm({ ...form, name_en: e.target.value })} /></Field>
          <Field label="الرمز" required><input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} placeholder="مثال: BAG" /></Field>
          <Field label="رسوم الإجارة السنوية (دينار)"><input type="number" value={form.lease_fee} onChange={(e) => setForm({ ...form, lease_fee: e.target.value })} /></Field>
          <Field label="ترتيب العرض"><input type="number" value={form.sort_order} onChange={(e) => setForm({ ...form, sort_order: e.target.value })} /></Field>
        </div>
        <div className="form-actions">
          <button className="btn btn-outline" onClick={() => setModalOpen(false)}>إلغاء</button>
          <button className="btn btn-primary" onClick={save} disabled={saving}>{saving ? 'جاري الحفظ...' : 'حفظ'}</button>
        </div>
      </Modal>

      <Confirm
        open={!!toDelete}
        title="حذف محافظة"
        message={`هل أنت متأكد من حذف محافظة ${toDelete?.name_ar}؟ لا يمكن الحذف إذا كانت مرتبطة بوكلاء أو مزودي خدمة.`}
        danger
        onConfirm={doDelete}
        onCancel={() => setToDelete(null)}
      />
    </div>
  );
}
