import { useRef, useState } from 'react';
import { api } from '../api';

const MAX = 2 * 1024 * 1024;

function toDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = () => reject(new Error('تعذر قراءة الملف'));
    r.readAsDataURL(file);
  });
}

interface ImageUploadProps {
  value?: string;
  onChange: (v: string) => void;
  hint?: string;
  multiple?: boolean;
}

// مكوّن مشترك لرفع الصور: ملف → /api/upload → /uploads/<file> (يُخزَّن كرابط بدل base64)
export default function ImageUpload({ value = '', onChange, hint, multiple = false }: ImageUploadProps) {
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const list = String(value || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  const onPick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    setBusy(true);
    try {
      const urls = [];
      for (const f of files.slice(0, 5) as File[]) {
        if (!f.type.startsWith('image/')) { alert('الملف يجب أن يكون صورة'); continue; }
        if (f.size > MAX) { alert('حجم الصورة يتجاوز 2MB'); continue; }
        const dataUrl = await toDataUrl(f);
        const res = await api.post('/upload', { data: dataUrl });
        urls.push(res.data.url);
      }
      if (!multiple) {
        onChange(urls[0] || list[0] || '');
      } else {
        onChange(list.concat(urls).join(', '));
      }
    } catch (err: any) {
      alert(err.message || 'فشل رفع الصورة');
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const remove = (u: string) => {
    if (!multiple) { onChange(''); return; }
    onChange(list.filter((x) => x !== u).join(', '));
  };

  return (
    <div>
      <div className="flex" style={{ gap: 8, flexWrap: 'wrap' }}>
        <button type="button" className="btn btn-outline btn-sm" onClick={() => fileRef.current && fileRef.current.click()} disabled={busy}>
          {busy ? 'جاري الرفع...' : '⬆️ رفع صورة'}
        </button>
        <input ref={fileRef} type="file" accept="image/*" multiple={multiple} onChange={onPick} style={{ display: 'none' }} />
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={hint || (multiple ? 'أو الصق روابط مفصولة بفاصلة...' : 'أو الصق رابط صورة...')}
          dir="ltr"
          style={{ flex: 1, minWidth: 180 }}
        />
      </div>
      {list.length > 0 && (
        <div className="flex" style={{ gap: 10, flexWrap: 'wrap', marginTop: 8 }}>
          {list.map((u) => (
            <div key={u} className="upload-thumb">
              <img src={u} alt="" />
              <button type="button" className="upload-thumb__rm" onClick={() => remove(u)} aria-label="حذف الصورة">×</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
