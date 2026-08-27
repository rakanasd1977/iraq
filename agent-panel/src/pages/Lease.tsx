import { useEffect, useState } from 'react';
import { api } from '../api';
import { useToast, fmt, fmtDate, PageLoading, Badge, LEASE_STATUS, Confirm } from '@rafidain/shared/ui';
import type { LeaseData } from '../types';

export default function Lease() {
  const [data, setData] = useState<LeaseData | null>(null);
  const [confirmRenew, setConfirmRenew] = useState(false);
  const [saving, setSaving] = useState(false);
  const toast = useToast();

  const load = () => api.get('/agent/lease').then((r) => setData(r.data)).catch((e) => toast.error(e.message));
  useEffect(() => { load(); }, []);

  const renew = async () => {
    setSaving(true);
    try {
      const res = await api.post('/agent/lease/renew');
      toast.success(res.data.message);
      setConfirmRenew(false);
      load();
    } catch (e: any) { toast.error(e.message); } finally { setSaving(false); }
  };

  if (!data) return <PageLoading />;

  const hasPending = data.payments?.some((p) => p.status === 'pending');
  const scopeName = data.district_name_ar ? `قضاء ${data.district_name_ar}` : `محافظة ${data.governorate_name_ar}`;
  const scopeHint = data.district_name_ar ? 'حسب القضاء' : 'حسب المحافظة';

  return (
    <div>
      <div className="page-head">
        <div>
          <h2>إجارة وكالة {scopeName}</h2>
          <p>يجب عليك تجديد إجارة الوكالة سنوياً بمبلغ يحدده المسؤول {scopeHint}</p>
        </div>
      </div>

      {data.is_expired && <div className="alert-error mb-4">⚠️ إجارتك منتهية. جددها الآن لمتابعة إدارة محافظتك.</div>}
      {hasPending && <div className="alert-info mb-4">📨 يوجد طلب تجديد قيد الانتظار — بانتظار موافقة المسؤول.</div>}

      <div className="grid grid-2 mb-4">
        <div className="card">
          <div className="card-header"><h3>بيانات إجارتي</h3></div>
          <div className="card-body">
            <div className="detail-grid">
              <div className="detail-item"><div className="k">{data.district_name_ar ? 'القضاء' : 'المحافظة'}</div><div className="v">{data.district_name_ar || data.governorate_name_ar}</div></div>
              <div className="detail-item"><div className="k">حالة الإجارة</div><div className="v"><Badge status={data.lease_status} map={LEASE_STATUS} /></div></div>
              <div className="detail-item"><div className="k">تاريخ انتهاء الإجارة</div><div className="v">{fmtDate(data.lease_expires_at)}</div></div>
              <div className="detail-item"><div className="k">رسوم التجديد السنوية</div><div className="v">{fmt(data.lease_fee)} دينار</div></div>
              <div className="detail-item"><div className="k">نسبة عمولتي</div><div className="v">%{data.commission_rate}</div></div>
            </div>
            <button className="btn btn-accent mt-4" disabled={hasPending} onClick={() => setConfirmRenew(true)}>
              {hasPending ? 'طلب التجديد قيد المعالجة...' : 'تجديد إجارة الوكالة'}
            </button>
          </div>
        </div>

        <div className="card">
          <div className="card-header"><h3>سجل دفعات الإجارة</h3></div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>#</th><th>المبلغ (دينار)</th><th>الفترة</th><th>الحالة</th><th>تاريخ الدفع</th></tr>
              </thead>
              <tbody>
                {data.payments.length === 0 && <tr><td colSpan={5}><div className="muted" style={{ padding: 16 }}>لا توجد دفعات بعد</div></td></tr>}
                {data.payments.map((p) => (
                  <tr key={p.id}>
                    <td>{p.id}</td>
                    <td className="bold">{fmt(p.amount)}</td>
                    <td className="muted" style={{ fontSize: 12 }}>
                      {fmtDate(p.period_start)} ← {fmtDate(p.period_end)}
                    </td>
                    <td>
                      {p.status === 'paid' && <span className="badge badge-green">مدفوعة</span>}
                      {p.status === 'pending' && <span className="badge badge-amber">قيد الانتظار</span>}
                      {p.status === 'rejected' && <span className="badge badge-red">مرفوضة</span>}
                    </td>
                    <td className="muted">{p.paid_at ? fmtDate(p.paid_at) : '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <Confirm
        open={confirmRenew}
        title="تجديد إجارة الوكالة"
        message={`سيتم إرسال طلب تجديد إجارة وكالة ${scopeName} بمبلغ ${fmt(data.lease_fee)} دينار لفترة سنة واحدة. سيوافق المسؤول على الطلب بعد تأكيد الدفع.`}
        confirmText="إرسال طلب التجديد"
        onConfirm={renew}
        onCancel={() => setConfirmRenew(false)}
      />
    </div>
  );
}
