import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useToast, fmt, PageLoading, EmptyState, Modal, Field, Confirm, Toggle, Badge, LEASE_STATUS } from '@rafidain/shared/ui';

const empty = { name_ar: '', name_en: '', code: '', governorate_id: '', lease_fee: 0, sort_order: 0, lat: '', lng: '' };

export default function Districts() {
  const [rows, setRows] = useState<any>(null);
  const [governorates, setGovernorates] = useState<any>([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [form, setForm] = useState<any>(empty);
  const [toDelete, setToDelete] = useState<any>(null);
  const [saving, setSaving] = useState(false);
  const toast = useToast();
  const navigate = useNavigate();

  const load = () => {
    api.get('/districts').then((r) => setRows(r.data)).catch((e) => toast.error(e.message));
    api.get('/governorates').then((r) => setGovernorates(r.data)).catch(() => {});
  };
  useEffect(() => { load(); }, []);

  const openCreate = () => { setEditing(null); setForm(empty); setModalOpen(true); };
  const openEdit = (d: any) => {
    setEditing(d);
    setForm({
      name_ar: d.name_ar, name_en: d.name_en, code: d.code, governorate_id: d.governorate_id,
      lease_fee: d.lease_fee, sort_order: d.sort_order, lat: d.lat ?? '', lng: d.lng ?? '',
    });
    setModalOpen(true);
  };

  const save = async () => {
    setSaving(true);
    try {
      if (editing) {
        await api.put(`/districts/${editing.id}`, form);
        toast.success('تم تحديث القضاء بنجاح');
      } else {
        await api.post('/districts', form);
        toast.success('تمت إضافة القضاء بنجاح');
      }
      setModalOpen(false);
      load();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (d: any) => {
    try {
      await api.post(`/districts/${d.id}/toggle`);
      toast.success(d.is_active ? 'تم إيقاف القضاء' : 'تم تفعيل القضاء');
      load();
    } catch (e: any) { toast.error(e.message); }
  };

  const doDelete = async () => {
    try {
      await api.del(`/districts/${toDelete.id}`);
      toast.success('تم حذف القضاء');
      setToDelete(null);
      load();
    } catch (e: any) { toast.error(e.message); }
  };

  if (!rows) return <PageLoading />;

  return (
    <div>
      <div className="page-head">
        <div>
          <h2>الأقضية</h2>
          <p>إدارة أقضية المحافظات وتحديد رسوم إجارة وكالة القضاء السنوية (بنفس مواصفات المحافظات)</p>
        </div>
        <button className="btn btn-primary" onClick={openCreate}>+ إضافة قضاء</button>
      </div>

      <div className="card">
        <div className="table-wrap">
          {rows.length === 0 ? <EmptyState text="لا توجد أقضية" /> : (
            <table>
              <thead>
                <tr>
                  <th>#</th><th>القضاء</th><th>الرمز</th><th>المحافظة الأم</th>
                  <th>رسوم الإجارة السنوية (دينار)</th><th>الحالة</th><th>وكيل القضاء</th><th>إجراءات</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((d: any, i: any) => (
                  <tr key={d.id}>
                    <td className="muted">{i + 1}</td>
                    <td><span className="bold">{d.name_ar}</span> <span className="muted">({d.name_en})</span></td>
                    <td><span className="mono">{d.code}</span></td>
                    <td>{d.governorate_name_ar}</td>
                    <td>{fmt(d.lease_fee)}</td>
                    <td><Toggle checked={!!d.is_active} onChange={() => toggleActive(d)} /></td>
                    <td>
                      {d.agent ? (
                        <div className="flex" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                          <div>
                            <button className="link-btn" onClick={() => navigate('/agents')} title="إدارة الوكلاء">{d.agent.agent_name}</button>
                            <div className="muted" style={{ fontSize: 12 }}>{d.agent.agent_email}</div>
                          </div>
                          <Badge status={d.agent.lease_status} map={LEASE_STATUS} />
                          {!d.agent.agent_active && <Badge status="deactivated" map={{ deactivated: { label: 'موقوف', cls: 'badge-red' } }} />}
                        </div>
                      ) : (
                        <span className="muted">لا يوجد وكيل</span>
                      )}
                      <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
                        <button className="link-btn" onClick={() => navigate('/agents')}>إدارة الوكلاء ←</button>
                      </div>
                    </td>
                    <td>
                      <div className="flex">
                        <button className="btn btn-outline btn-sm" onClick={() => openEdit(d)}>تعديل</button>
                        <button className="btn btn-danger btn-sm" onClick={() => setToDelete(d)}>حذف</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <Modal open={modalOpen} title={editing ? 'تعديل قضاء' : 'إضافة قضاء'} onClose={() => setModalOpen(false)}>
        <div className="form-grid">
          <Field label="اسم القضاء (عربي)" required><input value={form.name_ar} onChange={(e) => setForm({ ...form, name_ar: e.target.value })} /></Field>
          <Field label="اسم القضاء (إنجليزي)" required><input value={form.name_en} onChange={(e) => setForm({ ...form, name_en: e.target.value })} /></Field>
          <Field label="الرمز" required><input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} placeholder="مثال: RUS" /></Field>
          <Field label="المحافظة الأم" required>
            <select value={form.governorate_id} onChange={(e) => setForm({ ...form, governorate_id: e.target.value })}>
              <option value="">اختر المحافظة...</option>
              {governorates.map((g: any) => <option key={g.id} value={g.id}>{g.name_ar}</option>)}
            </select>
          </Field>
          <Field label="رسوم الإجارة السنوية (دينار)"><input type="number" value={form.lease_fee} onChange={(e) => setForm({ ...form, lease_fee: e.target.value })} /></Field>
          <Field label="ترتيب العرض"><input type="number" value={form.sort_order} onChange={(e) => setForm({ ...form, sort_order: e.target.value })} /></Field>
          <Field label="خط العرض (lat)"><input type="number" step="0.0001" value={form.lat} onChange={(e) => setForm({ ...form, lat: e.target.value })} /></Field>
          <Field label="خط الطول (lng)"><input type="number" step="0.0001" value={form.lng} onChange={(e) => setForm({ ...form, lng: e.target.value })} /></Field>
        </div>
        <div className="form-actions">
          <button className="btn btn-outline" onClick={() => setModalOpen(false)}>إلغاء</button>
          <button className="btn btn-primary" onClick={save} disabled={saving}>{saving ? 'جاري الحفظ...' : 'حفظ'}</button>
        </div>
      </Modal>

      <Confirm
        open={!!toDelete}
        title="حذف قضاء"
        message={`هل أنت متأكد من حذف قضاء ${toDelete?.name_ar}؟ لا يمكن الحذف إذا كان مرتبطاً بوكيل.`}
        danger
        onConfirm={doDelete}
        onCancel={() => setToDelete(null)}
      />
    </div>
  );
}
