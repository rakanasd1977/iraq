import { useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import { useAuth } from '../auth';
import { useToast, fmt, fmtDate, PageLoading, EmptyState, Modal, Confirm, Field, Badge, Pagination, StatCard } from '@rafidain/shared/ui';
import { CATALOGS } from '../catalog';
import { CatalogConfig, PromoteModalProps, PromotionPreviewProps } from '../types';

export function itemTitle(config: CatalogConfig, row: any) {  if (config.itemType === 'flights') {
    const route = `${row.origin_ar || row.origin || ''} ← ${row.destination_ar || row.destination || ''}`.replace(' ←  ← ', '');
    return `${row.flight_number || ''} ${route}`.trim();
  }
  return row.name_ar || row.name_en || `#${row.id}`;
}

export function PromoteModal({ open, onClose, onCreated, config, preset }: PromoteModalProps) {
  const toast = useToast();
  const [items, setItems] = useState<any>(null);
  const [itemId, setItemId] = useState('');
  const [duration, setDuration] = useState(7);
  const [settings, setSettings] = useState({ price: 5000, duration_days: 7, max_active: 3 });
  const [wallet, setWallet] = useState(0);
  const [govName, setGovName] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setItems(null);
    setItemId(preset ? String(preset.item_id) : '');
    setDuration(7);
    Promise.all([
      api.get(`${config.api}?limit=100`).then((r) => r.data).catch(() => []),
      api.get('/promotions').then((r) => {
        setSettings(r.meta.settings);
        setWallet(r.meta.wallet_balance);
        setGovName(r.meta.governorate_name_ar || '');
        setDuration(r.meta.settings.duration_days || 7);
        return null;
      }).catch(() => null),
    ]).then(([list]) => setItems(list.filter((x: any) => Number(x.is_active) !== 0)));
  }, [open, preset, config]);

  const cost = useMemo(() => {
    const base = Math.max(1, settings.duration_days || 7);
    return Math.round((settings.price / base) * Math.max(1, Number(duration) || 1) * 100) / 100;
  }, [settings, duration]);

  if (!open) return null;

  const save = async () => {
    if (!itemId) return toast.error('اختر عنصراً للترويج أولاً');
    setSaving(true);
    try {
      await api.post('/promotions', { item_type: config.itemType, item_id: Number(itemId), duration_days: Number(duration) });
      toast.success('تم تفعيل الترويج بنجاح، سيظهر للزبائن في محافظتك');
      onCreated && onCreated();
      onClose();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  };

  const selected = items ? items.find((x: any) => String(x.id) === String(itemId)) : null;

  return (
    <Modal open title="روّج عنصرك واعرضه أمام زبائن محافظتك" onClose={onClose} size="lg">
      <div className="alert-info mb-4">
        📢 سيظهر الإعلان للزبائن في محافظة <strong>{govName}</strong> فقط لمدة الترويج، ويُخصم ثمنه من محفظتك فوراً. يمكنك إيقافه أو تمديده في أي وقت.
      </div>
      <div className="grid grid-2">
        <Field label="العنصر المراد ترويجه" required full>
          {!items ? (
            <div className="muted">جاري تحميل {config.title}...</div>
          ) : (
            <select value={itemId} onChange={(e) => setItemId(e.target.value)}>
              <option value="">اختر {config.item}...</option>
              {items.map((it: any) => (
                <option key={it.id} value={it.id}>{itemTitle(config, it)} — {fmt(it.price || it.price_per_night)} د.ع</option>
              ))}
            </select>
          )}
        </Field>
        <Field label="مدة الترويج (بالأيام)" required>
          <select value={duration} onChange={(e) => setDuration(Number(e.target.value))}>
            {[1, 3, 7, 14, 30].map((d) => (
              <option key={d} value={d}>{d} يوم{d > 1 ? '' : ''}</option>
            ))}
          </select>
        </Field>
      </div>

      {selected && (
        <div className="promo-summary">
          <div className="flex-between">
            <div>
              <div className="bold">{itemTitle(config, selected)}</div>
              <div className="muted" style={{ fontSize: 12 }}>
                السعر: {fmt(selected.price || selected.price_per_night)} د.ع · الحالة: {Number(selected.is_active) ? 'متوفر' : 'موقوف'}
              </div>
            </div>
            <div style={{ textAlign: 'left' }}>
              <div className="muted" style={{ fontSize: 12 }}>تكلفة الترويج</div>
              <div className="stat-value" style={{ color: 'var(--danger)' }}>{fmt(cost)} د.ع</div>
            </div>
          </div>
          <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>
            رصيد محفظتك: <strong className={wallet >= cost ? 'text-success' : 'text-danger'}>{fmt(wallet)} د.ع</strong>
            {wallet < cost && ' — رصيد غير كافٍ! اشحن محفظتك أولاً'}
          </div>
        </div>
      )}

      <div className="flex gap-sm" style={{ justifyContent: 'flex-end', marginTop: 16 }}>
        <button className="btn btn-outline" onClick={onClose}>إلغاء</button>
        <button className="btn btn-primary" onClick={save} disabled={saving || (wallet < cost)}>
          {saving ? 'جاري التفعيل...' : `فعّل الترويج (${fmt(cost)} د.ع)`}
        </button>
      </div>
    </Modal>
  );
}

export function fmtIQD(n: number | string) {
  return `${Number(n || 0).toLocaleString('en-US')} د.ع`;
}

export function PromotionPreview({ open, row, onClose }: PromotionPreviewProps) {
  if (!open || !row) return null;
  const linkLabel = ({ products: 'صفحة المنتجات', menu_items: 'قائمة الطعام', hotel_rooms: 'صفحة الغرف', flights: 'صفحة الرحلات', travel_packages: 'صفحة الباقات' } as Record<string, string>)[row.item_type] || 'صفحة العنصر';
  return (
    <Modal open title="معاينة الإعلان كما يراه الزبون" onClose={onClose} size="sm">
      <div className="alert-info mb-4">
        هكذا سيظهر إعلانك لزبائن محافظة <strong>{row.governorate_name_ar}</strong> في سطر الإعلانات بجوال الزبون.
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
          <div className="ad-preview__price">{fmtIQD(row.item_price)}</div>
        </div>
      </div>
      <div className="muted" style={{ fontSize: 12, marginTop: 10 }}>
        عند النقر ينتقل الزبون إلى {linkLabel}. المتبقي {row.remaining_days} يوم من الترويج.
      </div>
      <div className="flex gap-sm" style={{ justifyContent: 'flex-end', marginTop: 16 }}>
        <button className="btn btn-primary" onClick={onClose}>إغلاق</button>
      </div>
    </Modal>
  );
}

export default function Promotions() {
  const toast = useToast();
  const { user } = useAuth();
  const [rows, setRows] = useState<any>(null);
  const [meta, setMeta] = useState<any>(null);
  const [page, setPage] = useState(1);
  const [promoOpen, setPromoOpen] = useState(false);
  const [preset, setPreset] = useState<any>(null);
  const [extendTarget, setExtendTarget] = useState<any>(null);
  const [endTarget, setEndTarget] = useState<any>(null);
  const [previewTarget, setPreviewTarget] = useState<any>(null);
  const [busy, setBusy] = useState(false);

  const config = useMemo<CatalogConfig>(() => (CATALOGS as Record<string, any>)[user?.service_type] || CATALOGS.stores, [user]);

  const load = (pg = page) => {
    api.get(`/promotions?page=${pg}&limit=20`).then((r) => {
      setRows(r.data);
      setMeta(r.meta);
    }).catch((e) => toast.error(e.message));
  };

  useEffect(() => { load(); }, [page]);

  const openPromote = (row: any) => {
    setPreset(row ? { item_id: row.id, title: itemTitle(config, row) } : null);
    setPromoOpen(true);
  };

  const extend = async () => {
    setBusy(true);
    try {
      await api.post(`/promotions/${extendTarget.id}/extend`);
      toast.success(`تم تمديد "${extendTarget.item_title}" بنجاح`);
      setExtendTarget(null);
      load();
    } catch (e: any) { toast.error(e.message); } finally { setBusy(false); }
  };

  const end = async () => {
    setBusy(true);
    try {
      await api.del(`/promotions/${endTarget.id}`);
      toast.success('تم إيقاف الترويج، لن يظهر بعد الآن');
      setEndTarget(null);
      load();
    } catch (e: any) { toast.error(e.message); } finally { setBusy(false); }
  };

  if (!rows) return <PageLoading />;

  const settings = meta?.settings || {};
  const costPerDay = settings.duration_days ? Math.round(settings.price / settings.duration_days) : settings.price;

  return (
    <div>
      <div className="page-head">
        <div>
          <h2>الترويج والإعلانات</h2>
          <p>اعرض عناصرك وعروضك أمام زبائن محافظة {meta?.governorate_name_ar || ''} وأقفل النقرات والظهور</p>
        </div>
        <button className="btn btn-primary" onClick={() => openPromote(null)}>+ روّج عنصراً</button>
      </div>

      <div className="grid grid-3 mb-4">
        <StatCard label="رصيد المحفظة" value={`${fmt(meta?.wallet_balance ?? 0)} د.ع`} icon="👛" tone="success" />
        <StatCard label={`تكلفة الفترة (${settings.duration_days || 7} أيام)`} value={`${fmt(settings.price ?? 5000)} د.ع`} icon="💰" tone="accent" />
        <StatCard label="ترويجات نشطة" value={`${meta?.active_count ?? 0} / ${settings.max_active ?? 3}`} icon="📢" tone="info" />
      </div>

      <div className="grid grid-3 mb-4" style={{ marginTop: -12 }}>
        <StatCard label="إجمالي الظهور" value={fmt(meta?.impressions ?? 0)} icon="👁" tone="primary" />
        <StatCard label="إجمالي النقرات" value={fmt(meta?.clicks ?? 0)} icon="🖱️" tone="info" />
        <StatCard label="نسبة النقر (CTR)" value={`${meta?.ctr ?? 0}%`} icon="📈" tone="success" />
      </div>

      <div className="card">
        <div className="table-wrap">
          {rows.length === 0 ? <EmptyState text="لا توجد ترويجات بعد — اضغط زر «روّج عنصراً»" icon="📢" /> : (
            <table>
              <thead>
                <tr>
                  <th>العنصر</th>
                  <th>التكلفة</th>
                  <th>المدة</th>
                  <th>الحالة</th>
                  <th>الظهور</th>
                  <th>النقرات</th>
                  <th>CTR</th>
                  <th>إجراءات</th>
                </tr>
              </thead>
              <tbody>
                 {rows.map((row: any) => (
                  <tr key={row.id}>
                    <td>
                      <div className="bold">{row.item_title}</div>
                      <div className="muted" style={{ fontSize: 12 }}>{fmt(row.item_price)} د.ع</div>
                    </td>
                    <td className="bold">{fmt(row.cost)} د.ع</td>
                    <td style={{ fontSize: 13 }}>
                      {fmtDate(row.starts_at)}<br />
                      <span className="muted">إلى {fmtDate(row.ends_at)}</span>
                      {row.remaining_days !== null && <div className="muted" style={{ fontSize: 12 }}>متبقي {row.remaining_days} يوم</div>}
                    </td>
                    <td>
                      <Badge status={row.status} map={{ active: { label: 'نشط', cls: 'badge-green' }, ended: { label: 'منتهي', cls: 'badge-gray' } }} />
                    </td>
                    <td>{fmt(row.impressions)}</td>
                    <td>{fmt(row.clicks)}</td>
                    <td>
                      <span className={row.ctr >= 1 ? 'text-success' : 'muted'}>{row.ctr != null ? `${row.ctr}%` : '0%'}</span>
                    </td>
                    <td>
                      <div className="flex gap-sm">
                        <button className="btn btn-outline btn-sm" onClick={() => setPreviewTarget(row)} title="شاهد الإعلان كما يراه الزبون">👁 معاينة</button>
                        {row.status === 'active' && (
                          <>
                            <button className="btn btn-outline btn-sm" onClick={() => setExtendTarget(row)}>تمديد</button>
                            <button className="btn btn-outline btn-sm btn-danger-ghost" onClick={() => setEndTarget(row)}>إيقاف</button>
                          </>
                        )}
                        {row.status === 'active' && <span className="muted" style={{ fontSize: 12 }}>≈{fmt(costPerDay)} د.ع/يوم</span>}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <Pagination meta={meta} page={page} onChange={setPage} />

      <PromoteModal open={promoOpen} onClose={() => { setPromoOpen(false); setPreset(null); }} onCreated={() => load()} config={config} preset={preset} />

      <PromotionPreview open={!!previewTarget} row={previewTarget} onClose={() => setPreviewTarget(null)} />

      <Confirm
        open={!!extendTarget}
        title="تمديد الترويج"
        message={`تمديد "${extendTarget?.item_title}" لمدة ${settings.duration_days || 7} أيام إضافية مقابل ${fmt(settings.price ?? 5000)} د.ع تُخصم من محفظتك. متابعة؟`}
        confirmText="تمديد ودفع"
        onCancel={() => setExtendTarget(null)}
        onConfirm={extend}
      />
      <Confirm
        open={!!endTarget}
        title="إيقاف الترويج"
        message={`إيقاف ترويج "${endTarget?.item_title}"؟ لن يظهر بعد الآن ولا يُسترد المبلغ المدفوع.`}
        confirmText="إيقاف"
        danger
        onCancel={() => setEndTarget(null)}
        onConfirm={end}
      />
    </div>
  );
}
