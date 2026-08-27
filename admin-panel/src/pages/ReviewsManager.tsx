import { useEffect, useState } from 'react';
import { api } from '../api';
import { useToast, fmtDate, PageLoading, EmptyState, Modal, Field, Confirm, Pagination } from '@rafidain/shared/ui';

function Stars({ value = 0 }: { value?: number }) {
  return <span className="stars" title={`${value}/5`}>{'★'.repeat(Number(value))}{'☆'.repeat(5 - Number(value))}</span>;
}

export default function ReviewsManager() {
  const [scope, setScope] = useState<'item' | 'provider'>('item');
  const [rows, setRows] = useState<any>(null);
  const [meta, setMeta] = useState<any>(null);
  const [page, setPage] = useState(1);
  const [providerId, setProviderId] = useState('');
  const [rating, setRating] = useState('');
  const [providers, setProviders] = useState<any[]>([]);
  const [toDelete, setToDelete] = useState<any>(null);
  const [detail, setDetail] = useState<any>(null);
  const toast = useToast();

  useEffect(() => {
    api.get('/providers?limit=300').then((r) => setProviders((r.data && r.data.rows) || [])).catch(() => {});
  }, []);

  const load = (pg = page) => {
    const p = new URLSearchParams();
    p.set('scope', scope);
    if (providerId) p.set('provider_id', providerId);
    if (rating) p.set('rating', rating);
    p.set('page', String(pg));
    p.set('limit', '20');
    api.get(`/reviews?${p}`).then((r) => { setRows(r.data.rows); setMeta(r.data.meta || null); }).catch((e) => toast.error(e.message));
  };
  useEffect(() => { setPage(1); load(1); }, [scope, providerId, rating]);
  useEffect(() => { load(); }, [page]);

  const doDelete = async () => {
    try {
      const res = await api.del(`/reviews/${scope}/${toDelete.id}`);
      toast.success(res.data.message);
      setToDelete(null);
      load();
    } catch (e: any) { toast.error(e.message); }
  };

  return (
    <div>
      <div className="page-head">
        <div>
          <h2>إدارة التقييمات</h2>
          <p>راجع تقييمات الزبائن للمزودين والمنتجات، واحذف ما يخالف السياسة</p>
        </div>
      </div>

      <div className="filters">
        <div className="seg">
          <button className={scope === 'item' ? 'active' : ''} onClick={() => setScope('item')}>تقييمات المنتجات</button>
          <button className={scope === 'provider' ? 'active' : ''} onClick={() => setScope('provider')}>تقييمات المزودين</button>
        </div>
        <select value={providerId} onChange={(e) => setProviderId(e.target.value)}>
          <option value="">كل المزودين</option>
          {providers.map((p) => <option key={p.id} value={p.id}>{p.name_ar}</option>)}
        </select>
        <select value={rating} onChange={(e) => setRating(e.target.value)}>
          <option value="">كل التقييمات</option>
          {[5, 4, 3, 2, 1].map((n) => <option key={n} value={n}>{n} نجوم</option>)}
        </select>
      </div>

      {!rows ? <PageLoading /> : (
        <div className="card">
          <div className="table-wrap">
            {rows.length === 0 ? <EmptyState text="لا توجد تقييمات" icon="⭐" /> : (
              <table>
                <thead>
                  <tr>
                    <th>الزبون</th><th>المزود</th>
                    {scope === 'item' && <th>العنصر</th>}
                    <th>التقييم</th><th>التعليق</th><th>التاريخ</th><th>إجراءات</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r: any) => (
                    <tr key={r.id}>
                      <td>{r.customer_name}</td>
                      <td>{r.provider_name}</td>
                      {scope === 'item' && <td>{r.item_title || r.item_type + ' #' + r.item_id}</td>}
                      <td><Stars value={r.rating} readonly /></td>
                      <td className="maxw200 ellipsis" onClick={() => setDetail(r)} title={r.comment}>{r.comment || '-'}</td>
                      <td className="mono small">{fmtDate(r.created_at)}</td>
                      <td><button className="btn btn-danger btn-sm" onClick={() => setToDelete(r)}>حذف</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      <Pagination meta={meta} page={page} onChange={setPage} />

      <Modal open={!!detail} title="تفاصيل التقييم" onClose={() => setDetail(null)}>
        <div className="detail-grid">
          <Field label="الزبون"><div>{detail?.customer_name}</div></Field>
          <Field label="المزود"><div>{detail?.provider_name}</div></Field>
          {scope === 'item' && <Field label="العنصر"><div>{detail?.item_title || (detail?.item_type + ' #' + detail?.item_id)}</div></Field>}
          <Field label="التقييم"><Stars value={detail?.rating || 0} readonly /></Field>
          <Field label="التاريخ"><div className="mono small">{fmtDate(detail?.created_at)}</div></Field>
        </div>
        <div className="detail-comment">{detail?.comment || 'لا يوجد تعليق'}</div>
      </Modal>

      <Confirm open={!!toDelete} title="حذف تقييم" message="هل أنت متأكد من حذف هذا التقييم؟ لا يمكن التراجع." danger onConfirm={doDelete} onCancel={() => setToDelete(null)} />
    </div>
  );
}
