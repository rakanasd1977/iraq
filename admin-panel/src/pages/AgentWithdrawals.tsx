import { useEffect, useState } from 'react';
import { api } from '../api';
import { useToast, fmt, fmtDate, PageLoading, EmptyState, Confirm, Badge, Pagination, WITHDRAWAL_STATUS } from '@rafidain/shared/ui';

export default function AgentWithdrawals() {
  const [rows, setRows] = useState<any>(null);
  const [meta, setMeta] = useState<any>(null);
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');
  const [deciding, setDeciding] = useState<any>(null);
  const [decision, setDecision] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const toast = useToast();

  const load = (pg = page) => {
    const p = new URLSearchParams();
    if (status) p.set('status', status);
    p.set('page', String(pg));
    p.set('limit', '20');
    api.get(`/agent-withdrawals?${p}`).then((r) => { setRows(r.data); setMeta(r.meta || null); }).catch((e) => toast.error(e.message));
  };
  useEffect(() => { load(); }, [page, status]);
  useEffect(() => { setPage(1); }, [status]);

  const openDecision = (w: any, d: any) => {
    setDeciding(w);
    setDecision(d);
    setNotes('');
  };

  const decide = async () => {
    setSaving(true);
    try {
      await api.post(`/agent-withdrawals/${deciding.id}/decision`, { decision, notes: notes.trim() || undefined });
      toast.success(decision === 'approved' ? 'تمت الموافقة على السحب' : 'تم رفض الطلب');
      setDeciding(null);
      load();
    } catch (e: any) { toast.error(e.message); } finally { setSaving(false); }
  };

  if (!rows) return <PageLoading />;

  return (
    <div>
      <div className="page-head">
        <div>
          <h2>سحوبات الوكلاء</h2>
          <p>مراجعة طلبات سحب عمولات الوكلاء — الموافقة تعني أنك حوّلت المبلغ للوكيل</p>
        </div>
      </div>

      <div className="filters">
        <select value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">كل الحالات</option>
          <option value="pending">قيد الانتظار</option>
          <option value="approved">معتمد</option>
          <option value="rejected">مرفوض</option>
        </select>
      </div>

      <div className="card">
        <div className="table-wrap">
          {rows.length === 0 ? <EmptyState text="لا توجد طلبات سحب" icon="🏦" /> : (
            <table>
              <thead>
                <tr>
                  <th>#</th><th>الوكيل</th><th>المحافظة</th><th>المبلغ (دينار)</th>
                  <th>ملاحظات</th><th>الحالة</th><th>التاريخ</th><th>إجراءات</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((w: any) => (
                  <tr key={w.id}>
                    <td className="mono muted">{w.id}</td>
                    <td>
                      <div className="bold">{w.agent_name_ar}</div>
                      <div className="muted" style={{ fontSize: 11 }}>{w.agent_email}</div>
                    </td>
                    <td>{w.governorate_name_ar}</td>
                    <td className="bold">{fmt(w.amount)}</td>
                    <td className="muted" style={{ maxWidth: 180 }}>{w.notes || '-'}</td>
                    <td><Badge status={w.status} map={WITHDRAWAL_STATUS} /></td>
                    <td className="muted">{fmtDate(w.created_at)}</td>
                    <td>
                      {w.status === 'pending' ? (
                        <div className="flex" style={{ gap: 6 }}>
                          <button className="btn btn-outline btn-sm" onClick={() => openDecision(w, 'approved')}>اعتماد</button>
                          <button className="btn btn-danger btn-sm" onClick={() => openDecision(w, 'rejected')}>رفض</button>
                        </div>
                      ) : (
                        <span className="muted">{w.decided_by_name ? `قرار ${w.decided_by_name}` : '-'}</span>
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

      <Confirm
        open={!!deciding}
        title={decision === 'approved' ? 'الموافقة على طلب السحب' : 'رفض طلب السحب'}
        message={deciding ? `تأكيد ${decision === 'approved' ? 'اعتماد' : 'رفض'} سحب ${fmt(deciding.amount)} دينار للوكيل «${deciding.agent_name_ar}»؟` : ''}
        confirmText={decision === 'approved' ? 'نعم، اعتماد' : 'نعم، رفض'}
        danger={decision === 'rejected'}
        onConfirm={decide}
        onCancel={() => setDeciding(null)}
      />
    </div>
  );
}
