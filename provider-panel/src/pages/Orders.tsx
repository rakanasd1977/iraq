import { useEffect, useState } from 'react';
import { api } from '../api';
import { useToast, fmt, fmtDate, PageLoading, EmptyState, Modal, Badge, Field, ORDER_STATUS, Pagination } from '@rafidain/shared/ui';
import { CATALOGS } from '../catalog';
import { useAuth } from '../auth';

const NEXT_STATUS: Record<string, string[]> = {
  pending: ['confirmed', 'cancelled'],
  confirmed: ['in_progress', 'cancelled'],
  in_progress: ['completed', 'cancelled'],
  completed: ['cancelled'],
};

const EMPTY_FORM = { customer_name: '', customer_phone: '', customer_address: '', notes: '', items: [{ title: '', quantity: '1', unit_price: '' }] };

export default function Orders() {
  const { user } = useAuth();
  const [rows, setRows] = useState<any>(null);
  const [meta, setMeta] = useState<any>(null);
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState(() => new URLSearchParams(window.location.search).get('status') || '');
  const [q, setQ] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [selected, setSelected] = useState<any>(null);
  const [saving, setSaving] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const toast = useToast();

  const load = (pg = page) => {
    const p = new URLSearchParams();
    if (status) p.set('status', status);
    if (q) p.set('q', q);
    if (from) p.set('from', from);
    if (to) p.set('to', to);
    p.set('page', String(pg));
    p.set('limit', '20');
    const qs = p.toString();
    api.get(`/orders${qs ? '?' + qs : ''}`).then((r) => { setRows(r.data); setMeta(r.meta || null); }).catch((e) => toast.error(e.message));
  };
  useEffect(() => { load(); }, [page, status]);
  useEffect(() => { setPage(1); }, [status]);

  const search = () => { setPage(1); load(1); };

  const exportCsv = async () => {
    try {
      const p = new URLSearchParams();
      if (status) p.set('status', status);
      if (q) p.set('q', q);
      if (from) p.set('from', from);
      if (to) p.set('to', to);
      const qs = p.toString();
      const res = await fetch(`/api/orders/export${qs ? '?' + qs : ''}`, {
        credentials: 'include',
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.message || 'تعذر تصدير الطلبات');
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `orders-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast.success('تم تصدير طلباتك بنجاح');
    } catch (e: any) { toast.error(e.message); }
  };

  const view = async (o: any) => {
    try {
      const res = await api.get(`/orders/${o.id}`);
      setSelected(res.data);
    } catch (e: any) { toast.error(e.message); }
  };

  const changeStatus = async (next: any, reason = '') => {
    setSaving(true);
    try {
      const res = await api.put(`/orders/${selected.id}/status`, { status: next, reason });
      toast.success(next === 'confirmed' ? 'تم قبول الطلب واستقطاع العمولة من محفظتك' : 'تم تحديث حالة الطلب');
      setSelected(res.data);
      setRejectOpen(false);
      setRejectReason('');
      load();
    } catch (e: any) { toast.error(e.message); } finally { setSaving(false); }
  };

  const confirmOrder = () => {
    if (!window.confirm('بعد قبول الطلب تُستقطع عمولة المنصة والوكيل من محفظتك. متابعة؟')) return;
    changeStatus('confirmed');
  };

  const updateItem = (i: number, k: string, v: any) => setForm((f) => ({ ...f, items: f.items.map((it, idx) => (idx === i ? { ...it, [k]: v } : it)) }));
  const addItem = () => setForm((f) => ({ ...f, items: [...f.items, { title: '', quantity: '1', unit_price: '' }] }));
  const removeItem = (i: number) => setForm((f) => ({ ...f, items: f.items.length > 1 ? f.items.filter((_, idx) => idx !== i) : f.items }));

  const createOrder = async () => {
    const items = form.items
      .filter((it) => it.title.trim())
      .map((it) => ({ title: it.title.trim(), quantity: Number(it.quantity) || 1, unit_price: Number(it.unit_price) || 0 }));
    if (!form.customer_name.trim() || items.length === 0) {
      toast.error('يرجى إدخال اسم الزبون وإضافة بند واحد على الأقل');
      return;
    }
    setCreating(true);
    try {
      const res = await api.post('/orders', {
        provider_id: user.provider_id,
        customer_name: form.customer_name.trim(),
        customer_phone: form.customer_phone.trim() || undefined,
        customer_address: form.customer_address || undefined,
        notes: form.notes || undefined,
        items,
      });
      toast.success(`تم إنشاء الطلب ${res.data.order_number}`);
      setCreateOpen(false);
      setForm(EMPTY_FORM);
      load();
      view({ id: res.data.id });
    } catch (e: any) { toast.error(e.message); } finally { setCreating(false); }
  };

  if (!rows) return <PageLoading />;

  const cat = (CATALOGS as Record<string, any>)[user.service_type];

  return (
    <div>
      <div className="page-head">
        <div>
          <h2>الطلبات</h2>
          <p>طلبات زبائنك — المنصة وسيط فقط، التوصيل والتتبع مسؤوليتك أنت مباشرة</p>
        </div>
        <button className="btn btn-outline" onClick={exportCsv}>⬇ تصدير CSV</button>
        <button className="btn btn-primary" onClick={() => { setForm(EMPTY_FORM); setCreateOpen(true); }}>+ إنشاء طلب</button>
      </div>

      <div className="filters">
        <select value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">كل الحالات</option>
          <option value="pending">قيد الانتظار</option>
          <option value="confirmed">مؤكد</option>
          <option value="in_progress">قيد التنفيذ</option>
          <option value="completed">مكتمل</option>
          <option value="cancelled">ملغي</option>
        </select>
        <input placeholder="رقم الطلب أو الزبون أو الهاتف..." value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && search()} />
        <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} title="من تاريخ" />
        <input type="date" value={to} onChange={(e) => setTo(e.target.value)} title="إلى تاريخ" />
        <button className="btn btn-outline btn-sm" onClick={search}>بحث</button>
      </div>

      <div className="card">
        <div className="table-wrap">
          {rows.length === 0 ? <EmptyState text="لا توجد طلبات" icon="🧾" /> : (
            <table>
              <thead>
                <tr>
                  <th>رقم الطلب</th><th>الزبون</th><th>المبلغ (دينار)</th><th>عمولة المنصة (دينار)</th>
                  <th>صافي إيرادك (دينار)</th><th>الحالة</th><th>التاريخ</th><th>إجراءات</th>
                </tr>
              </thead>
              <tbody>
                 {rows.map((o: any) => (
                  <tr key={o.id}>
                    <td><span className="mono bold">{o.order_number}</span></td>
                    <td>{o.customer_name || o.customer_name_ref || '-'}<div className="muted" style={{ fontSize: 11 }}>{o.customer_phone}</div></td>
                    <td className="bold">{fmt(o.total_amount)}</td>
                    <td>{fmt(o.commission_amount)}</td>
                    <td className="bold" style={{ color: 'var(--success)' }}>{fmt(o.provider_amount)}</td>
                    <td><Badge status={o.status} map={ORDER_STATUS} /></td>
                    <td className="muted">{fmtDate(o.created_at)}</td>
                    <td><button className="btn btn-outline btn-sm" onClick={() => view(o)}>التفاصيل</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <Pagination meta={meta} page={page} onChange={setPage} />

      <Modal open={createOpen} title="إنشاء طلب بالنيابة عن زبون" onClose={() => setCreateOpen(false)} size="lg">
        <p className="muted mb-4">سجّل طلباً وردك عبر الهاتف باسم الزبون مباشرة — يُحتسب ضمن عمولات المنصة والوكيل.</p>
        <div className="form-grid">
          <Field label="اسم الزبون" required><input value={form.customer_name} onChange={(e) => setForm({ ...form, customer_name: e.target.value })} placeholder="زبون ليس بالضرورة لديه حساب" /></Field>
          <Field label="هاتف الزبون"><input value={form.customer_phone} onChange={(e) => setForm({ ...form, customer_phone: e.target.value })} placeholder="اختياري" /></Field>
          <Field label="العنوان"><input value={form.customer_address} onChange={(e) => setForm({ ...form, customer_address: e.target.value })} placeholder="اختياري" /></Field>
          <Field label="ملاحظات"><input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="اختياري" /></Field>
        </div>

        <div className="card-header mt-4"><h3>بنود الطلب</h3></div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>البند</th><th style={{ width: 90 }}>الكمية</th><th style={{ width: 130 }}>سعر الوحدة</th><th style={{ width: 130 }}>الإجمالي</th><th style={{ width: 50 }}></th></tr>
            </thead>
            <tbody>
              {form.items.map((it, i) => (
                <tr key={i}>
                  <td><input value={it.title} onChange={(e) => updateItem(i, 'title', e.target.value)} placeholder="وصف البند" /></td>
                  <td><input type="number" min="1" value={it.quantity} onChange={(e) => updateItem(i, 'quantity', e.target.value)} /></td>
                  <td><input type="number" min="0" value={it.unit_price} onChange={(e) => updateItem(i, 'unit_price', e.target.value)} /></td>
                  <td className="bold">{fmt((Number(it.quantity) || 0) * (Number(it.unit_price) || 0))}</td>
                  <td><button className="btn btn-danger btn-sm" onClick={() => removeItem(i)}>×</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex-between mt-4">
          <button className="btn btn-outline" onClick={addItem}>+ إضافة بند</button>
          <div className="flex">
            <button className="btn btn-outline" onClick={() => setCreateOpen(false)}>إلغاء</button>
            <button className="btn btn-primary" onClick={createOrder} disabled={creating}>{creating ? 'جاري الإنشاء...' : 'إنشاء الطلب'}</button>
          </div>
        </div>
      </Modal>

      <Modal open={!!selected} title={`الطلب ${selected?.order_number || ''}`} onClose={() => setSelected(null)} size="lg">
        {selected && (
          <>
            <div className="detail-grid mb-4">
              <div className="detail-item"><div className="k">الحالة</div><div className="v"><Badge status={selected.status} map={ORDER_STATUS} /></div></div>
              <div className="detail-item"><div className="k">الزبون</div><div className="v">{selected.customer_name || selected.customer_name_ref || '-'}<div className="muted">{selected.customer_phone}</div></div></div>
              <div className="detail-item"><div className="k">إجمالي المبلغ (دينار)</div><div className="v">{fmt(selected.total_amount)}</div></div>
              <div className="detail-item"><div className="k">عمولة المنصة والوكيل (دينار)</div><div className="v">{fmt(selected.commission_amount)}</div></div>
              <div className="detail-item"><div className="k">صافي إيرادك (دينار)</div><div className="v" style={{ color: 'var(--success)' }}>{fmt(selected.provider_amount)}</div></div>
              <div className="detail-item"><div className="k">تاريخ الإنشاء</div><div className="v">{fmtDate(selected.created_at)}</div></div>
              {selected.accepted_at && <div className="detail-item"><div className="k">تاريخ القبول</div><div className="v">{fmtDate(selected.accepted_at)}</div></div>}
              {selected.status === 'cancelled' && (
                <div className="detail-item" style={{ gridColumn: '1 / -1' }}>
                  <div className="k">سبب الرفض/الإلغاء</div>
                  <div className="v" style={{ color: 'var(--danger)' }}>{selected.reject_reason || 'بدون سبب'}</div>
                </div>
              )}
            </div>

            {selected.items_json && (
              <div className="card mb-4">
                <div className="card-header"><h3>بنود الطلب</h3></div>
                <div className="table-wrap">
                  <table>
                    <thead><tr><th>البند</th><th>الكمية</th><th>سعر الوحدة</th><th>الإجمالي</th></tr></thead>
                    <tbody>
                       {(JSON.parse(selected.items_json) || []).map((it: any, i: number) => (
                        <tr key={i}><td>{it.title}</td><td>{it.quantity}</td><td>{fmt(it.unit_price)}</td><td className="bold">{fmt(it.total)}</td></tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {selected.notes && (
              <div className="card mb-4">
                <div className="card-header"><h3>ملاحظات الزبون</h3></div>
                <div className="card-body">{selected.notes}</div>
              </div>
            )}

            {selected.booking && (
              <div className="card mb-4">
                <div className="card-header"><h3>📅 بيانات الحجز</h3></div>
                <div className="detail-grid">
                  <div className="detail-item"><div className="k">تاريخ الحجز</div><div className="v">{selected.booking.booking_date ? fmtDate(selected.booking.booking_date) : '-'}</div></div>
                  <div className="detail-item"><div className="k">الوصول</div><div className="v">{selected.booking.check_in ? fmtDate(selected.booking.check_in) : '-'}</div></div>
                  <div className="detail-item"><div className="k">المغادرة</div><div className="v">{selected.booking.check_out ? fmtDate(selected.booking.check_out) : '-'}</div></div>
                  <div className="detail-item"><div className="k">النزلاء/المقاعد</div><div className="v">{selected.booking.guests || '-'}</div></div>
                  {selected.booking.travel_date && <div className="detail-item"><div className="k">تاريخ السفر</div><div className="v">{fmtDate(selected.booking.travel_date)}</div></div>}
                  {selected.booking.passengers && <div className="detail-item"><div className="k">المسافرون</div><div className="v">{selected.booking.passengers}</div></div>}
                  {selected.booking.nights && <div className="detail-item"><div className="k">عدد الليالي</div><div className="v">{selected.booking.nights}</div></div>}
                  {selected.booking.title && <div className="detail-item"><div className="k">العنوان/الرحلة</div><div className="v">{selected.booking.title}</div></div>}
                </div>
              </div>
            )}

            <div className="card">
              <div className="card-header"><h3>تغيير حالة الطلب</h3></div>
              <div className="card-body flex wrap">
                {selected.status === 'pending' && (
                  <>
                    <button className="btn btn-success" disabled={saving} onClick={confirmOrder}>✓ قبول الطلب</button>
                    <button className="btn btn-danger" disabled={saving} onClick={() => { setRejectReason(''); setRejectOpen(true); }}>✗ رفض الطلب</button>
                    <span className="muted">قبول الطلب يستقطع عمولة المنصة والوكيل من محفظتك فوراً</span>
                  </>
                )}
                {(NEXT_STATUS[selected.status] || []).filter((s) => s !== 'confirmed' && s !== 'cancelled').map((s) => (
                  <button key={s} className="btn btn-outline" disabled={saving} onClick={() => changeStatus(s)}>تحويل إلى: {(ORDER_STATUS as Record<string, any>)[s].label}</button>
                ))}
                {selected.status !== 'pending' && (NEXT_STATUS[selected.status] || []).includes('cancelled') && (
                  <button className="btn btn-outline" disabled={saving} onClick={() => { setRejectReason(''); setRejectOpen(true); }}>إلغاء الطلب</button>
                )}
                {selected.status !== 'pending' && selected.status !== 'completed' && (NEXT_STATUS[selected.status] || []).length === 0 && (
                  <span className="muted">لا توجد انتقالات مسموحة من هذه الحالة</span>
                )}
              </div>
            </div>

            <Modal open={rejectOpen} title={selected.status === 'pending' ? 'رفض الطلب' : 'إلغاء الطلب'} onClose={() => setRejectOpen(false)}>
              <Field label={selected.status === 'pending' ? 'سبب الرفض (يظهر للزبون والوكيل والمسؤول)' : 'سبب الإلغاء'} required>
                <textarea rows={3} value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} placeholder="مثال: الكمية غير متوفرة" />
              </Field>
              {selected.status === 'pending' && <p className="muted">رفض الطلب يعيد أي مبلغ كان قد خُصم (لا يُخصم شيء للطلب غير المقبول).</p>}
              <div className="form-actions">
                <button className="btn btn-outline" onClick={() => setRejectOpen(false)}>تراجع</button>
                <button className="btn btn-danger" disabled={saving || !rejectReason.trim()} onClick={() => changeStatus('cancelled', rejectReason.trim())}>
                  {saving ? 'جارٍ الحفظ...' : selected.status === 'pending' ? 'رفض الطلب' : 'إلغاء الطلب'}
                </button>
              </div>
            </Modal>
          </>
        )}
      </Modal>
    </div>
  );
}
