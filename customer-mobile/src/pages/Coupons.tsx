import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { PageHeader } from '../components/PageHeader';
import { EmptyState } from '../components/EmptyState';
import { Spinner } from '../components/Spinner';
import { Toast } from '../components/Toast';
import { publicApi } from '../api';
import { load, save } from '../store';
import { formatPrice } from '../format';

const COLLECTED_KEY = 'collected_coupons';

function discountLabel(c: any) {
  return c.discount_type === 'fixed' ? formatPrice(c.discount_value) : `${c.discount_value}%`;
}

function copyText(text: string) {
  if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(text);
  return Promise.resolve();
}

export default function Coupons() {
  const navigate = useNavigate();
  const [coupons, setCoupons] = useState<any>(null);
  const [collected, setCollected] = useState<any[]>(() => load<any[]>(COLLECTED_KEY, []));
  const [toast, setToast] = useState('');

  useEffect(() => {
    publicApi.coupons().then(setCoupons).catch(() => setCoupons([]));
  }, []);

  const collect = (c: any) => {
    const next = collected.includes(c.code) ? collected : [...collected, c.code];
    setCollected(next);
    save(COLLECTED_KEY, next);
    setToast(`تم تحصيل كوبون ${c.code} 🎉`);
  };

  const copy = (c: any) => {
    copyText(c.code)
      .then(() => setToast(`تم نسخ الكود ${c.code} — الصقه عند إتمام الطلب`))
      .catch(() => setToast(c.code));
  };

  const openStore = (c: any) => {
    if (c.provider_id) navigate(`/provider/${c.provider_id}`);
  };

  return (
    <div>
      <PageHeader title="🎟️ كوبونات للتحصيل" />
      <div className="page page--no-nav">
        {!coupons ? (
          <div className="centerpad"><Spinner /></div>
        ) : coupons.length === 0 ? (
          <EmptyState icon="🎟️" title="لا كوبونات حالياً" sub="ستظهر هنا كوبونات الخصم من مزودينا — تابع المزوّدين لتصلك عروضهم" />
        ) : (
          <>
            <p className="coup-hint">
              اِجمع الكوبون واستخدم الكود عند إتمام الطلب. تظهر الكوبونات المحصّلة تلقائياً في صفحة الدفع.
            </p>
            <div className="coupons-list">
              {coupons.map((c: any) => {
                const isCollected = collected.includes(c.code);
                return (
                  <div key={c.id} className={`coup${c.provider_id ? ' coup--link' : ''}`}>
                    <button className="coup__badge" onClick={() => openStore(c)} type="button">
                      <span className="coup__badge-sub">{c.discount_type === 'fixed' ? 'خصم' : 'خصم حتى'}</span>
                      <span className="coup__badge-num" dir="ltr">{discountLabel(c)}</span>
                    </button>
                    <div className="coup__info">
                      <div className="coup__title">{c.title || 'كوبون خصم'}</div>
                      <div className="coup__meta">
                        {c.min_amount > 0 ? `الحد الأدنى ${formatPrice(c.min_amount)}` : 'بدون حد أدنى'}
                        {c.provider_name ? ` · ${c.provider_name}` : ''}
                      </div>
                      <div className="coup__code" dir="ltr">{c.code}</div>
                    </div>
                    <div className="coup__actions">
                      {isCollected ? (
                        <>
                          <span className="coup__done">✓ مُحصّل</span>
                          <button className="coup__btn coup__btn--ghost" onClick={() => copy(c)} type="button">نسخ الكود</button>
                        </>
                      ) : (
                        <button className="coup__btn" onClick={() => collect(c)} type="button">تحصيل</button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>
      <Toast message={toast} onClose={() => setToast('')} />
    </div>
  );
}
