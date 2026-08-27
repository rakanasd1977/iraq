import { useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import { useAuth } from '../auth';
import { useToast, PageLoading, EmptyState, Modal, Confirm, Field, Toggle, Badge } from '@rafidain/shared/ui';
import { CATEGORY_CONFIG, CATEGORY_FIELDS } from '../catalog';

export default function Categories() {
  const { user } = useAuth();
  const toast = useToast();
  const config = useMemo(() => (CATEGORY_CONFIG as Record<string, any>)[user.service_type], [user]);

  const [rows, setRows] = useState<any>(null);
  const [editing, setEditing] = useState<any>(null);
  const [form, setForm] = useState<Record<string, any>>({});
  const [confirmDel, setConfirmDel] = useState<any>(null);
  const [saving, setSaving] = useState(false);

  const load = () => {
    api.get(config.api).then((r) => setRows(r.data)).catch((e) => toast.error(e.message));
  };
  useEffect(() => { load(); }, [config]);

  const openAdd = () => {
    const init: Record<string, any> = {};
    CATEGORY_FIELDS.forEach((f) => { init[f.key] = f.type === 'checkbox' ? true : ''; });
    setEditing({ id: null });
    setForm(init);
  };

  const openEdit = (row: any) => {
    const init: Record<string, any> = {};
    CATEGORY_FIELDS.forEach((f) => { init[f.key] = f.type === 'checkbox' ? Boolean(row[f.key]) : (row[f.key] ?? ''); });
    setEditing({ id: row.id });
    setForm(init);
  };

  const save = async () => {
    setSaving(true);
    try {
      const payload: Record<string, any> = {};
      CATEGORY_FIELDS.forEach((f) => {
        let v = form[f.key];
        if (f.type === 'checkbox') v = v ? 1 : 0;
        if (f.type === 'number') v = v === '' ? undefined : Number(v);
        payload[f.key] = v;
      });
      if (editing.id) {
        await api.put(`${config.api}/${editing.id}`, payload);
        toast.success('تم تحديث القسم');
      } else {
        await api.post(config.api, payload);
        toast.success('تمت إضافة القسم');
      }
      setEditing(null);
      load();
    } catch (e: any) { toast.error(e.message); } finally { setSaving(false); }
  };

  const toggle = async (row: any) => {
    try {
      await api.post(`${config.api}/${row.id}/toggle`);
      load();
    } catch (e: any) { toast.error(e.message); }
  };

  const del = async () => {
    setSaving(true);
    try {
      await api.del(`${config.api}/${confirmDel.id}`);
      toast.success('تم حذف القسم');
      setConfirmDel(null);
      load();
    } catch (e: any) { toast.error(e.message); } finally { setSaving(false); }
  };

  if (!rows) return <PageLoading />;

  return (
    <div>
      <div className="page-head">
        <div>
          <h2>{config.title}</h2>
          <p>نظّم {config.title} لتسهيل تصفح زبائنك لفهرستك</p>
        </div>
        <button className="btn btn-primary" onClick={openAdd}>+ إضافة {config.item} جديد</button>
      </div>

      <div className="card">
        <div className="table-wrap">
          {rows.length === 0 ? <EmptyState text={`لا توجد ${config.title} بعد`} icon="🗂️" /> : (
            <table>
              <thead>
                <tr><th>القسم</th><th>بالإنجليزية</th><th>الأيقونة</th><th>الترتيب</th><th>الحالة</th><th>إجراءات</th></tr>
              </thead>
              <tbody>
                 {rows.map((row: any) => (
                  <tr key={row.id}>
                    <td className="bold">{row.name_ar}</td>
                    <td className="muted">{row.name_en || '-'}</td>
                    <td>{row.icon || '-'}</td>
                    <td>{row.sort_order ?? 0}</td>
                    <td><Badge status={row.is_active ? 'on' : 'off'} map={{ on: { label: 'مفعل', cls: 'badge-green' }, off: { label: 'معطل', cls: 'badge-gray' } }} /></td>
                    <td>
                      <div className="flex gap-sm">
                        <button className="btn btn-outline btn-sm" onClick={() => openEdit(row)}>تعديل</button>
                        <button className="btn btn-outline btn-sm" onClick={() => toggle(row)}>{row.is_active ? 'إيقاف' : 'تفعيل'}</button>
                        <button className="btn btn-outline btn-sm btn-danger-ghost" onClick={() => setConfirmDel(row)}>حذف</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <Modal open={!!editing} title={editing?.id ? 'تعديل قسم' : 'إضافة قسم جديد'} onClose={() => setEditing(null)}>
        <div className="grid grid-2">
          {CATEGORY_FIELDS.map((f) => (
            <Field key={f.key} label={f.label} required={f.required}>
              {f.type === 'checkbox'
                ? <Toggle checked={!!form[f.key]} onChange={(v) => setForm((s) => ({ ...s, [f.key]: v }))} />
                : f.type === 'number'
                  ? <input type="number" value={form[f.key] ?? ''} onChange={(e) => setForm((s) => ({ ...s, [f.key]: e.target.value }))} />
                  : <input value={form[f.key] ?? ''} onChange={(e) => setForm((s) => ({ ...s, [f.key]: e.target.value }))} />}
            </Field>
          ))}
        </div>
        <div className="flex gap-sm" style={{ justifyContent: 'flex-end', marginTop: 16 }}>
          <button className="btn btn-outline" onClick={() => setEditing(null)}>إلغاء</button>
          <button className="btn btn-primary" onClick={save} disabled={saving}>{saving ? 'جاري الحفظ...' : 'حفظ'}</button>
        </div>
      </Modal>

      <Confirm
        open={!!confirmDel}
        title="حذف قسم"
        message={`هل أنت متأكد من حذف قسم "${confirmDel?.name_ar || ''}"؟ ستبقى العناصر المرتبطة به بدون قسم.`}
        confirmText="حذف نهائي"
        danger
        onCancel={() => setConfirmDel(null)}
        onConfirm={del}
      />
    </div>
  );
}
