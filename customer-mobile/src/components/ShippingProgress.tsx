import { useEffect, useState } from 'react';
import { publicApi } from '../api';
import { formatPrice } from '../format';

export function ShippingProgress({ subtotal }: { subtotal: number }) {
  const [min, setMin] = useState<any>(null);

  useEffect(() => {
    let alive = true;
    publicApi
      .config()
      .then((c) => alive && setMin(Number(c && c.free_shipping_min) || 50000))
      .catch(() => alive && setMin(50000));
    return () => {
      alive = false;
    };
  }, []);

  if (min == null) return null;

  const remaining = Math.max(0, min - subtotal);
  const done = remaining <= 0;
  const pct = Math.min(100, Math.round((subtotal / min) * 100));

  return (
    <div className="shipbar">
      <div className={`shipbar__msg${done ? ' shipbar__msg--done' : ''}`}>
        {done ? (
          <span>🎉 رائع! طلبك مؤهل للشحن المجاني</span>
        ) : (
          <span>أضف <b>{formatPrice(remaining)}</b> إضافية للحصول على شحن مجاني 🚚</span>
        )}
      </div>
      <div className="shipbar__track">
        <div className="shipbar__fill" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
