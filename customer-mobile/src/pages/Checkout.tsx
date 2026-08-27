import { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { PageHeader } from '../components/PageHeader';
import { Toast } from '../components/Toast';
import { Spinner } from '../components/Spinner';
import { useCart } from '../context/CartContext';
import { useAuth } from '../context/AuthContext';
import { customerApi } from '../api';
import { load } from '../store';
import { formatPrice } from '../format';

function makeSessionId() {
  return 'ck-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
}

export default function Checkout() {
  const { byProvider, totalAmount, clear } = useCart();
  const { user } = useAuth();
  const navigate = useNavigate();
  const groups = byProvider();

  const [addresses, setAddresses] = useState<any>(null);
  const [name, setName] = useState(user?.name_ar || '');
  const [phone, setPhone] = useState(user?.phone || '');
  const [address, setAddress] = useState('');
  const [notes, setNotes] = useState('');
  const [couponCode, setCouponCode] = useState('');
  const [coupon, setCoupon] = useState<any>(null);
  const [loyalty, setLoyalty] = useState<any>(null);
  const [redeemPoints, setRedeemPoints] = useState(0);
  const [collected] = useState(() => load('collected_coupons', []));
  const [toast, setToast] = useState('');
  const [sessionId] = useState(makeSessionId);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState<any[]>([]);

  useEffect(() => {
    if (user && addresses === null) {
      customerApi.addresses().then(setAddresses).catch(() => setAddresses([]));
    }
  }, [user, addresses]);

  useEffect(() => {
    if (user) customerApi.loyalty().then(setLoyalty).catch(() => setLoyalty(null));
  }, [user]);

  const subtotal = groups.reduce((s, g) => s + g.items.reduce((x, it) => x + it.unit_price * it.quantity, 0), 0);
  const discount = coupon ? coupon.discounts.reduce((s: number, d: number) => s + d, 0) : 0;
  const pointValue = Number(loyalty?.point_value) || 1;
  const balance = Number(loyalty?.points_balance) || 0;
  const minRedeem = Number(loyalty?.min_redeem) || 100;
  const afterCoupon = Math.max(0, subtotal - discount);
  const redeemDiscount = Math.min(redeemPoints * pointValue, afterCoupon);
  const grandTotal = Math.max(0, afterCoupon - redeemDiscount);

  const applyCoupon = async (rawCode?: string) => {
    const code = (rawCode !== undefined ? rawCode : couponCode).trim();
    if (!code) {
      setToast('أدخل رمز الكوبون');
      return;
    }
    try {
      const rows = [];
      let appliedCode = null;
      for (const g of groups) {
        const gSub = g.items.reduce((s, it) => s + it.unit_price * it.quantity, 0);
        const r = await customerApi.couponPreview(code, gSub, g.provider_id);
        if (!r.valid) {
          setToast(`كوبون غير صالح: ${r.message}`);
          setCoupon(null);
          return;
        }
        appliedCode = r.code;
        rows.push(r.discount);
      }
      setCoupon({ code: String(appliedCode || code || '').toUpperCase(), discounts: rows });
      setToast('تم تطبيق الكوبون');
    } catch (e: any) {
      setToast(e.message || 'تعذر التحقق من الكوبون');
    }
  };

  const pickAddress = (a: any) => {
    setName(a.name_ar || name);
    setPhone(a.phone || phone);
    setAddress(a.address);
  };

  if (!user) {
    return (
      <div>
        <PageHeader title="إتمام الطلب" />
        <div className="empty">
          <div className="empty__icon">🔐</div>
          <div className="empty__title">يجب تسجيل الدخول أولاً</div>
          <button className="btn btn--primary" onClick={() => navigate('/login?next=checkout')} type="button">تسجيل الدخول</button>
        </div>
      </div>
    );
  }

  const submit = async () => {
    if (!name.trim() || !phone.trim()) {
      setToast('الاسم ورقم الهاتف مطلوبان للتأكيد');
      return;
    }
    setSubmitting(true);
    setToast('');
    try {
      // توزيع نقاط الاستبدال على طلبات المزوّدين بنسبة الإجمالي بعد الكوبون
      const groupTotals = groups.map((g, i) => Math.max(0, g.items.reduce((s, it) => s + it.unit_price * it.quantity, 0) - ((coupon?.discounts || [])[i] || 0)));
      const sumTotals = groupTotals.reduce((s, n) => s + n, 0);
      let remainingPts = redeemPoints;
      const created = [];
      for (let i = 0; i < groups.length; i++) {
        const g = groups[i];
        const items = g.items.map((it) => ({ kind: it.kind, item_id: it.item_id, quantity: it.quantity }));
        const bookingEntry = g.items.find((it) => it.booking);
        const booking = bookingEntry
          ? { ...bookingEntry.booking, title: bookingEntry.booking.title || bookingEntry.title }
          : undefined;
        const isLast = i === groups.length - 1;
        let share = 0;
        if (remainingPts > 0 && sumTotals > 0) {
          const alloc = Math.floor(remainingPts * (groupTotals[i] / sumTotals));
          share = isLast ? remainingPts : alloc;
          remainingPts -= share;
        }
        const order = await customerApi.createOrder(
          {
            provider_id: g.provider_id,
            customer_name: name,
            customer_phone: phone,
            customer_address: address || undefined,
            notes: notes || undefined,
            items,
            booking,
            coupon_code: coupon ? coupon.code : undefined,
            redeem_points: share || undefined,
          },
          `${sessionId}-${g.provider_id}`
        );
        created.push(order);
        setDone((d) => [...d, g.provider_id]);
      }
      if (redeemPoints > 0 && loyalty) {
        customerApi.loyalty().then(setLoyalty).catch(() => {});
      }
      clear();
      navigate('/orders', { state: { placed: created.length } });
    } catch (e: any) {
      setToast(e.message || 'تعذر إتمام الطلب');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div>
      <PageHeader title="إتمام الطلب" />
      <div className="page page--no-nav">
        {addresses && addresses.length > 0 && (
          <div className="card" style={{ padding: 12, marginBottom: 12 }}>
            <div className="row row--between" style={{ marginBottom: 8 }}>
              <span style={{ fontWeight: 800, fontSize: 14 }}>📍 عناويني المحفوظة</span>
              <Link to="/addresses" style={{ color: 'var(--brand)', fontSize: 12, fontWeight: 700 }}>إدارة</Link>
            </div>
            <div className="chips" style={{ padding: 0 }}>
              {addresses.map((a: any) => (
                <button key={a.id} className="chip" onClick={() => pickAddress(a)} type="button">
                  {a.label || a.address}{a.is_default ? ' ⭐' : ''}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="card" style={{ padding: 14, marginBottom: 12 }}>
          <div className="field">
            <label>الاسم</label>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="field">
            <label>رقم الهاتف</label>
            <input className="input" value={phone} onChange={(e) => setPhone(e.target.value)} />
          </div>
          <div className="field">
            <label>العنوان (اختياري)</label>
            <input className="input" value={address} onChange={(e) => setAddress(e.target.value)} />
          </div>
          <div className="field" style={{ marginBottom: 0 }}>
            <label>ملاحظات (اختياري)</label>
            <textarea className="input" value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
        </div>

        <div className="card" style={{ padding: 14, marginBottom: 12 }}>
          <div className="row" style={{ gap: 8 }}>
            <input
              className="input"
              style={{ flex: 1 }}
              placeholder="رمز الكوبون (مثال: SAVE10)"
              value={couponCode}
              onChange={(e) => setCouponCode(e.target.value)}
            />
            <button className="btn btn--outline btn--sm" style={{ padding: '0 18px', height: 44 }} onClick={() => applyCoupon()} type="button">
              تطبيق
            </button>
          </div>
          {collected.length > 0 && (
            <div className="chips" style={{ padding: 0, marginTop: 10, flexWrap: 'wrap' }}>
              {collected.map((code: any) => (
                <button
                  key={code}
                  className={`chip${couponCode.trim().toUpperCase() === String(code).toUpperCase() ? ' chip--active' : ''}`}
                  onClick={() => {
                    setCouponCode(code);
                    applyCoupon(code);
                  }}
                  type="button"
                >
                  🎟️ {code}
                </button>
              ))}
            </div>
          )}
          {coupon && (
            <div className="muted" style={{ marginTop: 8, color: '#00a650', fontWeight: 700 }}>
              ✅ كوبون {coupon.code} — خصم {formatPrice(discount)}
            </div>
          )}
        </div>

        {loyalty && balance >= minRedeem && (
          <div className="card" style={{ padding: 14, marginBottom: 12 }}>
            <div className="row" style={{ gap: 8, marginBottom: 8 }}>
              <span style={{ fontWeight: 800 }}>⭐ نقاط الولاء</span>
              <span className="muted" style={{ fontSize: 12 }}>رصيدك {balance} نقطة ({formatPrice(balance * pointValue)})</span>
            </div>
            <div className="row" style={{ gap: 8 }}>
              <input
                className="input"
                type="number"
                min={0}
                max={balance}
                placeholder="نقاط للاستبدال"
                style={{ flex: 1, textAlign: 'center' }}
                value={redeemPoints || ''}
                onChange={(e) => {
                  const n = Math.floor(Number(e.target.value) || 0);
                  setRedeemPoints(Math.max(0, Math.min(balance, n)));
                }}
              />
              <button className="btn btn--outline btn--sm" style={{ padding: '0 16px', height: 44 }} onClick={() => setRedeemPoints(balance)} type="button">
                الكل
              </button>
            </div>
            {redeemPoints > 0 && (
              <div className="muted" style={{ marginTop: 8, color: '#00a650', fontWeight: 700 }}>
                💚 استبدال {redeemPoints} نقطة = خصم {formatPrice(redeemDiscount)}
              </div>
            )}
          </div>
        )}

        {groups.map((g) => (
          <div className="card" key={g.provider_id} style={{ marginBottom: 12, padding: 14 }}>
            <div className="row row--between">
              <span style={{ fontWeight: 800 }}>{g.provider_name}</span>
              {done.includes(g.provider_id) ? <span style={{ color: '#00a650', fontWeight: 700 }}>✓ تم</span> : null}
            </div>
            {g.items.map((it) => (
              <div key={`${it.kind}:${it.item_id}`} className="summary-row">
                <span>{it.title} × {it.quantity}</span>
                <span>{formatPrice(it.unit_price * it.quantity)}</span>
              </div>
            ))}
            <div className="divider" />
            <div className="summary-row">
              <span>إجمالي هذا المزود</span>
              <span style={{ fontWeight: 800, color: 'var(--brand)' }}>{formatPrice(g.items.reduce((s, it) => s + it.unit_price * it.quantity, 0))}</span>
            </div>
          </div>
        ))}

        <div className="card" style={{ padding: 14 }}>
          <div className="summary-row">
            <span>الإجمالي الفرعي</span>
            <span>{formatPrice(subtotal)}</span>
          </div>
          {coupon && (
            <div className="summary-row" style={{ color: '#00a650' }}>
              <span>خصم الكوبون ({coupon.code})</span>
              <span>-{formatPrice(discount)}</span>
            </div>
          )}
          {redeemPoints > 0 && (
            <div className="summary-row" style={{ color: '#00a650' }}>
              <span>خصم النقاط ({redeemPoints} ⭐)</span>
              <span>-{formatPrice(redeemDiscount)}</span>
            </div>
          )}
          <div className="summary-row summary-row--total">
            <span>الإجمالي الكلي</span>
            <span>{formatPrice(grandTotal)}</span>
          </div>
          <div className="muted" style={{ marginTop: 4, lineHeight: 1.6 }}>
            تُرسل طلباتك إلى المزوّدين للمراجعة والتأكيد. سيُخصم المخزون المؤكد فقط عند تأكيد الطلب.
          </div>
          <button className="btn btn--primary btn--lg" style={{ marginTop: 10 }} onClick={submit} disabled={submitting} type="button">
            {submitting ? <Spinner /> : 'تأكيد الطلب'}
          </button>
        </div>
      </div>
      <Toast message={toast} onClose={() => setToast('')} />
    </div>
  );
}
