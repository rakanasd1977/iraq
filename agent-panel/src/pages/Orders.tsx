import { useEffect, useState } from 'react';
import { api } from '../api';
import { useAuth } from '../auth';
import { useToast, fmt, fmtDate, PageLoading, EmptyState, Modal, Badge, Field, ORDER_STATUS, Pagination } from '@rafidain/shared/ui';
import type { OrderRow, ProviderOption, OrderDetail, OrderItemJson, OrderHistoryEntry } from '../types';

// قبول الطلب (confirmed) يخصم العمولة من محفظة المزود، لذا يُترك للمزود أو المسؤول فقط — لا يظهر للوكيل
const NEXT_STATUS = {
  pending: ['cancelled'],
  confirmed: ['in_progress', 'cancelled'],
  in_progress: ['completed', 'cancelled'],
  completed: ['cancelled'],
};

const NEXT_STATUS_MAP = NEXT_STATUS as Record<string, string[]>;

export default function Orders() {
  const [rows, setRows] = useState<OrderRow[] | null>(null);
  const [meta, setMeta] = useState<any>(null);
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');
  const [provider, setProvider] = useState('');
  const [q, setQ] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [selected, setSelected] = useState<OrderDetail | null>(null);
  const [saving, setSaving] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [providers, setProviders] = useState<ProviderOption[]>([]);
  const [form, setForm] = useState({ provider_id: '', customer_name: '', customer_phone: '', address: '', notes: '', items: [{ title: '', quantity: '1', unit_price: '' }] });
  const { user } = useAuth();
  const toast = useToast();

  const load = (pg = page) => {
    const p = new URLSearchParams();
    if (status) p.set('status', status);
    if (provider) p.set('provider_id', provider);
    if (q) p.set('q', q);
    if (from) p.set('from', from);
    if (to) p.set('to', to);
    p.set('page', String(pg));
    p.set('limit', '20');
    const qs = p.toString();
    api.get(`/orders${qs ? '?' + qs : ''}`).then((r) => { setRows(r.data); setMeta(r.meta || null); }).catch((e) => toast.error(e.message));
  };
  useEffect(() => { load(); }, [page, status, provider]);
  useEffect(() => { setPage(1); }, [status, provider]);
  useEffect(() => {
    api.get('/providers?limit=100').then((r) => setProviders(r.data)).catch(() => setProviders([]));
  }, []);

  const search = () => { setPage(1); load(1); };

  const remindPending = async () => {
    try {
      const res = await api.post('/agent/orders/remind-pending');
      toast.success(res.data.message);
    } catch (e: any) { toast.error(e.message); }
  };

  const view = async (o: { id: number | string }) => {
    try {
      const res = await api.get(`/orders/${o.id}`);
      setSelected(res.data);
    } catch (e: any) { toast.error(e.message); }
  };

  const exportCsv = async () => {
    try {
      const p = new URLSearchParams();
      if (status) p.set('status', status);
      if (provider) p.set('provider_id', provider);
      if (q) p.set('q', q);
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
      toast.success('تم تصدير الطلبات بنجاح');
    } catch (e: any) { toast.error(e.message); }
  };

  const changeStatus = async (next: string) => {
    if (!selected) return;
    setSaving(true);
    try {
      const res = await api.put(`/orders/${selected.id}/status`, { status: next });
      toast.success('تم تحديث حالة الطلب');
      setSelected(res.data);
      load();
    } catch (e: any) { toast.error(e.message); } finally { setSaving(false); }
  };

  const openCreate = () => {
    setForm({ provider_id: '', customer_name: '', customer_phone: '', address: '', notes: '', items: [{ title: '', quantity: '1', unit_price: '' }] });
    setCreateOpen(true);
    api.get('/providers?limit=100').then((r) => setProviders(r.data)).catch(() => setProviders([]));
  };

  const updateItem = (i: number, k: string, v: string) => setForm((f) => ({ ...f, items: f.items.map((it, idx) => (idx === i ? { ...it, [k]: v } : it)) }));
  const addItem = () => setForm((f) => ({ ...f, items: [...f.items, { title: '', quantity: '1', unit_price: '' }] }));
  const removeItem = (i: number) => setForm((f) => ({ ...f, items: f.items.length > 1 ? f.items.filter((_, idx) => idx !== i) : f.items }));

  const createOrder = async () => {
    const items = form.items
      .filter((it) => it.title.trim())
      .map((it) => ({ title: it.title.trim(), quantity: Number(it.quantity) || 1, unit_price: Number(it.unit_price) || 0 }));
    if (!form.provider_id || !form.customer_name.trim() || items.length === 0) {
      toast.error('يرجى اختيار المزود وإدخال اسم الزبون وإضافة بند واحد على الأقل');
      return;
    }
    setCreating(true);
    try {
      const res = await api.post('/orders', {
        provider_id: Number(form.provider_id),
        customer_name: form.customer_name.trim(),
        customer_phone: form.customer_phone.trim() || undefined,
        customer_address: form.address || undefined,
        notes: form.notes || undefined,
        items,
      });
      toast.success(`تم إنشاء الطلب ${res.data.order_number}`);
      setCreateOpen(false);
      load();
      view({ id: res.data.id });
    } catch (e: any) { toast.error(e.message); } finally { setCreating(false); }
  };

  if (!rows) return <PageLoading />;

  return (
    <div>
      <div className="page-head">
        <div>
          <h2>طلبات محافظتي</h2>
          <p>جميع طلبات مزودي الخدمة في محافظتك — التوصيل وتتبع الطلبات مسؤولية المزود مباشرة</p>
        </div>
        <div className="flex wrap">
          <button className="btn btn-primary" onClick={openCreate}>+ إنشاء طلب</button>
          <button className="btn btn-outline" onClick={exportCsv}>⬇ تصدير CSV</button>
          <button className="btn btn-outline" onClick={remindPending} title="تذكير مزودي الطلبات المعلقة منذ أكثر من يومين">⏰ تذكير المعلقات</button>
        </div>
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
        <select value={provider} onChange={(e) => setProvider(e.target.value)}>
          <option value="">كل المزودين</option>
          {providers.filter((p) => p.governorate_id === user?.governorate_id).map((p) => <option key={p.id} value={p.id}>{p.name_ar}</option>)}
        </select>
        <input placeholder="رقم الطلب، الزبون، الهاتف، أو المزود..." value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && search()} />
        <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} title="من تاريخ" />
        <input type="date" value={to} onChange={(e) => setTo(e.target.value)} title="إلى تاريخ" />
        <button className="btn btn-outline btn-sm" onClick={search}>بحث</button>
      </div>

      <div className="card">
        <div className="table-wrap">
          {rows.length === 0 ? <EmptyState text="لا توجد طلبات في محافظتك" icon="🧾" /> : (
            <table>
              <thead>
                <tr>
                  <th>رقم الطلب</th><th>الزبون</th><th>المزود</th><th>الخدمة</th>
                  <th>المبلغ (دينار)</th><th>عمولتي (دينار)</th><th>الحالة</th><th>التاريخ</th><th>إجراءات</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((o) => (
                  <tr key={o.id}>
                    <td><span className="mono bold">{o.order_number}</span></td>
                    <td>{o.customer_name || o.customer_name_ref || '-'}<div className="muted" style={{ fontSize: 11 }}>{o.customer_phone}</div></td>
                    <td>{o.provider_name}</td>
                    <td><span className="badge badge-blue">{o.service_name_ar}</span></td>
                    <td className="bold">{fmt(o.total_amount)}</td>
                    <td>{fmt(o.agent_amount)}</td>
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

      <Modal open={createOpen} title="إنشاء طلب بالنيابة عن زبون (مكتب خلفي)" onClose={() => setCreateOpen(false)} size="lg">
        <p className="muted mb-4">المنصة وسيط فقط: تُنشئ الطلب باسم الزبون، والتوصيل مسؤولية مزود الخدمة. يقتصر الاختيار على مزودي محافظتك.</p>
        <div className="form-grid">
          <Field label="مزود الخدمة" required>
            <select value={form.provider_id} onChange={(e) => setForm({ ...form, provider_id: e.target.value })}>
              <option value="">اختر المزود...</option>
              {providers.filter((p) => p.governorate_id === user?.governorate_id).map((p) => <option key={p.id} value={p.id}>{p.name_ar} — {p.service_name_ar}</option>)}
            </select>
          </Field>
          <Field label="اسم الزبون" required><input value={form.customer_name} onChange={(e) => setForm({ ...form, customer_name: e.target.value })} placeholder="زبون ليس بالضرورة لديه حساب" /></Field>
          <Field label="هاتف الزبون"><input value={form.customer_phone} onChange={(e) => setForm({ ...form, customer_phone: e.target.value })} placeholder="اختياري" /></Field>
          <Field label="العنوان"><input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} placeholder="اختياري" /></Field>
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
              <div className="detail-item"><div className="k">مزود الخدمة</div><div className="v">{selected.provider_name}</div></div>
              <div className="detail-item"><div className="k">الزبون</div><div className="v">{selected.customer_name || selected.customer_name_ref || '-'}<div className="muted">{selected.customer_phone}</div></div></div>
              <div className="detail-item"><div className="k">الخدمة</div><div className="v">{selected.service_name_ar}</div></div>
              <div className="detail-item"><div className="k">إجمالي المبلغ (دينار)</div><div className="v">{fmt(selected.total_amount)}</div></div>
              <div className="detail-item"><div className="k">عمولتي (دينار)</div><div className="v">{fmt(selected.agent_amount)}</div></div>
              <div className="detail-item"><div className="k">عمولة المنصة (دينار)</div><div className="v">{fmt(selected.platform_amount)}</div></div>
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
                      {((JSON.parse(selected.items_json) as OrderItemJson[]) || []).map((it, i) => (
                        <tr key={i}><td>{it.title}</td><td>{it.quantity}</td><td>{fmt(it.unit_price)}</td><td className="bold">{fmt(it.total)}</td></tr>
                      ))}
                    </tbody>
                  </table>
                </div>
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

            {selected.history && selected.history.length > 0 && (
              <div className="card mb-4">
                <div className="card-header"><h3>🕐 سجل حالات الطلب</h3></div>
                <div className="card-body">
                  <div className="timeline">
                    {selected.history.map((h: OrderHistoryEntry, i: number) => {
                      const isLast = i === selected.history.length - 1;
                      return (
                        <div className="timeline__row" key={i}>
                          <div className="timeline__rail">
                            <span className={`timeline__dot${isLast ? ' timeline__dot--current' : ' timeline__dot--done'}`} />
                            {!isLast && <span className="timeline__line timeline__line--done" />}
                          </div>
                          <div className="timeline__body">
                            <div className={`timeline__label${isLast ? ' timeline__label--current' : ' timeline__label--done'}`}>
                              {(ORDER_STATUS[h.status] || {}).label || h.status}
                            </div>
                            <div className="timeline__date">{fmtDate(h.at)}</div>
                            {h.by_name && (
                              <div className="timeline__actor">
                                بواسطة: {h.by_name}{' '}
                                {h.by === 'agent' ? '(الوكيل)' : h.by === 'provider' ? '(المزود)' : h.by === 'customer' ? '(الزبون)' : h.by === 'admin' ? '(المسؤول)' : ''}
                              </div>
                            )}
                            {h.note && <div className="timeline__note" style={{ color: 'var(--danger)' }}>سبب الإلغاء: {h.note}</div>}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}

            <div className="card">
              <div className="card-header"><h3>تغيير حالة الطلب</h3></div>
              <div className="card-body flex wrap">
                {(NEXT_STATUS_MAP[selected.status] || []).map((s) => (
                  <button key={s} className="btn btn-outline" disabled={saving} onClick={() => changeStatus(s)}>تحويل إلى: {ORDER_STATUS[s].label}</button>
                ))}
                {(NEXT_STATUS_MAP[selected.status] || []).length === 0 && <span className="muted">لا توجد انتقالات مسموحة من هذه الحالة</span>}
              </div>
            </div>
          </>
        )}
      </Modal>
    </div>
  );
}
