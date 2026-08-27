import { useEffect, useState } from 'react';
import { api } from '../api';
import { useToast, fmt, PageLoading, EmptyState, Modal, Field, Confirm, Toggle, Pagination } from '@rafidain/shared/ui';

const KIND_FIELDS: Record<string, { name: string; label: string; type: 'text' | 'number' | 'bool' }[]> = {
  products: [
    { name: 'name_ar', label: 'الاسم (عربي)', type: 'text' },
    { name: 'price', label: 'السعر (دينار)', type: 'number' },
    { name: 'old_price', label: 'السعر قبل الخصم', type: 'number' },
    { name: 'stock', label: 'المخزون', type: 'number' },
    { name: 'is_featured', label: 'عرض مميز', type: 'bool' },
    { name: 'is_active', label: 'متوفر', type: 'bool' },
  ],
  menu_items: [
    { name: 'name_ar', label: 'الاسم (عربي)', type: 'text' },
    { name: 'price', label: 'السعر (دينار)', type: 'number' },
    { name: 'is_featured', label: 'عرض مميز', type: 'bool' },
    { name: 'is_available', label: 'متوفر الآن', type: 'bool' },
    { name: 'is_active', label: 'مفعل', type: 'bool' },
  ],
  hotel_rooms: [
    { name: 'name_ar', label: 'الاسم (عربي)', type: 'text' },
    { name: 'price_per_night', label: 'السعر لليلة (دينار)', type: 'number' },
    { name: 'max_guests', label: 'الحد الأقصى للنزلاء', type: 'number' },
    { name: 'is_featured', label: 'عرض مميز', type: 'bool' },
    { name: 'is_active', label: 'مفعل', type: 'bool' },
  ],
  flights: [
    { name: 'flight_number', label: 'رقم الرحلة', type: 'text' },
    { name: 'price', label: 'السعر (دينار)', type: 'number' },
    { name: 'seats', label: 'المقاعد المتاحة', type: 'number' },
    { name: 'is_featured', label: 'عرض مميز', type: 'bool' },
    { name: 'is_active', label: 'مفعل', type: 'bool' },
  ],
  travel_packages: [
    { name: 'name_ar', label: 'الاسم (عربي)', type: 'text' },
    { name: 'price', label: 'السعر (دينار)', type: 'number' },
    { name: 'duration_days', label: 'عدد الأيام', type: 'number' },
    { name: 'is_featured', label: 'عرض مميز', type: 'bool' },
    { name: 'is_active', label: 'مفعل', type: 'bool' },
  ],
};

function itemTitle(r: any) {
  return r.name_ar || r.flight_number || r.name_en || `#${r.id}`;
}
function itemPrice(r: any) {
  return r.price_per_night != null ? r.price_per_night : r.price;
}

export default function CatalogManager() {
  const [kinds, setKinds] = useState<any[]>([]);
  const [kind, setKind] = useState('products');
  const [providers, setProviders] = useState<any[]>([]);
  const [rows, setRows] = useState<any>(null);
  const [meta, setMeta] = useState<any>(null);
  const [page, setPage] = useState(1);
  const [q, setQ] = useState('');
  const [providerId, setProviderId] = useState('');
  const [active, setActive] = useState('');
  const [editing, setEditing] = useState<any>(null);
  const [form, setForm] = useState<any>({});
  const [saving, setSaving] = useState(false);
  const [toDelete, setToDelete] = useState<any>(null);
  const toast = useToast();

  useEffect(() => {
    api.get('/catalog/kinds').then((r) => setKinds(r.data || [])).catch(() => {});
    api.get('/providers?limit=300').then((r) => setProviders((r.data && r.data.rows) || [])).catch(() => {});
  }, []);

  const load = (pg = page) => {
    const p = new URLSearchParams();
    if (q) p.set('q', q);
    if (providerId) p.set('provider_id', providerId);
    if (active) p.set('active', active);
    p.set('kind', kind);
    p.set('page', String(pg));
    p.set('limit', '20');
    api.get(`/catalog?${p}`).then((r) => { setRows(r.data.rows); setMeta(r.data.meta || null); }).catch((e) => toast.error(e.message));
  };
  useEffect(() => { setPage(1); load(1); }, [kind, providerId, active]);
  useEffect(() => { load(); }, [page]);

  const search = () => { setPage(1); load(1); };

  const openEdit = (r: any) => {
    const fields = KIND_FIELDS[kind] || [];
    const f: any = {};
    for (const fld of fields) {
      if (fld.type === 'bool') f[fld.name] = Number(r[fld.name]) ? 1 : 0;
      else f[fld.name] = r[fld.name] ?? '';
    }
    setEditing(r);
    setForm(f);
  };

  const save = async () => {
    setSaving(true);
    try {
      const payload: any = {};
      for (const fld of KIND_FIELDS[kind] || []) {
        const v = form[fld.name];
        if (fld.type === 'bool') payload[fld.name] = v ? 1 : 0;
        else if (fld.type === 'number') payload[fld.name] = v === '' || v == null ? undefined : Number(v);
        else payload[fld.name] = v;
      }
      await api.put(`/catalog/${kind}/${editing.id}`, payload);
      toast.success('تم تحديث العنصر');
      setEditing(null);
      load();
    } catch (e: any) { toast.error(e.message); } finally { setSaving(false); }
  };

  const toggle = async (r: any) => {
    try {
      await api.post(`/catalog/${kind}/${r.id}/toggle`);
      toast.success(Number(r.is_active) ? 'تم إيقاف العنصر' : 'تم تفعيل العنصر');
      load();
    } catch (e: any) { toast.error(e.message); }
  };

  const doDelete = async () => {
    try {
      const res = await api.del(`/catalog/${kind}/${toDelete.id}`);
      toast.success(res.data.message);
      setToDelete(null);
      load();
    } catch (e: any) { toast.error(e.message); }
  };

  const priceMode = kind === 'hotel_rooms' ? 'price_per_night' : 'price';

  return (
    <div>
      <div className="page-head">
        <div>
          <h2>كتالوج المتجر</h2>
          <p>تحكّم كامل بكل عناصر المتجر (منتجات، أصناف، غرف، رحلات، باقات) عبر كل المزودين</p>
        </div>
      </div>

      <div className="tabs">
        {(kinds.length ? kinds : [
          { key: 'products', label: 'منتجات' }, { key: 'menu_items', label: 'أصناف' },
          { key: 'hotel_rooms', label: 'غرف' }, { key: 'flights', label: 'رحلات' }, { key: 'travel_packages', label: 'باقات' },
        ]).map((k) => (
          <button key={k.key} className={`tab ${kind === k.key ? 'tab-active' : ''}`} onClick={() => setKind(k.key)}>{k.label}</button>
        ))}
      </div>

      <div className="filters">
        <input placeholder="بحث بالاسم..." value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && search()} />
        <select value={providerId} onChange={(e) => setProviderId(e.target.value)}>
          <option value="">كل المزودين</option>
          {providers.map((p) => <option key={p.id} value={p.id}>{p.name_ar}</option>)}
        </select>
        <select value={active} onChange={(e) => setActive(e.target.value)}>
          <option value="">كل الحالات</option>
          <option value="1">مفعّلة فقط</option>
          <option value="0">متوقفة فقط</option>
        </select>
        <button className="btn btn-outline btn-sm" onClick={search}>بحث</button>
      </div>

      {!rows ? <PageLoading /> : (
        <div className="card">
          <div className="table-wrap">
            {rows.length === 0 ? <EmptyState text="لا توجد عناصر" icon="🛍️" /> : (
              <table>
                <thead>
                  <tr>
                    <th>العنصر</th><th>المزود</th><th>السعر</th><th>خصم</th><th>مميز</th><th>متوفر</th><th>إجراءات</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r: any) => (
                    <tr key={r.id}>
                      <td>
                        <div className="bold">{itemTitle(r)}</div>
                        {r.category_name && <div className="muted" style={{ fontSize: 12 }}>{r.category_name}</div>}
                      </td>
                      <td>{r.provider_name}</td>
                      <td className="mono">{fmt(itemPrice(r))}</td>
                      <td className="mono">{r.old_price ? fmt(r.old_price) : '-'}</td>
                      <td>{Number(r.is_featured) ? '⭐' : '-'}</td>
                      <td><Toggle checked={!!Number(r.is_active)} onChange={() => toggle(r)} /></td>
                      <td>
                        <div className="flex">
                          <button className="btn btn-outline btn-sm" onClick={() => openEdit(r)}>تعديل</button>
                          <button className="btn btn-danger btn-sm" onClick={() => setToDelete(r)}>حذف</button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      <Pagination meta={meta} page={page} onChange={setPage} />

      <Modal open={!!editing} title={`تعديل: ${editing ? itemTitle(editing) : ''}`} onClose={() => setEditing(null)}>
        <div className="form-grid">
          {(KIND_FIELDS[kind] || []).map((fld) => (
            <Field key={fld.name} label={fld.label}>
              {fld.type === 'bool' ? (
                <Toggle checked={!!Number(form[fld.name])} onChange={(v: boolean) => setForm({ ...form, [fld.name]: v ? 1 : 0 })} />
              ) : fld.type === 'number' ? (
                <input type="number" value={form[fld.name] ?? ''} onChange={(e) => setForm({ ...form, [fld.name]: e.target.value })} />
              ) : (
                <input value={form[fld.name] ?? ''} onChange={(e) => setForm({ ...form, [fld.name]: e.target.value })} />
              )}
            </Field>
          ))}
        </div>
        <div className="form-actions">
          <button className="btn btn-outline" onClick={() => setEditing(null)}>إلغاء</button>
          <button className="btn btn-primary" onClick={save} disabled={saving}>{saving ? 'جاري الحفظ...' : 'حفظ'}</button>
        </div>
      </Modal>

      <Confirm
        open={!!toDelete}
        title="حذف عنصر"
        message={`هل أنت متأكد من حذف "${toDelete ? itemTitle(toDelete) : ''}" نهائياً؟ لا يمكن التراجع.`}
        danger
        onConfirm={doDelete}
        onCancel={() => setToDelete(null)}
      />
    </div>
  );
}
