import { useEffect, useState } from 'react';
import { api } from '../api';
import { useToast, fmt, fmtDate, PageLoading, StatCard, EmptyState, Modal, Field, Badge, WITHDRAWAL_STATUS } from '@rafidain/shared/ui';
import type { WalletData } from '../types';

export default function Wallet() {
  const [data, setData] = useState<WalletData | null>(null);
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const toast = useToast();

  const load = () => {
    api.get('/agent/wallet').then((r) => setData(r.data)).catch((e) => toast.error(e.message));
  };

  useEffect(load, []);

  const exportCsv = async (type: string) => {
    try {
      const res = await fetch(`/api/agent/wallet/export?type=${type}`, { credentials: 'include' });
      if (!res.ok) {
        const d = await res.json().catch(() => null);
        throw new Error(d?.message || 'تعذر تصدير البيانات');
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `wallet-${type}-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast.success('تم التصدير بنجاح');
    } catch (e: any) { toast.error(e.message); }
  };

  if (!data) return <PageLoading />;

  const b = data.balance;

  const request = async () => {
    const amt = Number(amount);
    if (!Number.isFinite(amt) || amt <= 0) {
      toast.error('يرجى إدخال مبلغ صحيح');
      return;
    }
    setSaving(true);
    try {
      await api.post('/agent/wallet/withdraw', { amount: amt, notes: notes.trim() || undefined });
      toast.success('تم إرسال طلب السحب — بانتظار موافقة المسؤول');
      setOpen(false);
      setAmount('');
      setNotes('');
      load();
    } catch (e: any) { toast.error(e.message); } finally { setSaving(false); }
  };

  return (
    <div>
      <div className="page-head">
        <div>
          <h2>محفظتي</h2>
          <p>أرباحك من عمولات الطلبات المكتملة في محافظتك — السحب يتم بعد موافقة المسؤول</p>
        </div>
        <div className="flex">
          <button className="btn btn-outline" onClick={() => exportCsv('income')}>⬇ أرباحي CSV</button>
          <button className="btn btn-outline" onClick={() => exportCsv('withdrawals')}>⬇ السحوبات CSV</button>
          <button className="btn btn-primary" onClick={() => setOpen(true)}>⬆ طلب سحب</button>
        </div>
      </div>

      <div className="grid grid-4 mb-4">
        <StatCard label="الرصيد المتاح (دينار)" value={fmt(b.available)} icon="💰" tone="accent" />
        <StatCard label="إجمالي أرباحي المكتملة" value={fmt(b.total_earned)} icon="💵" tone="primary" />
        <StatCard label="قيد التحصيل (طلبات غير مكتملة)" value={fmt(b.pending_orders_commission)} icon="⏳" tone="info" />
        <StatCard label="سحوبات معتمدة" value={fmt(b.approved_withdrawals)} icon="🏦" tone="success" />
      </div>
      {b.pending_withdrawals > 0 && (
        <div className="alert alert-info mb-4">⏳ لديك {fmt(b.pending_withdrawals)} دينار سحوبات قيد انتظار موافقة المسؤول.</div>
      )}

      <div className="grid grid-2">
        <div className="card">
          <div className="card-header"><h3>آخر الأرباح (طلبات مكتملة)</h3></div>
          <div className="table-wrap">
            <table>
              <thead><tr><th>رقم الطلب</th><th>المزود</th><th>عمولتي (دينار)</th><th>التاريخ</th></tr></thead>
              <tbody>
                {data.income.length === 0 && <tr><td colSpan={4}><EmptyState text="لا توجد أرباح مكتملة بعد" icon="💰" /></td></tr>}
                {data.income.map((o) => (
                  <tr key={o.id}>
                    <td className="mono bold">{o.order_number}</td>
                    <td>{o.provider_name}</td>
                    <td className="bold">{fmt(o.agent_amount)}</td>
                    <td className="muted">{fmtDate(o.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="card">
          <div className="card-header"><h3>طلبات السحب</h3></div>
          <div className="table-wrap">
            <table>
              <thead><tr><th>المبلغ (دينار)</th><th>الحالة</th><th>ملاحظات</th><th>التاريخ</th></tr></thead>
              <tbody>
                {data.withdrawals.length === 0 && <tr><td colSpan={4}><EmptyState text="لا توجد طلبات سحب بعد" icon="🏦" /></td></tr>}
                {data.withdrawals.map((w) => (
                  <tr key={w.id}>
                    <td className="bold">{fmt(w.amount)}</td>
                    <td><Badge status={w.status} map={WITHDRAWAL_STATUS} /></td>
                    <td className="muted">{w.notes || '-'}</td>
                    <td className="muted">{fmtDate(w.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <Modal open={open} title="طلب سحب من الرصيد المتاح" onClose={() => setOpen(false)}>
        <p className="muted mb-4">الرصيد المتاح: <strong>{fmt(b.available)}</strong> دينار — أقل مبلغ للسحب 1000 دينار.</p>
        <Field label="المبلغ (دينار)" required>
          <input type="number" min="1000" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="مثال: 100000" />
        </Field>
        <Field label="ملاحظات (اختياري)">
          <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="بيانات الاستلام أو أي ملاحظة" />
        </Field>
        <div className="modal-footer">
          <button className="btn btn-outline" onClick={() => setOpen(false)}>إلغاء</button>
          <button className="btn btn-primary" onClick={request} disabled={saving}>{saving ? 'جاري الإرسال...' : 'إرسال طلب السحب'}</button>
        </div>
      </Modal>
    </div>
  );
}
