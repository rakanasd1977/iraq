const enc = encodeURIComponent;

interface ShareOption {
  id: string;
  label: string;
  icon: string;
  build: (u: string, t: string) => string;
}

const OPTIONS: ShareOption[] = [
  { id: 'whatsapp', label: 'واتساب', icon: '💬', build: (u, t) => `https://wa.me/?text=${enc(t + '\n' + u)}` },
  { id: 'telegram', label: 'تيليجرام', icon: '📨', build: (u, t) => `https://t.me/share/url?url=${enc(u)}&text=${enc(t)}` },
  { id: 'facebook', label: 'فيسبوك', icon: '📘', build: (u) => `https://www.facebook.com/sharer/sharer.php?u=${enc(u)}` },
  { id: 'twitter', label: 'إكس', icon: '🐦', build: (u, t) => `https://twitter.com/intent/tweet?url=${enc(u)}&text=${enc(t)}` },
  { id: 'viber', label: 'فايبر', icon: '📞', build: (u, t) => `viber://forward?text=${enc(t + '\n' + u)}` },
];

export function ShareSheet({ open, onClose, title, url, onCopied }: { open: boolean; onClose: () => void; title: string; url: string; onCopied?: () => void }) {
  if (!open) return null;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      if (onCopied) onCopied();
    } catch (e: any) {
      if (onCopied) onCopied();
    }
    onClose();
  };

  return (
    <div className="sheet-overlay" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet__handle" />
        <div className="sheet__title">مشاركة</div>
        <div className="muted" style={{ textAlign: 'center', marginBottom: 14 }}>{title}</div>
        <div className="share-opts">
          {OPTIONS.map((o) => (
            <a
              key={o.id}
              className="share-opt"
              href={o.build(url, title)}
              target="_blank"
              rel="noreferrer noopener"
              onClick={onClose}
            >
              <span className="share-opt__icon">{o.icon}</span>
              <span>{o.label}</span>
            </a>
          ))}
        </div>
        <button className="btn btn--primary" style={{ marginTop: 16 }} onClick={copy} type="button">
          نسخ الرابط
        </button>
        <button className="btn btn--ghost" style={{ marginTop: 8 }} onClick={onClose} type="button">
          إلغاء
        </button>
      </div>
    </div>
  );
}
