import { useState, useEffect } from 'react';
import { api } from '../api';
import { useToast } from '@rafidain/shared/ui';

export default function NotificationSender() {
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [target, setTarget] = useState<'all' | 'role' | 'governorate'>('all');
  const [role, setRole] = useState('customer');
  const [governorateId, setGovernorateId] = useState('');
  const [url, setUrl] = useState('');
  const [icon, setIcon] = useState('📢');
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [governorates, setGovernorates] = useState<any[]>([]);
  const toast = useToast();

  useEffect(() => { api.get('/governorates').then((r) => setGovernorates(r.data || [])).catch(() => {}); }, []);

  const send = async () => {
    if (!title.trim() || !body.trim()) { toast.error('العنوان والنص مطلوبان'); return; }
    setSending(true);
    setResult(null);
    try {
      const res = await api.post('/admin/notifications/send', {
        title, body, target, role: target === 'role' ? role : undefined,
        governorate_id: target === 'governorate' ? Number(governorateId) : undefined, url, icon,
      });
      setResult(res.data);
      toast.success(`تم الإرسال إلى ${res.data.recipients} مستخدم`);
    } catch (e: any) { toast.error(e.message); } finally { setSending(false); }
  };

  return (
    <div>
      <div className="page-head">
        <div>
          <h2>إرسال إشعار</h2>
          <p>أرسل إشعاراً داخلياً (مع دفع) لجمهور محدد من المستخدمين</p>
        </div>
      </div>

      <div className="card form-card">
        <div className="form-grid">
          <div className="field full">
            <label>العنوان *</label>
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="مثال: عرض جديد في بغداد" />
          </div>
          <div className="field full">
            <label>نص الإشعار *</label>
            <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={4} placeholder="اكتب رسالتك هنا..." />
          </div>
          <div className="field">
            <label>الجمهور المستهدف</label>
            <select value={target} onChange={(e) => setTarget(e.target.value as any)}>
              <option value="all">الكل (زبائن، مزودون، وكلاء)</option>
              <option value="role">حسب الدور</option>
              <option value="governorate">حسب المحافظة</option>
            </select>
          </div>
          {target === 'role' && (
            <div className="field">
              <label>الدور</label>
              <select value={role} onChange={(e) => setRole(e.target.value)}>
                <option value="customer">زبائن</option>
                <option value="provider">مزودون</option>
                <option value="agent">وكلاء</option>
              </select>
            </div>
          )}
          {target === 'governorate' && (
            <div className="field">
              <label>المحافظة</label>
              <select value={governorateId} onChange={(e) => setGovernorateId(e.target.value)}>
                <option value="">اختر محافظة</option>
                {governorates.map((g) => <option key={g.id} value={g.id}>{g.name_ar}</option>)}
              </select>
            </div>
          )}
          <div className="field">
            <label>الأيقونة (emoji)</label>
            <input value={icon} onChange={(e) => setIcon(e.target.value)} maxLength={4} />
          </div>
          <div className="field full">
            <label>رابط عند النقر (اختياري)</label>
            <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="/deals" />
          </div>
        </div>
        <div className="form-actions">
          <button className="btn btn-primary" onClick={send} disabled={sending}>{sending ? 'جاري الإرسال...' : 'إرسال الإشعار'}</button>
        </div>
        {result && (
          <div className="alert success">
            تم الإرسال إلى <b>{result.recipients}</b> مستخدم، وتم تسليم <b>{result.push_sent}</b> دفعة عبر الويب.
          </div>
        )}
      </div>
    </div>
  );
}
