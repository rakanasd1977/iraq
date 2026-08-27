import { useEffect, useState } from 'react';
import { api } from '../api';
import { useToast, fmt, fmtDate, PageLoading, EmptyState, Modal, Confirm, Field, Badge, Toggle, Pagination, StatCard } from '@rafidain/shared/ui';

const STATUS_MAP = {
  active: { label: 'نشط', cls: 'badge-green' },
  inactive: { label: 'موقوف', cls: 'badge-gray' },
  expired: { label: 'منتهي', cls: 'badge-red' },
};

function discountText(c: any) {
  return c.discount_type === 'fixed' ? `${fmt(c.discount_value)} د.ع` : `${c.discount_value}%`;
}

function statusOf(c: any) {
  if (Number(c.is_active) !== 1) return 'inactive';
  if (c.ends_at && new Date(c.ends_at).getTime() < Date.now()) return 'expired';
  return 'active';
}

function toDateInput(s: any) {
  if (!s) return '';
  return String(s).slice(0, 10);
}

const empty = {
  code: '',
  title: '',
  discount_type: 'percent',
  discount_value: '',
  min_amount: '',
  max_uses: '',
  per_customer_limit: '1',
  ends_at: '',
  is_active: true,
};

export default function Coupons() {
  const toast = useToast();
  const [rows, setRows] = useState<any>(null);
  const [meta, setMeta] = useState<any>(null);
  const [page, setPage] = useState(1);
  const [form, setForm] = useState<Record<string, any>>(empty);
  const [editing, setEditing] = useState<any>(null);
  const [open, setOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<any>(null);
  const [busy, setBusy] = useState(false);

  const load = (pg = page) => {
    api.get(`/provider/coupons?page=${pg}&limit=20`)
      .then((r) => { setRows(r.data); setMeta(r.meta); })
      .catch((e) => toast.error(e.message));
  };

  useEffect(() => { load(); }, [page]);

  const totalUses = (rows || []).reduce((s: number, r: any) => s + Number(r.used_count || 0), 0);

  const openCreate = () => {
    const end = new Date(Date.now() + 30 * 86400000);
    setEditing(null);
    setForm({ ...empty, ends_at: toDateInput(end.toISOString()) });
    setOpen(true);
  };

  const openEdit = (row: any) => {
    setEditing(row);
    setForm({
      code: row.code,
      title: row.title || '',
      discount_type: row.discount_type,
      discount_value: String(row.discount_value),
      min_amount: row.min_amount ? String(row.min_amount) : '',
      max_uses: row.max_uses ? String(row.max_uses) : '',
      per_customer_limit: String(row.per_customer_limit),
      ends_at: toDateInput(row.ends_at),
      is_active: Number(row.is_active) === 1,
    });
    setOpen(true);
  };

  const set = (k: string, v: any) => setForm((f) => ({ ...f, [k]: v }));

  const save = async () => {
    if (!form.code.trim()) return toast.error('اكتب رمز الكوبون');
    if (!form.discount_value || Number(form.discount_value) <= 0) return toast.error('أدخل قيمة الخصم');
    if (form.discount_type === 'percent' && Number(form.discount_value) > 100) return toast.error('نسبة الخصم لا تتجاوز 100%');
    setBusy(true);
    try {
      const payload = {
        code: form.code.trim(),
        title: form.title.trim() || null,
        discount_type: form.discount_type,
        discount_value: Number(form.discount_value),
        min_amount: Number(form.min_amount) || 0,
        max_uses: form.max_uses ? Math.max(0, Number(form.max_uses)) : 0,
        per_customer_limit: Number(form.per_customer_limit) || 1,
        ends_at: form.ends_at || null,
        is_active: form.is_active ? 1 : 0,
      };
      if (editing) {
        await api.put(`/provider/coupons/${editing.id}`, payload);
        toast.success('تم تعديل الكوبون بنجاح');
      } else {
        await api.post('/provider/coupons', payload);
        toast.success('تم إنشاء الكوبون — سيظهر للزبائن فوراً');
      }
      setOpen(false);
      load();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  };

  const toggle = async (row: any) => {
    setBusy(true);
    try {
      await api.post(`/provider/coupons/${row.id}/toggle`);
      toast.success(Number(row.is_active) ? 'تم إيقاف الكوبون' : 'تم تفعيل الكوبون');
      load();
    } catch (e: any) { toast.error(e.message); } finally { setBusy(false); }
  };

  const remove = async () => {
    setBusy(true);
    try {
      await api.del(`/provider/coupons/${deleteTarget.id}`);
      toast.success('تم حذف الكوبون');
      setDeleteTarget(null);
      load();
    } catch (e: any) { toast.error(e.message); } finally { setBusy(false); }
  };

  if (!rows) return <PageLoading />;

  return (
    <div>
      <div className="page-head">
        <div>
          <h2>كوبونات الخصم</h2>
          <p>أنشئ كوبونات خصم لمتجرك — تظهر للزبائن في صفحة «كوبونات للتحصيل» بتطبيق الزبون ويُخصم الخصم من إيرادك</p>
        </div>
        <button className="btn btn-primary" onClick={openCreate}>+ إنشاء كوبون</button>
      </div>

      <div className="grid grid-3 mb-4">
        <StatCard label="إجمالي الكوبونات" value={fmt(meta?.total ?? 0)} icon="🎟️" tone="primary" />
          <StatCard label="كوبونات نشطة" value={fmt((rows || []).filter((r: any) => statusOf(r) === 'active').length)} icon="✅" tone="success" />
        <StatCard label="مرات الاستخدام" value={fmt(totalUses)} icon="🧾" tone="info" />
      </div>

      <div className="card">
        <div className="table-wrap">
          {rows.length === 0 ? <EmptyState text="لا توجد كوبونات بعد — اضغط زر «إنشاء كوبون»" icon="🎟️" /> : (
            <table>
              <thead>
                <tr>
                  <th>الكود</th>
                  <th>العنوان</th>
                  <th>الخصم</th>
                  <th>الحد الأدنى</th>
                  <th>الانتهاء</th>
                  <th>الاستخدام</th>
                  <th>الحالة</th>
                  <th>إجراءات</th>
                </tr>
              </thead>
              <tbody>
                 {rows.map((row: any) => (
                  <tr key={row.id}>
                    <td>
                      <code className="coup-code">{row.code}</code>
                    </td>
                    <td>
                      <div className="bold">{row.title || '-'}</div>
                    </td>
                    <td className="bold" style={{ color: 'var(--danger)' }}>{discountText(row)}</td>
                    <td>{row.min_amount > 0 ? `${fmt(row.min_amount)} د.ع` : 'بدون'}</td>
                    <td style={{ fontSize: 13 }}>{row.ends_at ? fmtDate(row.ends_at) : 'بدون انتهاء'}</td>
                    <td>{fmt(row.used_count)}</td>
                    <td>
                      <Badge status={statusOf(row)} map={STATUS_MAP} />
                    </td>
                    <td>
                      <div className="flex gap-sm">
                        <button className="btn btn-outline btn-sm" onClick={() => openEdit(row)}>تعديل</button>
                        <button className="btn btn-outline btn-sm" onClick={() => toggle(row)} disabled={busy}>
                          {Number(row.is_active) ? 'إيقاف' : 'تفعيل'}
                        </button>
                        {Number(row.used_count) === 0 && (
                          <button className="btn btn-outline btn-sm btn-danger-ghost" onClick={() => setDeleteTarget(row)}>حذف</button>
                        )}
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

      <Modal open={open} title={editing ? 'تعديل الكوبون' : 'إنشاء كوبون خصم'} onClose={() => setOpen(false)} size="lg">
        <div className="alert-info mb-4">
          🎟️ الكوبون يخص متجرك فقط ويظهر للزبائن في صفحة «كوبونات للتحصيل». حد الخصم بحد أقصى 50% أو 100,000 دينار (حسب إعدادات المنصة)، والخصم يُقتطع من إيرادك.
        </div>
        <div className="grid grid-2">
          <Field label="رمز الكوبون" required hint="يُكتب عند إتمام الطلب — أحرف وأرقام، مثال: SAVE10">
            <input value={form.code} onChange={(e) => set('code', e.target.value.toUpperCase().replace(/\s+/g, '-'))} dir="ltr" maxLength={40} placeholder="SAVE10" />
          </Field>
          <Field label="العنوان الظاهر للزبون" hint="اختياري — يظهر فوق البطاقة">
            <input value={form.title} onChange={(e) => set('title', e.target.value)} maxLength={100} placeholder="خصم 10% على كل الطلبات" />
          </Field>
        </div>
        <div className="grid grid-2">
          <Field label="نوع الخصم" required>
            <select value={form.discount_type} onChange={(e) => set('discount_type', e.target.value)}>
              <option value="percent">نسبة مئوية (%)</option>
              <option value="fixed">مبلغ ثابت (دينار)</option>
            </select>
          </Field>
          <Field label={form.discount_type === 'percent' ? 'قيمة الخصم (%)' : 'قيمة الخصم (دينار)'} required>
            <input type="number" min="1" value={form.discount_value} onChange={(e) => set('discount_value', e.target.value)} placeholder={form.discount_type === 'percent' ? '10' : '5000'} />
          </Field>
        </div>
        <div className="grid grid-2">
          <Field label="الحد الأدنى للطلب" hint="بدون حد = 0">
            <input type="number" min="0" value={form.min_amount} onChange={(e) => set('min_amount', e.target.value)} placeholder="0" />
          </Field>
          <Field label="تاريخ الانتهاء" hint="اتركه فارغاً ليبقى بلا انتهاء">
            <input type="date" value={form.ends_at} onChange={(e) => set('ends_at', e.target.value)} />
          </Field>
        </div>
        <div className="grid grid-2">
          <Field label="الحد الأقصى للاستخدام" hint="0 = غير محدود">
            <input type="number" min="0" value={form.max_uses} onChange={(e) => set('max_uses', e.target.value)} placeholder="0" />
          </Field>
          <Field label="الحد لكل زبون" hint="كم مرة يستخدمها نفس الزبون">
            <input type="number" min="1" value={form.per_customer_limit} onChange={(e) => set('per_customer_limit', e.target.value)} />
          </Field>
        </div>
        <div className="flex gap-sm" style={{ alignItems: 'center', marginTop: 6 }}>
          <Toggle checked={form.is_active} onChange={(v) => set('is_active', v)} />
          <span className="muted" style={{ fontSize: 13 }}>الكوبون نشط ويظهر للزبائن</span>
        </div>
        <div className="flex gap-sm" style={{ justifyContent: 'flex-end', marginTop: 16 }}>
          <button className="btn btn-outline" onClick={() => setOpen(false)}>إلغاء</button>
          <button className="btn btn-primary" onClick={save} disabled={busy}>{busy ? 'جاري الحفظ...' : (editing ? 'حفظ التعديلات' : 'إنشاء الكوبون')}</button>
        </div>
      </Modal>

      <Confirm
        open={!!deleteTarget}
        title="حذف الكوبون"
        message={`حذف كوبون "${deleteTarget?.code}" نهائياً؟ لا يمكن التراجع بعد الحذف.`}
        confirmText="حذف"
        danger
        onCancel={() => setDeleteTarget(null)}
        onConfirm={remove}
      />
    </div>
  );
}
