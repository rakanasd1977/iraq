import { useEffect, useState } from 'react';
import { api } from '../api';
import { useToast, fmt, fmtDate, PageLoading, EmptyState, Modal, Field, StatCard, Pagination } from '@rafidain/shared/ui';

function Stars({ n }: { n: number }) {
  return <span className="stars" title={`${n}/5`}>{'★'.repeat(n)}<span className="stars-off">{'★'.repeat(5 - n)}</span></span>;
}

export default function Ratings() {
  const [rows, setRows] = useState<any>(null);
  const [meta, setMeta] = useState<any>(null);
  const [page, setPage] = useState(1);
  const [replying, setReplying] = useState<any>(null);
  const [replyText, setReplyText] = useState('');
  const [saving, setSaving] = useState(false);
  const toast = useToast();

  const load = (pg = page) => {
    api.get(`/provider/ratings?page=${pg}&limit=20`).then((r) => { setRows(r.data); setMeta(r.meta || null); }).catch((e) => toast.error(e.message));
  };
  useEffect(() => { load(); }, [page]);

  const openReply = (row: any) => {
    setReplying(row);
    setReplyText(row.reply || '');
  };

  const submitReply = async () => {
    if (!replying) return;
    setSaving(true);
    try {
      await api.put(`/provider/ratings/${replying.id}/reply`, { reply: replyText.trim() });
      toast.success(replying.reply ? 'تم تحديث ردّك' : 'تم إرسال ردّك');
      setReplying(null);
      load();
    } catch (e: any) { toast.error(e.message); } finally { setSaving(false); }
  };

  if (!rows) return <PageLoading />;

  return (
    <div>
      <div className="page-head">
        <div>
          <h2>التقييمات والمراجعات</h2>
          <p>تقييمات زبائنك بعد إتمام الطلبات — ردّك يظهر بجانب تقييمهم</p>
        </div>
      </div>

      <div className="grid grid-3 mb-4">
        <StatCard label="متوسط التقييم" value={`${meta?.rating ?? 0} / 5`} icon="⭐" tone="success" />
        <StatCard label="عدد التقييمات" value={fmt(meta?.rating_count ?? 0)} icon="💬" tone="info" />
        <StatCard label="بدون رد منك" value={fmt(rows.filter((r: any) => !r.reply).length)} icon="📨" tone="primary" />
      </div>

      <div className="card">
        <div className="table-wrap">
          {rows.length === 0 ? <EmptyState text="لا توجد تقييمات بعد" icon="⭐" /> : (
            <table>
              <thead>
                <tr><th>الزبون</th><th>التقييم</th><th>التعليق</th><th>ردّك</th><th>الطلب</th><th>التاريخ</th><th>إجراءات</th></tr>
              </thead>
              <tbody>
                {rows.map((r: any) => (
                  <tr key={r.id}>
                    <td>
                      <div className="flex gap-sm" style={{ alignItems: 'center' }}>
                        {r.customer_avatar ? <img className="avatar-sm" src={r.customer_avatar} alt="" /> : <div className="avatar avatar-sm">{r.customer_name?.charAt(0) || '؟'}</div>}
                        <div>{r.customer_name || 'زبون'}</div>
                      </div>
                    </td>
                    <td><Stars n={Number(r.rating) || 0} /></td>
                    <td style={{ maxWidth: 280 }}><div className="muted">{r.comment || <span className="muted">بدون تعليق</span>}</div></td>
                    <td style={{ maxWidth: 240 }}>
                      {r.reply ? (
                        <div>
                          <div>{r.reply}</div>
                          <div className="muted" style={{ fontSize: 11 }}>{fmtDate(r.replied_at)}</div>
                        </div>
                      ) : <span className="muted">لم ترد بعد</span>}
                    </td>
                    <td className="mono muted">{r.order_number || '-'}</td>
                    <td className="muted">{fmtDate(r.created_at)}</td>
                    <td><button className="btn btn-outline btn-sm" onClick={() => openReply(r)}>{r.reply ? 'تعديل الرد' : 'ردّ على التقييم'}</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <Pagination meta={meta} page={page} onChange={setPage} />

      <Modal open={!!replying} title={replying ? `الرد على تقييم ${replying.customer_name || 'الزبون'}` : ''} onClose={() => setReplying(null)}>
        {replying && (
          <>
            <div className="card mb-4">
              <div className="card-body">
                <div className="flex gap-sm" style={{ alignItems: 'center', marginBottom: 8 }}>
                  <Stars n={Number(replying.rating) || 0} />
                  <span className="muted" style={{ fontSize: 12 }}>من {replying.customer_name || 'زبون'} · {fmtDate(replying.created_at)}</span>
                </div>
                <div>{replying.comment || <span className="muted">بدون تعليق</span>}</div>
              </div>
            </div>
            <Field label="ردّك (يظهر للزبون وللزوار)">
              <textarea rows={4} value={replyText} onChange={(e) => setReplyText(e.target.value)} placeholder="شكراً على تقييمك... (اختياري، بحد أقصى 1000 حرف)" />
            </Field>
            <div className="form-actions">
              <button className="btn btn-outline" onClick={() => setReplying(null)}>إلغاء</button>
              <button className="btn btn-primary" disabled={saving} onClick={submitReply}>{saving ? 'جاري الحفظ...' : replying.reply ? 'تحديث الرد' : 'إرسال الرد'}</button>
            </div>
          </>
        )}
      </Modal>
    </div>
  );
}
