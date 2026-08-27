import { useEffect, useState } from 'react';
import { api } from '../api';
import { useToast, fmtDate, PageLoading, EmptyState, Pagination, Modal, Badge } from '@rafidain/shared/ui';

const ACTION_LABELS: Record<string, string> = {
  login: 'تسجيل دخول', login_2fa_pending: 'بانتظار 2FA', logout: 'تسجيل خروج', logout_all: 'تسجيل خروج الكل',
  create: 'إضافة', update: 'تعديل', delete: 'حذف', activate: 'تفعيل', deactivate: 'إيقاف',
  verify: 'توثيق', unverify: 'إلغاء توثيق', renew_lease: 'تجديد إجارة', approve_lease: 'موافقة إجارة',
  reject_lease: 'رفض إجارة', request_lease_renewal: 'طلب تجديد إجارة', order_status: 'تغيير حالة طلب',
  reset_password: 'إعادة تعيين كلمة مرور', change_password: 'تغيير كلمة مرور', enable_2fa: 'تفعيل 2FA',
  disable_2fa: 'إيقاف 2FA', reset_2fa: 'إعادة تعيين 2FA', register_customer: 'تسجيل زبون',
  verify_email: 'تفعيل بريد', wallet_recharge: 'شحن محفظة', recharge_request: 'طلب شحن',
  recharge_approve: 'موافقة شحن', recharge_reject: 'رفض شحن', promotion_create: 'إنشاء إعلان',
  promotion_extend: 'تمديد إعلان', promotion_end: 'إنهاء إعلان', agent_withdrawal_approve: 'موافقة سحب وكيل',
  agent_withdrawal_reject: 'رفض سحب وكيل', agent_withdrawal_request: 'طلب سحب', provider_broadcast: 'بث للمزودين',
  remind_pending_orders: 'تذكير طلبات معلقة', reply_rating: 'رد على تقييم', submit_verification: 'طلب توثيق',
  create_lease: 'إنشاء إجارة', update_lease: 'تحديث إجارة', cancel_lease_payment: 'إلغاء دفعة إجارة',
  revoke_lease: 'إلغاء إجارة',
};

const ENTITY_LABELS: Record<string, string> = {
  user: 'مستخدم', governorate: 'محافظة', agent: 'وكيل', provider: 'مزود خدمة',
  customer: 'زبون', service: 'خدمة', order: 'طلب', settings: 'إعدادات', commissions: 'عمولات',
  wallet: 'محفظة', promotion: 'إعلان', coupon: 'كوبون', item: 'عنصر', provider_rating: 'تقييم مزود',
  activity_log: 'سجل نشاط', system: 'نظام', roles: 'أدوار', users: 'مستخدمون',
};

export default function Activity() {
  const [rows, setRows] = useState<any>(null);
  const [meta, setMeta] = useState<any>(null);
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState({ action: '', entity_type: '', entity_id: '', actor_id: '', from: '', to: '' });
  const [detailRow, setDetailRow] = useState<any>(null);
  const toast = useToast();

  const load = () => {
    const p = new URLSearchParams();
    Object.entries(filters).forEach(([k, v]) => { if (v) p.set(k, v); });
    p.set('page', String(page));
    p.set('limit', '20');
    api.get(`/activity?${p}`).then((r) => { setRows(r.data); setMeta(r.meta || null); }).catch((e) => toast.error(e.message));
  };
  useEffect(() => { load(); }, [filters, page]);
  useEffect(() => { setPage(1); }, [filters]);

  const goPage = (n: any) => { setPage(n); window.scrollTo({ top: 0, behavior: 'smooth' }); };

  const exportCsv = async () => {
    try {
      const p = new URLSearchParams();
      Object.entries(filters).forEach(([k, v]) => { if (v) p.set(k, v); });
      const res = await fetch(`/api/activity/export?${p}`, { credentials: 'include' });
      if (!res.ok) throw new Error('فشل التصدير');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `audit-log-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast.success('تم تصدير سجل التدقيق بنجاح');
    } catch (e: any) { toast.error(e.message); }
  };

  if (!rows) return <PageLoading />;

  return (
    <div>
      <div className="page-head flex-between">
        <div>
          <h2>سجل التدقيق الموحد (Unified Audit Log)</h2>
          <p>سجل شامل لجميع العمليات الحساسة مع تتبع IP و User Agent — للامتثال والتحقيق</p>
        </div>
        <button className="btn btn-outline" onClick={exportCsv}>⬇ تصدير CSV</button>
      </div>

      <div className="filters" style={{ flexWrap: 'wrap', gap: 8 }}>
        <select value={filters.action} onChange={e => setFilters({...filters, action: e.target.value})} style={{ minWidth: 180 }}>
          <option value="">كل العمليات</option>
          {Object.keys(ACTION_LABELS).map((k) => <option key={k} value={k}>{ACTION_LABELS[k]}</option>)}
        </select>
        <select value={filters.entity_type} onChange={e => setFilters({...filters, entity_type: e.target.value})} style={{ minWidth: 160 }}>
          <option value="">كل أنواع الجهات</option>
          {Object.keys(ENTITY_LABELS).map((k) => <option key={k} value={k}>{ENTITY_LABELS[k]}</option>)}
        </select>
        <input type="text" placeholder="معرف الجهة (ID)" value={filters.entity_id} onChange={e => setFilters({...filters, entity_id: e.target.value})} style={{ width: 120 }} />
        <input type="text" placeholder="معرف المنفذ (ID)" value={filters.actor_id} onChange={e => setFilters({...filters, actor_id: e.target.value})} style={{ width: 120 }} />
        <input type="date" value={filters.from} onChange={e => setFilters({...filters, from: e.target.value})} title="من تاريخ" />
        <input type="date" value={filters.to} onChange={e => setFilters({...filters, to: e.target.value})} title="إلى تاريخ" />
        {(filters.from || filters.to || filters.action || filters.entity_type || filters.entity_id || filters.actor_id) && (
          <button className="btn btn-ghost btn-sm" onClick={() => setFilters({action:'',entity_type:'',entity_id:'',actor_id:'',from:'',to:''})}>مسح الفلاتر ✕</button>
        )}
      </div>

      <div className="card">
        <div className="table-wrap">
          {rows.length === 0 ? <EmptyState text="لا يوجد نشاط" icon="📋" /> : (
            <table>
              <thead>
                <tr><th>التاريخ</th><th>المنفذ</th><th>الدور</th><th>العملية</th><th>الجهة</th><th>IP</th><th>التفاصيل</th><th></th></tr>
              </thead>
              <tbody>
                {rows.map((r: any) => (
                  <tr key={r.id} style={{ cursor: detailRow === r.id ? 'default' : 'pointer' }} onClick={() => setDetailRow(detailRow === r.id ? null : r)}>
                    <td className="muted">{fmtDate(r.created_at)}</td>
                    <td className="bold">{r.actor_name || 'النظام'}</td>
                    <td><span className="badge badge-gray">{r.actor_role}</span></td>
                    <td><span className="badge badge-blue">{ACTION_LABELS[r.action] || r.action}</span></td>
                    <td>{ENTITY_LABELS[r.entity_type] || r.entity_type}{r.entity_id ? ` <span className="mono">#${r.entity_id}</span>` : ''}</td>
                    <td className="muted mono" style={{ fontSize: 11, maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.ip_address || '—'}</td>
                    <td className="muted" style={{ maxWidth: 200 }}>{r.details ? <span className="mono" style={{ fontSize: 11 }}>{r.details.length > 80 ? r.details.slice(0, 80) + '…' : r.details}</span> : '-'}</td>
                    <td style={{ width: 32, textAlign: 'center' }}><span className={detailRow === r.id ? '🔼' : '🔽'} style={{ fontSize: 12, cursor: 'pointer' }} onClick={e => { e.stopPropagation(); setDetailRow(detailRow === r.id ? null : r); }} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <Pagination meta={meta} page={page} onChange={goPage} />

      {/* Detail Modal */}
      <Modal open={!!detailRow} title={`تفاصيل السجل #${detailRow?.id}`} onClose={() => setDetailRow(null)} size="lg">
        {detailRow && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 16 }}>
            <div><label className="muted">المعرف</label><div className="mono">{detailRow.id}</div></div>
            <div><label className="muted">التاريخ</label><div>{fmtDate(detailRow.created_at)}</div></div>
            <div><label className="muted">المنفذ</label><div className="bold">{detailRow.actor_name || 'النظام'}</div></div>
            <div><label className="muted">بريد المنفذ</label><div className="mono">{detailRow.actor_email || '—'}</div></div>
            <div><label className="muted">الدور</label><div><Badge status={detailRow.actor_role} map={{admin:{label:'مسؤول',cls:'badge-red'},agent:{label:'وكيل',cls:'badge-blue'},provider:{label:'مزود',cls:'badge-green'},customer:{label:'زبون',cls:'badge-amber'},system:{label:'نظام',cls:'badge-gray'}}} /></div></div>
            <div><label className="muted">العملية</label><div><Badge status={detailRow.action} map={{create:{label:'إضافة',cls:'badge-green'},update:{label:'تعديل',cls:'badge-blue'},delete:{label:'حذف',cls:'badge-red'},login:{label:'دخول',cls:'badge-teal'},logout:{label:'خروج',cls:'badge-gray'}} } /></div></div>
            <div><label className="muted">نوع الجهة</label><div>{ENTITY_LABELS[detailRow.entity_type] || detailRow.entity_type}</div></div>
            <div><label className="muted">معرف الجهة</label><div className="mono">{detailRow.entity_id || '—'}</div></div>
            <div><label className="muted">عنوان IP</label><div className="mono">{detailRow.ip_address || '—'}</div></div>
            <div><label className="muted">User Agent</label><div className="mono" style={{ fontSize: 11, wordBreak: 'break-all' }}>{detailRow.user_agent || '—'}</div></div>
            <div style={{ gridColumn: '1 / -1' }}>
              <label className="muted">التفاصيل (JSON)</label>
              <pre className="mono" style={{ background: '#f8fafc', padding: 12, borderRadius: 8, maxHeight: 300, overflow: 'auto', fontSize: 12, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                {detailRow.details ? JSON.stringify(JSON.parse(detailRow.details), null, 2) : '—'}
              </pre>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}