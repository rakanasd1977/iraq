import { useEffect, useState } from 'react';
import { api } from '../api';
import { useToast, fmt, fmtDate, PageLoading, EmptyState, Modal, Field, Badge, RECHARGE_STATUS } from '@rafidain/shared/ui';
import ImageUpload from '../components/ImageUpload';

const PAYMENT_METHODS = [
  { id: 'zain_cash', label: 'زين كاش', hint: 'Zain Cash', icon: '📱' },
  { id: 'asia_pay', label: 'آسيا باي', hint: 'Asia Pay', icon: '💳' },
  { id: 'first_iraqi_bank', label: 'مصرف العراق الأول', hint: 'First Iraqi Bank', icon: '🏦' },
  { id: 'al_ahli_bank', label: 'المصرف الأهلي', hint: 'Al-Ahli Bank', icon: '🏦' },
];

const TX_LABELS = {
  recharge: { label: 'شحن رصيد', cls: 'green' },
  commission: { label: 'استقطاع عمولة (الوكيل + المنصة)', cls: 'amber' },
  refund: { label: 'رد عمولة', cls: 'blue' },
};

const EMPTY_FORM = { amount: '', method: '', note: '' };

export default function Wallet() {
  const [data, setData] = useState<any>(null);
  const [requests, setRequests] = useState<any>(null);
  const [paymentInfo, setPaymentInfo] = useState<any>(null);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [proof, setProof] = useState<any>(null);
  const [saving, setSaving] = useState(false);
  const toast = useToast();

  const load = () => {
    api.get('/wallets/provider').then((r) => setData(r.data)).catch((e) => toast.error(e.message));
    api.get('/recharges/provider').then((r) => setRequests(r.data)).catch(() => {});
    api.get('/public/payment-info').then((r) => setPaymentInfo(r.data)).catch(() => {});
  };
  useEffect(() => { load(); }, []);

  const selectedMethod = paymentInfo?.methods?.[form.method];

  const submit = async () => {
    const amount = Number(form.amount);
    if (!form.method) return toast.error('اختر طريقة الدفع أولاً');
    if (!form.amount || !Number.isFinite(amount) || amount <= 0) return toast.error('أدخل مبلغ شحن صحيحاً أكبر من صفر');
    if (!proof) return toast.error('أرفق لقطة شاشة لعملية الإرسال كإثبات');
    setSaving(true);
    try {
      const res = await api.post('/recharges', {
        amount,
        payment_method: form.method,
        note: form.note || undefined,
        proof_image: proof,
      });
      toast.success(`تم إرسال طلب الشحن ${res.data.reference} — بانتظار مراجعة المسؤول`);
      setOpen(false);
      setForm(EMPTY_FORM);
      setProof(null);
      load();
    } catch (e: any) { toast.error(e.message); } finally { setSaving(false); }
  };

  if (!data || !requests) return <PageLoading />;

  const txs = data.transactions || [];

  return (
    <div>
      <div className="page-head">
        <div>
          <h2>محفظتي الداخلية</h2>
          <p>اشحن رصيدك مسبقاً لتغطية عمولات المنصة والوكيل، وتُستقطع تلقائياً عند قبول أي طلب.</p>
        </div>
        <button className="btn btn-primary" onClick={() => { setForm(EMPTY_FORM); setProof(null); setOpen(true); }}>+ طلب شحن رصيد</button>
      </div>

      <div className="stats-grid">
        <div className="card stat-card">
          <div className="stat-label">رصيد المحفظة (دينار)</div>
          <div className="stat-value" style={{ color: Number(data.balance) > 0 ? 'var(--success)' : 'var(--danger)' }}>{fmt(data.balance)}</div>
        </div>
        <div className="card stat-card">
          <div className="stat-label">طلبات شحن معلّقة</div>
          <div className="stat-value">{requests.filter((r: any) => r.status === 'pending').length}</div>
        </div>
        <div className="card stat-card">
          <div className="stat-label">عدد الحركات</div>
          <div className="stat-value">{txs.length}</div>
        </div>
      </div>

      {data.free_orders_remaining > 0 && (
        <div className="alert-info" style={{ marginTop: 12 }}>
          🎁 <strong>عرض ترحيبي:</strong> تبقّى لك <strong>{data.free_orders_remaining}</strong> من {data.free_orders_limit} طلب مجاني بدون عمولة (للمنصة والوكيل). استفد منه قبل إكمال {data.free_orders_limit} طلب مقبول.
        </div>
      )}
      {data.free_orders_remaining === 0 && Number(data.balance) <= 0 && (
        <div style={{ marginTop: 12, padding: 12, borderRadius: 10, background: '#fff7ed', border: '1px solid #fdba74', color: '#9a3412' }}>
          ⚠️ انتهت طلباتك المجانية ورصيد محفظتك غير كافٍ — <strong>يجب شحن الرصيد</strong> لقبول الطلبات الجديدة.
          <button className="btn btn-primary btn-sm" style={{ marginInlineStart: 8 }} onClick={() => { setForm(EMPTY_FORM); setProof(null); setOpen(true); }}>شحن الرصيد الآن</button>
        </div>
      )}

      <div className="alert-info">
        طريقة الشحن: ادفع المبلغ مقدمًا عبر <strong>زين كاش</strong> أو <strong>آسيا باي</strong> أو <strong>مصرف العراق الأول</strong> أو <strong>المصرف الأهلي</strong> إلى حساب المنصة، ثم أرسل طلب شحن مع <strong>لقطة شاشة لعملية الإرسال</strong>. بعد تدقيق المسؤول يُضاف الرصيد إلى محفظتك.
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <div className="card-header">
          <h3>📤 طلبات الشحن</h3>
        </div>
        {requests.length === 0 ? <EmptyState text="لا توجد طلبات شحن بعد" icon="💸" /> : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>المرجع</th><th>المبلغ (دينار)</th><th>طريقة الدفع</th><th>الحالة</th><th>سبب الرفض</th><th>التاريخ</th></tr>
              </thead>
              <tbody>
                {requests.map((r: any) => (
                  <tr key={r.id}>
                    <td><span className="mono bold">{r.reference}</span></td>
                    <td className="bold">{fmt(r.amount)}</td>
                    <td>{r.payment_method_label}</td>
                    <td><Badge status={r.status} map={RECHARGE_STATUS} /></td>
                    <td className="muted" style={{ color: r.admin_note ? 'var(--danger)' : undefined }}>{r.admin_note || '-'}</td>
                    <td className="muted">{fmtDate(r.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <div className="card-header"><h3>📒 سجل الحركات</h3></div>
        {txs.length === 0 ? <EmptyState text="لا توجد حركات بعد" icon="📒" /> : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>النوع</th><th>المبلغ (دينار)</th><th>حصة الوكيل</th><th>حصة المنصة</th><th>الطلب</th><th>الرصيد بعد</th><th>التاريخ</th></tr>
              </thead>
              <tbody>
                {txs.map((t: any) => (
                  <tr key={t.id}>
                    <td><span className={`badge badge-${(TX_LABELS as Record<string, any>)[t.type]?.cls || 'gray'}`}>{(TX_LABELS as Record<string, any>)[t.type]?.label || t.type}</span></td>
                    <td className="bold" style={{ color: t.amount < 0 ? 'var(--danger)' : 'var(--success)' }}>{fmt(t.amount)}</td>
                    <td>{fmt(t.agent_amount)}</td>
                    <td>{fmt(t.platform_amount)}</td>
                    <td className="mono muted">{t.order_number || '-'}</td>
                    <td>{fmt(t.balance_after)}</td>
                    <td className="muted">{fmtDate(t.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <Modal open={open} title="طلب شحن رصيد" onClose={() => setOpen(false)} size="lg">
        <p className="muted mb-4">{paymentInfo?.instructions || 'أرسل المبلغ إلى حساب المنصة ثم ارفق لقطة الشاشة. لن يُضاف الرصيد إلا بعد موافقة المسؤول.'}</p>

        <Field label="طريقة الدفع" required>
          <div className="method-grid">
            {PAYMENT_METHODS.map((m) => (
              <button
                key={m.id}
                type="button"
                className={`method-card ${form.method === m.id ? 'method-card--active' : ''}`}
                onClick={() => setForm({ ...form, method: m.id })}
              >
                <div className="method-icon">{m.icon}</div>
                <div className="bold">{m.label}</div>
                <div className="muted" style={{ fontSize: 11 }}>{m.hint}</div>
              </button>
            ))}
          </div>
        </Field>

        {selectedMethod && (
          <div className="request-banner">
            <div className="bold" style={{ marginBottom: 4 }}>📌 حساب المنصة لاستقبال التحويل ({selectedMethod.label})</div>
            {selectedMethod.numbers && selectedMethod.numbers.length > 0 && (
              <div>أرقام المحفظة للإرسال:
                {selectedMethod.numbers.map((n: any) => <div key={n}><strong dir="ltr" className="mono">{n}</strong></div>)}
              </div>
            )}
            {selectedMethod.account_name && <div>اسم المستفيد: <strong>{selectedMethod.account_name}</strong></div>}
            {selectedMethod.ibans && selectedMethod.ibans.length > 0 && (
              <div>أرقام الآيبان:
                {selectedMethod.ibans.map((i: any) => <div key={i}><strong dir="ltr" className="mono">{i}</strong></div>)}
              </div>
            )}
            <div className="recharge-instruction" style={{ marginTop: 8 }}>
              قم بإرسال الرصيد إلى رقم المحفظة هذا، ثم قم بأخذ لقطة شاشة لعملية الإرسال وأرسلها للمنصة.
            </div>
            {(!selectedMethod.numbers || selectedMethod.numbers.length === 0) &&
              (!selectedMethod.ibans || selectedMethod.ibans.length === 0) && (
              <span className="muted">لم تُحدد إدارة المنصة رقم حساب لهذه القناة بعد — تواصل مع الدعم.</span>
            )}
          </div>
        )}

        <div className="form-grid">
          <Field label="المبلغ (دينار)" required>
            <input type="number" min="1" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} placeholder="مثال: 1000000" />
          </Field>
          <Field label="ملاحظة (اختياري)">
            <input value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} placeholder="مثال: إرسال من زين كاش رقم 0770..." />
          </Field>
        </div>

        <Field label="لقطة شاشة عملية الإرسال (إثبات)" required>
          <ImageUpload value={proof} onChange={setProof} hint="ارفع لقطة شاشة بصيغة صورة (PNG/JPG)" />
        </Field>

        <div className="form-actions">
          <button className="btn btn-outline" onClick={() => setOpen(false)}>إلغاء</button>
          <button className="btn btn-primary" onClick={submit} disabled={saving}>{saving ? 'جارٍ الإرسال...' : 'إرسال طلب الشحن'}</button>
        </div>
      </Modal>
    </div>
  );
}
