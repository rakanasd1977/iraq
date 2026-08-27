import { useEffect, useState } from 'react';
import { api } from '../api';
import { useToast, fmt, fmtDate, PageLoading, EmptyState, Confirm, Badge, Modal, Field, Pagination, StatCard } from '@rafidain/shared/ui';
import { useStaticLists } from '@rafidain/shared';

const SERVICE_ITEM_TYPES = {
  stores: 'products',
  restaurants: 'menu_items',
  hotels: 'hotel_rooms',
  flights: 'flights',
  travel_offices: 'travel_packages',
};

const ITEM_TYPE_LABELS = {
  products: 'منتج',
  menu_items: 'صنف قائمة',
  hotel_rooms: 'غرفة',
  flights: 'رحلة جوية',
  travel_packages: 'باقة سفر',
};

const PROMO_STATUS = {
  active: { label: 'نشط', cls: 'badge-green' },
  ended: { label: 'منتهي', cls: 'badge-gray' },
};

const PLACEMENT_LABELS: Record<string, string> = {
  home_top: 'أعلى الصفحة',
  most_ordered: 'الأكثر طلباً',
};

function remainingDays(row: any) {
  if (!row.ends_at) return null;
  const d = new Date(row.ends_at.replace(' ', 'T') + 'Z');
  return Math.max(0, Math.ceil((d.getTime() - Date.now()) / 86400000));
}

const LINK_LABELS = {
  products: 'صفحة المنتجات',
  menu_items: 'قائمة الطعام',
  hotel_rooms: 'صفحة الغرف',
  flights: 'صفحة الرحلات',
  travel_packages: 'صفحة الباقات',
};

export function AdPreviewModal({ open, row, onClose }: { open: any; row: any; onClose: any }) {
  if (!open || !row) return null;
  const days = remainingDays(row);
  return (
    <Modal open title="معاينة الإعلان كما يراه الزبون" onClose={onClose} size="sm">
      <div className="alert-info mb-4">
        هكذا يظهر الإعلان لزبائن محافظة <strong>{row.governorate_name_ar}</strong> في سطر الإعلانات بجوال الزبون.
      </div>
      <div className="ad-preview">
        {row.item_image ? (
          <img src={row.item_image} alt={row.item_title} className="ad-preview__img" />
        ) : (
          <div className="ad-preview__img ad-preview__img--placeholder">{row.service_icon || '📢'}</div>
        )}
        <div className="ad-preview__body">
          <span className="ad-preview__badge">إعلان 📣</span>
          <div className="ad-preview__title">{row.item_title}</div>
          <div className="ad-preview__sub">{row.provider_name} · {row.service_name_ar}</div>
          <div className="ad-preview__price">{fmt(row.item_price)} د.ع</div>
        </div>
      </div>
      <div className="muted" style={{ fontSize: 12, marginTop: 10 }}>
        عند النقر ينتقل الزبون إلى {(LINK_LABELS as any)[row.item_type] || 'صفحة العنصر'}.{' '}
        {days !== null ? `متبقي ${days} يوم من الترويج.` : 'ترويج مفتوح المدة.'}
      </div>
      <div className="flex gap-sm" style={{ justifyContent: 'flex-end', marginTop: 16 }}>
        <button className="btn btn-primary" onClick={onClose}>إغلاق</button>
      </div>
    </Modal>
  );
}

export function CreateAdModal({ open, onClose, governorates, settings, onCreated }: { open: any; onClose: any; governorates: any; settings: any; onCreated: any }) {
  const toast = useToast();
  const [providers, setProviders] = useState<any[]>([]);
  const [balances, setBalances] = useState<Record<number, number>>({});
  const [form, setForm] = useState({ provider_id: '', item_id: '', duration_days: settings?.duration_days || 7, target: 'governorate', governorate_ids: [] as number[], billing: 'wallet', placement: 'home_top' });
  const [items, setItems] = useState<any>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setForm({ provider_id: '', item_id: '', duration_days: settings?.duration_days || 7, target: 'governorate', governorate_ids: [] as number[], billing: 'wallet', placement: 'home_top' });
    setItems(null);
    setBalances({});
    api.get('/providers?limit=100').then((r) => setProviders(r.data || [])).catch(() => {});
    api.get('/wallets?limit=200').then((r) => {
      const map: Record<number, number> = {};
      (r.data || []).forEach((w: any) => { map[Number(w.provider_id)] = Number(w.balance) || 0; });
      setBalances(map);
    }).catch(() => {});
  }, [open]);

  const provider = providers.find((p) => Number(p.id) === Number(form.provider_id));
  const itemType = provider ? (SERVICE_ITEM_TYPES as any)[provider.service_slug] : null;

  useEffect(() => {
    if (!form.provider_id || !itemType) { setItems(null); return; }
    let alive = true;
    setItems(null);
    api.get(`/promotions/admin/items?provider_id=${form.provider_id}&item_type=${itemType}`)
      .then((r) => { if (alive) setItems(r.data || []); })
      .catch((e) => { if (alive) { setItems([]); toast.error(e.message); } });
    return () => { alive = false; };
  }, [form.provider_id, itemType]);

  const selectProvider = (id: any) => {
    const p = providers.find((x) => Number(x.id) === Number(id));
    setForm((f) => ({
      ...f,
      provider_id: id,
      item_id: '',
      governorate_ids: p ? [Number(p.governorate_id)] : f.governorate_ids,
    }));
  };

  const toggleGov = (id: any) => {
    const n = Number(id);
    setForm((f) => ({
      ...f,
      governorate_ids: f.governorate_ids.includes(n)
        ? f.governorate_ids.filter((x) => x !== n)
        : [...f.governorate_ids, n],
    }));
  };

  const unitCost = (() => {
    const price = Number(settings?.price) || 5000;
    const base = Math.max(1, Number(settings?.duration_days) || 7);
    const days = Math.max(1, Number(form.duration_days) || base);
    return (price / base) * days;
  })();
  const count = form.target === 'all' ? governorates.length : form.governorate_ids.length;
  const cost = form.billing === 'wallet' ? unitCost * count : 0;
  const balance = Number(balances[Number(form.provider_id)]) || 0;
  const insufficient = form.billing === 'wallet' && form.provider_id && balance < cost;

  const submit = async () => {
    if (!form.provider_id) return toast.error('اختر مزود الخدمة');
    if (!form.item_id) return toast.error('اختر العنصر الذي سيُروَّج');
    const days = Number(form.duration_days);
    if (!days || days < 1 || days > 90) return toast.error('المدة بالأيام بين 1 و90');
    if (form.target === 'governorate' && form.governorate_ids.length === 0) return toast.error('اختر محافظة واحدة على الأقل');
    if (insufficient) return toast.error(`رصيد محفظة المزود غير كافٍ (${fmt(balance)} د.ع) لهذه التكلفة`);
    setSaving(true);
    try {
      const res =       await api.post('/promotions/admin/create', {
        provider_id: Number(form.provider_id),
        item_type: itemType,
        item_id: Number(form.item_id),
        duration_days: days,
        target: form.target,
        governorate_ids: form.governorate_ids,
        billing: form.billing,
        placement: form.placement,
      });
      toast.success(`تم إنشاء الإعلان "${res.data.item_title}"`);
      onCreated(res.data);
      onClose();
    } catch (e: any) { toast.error(e.message); } finally { setSaving(false); }
  };

  return (
    <Modal open={open} title="إنشاء إعلان مستهدف" onClose={onClose} size="lg">
      <div className="form-grid">
        <Field label="مزود الخدمة" required>
          <select value={form.provider_id} onChange={(e) => selectProvider(e.target.value)}>
            <option value="">— اختر المزود —</option>
            {providers.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name_ar} · {p.service_name_ar} · {p.governorate_name_ar}
              </option>
            ))}
          </select>
        </Field>
        <Field label="العنصر المُروَّج" required hint={itemType ? `نوع الخدمة: ${(ITEM_TYPE_LABELS as any)[itemType] || itemType}` : 'اختر المزود أولاً لتحديد نوع العنصر'}>
          <select value={form.item_id} onChange={(e) => setForm({ ...form, item_id: e.target.value })} disabled={!provider}>
            <option value="">{items === null ? 'جاري تحميل العناصر...' : (items && items.length ? '— اختر العنصر —' : 'لا توجد عناصر مفعّلة لهذا المزود')}</option>
            {(items || []).map((it: any) => <option key={it.id} value={it.id}>{it.title} · {fmt(it.price)} د.ع</option>)}
          </select>
        </Field>
        <Field label="المدة (بالأيام)" required hint="بين 1 و90 يوماً">
          <input type="number" min="1" max="90" value={form.duration_days} onChange={(e) => setForm({ ...form, duration_days: e.target.value })} />
        </Field>
        <Field label="الفوترة" hint="مجاني = يظهر بلا خصم من المحفظة">
          <select value={form.billing} onChange={(e) => setForm({ ...form, billing: e.target.value })}>
            <option value="wallet">خصم من محفظة المزود</option>
            <option value="free">إعلان مجاني (من الإدارة)</option>
          </select>
        </Field>
        <Field label="موضع الإعلان" hint="أين يظهر للزبون في تطبيق الجوال">
          <select value={form.placement} onChange={(e) => setForm({ ...form, placement: e.target.value })}>
            <option value="home_top">أعلى الصفحة (تحت محرك البحث)</option>
            <option value="most_ordered">قسم «الأكثر طلباً»</option>
          </select>
        </Field>
      </div>

      <Field label="نطاق الاستهداف" required full>
        <div className="flex gap-sm" style={{ gap: 16 }}>
          <label className="flex" style={{ gap: 6, alignItems: 'center', fontWeight: 600, fontSize: 13 }}>
            <input type="radio" checked={form.target === 'governorate'} onChange={() => setForm({ ...form, target: 'governorate' })} />
            محافظات محددة ({form.governorate_ids.length})
          </label>
          <label className="flex" style={{ gap: 6, alignItems: 'center', fontWeight: 600, fontSize: 13 }}>
            <input type="radio" checked={form.target === 'all'} onChange={() => setForm({ ...form, target: 'all' })} />
            كل المحافظات ({governorates.length})
          </label>
        </div>
      </Field>

      {form.target === 'governorate' && (
        <div className="card" style={{ marginTop: 4, padding: 12 }}>
          <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>
            يُظهر الإعلان لزبائن المحافظات المحددة فقط — حددها بالأسفل (افتراضياً محافظة المزود).
          </div>
          <div style={{ maxHeight: 190, overflowY: 'auto', display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '6px 10px' }}>
            {governorates.map((g: any) => (
              <label key={g.id} className="flex" style={{ gap: 6, alignItems: 'center', fontSize: 13 }}>
                <input type="checkbox" checked={form.governorate_ids.includes(Number(g.id))} onChange={() => toggleGov(g.id)} />
                {g.name_ar}
              </label>
            ))}
          </div>
        </div>
      )}

      <div className="alert-info mt-4" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
        <div>
          <div className="bold">التكلفة المقدرة: {fmt(Math.round(cost))} د.ع</div>
          <div className="muted" style={{ fontSize: 12 }}>
            {form.billing === 'wallet'
              ? `${fmt(unitCost)} د.ع × ${count} ${count === 1 ? 'محافظة' : 'محافظة'} — رصيد المزود الآن: ${fmt(balance)} د.ع`
              : 'إعلان مجاني لا يُخصم من المحفظة'}
            {insufficient && <span className="text-danger"> — الرصيد غير كافٍ!</span>}
          </div>
        </div>
        <span className="badge badge-primary">{form.target === 'all' ? 'كل المحافظات' : `${form.governorate_ids.length} محافظة`}</span>
      </div>

      <div className="form-actions">
        <button className="btn btn-outline" onClick={onClose}>إلغاء</button>
        <button className="btn btn-primary" onClick={submit} disabled={saving}>{saving ? 'جاري الإنشاء...' : 'إنشاء الإعلان'}</button>
      </div>
    </Modal>
  );
}

export default function Promotions() {
  const toast = useToast();
  const [rows, setRows] = useState<any>(null);
  const [meta, setMeta] = useState<any>(null);
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');
  const [placement, setPlacement] = useState('');
  const [governorateId, setGovernorateId] = useState('');
  const [serviceId, setServiceId] = useState('');
  const [q, setQ] = useState('');
  const [qApplied, setQApplied] = useState('');
  const { governorates, services, loading: listsLoading } = useStaticLists(api);
  const [previewTarget, setPreviewTarget] = useState<any>(null);
  const [endTarget, setEndTarget] = useState<any>(null);
  const [createOpen, setCreateOpen] = useState(false);

  const load = (pg = page) => {
    const p = new URLSearchParams();
    if (status) p.set('status', status);
    if (placement) p.set('placement', placement);
    if (governorateId) p.set('governorate_id', governorateId);
    if (serviceId) p.set('service_id', serviceId);
    if (qApplied) p.set('q', qApplied);
    p.set('page', String(pg));
    p.set('limit', '20');
    api.get(`/promotions/all?${p}`).then((r) => {
      setRows(r.data);
      setMeta(r.meta || null);
    }).catch((e) => toast.error(e.message));
  };

  useEffect(() => { load(); }, [page, status, placement, governorateId, serviceId, qApplied]);
  useEffect(() => { setPage(1); }, [status, placement, governorateId, serviceId, qApplied]);

  const submitSearch = () => setQApplied(q.trim());

  const exportCsv = async () => {
    const p = new URLSearchParams();
    if (status) p.set('status', status);
    if (governorateId) p.set('governorate_id', governorateId);
    if (serviceId) p.set('service_id', serviceId);
    if (qApplied) p.set('q', qApplied);
    try {
      const res = await fetch(`/api/promotions/all/export?${p}`, { credentials: 'include' });
      if (!res.ok) throw new Error('فشل التصدير');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `promotions-${Date.now()}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast.success('تم تصدير الإعلانات CSV');
    } catch (e: any) {
      toast.error(e.message || 'فشل التصدير');
    }
  };

  const end = async () => {
    try {
      await api.del(`/promotions/${endTarget.id}`);
      toast.success(`تم إيقاف الإعلان "${endTarget.item_title}" — لن يظهر للزبائن بعد الآن`);
      setEndTarget(null);
      load();
    } catch (e: any) { toast.error(e.message); }
  };

  if (!rows) return <PageLoading />;

  const s = meta?.settings || {};
  const costPerDay = s.duration_days ? Math.round(s.price / s.duration_days) : s.price;

  return (
    <div>
      <div className="page-head">
        <div>
          <h2>الإعلانات والترويج</h2>
          <p>جميع إعلانات مزودي الخدمة في كل المحافظات — إشراف وإدارة لما يظهر في تطبيق الزبون</p>
        </div>
        <div className="flex" style={{ gap: 8 }}>
          <button className="btn btn-primary" onClick={() => setCreateOpen(true)}>＋ إنشاء إعلان</button>
          <button className="btn btn-outline" onClick={exportCsv}>⬇ تصدير CSV</button>
        </div>
      </div>

      <div className="alert-success mb-4">
        📣 يعلن المزودون بأنفسهم من زر «روّج عنصراً» في لوحة المزود وتُخصم التكلفة من محفظتهم فوراً،
        والإعلان يظهر تلقائياً هنا ولزبائن محافظتهم في تطبيق الزبون. هنا تُراقب الأداء وتوقف أي إعلان،
        أو أنشئ إعلاناً مستهدفاً بنفسك لأي مزود على محافظة أو أكثر أو كل المحافظات (خصم من المحفظة أو مجاناً).
        سعر الفترة {fmt(s.price ?? 5000)} د.ع لكل {s.duration_days || 7} أيام — حد أقصى {s.max_active || 3} إعلان نشط لكل مزود.
      </div>

      <div className="grid grid-4 mb-4">
        <StatCard label="إعلانات نشطة" value={fmt(meta?.total_active ?? 0)} icon="📢" tone="success" />
        <StatCard label="الإيراد النشط" value={`${fmt(meta?.active_revenue ?? 0)} د.ع`} icon="💰" tone="accent" />
        <StatCard label="الظهور الكلي" value={fmt(meta?.total_impressions ?? 0)} icon="👁" tone="info" />
        <StatCard label="النقرات الكلية" value={fmt(meta?.total_clicks ?? 0)} icon="🖱️" tone="primary" />
      </div>

      <div className="filters">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') submitSearch(); }}
          placeholder="بحث باسم المزود..."
          style={{ minWidth: 180 }}
        />
        <button className="btn btn-outline" onClick={submitSearch}>بحث</button>
        <select value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">كل الحالات</option>
          <option value="active">نشط</option>
          <option value="ended">منتهي</option>
        </select>
        <select value={placement} onChange={(e) => setPlacement(e.target.value)}>
          <option value="">كل المواضع</option>
          <option value="home_top">أعلى الصفحة</option>
          <option value="most_ordered">الأكثر طلباً</option>
        </select>
        <select value={governorateId} disabled={listsLoading} onChange={(e) => setGovernorateId(e.target.value)}>
          <option value="">{listsLoading ? 'جارٍ التحميل...' : 'كل المحافظات'}</option>
          {governorates.map((g) => <option key={g.id} value={g.id}>{g.name_ar}</option>)}
        </select>
        <select value={serviceId} disabled={listsLoading} onChange={(e) => setServiceId(e.target.value)}>
          <option value="">{listsLoading ? 'جارٍ التحميل...' : 'كل الخدمات'}</option>
          {services.map((sv) => <option key={sv.id} value={sv.id}>{sv.name_ar}</option>)}
        </select>
      </div>

      <div className="card">
        <div className="table-wrap">
          {rows.length === 0 ? <EmptyState text="لا توجد إعلانات مطابقة" icon="📢" /> : (
            <table>
              <thead>
                <tr>
                  <th>الإعلان</th>
                   <th>المزود</th>
                   <th>المحافظة</th>
                   <th>الموضع</th>
                   <th>المدة</th>
                  <th>التكلفة</th>
                  <th>الظهور</th>
                  <th>النقرات</th>
                  <th>CTR</th>
                  <th>الحالة</th>
                  <th>إجراءات</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row: any) => {
                  const days = remainingDays(row);
                  return (
                    <tr key={row.id}>
                      <td>
                        <div className="flex" style={{ gap: 8, alignItems: 'center' }}>
                          {row.item_image ? (
                            <img src={row.item_image} alt="" style={{ width: 44, height: 44, objectFit: 'cover', borderRadius: 8 }} />
                          ) : (
                            <div style={{ width: 44, height: 44, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#fff1f0', fontSize: 20 }}>{row.service_icon || '📢'}</div>
                          )}
                          <div>
                            <div className="bold">{row.item_title}</div>
                            <div className="muted" style={{ fontSize: 12 }}>{fmt(row.item_price)} د.ع · {(LINK_LABELS as any)[row.item_type] || row.item_type}</div>
                          </div>
                        </div>
                      </td>
                      <td>
                        <div className="bold" style={{ fontSize: 13 }}>{row.provider_name}</div>
                        <div className="muted" style={{ fontSize: 11 }}>{row.service_name_ar}</div>
                      </td>
                       <td>
                         {row.target_type === 'all' ? 'كل المحافظات' : (row.target_count > 1 ? row.target_label : row.governorate_name_ar)}
                         {row.target_count > 1 && <div className="muted" style={{ fontSize: 11 }}>{row.target_count} محافظة</div>}
                       </td>
                       <td>
                         <span className="badge badge-info">{(PLACEMENT_LABELS as any)[row.placement] || row.placement || 'أعلى الصفحة'}</span>
                       </td>
                      <td style={{ fontSize: 13 }}>
                        {fmtDate(row.starts_at)}<br />
                        <span className="muted">إلى {fmtDate(row.ends_at)}</span>
                        {days !== null && <div className="muted" style={{ fontSize: 12 }}>متبقي {days} يوم</div>}
                      </td>
                      <td className="bold">{fmt(row.cost)} د.ع</td>
                      <td>{fmt(row.impressions)}</td>
                      <td>{fmt(row.clicks)}</td>
                      <td>
                        <span className={row.ctr >= 1 ? 'text-success' : 'muted'}>{row.ctr != null ? `${row.ctr}%` : '0%'}</span>
                      </td>
                      <td><Badge status={row.status} map={PROMO_STATUS} /></td>
                      <td>
                        <div className="flex" style={{ gap: 6 }}>
                          <button className="btn btn-outline btn-sm" onClick={() => setPreviewTarget(row)} title="شاهد الإعلان كما يراه الزبون">👁 معاينة</button>
                          {row.status === 'active' && (
                            <button className="btn btn-outline btn-sm btn-danger-ghost" onClick={() => setEndTarget(row)}>إيقاف</button>
                          )}
                          {row.status === 'active' && <span className="muted" style={{ fontSize: 12 }}>≈{fmt(costPerDay)} د.ع/يوم</span>}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <Pagination meta={meta} page={page} onChange={setPage} />

      <AdPreviewModal open={!!previewTarget} row={previewTarget} onClose={() => setPreviewTarget(null)} />

      <CreateAdModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        governorates={governorates}
        settings={s}
        onCreated={() => load()}
      />

      <Confirm
        open={!!endTarget}
        title="إيقاف الإعلان"
        message={`إيقاف إعلان "${endTarget?.item_title}" للمزود «${endTarget?.provider_name}»؟ لن يظهر للزبائن بعد الآن ولا يُسترد المبلغ المدفوع.`}
        confirmText="إيقاف"
        danger
        onCancel={() => setEndTarget(null)}
        onConfirm={end}
      />
    </div>
  );
}
