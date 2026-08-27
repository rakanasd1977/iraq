import { useEffect, useState } from 'react';
import { api } from '../api';
import { useToast, fmtDate, PageLoading, EmptyState, Pagination } from '@rafidain/shared/ui';
import type { ActivityRow } from '../types';

const ACTION_META = {
  create: { label: 'إنشاء', icon: '➕' },
  update: { label: 'تعديل', icon: '✏️' },
  delete: { label: 'حذف', icon: '🗑️' },
  activate: { label: 'تفعيل', icon: '✅' },
  deactivate: { label: 'إيقاف', icon: '⛔' },
  verify: { label: 'توثيق', icon: '🪪' },
  unverify: { label: 'إلغاء توثيق', icon: '🚫' },
  login: { label: 'تسجيل دخول', icon: '🔐' },
  logout: { label: 'تسجيل خروج', icon: '👋' },
  logout_all: { label: 'تسجيل خروج شامل', icon: '👋' },
  change_password: { label: 'تغيير كلمة المرور', icon: '🔑' },
  reset_password: { label: 'إعادة تعيين كلمة المرور', icon: '🔑' },
  verify_email: { label: 'تفعيل البريد', icon: '📧' },
  register_customer: { label: 'تسجيل زبون', icon: '🆕' },
  order_status: { label: 'تغيير حالة طلب', icon: '🧾' },
  request_lease_renewal: { label: 'طلب تجديد إجارة', icon: '📜' },
  renew_lease: { label: 'تجديد إجارة', icon: '📜' },
  create_lease: { label: 'إنشاء إجارة', icon: '📜' },
  update_lease: { label: 'تعديل إجارة', icon: '📜' },
  approve_lease: { label: 'موافقة إجارة', icon: '✅' },
  reject_lease: { label: 'رفض إجارة', icon: '❌' },
  revoke_lease: { label: 'إلغاء إجارة', icon: '🚫' },
  cancel_lease_payment: { label: 'إلغاء دفع إجارة', icon: '🚫' },
  provider_broadcast: { label: 'إعلان جماعي للمزودين', icon: '📢' },
  remind_pending_orders: { label: 'تذكير طلبات معلقة', icon: '⏰' },
  wallet_recharge: { label: 'شحن محفظة', icon: '💰' },
  recharge_request: { label: 'طلب شحن', icon: '💰' },
  recharge_approve: { label: 'موافقة شحن', icon: '✅' },
  recharge_reject: { label: 'رفض شحن', icon: '❌' },
  agent_withdrawal_request: { label: 'طلب سحب من الوكيل', icon: '💸' },
  promotion_create: { label: 'إنشاء ترويج', icon: '📣' },
  promotion_extend: { label: 'تمديد ترويج', icon: '📣' },
  promotion_end: { label: 'إنهاء ترويج', icon: '📣' },
  rate: { label: 'تقييم', icon: '⭐' },
  reply_rating: { label: 'رد على تقييم', icon: '💬' },
  submit_verification: { label: 'تقديم توثيق', icon: '🪪' },
};

const ENTITY_LABEL = {
  agent: 'وكيل', provider: 'مزود', order: 'طلب', customer: 'زبون',
  user: 'مستخدم', coupon: 'كوبون', promotion: 'ترويج', service: 'خدمة',
  governorate: 'محافظة', settings: 'الإعدادات', provider_rating: 'تقييم مزود',
  commissions: 'العمولات', customer_favorite: 'مفضلة',
};

const ACTION_META_MAP = ACTION_META as Record<string, { label: string; icon: string }>;
const ENTITY_LABEL_MAP = ENTITY_LABEL as Record<string, string>;

export default function Activity() {
  const [rows, setRows] = useState<ActivityRow[] | null>(null);
  const [meta, setMeta] = useState<any>(null);
  const [page, setPage] = useState(1);
  const [action, setAction] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const toast = useToast();

  const load = (pg = page, act = action, f = from, t = to) => {
    const p = new URLSearchParams();
    if (act) p.set('action', act);
    if (f) p.set('from', f);
    if (t) p.set('to', t);
    p.set('page', String(pg));
    p.set('limit', '50');
    api.get(`/agent/activity?${p.toString()}`).then((r) => { setRows(r.data); setMeta(r.meta || null); }).catch((e) => toast.error(e.message));
  };

  useEffect(() => { load(); }, [page]);
  useEffect(() => { setPage(1); load(1, action, from, to); }, [action, from, to]);

  if (!rows) return <PageLoading />;

  return (
    <div>
      <div className="page-head">
        <div>
          <h2>سجل نشاط محافظتي</h2>
          <p>أفعالك أنت وتغييرات طلبات ومزودي محافظتك — كل عملية موثقة بمن قام بها</p>
        </div>
      </div>

      <div className="filters">
        <select value={action} onChange={(e) => setAction(e.target.value)}>
          <option value="">كل الأنشطة</option>
          {Object.keys(ACTION_META).sort().map((a) => <option key={a} value={a}>{ACTION_META_MAP[a].icon} {ACTION_META_MAP[a].label}</option>)}
        </select>
        <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} title="من تاريخ" />
        <input type="date" value={to} onChange={(e) => setTo(e.target.value)} title="إلى تاريخ" />
        {(from || to) && <button className="btn btn-ghost btn-sm" onClick={() => { setFrom(''); setTo(''); }}>مسح النطاق ✕</button>}
      </div>

      <div className="card">
        <div className="table-wrap">
          {rows.length === 0 ? <EmptyState text="لا توجد أنشطة مطابقة" icon="📭" /> : (
            <table>
              <thead>
                <tr><th>الحدث</th><th>الجهة</th><th>من قام به</th><th>التفاصيل</th><th>التاريخ</th></tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const am = ACTION_META_MAP[r.action] || { label: r.action, icon: '•' };
                  const d = r.details;
                  const detailText = d
                    ? (d.order_number ? `طلب ${d.order_number}` : d.name_ar || d.governorate || d.role || Object.keys(d).map((k) => `${k}: ${d[k]}`).join(' • '))
                    : '';
                  return (
                    <tr key={r.id}>
                      <td><span className="bold">{am.icon} {am.label}</span></td>
                      <td>{ENTITY_LABEL_MAP[r.entity_type] || r.entity_type}{r.entity_id ? ` #${r.entity_id}` : ''}</td>
                      <td>{r.actor_name || '-'}<div className="muted" style={{ fontSize: 11 }}>{r.actor_role}</div></td>
                      <td className="muted" style={{ fontSize: 12, maxWidth: 320 }}>{detailText}</td>
                      <td className="muted">{fmtDate(r.created_at)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <Pagination meta={meta} page={page} onChange={setPage} />
    </div>
  );
}
