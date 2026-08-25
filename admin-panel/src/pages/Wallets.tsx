import { useEffect, useState } from 'react';
import { api } from '../api';
import { useToast, fmt, fmtDate, PageLoading, EmptyState, Modal, Field, Badge, Pagination, RECHARGE_STATUS } from '@rafidain/shared/ui';

const TX_LABELS = {
  recharge: { label: 'شحن', cls: 'badge-green' },
  commission: { label: 'استقطاع عمولة', cls: 'badge-amber' },
  refund: { label: 'رد', cls: 'badge-blue' },
};

export default function Wallets() {
  const [tab, setTab] = useState('wallets');
  const [rows, setRows] = useState<any>(null);
  const [wMeta, setWMeta] = useState<any>(null);
  const [wPage, setWPage] = useState(1);
  const [q, setQ] = useState('');
  const [recharge, setRecharge] = useState<any>(null);
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [ledger, setLedger] = useState<any>(null);
  const [ledgerProvider, setLedgerProvider] = useState<any>(null);
  const [saving, setSaving] = useState(false);

  const [requests, setRequests] = useState<any>(null);
  const [rMeta, setRMeta] = useState<any>(null);
  const [rPage, setRPage] = useState(1);
  const [rStatus, setRStatus] = useState('');
  const [rQ, setRQ] = useState('');
  const [selected, setSelected] = useState<any>(null);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState<string>('');

  const toast = useToast();

  const loadWallets = (pg = wPage) => {
    const p = new URLSearchParams();
    if (q) p.set('q', q);
    p.set('page', String(pg));
    p.set('limit', '20');
    api.get(`/wallets?${p}`).then((r) => { setRows(r.data); setWMeta(r.meta || null); }).catch((e) => toast.error(e.message));
  };
  const loadRequests = (pg = rPage) => {
    const p = new URLSearchParams();
    if (rStatus) p.set('status', rStatus);
    if (rQ) p.set('q', rQ);
    p.set('page', String(pg));
    p.set('limit', '20');
    const qs = p.toString();
    api.get(`/recharges${qs ? '?' + qs : ''}`).then((r) => { setRequests(r.data); setRMeta(r.meta || null); }).catch((e) => toast.error(e.message));
  };
  useEffect(() => { loadWallets(); }, [wPage]);
  useEffect(() => { loadRequests(); }, [rPage, rStatus]);

  const searchWallets = () => { setWPage(1); loadWallets(1); };
  const searchRequests = () => { setRPage(1); loadRequests(1); };

  const doRecharge = async () => {
    const amt = Number(amount);
    if (!amount || !Number.isFinite(amt) || amt <= 0) return toast.error('أدخل مبلغ شحن صحيحاً أكبر من صفر');
    setSaving(true);
    try {
      const res = await api.post(`/wallets/${recharge.provider_id}/recharge`, { amount: amt, note });
      toast.success(`تم شحن ${fmt(res.data.amount)} دينار لمحفظة ${recharge.provider_name || ''}`);
      setRecharge(null); setAmount(''); setNote('');
      loadWallets();
    } catch (e: any) { toast.error(e.message); } finally { setSaving(false); }
  };

  const viewLedger = async (p: any) => {
    try {
      const res = await api.get(`/wallets/${p.provider_id}`);
      setLedger(res.data);
      setLedgerProvider(p);
    } catch (e: any) { toast.error(e.message); }
  };

  const viewRequest = async (r: any) => {
    try {
      const res = await api.get(`/recharges/${r.id}`);
      setSelected(res.data);
    } catch (e: any) { toast.error(e.message); }
  };

  const approveRequest = async () => {
    setSaving(true);
    try {
      const res = await api.post(`/recharges/${selected.id}/approve`);
      toast.success(`تمت الموافقة على ${res.data.reference} وأُضيف ${fmt(res.data.amount)} دينار للرصيد`);
      setSelected(null);
      loadRequests();
      loadWallets();
    } catch (e: any) { toast.error(e.message); } finally { setSaving(false); }
  };

  const rejectRequest = async () => {
    if (!rejectReason.trim()) return toast.error('أدخل سبب الرفض ليظهر للمزود');
    setSaving(true);
    try {
      await api.post(`/recharges/${selected.id}/reject`, { reason: rejectReason.trim() });
      toast.success('تم رفض طلب الشحن');
      setRejectOpen(false);
      setRejectReason('');
      setSelected(null);
      loadRequests();
    } catch (e: any) { toast.error(e.message); } finally { setSaving(false); }
  };

  if (!rows || !requests) return <PageLoading />;

  const totalBalance = rows.reduce((s: any, r: any) => s + Number(r.balance || 0), 0);
  const pendingCount = requests.filter((r: any) => r.status === 'pending').length;

  return (
    <div>
      <div className="page-head">
        <div>
          <h2>محافظ المزودين</h2>
          <p>رصيد داخلي لكل مزود يدفعه مسبقاً عبر زين كاش / آسيا باي / المصرفين، ويُستقطع عند قبول الطلبات.</p>
        </div>
      </div>

      <div className="tabs">
        <button className={`tab ${tab === 'wallets' ? 'tab--active' : ''}`} onClick={() => setTab('wallets')}>المحافظ</button>
        <button className={`tab ${tab === 'recharges' ? 'tab--active' : ''}`} onClick={() => setTab('recharges')}>
          طلبات الشحن {pendingCount > 0 && <span className="tab-badge">{pendingCount}</span>}
        </button>
      </div>

      {tab === 'wallets' && (
        <>
          <div className="stats-grid">
            <div className="card stat-card">
              <div className="stat-label">إجمالي أرصدة المحافظ</div>
              <div className="stat-value">{fmt(totalBalance)} دينار</div>
            </div>
            <div className="card stat-card">
              <div className="stat-label">عدد المزودين</div>
              <div className="stat-value">{rows.length}</div>
            </div>
            <div className="card stat-card">
              <div className="stat-label">طلبات شحن معلّقة</div>
              <div className="stat-value" style={{ color: pendingCount ? 'var(--danger)' : undefined }}>{pendingCount}</div>
            </div>
          </div>

          <div className="filters">
            <input placeholder="بحث بالاسم أو البريد أو المحافظة..." value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && searchWallets()} />
            <button className="btn btn-outline btn-sm" onClick={searchWallets}>بحث</button>
          </div>

          <div className="card">
            <div className="table-wrap">
              {rows.length === 0 ? <EmptyState text="لا يوجد مزودون بعد" icon="🏪" /> : (
                <table>
                  <thead>
                    <tr>
                      <th>المزود</th><th>الخدمة</th><th>المحافظة</th><th>رصيد المحفظة (دينار)</th><th>عدد الحركات</th><th>إجراءات</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((p: any) => (
                      <tr key={p.provider_id}>
                        <td className="bold">{p.provider_name}</td>
                        <td><span className="badge badge-blue">{p.service_name_ar}</span></td>
                        <td><span className="badge badge-teal">{p.governorate_name_ar}</span></td>
                        <td className="bold" style={{ color: Number(p.balance) > 0 ? 'var(--success)' : 'var(--danger)' }}>{fmt(p.balance)}</td>
                        <td className="muted">{p.tx_count}</td>
                        <td>
                          <div className="flex">
                            <button className="btn btn-primary btn-sm" onClick={() => setRecharge(p)}>+ شحن رصيد</button>
                            <button className="btn btn-outline btn-sm" onClick={() => viewLedger(p)}>الحركات</button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>

          <Pagination meta={wMeta} page={wPage} onChange={setWPage} />
        </>
      )}

      {tab === 'recharges' && (
        <>
          <div className="filters">
            <select value={rStatus} onChange={(e) => { setRStatus(e.target.value); setRPage(1); }}>
              <option value="">كل الحالات</option>
              <option value="pending">قيد المراجعة</option>
              <option value="approved">مقبولة</option>
              <option value="rejected">مرفوضة</option>
            </select>
            <input placeholder="بحث بالمرجع أو اسم المزود..." value={rQ} onChange={(e) => setRQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && searchRequests()} />
            <button className="btn btn-outline btn-sm" onClick={searchRequests}>بحث</button>
          </div>

          <div className="card">
            <div className="table-wrap">
              {requests.length === 0 ? <EmptyState text="لا توجد طلبات شحن" icon="💸" /> : (
                <table>
                  <thead>
                    <tr><th>المرجع</th><th>المزود</th><th>المحافظة</th><th>المبلغ (دينار)</th><th>طريقة الدفع</th><th>الحالة</th><th>التاريخ</th><th>إجراءات</th></tr>
                  </thead>
                  <tbody>
                    {requests.map((r: any) => (
                      <tr key={r.id}>
                        <td><span className="mono bold">{r.reference}</span></td>
                        <td className="bold">{r.provider_name}</td>
                        <td className="muted">{r.governorate_name_ar}</td>
                        <td className="bold">{fmt(r.amount)}</td>
                        <td>{r.payment_method_label}</td>
                        <td><Badge status={r.status} map={RECHARGE_STATUS} /></td>
                        <td className="muted">{fmtDate(r.created_at)}</td>
                        <td>
                          <button className="btn btn-outline btn-sm" onClick={() => viewRequest(r)}>
                            {r.status === 'pending' ? 'مراجعة' : 'التفاصيل'}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>

          <Pagination meta={rMeta} page={rPage} onChange={setRPage} />
        </>
      )}

      <Modal open={!!recharge} title={`شحن محفظة ${recharge?.provider_name || ''}`} onClose={() => setRecharge(null)}>
        <Field label="المبلغ (دينار)" required>
          <input type="number" min="1" value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus />
        </Field>
        <Field label="ملاحظة (اختياري)">
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="مثال: شحن نقدي / تحويل" />
        </Field>
        <div className="form-actions">
          <button className="btn btn-outline" onClick={() => setRecharge(null)}>إلغاء</button>
          <button className="btn btn-primary" onClick={doRecharge} disabled={saving}>{saving ? 'جارٍ الشحن...' : 'شحن الرصيد'}</button>
        </div>
      </Modal>

      <Modal open={!!ledger} title={`سجل حركات ${ledgerProvider?.provider_name || ''}`} onClose={() => setLedger(null)} size="lg">
        <p className="muted mb-4">الرصيد الحالي: <strong className="bold" style={{ color: 'var(--success)' }}>{fmt(ledger?.balance)} دينار</strong></p>
        {ledger?.transactions?.length === 0 ? <EmptyState text="لا توجد حركات" icon="📒" /> : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>النوع</th><th>المبلغ (دينار)</th><th>حصة الوكيل</th><th>حصة المنصة</th><th>الطلب</th><th>الرصيد بعد</th><th>ملاحظة</th><th>التاريخ</th></tr>
              </thead>
              <tbody>
                {ledger?.transactions?.map((t: any) => (
                  <tr key={t.id}>
                    <td><span className={`badge ${(TX_LABELS as any)[t.type]?.cls || 'badge-gray'}`}>{(TX_LABELS as any)[t.type]?.label || t.type}</span></td>
                    <td className="bold" style={{ color: t.amount < 0 ? 'var(--danger)' : 'var(--success)' }}>{fmt(t.amount)}</td>
                    <td>{fmt(t.agent_amount)}</td>
                    <td>{fmt(t.platform_amount)}</td>
                    <td className="mono muted">{t.order_number || '-'}</td>
                    <td>{fmt(t.balance_after)}</td>
                    <td className="muted" style={{ maxWidth: 220 }}>{t.note || '-'}</td>
                    <td className="muted">{fmtDate(t.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Modal>

      <Modal open={!!selected} title={`طلب شحن ${selected?.reference || ''}`} onClose={() => setSelected(null)} size="lg">
        {selected && (
          <>
            <div className="detail-grid mb-4">
              <div className="detail-item"><div className="k">الحالة</div><div className="v"><Badge status={selected.status} map={RECHARGE_STATUS} /></div></div>
              <div className="detail-item"><div className="k">المزود</div><div className="v">{selected.provider_name}<div className="muted">{selected.governorate_name_ar}</div></div></div>
              <div className="detail-item"><div className="k">المبلغ (دينار)</div><div className="v">{fmt(selected.amount)}</div></div>
              <div className="detail-item"><div className="k">طريقة الدفع</div><div className="v">{selected.payment_method_label}</div></div>
              <div className="detail-item"><div className="k">تاريخ الإرسال</div><div className="v">{fmtDate(selected.created_at)}</div></div>
              <div className="detail-item"><div className="k">عولج بواسطة</div><div className="v">{selected.handled_by || '-'}<div className="muted">{selected.handled_at ? fmtDate(selected.handled_at) : ''}</div></div></div>
              <div className="detail-item" style={{ gridColumn: '1 / -1' }}><div className="k">ملاحظة المزود</div><div className="v">{selected.note || '-'}</div></div>
              {selected.admin_note && (
                <div className="detail-item" style={{ gridColumn: '1 / -1' }}><div className="k">سبب الرفض</div><div className="v" style={{ color: 'var(--danger)' }}>{selected.admin_note}</div></div>
              )}
            </div>

            <div className="card mb-4">
              <div className="card-header"><h3>🖼️ إثبات عملية الإرسال</h3></div>
              <div className="card-body">
                {selected.proof_image ? (
                  <a href={selected.proof_image} target="_blank" rel="noreferrer"><img className="modal-img" src={selected.proof_image} alt="إثبات الشحن" /></a>
                ) : <EmptyState text="لا يوجد إثبات مرفق" icon="🖼️" />}
              </div>
            </div>

            {selected.status === 'pending' && (
              <div className="card">
                <div className="card-header"><h3>قرار المسؤول</h3></div>
                <div className="card-body flex wrap">
                  <button className="btn btn-success" disabled={saving} onClick={approveRequest}>{saving ? 'جارٍ المعالجة...' : '✓ الموافقة وإضافة الرصيد'}</button>
                  <button className="btn btn-danger" disabled={saving} onClick={() => { setRejectReason(''); setRejectOpen(true); }}>✗ رفض الطلب</button>
                  <span className="muted">الموافقة تضيف المبلغ تلقائياً لمحفظة المزود وتسجل حركة شحن.</span>
                </div>
              </div>
            )}
          </>
        )}
      </Modal>

      <Modal open={rejectOpen} title={`رفض طلب الشحن ${selected?.reference || ''}`} onClose={() => setRejectOpen(false)}>
        <Field label="سبب الرفض (يظهر للمزود)" required>
          <textarea rows={3} value={rejectReason || ''} onChange={(e) => setRejectReason(e.target.value)} placeholder="مثال: لقطة الشاشة غير واضحة — أعد إرسالها" />
        </Field>
        <div className="form-actions">
          <button className="btn btn-outline" onClick={() => setRejectOpen(false)}>تراجع</button>
          <button className="btn btn-danger" disabled={saving || !rejectReason.trim()} onClick={rejectRequest}>{saving ? 'جارٍ الحفظ...' : 'رفض الطلب'}</button>
        </div>
      </Modal>
    </div>
  );
}
