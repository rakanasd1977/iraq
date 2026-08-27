import { useEffect, useState } from 'react';
import { api } from '../api';
import { useToast, fmt, fmtDate, PageLoading, EmptyState, Confirm, Modal, Field, Pagination } from '@rafidain/shared/ui';

function toDateInput(s: any) {
  if (!s) return '';
  const d = new Date(s);
  if (isNaN(d.getTime())) return '';
  return d.toISOString().slice(0, 10);
}

export default function Leases() {
  const [rows, setRows] = useState<any>(null);
  const [meta, setMeta] = useState<any>(null);
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');
  const [agents, setAgents] = useState<any[]>([]);
  const [toApprove, setToApprove] = useState<any>(null);
  const [toReject, setToReject] = useState<any>(null);
  const [toCancel, setToCancel] = useState<any>(null);
  const [editing, setEditing] = useState<any>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<any>({});
  const [saving, setSaving] = useState(false);
  const toast = useToast();

  const load = (pg = page) => {
    const p = new URLSearchParams();
    if (status) p.set('status', status);
    p.set('page', String(pg));
    p.set('limit', '20');
    api.get(`/leases?${p}`).then((r) => { setRows(r.data); setMeta(r.meta || null); }).catch((e) => toast.error(e.message));
  };
  useEffect(() => { load(); }, [page]);
  useEffect(() => { setPage(1); }, [status]);
  useEffect(() => {
    api.get('/agents?limit=100').then((r) => setAgents(r.data || [])).catch(() => {});
  }, []);

  const doApprove = async () => {
    setSaving(true);
    try {
      const res = await api.post(`/leases/${toApprove.id}/approve`);
      toast.success(`تمت الموافقة على إجارة ${res.data.agent_name_ar || ''} حتى ${fmtDate(res.data.period_end)}`);
      setToApprove(null);
      load();
    } catch (e: any) { toast.error(e.message); } finally { setSaving(false); }
  };

  const doReject = async () => {
    setSaving(true);
    try {
      await api.post(`/leases/${toReject.id}/reject`, { reason: '' });
      toast.success('تم رفض طلب التجديد');
      setToReject(null);
      load();
    } catch (e: any) { toast.error(e.message); } finally { setSaving(false); }
  };

  const doCancel = async () => {
    setSaving(true);
    try {
      const reason = toCancel.status === 'paid' ? 'أُلغيت إجارة الوكالة من المسؤول' : 'أُلغي الطلب من المسؤول';
      const res = await api.post(`/leases/${toCancel.id}/cancel`, { reason });
      toast.success(toCancel.status === 'paid' ? `تم إلغاء إجارة ${res.data.agent_name_ar || ''} وإبطال الوكالة` : 'تم إلغاء طلب التجديد');
      setToCancel(null);
      load();
    } catch (e: any) { toast.error(e.message); } finally { setSaving(false); }
  };

  const openCreate = () => {
    setForm({ agent_id: '', amount: '', period_start: '', period_end: '', status: 'paid' });
    setCreating(true);
  };

  const openEdit = (p: any) => {
    setForm({ amount: p.amount, period_start: toDateInput(p.period_start), period_end: toDateInput(p.period_end) });
    setEditing(p);
  };

  const saveCreate = async () => {
    if (!form.agent_id) return toast.error('اختر الوكيل أولاً');
    if (!form.amount || Number(form.amount) < 0) return toast.error('أدخل مبلغاً صحيحاً');
    if (!form.period_start || !form.period_end) return toast.error('حدد بداية الفترة ونهايتها');
    setSaving(true);
    try {
      const res = await api.post('/leases', { ...form, amount: Number(form.amount) });
      toast.success(`تم إنشاء دفعة ${form.status === 'paid' ? 'مدفوعة' : 'قيد الانتظار'} لوكالة ${res.data.agent_name_ar || ''}`);
      setCreating(false);
      load();
    } catch (e: any) { toast.error(e.message); } finally { setSaving(false); }
  };

  const saveEdit = async () => {
    if (form.amount === undefined || Number(form.amount) < 0) return toast.error('أدخل مبلغاً صحيحاً');
    if (!form.period_start || !form.period_end) return toast.error('حدد بداية الفترة ونهايتها');
    setSaving(true);
    try {
      const res = await api.put(`/leases/${editing.id}`, { amount: Number(form.amount), period_start: form.period_start, period_end: form.period_end });
      toast.success(`تم تعديل إجارة ${res.data.agent_name_ar || ''} — النهاية: ${fmtDate(res.data.period_end)}`);
      setEditing(null);
      load();
    } catch (e: any) { toast.error(e.message); } finally { setSaving(false); }
  };

  if (!rows) return <PageLoading />;

  return (
    <div>
      <div className="page-head">
        <div>
          <h2>إجارات الوكالات</h2>
          <p>إدارة طلبات تجديد إجارة الوكالة السنوية لكل محافظة — المبلغ يحدده المسؤول حسب كل محافظة</p>
        </div>
        <button className="btn btn-primary" onClick={openCreate}>+ دفعة إجارة يدوية</button>
      </div>

      <div className="filters">
        <select value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">كل الحالات</option>
          <option value="pending">قيد الانتظار</option>
          <option value="paid">مدفوعة</option>
          <option value="rejected">مرفوضة</option>
          <option value="refunded">ملغاة / مستردة</option>
        </select>
      </div>

      <div className="card">
        <div className="table-wrap">
          {rows.length === 0 ? <EmptyState text="لا توجد دفعات إجارات" icon="📜" /> : (
            <table>
              <thead>
                <tr>
                  <th>الوكيل</th><th>المحافظة</th><th>المبلغ (دينار)</th><th>بداية الفترة</th><th>نهاية الفترة</th><th>الحالة</th><th>تاريخ الدفعة</th><th>إجراءات</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((p: any) => (
                  <tr key={p.id}>
                    <td>
                      <div className="bold">{p.agent_name_ar}</div>
                      <div className="muted" style={{ fontSize: 12 }}>{p.agent_email}</div>
                    </td>
                    <td><span className="badge badge-teal">{p.governorate_name_ar}</span></td>
                    <td className="bold">{fmt(p.amount)}</td>
                    <td className="muted">{fmtDate(p.period_start)}</td>
                    <td className="muted">{fmtDate(p.period_end)}</td>
                    <td>
                      {p.status === 'paid' && <span className="badge badge-green">مدفوعة</span>}
                      {p.status === 'pending' && <span className="badge badge-amber">قيد الانتظار</span>}
                      {p.status === 'rejected' && <span className="badge badge-red">مرفوضة</span>}
                      {p.status === 'refunded' && <span className="badge badge-gray">ملغاة / مستردة</span>}
                    </td>
                    <td className="muted">{p.paid_at ? fmtDate(p.paid_at) : '-'}</td>
                    <td>
                      {p.status === 'pending' && (
                        <div className="flex">
                          <button className="btn btn-success btn-sm" onClick={() => setToApprove(p)}>موافقة</button>
                          <button className="btn btn-danger btn-sm" onClick={() => setToReject(p)}>رفض</button>
                          <button className="btn btn-outline btn-sm" onClick={() => openEdit(p)}>تعديل</button>
                        </div>
                      )}
                      {p.status === 'paid' && (
                        <div className="flex">
                          <button className="btn btn-outline btn-sm" onClick={() => openEdit(p)}>تعديل</button>
                          <button className="btn btn-danger btn-sm" onClick={() => setToCancel(p)}>إلغاء الإجارة</button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <Pagination meta={meta} page={page} onChange={setPage} />

      <Confirm open={!!toApprove} title="الموافقة على تجديد الإجارة" message={`سيتم تفعيل إجارة وكالة ${toApprove?.governorate_name_ar} حتى ${fmtDate(toApprove?.period_end)}. المبلغ المدفوع: ${fmt(toApprove?.amount)} دينار.`} confirmText="موافقة" onConfirm={doApprove} onCancel={() => setToApprove(null)} />
      <Confirm open={!!toReject} title="رفض طلب التجديد" message={`سيتم رفض طلب تجديد إجارة ${toReject?.governorate_name_ar}.`} danger confirmText="رفض الطلب" onConfirm={doReject} onCancel={() => setToReject(null)} />
      <Confirm
        open={!!toCancel}
        title={toCancel?.status === 'paid' ? 'إلغاء الإجارة وإبطال الوكالة' : 'إلغاء طلب التجديد'}
        message={toCancel?.status === 'paid'
          ? `سيتم إلغاء إجارة وكالة ${toCancel?.governorate_name_ar} (حتى ${fmtDate(toCancel?.period_end)}) ووضع الوكالة كمنتهية، ولن يتمكن الوكيل من إدارة الطلبات حتى يتم تجديد إجارته.`
          : `سيتم إلغاء طلب التجديد قيد الانتظار الخاص بوكالة ${toCancel?.governorate_name_ar}.`}
        danger confirmText="نعم، إلغاء" onConfirm={doCancel} onCancel={() => setToCancel(null)}
      />

      <Modal open={creating} title="دفعة إجارة يدوية" onClose={() => setCreating(false)} size="lg">
        <div className="grid-2">
          <Field label="الوكيل" required>
            <select value={form.agent_id} onChange={(e) => setForm({ ...form, agent_id: e.target.value })}>
              <option value="">اختر الوكيل...</option>
              {agents.map((a) => (
                <option key={a.id} value={a.id}>{a.name_ar} — {a.governorate_name_ar}</option>
              ))}
            </select>
          </Field>
          <Field label="المبلغ (دينار)" required>
            <input type="number" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
          </Field>
          <Field label="بداية الفترة" required>
            <input type="date" value={form.period_start} onChange={(e) => setForm({ ...form, period_start: e.target.value })} />
          </Field>
          <Field label="نهاية الفترة (تاريخ التجديد)" required>
            <input type="date" value={form.period_end} onChange={(e) => setForm({ ...form, period_end: e.target.value })} />
          </Field>
          <Field label="الحالة">
            <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
              <option value="paid">مدفوعة — تفعيل فوري</option>
              <option value="pending">قيد الانتظار — بانتظار الموافقة</option>
            </select>
          </Field>
        </div>
        <div className="modal-footer" style={{ marginTop: 16 }}>
          <button className="btn btn-outline" onClick={() => setCreating(false)}>إلغاء</button>
          <button className="btn btn-primary" disabled={saving} onClick={saveCreate}>{saving ? 'جارٍ الحفظ...' : 'حفظ الدفعة'}</button>
        </div>
      </Modal>

      <Modal open={!!editing} title="تعديل دفعة الإجارة" onClose={() => setEditing(null)} size="lg">
        <div className="grid-2">
          <Field label="المبلغ (دينار)" required>
            <input type="number" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
          </Field>
          <Field label="بداية الفترة" required>
            <input type="date" value={form.period_start} onChange={(e) => setForm({ ...form, period_start: e.target.value })} />
          </Field>
          <Field label="نهاية الفترة (تاريخ التجديد)" required>
            <input type="date" value={form.period_end} onChange={(e) => setForm({ ...form, period_end: e.target.value })} />
          </Field>
        </div>
        <p className="muted" style={{ marginTop: 12 }}>
          {editing?.status === 'paid' ? 'سيتم تحديث تاريخ انتهاء إجارة الوكيل ليتزامن مع نهاية الفترة الجديدة مباشرة.' : 'يُحفظ التعديل، ويُفعَّل عند الموافقة.'}
        </p>
        <div className="modal-footer" style={{ marginTop: 16 }}>
          <button className="btn btn-outline" onClick={() => setEditing(null)}>إلغاء</button>
          <button className="btn btn-primary" disabled={saving} onClick={saveEdit}>{saving ? 'جارٍ الحفظ...' : 'حفظ التعديل'}</button>
        </div>
      </Modal>
    </div>
  );
}
