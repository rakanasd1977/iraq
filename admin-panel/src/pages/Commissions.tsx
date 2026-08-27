import { useEffect, useState } from 'react';
import { api } from '../api';
import { useToast, Field } from '@rafidain/shared/ui';

export default function Commissions() {
  const [data, setData] = useState<any>(null);
  const [saving, setSaving] = useState(false);
  const toast = useToast();

  useEffect(() => {
    api.get('/commissions').then((r) => setData(r.data)).catch((e) => toast.error(e.message));
  }, []);

  const save = async () => {
    setSaving(true);
    try {
      const res = await api.put('/commissions', {
        platform_commission_default: data.platform_commission_default,
        agent_default_commission: data.agent_default_commission,
        currency: data.currency,
      });
      setData(res.data);
      toast.success('تم تحديث إعدادات العمولات');
    } catch (e: any) { toast.error(e.message); } finally { setSaving(false); }
  };

  if (!data) return <div className="page-loading"><div className="spinner" /></div>;

  return (
    <div>
      <div className="page-head">
        <div>
          <h2>العمولات</h2>
          <p>النسب الافتراضية لعمولة المنصة والوكيل — تُطبق عند إنشاء الطلبات</p>
        </div>
      </div>

      <div className="grid grid-2">
        <div className="card">
          <div className="card-header"><h3>إعدادات العمولات</h3></div>
          <div className="card-body">
            <div className="alert-info">آلية العمل: يدفع الزبون السعر الكامل. تُخصم عمولة المنصة (بالإضافة إلى عمولة الوكيل) من إجمالي الطلب، ويستلم مزود الخدمة الباقي.</div>
            <Field label="نسبة عمولة المنصة الافتراضية (%)" required>
              <input type="number" step="0.5" value={data.platform_commission_default} onChange={(e) => setData({ ...data, platform_commission_default: e.target.value })} />
            </Field>
            <Field label="نسبة عمولة الوكيل الافتراضية (%)" required>
              <input type="number" step="0.5" value={data.agent_default_commission} onChange={(e) => setData({ ...data, agent_default_commission: e.target.value })} />
            </Field>
            <Field label="العملة" required>
              <select value={data.currency} onChange={(e) => setData({ ...data, currency: e.target.value })}>
                <option value="IQD">IQD - دينار عراقي</option>
                <option value="USD">USD - دولار أمريكي</option>
              </select>
            </Field>
            <button className="btn btn-primary" onClick={save} disabled={saving}>{saving ? 'جاري الحفظ...' : 'حفظ الإعدادات'}</button>
          </div>
        </div>

        <div className="card">
          <div className="card-header"><h3>مثال توضيحي</h3></div>
          <div className="card-body">
            <p className="muted mb-3">لمعرفة توزيع العمولات على طلب بقيمة <strong>100,000 دينار</strong> حسب النسب الحالية:</p>
            {(() => {
              const pf = Number(data.platform_commission_default) || 0;
              const ag = Number(data.agent_default_commission) || 0;
              const total = 100000 * pf / 100;
              const agent = Math.min(100000 * ag / 100, total);
              const platform = total - agent;
              const provider = 100000 - total;
              return (
                <div className="detail-grid">
                  <div className="detail-item"><div className="k">عمولة المنصة</div><div className="v">{Math.round(platform)} دينار</div></div>
                  <div className="detail-item"><div className="k">عمولة الوكيل</div><div className="v">{Math.round(agent)} دينار</div></div>
                  <div className="detail-item"><div className="k">مجموع العمولة</div><div className="v">{Math.round(total)} دينار</div></div>
                  <div className="detail-item"><div className="k">حصة مزود الخدمة</div><div className="v">{Math.round(provider)} دينار</div></div>
                </div>
              );
            })()}
            <p className="muted mt-3" style={{ fontSize: 12 }}>⚠️ يمكن تعديل نسبة عمولة كل مزود خدمة وكل وكيل على حدة من صفحاتهم.</p>
          </div>
        </div>
      </div>
    </div>
  );
}
