import { useEffect, useState } from 'react';
import { api } from '../api';
import { useToast, PageLoading, Toggle } from '@rafidain/shared/ui';

export default function HomeLayout() {
  const [sections, setSections] = useState<any[] | null>(null);
  const [saving, setSaving] = useState(false);
  const toast = useToast();

  useEffect(() => {
    api.get('/home-layout').then((r) => setSections(r.data || [])).catch((e) => toast.error(e.message));
  }, []);

  const move = (idx: number, dir: -1 | 1) => {
    if (!sections) return;
    const j = idx + dir;
    if (j < 0 || j >= sections.length) return;
    const copy = [...sections];
    [copy[idx], copy[j]] = [copy[j], copy[idx]];
    copy.forEach((s, i) => (s.order = i + 1));
    setSections(copy);
  };

  const toggle = (key: string) => {
    if (!sections) return;
    setSections(sections.map((s) => (s.key === key ? { ...s, enabled: !s.enabled } : s)));
  };

  const save = async () => {
    if (!sections) return;
    setSaving(true);
    try {
      await api.put('/settings/home_sections', { value: JSON.stringify(sections) });
      toast.success('تم حفظ تخطيط الصفحة الرئيسية');
    } catch (e: any) { toast.error(e.message); } finally { setSaving(false); }
  };

  const reset = async () => {
    setSaving(true);
    try {
      await api.put('/settings/home_sections', { value: '' });
      const r = await api.get('/home-layout');
      setSections(r.data || []);
      toast.success('تمت الاستعادة للإعدادات الافتراضية');
    } catch (e: any) { toast.error(e.message); } finally { setSaving(false); }
  };

  if (!sections) return <PageLoading />;

  return (
    <div>
      <div className="page-head">
        <div>
          <h2>تخطيط الصفحة الرئيسية</h2>
          <p>حدّد الأقسام الظاهرة في تطبيق الزبون وترتيبها بالسحب/الأزرار</p>
        </div>
        <div className="flex">
          <button className="btn btn-outline" onClick={reset} disabled={saving}>استعادة الافتراضي</button>
          <button className="btn btn-primary" onClick={save} disabled={saving}>{saving ? 'جاري الحفظ...' : 'حفظ التخطيط'}</button>
        </div>
      </div>

      <div className="card">
        <table>
          <thead><tr><th>#</th><th>القسم</th><th>الترتيب</th><th>مفعل</th></tr></thead>
          <tbody>
            {sections.map((s, i) => (
              <tr key={s.key}>
                <td className="mono">{s.order}</td>
                <td>{s.label}</td>
                <td>
                  <div className="flex">
                    <button className="btn btn-outline btn-sm" onClick={() => move(i, -1)} disabled={i === 0}>↑</button>
                    <button className="btn btn-outline btn-sm" onClick={() => move(i, 1)} disabled={i === sections.length - 1}>↓</button>
                  </div>
                </td>
                <td><Toggle checked={!!s.enabled} onChange={() => toggle(s.key)} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
