import { useEffect } from 'react';

export function Toast({ message, onClose, duration = 2200 }: { message: string; onClose: () => void; duration?: number }) {
  useEffect(() => {
    if (!message) return undefined;
    const t = setTimeout(onClose, duration);
    return () => clearTimeout(t);
  }, [message, duration, onClose]);

  if (!message) return null;
  return <div className="toast">{message}</div>;
}
