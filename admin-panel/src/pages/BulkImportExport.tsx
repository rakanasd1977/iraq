import { useState, useEffect } from 'react';
import { api } from '../api';
import { useToast, Confirm } from '@rafidain/shared/ui';

const ENTITIES = [
  { key: 'agents', label: 'الوكلاء', icon: '🤝' },
  { key: 'providers', label: 'المزودون', icon: '🏪' },
  { key: 'products', label: 'المنتجات', icon: '📦' },
  { key: 'coupons', label: 'الكوبونات', icon: '🎫' },
];

export default function BulkImportExport() {
  const [entity, setEntity] = useState('agents');
  const [step, setStep] = useState('select'); // select, preview, import
  const [preview, setPreview] = useState<any>(null);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<any>(null);
  const [exportLoading, setExportLoading] = useState(false);
  const toast = useToast();

  const loadTemplate = (e: any) => {
    window.open(`/api/bulk/template/${e}`, '_blank');
    toast.success(`جاري تحميل قالب ${ENTITY_LABELS[e as keyof typeof ENTITY_LABELS]}...`);
  };

  const handleFile = async (file: any) => {
    if (!file.name.endsWith('.csv')) { toast.error('الملف يجب أن يكون CSV'); return; }
    const form = new FormData();
    form.append('file', file);
    try {
      const res = await api.post(`/bulk/preview/${entity}`, form, { headers: { 'Content-Type': 'multipart/form-data' } } as any);
      setPreview(res.data);
      setStep('preview');
    } catch (e: any) { toast.error(e.message); }
  };

  const doImport = async (skipErrors = false) => {
    if (!preview) return;
    setImporting(true);
    try {
      const form = new FormData();
      form.append('file', preview.file);
      form.append('skipErrors', String(skipErrors));
      const res = await api.post(`/bulk/import/${entity}`, form, { headers: { 'Content-Type': 'multipart/form-data' } } as any);
      setImportResult(res.data);
      toast.success(`تم استيراد ${res.data.count} صف بنجاح`);
      setStep('select');
      setPreview(null);
    } catch (e: any) { toast.error(e.message); }
    finally { setImporting(false); }
  };

  const doExport = async () => {
    setExportLoading(true);
    try {
      const res = await api.get(`/bulk/export/${entity}`, { responseType: 'blob' } as any);
      const url = URL.createObjectURL(res.data);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${entity}-export-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast.success('تم تصدير البيانات');
    } catch (e: any) { toast.error(e.message); }
    finally { setExportLoading(false); }
  };

  if (!preview) {
    return (
      <div>
        <div className="page-head">
          <div>
            <h2>الاستيراد والتصدير الجماعي</h2>
            <p>CSV/Excel للوكلاء، المزودين، المنتجات، الكوبونات — مع قالب قابل للتحميل ومعاينة أخطاء قبل الحفظ</p>
          </div>
        </div>

        <div className="grid grid-4 mb-4">
          {ENTITIES.map(e => (
            <div key={e.key} className="card" style={{ cursor: 'pointer', textAlign: 'center', padding: 24 }} onClick={() => setEntity(e.key)}>
              <div style={{ fontSize: 32, marginBottom: 8 }}>{e.icon}</div>
              <div className="bold">{e.label}</div>
              <div className="muted" style={{ fontSize: 13, marginTop: 4 }}>{entity === e.key ? '✓ محدد' : 'اضغط للاختيار'}</div>
            </div>
          ))}
        </div>

        <div className="card">
          <div className="card-header"><h3>الإجراءات: {ENTITY_LABELS[entity as keyof typeof ENTITY_LABELS]}</h3></div>
          <div className="card-body" style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'center' }}>
            <button className="btn btn-primary" onClick={() => loadTemplate(entity)}>
              ⬇ تحميل قالب CSV
            </button>
            <label className="btn btn-outline" style={{ cursor: 'pointer' }}>
              📤 اختيار ملف CSV للمعاينة
              <input type="file" accept=".csv" style={{ display: 'none' }} onChange={(e: any) => handleFile(e.target.files[0])} />
            </label>
            <button className="btn btn-outline" onClick={doExport} disabled={exportLoading}>
              {exportLoading ? 'جاري التصدير...' : '⬇ تصدير البيانات (CSV)'}
            </button>
          </div>
          <div className="alert-info mt-3" style={{ fontSize: 13 }}>
            <strong>خطوات الاستيراد:</strong>
            1) حمّل القالب ← 2) املأ البيانات في Excel/Sheets ← 3) صدّر كـ CSV ← 4) اختر الملف هنا للمعاينة ← 5) راجع الأخطاء ← 6) اضغط استيراد
          </div>
        </div>
      </div>
    );
  }

  // Preview step
  const { total, valid, invalid, preview: previewRows, errors } = preview;

  return (
    <div>
      <div className="page-head flex-between">
        <div>
          <h2>معاينة الاستيراد: {ENTITY_LABELS[entity as keyof typeof ENTITY_LABELS]}</h2>
          <p>إجمالي: {total} صف | صالح: <span className="badge badge-green">{valid}</span> | به أخطاء: <span className="badge badge-red">{invalid}</span></p>
        </div>
        <div className="flex gap-sm">
          <button className="btn btn-outline" onClick={() => { setPreview(null); setStep('select'); }}>← تغيير الجهة</button>
          <button className="btn btn-outline" onClick={() => doImport(false)} disabled={importing || valid === 0}>استيراد (إلغاء عند خطأ)</button>
          {invalid > 0 && (
            <button className="btn btn-warning" onClick={() => doImport(true)} disabled={importing}>
              استيراد مع تخطي الأخطاء ({invalid})
            </button>
          )}
        </div>
      </div>

      {invalid > 0 && (
        <div className="card mb-4">
          <div className="card-header flex-between">
            <h3>الأخطاء ({invalid})</h3>
            <span className="badge badge-red">لن يتم استيراد هذه الصفوف</span>
          </div>
          <div className="table-wrap">
            <table>
              <thead><tr><th>الصف</th><th>الأخطاء</th><th>البيانات</th></tr></thead>
              <tbody>
                {errors.map((e: any, i: any) => (
                  <tr key={i}>
                    <td className="mono">{e.rowNum}</td>
                    <td><span className="badge badge-red">{e.errors.join(', ')}</span></td>
                    <td className="muted mono" style={{ maxWidth: 300, fontSize: 11 }}>{JSON.stringify(e.data).slice(0, 200)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {valid > 0 && (
        <div className="card mb-4">
          <div className="card-header"><h3>بيانات صالحة للمعالجة ({valid}) — أول 50 صف</h3></div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  {previewRows[0] && Object.keys(previewRows[0].data).map(k => <th key={k}>{k}</th>)}
                </tr>
              </thead>
              <tbody>
                {previewRows.map((r: any, i: any) => (
                  <tr key={i}>
                    {Object.values(r.data).map((v, j) => <td key={j} className="muted mono" style={{ fontSize: 12 }}>{String(v).slice(0, 50)}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <Confirm open={!!importResult} title="تم الاستيراد" message={`تم استيراد ${importResult?.count} صف بنجاح${importResult?.errors?.length ? `، أخطاء: ${importResult.errors.length}` : ''}.`} onConfirm={() => { setImportResult(null); setStep('select'); }} onCancel={() => { setImportResult(null); setStep('select'); }} />
    </div>
  );
}

const ENTITY_LABELS = { agents: 'الوكلاء', providers: 'المزودون', products: 'المنتجات', coupons: 'الكوبونات' };